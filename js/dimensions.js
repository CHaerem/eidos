// ─── DIMENSION LINES ───
// Renders interactive measurement guide lines INSIDE rooms in the 3D viewport.
// Shows exactly where to measure: width, depth, and height with wall endpoints.
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
const clock = new THREE.Clock();

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
  const entries = cfg.measurements?.entries || [];
  const midX = (b.minX + b.maxX) / 2;
  const midZ = (b.minZ + b.maxZ) / 2;
  const guideY = floorY + 1.0; // 1m above floor — tape measure height

  // ─── Width line (along X, INSIDE room at midZ) ───
  const wMeas = entries.find(e => e.room === roomId && e.dim === 'width');
  const compW = b.maxX - b.minX;
  addGuide(
    new THREE.Vector3(b.minX, guideY, midZ),
    new THREE.Vector3(b.maxX, guideY, midZ),
    'x', wMeas ? wMeas.value : compW, !!wMeas, 'width', roomId, floor, compW, floorY
  );

  // ─── Depth line (along Z, INSIDE room at midX) ───
  const dMeas = entries.find(e => e.room === roomId && e.dim === 'depth');
  const compD = b.maxZ - b.minZ;
  addGuide(
    new THREE.Vector3(midX, guideY, b.minZ),
    new THREE.Vector3(midX, guideY, b.maxZ),
    'z', dMeas ? dMeas.value : compD, !!dMeas, 'depth', roomId, floor, compD, floorY
  );

  // ─── Height line(s) — vertical, in center of room ───
  const ct = room.ceilingType || 'flat';

  if (ct === 'slope') {
    // Low height near window wall (minZ + 0.3m inside)
    const zLow = b.minZ + 0.3;
    const hLow = ceilAt(midX, zLow);
    const mHL = entries.find(e => e.room === roomId && e.dim === 'height_low');
    addGuide(
      new THREE.Vector3(midX - 0.4, floorY, zLow),
      new THREE.Vector3(midX - 0.4, mHL ? mHL.value + floorY : hLow, zLow),
      'y', mHL ? mHL.value : (hLow - floorY), !!mHL, 'height_low', roomId, floor, hLow - floorY, floorY
    );
    // High height near back wall (maxZ - 0.3m inside)
    const zHigh = b.maxZ - 0.3;
    const hHigh = ceilAt(midX, zHigh);
    const mHH = entries.find(e => e.room === roomId && e.dim === 'height_high');
    addGuide(
      new THREE.Vector3(midX + 0.4, floorY, zHigh),
      new THREE.Vector3(midX + 0.4, mHH ? mHH.value + floorY : hHigh, zHigh),
      'y', mHH ? mHH.value : (hHigh - floorY), !!mHH, 'height_high', roomId, floor, hHigh - floorY, floorY
    );
  } else {
    const h = ceilAt(midX, midZ);
    const mH = entries.find(e => e.room === roomId && e.dim === 'height');
    addGuide(
      new THREE.Vector3(midX, floorY, midZ),
      new THREE.Vector3(midX, mH ? mH.value + floorY : h, midZ),
      'y', mH ? mH.value : (h - floorY), !!mH, 'height', roomId, floor, h - floorY, floorY
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

  canvas.addEventListener('click', onDimClick);
  // Close floating input on camera move
  if (state.controls) {
    state.controls.addEventListener('start', () => removeFloatingInput());
  }
  clickListenerAdded = true;
}

/** Call from animate loop to pulse unmeasured guides */
export function updateDimensionPulse() {
  if (!dimGroup) return;
  const t = clock.getElapsedTime();
  const pulse = 0.45 + 0.55 * Math.sin(t * 2.5); // oscillate 0.45 → 1.0
  dimGroup.traverse(c => {
    if (c.userData.pulse && c.material) {
      c.material.opacity = pulse;
    }
  });
}

// ─── GUIDE LINE BUILDER ───

function addGuide(p1, p2, axis, value, isMeasured, dim, roomId, floor, computedValue, floorY) {
  const color = isMeasured ? 0x4ade80 : 0x5b8def;

  // Main line — dashed if unmeasured, solid if measured
  if (isMeasured) {
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 999;
    dimGroup.add(line);
  } else {
    const mat = new THREE.LineDashedMaterial({
      color, depthTest: false, transparent: true, opacity: 0.8,
      dashSize: 0.08, gapSize: 0.04
    });
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 999;
    line.userData.pulse = true;
    dimGroup.add(line);
  }

  // Endpoint markers (circles on wall surfaces)
  addEndpoint(p1, axis, isMeasured, color);
  addEndpoint(p2, axis, isMeasured, color);

  // Label sprite at midpoint
  const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
  const text = `${value.toFixed(2)}`;
  const sprite = makeDimLabel(text, isMeasured);
  sprite.position.copy(mid);

  // Offset label toward camera for readability
  if (axis === 'x') sprite.position.z += 0.15;
  else if (axis === 'z') sprite.position.x += 0.15;
  else sprite.position.x += 0.15;

  sprite.renderOrder = 1000;
  if (!isMeasured) sprite.userData.pulse = true;
  dimGroup.add(sprite);

  dimSprites.push({ sprite, dim, roomId, floor, computedValue });
}

function addEndpoint(point, axis, isMeasured, color) {
  // Small circle on the wall face
  const radius = 0.06;
  const segments = 16;
  const geo = new THREE.CircleGeometry(radius, segments);
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, depthTest: false,
    transparent: true, opacity: isMeasured ? 0.9 : 0.7
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(point);
  mesh.renderOrder = 998;

  // Rotate circle to face perpendicular to the measurement axis
  if (axis === 'x') {
    mesh.rotation.y = Math.PI / 2; // face along X
  } else if (axis === 'z') {
    // face along Z (default circle faces +Y, rotate to face +Z)
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = Math.PI / 2;
  } else {
    // height — face horizontally
    mesh.rotation.x = -Math.PI / 2;
  }

  if (!isMeasured) mesh.userData.pulse = true;
  dimGroup.add(mesh);
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
  if (floatingInput) return; // already editing

  // Project all sprites to screen and find closest to click
  const rect = state.renderer.domElement.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  let closest = null;
  let closestDist = 50; // pixel threshold

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
  pushSnapshot(`Kalibrering: ${dimInfo.roomId} ${dimInfo.dim}`);
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
