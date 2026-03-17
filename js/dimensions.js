// ─── DIMENSION LINES ───
// Renders interactive architectural dimension lines in the 3D viewport.
// Shows width, depth, and height for the selected room.
// Click a label to edit the measurement inline.

import * as THREE from 'three';
import { state } from './state.js';
import { ceilAt } from './room.js';
import { runSolver, populateCalibration } from './ui.js';
import { pushSnapshot } from './history.js';

let dimGroup = null;
let activeRoom = null;   // { roomId, floor }
let dimSprites = [];     // { sprite, dim, roomId, floor, computedValue }
let floatingInput = null;
let clickListenerAdded = false;

// ─── PUBLIC API ───

export function showDimensions(roomId, floor) {
  hideDimensions();

  const cfg = state.apartmentConfig;
  if (!cfg) return;

  const room = findRoom(roomId, floor, cfg);
  if (!room) return;

  activeRoom = { roomId, floor };
  dimGroup = new THREE.Group();
  dimGroup.name = 'dimensions';
  dimSprites = [];

  const b = room.bounds;
  const floorY = (floor === 6 && cfg.upperFloor) ? cfg.upperFloor.floorY : 0;
  const y = floorY + 0.05;
  const entries = cfg.measurements?.entries || [];
  const offset = 0.35;

  // ─── Width line (along X) ───
  const wMeas = entries.find(e => e.room === roomId && e.dim === 'width');
  const compW = b.maxX - b.minX;
  const wVal = wMeas ? wMeas.value : compW;
  addDimLine(
    new THREE.Vector3(b.minX, y, b.maxZ + offset),
    new THREE.Vector3(b.maxX, y, b.maxZ + offset),
    'x', wVal, !!wMeas, 'width', roomId, floor, compW
  );

  // ─── Depth line (along Z) ───
  const dMeas = entries.find(e => e.room === roomId && e.dim === 'depth');
  const compD = b.maxZ - b.minZ;
  const dVal = dMeas ? dMeas.value : compD;
  addDimLine(
    new THREE.Vector3(b.maxX + offset, y, b.minZ),
    new THREE.Vector3(b.maxX + offset, y, b.maxZ),
    'z', dVal, !!dMeas, 'depth', roomId, floor, compD
  );

  // ─── Height line(s) ───
  const ct = room.ceilingType || 'flat';
  const cx = (b.minX + b.maxX) / 2;

  if (ct === 'slope') {
    // Low height at window side (minZ)
    const hLow = ceilAt(cx, b.minZ);
    const mHL = entries.find(e => e.room === roomId && e.dim === 'height_low');
    addDimLine(
      new THREE.Vector3(b.minX - offset, floorY, b.minZ),
      new THREE.Vector3(b.minX - offset, mHL ? mHL.value : hLow, b.minZ),
      'y', mHL ? mHL.value : hLow, !!mHL, 'height_low', roomId, floor, hLow
    );
    // High height at back wall (maxZ)
    const hHigh = ceilAt(cx, b.maxZ);
    const mHH = entries.find(e => e.room === roomId && e.dim === 'height_high');
    addDimLine(
      new THREE.Vector3(b.minX - offset, floorY, b.maxZ),
      new THREE.Vector3(b.minX - offset, mHH ? mHH.value : hHigh, b.maxZ),
      'y', mHH ? mHH.value : hHigh, !!mHH, 'height_high', roomId, floor, hHigh
    );
  } else {
    const cz = (b.minZ + b.maxZ) / 2;
    const h = ceilAt(cx, cz);
    const mH = entries.find(e => e.room === roomId && e.dim === 'height');
    addDimLine(
      new THREE.Vector3(b.minX - offset, floorY, b.maxZ + offset),
      new THREE.Vector3(b.minX - offset, mH ? mH.value : h, b.maxZ + offset),
      'y', mH ? mH.value : h, !!mH, 'height', roomId, floor, h
    );
  }

  state.scene.add(dimGroup);
}

export function hideDimensions() {
  removeFloatingInput();
  if (dimGroup) {
    dimGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    });
    state.scene.remove(dimGroup);
    dimGroup = null;
  }
  dimSprites = [];
  activeRoom = null;
}

export function initDimensionClick() {
  if (clickListenerAdded) return;
  const canvas = state.renderer?.domElement;
  if (!canvas) return;

  canvas.addEventListener('dblclick', onDimClick);
  // Close floating input on camera move
  if (state.controls) {
    state.controls.addEventListener('start', () => removeFloatingInput());
  }
  clickListenerAdded = true;
}

// ─── DIMENSION LINE BUILDER ───

function addDimLine(p1, p2, axis, value, isMeasured, dim, roomId, floor, computedValue) {
  const lineColor = isMeasured ? 0x4ade80 : 0x5b8def;
  const lineMat = new THREE.LineBasicMaterial({ color: lineColor, depthTest: false });

  // Main dimension line
  const mainGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const mainLine = new THREE.Line(mainGeo, lineMat);
  mainLine.renderOrder = 999;
  dimGroup.add(mainLine);

  // Extension ticks at endpoints
  const tickLen = 0.08;
  addTick(p1, axis, tickLen, lineMat);
  addTick(p2, axis, tickLen, lineMat);

  // Label sprite at midpoint
  const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
  const text = `${value.toFixed(2)}`;
  const sprite = makeDimLabel(text, isMeasured);
  sprite.position.copy(mid);

  // Offset label slightly toward camera for readability
  if (axis === 'x') sprite.position.z += 0.12;
  else if (axis === 'z') sprite.position.x += 0.12;
  else sprite.position.z += 0.12;

  sprite.renderOrder = 1000;
  dimGroup.add(sprite);

  dimSprites.push({ sprite, dim, roomId, floor, computedValue });
}

function addTick(point, axis, len, material) {
  let dir;
  if (axis === 'x') dir = new THREE.Vector3(0, 0, 1);
  else if (axis === 'z') dir = new THREE.Vector3(1, 0, 0);
  else dir = new THREE.Vector3(0, 0, 1); // height ticks horizontal

  const a = point.clone().add(dir.clone().multiplyScalar(-len / 2));
  const b = point.clone().add(dir.clone().multiplyScalar(len / 2));
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, material);
  line.renderOrder = 999;
  dimGroup.add(line);
}

// ─── LABEL SPRITE ───

function makeDimLabel(text, isMeasured) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');

  // Background pill with shadow
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  const bgColor = isMeasured ? 'rgba(52,180,100,0.92)' : 'rgba(70,120,220,0.88)';
  ctx.fillStyle = bgColor;
  roundRect(ctx, 12, 8, 360, 64, 16);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Value text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 34px SF Mono, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text + ' m', 192, 42);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.0, 0.22, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── CLICK-TO-EDIT ───

function onDimClick(event) {
  if (dimSprites.length === 0) return;

  // Project all sprites to screen and find closest to click
  const rect = state.renderer.domElement.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  let closest = null;
  let closestDist = 40; // pixel threshold

  for (const d of dimSprites) {
    const screen = spriteToScreen(d.sprite);
    const dx = screen.x - clickX;
    const dy = screen.y - clickY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = d;
    }
  }

  if (!closest) return;
  event.stopPropagation();
  showFloatingInput(closest);
}

function spriteToScreen(sprite) {
  const pos = new THREE.Vector3();
  sprite.getWorldPosition(pos);
  pos.project(state.camera);
  const el = state.renderer.domElement;
  return {
    x: (pos.x * 0.5 + 0.5) * el.clientWidth,
    y: (-pos.y * 0.5 + 0.5) * el.clientHeight
  };
}

function showFloatingInput(dimInfo) {
  removeFloatingInput();

  const screen = spriteToScreen(dimInfo.sprite);
  const rect = state.renderer.domElement.getBoundingClientRect();

  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.className = 'dim-floating-input';
  input.style.left = `${rect.left + screen.x}px`;
  input.style.top = `${rect.top + screen.y}px`;

  // Pre-fill with current measurement or empty
  const entries = state.apartmentConfig?.measurements?.entries || [];
  const existing = entries.find(e => e.room === dimInfo.roomId && e.dim === dimInfo.dim);
  input.value = existing ? existing.value : '';
  input.placeholder = dimInfo.computedValue.toFixed(2);

  document.body.appendChild(input);
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitInput(dimInfo, input.value);
      removeFloatingInput();
    } else if (e.key === 'Escape') {
      removeFloatingInput();
    }
  });

  input.addEventListener('blur', () => {
    // Small delay to allow Enter to fire first
    setTimeout(() => {
      if (floatingInput === input) {
        commitInput(dimInfo, input.value);
        removeFloatingInput();
      }
    }, 100);
  });

  floatingInput = input;
}

function commitInput(dimInfo, rawVal) {
  pushSnapshot();
  const cfg = state.apartmentConfig;
  if (!cfg.measurements) {
    cfg.measurements = { defaultWallThickness: 0.08, priors: { wallPositionWeight: 0.1, wallThicknessWeight: 10.0, heightWeight: 1.0 }, entries: [] };
  }
  const entries = cfg.measurements.entries;
  const idx = entries.findIndex(e => e.room === dimInfo.roomId && e.dim === dimInfo.dim);
  const val = parseFloat(rawVal);

  if (rawVal === '' || isNaN(val) || val < 0.1) {
    if (idx >= 0) entries.splice(idx, 1);
  } else {
    if (idx >= 0) entries[idx].value = val;
    else entries.push({ room: dimInfo.roomId, dim: dimInfo.dim, value: val });
  }

  runSolver();
  if (window.eidos) {
    window.eidos.rebuild().then(() => {
      populateCalibration();
      showDimensions(dimInfo.roomId, dimInfo.floor);
    });
  }
}

function removeFloatingInput() {
  if (floatingInput) {
    floatingInput.remove();
    floatingInput = null;
  }
}

// ─── HELPERS ───

function findRoom(roomId, floor, cfg) {
  if (floor === 6 && cfg.upperFloor && cfg.upperFloor.rooms) {
    const r = cfg.upperFloor.rooms.find(r => r.id === roomId);
    if (r) return r;
  }
  return (cfg.rooms || []).find(r => r.id === roomId);
}
