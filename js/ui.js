import * as THREE from 'three';
import { state } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';
import { BOUNDS, ceilAt } from './room.js';
import { solveConstraints, applyToConfig } from './solver.js';
import { showDimensions, showSingleDimension, hideDimensions } from './dimensions.js';
import { setRoomFocus, clearRoomFocus } from './room-focus.js';
import { pushSnapshot, getEntries, getPointer, getFullEntries, jumpTo, setHistoryChangeListener } from './history.js';
import { showHistoryDiff, clearHistoryDiff, computeDiff, getDiffSummary } from './history-diff.js';

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

// ─── APARTMENT INFO ───

function populateApartmentInfo() {
  const el = document.getElementById('apartment-info');
  if (!el) return;

  const cfg = state.apartmentConfig;
  if (!cfg) {
    el.innerHTML = '<span class="lbl">Ingen config lastet</span>';
    return;
  }

  const b = cfg.bounds || {};
  const width = ((b.maxX || 0) - (b.minX || 0)).toFixed(1);
  const depth = ((b.maxZ || 0) - (b.minZ || 0)).toFixed(1);
  const roomCount = (cfg.rooms || []).length;
  const upperRoomCount = (cfg.upperFloor && cfg.upperFloor.rooms || []).length;
  const totalRooms = roomCount + upperRoomCount;
  const floors = cfg.upperFloor ? '2' : '1';

  el.innerHTML = `
    <span class="lbl">Navn:</span><span class="val">${cfg.name || '—'}</span>
    <span class="lbl">Bredde:</span><span class="val">${width} m</span>
    <span class="lbl">Dybde:</span><span class="val">${depth} m</span>
    <span class="lbl">Etasjer:</span><span class="val">${floors}</span>
    <span class="lbl">Rom:</span><span class="val">${totalRooms}</span>
  `;
}

// ─── VIEW BUTTON ACTIVE STATE ───

function initViewButtons() {
  document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ─── PANEL COLLAPSE / EXPAND ───

function initPanelToggle() {
  const panel = document.getElementById('panel');
  const collapseBtn = document.getElementById('panel-collapse');
  const toggleBtn = document.getElementById('panel-toggle');

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      panel.classList.add('collapsed');
      if (toggleBtn) toggleBtn.style.display = 'flex';
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      panel.classList.remove('collapsed');
      toggleBtn.style.display = 'none';
    });
  }
}

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
  if (entries.length === 0) {
    container.innerHTML = '<div class="history-empty">Ingen endringer ennå</div>';
    return;
  }

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
  const section = document.getElementById('history-section');
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

  // Wall room pills (generated dynamically)
  populateWallRoomPills();
}

function populateWallRoomPills() {
  const container = document.getElementById('wall-room-pills');
  if (!container) return;
  const cfg = state.apartmentConfig;
  if (!cfg) return;

  const rooms = [];
  for (const r of (cfg.rooms || [])) rooms.push(r);
  if (cfg.upperFloor?.rooms) {
    for (const r of cfg.upperFloor.rooms) {
      if (r.id === 'terrasse') continue; // skip terrace (no walls)
      rooms.push(r);
    }
  }

  container.innerHTML = '';
  for (const room of rooms) {
    const pill = document.createElement('span');
    pill.className = 'vis-pill on';
    pill.dataset.room = room.id;
    pill.textContent = room.name;
    // Click: toggle wall visibility
    pill.addEventListener('click', () => {
      pill.classList.toggle('on');
      toggleRoomWalls(room.id, room.bounds, pill.classList.contains('on'));
    });
    // Double-click: fly to room
    pill.addEventListener('dblclick', () => {
      if (window.flyToRoom && room.bounds) {
        const floor = (cfg.upperFloor?.rooms || []).some(r => r.id === room.id) ? 6 : 5;
        const y = floor === 6 ? (cfg.upperFloor?.floorY || 2.25) : 0;
        window.flyToRoom(room.bounds, y);
        setRoomFocus(room.id, floor, null);
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
  initPanelToggle();
  initCollapsible();
  initVisibilityToggles();
  initHistoryPanel();

  // Populate apartment info, calibration, and room pills once config is loaded
  if (state.apartmentConfig) {
    populateApartmentInfo();
    populateCalibration();
    populateWallRoomPills();
  } else {
    setTimeout(() => { populateApartmentInfo(); populateCalibration(); populateWallRoomPills(); }, 500);
  }
}

function initCollapsible() {
  document.querySelectorAll('.panel-section.collapsible h3').forEach(h3 => {
    h3.addEventListener('click', () => {
      h3.parentElement.classList.toggle('open');
    });
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

const ROOM_ORDER = [
  { id: 'stue', floor: 5 },
  { id: 'kjokken', floor: 5 },
  { id: 'bad', floor: 5 },
  { id: 'entre', floor: 5 },
  { id: 'garderobe', floor: 5 },
  { id: 'soverom', floor: 6 },
  { id: 'hems', floor: 6 },
];

function buildCalibrationSteps(cfg) {
  const steps = [];
  for (const { id, floor } of ROOM_ORDER) {
    const allRooms = [...(cfg.rooms || []), ...(cfg.upperFloor?.rooms || [])];
    const room = allRooms.find(r => r.id === id);
    if (!room) continue;

    const dims = (room.ceilingType === 'slope')
      ? ['width', 'depth', 'height_low', 'height_high']
      : ['width', 'depth', 'height'];

    for (const dim of dims) {
      steps.push({ roomId: id, floor, dim, roomName: room.name || id, room });
    }
  }
  return steps;
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

  renderCalibrationWizard();
  navigateToStep();
}

function exitCalibration() {
  calWizard = null;
  hideDimensions();
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

  // Fly to room
  if (window.flyToRoom && room.bounds) {
    const y = step.floor === 6 ? (state.apartmentConfig.upperFloor?.floorY || 2.25) : 0;
    window.flyToRoom(room.bounds, y);
    setRoomFocus(step.roomId, step.floor, null);
  }

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
      window.eidos.rebuild().then(() => {
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
      <div class="cal-progress">
        <div class="cal-progress-bar"><div class="cal-progress-fill" style="width:${pct}%"></div></div>
        <div class="cal-progress-text">${measured}/${total}</div>
      </div>
      <div class="cal-wizard-header">
        <span class="cal-wizard-room">${step.roomName}</span>
        <span class="cal-wizard-dim">${dimLabel}</span>
      </div>
      <div class="cal-wizard-instruction">${instruction}</div>
      <div class="cal-wizard-input-row">
        <input type="number" id="cal-wizard-input" step="0.01" min="0.1"
          value="${existing ? existing.value : ''}"
          placeholder="mål i meter" autofocus>
        <span class="cal-wizard-unit">m</span>
        <button class="cal-wizard-btn primary" onclick="window._advanceCalibration()">Lagre →</button>
      </div>
      <div class="cal-wizard-actions">
        <button class="cal-wizard-btn skip" onclick="window._skipStep()">Hopp over</button>
        <button class="cal-wizard-btn exit" onclick="window._exitCalibration()">Avslutt</button>
      </div>
      <div class="cal-room-dots">${dotsHtml}</div>
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

  // Rebuild and refresh
  if (window.eidos) {
    window.eidos.rebuild().then(() => {
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

// Re-export for external calls (e.g. after config loads)
export { populateApartmentInfo, populateCalibration, runSolver };
