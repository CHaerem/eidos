// ─── HISTORY DIFF VISUALIZATION ───
// Shows 3D overlays in the scene to visualize config changes between history entries.
// Ghost outlines (orange-red) show old positions; highlights (green) show new positions.

import * as THREE from 'three';
import { state } from './state.js';
import { ceilAt } from './room.js';

let diffGroup = null;

// Colors matching existing design language
const OLD_COLOR = 0xff6b4a;   // orange-red — removed / old position
const NEW_COLOR = 0x4ade80;   // green — added / new position (matches dimension measured)
const OLD_OPACITY = 0.25;
const NEW_OPACITY = 0.20;

// ─── PUBLIC API ───

export function showHistoryDiff(currentConfig, previousConfig) {
  clearHistoryDiff();
  if (!currentConfig || !previousConfig || !state.scene) return;

  const diff = computeDiff(currentConfig, previousConfig);
  if (isDiffEmpty(diff)) return;

  diffGroup = new THREE.Group();
  diffGroup.name = 'HistoryDiff';
  diffGroup.renderOrder = 997;

  renderWallDiffs(diff.walls);
  renderRoomDiffs(diff.rooms);
  renderWindowDiffs(diff.windows, currentConfig, previousConfig);
  renderDoorDiffs(diff.doors, currentConfig, previousConfig);
  renderProtrusionDiffs(diff.protrusions);

  if (diffGroup.children.length > 0) {
    state.scene.add(diffGroup);
  } else {
    diffGroup = null;
  }

  return diff;
}

export function clearHistoryDiff() {
  if (diffGroup && state.scene) {
    diffGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
    state.scene.remove(diffGroup);
    diffGroup = null;
  }
}

// ─── DIFF COMPUTATION ───

export function computeDiff(current, previous) {
  return {
    walls: diffArrayById(current?.walls?.interior, previous?.walls?.interior, ['pos', 'from', 'to']),
    rooms: diffArrayById(
      [...(current?.rooms || []), ...(current?.upperFloor?.rooms || [])],
      [...(previous?.rooms || []), ...(previous?.upperFloor?.rooms || [])],
      ['bounds']
    ),
    windows: diffArrayById(current?.windows, previous?.windows, ['x1', 'x2', 'z1', 'z2', 'sillHeight', 'topHeight']),
    doors: diffArrayById(current?.doors, previous?.doors, ['from', 'to', 'height', 'pos']),
    protrusions: diffArrayById(current?.walls?.protrusions, previous?.walls?.protrusions, ['bounds', 'height', 'fromY']),
  };
}

function diffArrayById(currentArr, previousArr, fields) {
  const curr = currentArr || [];
  const prev = previousArr || [];
  const currMap = new Map(curr.map(e => [e.id, e]));
  const prevMap = new Map(prev.map(e => [e.id, e]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const e of curr) {
    if (!prevMap.has(e.id)) {
      added.push(e);
    } else {
      const old = prevMap.get(e.id);
      if (hasFieldChanged(e, old, fields)) {
        changed.push({ id: e.id, current: e, previous: old });
      }
    }
  }

  for (const e of prev) {
    if (!currMap.has(e.id)) {
      removed.push(e);
    }
  }

  return { added, removed, changed };
}

function hasFieldChanged(a, b, fields) {
  for (const field of fields) {
    const va = a[field];
    const vb = b[field];
    if (typeof va === 'object' && va !== null && typeof vb === 'object' && vb !== null) {
      // Deep compare one level (for bounds objects)
      for (const k of new Set([...Object.keys(va), ...Object.keys(vb)])) {
        if (va[k] !== vb[k]) return true;
      }
    } else if (va !== vb) {
      return true;
    }
  }
  return false;
}

function isDiffEmpty(diff) {
  return Object.values(diff).every(d =>
    d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0
  );
}

// ─── 3D RENDERING ───

const oldLineMat = new THREE.LineBasicMaterial({ color: OLD_COLOR, depthTest: false, transparent: true, opacity: 0.6 });
const newLineMat = new THREE.LineBasicMaterial({ color: NEW_COLOR, depthTest: false, transparent: true, opacity: 0.6 });
const oldFillMat = new THREE.MeshBasicMaterial({ color: OLD_COLOR, transparent: true, opacity: OLD_OPACITY, depthTest: false, side: THREE.DoubleSide });
const newFillMat = new THREE.MeshBasicMaterial({ color: NEW_COLOR, transparent: true, opacity: NEW_OPACITY, depthTest: false, side: THREE.DoubleSide });

// ── Walls ──

function renderWallDiffs(diffs) {
  for (const { current, previous } of diffs.changed) {
    const axis = current.axis || previous.axis;
    const from = Math.min(current.from ?? previous.from, previous.from ?? current.from);
    const to = Math.max(current.to ?? previous.to, previous.to ?? current.to);
    const h = 2.5; // approximate wall height

    if (axis === 'x') {
      // Wall runs along Z, fixed X
      addWallPlane(previous.pos, from, to, h, oldLineMat, oldFillMat, 'x');
      addWallPlane(current.pos, from, to, h, newLineMat, newFillMat, 'x');
    } else {
      // Wall runs along X, fixed Z
      addWallPlane(previous.pos, from, to, h, oldLineMat, oldFillMat, 'z');
      addWallPlane(current.pos, from, to, h, newLineMat, newFillMat, 'z');
    }
  }

  for (const wall of diffs.added) {
    const from = wall.from;
    const to = wall.to;
    addWallPlane(wall.pos, from, to, 2.5, newLineMat, newFillMat, wall.axis);
  }

  for (const wall of diffs.removed) {
    addWallPlane(wall.pos, wall.from, wall.to, 2.5, oldLineMat, oldFillMat, wall.axis);
  }
}

function addWallPlane(pos, from, to, height, lineMat, fillMat, axis) {
  const length = Math.abs(to - from);

  // Wireframe outline
  const points = [];
  if (axis === 'x') {
    // Wall at fixed X, spans Z from..to
    points.push(new THREE.Vector3(pos, 0, from));
    points.push(new THREE.Vector3(pos, 0, to));
    points.push(new THREE.Vector3(pos, height, to));
    points.push(new THREE.Vector3(pos, height, from));
    points.push(new THREE.Vector3(pos, 0, from));
  } else {
    // Wall at fixed Z, spans X from..to
    points.push(new THREE.Vector3(from, 0, pos));
    points.push(new THREE.Vector3(to, 0, pos));
    points.push(new THREE.Vector3(to, height, pos));
    points.push(new THREE.Vector3(from, height, pos));
    points.push(new THREE.Vector3(from, 0, pos));
  }

  const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(lineGeo, lineMat);
  line.renderOrder = 997;
  diffGroup.add(line);

  // Semi-transparent fill
  const fillGeo = new THREE.PlaneGeometry(length, height);
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.renderOrder = 996;

  if (axis === 'x') {
    fill.rotation.y = Math.PI / 2;
    fill.position.set(pos, height / 2, (from + to) / 2);
  } else {
    fill.position.set((from + to) / 2, height / 2, pos);
  }
  diffGroup.add(fill);
}

// ── Rooms ──

function renderRoomDiffs(diffs) {
  for (const { current, previous } of diffs.changed) {
    const oldB = previous.bounds;
    const newB = current.bounds;
    if (!oldB || !newB) continue;

    // Check if bounds actually differ
    if (oldB.minX === newB.minX && oldB.maxX === newB.maxX &&
        oldB.minZ === newB.minZ && oldB.maxZ === newB.maxZ) continue;

    addFloorOutline(oldB, OLD_COLOR, OLD_OPACITY);
    addFloorOutline(newB, NEW_COLOR, NEW_OPACITY);
  }

  for (const room of diffs.added) {
    if (room.bounds) addFloorOutline(room.bounds, NEW_COLOR, NEW_OPACITY);
  }

  for (const room of diffs.removed) {
    if (room.bounds) addFloorOutline(room.bounds, OLD_COLOR, OLD_OPACITY);
  }
}

function addFloorOutline(bounds, color, opacity) {
  const y = 0.05;
  const b = bounds;

  // Outline
  const points = [
    new THREE.Vector3(b.minX, y, b.minZ),
    new THREE.Vector3(b.maxX, y, b.minZ),
    new THREE.Vector3(b.maxX, y, b.maxZ),
    new THREE.Vector3(b.minX, y, b.maxZ),
    new THREE.Vector3(b.minX, y, b.minZ),
  ];
  const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.6 });
  const line = new THREE.Line(lineGeo, lineMat);
  line.renderOrder = 997;
  diffGroup.add(line);

  // Fill
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const fillGeo = new THREE.PlaneGeometry(w, d);
  const fillMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
  fill.renderOrder = 996;
  diffGroup.add(fill);
}

// ── Windows ──

function renderWindowDiffs(diffs, currentConfig, previousConfig) {
  const ext = currentConfig?.walls?.exterior || previousConfig?.walls?.exterior;
  if (!ext) return;

  for (const win of diffs.added) {
    addWindowOutline(win, ext, NEW_COLOR);
  }
  for (const win of diffs.removed) {
    addWindowOutline(win, ext, OLD_COLOR);
  }
  for (const { current, previous } of diffs.changed) {
    addWindowOutline(previous, ext, OLD_COLOR);
    addWindowOutline(current, ext, NEW_COLOR);
  }
}

function addWindowOutline(win, ext, color) {
  const sill = win.sillHeight || 0.9;
  const top = win.topHeight || 2.1;
  const wall = win.wall;

  let points;
  if (wall === 'south' || wall === 'north') {
    const z = wall === 'south' ? ext.minZ : ext.maxZ;
    const x1 = win.x1, x2 = win.x2;
    points = [
      new THREE.Vector3(x1, sill, z), new THREE.Vector3(x2, sill, z),
      new THREE.Vector3(x2, top, z), new THREE.Vector3(x1, top, z),
      new THREE.Vector3(x1, sill, z),
    ];
  } else {
    const x = wall === 'west' ? ext.minX : ext.maxX;
    const z1 = win.z1, z2 = win.z2;
    points = [
      new THREE.Vector3(x, sill, z1), new THREE.Vector3(x, sill, z2),
      new THREE.Vector3(x, top, z2), new THREE.Vector3(x, top, z1),
      new THREE.Vector3(x, sill, z1),
    ];
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 997;
  diffGroup.add(line);
}

// ── Doors ──

function renderDoorDiffs(diffs, currentConfig, previousConfig) {
  for (const door of diffs.added) addDoorOutline(door, NEW_COLOR);
  for (const door of diffs.removed) addDoorOutline(door, OLD_COLOR);
  for (const { current, previous } of diffs.changed) {
    addDoorOutline(previous, OLD_COLOR);
    addDoorOutline(current, NEW_COLOR);
  }
}

function addDoorOutline(door, color) {
  const h = door.height || 2.0;
  const axis = door.axis;
  const pos = door.pos;
  const from = door.from;
  const to = door.to;

  let points;
  if (axis === 'z') {
    // Door on a z-axis wall (runs along X at fixed Z)
    points = [
      new THREE.Vector3(from, 0, pos), new THREE.Vector3(to, 0, pos),
      new THREE.Vector3(to, h, pos), new THREE.Vector3(from, h, pos),
      new THREE.Vector3(from, 0, pos),
    ];
  } else {
    // Door on an x-axis wall (runs along Z at fixed X)
    points = [
      new THREE.Vector3(pos, 0, from), new THREE.Vector3(pos, 0, to),
      new THREE.Vector3(pos, h, to), new THREE.Vector3(pos, h, from),
      new THREE.Vector3(pos, 0, from),
    ];
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 997;
  diffGroup.add(line);
}

// ── Protrusions ──

function renderProtrusionDiffs(diffs) {
  for (const p of diffs.added) addProtrusionOutline(p, NEW_COLOR);
  for (const p of diffs.removed) addProtrusionOutline(p, OLD_COLOR);
  for (const { current, previous } of diffs.changed) {
    addProtrusionOutline(previous, OLD_COLOR);
    addProtrusionOutline(current, NEW_COLOR);
  }
}

function addProtrusionOutline(p, color) {
  const b = p.bounds;
  if (!b) return;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const fromY = p.fromY || 0;
  const h = p.height || 2.25;

  const boxGeo = new THREE.BoxGeometry(w, h, d);
  const edges = new THREE.EdgesGeometry(boxGeo);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.6 });
  const wireframe = new THREE.LineSegments(edges, mat);
  wireframe.position.set(cx, fromY + h / 2, cz);
  wireframe.renderOrder = 997;
  diffGroup.add(wireframe);

  boxGeo.dispose();
}

// ─── UTILITY ───

export function getDiffSummary(diff) {
  let count = 0;
  for (const d of Object.values(diff)) {
    count += d.added.length + d.removed.length + d.changed.length;
  }
  return count;
}
