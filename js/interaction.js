import * as THREE from 'three';
import { state, notifySelectionChange, onEditModeChange, setEditMode, setMeasureMode, onMeasureModeChange } from './state.js';
import { FURNITURE_CATALOG, createFurnitureMesh, saveFurnitureToConfig } from './furniture.js';
import { BOUNDS, disposeObject3D } from './room.js';
import { undo, redo, pushSnapshot } from './history.js';
import { hideDimensions, exitMeasureMode, cleanupPreview } from './dimensions.js';
import { lookup, getInteractables, getMesh, register } from './entity-registry.js';

// ─── DRAG & DROP STATE ───
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = null;      // { item, offset } for furniture, { entity, dragType, ... } for architecture
let didDrag = false;
const SNAP_DIST = 0.15;

// ─── UI CALLBACKS (decoupled from ui.js to avoid tight coupling) ───
const _furnitureChangeCallbacks = [];
const _calibrationCallbacks = [];

/** Register a callback for furniture list changes (called by ui.js) */
export function onFurnitureChange(cb) { _furnitureChangeCallbacks.push(cb); }
/** Register a callback for calibration updates (called by ui.js) */
export function onCalibrationNeeded(cb) { _calibrationCallbacks.push(cb); }

function renderFurnitureList() {
  for (const cb of _furnitureChangeCallbacks) { try { cb(); } catch(e) { /* ignore */ } }
}
function populateCalibration() {
  for (const cb of _calibrationCallbacks) { try { cb(); } catch(e) { /* ignore */ } }
}

// ─── HIGHLIGHT STATE ───
const HOVER_EMISSIVE = 0x333333;
const SELECT_EMISSIVE = 0x224488;
let _hoveredMeshes = [];   // meshes currently highlighted for hover
let _selectedMeshes = [];  // meshes currently highlighted for selection

// ─── HELPERS ───

function updateMouse(e) {
  mouse.x = (e.offsetX / state.renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = -(e.offsetY / state.renderer.domElement.clientHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, state.camera);
}

function getFloorPoint(e) {
  updateMouse(e);
  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(floorPlane, pt);
  return pt;
}

/**
 * Raycast against all registered entities.
 * Returns { entity: { type, id }, mesh } or null.
 */
function hitEntity(e) {
  updateMouse(e);
  const interactables = getInteractables();
  if (interactables.length === 0) return null;

  const hits = raycaster.intersectObjects(interactables);
  if (hits.length > 0) {
    const entity = lookup(hits[0].object);
    if (entity) {
      return { entity, mesh: hits[0].object };
    }
  }
  return null;
}

/**
 * Legacy: find furniture item by entity or event.
 */
function findFurnitureItem(entityId) {
  return state.placedItems.find(i => String(i.id) === entityId) || null;
}

// ─── MATERIAL HIGHLIGHT ───

function saveOriginalEmissive(mesh) {
  if (mesh.userData._origEmissive === undefined && mesh.material?.emissive) {
    mesh.userData._origEmissive = mesh.material.emissive.getHex();
  }
}

function setEmissive(meshes, hex) {
  for (const m of meshes) {
    if (m.material?.emissive) {
      saveOriginalEmissive(m);
      m.material.emissive.setHex(hex);
    }
  }
}

function restoreEmissive(meshes) {
  for (const m of meshes) {
    if (m.material?.emissive && m.userData._origEmissive !== undefined) {
      m.material.emissive.setHex(m.userData._origEmissive);
    }
  }
}

function collectMeshes(object3d) {
  const meshes = [];
  object3d.traverse(c => { if (c.isMesh) meshes.push(c); });
  return meshes;
}

// ─── HOVER HIGHLIGHTING ───

function applyHover(entity) {
  if (!entity) {
    clearHover();
    return;
  }

  // Same entity already hovered?
  const current = state.hoveredEntity;
  if (current && current.type === entity.type && current.id === entity.id) return;

  clearHover();
  state.hoveredEntity = entity;

  // Don't hover if same as selected
  if (state.selectedEntity &&
      state.selectedEntity.type === entity.type &&
      state.selectedEntity.id === entity.id) return;

  const obj = getMesh(entity.type, entity.id);
  if (obj) {
    _hoveredMeshes = collectMeshes(obj);
    setEmissive(_hoveredMeshes, HOVER_EMISSIVE);
  }
}

function clearHover() {
  restoreEmissive(_hoveredMeshes);
  _hoveredMeshes = [];
  state.hoveredEntity = null;
}

// ─── SELECTION ───

export function selectEntity(type, id) {
  const oldEntity = state.selectedEntity;
  const newEntity = (type && id) ? { type, id } : null;

  // Same selection? Skip
  if (oldEntity?.type === newEntity?.type && oldEntity?.id === newEntity?.id) return;

  // Deselect old
  restoreEmissive(_selectedMeshes);
  _selectedMeshes = [];

  // Select new
  state.selectedEntity = newEntity;

  if (newEntity) {
    const obj = getMesh(newEntity.type, newEntity.id);
    if (obj) {
      _selectedMeshes = collectMeshes(obj);
      setEmissive(_selectedMeshes, SELECT_EMISSIVE);
    }
  }

  // Furniture list UI sync
  renderFurnitureList();

  // Notify listeners (properties panel etc.)
  notifySelectionChange(newEntity, oldEntity);
}

// Legacy compatibility
export function selectFurniture(id) {
  if (id === null || id === undefined) {
    selectEntity(null, null);
  } else {
    selectEntity('furniture', String(id));
  }
}

/**
 * Re-apply selection highlight after a rebuild (meshes are new).
 */
export function reapplySelection() {
  if (!state.selectedEntity) return;
  const { type, id } = state.selectedEntity;
  const obj = getMesh(type, id);
  if (obj) {
    _selectedMeshes = collectMeshes(obj);
    setEmissive(_selectedMeshes, SELECT_EMISSIVE);
  }
}

// ─── FURNITURE SNAP ───

export function snapToWalls(item) {
  const cat = FURNITURE_CATALOG[item.type];
  const rot = item.rotation * Math.PI / 180;
  const cosR = Math.abs(Math.cos(rot)), sinR = Math.abs(Math.sin(rot));
  const halfW = (cat.w * cosR + cat.d * sinR) / 2;
  const halfD = (cat.w * sinR + cat.d * cosR) / 2;

  // Use interior wall surface, not exterior bounds
  const wallT = state.apartmentConfig?.walls?.exterior?.thickness ?? 0.08;
  const innerMinX = BOUNDS.minX + wallT;
  const innerMaxX = BOUNDS.maxX - wallT;
  const innerMinZ = BOUNDS.minZ + wallT;
  const innerMaxZ = BOUNDS.maxZ - wallT;

  let x = item.x, z = item.z;

  // Clamp: can't go through interior wall surface
  x = Math.max(innerMinX + halfW, Math.min(innerMaxX - halfW, x));
  z = Math.max(innerMinZ + halfD, Math.min(innerMaxZ - halfD, z));

  // Snap to interior wall surface (multiple simultaneously for corners)
  if (Math.abs((x - halfW) - innerMinX) < SNAP_DIST) x = innerMinX + halfW;
  if (Math.abs((x + halfW) - innerMaxX) < SNAP_DIST) x = innerMaxX - halfW;
  if (Math.abs((z - halfD) - innerMinZ) < SNAP_DIST) z = innerMinZ + halfD;
  if (Math.abs((z + halfD) - innerMaxZ) < SNAP_DIST) z = innerMaxZ - halfD;

  // Also snap to interior walls
  const interiorWalls = state.apartmentConfig?.walls?.interior ?? [];
  for (const w of interiorWalls) {
    if (w.axis === 'x') {
      // Wall runs along Z at fixed X position
      const wallX = w.pos;
      // Check if furniture Z-range overlaps wall Z-range
      if (z + halfD > w.from && z - halfD < w.to) {
        // Snap to left side of wall
        if (Math.abs((x + halfW) - wallX) < SNAP_DIST) x = wallX - halfW;
        // Snap to right side of wall
        if (Math.abs((x - halfW) - wallX) < SNAP_DIST) x = wallX + halfW;
      }
    } else {
      // Wall runs along X at fixed Z position
      const wallZ = w.pos;
      if (x + halfW > w.from && x - halfW < w.to) {
        if (Math.abs((z + halfD) - wallZ) < SNAP_DIST) z = wallZ - halfD;
        if (Math.abs((z - halfD) - wallZ) < SNAP_DIST) z = wallZ + halfD;
      }
    }
  }

  item.x = x;
  item.z = z;
}

// ─── PUBLIC FURNITURE FUNCTIONS ───

export function addFurniture(type) {
  if (!type) {
    const sel = document.getElementById('furnSelect');
    type = sel ? sel.value : 'sofa_3';
  }
  const cat = FURNITURE_CATALOG[type];
  if (!cat) return;

  const id = state.nextItemId++;
  const mesh = createFurnitureMesh(type);

  const offsetX = (state.placedItems.length % 3) * 1.5;
  const offsetZ = Math.floor(state.placedItems.length / 3) * 1.2;
  const x = -1 + offsetX;
  const z = -0.5 + offsetZ;
  mesh.position.set(x, 0, z);

  state.scene.add(mesh);

  // Register as entity
  mesh.userData.entityId = String(id);
  register('furniture', String(id), mesh);

  const item = { id, type, x, z, rotation: 0, mesh };
  state.placedItems.push(item);
  selectEntity('furniture', String(id));
  renderFurnitureList();
  saveFurnitureToConfig();
}

export function removeFurniture(id) {
  const idx = state.placedItems.findIndex(i => i.id === id);
  if (idx === -1) return;
  disposeObject3D(state.placedItems[idx].mesh);
  state.scene.remove(state.placedItems[idx].mesh);
  state.placedItems.splice(idx, 1);
  if (state.selectedItemId === id) selectEntity(null, null);
  renderFurnitureList();
  saveFurnitureToConfig();
}

export function updateFurnPos(id) {
  const item = state.placedItems.find(i => i.id === id);
  if (!item) return;
  const xEl = document.getElementById('fx_' + id);
  const zEl = document.getElementById('fz_' + id);
  if (xEl) { item.x = parseFloat(xEl.value); document.getElementById('fxv_' + id).textContent = item.x.toFixed(1); }
  if (zEl) { item.z = parseFloat(zEl.value); document.getElementById('fzv_' + id).textContent = item.z.toFixed(1); }
  snapToWalls(item);
  item.mesh.position.set(item.x, 0, item.z);
  saveFurnitureToConfig();
}

export function rotateFurn(id, deg) {
  const item = state.placedItems.find(i => i.id === id);
  if (!item) return;
  item.rotation = deg % 360;
  item.mesh.rotation.y = item.rotation * Math.PI / 180;
  snapToWalls(item);
  item.mesh.position.set(item.x, 0, item.z);
  renderFurnitureList();
  saveFurnitureToConfig();
}

// ─── ARCHITECTURE DRAG CONFIG ───

function getArchDragConfig(entity) {
  const cfg = state.apartmentConfig;
  if (!cfg) return null;

  if (entity.type === 'wall') {
    const wall = cfg.walls?.interior?.find(w => w.id === entity.id);
    if (!wall) return null;
    return {
      dragType: 'wall',
      axis: wall.axis,  // 'x' → drag along X, 'z' → drag along Z
      configRef: wall,
    };
  }

  if (entity.type === 'window') {
    const win = cfg.windows?.find(w => w.id === entity.id);
    if (!win) return null;
    const isHorizontal = win.wall === 'south' || win.wall === 'north';
    return {
      dragType: 'window',
      axis: isHorizontal ? 'x' : 'z',
      configRef: win,
      width: isHorizontal ? (win.x2 - win.x1) : (win.z2 - win.z1),
    };
  }

  if (entity.type === 'protrusion') {
    const p = cfg.walls?.protrusions?.find(pr => pr.id === entity.id);
    if (!p) return null;
    return {
      dragType: 'protrusion',
      axis: 'xz',  // free XZ movement
      configRef: p,
      width: p.bounds.maxX - p.bounds.minX,
      depth: p.bounds.maxZ - p.bounds.minZ,
    };
  }

  return null;
}

// ─── INIT ───

export function initInteraction() {
  const canvas = state.renderer.domElement;

  // Expose to window for HTML onclick
  window.addFurniture = addFurniture;
  window.removeFurniture = removeFurniture;
  window.selectFurniture = selectFurniture;
  window.updateFurnPos = updateFurnPos;
  window.rotateFurn = rotateFurn;

  // Expose selectEntity for eidos API
  state._selectEntityFn = selectEntity;

  // When edit mode changes, update toolbar + viewport
  onEditModeChange((enabled) => {
    // Update toolbar mode buttons
    document.querySelectorAll('#floating-toolbar .toolbar-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === (enabled ? 'edit' : 'navigate'));
    });
    // Update viewport mode indicator
    const wrap = document.getElementById('canvas-wrap');
    const badge = document.getElementById('mode-badge');
    if (wrap) {
      wrap.classList.toggle('mode-edit', enabled);
      wrap.classList.remove('mode-measure');
    }
    if (badge) {
      badge.textContent = 'REDIGER';
      badge.className = 'mode-badge edit' + (enabled ? ' visible' : '');
    }
    // Hide properties panel when leaving edit mode
    const propSection = document.getElementById('properties-section');
    if (propSection && !enabled) {
      propSection.style.display = 'none';
    }
    if (!enabled) {
      clearHover();
      selectEntity(null, null);
      canvas.style.cursor = '';
    }
  });

  // When measure mode changes, update toolbar + viewport
  onMeasureModeChange((enabled) => {
    // Update toolbar mode buttons
    document.querySelectorAll('#floating-toolbar .toolbar-btn[data-mode]').forEach(btn => {
      if (enabled) {
        btn.classList.toggle('active', btn.dataset.mode === 'measure');
      } else if (!state.editMode) {
        btn.classList.toggle('active', btn.dataset.mode === 'navigate');
      }
    });
    // Update viewport mode indicator
    const wrap = document.getElementById('canvas-wrap');
    const badge = document.getElementById('mode-badge');
    if (enabled) {
      if (wrap) { wrap.classList.remove('mode-edit'); wrap.classList.add('mode-measure'); }
      if (badge) { badge.textContent = 'MÅL'; badge.className = 'mode-badge measure visible'; }
      canvas.style.cursor = 'crosshair';
      if (window.eidos?.toast) {
        window.eidos.toast('Klikk to vegger for avstand, eller to punkter. ESC for å avslutte.', 'info', 4000);
      }
    } else {
      if (wrap) wrap.classList.remove('mode-measure');
      if (badge && !state.editMode) badge.classList.remove('visible');
      canvas.style.cursor = '';
      exitMeasureMode();
      cleanupPreview();
    }
  });

  // Wire floating toolbar buttons
  document.querySelectorAll('#floating-toolbar .toolbar-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'navigate') {
        setEditMode(false);
        setMeasureMode(false);
      } else if (mode === 'edit') {
        setEditMode(true);
        setMeasureMode(false);
      } else if (mode === 'measure') {
        setEditMode(false);
        setMeasureMode(true);
      }
    });
  });

  // Wire undo/redo toolbar buttons
  const undoBtn = document.getElementById('toolbar-undo');
  const redoBtn = document.getElementById('toolbar-redo');
  if (undoBtn) undoBtn.addEventListener('click', () => window._undo?.());
  if (redoBtn) redoBtn.addEventListener('click', () => window._redo?.());

  // Wire help button
  const helpBtn = document.getElementById('toolbar-help');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      const tt = document.getElementById('shortcuts-tooltip');
      if (tt) tt.classList.toggle('visible');
    });
  }

  // Expose toggleEditMode (backward compatibility)
  window.toggleEditMode = () => setEditMode(!state.editMode);

  // ─── POINTER DOWN ───
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.editMode) return; // Navigate mode — let OrbitControls handle it

    const hit = hitEntity(e);
    if (!hit) return;

    const { entity } = hit;

    if (entity.type === 'furniture') {
      // Furniture drag
      const item = findFurnitureItem(entity.id);
      if (item) {
        const floorPt = getFloorPoint(e);
        if (floorPt) {
          dragging = {
            type: 'furniture',
            item,
            offset: new THREE.Vector3(item.x - floorPt.x, 0, item.z - floorPt.z),
          };
          didDrag = false;
          state.controls.enabled = false;
          const panel = document.getElementById('panel');
          if (panel) panel.style.pointerEvents = 'none';
          selectEntity('furniture', entity.id);
          canvas.style.cursor = 'grabbing';
        }
      }
    } else {
      // Architecture drag (wall, window, protrusion)
      const dragConfig = getArchDragConfig(entity);
      if (dragConfig) {
        const floorPt = getFloorPoint(e);
        if (floorPt) {
          const obj = getMesh(entity.type, entity.id);
          dragging = {
            type: 'architecture',
            entity,
            dragConfig,
            startFloor: floorPt.clone(),
            startPos: obj ? obj.position.clone() : null,
            object3d: obj,
          };
          didDrag = false;
          state.controls.enabled = false;
          const panel = document.getElementById('panel');
          if (panel) panel.style.pointerEvents = 'none';
          selectEntity(entity.type, entity.id);
          canvas.style.cursor = 'grabbing';
        }
      } else {
        // Non-draggable architecture — just select
        selectEntity(entity.type, entity.id);
      }
    }
  });

  // ─── POINTER MOVE ───
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const floorPt = getFloorPoint(e);
      if (!floorPt) return;

      if (dragging.type === 'furniture') {
        // Furniture drag — existing behavior
        dragging.item.x = floorPt.x + dragging.offset.x;
        dragging.item.z = floorPt.z + dragging.offset.z;
        snapToWalls(dragging.item);
        dragging.item.mesh.position.set(dragging.item.x, 0, dragging.item.z);
        didDrag = true;
        const xEl = document.getElementById('fx_' + dragging.item.id);
        const zEl = document.getElementById('fz_' + dragging.item.id);
        if (xEl) { xEl.value = dragging.item.x; document.getElementById('fxv_' + dragging.item.id).textContent = dragging.item.x.toFixed(1); }
        if (zEl) { zEl.value = dragging.item.z; document.getElementById('fzv_' + dragging.item.id).textContent = dragging.item.z.toFixed(1); }
      } else if (dragging.type === 'architecture') {
        // Architecture drag — move mesh in real-time, no rebuild
        const dc = dragging.dragConfig;
        const delta = floorPt.clone().sub(dragging.startFloor);
        const obj = dragging.object3d;
        if (!obj) return;

        if (dc.dragType === 'wall') {
          if (dc.axis === 'x') {
            // Wall runs along Z at fixed X — drag changes X
            obj.position.x = dragging.startPos.x + delta.x;
          } else {
            // Wall runs along X at fixed Z — drag changes Z
            obj.position.z = dragging.startPos.z + delta.z;
          }
        } else if (dc.dragType === 'window') {
          if (dc.axis === 'x') {
            obj.position.x = dragging.startPos.x + delta.x;
          } else {
            obj.position.z = dragging.startPos.z + delta.z;
          }
        } else if (dc.dragType === 'protrusion') {
          obj.position.x = dragging.startPos.x + delta.x;
          obj.position.z = dragging.startPos.z + delta.z;
        }

        didDrag = true;
      }
    } else if (state.editMode) {
      // Hover highlighting (only in edit mode)
      const hit = hitEntity(e);
      if (hit) {
        applyHover(hit.entity);
        canvas.style.cursor = hit.entity.type === 'furniture' ? 'grab' : 'pointer';
      } else {
        clearHover();
        canvas.style.cursor = '';
      }
    }
  });

  // ─── POINTER UP ───
  canvas.addEventListener('pointerup', (e) => {
    if (dragging) {
      state.controls.enabled = true;
      canvas.style.cursor = '';
      const panel = document.getElementById('panel');
      if (panel) panel.style.pointerEvents = '';

      if (dragging.type === 'furniture') {
        if (didDrag) {
          pushSnapshot('Flytt møbel');
          saveFurnitureToConfig();
        }
      } else if (dragging.type === 'architecture' && didDrag) {
        // Commit architecture drag to config
        commitArchitectureDrag(dragging);
      }

      dragging = null;
    }

    if (!didDrag && state.editMode) {
      // Click without drag — select/deselect (only in edit mode)
      const hit = hitEntity(e);
      if (hit) {
        selectEntity(hit.entity.type, hit.entity.id);
      } else {
        selectEntity(null, null);
      }
    }
    didDrag = false;
  });

  // ─── KEYBOARD ───
  document.addEventListener('keydown', (e) => {
    // Undo/redo — works even when input is focused
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo(async () => {
        await window.eidos.rebuild();
        populateCalibration();
        hideDimensions();
        reapplySelection();
      });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo(async () => {
        await window.eidos.rebuild();
        populateCalibration();
        hideDimensions();
        reapplySelection();
      });
      return;
    }

    if (e.key === 'Escape') {
      if (state.measureMode) {
        setMeasureMode(false);
        return;
      }
      if (state.editMode) {
        selectEntity(null, null);
      }
      exitMeasureMode();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    // E key — toggle edit mode
    if (e.key === 'e' || e.key === 'E') {
      setEditMode(!state.editMode);
      return;
    }
    // N key — navigate mode
    if (e.key === 'n' || e.key === 'N') {
      setEditMode(false);
      setMeasureMode(false);
      return;
    }
    // M key — toggle measure mode
    if (e.key === 'm' || e.key === 'M') {
      setMeasureMode(!state.measureMode);
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (state.selectedItemId !== null) {
        const item = state.placedItems.find(i => i.id === state.selectedItemId);
        if (item) rotateFurn(item.id, (item.rotation + 90) % 360);
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedItemId !== null && e.target.tagName !== 'INPUT') {
        removeFurniture(state.selectedItemId);
      }
    }
  });
}

// ─── COMMIT ARCHITECTURE DRAG ───

async function commitArchitectureDrag(drag) {
  const { entity, dragConfig, startPos, object3d } = drag;
  const dc = dragConfig;
  const cfg = state.apartmentConfig;

  pushSnapshot(`Flytt ${entity.type} ${entity.id}`);

  if (dc.dragType === 'wall') {
    // Update wall position in config
    const wall = cfg.walls?.interior?.find(w => w.id === entity.id);
    if (wall) {
      if (dc.axis === 'x') {
        wall.pos = parseFloat(object3d.position.x.toFixed(3));
      } else {
        wall.pos = parseFloat(object3d.position.z.toFixed(3));
      }
    }
  } else if (dc.dragType === 'window') {
    const win = cfg.windows?.find(w => w.id === entity.id);
    if (win) {
      const delta = dc.axis === 'x'
        ? object3d.position.x - startPos.x
        : object3d.position.z - startPos.z;

      if (dc.axis === 'x') {
        win.x1 = parseFloat((win.x1 + delta).toFixed(3));
        win.x2 = parseFloat((win.x2 + delta).toFixed(3));
      } else {
        win.z1 = parseFloat((win.z1 + delta).toFixed(3));
        win.z2 = parseFloat((win.z2 + delta).toFixed(3));
      }
    }
  } else if (dc.dragType === 'protrusion') {
    const p = cfg.walls?.protrusions?.find(pr => pr.id === entity.id);
    if (p) {
      const dx = object3d.position.x - startPos.x;
      const dz = object3d.position.z - startPos.z;
      p.bounds.minX = parseFloat((p.bounds.minX + dx).toFixed(3));
      p.bounds.maxX = parseFloat((p.bounds.maxX + dx).toFixed(3));
      p.bounds.minZ = parseFloat((p.bounds.minZ + dz).toFixed(3));
      p.bounds.maxZ = parseFloat((p.bounds.maxZ + dz).toFixed(3));
    }
  }

  // Rebuild and re-select
  await window.eidos.rebuild(false);
  selectEntity(entity.type, entity.id);
}
