import * as THREE from 'three';
import { state } from './state.js';
import { FURNITURE_CATALOG, createFurnitureMesh, saveFurnitureToConfig } from './furniture.js';
import { BOUNDS } from './room.js';
import { renderFurnitureList, populateCalibration } from './ui.js';
import { undo, redo } from './history.js';
import { hideDimensions } from './dimensions.js';

// ─── DRAG & DROP STATE ───
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = null;
let didDrag = false;
const SNAP_DIST = 0.15;

// ─── HELPERS ───

function getFloorPoint(e) {
  mouse.x = (e.offsetX / state.renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = -(e.offsetY / state.renderer.domElement.clientHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, state.camera);
  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(floorPlane, pt);
  return pt;
}

function hitFurniture(e) {
  mouse.x = (e.offsetX / state.renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = -(e.offsetY / state.renderer.domElement.clientHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, state.camera);
  const allMeshes = [];
  for (const item of state.placedItems) {
    item.mesh.traverse(c => { if (c.isMesh) allMeshes.push(c); });
  }
  const hits = raycaster.intersectObjects(allMeshes);
  if (hits.length > 0) {
    for (const item of state.placedItems) {
      let found = false;
      item.mesh.traverse(c => { if (c === hits[0].object) found = true; });
      if (found) return item;
    }
  }
  return null;
}

export function snapToWalls(item) {
  const cat = FURNITURE_CATALOG[item.type];
  const rot = item.rotation * Math.PI / 180;
  const cosR = Math.abs(Math.cos(rot)), sinR = Math.abs(Math.sin(rot));
  const halfW = (cat.w * cosR + cat.d * sinR) / 2;
  const halfD = (cat.w * sinR + cat.d * cosR) / 2;

  let x = item.x, z = item.z;

  // Clamp: can't go through walls (uses config-driven BOUNDS)
  x = Math.max(BOUNDS.minX + halfW, Math.min(BOUNDS.maxX - halfW, x));
  z = Math.max(BOUNDS.minZ + halfD, Math.min(BOUNDS.maxZ - halfD, z));

  // Snap to walls (multiple simultaneously for corners)
  if (Math.abs((x - halfW) - BOUNDS.minX) < SNAP_DIST) x = BOUNDS.minX + halfW;
  if (Math.abs((x + halfW) - BOUNDS.maxX) < SNAP_DIST) x = BOUNDS.maxX - halfW;
  if (Math.abs((z - halfD) - BOUNDS.minZ) < SNAP_DIST) z = BOUNDS.minZ + halfD;
  if (Math.abs((z + halfD) - BOUNDS.maxZ) < SNAP_DIST) z = BOUNDS.maxZ - halfD;

  item.x = x;
  item.z = z;
}

// ─── PUBLIC FUNCTIONS ───

export function selectFurniture(id) {
  if (state.selectedItemId !== null) {
    const prev = state.placedItems.find(i => i.id === state.selectedItemId);
    if (prev) {
      const cat = FURNITURE_CATALOG[prev.type];
      prev.mesh.children[0].material.color.setHex(cat.color);
    }
  }
  state.selectedItemId = id;
  if (id !== null) {
    const item = state.placedItems.find(i => i.id === id);
    if (item) {
      item.mesh.children[0].material.color.setHex(0x66AADD);
    }
  }
  renderFurnitureList();
}

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
  const item = { id, type, x, z, rotation: 0, mesh };
  state.placedItems.push(item);
  selectFurniture(id);
  renderFurnitureList();
  saveFurnitureToConfig();
}

export function removeFurniture(id) {
  const idx = state.placedItems.findIndex(i => i.id === id);
  if (idx === -1) return;
  state.scene.remove(state.placedItems[idx].mesh);
  state.placedItems.splice(idx, 1);
  if (state.selectedItemId === id) state.selectedItemId = null;
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

// ─── INIT ───

export function initInteraction() {
  const canvas = state.renderer.domElement;

  // Expose to window for HTML onclick
  window.addFurniture = addFurniture;
  window.removeFurniture = removeFurniture;
  window.selectFurniture = selectFurniture;
  window.updateFurnPos = updateFurnPos;
  window.rotateFurn = rotateFurn;

  // Pointer events
  canvas.addEventListener('pointerdown', (e) => {
    const item = hitFurniture(e);
    if (item) {
      const floorPt = getFloorPoint(e);
      if (floorPt) {
        dragging = { item, offset: new THREE.Vector3(item.x - floorPt.x, 0, item.z - floorPt.z) };
        didDrag = false;
        state.controls.enabled = false;
        const panel = document.getElementById('panel');
        if (panel) panel.style.pointerEvents = 'none';
        selectFurniture(item.id);
        canvas.style.cursor = 'grabbing';
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const floorPt = getFloorPoint(e);
      if (floorPt) {
        dragging.item.x = floorPt.x + dragging.offset.x;
        dragging.item.z = floorPt.z + dragging.offset.z;
        snapToWalls(dragging.item);
        dragging.item.mesh.position.set(dragging.item.x, 0, dragging.item.z);
        didDrag = true;
        const xEl = document.getElementById('fx_' + dragging.item.id);
        const zEl = document.getElementById('fz_' + dragging.item.id);
        if (xEl) { xEl.value = dragging.item.x; document.getElementById('fxv_' + dragging.item.id).textContent = dragging.item.x.toFixed(1); }
        if (zEl) { zEl.value = dragging.item.z; document.getElementById('fzv_' + dragging.item.id).textContent = dragging.item.z.toFixed(1); }
      }
    } else {
      const item = hitFurniture(e);
      canvas.style.cursor = item ? 'grab' : '';
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (dragging) {
      state.controls.enabled = true;
      canvas.style.cursor = '';
      const panel = document.getElementById('panel');
      if (panel) panel.style.pointerEvents = '';
      dragging = null;
      if (didDrag) saveFurnitureToConfig(); // persist after drag
    }
    if (!didDrag) {
      const item = hitFurniture(e);
      selectFurniture(item ? item.id : null);
    }
    didDrag = false;
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Undo/redo — works even when input is focused
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo(async () => {
        await window.eidos.rebuild();
        populateCalibration();
        hideDimensions();
      });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo(async () => {
        await window.eidos.rebuild();
        populateCalibration();
        hideDimensions();
      });
      return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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
