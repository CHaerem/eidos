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
let guideGroups = [];    // { group, axis, dim, roomId, floor, bounds, floorY, p1, p2, highlightMeshes, hitBox }
let hitBoxes = [];       // flat array of all hitBox meshes (for fast raycast)
let pulseObjects = [];   // flat array of meshes with pulse animation
let floatingInput = null;
let clickListenerAdded = false;
let _cleanupFns = [];
let dragState = null;    // { guide, startPos, dragPlane }
let isDragging = false;
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
      'x', meas ? meas.value : comp, !!meas, 'width', roomId, floor, comp, floorY, b
    );
  } else if (dim === 'depth') {
    const meas = entries.find(e => e.room === roomId && e.dim === 'depth');
    const comp = b.maxZ - b.minZ;
    addGuide(
      new THREE.Vector3(midX, guideY, b.minZ),
      new THREE.Vector3(midX, guideY, b.maxZ),
      'z', meas ? meas.value : comp, !!meas, 'depth', roomId, floor, comp, floorY, b
    );
  } else if (dim === 'height') {
    const h = ceilAt(midX, midZ);
    const meas = entries.find(e => e.room === roomId && e.dim === 'height');
    addGuide(
      new THREE.Vector3(midX, floorY, midZ),
      new THREE.Vector3(midX, meas ? meas.value + floorY : h, midZ),
      'y', meas ? meas.value : (h - floorY), !!meas, 'height', roomId, floor, h - floorY, floorY, b
    );
  } else if (dim === 'height_low') {
    const zLow = b.minZ + 0.3;
    const hLow = ceilAt(midX, zLow);
    const meas = entries.find(e => e.room === roomId && e.dim === 'height_low');
    addGuide(
      new THREE.Vector3(midX - 0.4, floorY, zLow),
      new THREE.Vector3(midX - 0.4, meas ? meas.value + floorY : hLow, zLow),
      'y', meas ? meas.value : (hLow - floorY), !!meas, 'height_low', roomId, floor, hLow - floorY, floorY, b
    );
  } else if (dim === 'height_high') {
    const zHigh = b.maxZ - 0.3;
    const hHigh = ceilAt(midX, zHigh);
    const meas = entries.find(e => e.room === roomId && e.dim === 'height_high');
    addGuide(
      new THREE.Vector3(midX + 0.4, floorY, zHigh),
      new THREE.Vector3(midX + 0.4, meas ? meas.value + floorY : hHigh, zHigh),
      'y', meas ? meas.value : (hHigh - floorY), !!meas, 'height_high', roomId, floor, hHigh - floorY, floorY, b
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
  hitBoxes = [];
  pulseObjects = [];
  activeRoom = null;
  dragState = null;
  isDragging = false;
  hoveredGuide = null;
}

export function initDimensionClick() {
  if (clickListenerAdded) return;
  const canvas = state.renderer?.domElement;
  if (!canvas) return;

  canvas.addEventListener('click', onDimClick);
  // Shift+click for seamless wall-to-wall / point-to-point measurements
  canvas.addEventListener('click', onShiftClickMeasure);
  // Shift+right-click to clear measurements
  canvas.addEventListener('contextmenu', (e) => {
    if (e.shiftKey && (selectedWall1 || selectedWall2 || measureFirstPoint)) {
      e.preventDefault();
      clearControlMeasurements();
    }
  });
  // Long-press for touch measurement (replaces shift+click on touch devices)
  let longPressTimer = null;
  let longPressPos = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    longPressPos = { x: e.clientX, y: e.clientY };
    longPressTimer = setTimeout(() => {
      // Simulate shift+click for measurement
      const fakeEvent = { shiftKey: true, clientX: longPressPos.x, clientY: longPressPos.y, target: canvas };
      fakeEvent.closest = () => null;
      onShiftClickMeasure(fakeEvent);
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(30);
      longPressTimer = null;
    }, 500);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!longPressTimer || !longPressPos) return;
    const dx = e.clientX - longPressPos.x;
    const dy = e.clientY - longPressPos.y;
    if (dx * dx + dy * dy > 100) { // moved > 10px
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  });
  // CAPTURE phase — fires BEFORE OrbitControls can setPointerCapture
  canvas.addEventListener('pointerdown', onGuidePointerDown, true);
  // Use document-level listeners for move/up to catch events even when pointer leaves canvas
  document.addEventListener('pointermove', onGuideDrag);
  document.addEventListener('pointerup', onGuidePointerUp);
  // Invalidate rect cache on resize
  window.addEventListener('resize', () => { cachedRect = null; });
  // Measure mode hover preview
  canvas.addEventListener('pointermove', onMeasureHover);

  // Close floating input on camera move
  if (state.controls) {
    state.controls.addEventListener('start', () => removeFloatingInput());
  }
  _cleanupFns.push(
    () => canvas.removeEventListener('click', onDimClick),
    () => canvas.removeEventListener('click', onShiftClickMeasure),
    () => canvas.removeEventListener('pointerdown', onGuidePointerDown, true),
    () => document.removeEventListener('pointermove', onGuideDrag),
    () => document.removeEventListener('pointerup', onGuidePointerUp),
    () => canvas.removeEventListener('pointermove', onMeasureHover),
  );
  clickListenerAdded = true;
}

export function cleanupDimensionListeners() {
  for (const fn of _cleanupFns) fn();
  _cleanupFns = [];
  clickListenerAdded = false;
}

// ─── DRAG HANDLERS ───

// Cache canvas rect to avoid layout thrash on every pointermove
let cachedRect = null;
let rectCacheFrame = -1;

function updateMouseNDC(event) {
  const frame = state.renderer?.info?.render?.frame || 0;
  if (!cachedRect || frame !== rectCacheFrame) {
    cachedRect = state.renderer.domElement.getBoundingClientRect();
    rectCacheFrame = frame;
  }
  mouse.x = ((event.clientX - cachedRect.left) / cachedRect.width) * 2 - 1;
  mouse.y = -((event.clientY - cachedRect.top) / cachedRect.height) * 2 + 1;
}

function hitGuide(event) {
  if (hitBoxes.length === 0) return null;
  updateMouseNDC(event);
  raycaster.setFromCamera(mouse, state.camera);

  // Raycast only against hitBox meshes (1 per guide) instead of all children
  const hits = raycaster.intersectObjects(hitBoxes, false);
  if (hits.length === 0) return null;
  const idx = hits[0].object.userData.guideIndex;
  return guideGroups[idx] || null;
}

function onGuidePointerDown(event) {
  if (floatingInput) return;
  const guide = hitGuide(event);
  if (!guide) return;

  // Create horizontal drag plane at guide Y height
  const guideY = guide.p1.y;
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -guideY);

  // Get initial intersection
  const startPt = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, startPt);

  dragState = { guide, dragPlane, startPt, didDrag: false };
  isDragging = true;
  setGuideVisualState(guide, 'dragging');

  // CRITICAL: Stop event from reaching OrbitControls entirely
  state.controls.enabled = false;
  state.renderer.domElement.style.cursor = 'grabbing';
  event.preventDefault();
  event.stopImmediatePropagation();
}

let hoveredGuide = null;

// ─── VISUAL STATE: idle / hover / dragging ───

const HOVER_BRIGHTEN = 0x333333;  // added to base color
const SNAP_THRESHOLD = 0.08;      // 8cm snap to midpoint

function setGuideVisualState(guide, visualState) {
  if (!guide?.highlightMeshes) return;
  for (const m of guide.highlightMeshes) {
    const orig = m.userData.originalColor;
    if (!orig) continue;
    if (visualState === 'idle') {
      m.material.color.copy(orig);
      guide.group.scale.setScalar(1.0);
    } else if (visualState === 'hover') {
      m.material.color.copy(orig).offsetHSL(0, 0, 0.15); // brighter
      guide.group.scale.setScalar(1.15);
    } else if (visualState === 'dragging') {
      m.material.color.copy(orig).offsetHSL(0, -0.1, 0.25); // even brighter
      guide.group.scale.setScalar(1.2);
    }
  }
}

// Throttle hover raycast to max ~30fps (33ms)
let lastHoverTime = 0;

function onGuideDrag(event) {
  if (!dragState) {
    // Only handle hover when moving over the canvas
    if (event.target !== state.renderer?.domElement) return;
    // Throttle hover raycasting to avoid jank
    const now = performance.now();
    if (now - lastHoverTime < 33) return;
    lastHoverTime = now;

    const guide = hitGuide(event);
    if (guide !== hoveredGuide) {
      if (hoveredGuide) setGuideVisualState(hoveredGuide, 'idle');
      if (guide) setGuideVisualState(guide, 'hover');
      hoveredGuide = guide;
    }
    state.renderer.domElement.style.cursor = guide ? 'grab' : '';
    return;
  }

  // ─── DRAG: lightweight plane intersection, no raycast against scene ───
  updateMouseNDC(event);
  raycaster.setFromCamera(mouse, state.camera);

  const pt = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(dragState.dragPlane, pt)) return;

  const guide = dragState.guide;
  const b = guide.bounds;
  if (!b) return;

  dragState.didDrag = true;

  // Move guide along constrained axis with midpoint snap
  if (guide.axis === 'x') {
    const midZ = (b.minZ + b.maxZ) / 2;
    let newZ = Math.max(b.minZ + 0.15, Math.min(b.maxZ - 0.15, pt.z));
    if (Math.abs(newZ - midZ) < SNAP_THRESHOLD) newZ = midZ;
    guide.group.position.z = newZ - guide.p1.z;
  } else if (guide.axis === 'z') {
    const midX = (b.minX + b.maxX) / 2;
    let newX = Math.max(b.minX + 0.15, Math.min(b.maxX - 0.15, pt.x));
    if (Math.abs(newX - midX) < SNAP_THRESHOLD) newX = midX;
    guide.group.position.x = newX - guide.p1.x;
  }
}

function onGuidePointerUp(event) {
  if (!dragState) return;

  const guide = dragState.guide;
  isDragging = false;
  setGuideVisualState(guide, 'idle');

  state.controls.enabled = true;
  state.renderer.domElement.style.cursor = '';

  if (dragState.didDrag) {
    recentDrag = true;
    // Bake the group offset into p1/p2 (for future drags) but keep group position
    if (guide.axis === 'x') {
      const newZ = guide.p1.z + guide.group.position.z;
      guide.p1.z = newZ;
      guide.p2.z = newZ;
    } else if (guide.axis === 'z') {
      const newX = guide.p1.x + guide.group.position.x;
      guide.p1.x = newX;
      guide.p2.x = newX;
    }
  }

  dragState = null;
}

/** Call from animate loop — steady glow for unmeasured guides (no blinking) */
export function updateDimensionPulse() {
  // No-op now — unmeasured guides have constant opacity set at creation time
  // Kept for API compatibility with scene.js animate loop
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
  beam.userData.originalColor = beamMat.color.clone();
  if (!isMeasured) { beam.userData.pulse = true; pulseObjects.push(beam); }
  guideGrp.add(beam);

  // Track meshes for hover/drag highlighting
  const highlightMeshes = [beam];

  // ─── Invisible hit area (fat box for easy grabbing) ───
  const hitW = (axis === 'x') ? length : 0.6;
  const hitH = 0.6;
  const hitD = (axis === 'z') ? length : 0.6;
  const hitGeo = new THREE.BoxGeometry(hitW, hitH, hitD);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitBox = new THREE.Mesh(hitGeo, hitMat);
  hitBox.position.copy(mid);
  hitBox.renderOrder = 0;
  hitBox.userData.isHitArea = true;
  hitBox.userData.guideIndex = guideGroups.length; // index into guideGroups
  guideGrp.add(hitBox);

  // Track for fast raycast
  hitBoxes.push(hitBox);

  // ─── Arrow cones at endpoints ───
  highlightMeshes.push(addArrowCone(guideGrp, p1, dir.clone().normalize(), isMeasured, color));
  highlightMeshes.push(addArrowCone(guideGrp, p2, dir.clone().normalize().negate(), isMeasured, color));

  // ─── Large endpoint discs on wall surfaces ───
  highlightMeshes.push(addEndpoint(guideGrp, p1, axis, isMeasured, color));
  highlightMeshes.push(addEndpoint(guideGrp, p2, axis, isMeasured, color));

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
  if (!isMeasured) { sprite.userData.pulse = true; pulseObjects.push(sprite); }
  guideGrp.add(sprite);

  dimGroup.add(guideGrp);
  dimSprites.push({ sprite, dim, roomId, floor, computedValue });

  // Store guide info for drag + visual state
  guideGroups.push({ group: guideGrp, axis, dim, roomId, floor, bounds, floorY, p1: p1.clone(), p2: p2.clone(), highlightMeshes, hitBox });
}

function addArrowCone(parent, point, direction, isMeasured, color) {
  const coneH = 0.08;
  const coneR = 0.04;
  const geo = new THREE.ConeGeometry(coneR, coneH, 8);
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: isMeasured ? 0.9 : 0.8 });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.copy(point).add(direction.clone().multiplyScalar(coneH / 2));
  cone.renderOrder = 999;
  cone.userData.originalColor = mat.color.clone();

  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, direction);
  cone.quaternion.copy(quat);

  if (!isMeasured) { cone.userData.pulse = true; pulseObjects.push(cone); }
  parent.add(cone);
  return cone;
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
  mesh.userData.originalColor = mat.color.clone();

  if (axis === 'x') {
    mesh.rotation.y = Math.PI / 2;
  } else if (axis === 'z') {
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = Math.PI / 2;
  } else {
    mesh.rotation.x = -Math.PI / 2;
  }

  if (!isMeasured) { mesh.userData.pulse = true; pulseObjects.push(mesh); }
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
  return mesh;
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

// ─── CONTROL MEASUREMENTS (point-to-point + wall-to-wall) ───

let measureMode = false;
let measureFirstPoint = null;
let measureFirstMarker = null;
let previewLine = null;
let previewLabel = null;
let controlGroup = null;
let selectedWall1 = null; // { point, normal, axis, mesh, highlight }
let selectedWall2 = null;
const MEASURE_COLOR = 0xFFDD44;
const WALL_HIGHLIGHT_COLOR = 0x44AAFF;
const measureMarkerMat = new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, depthTest: false });
const measureLineMat = new THREE.LineBasicMaterial({
  color: MEASURE_COLOR, transparent: true, opacity: 0.9, depthTest: false, linewidth: 2
});

// Measure mode is now seamless — Shift+click on walls, no mode toggle needed
export function enterMeasureMode() { initControlMeasurements(); }
export function exitMeasureMode() { clearControlMeasurements(); }
export function toggleMeasureMode() {
  if (selectedWall1 || selectedWall2) clearControlMeasurements();
}

function initControlMeasurements() {
  if (!controlGroup && state.scene) {
    controlGroup = new THREE.Group();
    controlGroup.name = 'ControlMeasurements';
    state.scene.add(controlGroup);
  }
}

export function clearControlMeasurements() {
  if (!controlGroup) return;
  while (controlGroup.children.length) {
    const c = controlGroup.children[0];
    controlGroup.remove(c);
    c.traverse?.(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material?.map) child.material.map.dispose();
      if (child.material) child.material.dispose();
    });
    if (c.geometry) c.geometry.dispose();
    if (c.material?.map) c.material.map.dispose();
    if (c.material) c.material.dispose();
  }
  measureFirstPoint = null;
  measureFirstMarker = null;
  selectedWall1 = null;
  selectedWall2 = null;
}

// Shared raycast for measure mode — returns {point, face, normal} or null
const _measureSkipGroups = new Set(['ControlMeasurements', 'dimensions', 'SimulatorGroup', 'Enclosure']);
function measureRaycast(event) {
  if (!state.scene || !state.camera) return null;
  const canvas = state.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(mouse, state.camera);

  const targets = [];
  state.scene.traverse(obj => {
    if (!obj.isMesh || !obj.visible) return;
    if (obj.material && obj.material.visible === false) return;
    if (obj.userData?.isHitArea) return;
    if (obj.material?.wireframe) return;
    if (obj.material?.opacity < 0.3) return;
    let parent = obj.parent;
    while (parent) {
      if (_measureSkipGroups.has(parent.name)) return;
      parent = parent.parent;
    }
    targets.push(obj);
  });

  const hits = rc.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const hit = hits[0];
  // Transform face normal to world space
  let worldNormal = new THREE.Vector3(0, 1, 0);
  if (hit.face?.normal) {
    worldNormal = hit.face.normal.clone();
    worldNormal.transformDirection(hit.object.matrixWorld);
  }
  return {
    point: hit.point.clone(),
    normal: worldNormal,
    object: hit.object,
    allHits: hits
  };
}

// Detect if a hit is on a vertical wall (normal is mostly horizontal)
function isWallHit(hitResult) {
  if (!hitResult) return false;
  return Math.abs(hitResult.normal.y) < 0.3; // Wall normal is mostly X or Z
}

// Find the axis-aligned wall direction from hit normal
function getWallAxis(normal) {
  if (Math.abs(normal.x) > Math.abs(normal.z)) return 'x';
  return 'z';
}

// Find opposite wall by raycasting in the opposite direction of the wall normal
function findOppositeWall(point, normal) {
  const rc = new THREE.Raycaster();
  // Cast from the hit point inward (opposite to the outward normal)
  const dir = normal.clone().negate();
  rc.set(point.clone().add(dir.clone().multiplyScalar(0.01)), dir);

  const targets = [];
  state.scene.traverse(obj => {
    if (!obj.isMesh || !obj.visible) return;
    if (obj.material && obj.material.visible === false) return;
    if (obj.userData?.isHitArea) return;
    if (obj.material?.wireframe) return;
    if (obj.material?.opacity < 0.3) return;
    let parent = obj.parent;
    while (parent) {
      if (_measureSkipGroups.has(parent.name)) return;
      parent = parent.parent;
    }
    targets.push(obj);
  });

  const hits = rc.intersectObjects(targets, false);
  // Find the FURTHEST hit along the ray (opposite wall, not nearby geometry)
  if (hits.length === 0) return null;

  // Return the first hit that's > 0.3m away (skip nearby surfaces)
  for (const h of hits) {
    if (h.distance > 0.3) {
      return h.point.clone();
    }
  }
  return hits[hits.length - 1].point.clone();
}

function createMarker(point) {
  // Ring + cross marker that sits on the surface
  const grp = new THREE.Group();
  grp.position.copy(point);
  // Bright sphere
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    measureMarkerMat
  );
  sphere.renderOrder = 999;
  grp.add(sphere);
  // Outer ring for visibility
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.09, 24),
    new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, side: THREE.DoubleSide, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2; // Flat on floor by default
  ring.renderOrder = 999;
  grp.add(ring);
  return grp;
}

// ─── Shift+click handler (registered on canvas in initDimensionClick) ───
export function onShiftClickMeasure(event) {
  if (!event.shiftKey && !state.measureMode) return;
  if (event.target.closest('.glass-panel')) return;

  initControlMeasurements();

  const hit = measureRaycast(event);
  if (!hit) return;

  const wallHit = isWallHit(hit);

  if (wallHit) {
    const axis = getWallAxis(hit.normal);

    if (!selectedWall1) {
      // First wall
      clearControlMeasurements();
      selectedWall1 = selectWall(hit, axis);
    } else if (!selectedWall2) {
      // Second wall — compute and show distance
      selectedWall2 = selectWall(hit, axis);

      const axis1 = selectedWall1.axis;
      const axis2 = selectedWall2.axis;

      let p1, p2, dist;
      if (axis1 === axis2) {
        p1 = selectedWall1.point.clone();
        p2 = selectedWall2.point.clone();
        if (axis1 === 'x') {
          p2.y = p1.y;
          p2.z = p1.z;
        } else {
          p2.y = p1.y;
          p2.x = p1.x;
        }
        dist = p1.distanceTo(p2);
      } else {
        p1 = selectedWall1.point.clone();
        p2 = selectedWall2.point.clone();
        p2.y = p1.y;
        dist = p1.distanceTo(p2);
      }

      finalizeMeasurement(p1, p2, dist, `⊥ ${dist.toFixed(3)}m`);
    } else {
      // Already have two walls — reset and start over
      clearControlMeasurements();
      selectedWall1 = selectWall(hit, axis);
    }
  } else {
    // Shift+click on non-wall — point-to-point
    if (!measureFirstPoint) {
      clearControlMeasurements();
      measureFirstPoint = hit.point.clone();
      measureFirstMarker = createMarker(hit.point);
      controlGroup.add(measureFirstMarker);
    } else {
      const p1 = measureFirstPoint;
      const p2 = hit.point;
      const dist = p1.distanceTo(p2);
      const dx = Math.abs(p2.x - p1.x);
      const dz = Math.abs(p2.z - p1.z);
      let text = dist.toFixed(3) + 'm';
      if (dx > 0.05 && dz > 0.05) {
        text += `  (X:${dx.toFixed(2)} Z:${dz.toFixed(2)})`;
      }
      finalizeMeasurement(p1, p2, dist, text);
      measureFirstPoint = null;
      measureFirstMarker = null;
    }
  }
}

// ─── Measure mode hover preview ───
let _previewMarker = null;
let _previewLine = null;
let _previewLabel = null;

export function onMeasureHover(event) {
  if (!state.measureMode) {
    cleanupPreview();
    return;
  }

  const hit = measureRaycast(event);
  if (!hit) {
    cleanupPreview();
    return;
  }

  initControlMeasurements(); // ensure controlGroup exists

  // Show preview marker at hover point
  if (!_previewMarker) {
    _previewMarker = createMarker(hit.point);
    _previewMarker.traverse(c => { if (c.material) { c.material.opacity = 0.4; c.material.transparent = true; } });
    controlGroup.add(_previewMarker);
  }
  _previewMarker.position.copy(hit.point);

  // If first point exists, show preview line with distance
  if (measureFirstPoint || selectedWall1) {
    const p1 = measureFirstPoint || selectedWall1.point;
    const p2 = hit.point;

    // Remove old preview line
    if (_previewLine) { controlGroup.remove(_previewLine); _previewLine.geometry?.dispose(); _previewLine.material?.dispose(); }
    if (_previewLabel) { controlGroup.remove(_previewLabel); _previewLabel.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); }

    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    _previewLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: MEASURE_COLOR, dashSize: 0.05, gapSize: 0.03, depthTest: false, transparent: true, opacity: 0.6 }));
    _previewLine.computeLineDistances();
    _previewLine.renderOrder = 998;
    controlGroup.add(_previewLine);

    // Distance label
    const dist = p1.distanceTo(p2);
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    mid.y += 0.15;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 200; canvas2d.height = 48;
    const ctx = canvas2d.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(0, 0, 200, 48, 6); ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(dist.toFixed(3) + 'm', 100, 32);
    const tex = new THREE.CanvasTexture(canvas2d);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0.8 });
    _previewLabel = new THREE.Sprite(spriteMat);
    _previewLabel.position.copy(mid);
    _previewLabel.scale.set(0.5, 0.12, 1);
    _previewLabel.renderOrder = 999;
    controlGroup.add(_previewLabel);
  }
}

export function cleanupPreview() {
  if (_previewMarker) { controlGroup?.remove(_previewMarker); _previewMarker = null; }
  if (_previewLine) { controlGroup?.remove(_previewLine); _previewLine.geometry?.dispose(); _previewLine.material?.dispose(); _previewLine = null; }
  if (_previewLabel) { controlGroup?.remove(_previewLabel); _previewLabel.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); _previewLabel = null; }
}

function removePreview() {
  cleanupPreview();
  // Also clean up the old module-level preview vars
  if (previewLine) { controlGroup?.remove(previewLine); previewLine = null; }
  if (previewLabel) { controlGroup?.remove(previewLabel); previewLabel = null; }
}

function selectWall(hit, axis) {
  // Create a highlight overlay on the clicked wall mesh
  const mesh = hit.object;
  const bbox = new THREE.Box3().setFromObject(mesh);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  // Create highlight plane matching the wall face
  let highlightGeo, highlightPos;
  const highlightMat = new THREE.MeshBasicMaterial({
    color: WALL_HIGHLIGHT_COLOR, transparent: true, opacity: 0.25,
    side: THREE.DoubleSide, depthTest: false
  });

  if (axis === 'x') {
    // Wall perpendicular to X — highlight is a Z×Y plane
    highlightGeo = new THREE.PlaneGeometry(size.z + 0.02, size.y + 0.02);
    highlightPos = new THREE.Vector3(hit.point.x, center.y, center.z);
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.position.copy(highlightPos);
    highlight.rotation.y = Math.PI / 2;
    highlight.renderOrder = 998;
    controlGroup.add(highlight);
    return { point: hit.point.clone(), normal: hit.normal, axis, mesh, highlight };
  } else {
    // Wall perpendicular to Z — highlight is a X×Y plane
    highlightGeo = new THREE.PlaneGeometry(size.x + 0.02, size.y + 0.02);
    highlightPos = new THREE.Vector3(center.x, center.y, hit.point.z);
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.position.copy(highlightPos);
    highlight.renderOrder = 998;
    controlGroup.add(highlight);
    return { point: hit.point.clone(), normal: hit.normal, axis, mesh, highlight };
  }
}

function finalizeMeasurement(p1, p2, dist, text) {
  removePreview();

  controlGroup.add(createMarker(p1));
  controlGroup.add(createMarker(p2));

  const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const line = new THREE.Line(lineGeo, measureLineMat.clone());
  line.renderOrder = 999;
  controlGroup.add(line);

  const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const label = makeControlLabel(text, false);
  label.position.copy(mid);
  label.position.y += 0.2;
  controlGroup.add(label);
}

function makeControlLabel(text, isPreview = false) {
  const w = Math.max(384, text.length * 20);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');

  const alpha = isPreview ? 0.7 : 0.92;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = `rgba(255,221,68,${alpha})`;
  roundRect(ctx, 12, 8, w - 24, 64, 16);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = '#222';
  const fontSize = text.length > 20 ? 22 : 30;
  ctx.font = `bold ${fontSize}px SF Mono, ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 42);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: isPreview ? 0.8 : 1.0 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 300, 0.26, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

// ─── HELPERS ───

function findRoom(roomId, floor, cfg) {
  if (floor === 6 && cfg.upperFloor && cfg.upperFloor.rooms) {
    const r = cfg.upperFloor.rooms.find(r => r.id === roomId);
    if (r) return r;
  }
  return (cfg.rooms || []).find(r => r.id === roomId);
}
