import { state, onSelectionChange, onXRModeChange, setEditMode } from './state.js';
import { onFurnitureChange, onCalibrationNeeded } from './interaction.js';
import { setRoomFocus, clearRoomFocus } from './room-focus.js';
import { showDimensions, hideDimensions } from './dimensions.js';
// Note: selectEntity imported dynamically in handlePropertyChange to avoid direct coupling
// interaction.js imports from ui.js, and ui.js uses selectEntity only in property change handlers

// ─── SUB-MODULE RE-EXPORTS ───
// All public functions from sub-modules are re-exported here so that
// existing imports like `import { renderFurnitureList } from './ui.js'` continue to work.

export { renderFurnitureList, populateFurnitureSelect } from './ui-furniture.js';
export { initHistoryPanel, renderHistory, historyIcon, timeAgo } from './ui-history.js';
export { populateCalibration, populateApartmentInfo, runSolver, highlightRoom } from './ui-calibration.js';
export { initPropertiesPanel, initPropertiesCard, renderProperties, handlePropertyChange } from './ui-properties.js';

// ─── IMPORTS FOR initUI ───
import { renderFurnitureList, populateFurnitureSelect } from './ui-furniture.js';
import { initHistoryPanel } from './ui-history.js';
import { populateCalibration, populateApartmentInfo, runSolver } from './ui-calibration.js';
import { initPropertiesPanel, initPropertiesCard } from './ui-properties.js';

// ─── VIEW BUTTON ACTIVE STATE ───

function initViewButtons() {
  document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Clear room pill active state (view buttons = full apartment views)
      document.querySelectorAll('.room-pill').forEach(p => p.classList.remove('active'));
    });
  });
}

// ─── VISIBILITY TOGGLES ───

function initVisibilityToggles() {
  // Layer pills (floors/ceiling/terrace)
  document.querySelectorAll('.vis-pill[data-layers]').forEach(pill => {
    pill.addEventListener('click', () => {
      pill.classList.toggle('on');
      const layers = pill.dataset.layers.split(',');
      const visible = pill.classList.contains('on');
      if (!state.scene) return;
      state.scene.traverse(obj => {
        if (obj.name && layers.includes(obj.name)) obj.visible = visible;
      });
    });
  });

  // Room navigation pills (top of panel)
  populateRoomNavPills();
}

function populateRoomNavPills() {
  const container = document.getElementById('room-nav-pills');
  if (!container) return;
  const cfg = state.apartmentConfig;
  if (!cfg) return;

  const rooms = [];
  for (const r of (cfg.rooms || [])) rooms.push({ ...r, floor: 5 });
  if (cfg.upperFloor?.rooms) {
    for (const r of cfg.upperFloor.rooms) {
      if (r.id === 'terrasse') continue;
      rooms.push({ ...r, floor: 6 });
    }
  }

  container.innerHTML = '';
  for (const room of rooms) {
    const pill = document.createElement('span');
    pill.className = 'room-pill';
    pill.dataset.room = room.id;

    // Room name text
    const nameSpan = document.createElement('span');
    nameSpan.className = 'room-pill-name';
    nameSpan.textContent = room.name || room.id;
    pill.appendChild(nameSpan);

    // Measurement status dot
    const entries = cfg.measurements?.entries || [];
    const ct = room.ceilingType || 'flat';
    const totalDims = 2 + (ct === 'slope' ? 2 : 1); // width + depth + height(s)
    const measuredDims = entries.filter(e => e.room === room.id).length;
    const statusDot = document.createElement('span');
    statusDot.className = 'room-pill-status';
    if (measuredDims === 0) {
      statusDot.classList.add('none');
    } else if (measuredDims >= totalDims) {
      statusDot.classList.add('complete');
    } else {
      statusDot.classList.add('partial');
    }
    pill.appendChild(statusDot);

    // Eye toggle for wall visibility
    const eye = document.createElement('span');
    eye.className = 'eye-toggle';
    eye.textContent = '\u{1F441}';
    eye.title = 'Vis/skjul vegger';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      const hiding = !pill.classList.contains('walls-hidden');
      toggleRoomWalls(room.id, room.bounds, !hiding);
      pill.classList.toggle('walls-hidden', hiding);
      eye.textContent = hiding ? '\u{1F441}\u200D\u{1F5E8}' : '\u{1F441}';
    });
    pill.appendChild(eye);

    // Click: fly to room and show dimensions
    pill.addEventListener('click', (e) => {
      if (e.shiftKey) {
        // Shift+click still works as shortcut
        eye.click();
        return;
      }
      if (window.flyToRoom && room.bounds) {
        const y = room.floor === 6 ? (cfg.upperFloor?.floorY || 2.25) : 0;
        window.flyToRoom(room.bounds, y);
        setRoomFocus(room.id, room.floor, null);
        container.querySelectorAll('.room-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        showDimensions(room.id, room.floor);
      }
    });

    container.appendChild(pill);
  }
}

function toggleRoomWalls(roomId, bounds, visible) {
  const scene = state.scene;
  if (!scene) return;
  const cfg = state.apartmentConfig;
  const ext = cfg?.walls?.exterior;
  if (!ext || !bounds) return;

  const tol = 0.15; // tolerance for adjacency detection
  const b = bounds;

  // Check if a wall mesh bbox is adjacent to this room's bounds
  function meshTouchesRoom(minX, maxX, minZ, maxZ) {
    // Must overlap in one axis and touch in the other
    const overlapX = minX < b.maxX - tol && maxX > b.minX + tol;
    const overlapZ = minZ < b.maxZ - tol && maxZ > b.minZ + tol;
    const touchMinX = Math.abs(maxX - b.minX) < tol || Math.abs(minX - b.minX) < tol;
    const touchMaxX = Math.abs(minX - b.maxX) < tol || Math.abs(maxX - b.maxX) < tol;
    const touchMinZ = Math.abs(maxZ - b.minZ) < tol || Math.abs(minZ - b.minZ) < tol;
    const touchMaxZ = Math.abs(minZ - b.maxZ) < tol || Math.abs(maxZ - b.maxZ) < tol;
    return (overlapZ && (touchMinX || touchMaxX)) || (overlapX && (touchMinZ || touchMaxZ));
  }

  // OBJ meshes (ExternalWalls + InnerSide)
  const objModel = scene.getObjectByName('OBJModel');
  if (objModel) {
    const scale = objModel.scale.x;
    objModel.traverse(child => {
      if (!child.isMesh) return;
      const name = child.name || '';
      if (!name.startsWith('ExternalWalls') && !name.startsWith('InnerSide')) return;
      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      if (meshTouchesRoom(bb.min.x * scale, bb.max.x * scale, bb.min.z * scale, bb.max.z * scale)) {
        child.visible = visible;
      }
    });
  }

  // Config-built gable walls in UpperFloor
  const uf = scene.getObjectByName('UpperFloor');
  if (uf) {
    uf.traverse(child => {
      if (!child.isMesh || !child.userData.wallSide) return;
      // Check if gable wall side matches a room edge
      const side = child.userData.wallSide;
      if ((side === 'south' && Math.abs(b.minZ - ext.minZ) < tol) ||
          (side === 'north' && Math.abs(b.maxZ - ext.maxZ) < tol) ||
          (side === 'west' && Math.abs(b.minX - ext.minX) < tol) ||
          (side === 'east' && Math.abs(b.maxX - ext.maxX) < tol)) {
        child.visible = visible;
      }
    });
  }
}

// ─── TOOLBAR POPOVERS ───

function initToolbarPopovers() {
  const popoverMap = {
    'toolbar-furniture': 'furniture-popover',
    'toolbar-simulator': 'simulator-popover',
    'toolbar-views': 'views-popover',
    'toolbar-photos': 'photos-popover',
    'toolbar-ar': 'ar-popover',
  };

  function togglePopover(popover, btn) {
    const wasVisible = popover.classList.contains('visible');
    closeAllPopovers();
    if (!wasVisible) {
      popover.classList.add('visible');
      btn.classList.add('popover-active');
      // Position popover centered above its button
      const rect = btn.getBoundingClientRect();
      const popW = popover.offsetWidth;
      popover.style.left = Math.max(10, Math.min(window.innerWidth - popW - 10, rect.left + rect.width / 2 - popW / 2)) + 'px';
    }
  }

  for (const [btnId, popId] of Object.entries(popoverMap)) {
    const btn = document.getElementById(btnId);
    const pop = document.getElementById(popId);
    if (btn && pop) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover(pop, btn);
      });
    }
  }

  // Close popovers on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.toolbar-popover') && !e.target.closest('#floating-toolbar')) {
      closeAllPopovers();
    }
  });
}

function closeAllPopovers() {
  document.querySelectorAll('.toolbar-popover').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('popover-active'));
}

// ─── XR MODE LISTENER ───

function initXRModeListener() {
  onXRModeChange((mode) => {
    // Close all popovers when entering XR
    closeAllPopovers();

    if (mode) {
      // Entering XR — exit edit/measure mode, clear selection
      setEditMode(false);

      // Exit measure mode if active
      const measureBtn = document.querySelector('#floating-toolbar .toolbar-btn[data-mode="measure"]');
      if (measureBtn && measureBtn.classList.contains('active')) {
        const navBtn = document.querySelector('#floating-toolbar .toolbar-btn[data-mode="navigate"]');
        measureBtn.classList.remove('active');
        if (navBtn) navBtn.classList.add('active');
        const wrap = document.getElementById('canvas-wrap');
        if (wrap) wrap.classList.remove('mode-measure');
        const badge = document.getElementById('mode-badge');
        if (badge) badge.classList.remove('visible');
      }

      // Hide properties panel
      const propSection = document.getElementById('properties-section');
      if (propSection) propSection.style.display = 'none';
    }

    // Update VR/AR toolbar button active states
    const vrBtn = document.getElementById('toolbar-vr');
    const arBtn = document.getElementById('toolbar-ar');
    if (vrBtn) vrBtn.classList.toggle('active', mode === 'vr');
    if (arBtn) arBtn.classList.toggle('active', mode === 'ar-furniture' || mode === 'ar-table');
  });
}

// ─── PHOTO COMPARISON ───

function initPhotoPanel() {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;

  // Hardcoded file list (these are the actual files in finn_photos/)
  const photos = [
    '2f096254-4697-4384-b055-3fbac17923c0.jpg',
    '31bfa2cc-df8f-4c49-9cec-6fa013862402.jpg',
    '3a428a2b-8af5-47fe-801f-39a21e4c2f53.jpg',
    '4cb83d06-21b8-40b0-a4b3-3ad11cc79ebf.jpg',
    '6059cc2f-e4fb-4411-bbcd-20b84d83d972.jpg',
    '95b317c4-9f0f-4de9-9fba-fbcd4f8fcb54.jpg',
    'aed5cea3-49ba-4a2f-b65e-d0a3d2879dd5.jpg',
    'b00f1102-fc35-49df-8c4f-34f9129a23a2.jpg',
    'b530af73-b9aa-4432-9e0e-6d25e9da32ec.jpg',
    'c00c43e8-80c6-4d3c-af87-dc79443d4130.jpg',
    'd1c76019-74da-4e43-b524-76c397b422dc.jpg',
    'dfe81945-b8cb-4d56-babd-c9e8b24cc098.jpg',
    'ee530e17-a013-4f4e-a503-1a0a34ecc770.jpg',
    'f68df7e3-912a-49b5-a625-d70ad871b4f9.jpg',
    'fdbc80fa-d0a5-4ae6-ba86-574140206285.jpg'
  ];

  photos.forEach((file, i) => {
    const img = document.createElement('img');
    img.src = `finn_photos/${file}`;
    img.alt = `Foto ${i + 1}`;
    img.style.cssText = 'width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;cursor:pointer;opacity:0.7;transition:opacity 0.15s';
    img.addEventListener('mouseenter', () => img.style.opacity = '1');
    img.addEventListener('mouseleave', () => { if (!img.classList.contains('active')) img.style.opacity = '0.7'; });
    img.addEventListener('click', () => {
      // Toggle active state
      grid.querySelectorAll('img').forEach(i2 => { i2.classList.remove('active'); i2.style.opacity = '0.7'; });
      img.classList.add('active');
      img.style.opacity = '1';
      openPhotoOverlay(`finn_photos/${file}`);
    });
    grid.appendChild(img);
  });

  // Wire overlay controls
  const opacitySlider = document.getElementById('photo-opacity');
  const overlayImg = document.getElementById('photo-overlay-img');
  const closeBtn = document.getElementById('photo-overlay-close');

  if (opacitySlider && overlayImg) {
    opacitySlider.addEventListener('input', () => {
      overlayImg.style.opacity = opacitySlider.value / 100;
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closePhotoOverlay);
  }
}

function openPhotoOverlay(src) {
  const overlay = document.getElementById('photo-overlay');
  const img = document.getElementById('photo-overlay-img');
  const slider = document.getElementById('photo-opacity');
  if (!overlay || !img) return;
  img.src = src;
  img.style.opacity = (slider?.value || 50) / 100;
  overlay.style.display = 'block';
}

function closePhotoOverlay() {
  const overlay = document.getElementById('photo-overlay');
  if (overlay) overlay.style.display = 'none';
  // Clear active state on thumbnails
  const grid = document.getElementById('photo-grid');
  if (grid) grid.querySelectorAll('img').forEach(i => { i.classList.remove('active'); i.style.opacity = '0.7'; });
}

// ─── INIT UI ───


export function initUI() {
  initViewButtons();
  initVisibilityToggles();
  initHistoryPanel();
  initPropertiesPanel();
  initToolbarPopovers();
  initPropertiesCard();
  initXRModeListener();
  initPhotoPanel();
  // Expose hideDimensions for inline onclick in view buttons
  window._hideDims = hideDimensions;

  // Register decoupled callbacks from interaction.js
  onFurnitureChange(() => renderFurnitureList());
  onCalibrationNeeded(() => populateCalibration());

  // Populate apartment info, calibration, and room pills once config is loaded
  if (state.apartmentConfig) {
    // Run solver on startup if there are existing measurements
    const entries = state.apartmentConfig.measurements?.entries;
    if (entries && entries.length > 0) {
      runSolver();
      // Rebuild geometry from solver-adjusted config (don't re-fetch from disk)
      if (window.eidos) window.eidos.rebuild(false);
    }
    populateApartmentInfo();
    populateCalibration();
    populateRoomNavPills();
    populateFurnitureSelect();
  } else {
    setTimeout(() => {
      const entries = state.apartmentConfig?.measurements?.entries;
      if (entries && entries.length > 0) {
        runSolver();
        if (window.eidos) window.eidos.rebuild(false);
      }
      populateApartmentInfo();
      populateCalibration();
      populateRoomNavPills();
      populateFurnitureSelect();
      }, 500);
  }
}
