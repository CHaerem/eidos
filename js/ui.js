import * as THREE from 'three';
import { state } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';
import { BOUNDS } from './room.js';
import { solveConstraints, applyToConfig } from './solver.js';

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

// ─── TAB SWITCHING ───

function initTabs() {
  const tabs = document.querySelectorAll('#panel-tabs .tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      // Update tab active states
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide tab content (display toggle, not DOM removal)
      contents.forEach(c => {
        c.style.display = c.id === `tab-${target}` ? '' : 'none';
      });
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

// ─── INIT UI ───

export function initUI() {
  initTabs();
  initPanelToggle();

  // Populate apartment info and calibration once config is loaded
  if (state.apartmentConfig) {
    populateApartmentInfo();
    populateCalibration();
  } else {
    setTimeout(() => { populateApartmentInfo(); populateCalibration(); }, 500);
  }
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

  let html = '';
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

      html += `
        <div class="room-card" data-room="${room.id}" data-floor="${floor}">
          <div class="room-name">${room.name}<span class="room-floor">${compW} × ${compD}</span></div>
          <div class="room-dims">
            <label>Bredde <input type="number" step="0.01" min="0.5" max="10"
              value="${mW ? mW.value : ''}" placeholder="${compW}"
              data-room="${room.id}" data-floor="${floor}" data-dim="width"> <span class="unit">m</span>
              ${resW !== undefined ? `<span class="residual ${residualClass(resW)}">${(resW * 100).toFixed(1)}cm</span>` : ''}
            </label>
            <label>Dybde <input type="number" step="0.01" min="0.5" max="10"
              value="${mD ? mD.value : ''}" placeholder="${compD}"
              data-room="${room.id}" data-floor="${floor}" data-dim="depth"> <span class="unit">m</span>
              ${resD !== undefined ? `<span class="residual ${residualClass(resD)}">${(resD * 100).toFixed(1)}cm</span>` : ''}
            </label>
          </div>
        </div>`;
    }
  }

  // Wall thickness summary
  if (lastResult && Object.keys(lastResult.wallThicknesses).length > 0) {
    html += '<div class="cal-floor-header">Veggtykkelser</div><div class="wall-thickness-summary">';
    for (const [id, thick] of Object.entries(lastResult.wallThicknesses)) {
      html += `<span class="wall-thick">${id}: ${(thick * 100).toFixed(1)}cm</span>`;
    }
    if (lastResult.rmsResidual > 0) {
      html += `<span class="rms-residual">RMS: ${(lastResult.rmsResidual * 100).toFixed(1)}cm</span>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Event listeners
  container.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      container.querySelectorAll('.room-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
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

function onMeasurementChange(input) {
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
    priors: meas.priors || { wallPositionWeight: 0.1, wallThicknessWeight: 10.0 }
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
}

// Re-export for external calls (e.g. after config loads)
export { populateApartmentInfo, populateCalibration, runSolver };
