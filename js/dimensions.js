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
let guideGroups = [];    // { group, axis, dim, roomId, floor, bounds, floorY, p1, p2 }
let floatingInput = null;
let clickListenerAdded = false;
let dragState = null;    // { guide, startPos, dragPlane }
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ─── PUBLIC API ───

/**
 * Show a SINGLE dimension guide for wizard mode.
 * Only shows one measurement line — the one being calibrated right now.
 */
export function showSingleDimension(roomId, floor, dim) {
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
  const guideY = floorY + 1.0;

  if (dim === 'width') {
    const meas = entries.find(e => e.room === roomId && e.dim === 'width');
    const comp = b.maxX - b.minX;
    addGuide(
      new THREE.Vector3(b.minX, guideY, midZ),
      new THREE.Vector3(b.maxX, guideY, midZ),
      'x', meas ? meas.value : comp, !!meas, 'width', roomId, floor, comp, floorY
    );
  } else if (dim === 'depth') {
    const meas = entries.find(e => e.room === roomId && e.dim === 'depth');
    const comp = b.maxZ - b.minZ;
    addGuide(
      new THREE.Vector3(midX, guideY, b.minZ),
      new THREE.Vector3(midX, guideY, b.maxZ),
      'z', meas ? meas.value : comp, !!meas, 'depth', roomId, floor, comp, floorY
    );
  } else if (dim === 'height') {
    const h = ceilAt(midX, midZ);
    const meas = entries.find(e => e.room === roomId && e.dim === 'height');
    addGuide(
      new THREE.Vector3(midX, floorY, midZ),
      new THREE.Vector3(midX, meas ? meas.value + floorY : h, midZ),
      'y', meas ? meas.value : (h - floorY), !!meas, 'height', roomId, floor, h - floorY, floorY
    );
  } else if (dim === 'height_low') {
    const zLow = b.minZ + 0.3;
    const hLow = ceilAt(midX, zLow);
    const meas = entries.find(e => e.room === roomId && e.dim === 'height_low');
    addGuide(
      new THREE.Vector3(midX - 0.4, floorY, zLow),
      new THREE.Vector3(midX - 0.4, meas ? meas.value + floorY : hLow, zLow),
      'y', meas ? meas.value : (hLow - floorY), !!meas, 'height_low', roomId, floor, hLow - floorY, floorY
    );
  } else if (dim === 'height_high') {
    const zHigh = b.maxZ - 0.3;
    const hHigh = ceilAt(midX, zHigh);
    const meas = entries.find(e => e.room === roomId && e.dim === 'height_high');
    addGuide(
      new THREE.Vector3(midX + 0.4, floorY, zHigh),
      new THREE.Vector3(midX + 0.4, meas ? meas.value + floorY : hHigh, zHigh),
      'y', meas ? meas.value : (hHigh - floorY), !!meas, 'height_high', roomId, floor, hHigh - floorY, floorY
    );
  }

  state.scene.add(dimGroup);
}

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
    'x', wMeas ? wMeas.value : compW, !!wMeas, 'width', roomId, floor, compW, floorY, b
  );

  // ─── Depth line (along Z, INSIDE room at midX) ───
  const dMeas = entries.find(e => e.room === roomId && e.dim === 'depth');
  const compD = b.maxZ - b.minZ;
  addGuide(
    new THREE.Vector3(midX, guideY, b.minZ),
    new THREE.Vector3(midX, guideY, b.maxZ),
    'z', dMeas ? dMeas.value : compD, !!dMeas, 'depth', roomId, floor, compD, floorY, b
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
      'y', mHL ? mHL.value : (hLow - floorY), !!mHL, 'height_low', roomId, floor, hLow - floorY, floorY, b
    );
    // High height near back wall (maxZ - 0.3m inside)
    const zHigh = b.maxZ - 0.3;
    const hHigh = ceilAt(midX, zHigh);
    const mHH = entries.find(e => e.room === roomId && e.dim === 'height_high');
    addGuide(
      new THREE.Vector3(midX + 0.4, floorY, zHigh),
      new THREE.Vector3(midX + 0.4, mHH ? mHH.value + floorY : hHigh, zHigh),
      'y', mHH ? mHH.value : (hHigh - floorY), !!mHH, 'height_high', roomId, floor, hHigh - floorY, floorY, b
    );
  } else {
    const h = ceilAt(midX, midZ);
    const mH = entries.find(e => e.room === roomId && e.dim === 'height');
    addGuide(
      new THREE.Vector3(midX, floorY, midZ),
      new THREE.Vector3(midX, mH ? mH.value + floorY : h, midZ),
      'y', mH ? mH.value : (h - floorY), !!mH, 'height', roomId, floor, h - floorY, floorY, b
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
  guideGroups = [];
  activeRoom = null;
  dragState = null;
}

export function initDimensionClick() {
  if (clickListenerAdded) return;
  const canvas = state.renderer?.domElement;
  if (!canvas) return;

  canvas.addEventListener('click', onDimClick);
  canvas.addEventListener('pointerdown', onGuidePointerDown);
  canvas.addEventListener('pointermove', onGuideDrag);
  canvas.addEventListener('pointerup', onGuidePointerUp);

  // Close floating input on camera move
  if (state.controls) {
    state.controls.addEventListener('start', () => removeFloatingInput());
  }
  clickListenerAdded = true;
}

// ─── DRAG HANDLERS ───

function updateMouseNDC(event) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function hitGuide(event) {
  updateMouseNDC(event);
  raycaster.setFromCamera(mouse, state.camera);

  for (const g of guideGroups) {
    if (!g.group.userData.draggable) continue;
    const hits = raycaster.intersectObjects(g.group.children, true);
    if (hits.length > 0) return g;
  }
  return null;
}

function onGuidePointerDown(event) {
  if (floatingInput) return; // editing mode
  const guide = hitGuide(event);
  if (!guide) return;

  // Create horizontal drag plane at guide Y height
  const guideY = guide.p1.y;
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -guideY);

  // Get initial intersection
  const startPt = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, startPt);

  dragState = { guide, dragPlane, startPt, didDrag: false };

  state.controls.enabled = false;
  state.renderer.domElement.style.cursor = 'grabbing';
  event.preventDefault();
  event.stopPropagation();
}

function onGuideDrag(event) {
  if (!dragState) {
    // Hover cursor
    const guide = hitGuide(event);
    state.renderer.domElement.style.cursor = guide ? 'grab' : '';
    return;
  }

  updateMouseNDC(event);
  raycaster.setFromCamera(mouse, state.camera);

  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragState.dragPlane, pt);
  if (!pt) return;

  const guide = dragState.guide;
  const b = guide.bounds;
  if (!b) return;

  dragState.didDrag = true;

  // Compute delta along the constrained axis
  if (guide.axis === 'x') {
    // Width line: drag along Z, clamped to room bounds
    let newZ = Math.max(b.minZ + 0.15, Math.min(b.maxZ - 0.15, pt.z));
    const delta = newZ - guide.p1.z;
    guide.group.position.z = delta;
  } else if (guide.axis === 'z') {
    // Depth line: drag along X, clamped to room bounds
    let newX = Math.max(b.minX + 0.15, Math.min(b.maxX - 0.15, pt.x));
    const delta = newX - guide.p1.x;
    guide.group.position.x = delta;
  }
}

function onGuidePointerUp(event) {
  if (!dragState) return;

  state.controls.enabled = true;
  state.renderer.domElement.style.cursor = '';

  if (dragState.didDrag) {
    recentDrag = true; // prevent click handler from firing
    // Update the actual p1/p2 positions to reflect the dragged position
    const guide = dragState.guide;
    if (guide.axis === 'x') {
      const newZ = guide.p1.z + guide.group.position.z;
      guide.p1.z = newZ;
      guide.p2.z = newZ;
    } else if (guide.axis === 'z') {
      const newX = guide.p1.x + guide.group.position.x;
      guide.p1.x = newX;
      guide.p2.x = newX;
    }
    // Reset group position (already baked into p1/p2)
    guide.group.position.set(0, 0, 0);
  }

  dragState = null;
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

function addGuide(p1, p2, axis, value, isMeasured, dim, roomId, floor, computedValue, floorY, bounds) {
  // Create a sub-group so we can move the entire guide as one unit
  const guideGrp = new THREE.Group();
  guideGrp.name = `guide-${dim}`;
  guideGrp.userData.draggable = (axis === 'x' || axis === 'z'); // height not draggable

  const color = isMeasured ? 0x4ade80 : 0xffaa22;

  // ─── Thick cylinder beam between endpoints ───
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const length = dir.length();
  const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);

  const beamRadius = 0.018;
  const beamGeo = new THREE.CylinderGeometry(beamRadius, beamRadius, length, 8);
  const beamMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: isMeasured ? 0.9 : 0.75, depthTest: false
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.copy(mid);

  if (axis === 'x') beam.rotation.z = Math.PI / 2;
  else if (axis === 'z') beam.rotation.x = Math.PI / 2;
  beam.renderOrder = 999;
  if (!isMeasured) beam.userData.pulse = true;
  guideGrp.add(beam);

  // ─── Arrow cones at endpoints ───
  addArrowCone(guideGrp, p1, dir.clone().normalize(), isMeasured, color);
  addArrowCone(guideGrp, p2, dir.clone().normalize().negate(), isMeasured, color);

  // ─── Large endpoint discs on wall surfaces ───
  addEndpoint(guideGrp, p1, axis, isMeasured, color);
  addEndpoint(guideGrp, p2, axis, isMeasured, color);

  // ─── Vertical drop lines from beam to floor (for width/depth) ───
  if (axis !== 'y') {
    const dropMat = new THREE.LineDashedMaterial({
      color: 0xffffff, depthTest: false, transparent: true, opacity: 0.15,
      dashSize: 0.05, gapSize: 0.03
    });
    for (const pt of [p1, p2]) {
      const floorPt = pt.clone(); floorPt.y = floorY;
      const geo = new THREE.BufferGeometry().setFromPoints([pt, floorPt]);
      const line = new THREE.Line(geo, dropMat);
      line.computeLineDistances();
      line.renderOrder = 997;
      guideGrp.add(line);
    }
  }

  // ─── Label sprite at midpoint ───
  const text = `${value.toFixed(2)}`;
  const sprite = makeDimLabel(text, isMeasured);
  sprite.position.copy(mid);
  if (axis === 'x') sprite.position.z += 0.25;
  else if (axis === 'z') sprite.position.x += 0.25;
  else sprite.position.x += 0.25;
  sprite.renderOrder = 1000;
  if (!isMeasured) sprite.userData.pulse = true;
  guideGrp.add(sprite);

  dimGroup.add(guideGrp);
  dimSprites.push({ sprite, dim, roomId, floor, computedValue });

  // Store guide info for drag
  guideGroups.push({ group: guideGrp, axis, dim, roomId, floor, bounds, floorY, p1: p1.clone(), p2: p2.clone() });
}

function addArrowCone(parent, point, direction, isMeasured, color) {
  const coneH = 0.08;
  const coneR = 0.04;
  const geo = new THREE.ConeGeometry(coneR, coneH, 8);
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: isMeasured ? 0.9 : 0.8 });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.copy(point).add(direction.clone().multiplyScalar(coneH / 2));
  cone.renderOrder = 999;

  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, direction);
  cone.quaternion.copy(quat);

  if (!isMeasured) cone.userData.pulse = true;
  parent.add(cone);
}

function addEndpoint(parent, point, axis, isMeasured, color) {
  // Large ring on the wall face
  const innerR = 0.06;
  const outerR = 0.12;
  const segments = 24;
  const geo = new THREE.RingGeometry(innerR, outerR, segments);
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, depthTest: false,
    transparent: true, opacity: isMeasured ? 0.85 : 0.7
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(point);
  mesh.renderOrder = 998;

  // Rotate ring to face perpendicular to measurement axis
  if (axis === 'x') {
    mesh.rotation.y = Math.PI / 2;
  } else if (axis === 'z') {
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = Math.PI / 2;
  } else {
    mesh.rotation.x = -Math.PI / 2;
  }

  if (!isMeasured) mesh.userData.pulse = true;
  parent.add(mesh);

  // Center dot
  const dotGeo = new THREE.CircleGeometry(0.03, 16);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.copy(point);
  dot.renderOrder = 999;
  if (axis === 'x') dot.rotation.y = Math.PI / 2;
  else if (axis === 'z') { dot.rotation.x = Math.PI / 2; dot.rotation.z = Math.PI / 2; }
  else dot.rotation.x = -Math.PI / 2;
  parent.add(dot);
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
  const bgColor = isMeasured ? 'rgba(52,180,100,0.92)' : 'rgba(255,170,34,0.92)';
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
  sprite.scale.set(1.4, 0.30, 1);
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

let recentDrag = false;
function onDimClick(event) {
  if (dimSprites.length === 0) return;
  if (floatingInput) return; // already editing
  if (recentDrag) { recentDrag = false; return; } // skip click after drag

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
