import * as THREE from 'three';
import { state, onSelectionChange, onXRModeChange, setEditMode } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';
import { BOUNDS, ceilAt } from './room.js';
import { solveConstraints, applyToConfig } from './solver.js';
import { showDimensions, showSingleDimension, hideDimensions, toggleMeasureMode, clearControlMeasurements } from './dimensions.js';
import { setRoomFocus, clearRoomFocus } from './room-focus.js';
import { pushSnapshot, getEntries, getPointer, getFullEntries, jumpTo, setHistoryChangeListener } from './history.js';
import { showHistoryDiff, clearHistoryDiff, computeDiff, getDiffSummary } from './history-diff.js';
import { onFurnitureChange, onCalibrationNeeded } from './interaction.js';
// Note: selectEntity imported dynamically in handlePropertyChange to avoid direct coupling
// interaction.js imports from ui.js, and ui.js uses selectEntity only in property change handlers

// ─── FURNITURE LIST RENDERING ───

export function renderFurnitureList() {
  const list = document.getElementById('furnList');
  list.innerHTML = '';

  // Slider ranges computed from apartment config bounds (with small margin)
  const xMin = (BOUNDS.minX - 0.1).toFixed(2);
  const xMax = (BOUNDS.maxX + 0.1).toFixed(2);
  const zMin = (BOUNDS.minZ - 0.1).toFixed(2);
  const zMax = (BOUNDS.maxZ + 0.1).toFixed(2);

  for (const item of state.placedItems) {
    const cat = FURNITURE_CATALOG[item.type];
    const sel = item.id === state.selectedItemId;
    const div = document.createElement('div');
    div.className = 'furn-item' + (sel ? ' selected' : '');
    div.innerHTML = `
      <div class="furn-item-header">
        <span onclick="selectFurniture(${item.id})">${cat.name}</span>
        <button class="btn-del" onclick="removeFurniture(${item.id})" title="Slett">&times;</button>
      </div>
      <div class="rot-btns">
        <button class="${item.rotation===0?'active':''}" onclick="rotateFurn(${item.id},0)">0&deg;</button>
        <button class="${item.rotation===90?'active':''}" onclick="rotateFurn(${item.id},90)">90&deg;</button>
        <button class="${item.rotation===180?'active':''}" onclick="rotateFurn(${item.id},180)">180&deg;</button>
        <button class="${item.rotation===270?'active':''}" onclick="rotateFurn(${item.id},270)">270&deg;</button>
      </div>
      <div class="furn-controls">
        <label>X: <span id="fxv_${item.id}">${item.x.toFixed(1)}</span>m</label>
        <label>Z: <span id="fzv_${item.id}">${item.z.toFixed(1)}</span>m</label>
        <input type="range" id="fx_${item.id}" min="${xMin}" max="${xMax}" step="0.05" value="${item.x}" oninput="updateFurnPos(${item.id})">
        <input type="range" id="fz_${item.id}" min="${zMin}" max="${zMax}" step="0.05" value="${item.z}" oninput="updateFurnPos(${item.id})">
      </div>
    `;
    list.appendChild(div);
  }
}

// ─── FURNITURE CATALOG DROPDOWN ───

function populateFurnitureSelect() {
  const sel = document.getElementById('furnSelect');
  if (!sel) return;
  sel.innerHTML = '';
  for (const [key, cat] of Object.entries(FURNITURE_CATALOG)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${cat.name} (${cat.w}×${cat.d}m)`;
    sel.appendChild(opt);
  }
}

// ─── APARTMENT INFO ───

function populateApartmentInfo() {
  const summary = document.getElementById('apartment-summary');
  if (!summary) return;

  const cfg = state.apartmentConfig;
  if (!cfg) { summary.textContent = ''; return; }

  const b = cfg.bounds || {};
  const width = ((b.maxX || 0) - (b.minX || 0)).toFixed(1);
  const depth = ((b.maxZ || 0) - (b.minZ || 0)).toFixed(1);
  const roomCount = (cfg.rooms || []).length;
  const upperRoomCount = (cfg.upperFloor?.rooms || []).length;
  const totalRooms = roomCount + upperRoomCount;
  const floors = cfg.upperFloor ? 2 : 1;

  const shortName = (cfg.name || 'Bolig').replace(/,.*$/, '');
  summary.textContent = `${shortName} \u00b7 ${width}\u00d7${depth}m \u00b7 ${totalRooms} rom`;
}

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

// ─── PANEL COLLAPSE / EXPAND ───


// ─── HISTORY PANEL ───

function initHistoryPanel() {
  setHistoryChangeListener(renderHistory);
}

function historyIcon(label) {
  const l = label.toLowerCase();
  if (l.includes('kalibrering') || l.includes('mål')) return '📐';
  if (l.includes('vegg') || l.includes('wall')) return '🧱';
  if (l.includes('vindu') || l.includes('window')) return '🪟';
  if (l.includes('dør') || l.includes('door')) return '🚪';
  if (l.includes('tak') || l.includes('ceiling') || l.includes('roof')) return '⛺';
  if (l.includes('terrasse') || l.includes('terrace')) return '☀️';
  if (l.includes('møbel') || l.includes('furniture')) return '🪑';
  if (l.includes('rom') || l.includes('room')) return '📦';
  if (l.includes('trapp') || l.includes('stair')) return '🪜';
  if (l.includes('protrusion') || l.includes('bjelke')) return '🔲';
  if (l.includes('config') || l.includes('update')) return '⚙️';
  return '✏️';
}

function renderHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;

  const entries = getEntries();
  const section = document.getElementById('history-section');
  if (entries.length === 0) {
    container.innerHTML = '<div class="history-empty">Ingen endringer ennå</div>';
    if (section) section.style.display = 'none';
    return;
  }
  // Show history section when there are entries
  if (section) section.style.display = '';

  const pointer = getPointer();
  const fullEntries = getFullEntries();
  const undoCount = pointer + 1;
  const redoCount = Math.max(0, entries.length - pointer - 2);
  let html = `<div class="history-counter">${undoCount} angre${redoCount > 0 ? ` · ${redoCount} gjør om` : ''}</div>`;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const isActive = i === pointer;
    const isFuture = i > pointer;
    const cls = `history-entry${isActive ? ' active' : ''}${isFuture ? ' future' : ''}`;
    const ago = timeAgo(e.timestamp);
    const icon = historyIcon(e.label);

    // Compute change count badge
    let badge = '';
    if (i > 0 && fullEntries[i] && fullEntries[i - 1]) {
      try {
        const diff = computeDiff(fullEntries[i].config, fullEntries[i - 1].config);
        const count = getDiffSummary(diff);
        if (count > 0) badge = `<span class="h-diff-count">${count}</span>`;
      } catch (_) { /* ignore */ }
    }

    html += `<div class="${cls}" data-index="${i}"><span class="h-icon">${icon}</span><span class="h-label">${e.label}</span>${badge}<span class="h-time">${ago}</span></div>`;
  }
  container.innerHTML = html;

  // Click handlers — jump to history state and show 3D diff overlay
  container.querySelectorAll('.history-entry').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.dataset.index);
      if (window.eidos) {
        // Get configs for diff BEFORE jumping (entries include full configs)
        const fullEntries = getFullEntries();
        const prevConfig = idx > 0 ? fullEntries[idx - 1].config : null;
        const currentConfig = fullEntries[idx].config;

        await jumpTo(idx, () => window.eidos.rebuild());

        // Show 3D diff overlay if there's a previous state to compare against
        if (prevConfig) {
          showHistoryDiff(currentConfig, prevConfig);
        } else {
          clearHistoryDiff();
        }

        populateCalibration();
        populateApartmentInfo();
      }
    });
  });

  // Auto-open section when history exists
  if (section && !section.classList.contains('open') && entries.length > 0) {
    section.classList.add('open');
  }
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'nå';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}t`;
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

    // Eye toggle for wall visibility
    const eye = document.createElement('span');
    eye.className = 'eye-toggle';
    eye.textContent = '👁';
    eye.title = 'Vis/skjul vegger';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      const hiding = !pill.classList.contains('walls-hidden');
      toggleRoomWalls(room.id, room.bounds, !hiding);
      pill.classList.toggle('walls-hidden', hiding);
      eye.textContent = hiding ? '👁‍🗨' : '👁';
    });
    pill.appendChild(eye);

    // Click: fly to room
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

// ─── INIT UI ───

export function initUI() {
  initViewButtons();
  initVisibilityToggles();
  initHistoryPanel();
  initPropertiesPanel();
  initToolbarPopovers();
  initPropertiesCard();
  initXRModeListener();

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

function initToolbarPopovers() {
  const popoverMap = {
    'toolbar-furniture': 'furniture-popover',
    'toolbar-simulator': 'simulator-popover',
    'toolbar-views': 'views-popover',
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


// ─── ROOM CALIBRATION (Tikhonov solver) ───

let highlightMesh = null;
let activeRoomId = null;

function populateCalibration() {
  const container = document.getElementById('room-calibration');
  if (!container) return;

  const cfg = state.apartmentConfig;
  if (!cfg || !cfg.rooms) { container.innerHTML = ''; return; }

  // Ensure measurements section exists
  if (!cfg.measurements) {
    cfg.measurements = { defaultWallThickness: 0.08, priors: { wallPositionWeight: 0.1, wallThicknessWeight: 10.0 }, entries: [] };
  }
  const entries = cfg.measurements.entries;

  // Collect all rooms (5th + 6th floor)
  const allRooms = [];
  for (const r of cfg.rooms) {
    allRooms.push({ ...r, floor: r.floor || 5 });
  }
  if (cfg.upperFloor && cfg.upperFloor.rooms) {
    for (const r of cfg.upperFloor.rooms) {
      allRooms.push({ ...r, floor: 6 });
    }
  }

  // Group by floor
  const floors = {};
  for (const r of allRooms) {
    (floors[r.floor] = floors[r.floor] || []).push(r);
  }

  // Get last solver result for residuals
  const lastResult = state._lastSolverResult || null;

  // Progress tracking (width + depth + height(s) per room)
  const totalDims = allRooms.reduce((sum, r) => {
    const ct = r.ceilingType || 'flat';
    return sum + 2 + (ct === 'slope' ? 2 : 1);
  }, 0);
  const measuredDims = entries.length;
  const pct = totalDims > 0 ? Math.round(measuredDims / totalDims * 100) : 0;

  let html = `
    <div class="cal-progress">
      <div class="cal-progress-bar"><div class="cal-progress-fill" style="width:${pct}%"></div></div>
      <span class="cal-progress-text">${measuredDims}/${totalDims} mål</span>
    </div>
    <button class="cal-start-btn" onclick="window._startCalibration()">▶ Start guidet kalibrering</button>`;

  for (const [floor, rooms] of Object.entries(floors).sort()) {
    html += `<div class="cal-floor-header">${floor}. etasje</div>`;
    for (const room of rooms) {
      const b = room.bounds;
      const compW = (b.maxX - b.minX).toFixed(2);
      const compD = (b.maxZ - b.minZ).toFixed(2);

      // Find raw measurements for this room
      const mW = entries.find(e => e.room === room.id && e.dim === 'width');
      const mD = entries.find(e => e.room === room.id && e.dim === 'depth');

      // Residuals
      const resW = lastResult && lastResult.residuals[`${room.id}:width`];
      const resD = lastResult && lastResult.residuals[`${room.id}:depth`];

      // Height measurement(s)
      const ct = room.ceilingType || 'flat';
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;

      // Card state class — count all dims
      const allMeas = [mW, mD];
      let heightHtml = '';

      if (ct === 'slope') {
        const mHL = entries.find(e => e.room === room.id && e.dim === 'height_low');
        const mHH = entries.find(e => e.room === room.id && e.dim === 'height_high');
        allMeas.push(mHL, mHH);
        const compHL = ceilAt(cx, b.minZ).toFixed(2);
        const compHH = ceilAt(cx, b.maxZ).toFixed(2);
        const resHL = lastResult && lastResult.residuals[`${room.id}:height_low`];
        const resHH = lastResult && lastResult.residuals[`${room.id}:height_high`];
        heightHtml = `
            <div class="room-dim-group">
              <span class="dim-label">H&#8595;</span>
              <input type="number" step="0.01" min="0.5" max="8"
                value="${mHL ? mHL.value : ''}" placeholder="${compHL}"
                data-room="${room.id}" data-floor="${floor}" data-dim="height_low">
              <span class="unit">m</span>
              ${resHL != null ? `<span class="residual ${residualClass(resHL)}">${(resHL * 100).toFixed(1)}cm</span>` : ''}
            </div>
            <div class="room-dim-group">
              <span class="dim-label">H&#8593;</span>
              <input type="number" step="0.01" min="0.5" max="8"
                value="${mHH ? mHH.value : ''}" placeholder="${compHH}"
                data-room="${room.id}" data-floor="${floor}" data-dim="height_high">
              <span class="unit">m</span>
              ${resHH != null ? `<span class="residual ${residualClass(resHH)}">${(resHH * 100).toFixed(1)}cm</span>` : ''}
            </div>`;
      } else {
        const mH = entries.find(e => e.room === room.id && e.dim === 'height');
        allMeas.push(mH);
        const compH = ceilAt(cx, cz).toFixed(2);
        const resH = lastResult && lastResult.residuals[`${room.id}:height`];
        heightHtml = `
            <div class="room-dim-group">
              <span class="dim-label">H</span>
              <input type="number" step="0.01" min="0.5" max="8"
                value="${mH ? mH.value : ''}" placeholder="${compH}"
                data-room="${room.id}" data-floor="${floor}" data-dim="height">
              <span class="unit">m</span>
              ${resH != null ? `<span class="residual ${residualClass(resH)}">${(resH * 100).toFixed(1)}cm</span>` : ''}
            </div>`;
      }

      const hasMeas = allMeas.filter(Boolean).length;
      const totalForRoom = allMeas.length;
      const cardState = (hasMeas === totalForRoom) ? 'measured' : hasMeas > 0 ? 'partial' : '';
      const dotClass = hasMeas === totalForRoom ? 'complete' : hasMeas > 0 ? 'partial' : 'none';
      const statusText = `${hasMeas}/${totalForRoom}`;

      html += `
        <div class="room-card ${cardState}" data-room="${room.id}" data-floor="${floor}">
          <div class="room-card-header">
            <span class="room-name">${room.name}</span>
            <span class="room-status"><span class="status-dot ${dotClass}"></span>${statusText}</span>
            <span class="room-computed">${compW} × ${compD}</span>
          </div>
          <div class="room-dims">
            <div class="room-dim-group">
              <span class="dim-label">B</span>
              <input type="number" step="0.01" min="0.5" max="10"
                value="${mW ? mW.value : ''}" placeholder="${compW}"
                data-room="${room.id}" data-floor="${floor}" data-dim="width">
              <span class="unit">m</span>
              ${resW != null ? `<span class="residual ${residualClass(resW)}">${(resW * 100).toFixed(1)}cm</span>` : ''}
            </div>
            <div class="room-dim-group">
              <span class="dim-label">D</span>
              <input type="number" step="0.01" min="0.5" max="10"
                value="${mD ? mD.value : ''}" placeholder="${compD}"
                data-room="${room.id}" data-floor="${floor}" data-dim="depth">
              <span class="unit">m</span>
              ${resD != null ? `<span class="residual ${residualClass(resD)}">${(resD * 100).toFixed(1)}cm</span>` : ''}
            </div>
            ${heightHtml}
          </div>
        </div>`;
    }
  }

  // Solver summary
  if (lastResult && measuredDims > 0) {
    html += '<div class="solver-summary"><div class="solver-summary-header">Solver</div><div class="wall-thickness-summary">';
    for (const [id, thick] of Object.entries(lastResult.wallThicknesses)) {
      html += `<span class="wall-thick">${id}: ${(thick * 100).toFixed(1)}cm</span>`;
    }
    if (lastResult.heights) {
      const h = lastResult.heights;
      html += `<span class="wall-thick">Etg: ${h.floorY.toFixed(2)}m</span>`;
    }
    if (lastResult.rmsResidual > 0) {
      html += `<span class="rms-residual">RMS ${(lastResult.rmsResidual * 100).toFixed(1)}cm</span>`;
    }
    html += '</div></div>';
  }

  container.innerHTML = html;

  // Event listeners — click to expand/collapse + highlight room
  container.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return; // don't toggle when clicking input
      const wasExpanded = card.classList.contains('expanded');
      container.querySelectorAll('.room-card').forEach(c => {
        c.classList.remove('active');
        c.classList.remove('expanded');
      });
      card.classList.add('active');
      if (!wasExpanded) card.classList.add('expanded');
      highlightRoom(card.dataset.room, parseInt(card.dataset.floor));
    });
  });

  container.querySelectorAll('input[type=number]').forEach(input => {
    input.addEventListener('focus', (e) => {
      e.stopPropagation();
      const card = input.closest('.room-card');
      container.querySelectorAll('.room-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      highlightRoom(input.dataset.room, parseInt(input.dataset.floor));
    });
    input.addEventListener('change', () => onMeasurementChange(input));
  });
}

function residualClass(res) {
  const abs = Math.abs(res);
  if (abs < 0.02) return 'res-good';
  if (abs < 0.05) return 'res-warn';
  return 'res-bad';
}

// ─── CALIBRATION WIZARD ───

let calWizard = null; // { steps, currentStep }

const DIM_INSTRUCTIONS = {
  width: (room) => `Mål bredden fra vegg til vegg, midt i rommet (ca 1m høyde)`,
  depth: (room) => `Mål dybden fra vegg til vegg, midt i rommet (ca 1m høyde)`,
  height: (room) => `Mål takhøyden fra gulv til tak, midt i rommet`,
  height_low: (room) => `Mål takhøyden ved laveste punkt (nær vindusveggen)`,
  height_high: (room) => `Mål takhøyden ved høyeste punkt (nær bakveggen)`,
};

function buildCalibrationSteps(cfg) {
  const steps = [];

  // Optimal room order: largest/most-connected rooms first for best solver results
  // Each room measurement constrains shared walls, so starting with the most
  // connected room gives the solver the most information early.
  const floorRooms = cfg.rooms || [];
  const upperRooms = (cfg.upperFloor?.rooms || []).filter(r => r.id !== 'terrasse');

  // Sort 5th floor rooms by number of shared walls (descending), then by area (descending)
  const sorted5 = [...floorRooms].sort((a, b) => {
    const areaA = (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxZ - a.bounds.minZ);
    const areaB = (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxZ - b.bounds.minZ);
    const sharedA = countSharedWalls(a, floorRooms, cfg);
    const sharedB = countSharedWalls(b, floorRooms, cfg);
    if (sharedB !== sharedA) return sharedB - sharedA;
    return areaB - areaA;
  });

  for (const room of sorted5) {
    const dims = (room.ceilingType === 'slope')
      ? ['width', 'depth', 'height_low', 'height_high']
      : ['width', 'depth', 'height'];
    for (const dim of dims) {
      steps.push({ roomId: room.id, floor: 5, dim, roomName: room.name || room.id, room });
    }
  }

  // 6th floor rooms sorted by area
  const sorted6 = [...upperRooms].sort((a, b) => {
    const areaA = (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxZ - a.bounds.minZ);
    const areaB = (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxZ - b.bounds.minZ);
    return areaB - areaA;
  });

  for (const room of sorted6) {
    const dims = ['width', 'depth', 'height'];
    for (const dim of dims) {
      steps.push({ roomId: room.id, floor: 6, dim, roomName: room.name || room.id, room });
    }
  }

  return steps;
}

function countSharedWalls(room, allRooms, cfg) {
  const tol = 0.15;
  const b = room.bounds;
  let count = 0;
  for (const other of allRooms) {
    if (other.id === room.id) continue;
    const ob = other.bounds;
    // Check if any edge of room is adjacent to other room (within tolerance)
    if (Math.abs(b.maxX - ob.minX) < tol || Math.abs(b.minX - ob.maxX) < tol ||
        Math.abs(b.maxZ - ob.minZ) < tol || Math.abs(b.minZ - ob.maxZ) < tol) {
      count++;
    }
  }
  // Also count exterior walls
  const ext = cfg.walls?.exterior;
  if (ext) {
    if (Math.abs(b.minX - ext.minX) < tol) count++;
    if (Math.abs(b.maxX - ext.maxX) < tol) count++;
    if (Math.abs(b.minZ - ext.minZ) < tol) count++;
    if (Math.abs(b.maxZ - ext.maxZ) < tol) count++;
  }
  return count;
}

function setCalibrationFocusMode(active) {
  const calCard = document.getElementById('calibration-card');
  if (calCard) calCard.style.display = active ? '' : 'none';

  // Hide/show 3D distractions (furniture, simulator, compass)
  if (!state.scene) return;
  const hideNames = ['Furniture', 'SimulatorGroup', 'Protrusions'];
  for (const name of hideNames) {
    const obj = state.scene.getObjectByName(name);
    if (obj) obj.visible = !active;
  }
  // Hide simulator
  const simToggle = document.getElementById('simToggle');
  if (simToggle && active) { simToggle.checked = false; simToggle.dispatchEvent(new Event('change')); }
  // Hide compass
  const compass = document.getElementById('compass-wrap');
  if (compass) compass.style.display = active ? 'none' : '';
}

function startCalibration() {
  const cfg = state.apartmentConfig;
  if (!cfg) return;

  const steps = buildCalibrationSteps(cfg);
  calWizard = { steps, currentStep: 0 };

  // Skip already-measured steps
  const entries = cfg.measurements?.entries || [];
  while (calWizard.currentStep < steps.length) {
    const s = steps[calWizard.currentStep];
    if (entries.find(e => e.room === s.roomId && e.dim === s.dim)) {
      calWizard.currentStep++;
    } else {
      break;
    }
  }

  setCalibrationFocusMode(true);
  renderCalibrationWizard();
  navigateToStep();
}

function exitCalibration() {
  calWizard = null;
  setCalibrationFocusMode(false);
  hideDimensions();
  clearRoomFocus();
  // Restore visibility
  clearRoomFocus();
  populateCalibration();
}

function navigateToStep() {
  if (!calWizard || calWizard.currentStep >= calWizard.steps.length) {
    // All done!
    renderCalibrationWizard();
    return;
  }

  const step = calWizard.steps[calWizard.currentStep];
  const room = step.room;
  const b = room.bounds;
  const floorY = step.floor === 6 ? (state.apartmentConfig.upperFloor?.floorY || 2.25) : 0;

  // Show full apartment with room focus — hides blocking geometry only
  setRoomFocus(step.roomId, step.floor, null);

  // Position camera looking down into the room at ~45° angle
  // This gives the best view of horizontal measurement lines
  const midX = (b.minX + b.maxX) / 2;
  const midZ = (b.minZ + b.maxZ) / 2;
  const roomW = b.maxX - b.minX;
  const roomD = b.maxZ - b.minZ;
  const viewDist = Math.max(roomW, roomD) * 1.1;

  if (step.dim === 'width' || step.dim === 'depth') {
    // Elevated perspective looking into the room
    state.camera.position.set(midX - viewDist * 0.3, floorY + viewDist * 1.2, midZ - viewDist * 0.6);
    state.controls.target.set(midX, floorY + 0.8, midZ);
  } else {
    // Height measurement — side view to see vertical line
    state.camera.position.set(midX + viewDist * 0.8, floorY + 1.5, midZ - viewDist * 0.5);
    state.controls.target.set(midX, floorY + 1.2, midZ);
  }
  state.controls.update();

  // Show single dimension guide
  showSingleDimension(step.roomId, step.floor, step.dim);
}

function advanceCalibration(value) {
  if (!calWizard) return;
  const step = calWizard.steps[calWizard.currentStep];
  const val = parseFloat(value);

  if (!isNaN(val) && val >= 0.1) {
    pushSnapshot(`Kalibrering: ${step.roomId} ${step.dim}`);
    const cfg = state.apartmentConfig;
    if (!cfg.measurements) {
      cfg.measurements = { defaultWallThickness: 0.08, priors: { wallPositionWeight: 0.1, wallThicknessWeight: 10.0, heightWeight: 1.0 }, entries: [] };
    }
    const entries = cfg.measurements.entries;
    const idx = entries.findIndex(e => e.room === step.roomId && e.dim === step.dim);
    if (idx >= 0) entries[idx].value = val;
    else entries.push({ room: step.roomId, dim: step.dim, value: val });

    runSolver();
    if (window.eidos) {
      // Use fromDisk=false to preserve solver results in memory
      window.eidos.rebuild(false).then(() => {
        calWizard.currentStep++;
        renderCalibrationWizard();
        navigateToStep();
      });
    }
  }
}

function skipStep() {
  if (!calWizard) return;
  calWizard.currentStep++;
  renderCalibrationWizard();
  navigateToStep();
}

function renderCalibrationWizard() {
  const container = document.getElementById('room-calibration');
  if (!container) return;

  if (!calWizard) {
    // Not in wizard — show normal calibration with start button
    populateCalibration();
    return;
  }

  const steps = calWizard.steps;
  const current = calWizard.currentStep;
  const entries = state.apartmentConfig?.measurements?.entries || [];
  const measured = entries.length;
  const total = steps.length;
  const pct = total > 0 ? (measured / total) * 100 : 0;

  // Check if done
  if (current >= steps.length) {
    container.innerHTML = `
      <div class="cal-wizard-done">
        <div class="cal-wizard-check">✓</div>
        <div class="cal-wizard-done-text">Kalibrering ferdig!</div>
        <div class="cal-wizard-done-sub">${measured} av ${total} mål registrert</div>
        <button class="cal-wizard-btn" onclick="window._exitCalibration()">Tilbake</button>
      </div>`;
    return;
  }

  const step = steps[current];
  const instruction = DIM_INSTRUCTIONS[step.dim](step.room);
  const dimLabel = { width: 'Bredde', depth: 'Dybde', height: 'Høyde', height_low: 'Høyde (lav)', height_high: 'Høyde (høy)' }[step.dim];

  // Existing measurement?
  const existing = entries.find(e => e.room === step.roomId && e.dim === step.dim);

  // Room progress dots
  const uniqueRooms = [...new Map(steps.map(s => [s.roomId, s])).values()];
  let dotsHtml = '';
  for (const r of uniqueRooms) {
    const roomSteps = steps.filter(s => s.roomId === r.roomId);
    const roomMeasured = roomSteps.filter(s => entries.find(e => e.room === s.roomId && e.dim === s.dim)).length;
    const isCurrent = r.roomId === step.roomId;
    const isDone = roomMeasured === roomSteps.length;
    const cls = isDone ? 'done' : isCurrent ? 'current' : '';
    dotsHtml += `<span class="cal-room-dot ${cls}" title="${r.roomName}">${r.roomName.substring(0, 3)}</span>`;
  }

  container.innerHTML = `
    <div class="cal-wizard">
      <div class="cal-wizard-header">
        <span class="cal-wizard-room">${step.roomName}</span>
        <span class="cal-wizard-dim">${dimLabel}</span>
        <span class="cal-progress-text">${current + 1}/${total}</span>
      </div>
      <div class="cal-wizard-input-row">
        <input type="number" id="cal-wizard-input" step="0.01" min="0.1"
          value="${existing ? existing.value : ''}"
          placeholder="meter" autofocus>
        <span class="cal-wizard-unit">m</span>
        <button class="cal-wizard-btn primary" onclick="window._advanceCalibration()">→</button>
        <button class="cal-wizard-btn skip" onclick="window._skipStep()">Hopp</button>
        <button class="cal-wizard-btn exit" onclick="window._exitCalibration()">✕</button>
      </div>
    </div>`;

  // Focus input and handle Enter key
  const input = document.getElementById('cal-wizard-input');
  if (input) {
    setTimeout(() => input.focus(), 100);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') window._advanceCalibration();
    });
  }
}

// Expose wizard functions to window for onclick handlers
window._startCalibration = startCalibration;
window._exitCalibration = exitCalibration;
window._advanceCalibration = () => {
  const input = document.getElementById('cal-wizard-input');
  if (input) advanceCalibration(input.value);
};
window._skipStep = skipStep;
window._runSolver = runSolver;
window._toggleMeasureMode = toggleMeasureMode;

function onMeasurementChange(input) {
  pushSnapshot(`Kalibrering: ${input.dataset.room} ${input.dataset.dim}`);
  const roomId = input.dataset.room;
  const floor = parseInt(input.dataset.floor);
  const dim = input.dataset.dim;
  const rawVal = input.value.trim();

  const cfg = state.apartmentConfig;
  if (!cfg.measurements) {
    cfg.measurements = { defaultWallThickness: 0.08, priors: { wallPositionWeight: 0.1, wallThicknessWeight: 10.0 }, entries: [] };
  }
  const entries = cfg.measurements.entries;

  // Find existing entry
  const idx = entries.findIndex(e => e.room === roomId && e.dim === dim);

  if (rawVal === '' || isNaN(parseFloat(rawVal))) {
    // Clear measurement
    if (idx >= 0) entries.splice(idx, 1);
  } else {
    const value = parseFloat(rawVal);
    if (value < 0.1) return;
    if (idx >= 0) {
      entries[idx].value = value;
    } else {
      entries.push({ room: roomId, dim, value });
    }
  }

  // Run solver with ALL measurements
  runSolver();

  // Rebuild from memory (not disk) to preserve solver results
  if (window.eidos) {
    window.eidos.rebuild(false).then(() => {
      populateCalibration();
      populateApartmentInfo();
      highlightRoom(roomId, floor);
      const container = document.getElementById('room-calibration');
      const card = container.querySelector(`[data-room="${roomId}"][data-floor="${floor}"]`);
      if (card) card.classList.add('active');
    });
  }
}

function runSolver() {
  const cfg = state.apartmentConfig;
  if (!cfg || !cfg.measurements) return;

  const meas = cfg.measurements;
  const result = solveConstraints({
    measurements: meas.entries,
    exterior: cfg.walls.exterior,
    interiorWalls: cfg.walls.interior || [],
    rooms: cfg.rooms || [],
    defaultWallThickness: meas.defaultWallThickness || 0.08,
    priors: meas.priors || { wallPositionWeight: 0.1, wallThicknessWeight: 10.0, heightWeight: 1.0 },
    ceilingZones: (cfg.ceiling && cfg.ceiling.zones) || [],
    upperFloorY: cfg.upperFloor ? cfg.upperFloor.floorY : null
  });

  // Store result for UI display
  state._lastSolverResult = result;

  // Apply to config (mutates rooms, walls, ceiling zones, upperFloor)
  applyToConfig(cfg, result);
}

function highlightRoom(roomId, floor) {
  if (highlightMesh) {
    highlightMesh.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    state.scene.remove(highlightMesh);
    highlightMesh = null;
  }
  clearRoomFocus();
  activeRoomId = roomId;

  const cfg = state.apartmentConfig;
  if (!cfg) return;

  let room = null;
  if (floor === 6 && cfg.upperFloor && cfg.upperFloor.rooms) {
    room = cfg.upperFloor.rooms.find(r => r.id === roomId);
  }
  if (!room) {
    room = (cfg.rooms || []).find(r => r.id === roomId);
  }
  if (!room) return;

  const b = room.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const y = floor === 6 ? (cfg.upperFloor.floorY + 0.15) : 0.15;

  const shape = new THREE.Shape();
  shape.moveTo(b.minX, b.minZ);
  shape.lineTo(b.maxX, b.minZ);
  shape.lineTo(b.maxX, b.maxZ);
  shape.lineTo(b.minX, b.maxZ);
  shape.lineTo(b.minX, b.minZ);
  const points = shape.getPoints();
  const geo = new THREE.BufferGeometry().setFromPoints(
    points.map(p => new THREE.Vector3(p.x, y, p.y))
  );
  const mat = new THREE.LineBasicMaterial({ color: 0x00ccff, depthTest: false, linewidth: 2 });
  highlightMesh = new THREE.Line(geo, mat);
  highlightMesh.renderOrder = 999;
  state.scene.add(highlightMesh);

  const fillGeo = new THREE.PlaneGeometry(w, d);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x00ccff, transparent: true, opacity: 0.20,
    side: THREE.DoubleSide, depthTest: false
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
  fill.renderOrder = 998;
  highlightMesh.add(fill);

  // Show dimension lines for this room
  showDimensions(roomId, floor);

  // Fly camera to room + hide blocking geometry
  if (window.flyToRoom) {
    const result = window.flyToRoom(b, y - 0.15);
    if (result) {
      setRoomFocus(roomId, floor, result.approachSide);
    }
  }
}

// ─── PROPERTIES PANEL ───

const ENTITY_LABELS = {
  wall: 'Innervegg',
  window: 'Vindu',
  door: 'Dør',
  protrusion: 'Bjelke/utstikk',
  furniture: 'Møbel',
  room: 'Rom',
};
const ENTITY_ICONS = {
  wall: '▬', window: '▢', door: '🚪', protrusion: '▣', furniture: '🪑', room: '⬚',
};
const DELETABLE_TYPES = new Set(['furniture', 'protrusion']);

function initPropertiesPanel() {
  onSelectionChange((newEntity, _oldEntity) => {
    renderProperties(newEntity);
  });
}

function initPropertiesCard() {
  const closeBtn = document.getElementById('properties-card-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const card = document.getElementById('properties-card');
      if (card) card.style.display = 'none';
      // Clear selection
      if (window.eidos) window.eidos.selectEntity(null, null);
    });
  }
}

function renderProperties(entity) {
  const card = document.getElementById('properties-card');
  const panel = document.getElementById('properties-panel');
  if (!card || !panel) return;

  if (!entity) {
    card.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  card.style.display = '';
  const cfg = state.apartmentConfig;
  if (!cfg) return;

  const typeLabel = ENTITY_LABELS[entity.type] || entity.type;
  const icon = ENTITY_ICONS[entity.type] || '';
  const canDelete = DELETABLE_TYPES.has(entity.type);
  let html = `<div class="prop-header">
    <span class="prop-type">${icon} ${typeLabel}</span>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="prop-id">${entity.id}</span>
      ${canDelete ? `<button class="prop-delete" data-entity="${entity.type}" data-id="${entity.id}" title="Slett">✕</button>` : ''}
    </div>
  </div>`;

  // Helper for property row with unit
  const ed = entity.type, eid = entity.id;
  const row = (label, value, field, unit = 'm', step = '0.01') =>
    `<span class="prop-label">${label}</span><div class="prop-input-wrap"><input class="prop-value" type="number" step="${step}" value="${value}" data-entity="${ed}" data-id="${eid}" data-field="${field}"><span class="prop-unit">${unit}</span></div>`;
  const readonlyRow = (label, value) =>
    `<span class="prop-label">${label}</span><input class="prop-value readonly" value="${value}" readonly>`;

  if (entity.type === 'wall') {
    const wall = cfg.walls?.interior?.find(w => w.id === entity.id);
    if (wall) {
      html += `<div class="prop-grid">
        ${readonlyRow('Akse', wall.axis)}
        ${row('Posisjon', wall.pos, 'pos')}
        ${row('Fra', wall.from, 'from')}
        ${row('Til', wall.to, 'to')}
      </div>`;
    }
  } else if (entity.type === 'window') {
    const win = cfg.windows?.find(w => w.id === entity.id);
    if (win) {
      const isH = win.wall === 'south' || win.wall === 'north';
      html += `<div class="prop-grid">
        ${readonlyRow('Vegg', win.wall)}
        ${isH ? row('X1', win.x1, 'x1') + row('X2', win.x2, 'x2') : row('Z1', win.z1, 'z1') + row('Z2', win.z2, 'z2')}
        ${row('Brystning', win.sillHeight, 'sillHeight')}
        ${row('Topp', win.topHeight, 'topHeight')}
      </div>`;
    }
  } else if (entity.type === 'door') {
    const door = cfg.doors?.find(d => d.id === entity.id);
    if (door) {
      html += `<div class="prop-grid">
        ${readonlyRow('Vegg', door.wall)}
        ${row('Fra', door.from, 'from')}
        ${row('Til', door.to, 'to')}
        ${row('Høyde', door.height, 'height')}
      </div>`;
    }
  } else if (entity.type === 'protrusion') {
    const p = cfg.walls?.protrusions?.find(pr => pr.id === entity.id);
    if (p) {
      html += `<div class="prop-grid">
        ${row('Min X', p.bounds.minX, 'bounds.minX')}
        ${row('Max X', p.bounds.maxX, 'bounds.maxX')}
        ${row('Min Z', p.bounds.minZ, 'bounds.minZ')}
        ${row('Max Z', p.bounds.maxZ, 'bounds.maxZ')}
        ${row('Høyde', p.height || '', 'height')}
        ${row('Fra Y', p.fromY || 0, 'fromY')}
      </div>`;
      if (p.note) {
        html += `<div style="margin-top:6px;font-size:10px;color:rgba(255,255,255,0.25);font-style:italic">${p.note}</div>`;
      }
    }
  } else if (entity.type === 'furniture') {
    const item = state.placedItems.find(i => String(i.id) === entity.id);
    if (item) {
      const cat = FURNITURE_CATALOG[item.type];
      html += `<div class="prop-grid">
        ${readonlyRow('Type', cat?.name || item.type)}
        ${row('X', item.x.toFixed(2), 'x', 'm', '0.05')}
        ${row('Z', item.z.toFixed(2), 'z', 'm', '0.05')}
        ${row('Rotasjon', item.rotation, 'rotation', '°', '90')}
      </div>`;
    }
  }

  panel.innerHTML = html;

  // Attach change handlers to editable inputs
  panel.querySelectorAll('.prop-value:not(.readonly)').forEach(input => {
    input.addEventListener('change', handlePropertyChange);
  });

  // Attach delete handler
  const deleteBtn = panel.querySelector('.prop-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const type = deleteBtn.dataset.entity;
      const id = deleteBtn.dataset.id;
      pushSnapshot(`Slett ${ENTITY_LABELS[type] || type} ${id}`);
      if (type === 'furniture') {
        const { removeFurniture } = await import('./interaction.js');
        removeFurniture(parseInt(id));
      } else if (type === 'protrusion') {
        const arr = cfg.walls?.protrusions;
        if (arr) {
          const idx = arr.findIndex(p => p.id === id);
          if (idx >= 0) arr.splice(idx, 1);
        }
        if (window.eidos) await window.eidos.rebuild(false);
      }
      renderProperties(null);
    });
  }
}

async function handlePropertyChange(e) {
  if (!state.editMode) return; // Guard: no edits outside edit mode
  const input = e.target;
  const entityType = input.dataset.entity;
  const entityId = input.dataset.id;
  const field = input.dataset.field;
  const value = parseFloat(input.value);
  if (isNaN(value)) return;

  const cfg = state.apartmentConfig;
  pushSnapshot(`Endre ${ENTITY_LABELS[entityType] || entityType} ${entityId} ${field}`);

  if (entityType === 'wall') {
    const wall = cfg.walls?.interior?.find(w => w.id === entityId);
    if (wall) wall[field] = value;
  } else if (entityType === 'window') {
    const win = cfg.windows?.find(w => w.id === entityId);
    if (win) win[field] = value;
  } else if (entityType === 'door') {
    const door = cfg.doors?.find(d => d.id === entityId);
    if (door) door[field] = value;
  } else if (entityType === 'protrusion') {
    const p = cfg.walls?.protrusions?.find(pr => pr.id === entityId);
    if (p) {
      if (field.startsWith('bounds.')) {
        const subField = field.split('.')[1];
        p.bounds[subField] = value;
      } else {
        p[field] = value;
      }
    }
  } else if (entityType === 'furniture') {
    const item = state.placedItems.find(i => String(i.id) === entityId);
    if (item) {
      if (field === 'rotation') {
        const { rotateFurn } = await import('./interaction.js');
        rotateFurn(item.id, value % 360);
        return;
      }
      item[field] = value;
      item.mesh.position.set(item.x, 0, item.z);
      const { saveFurnitureToConfig } = await import('./furniture.js');
      saveFurnitureToConfig();
      renderProperties({ type: entityType, id: entityId });
      return;
    }
  }

  // Rebuild and re-select for architecture changes
  if (entityType !== 'furniture') {
    await window.eidos.rebuild(false);
    // Use eidos API to re-select (avoids circular import)
    window.eidos.selectEntity(entityType, entityId);
  }
}

// Re-export for external calls (e.g. after config loads)
export { populateApartmentInfo, populateCalibration, runSolver };
