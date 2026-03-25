import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { state } from './state.js';
import { BOUNDS, ceilAt } from './room.js';
import { register } from './entity-registry.js';

// Initialize RectAreaLight uniforms once at module level
RectAreaLightUniformsLib.init();

// ─── ROOM DETAILS: windows, door frames, baseboards, interior walls ───

let config = null;

export function clearRoomDetails() {
  const obj = state.scene.getObjectByName('RoomDetails');
  if (obj) {
    // Dispose all geometries and materials to prevent VRAM leak
    obj.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    state.scene.remove(obj);
  }
}

export async function initRoomDetails(configOverride) {
  if (configOverride) {
    config = configOverride;
  } else {
    try {
      const resp = await fetch('config/apartment.json');
      config = await resp.json();
    } catch (e) {
      console.warn('Could not load apartment config for room details:', e);
      return;
    }
  }

  const group = new THREE.Group();
  group.name = 'RoomDetails';

  buildWindows(group);
  buildDoorFrames(group);
  // buildBaseboards(group);  // Deaktivert — passer ikke modellen foreløpig
  buildProtrusions(group);
  buildInteriorWalls(group);

  state.scene.add(group);
}

// ─── WINDOWS ───

function buildWindows(parent) {
  if (!config.windows) return;

  const windowGroup = new THREE.Group();
  windowGroup.name = 'Windows';

  const z = BOUNDS.minZ;
  const frameDepth = 0.06;
  const frameWidth = 0.05;

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xE8E8E8, roughness: 0.4, metalness: 0.1
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xFFFFFF,
    transmission: 0.85,
    roughness: 0.05,
    metalness: 0.0,
    ior: 1.5,
    thickness: 0.006,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const sillMat = new THREE.MeshStandardMaterial({
    color: 0xF0F0F0, roughness: 0.3, metalness: 0.0
  });

  for (const win of config.windows) {
    // Each window gets its own group for entity selection
    const winGroup = new THREE.Group();
    winGroup.name = `Window_${win.id}`;

    // Y offset for upper floor windows
    const baseY = (win.floor === 6 && config.upperFloor) ? config.upperFloor.floorY : 0;
    const sillY = baseY + win.sillHeight;
    const topY = baseY + win.topHeight;
    const h = topY - sillY;
    const cy = (sillY + topY) / 2;

    if (win.wall === 'west') {
      // West wall window — oriented along Z axis
      const x = BOUNDS.minX;
      const w = win.z2 - win.z1;
      const cz = (win.z1 + win.z2) / 2;

      // Glass pane
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(w - frameWidth * 2, h - frameWidth * 2),
        glassMat.clone()
      );
      glass.rotation.y = Math.PI / 2;
      glass.position.set(x + 0.01, cy, cz);
      winGroup.add(glass);

      // Frame bars
      addBox(winGroup, frameMat, x, topY - frameWidth / 2, cz, frameDepth, frameWidth, w);
      addBox(winGroup, frameMat, x, sillY + frameWidth / 2, cz, frameDepth, frameWidth, w);
      addBox(winGroup, frameMat, x, cy, win.z1 + frameWidth / 2, frameDepth, h, frameWidth);
      addBox(winGroup, frameMat, x, cy, win.z2 - frameWidth / 2, frameDepth, h, frameWidth);

      // Center mullion
      addBox(winGroup, frameMat, x, cy, cz, frameDepth * 0.8, h - frameWidth * 2, frameWidth * 0.7);

      // Windowsill
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.03, w + 0.04),
        sillMat.clone()
      );
      sill.position.set(x + 0.06, sillY - 0.015, cz);
      sill.castShadow = true;
      sill.receiveShadow = true;
      winGroup.add(sill);

    } else if (win.wall === 'north') {
      // North wall window — oriented along X axis at maxZ
      const zPos = BOUNDS.maxZ;
      const ext = config.walls?.exterior;
      const northZ = ext ? ext.maxZ : zPos;
      const w = win.x2 - win.x1;
      const cx = (win.x1 + win.x2) / 2;

      // Glass pane
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(w - frameWidth * 2, h - frameWidth * 2),
        glassMat.clone()
      );
      glass.position.set(cx, cy, northZ - 0.01);
      winGroup.add(glass);

      // Frame bars
      addBox(winGroup, frameMat, cx, topY - frameWidth / 2, northZ, w, frameWidth, frameDepth);
      addBox(winGroup, frameMat, cx, sillY + frameWidth / 2, northZ, w, frameWidth, frameDepth);
      addBox(winGroup, frameMat, win.x1 + frameWidth / 2, cy, northZ, frameWidth, h, frameDepth);
      addBox(winGroup, frameMat, win.x2 - frameWidth / 2, cy, northZ, frameWidth, h, frameDepth);

      // Center vertical mullion
      addBox(winGroup, frameMat, cx, cy, northZ, frameWidth * 0.7, h - frameWidth * 2, frameDepth * 0.8);

      // Windowsill (extends inward = negative Z)
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.04, 0.03, 0.15),
        sillMat.clone()
      );
      sill.position.set(cx, sillY - 0.015, northZ - 0.06);
      sill.castShadow = true;
      sill.receiveShadow = true;
      winGroup.add(sill);

    } else {
      // South wall window (default) — oriented along X axis
      const w = win.x2 - win.x1;
      const cx = (win.x1 + win.x2) / 2;

      // Glass pane
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(w - frameWidth * 2, h - frameWidth * 2),
        glassMat.clone()
      );
      glass.position.set(cx, cy, z + 0.01);
      winGroup.add(glass);

      // Frame bars
      addBox(winGroup, frameMat, cx, topY - frameWidth / 2, z, w, frameWidth, frameDepth);
      addBox(winGroup, frameMat, cx, sillY + frameWidth / 2, z, w, frameWidth, frameDepth);
      addBox(winGroup, frameMat, win.x1 + frameWidth / 2, cy, z, frameWidth, h, frameDepth);
      addBox(winGroup, frameMat, win.x2 - frameWidth / 2, cy, z, frameWidth, h, frameDepth);

      // Center vertical mullion
      addBox(winGroup, frameMat, cx, cy, z, frameWidth * 0.7, h - frameWidth * 2, frameDepth * 0.8);

      // Windowsill
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.04, 0.03, 0.15),
        sillMat.clone()
      );
      sill.position.set(cx, sillY - 0.015, z + 0.06);
      sill.castShadow = true;
      sill.receiveShadow = true;
      winGroup.add(sill);
    }

    // Add RectAreaLight for daylight effect on south and west windows
    if (win.wall === 'south') {
      const w = win.x2 - win.x1;
      const cx = (win.x1 + win.x2) / 2;
      const windowLight = new THREE.RectAreaLight(0xFFF4E0, 3.0, w, h);
      windowLight.position.set(cx, sillY + h / 2, z + 0.05);
      windowLight.lookAt(cx, sillY + h / 2, z + 2);
      state.scene.add(windowLight);
    } else if (win.wall === 'west') {
      const w = win.z2 - win.z1;
      const cz = (win.z1 + win.z2) / 2;
      const x = BOUNDS.minX;
      const windowLight = new THREE.RectAreaLight(0xFFF4E0, 1.5, w, h);
      windowLight.position.set(x + 0.05, sillY + h / 2, cz);
      windowLight.lookAt(x + 2, sillY + h / 2, cz);
      state.scene.add(windowLight);
    }

    // Register window entity for selection/hover
    register('window', win.id, winGroup);
    windowGroup.add(winGroup);
  }

  parent.add(windowGroup);
}

// ─── DOOR FRAMES ───

function buildDoorFrames(parent) {
  if (!config.doors) return;

  const doorGroup = new THREE.Group();
  doorGroup.name = 'DoorFrames';

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xF0EDE8, roughness: 0.5, metalness: 0.0
  });
  const frameW = 0.045;
  const frameD = 0.10;

  for (const door of config.doors) {
    // Each door gets its own group for entity selection
    const singleDoorGroup = new THREE.Group();
    singleDoorGroup.name = `Door_${door.id}`;

    if (door.type === 'diagonal') {
      // Diagonal door — rotated frame between two points
      const dx = door.x2 - door.x1;
      const dz = door.z2 - door.z1;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz); // rotation around Y
      const cx = (door.x1 + door.x2) / 2;
      const cz = (door.z1 + door.z2) / 2;

      // Left jamb
      const jamb1 = new THREE.Mesh(new THREE.BoxGeometry(frameD, door.height, frameW), frameMat.clone());
      jamb1.position.set(door.x1, door.height / 2, door.z1);
      jamb1.rotation.y = angle;
      jamb1.castShadow = true; jamb1.receiveShadow = true;
      singleDoorGroup.add(jamb1);

      // Right jamb
      const jamb2 = new THREE.Mesh(new THREE.BoxGeometry(frameD, door.height, frameW), frameMat.clone());
      jamb2.position.set(door.x2, door.height / 2, door.z2);
      jamb2.rotation.y = angle;
      jamb2.castShadow = true; jamb2.receiveShadow = true;
      singleDoorGroup.add(jamb2);

      // Header
      const header = new THREE.Mesh(new THREE.BoxGeometry(frameD, frameW, length), frameMat.clone());
      header.position.set(cx, door.height - frameW / 2, cz);
      header.rotation.y = angle;
      header.castShadow = true; header.receiveShadow = true;
      singleDoorGroup.add(header);

      register('door', door.id, singleDoorGroup);
      doorGroup.add(singleDoorGroup);
      continue;
    }

    const opening = door.to - door.from;
    const mid = (door.from + door.to) / 2;
    // Y offset for upper floor doors
    const baseY = (door.floor === 6 && config.upperFloor) ? config.upperFloor.floorY : 0;

    if (door.axis === 'x') {
      // Vertical wall — door opens along Z
      const x = door.pos;
      // Left jamb
      addBox(singleDoorGroup, frameMat,
        x, baseY + door.height / 2, door.from + frameW / 2,
        frameD, door.height, frameW, true);
      // Right jamb
      addBox(singleDoorGroup, frameMat,
        x, baseY + door.height / 2, door.to - frameW / 2,
        frameD, door.height, frameW, true);
      // Header
      addBox(singleDoorGroup, frameMat,
        x, baseY + door.height - frameW / 2, mid,
        frameD, frameW, opening, true);
    } else {
      // Horizontal wall — door opens along X
      const z = door.pos;
      // Left jamb
      addBox(singleDoorGroup, frameMat,
        door.from + frameW / 2, baseY + door.height / 2, z,
        frameW, door.height, frameD, true);
      // Right jamb
      addBox(singleDoorGroup, frameMat,
        door.to - frameW / 2, baseY + door.height / 2, z,
        frameW, door.height, frameD, true);
      // Header
      addBox(singleDoorGroup, frameMat,
        mid, baseY + door.height - frameW / 2, z,
        opening, frameW, frameD, true);
    }

    register('door', door.id, singleDoorGroup);
    doorGroup.add(singleDoorGroup);
  }

  parent.add(doorGroup);
}

// ─── BASEBOARDS ───

function buildBaseboards(parent) {
  const bb = config.baseboard || { height: 0.08, depth: 0.012, color: '0xF0F0F0' };
  const h = bb.height;
  const d = bb.depth;

  const bbGroup = new THREE.Group();
  bbGroup.name = 'Baseboards';

  const mat = new THREE.MeshStandardMaterial({
    color: parseInt(bb.color), roughness: 0.4, metalness: 0.0
  });

  const ext = config.walls.exterior;

  // South wall (window wall) — baseboards between windows
  const windowPositions = (config.windows || [])
    .filter(w => w.wall === 'south')
    .sort((a, b) => a.x1 - b.x1);

  // Before first window
  if (windowPositions.length > 0) {
    const first = windowPositions[0];
    if (first.x1 > ext.minX + 0.1) {
      addBaseboard(bbGroup, mat, ext.minX, first.x1, ext.minZ, 'south', h, d);
    }
    // Between windows
    for (let i = 0; i < windowPositions.length - 1; i++) {
      const gapStart = windowPositions[i].x2;
      const gapEnd = windowPositions[i + 1].x1;
      if (gapEnd - gapStart > 0.1) {
        addBaseboard(bbGroup, mat, gapStart, gapEnd, ext.minZ, 'south', h, d);
      }
    }
    // After last window
    const last = windowPositions[windowPositions.length - 1];
    if (ext.maxX - last.x2 > 0.1) {
      addBaseboard(bbGroup, mat, last.x2, ext.maxX, ext.minZ, 'south', h, d);
    }
  } else {
    addBaseboard(bbGroup, mat, ext.minX, ext.maxX, ext.minZ, 'south', h, d);
  }

  // North wall (back wall) — full length
  addBaseboard(bbGroup, mat, ext.minX, ext.maxX, ext.maxZ, 'north', h, d);

  // East wall (X=minX, real-world east) — skip entrance door
  const eastSegments = _splitForExteriorDoors(ext.minZ, ext.maxZ, 'east', config.doors);
  for (const seg of eastSegments) {
    addBaseboard(bbGroup, mat, seg[0], seg[1], ext.minX, 'west', h, d);
  }

  // West wall (X=maxX, real-world west)
  addBaseboard(bbGroup, mat, ext.minZ, ext.maxZ, ext.maxX, 'east', h, d);

  // Interior walls — baseboards on both sides, skipping door openings
  if (config.walls.interior) {
    for (const wall of config.walls.interior) {
      // Find doors on this wall and compute gap segments
      const segments = _splitForDoors(wall.from, wall.to, wall.id, config.doors);

      if (wall.axis === 'x') {
        // Wall at fixed X=pos, running along Z (from/to are Z coords)
        // Use 'west'/'east' which correctly place strips along Z
        for (const seg of segments) {
          addBaseboard(bbGroup, mat, seg[0], seg[1], wall.pos - 0.04, 'west', h, d);
          addBaseboard(bbGroup, mat, seg[0], seg[1], wall.pos + 0.04, 'east', h, d);
        }
      } else {
        // Wall at fixed Z=pos, running along X (from/to are X coords)
        for (const seg of segments) {
          addBaseboard(bbGroup, mat, seg[0], seg[1], wall.pos - 0.04, 'west-inline', h, d);
          addBaseboard(bbGroup, mat, seg[0], seg[1], wall.pos + 0.04, 'east-inline', h, d);
        }
      }
    }
  }

  parent.add(bbGroup);
}

// Split a range [from, to] into segments that skip door openings on a given interior wall
function _splitForDoors(from, to, wallId, doors) {
  if (!doors || !doors.length) return [[from, to]];

  // Find doors referencing this wall
  const gaps = doors
    .filter(d => d.wall === wallId)
    .map(d => [d.from, d.to])
    .sort((a, b) => a[0] - b[0]);

  if (gaps.length === 0) return [[from, to]];

  const segments = [];
  let cursor = from;
  for (const [gapStart, gapEnd] of gaps) {
    if (gapStart > cursor) segments.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < to) segments.push([cursor, to]);
  return segments;
}

// Split a range for exterior wall doors (matched by wall name: 'south', 'west', etc.)
function _splitForExteriorDoors(from, to, wallName, doors) {
  if (!doors || !doors.length) return [[from, to]];

  const gaps = doors
    .filter(d => d.wall === wallName)
    .map(d => [d.from, d.to])
    .sort((a, b) => a[0] - b[0]);

  if (gaps.length === 0) return [[from, to]];

  const segments = [];
  let cursor = from;
  for (const [gapStart, gapEnd] of gaps) {
    if (gapStart > cursor) segments.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < to) segments.push([cursor, to]);
  return segments;
}

function addBaseboard(group, mat, from, to, wallPos, side, h, d) {
  const len = to - from;
  if (len < 0.05) return;

  const geo = new THREE.BoxGeometry(
    (side === 'west' || side === 'east') ? d : len,
    h,
    (side === 'west' || side === 'east') ? len : d
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const mid = (from + to) / 2;
  const hh = h / 2;

  switch (side) {
    case 'south':
      mesh.position.set(mid, hh, wallPos + d / 2);
      break;
    case 'north':
      mesh.position.set(mid, hh, wallPos - d / 2);
      break;
    case 'west':
      mesh.position.set(wallPos + d / 2, hh, mid);
      break;
    case 'east':
      mesh.position.set(wallPos - d / 2, hh, mid);
      break;
    case 'west-inline':
      // Horizontal interior wall — baseboard runs along X
      mesh.rotation.set(0, 0, 0);
      mesh.position.set(mid, hh, wallPos + d / 2);
      break;
    case 'east-inline':
      mesh.position.set(mid, hh, wallPos - d / 2);
      break;
  }

  group.add(mesh);
}

// ─── PROTRUSIONS (beams, bumps, indentations) ───

function buildProtrusions(parent) {
  const protrusions = config.walls?.protrusions;
  if (!protrusions?.length) return;

  const group = new THREE.Group();
  group.name = 'Protrusions';

  const mat = new THREE.MeshStandardMaterial({
    color: 0xF5F5F0, roughness: 0.95, metalness: 0.0
  });

  for (const p of protrusions) {
    const b = p.bounds;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const fromY = p.fromY ?? 0;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const h = p.height ?? (ceilAt(cx, cz) - fromY);
    const cy = fromY + h / 2;

    // Wrap each protrusion in its own group for entity selection
    const pGroup = new THREE.Group();
    pGroup.name = `Protrusion_${p.id}`;
    addBox(pGroup, mat, cx, cy, cz, w, h, d, true);
    register('protrusion', p.id, pGroup);
    group.add(pGroup);
  }

  parent.add(group);
}

// ─── INTERIOR WALLS ───

function buildInteriorWalls(parent) {
  const walls = config.walls?.interior;
  if (!walls?.length) return;

  const wallGroup = new THREE.Group();
  wallGroup.name = 'InteriorWalls';

  const wallThickness = 0.08;
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xE8E4DE, roughness: 0.9, metalness: 0.0,
    transparent: true, opacity: 0.6,
    side: THREE.DoubleSide,
  });

  for (const wall of walls) {
    // Compute wall height — use ceiling height at wall center
    const wGroup = new THREE.Group();
    wGroup.name = `Wall_${wall.id}`;

    if (wall.axis === 'x') {
      // Wall at fixed X=pos, running along Z from wall.from to wall.to
      const length = wall.to - wall.from;
      const midZ = (wall.from + wall.to) / 2;
      const h = ceilAt(wall.pos, midZ);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wallThickness, h, length),
        wallMat.clone()
      );
      mesh.position.set(wall.pos, h / 2, midZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      wGroup.add(mesh);
    } else {
      // Wall at fixed Z=pos, running along X from wall.from to wall.to
      const length = wall.to - wall.from;
      const midX = (wall.from + wall.to) / 2;
      const h = ceilAt(midX, wall.pos);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, h, wallThickness),
        wallMat.clone()
      );
      mesh.position.set(midX, h / 2, wall.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      wGroup.add(mesh);
    }

    register('wall', wall.id, wGroup);
    wallGroup.add(wGroup);
  }

  parent.add(wallGroup);
}

// ─── HELPERS ───

function addBox(group, mat, x, y, z, w, h, d, shadows = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  if (shadows) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  group.add(mesh);
}
