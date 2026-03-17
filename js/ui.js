import * as THREE from 'three';
import { state } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';
import { BOUNDS } from './room.js';

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

// ─── ROOM CALIBRATION ───

let highlightMesh = null;
let activeRoomId = null;

function populateCalibration() {
  const container = document.getElementById('room-calibration');
  if (!container) return;

  const cfg = state.apartmentConfig;
  if (!cfg || !cfg.rooms) { container.innerHTML = ''; return; }

  const allRooms = [];
  // 5th floor rooms
  for (const r of cfg.rooms) {
    allRooms.push({ ...r, floor: r.floor || 5 });
  }
  // 6th floor rooms
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

  let html = '';
  for (const [floor, rooms] of Object.entries(floors).sort()) {
    html += `<div class="cal-floor-header">${floor}. etasje</div>`;
    for (const room of rooms) {
      const b = room.bounds;
      const w = (b.maxX - b.minX);
      const d = (b.maxZ - b.minZ);
      html += `
        <div class="room-card" data-room="${room.id}" data-floor="${floor}">
          <div class="room-name">${room.name}<span class="room-floor">${w.toFixed(2)} × ${d.toFixed(2)}</span></div>
          <div class="room-dims">
            <label>Bredde <input type="number" step="0.01" min="0.5" max="10" value="${w.toFixed(2)}" data-room="${room.id}" data-floor="${floor}" data-dim="width"> <span class="unit">m</span></label>
            <label>Dybde <input type="number" step="0.01" min="0.5" max="10" value="${d.toFixed(2)}" data-room="${room.id}" data-floor="${floor}" data-dim="depth"> <span class="unit">m</span></label>
          </div>
        </div>`;
    }
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
    input.addEventListener('change', () => applyRoomMeasurement(input));
  });
}

function highlightRoom(roomId, floor) {
  // Remove old highlight
  if (highlightMesh) {
    // Dispose children (fill plane)
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

  // Find room bounds
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

  // Outline edges instead of filled plane — visible over OBJ
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

  // Also add a subtle fill
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

function findRoom(roomId, floor) {
  const cfg = state.apartmentConfig;
  if (floor === 6 && cfg.upperFloor && cfg.upperFloor.rooms) {
    const r = cfg.upperFloor.rooms.find(r => r.id === roomId);
    if (r) return r;
  }
  return (cfg.rooms || []).find(r => r.id === roomId);
}

function applyRoomMeasurement(input) {
  const roomId = input.dataset.room;
  const floor = parseInt(input.dataset.floor);
  const dim = input.dataset.dim;
  const newValue = parseFloat(input.value);
  if (isNaN(newValue) || newValue < 0.1) return;

  const cfg = state.apartmentConfig;
  const room = findRoom(roomId, floor);
  if (!room) return;

  const b = room.bounds;
  const ext = cfg.walls.exterior;

  if (dim === 'width') {
    const oldWidth = b.maxX - b.minX;
    const diff = newValue - oldWidth;
    if (Math.abs(diff) < 0.001) return;

    // Anchor exterior wall, move interior wall
    if (Math.abs(b.minX - ext.minX) < 0.01) {
      // Left wall is exterior → move right (maxX)
      const oldMaxX = b.maxX;
      const newMaxX = b.minX + newValue;
      b.maxX = newMaxX;
      propagateWallChange('maxX', oldMaxX, newMaxX, roomId, floor, cfg);
    } else if (Math.abs(b.maxX - ext.maxX) < 0.01) {
      // Right wall is exterior → move left (minX)
      const oldMinX = b.minX;
      const newMinX = b.maxX - newValue;
      b.minX = newMinX;
      propagateWallChange('minX', oldMinX, newMinX, roomId, floor, cfg);
    } else {
      // Neither wall is exterior — anchor minX (left), move maxX
      const oldMaxX = b.maxX;
      b.maxX = b.minX + newValue;
      propagateWallChange('maxX', oldMaxX, b.maxX, roomId, floor, cfg);
    }
  } else {
    const oldDepth = b.maxZ - b.minZ;
    const diff = newValue - oldDepth;
    if (Math.abs(diff) < 0.001) return;

    if (Math.abs(b.minZ - ext.minZ) < 0.01) {
      // South wall is exterior → move north (maxZ)
      const oldMaxZ = b.maxZ;
      b.maxZ = b.minZ + newValue;
      propagateWallChange('maxZ', oldMaxZ, b.maxZ, roomId, floor, cfg);
    } else if (Math.abs(b.maxZ - ext.maxZ) < 0.01) {
      // North wall is exterior → move south (minZ)
      const oldMinZ = b.minZ;
      b.minZ = b.maxZ - newValue;
      propagateWallChange('minZ', oldMinZ, b.minZ, roomId, floor, cfg);
    } else {
      // Neither wall is exterior — anchor maxZ (north), move minZ
      const oldMinZ = b.minZ;
      b.minZ = b.maxZ - newValue;
      propagateWallChange('minZ', oldMinZ, b.minZ, roomId, floor, cfg);
    }
  }

  // Update interior walls to match new positions
  syncInteriorWalls(cfg);

  // Rebuild and refresh UI
  if (window.eidos) {
    window.eidos.rebuild().then(() => {
      populateCalibration();
      populateApartmentInfo();
      highlightRoom(roomId, floor);
      // Re-activate the card
      const container = document.getElementById('room-calibration');
      const card = container.querySelector(`[data-room="${roomId}"][data-floor="${floor}"]`);
      if (card) card.classList.add('active');
    });
  }
}

function propagateWallChange(edge, oldVal, newVal, sourceRoomId, floor, cfg) {
  const tolerance = 0.06;
  const allRooms = [...(cfg.rooms || [])];
  if (cfg.upperFloor && cfg.upperFloor.rooms) {
    allRooms.push(...cfg.upperFloor.rooms);
  }

  // Update rooms sharing the same wall edge
  for (const r of allRooms) {
    if (r.id === sourceRoomId) continue;
    const b = r.bounds;
    if (edge === 'maxX' || edge === 'minX') {
      if (Math.abs(b.minX - oldVal) < tolerance) b.minX = newVal;
      if (Math.abs(b.maxX - oldVal) < tolerance) b.maxX = newVal;
    } else {
      if (Math.abs(b.minZ - oldVal) < tolerance) b.minZ = newVal;
      if (Math.abs(b.maxZ - oldVal) < tolerance) b.maxZ = newVal;
    }
  }

  // Also update ceiling zones
  if (cfg.ceiling && cfg.ceiling.zones) {
    for (const z of cfg.ceiling.zones) {
      if (!z.bounds) continue;
      if (edge === 'maxX' || edge === 'minX') {
        if (Math.abs(z.bounds.minX - oldVal) < tolerance) z.bounds.minX = newVal;
        if (Math.abs(z.bounds.maxX - oldVal) < tolerance) z.bounds.maxX = newVal;
      } else {
        if (Math.abs(z.bounds.minZ - oldVal) < tolerance) z.bounds.minZ = newVal;
        if (Math.abs(z.bounds.maxZ - oldVal) < tolerance) z.bounds.maxZ = newVal;
      }
    }
  }

  // Update upperFloor areas
  if (cfg.upperFloor && cfg.upperFloor.areas) {
    for (const a of cfg.upperFloor.areas) {
      if (!a.bounds) continue;
      if (edge === 'maxX' || edge === 'minX') {
        if (Math.abs(a.bounds.minX - oldVal) < tolerance) a.bounds.minX = newVal;
        if (Math.abs(a.bounds.maxX - oldVal) < tolerance) a.bounds.maxX = newVal;
      } else {
        if (Math.abs(a.bounds.minZ - oldVal) < tolerance) a.bounds.minZ = newVal;
        if (Math.abs(a.bounds.maxZ - oldVal) < tolerance) a.bounds.maxZ = newVal;
      }
    }
  }
}

function syncInteriorWalls(cfg) {
  // Rebuild interior wall positions from room bounds
  const walls = cfg.walls.interior;
  if (!walls) return;

  for (const w of walls) {
    // Find rooms adjacent to this wall
    const rooms = cfg.rooms || [];
    if (w.axis === 'x') {
      // Vertical wall — find rooms whose minX or maxX match w.pos
      for (const r of rooms) {
        if (Math.abs(r.bounds.maxX - w.pos) < 0.06) {
          w.pos = r.bounds.maxX;
          break;
        }
        if (Math.abs(r.bounds.minX - w.pos) < 0.06) {
          w.pos = r.bounds.minX;
          break;
        }
      }
    } else {
      // Horizontal wall — find rooms whose minZ or maxZ match w.pos
      for (const r of rooms) {
        if (Math.abs(r.bounds.maxZ - w.pos) < 0.06) {
          w.pos = r.bounds.maxZ;
          break;
        }
        if (Math.abs(r.bounds.minZ - w.pos) < 0.06) {
          w.pos = r.bounds.minZ;
          break;
        }
      }
    }
  }
}

// Re-export for external calls (e.g. after config loads)
export { populateApartmentInfo, populateCalibration };
