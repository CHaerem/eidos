import * as THREE from 'three';
import { state } from './state.js';
import { BOUNDS, ceilAt } from './room.js';
import { solveConstraints, applyToConfig } from './solver.js';
import { showDimensions, showSingleDimension, hideDimensions, toggleMeasureMode, clearControlMeasurements } from './dimensions.js';
import { setRoomFocus, clearRoomFocus } from './room-focus.js';
import { pushSnapshot } from './history.js';

// ─── MODULE-SCOPED STATE ───

let highlightMesh = null;
let activeRoomId = null;

// ─── APARTMENT INFO ───

export function populateApartmentInfo() {
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

// ─── ROOM CALIBRATION (Tikhonov solver) ───

export function populateCalibration() {
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
    if (Math.abs(b.maxX - ob.minX) < tol || Math.abs(b.minX - ob.maxX) < tol ||
        Math.abs(b.maxZ - ob.minZ) < tol || Math.abs(b.minZ - ob.maxZ) < tol) {
      count++;
    }
  }
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
  const simToggle = document.getElementById('simToggle');
  if (simToggle && active) { simToggle.checked = false; simToggle.dispatchEvent(new Event('change')); }
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
    renderCalibrationWizard();
    return;
  }

  const step = calWizard.steps[calWizard.currentStep];
  const room = step.room;
  const b = room.bounds;
  const floorY = step.floor === 6 ? (state.apartmentConfig.upperFloor?.floorY || 2.25) : 0;

  // Show full apartment with room focus
  setRoomFocus(step.roomId, step.floor, null);

  // Position camera
  const midX = (b.minX + b.maxX) / 2;
  const midZ = (b.minZ + b.maxZ) / 2;
  const roomW = b.maxX - b.minX;
  const roomD = b.maxZ - b.minZ;
  const viewDist = Math.max(roomW, roomD) * 1.1;

  if (step.dim === 'width' || step.dim === 'depth') {
    state.camera.position.set(midX - viewDist * 0.3, floorY + viewDist * 1.2, midZ - viewDist * 0.6);
    state.controls.target.set(midX, floorY + 0.8, midZ);
  } else {
    state.camera.position.set(midX + viewDist * 0.8, floorY + 1.5, midZ - viewDist * 0.5);
    state.controls.target.set(midX, floorY + 1.2, midZ);
  }
  state.controls.update();

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
    populateCalibration();
    return;
  }

  const steps = calWizard.steps;
  const current = calWizard.currentStep;
  const entries = state.apartmentConfig?.measurements?.entries || [];
  const measured = entries.length;
  const total = steps.length;
  const pct = total > 0 ? (measured / total) * 100 : 0;

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

  const existing = entries.find(e => e.room === step.roomId && e.dim === step.dim);

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

  const idx = entries.findIndex(e => e.room === roomId && e.dim === dim);

  if (rawVal === '' || isNaN(parseFloat(rawVal))) {
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

export function runSolver() {
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

export function highlightRoom(roomId, floor) {
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
