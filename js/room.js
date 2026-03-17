import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { state } from './state.js';

// ─── CEILING CONSTANTS (legacy, for backward compatibility) ───
// Still used by simulator.js (hemskantZ) and room-details.js (windowZ, roomMinX)
// Populated from ceiling zones or legacy config in initRoom()
export const CEIL = {
  windowZ: -2.50,
  backZ: 2.50,
  hemskantDist: 3.10,
  ceilWindow: 2.214,
  ceilHemskant: 3.822,
  ceilUnderHems: 2.25,
  hemsDepth: 1.90,
  roomMinX: -4.38,
  roomMaxX: 4.38,
  hemskantZ: 0, // computed
};

// ─── ROOM BOUNDS ───
// Generic bounds for any apartment — used by interaction, UI, simulator
export const BOUNDS = {
  minX: -4.38, maxX: 4.38,
  minZ: -2.50, maxZ: 2.50,
  floorY: 0,
};

// ─── CEILING ZONES ───
// Each zone: { id, type, bounds: {minX,maxX,minZ,maxZ}, ...typeSpecific }
// type "flat": { height }
// type "slope": { slopeStartZ, slopeEndZ, startHeight, endHeight }
let ceilingZones = [];
let defaultCeilingHeight = 2.50;

// ─── CEILING HEIGHT FUNCTION ───
// Returns ceiling height at any (x, z) point by checking zones.
// Falls back to defaultCeilingHeight if no zone matches.

export function ceilAt(x, z) {
  // Support legacy call signature: ceilAt(z) with only one argument
  if (z === undefined) {
    z = x;
    x = 0; // default X — picks any matching zone at that Z
  }

  // Find matching zone (first match wins — zones should not overlap)
  for (const zone of ceilingZones) {
    const b = zone.bounds;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      if (zone.type === 'flat') {
        return zone.height;
      }
      if (zone.type === 'slope') {
        const t = (z - zone.slopeStartZ) / (zone.slopeEndZ - zone.slopeStartZ);
        const clamped = Math.max(0, Math.min(1, t));
        return zone.startHeight + clamped * (zone.endHeight - zone.startHeight);
      }
    }
  }

  return defaultCeilingHeight;
}

// ─── CLEAR ROOM GEOMETRY ───
export function clearRoomGeometry() {
  const { scene } = state;
  ['Ceiling', 'UpperFloor', 'Staircase', 'Terrace'].forEach(name => {
    const obj = scene.getObjectByName(name);
    if (obj) { scene.remove(obj); }
  });
  // Remove OBJ model meshes (loaded by loadOBJ)
  const toRemove = [];
  scene.traverse(child => {
    if (child.userData && child.userData.isOBJ) toRemove.push(child);
  });
  toRemove.forEach(obj => scene.remove(obj));
}

// ─── INIT ROOM ───
export async function initRoom(configOverride) {
  let config;
  if (configOverride) {
    config = configOverride;
  } else {
    try {
      const resp = await fetch('config/apartment.json');
      config = await resp.json();
    } catch (e) {
      console.warn('Could not load apartment config, using defaults:', e);
      CEIL.hemskantZ = CEIL.windowZ + CEIL.hemskantDist;
      _buildLegacyZones();
      buildCeiling();
      await loadOBJ('Vibes%20Gate%2020%20-%20Ground%20Floor.obj', 0.1, 1.22);
      return;
    }
  }

  // Store config in shared state for other modules
  state.apartmentConfig = config;

  // Populate ceiling from config
  const c = config.ceiling;

  if (c.zones) {
    // ── New zone-based ceiling ──
    ceilingZones = c.zones;
    defaultCeilingHeight = c.defaultHeight || 2.50;

    // Populate legacy CEIL from zones for backward compatibility
    _populateCeilFromZones(c);
  } else if (c.type === 'flat') {
    // ── Legacy flat ceiling ──
    defaultCeilingHeight = c.height || 2.50;
    Object.assign(CEIL, {
      roomMinX: c.roomMinX || (config.bounds && config.bounds.minX) || -4.38,
      roomMaxX: c.roomMaxX || (config.bounds && config.bounds.maxX) || 4.38,
      windowZ: c.windowZ || (config.bounds && config.bounds.minZ) || -2.50,
      backZ: c.backZ || (config.bounds && config.bounds.maxZ) || 2.50,
    });
    ceilingZones = [{
      id: 'default-flat',
      type: 'flat',
      bounds: { minX: CEIL.roomMinX, maxX: CEIL.roomMaxX, minZ: CEIL.windowZ, maxZ: CEIL.backZ },
      height: defaultCeilingHeight,
    }];
  } else {
    // ── Legacy slope ceiling (backward compatible) ──
    Object.assign(CEIL, {
      windowZ: c.windowZ,
      backZ: c.backZ,
      hemskantDist: c.hemskantDist,
      ceilWindow: c.ceilWindow,
      ceilHemskant: c.ceilHemskant,
      ceilUnderHems: c.ceilUnderHems,
      hemsDepth: c.hemsDepth,
      roomMinX: c.roomMinX,
      roomMaxX: c.roomMaxX,
    });
    _buildLegacyZones();
  }

  CEIL.hemskantZ = CEIL.windowZ + (CEIL.hemskantDist || 0);

  // Populate generic bounds
  if (config.bounds) {
    Object.assign(BOUNDS, config.bounds);
  } else {
    const ext = config.walls && config.walls.exterior;
    BOUNDS.minX = (ext && ext.minX) || CEIL.roomMinX;
    BOUNDS.maxX = (ext && ext.maxX) || CEIL.roomMaxX;
    BOUNDS.minZ = (ext && ext.minZ) || CEIL.windowZ;
    BOUNDS.maxZ = (ext && ext.maxZ) || CEIL.backZ;
  }

  // Build ceiling/roof geometry from zones
  buildCeiling();

  // Build upper floor (6. etasje) if defined
  buildUpperFloor();

  // Build rooftop terrace if defined
  buildTerrace();

  // Load OBJ if specified
  if (config.objPath) {
    await loadOBJ(config.objPath, config.objScale || 1, config.objYShift || 0);
  }
}

// Build zones from legacy single-slope config
function _buildLegacyZones() {
  const hemskantZ = CEIL.windowZ + CEIL.hemskantDist;
  ceilingZones = [
    {
      id: 'legacy-slope',
      type: 'slope',
      bounds: { minX: CEIL.roomMinX, maxX: CEIL.roomMaxX, minZ: CEIL.windowZ, maxZ: hemskantZ },
      slopeStartZ: CEIL.windowZ,
      slopeEndZ: hemskantZ,
      startHeight: CEIL.ceilWindow,
      endHeight: CEIL.ceilHemskant,
    },
    {
      id: 'legacy-flat',
      type: 'flat',
      bounds: { minX: CEIL.roomMinX, maxX: CEIL.roomMaxX, minZ: hemskantZ, maxZ: CEIL.backZ },
      height: CEIL.ceilUnderHems,
    },
  ];
  defaultCeilingHeight = CEIL.ceilUnderHems;
}

// Populate legacy CEIL from zone data (for simulator hemskant, room-details windowZ, etc.)
function _populateCeilFromZones(ceilConfig) {
  // Find the slope zone to extract legacy values
  const slopeZone = ceilingZones.find(z => z.type === 'slope');
  const flatZone = ceilingZones.find(z => z.type === 'flat');

  if (slopeZone) {
    CEIL.windowZ = slopeZone.slopeStartZ;
    CEIL.ceilWindow = slopeZone.startHeight;
    // For legacy: hemskant values use the roof slope at hemskant position (Z=0.60)
    const rate = (slopeZone.endHeight - slopeZone.startHeight) /
                 (slopeZone.slopeEndZ - slopeZone.slopeStartZ);
    CEIL.hemskantDist = 3.10; // distance from window to hemskant
    CEIL.ceilHemskant = slopeZone.startHeight + rate * CEIL.hemskantDist;
    // roomMinX/roomMaxX are full room bounds
    CEIL.roomMinX = Math.min(...ceilingZones.map(z => z.bounds.minX));
    CEIL.roomMaxX = Math.max(...ceilingZones.map(z => z.bounds.maxX));
  }

  if (flatZone) {
    CEIL.ceilUnderHems = flatZone.height;
    CEIL.backZ = flatZone.bounds.maxZ;
  }

  // Compute derived values
  CEIL.hemsDepth = ceilConfig.hemsDepth || (CEIL.backZ - (CEIL.windowZ + CEIL.hemskantDist));
}

// ─── BUILD CEILING/ROOF GEOMETRY ───

function buildCeiling() {
  const { scene } = state;
  const ceilGroup = new THREE.Group();
  ceilGroup.name = 'Ceiling';

  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0xF5F5F0, side: THREE.FrontSide,
    roughness: 0.95, metalness: 0.0
  });

  for (const zone of ceilingZones) {
    const b = zone.bounds;
    const xL = b.minX, xR = b.maxX;
    const zF = b.minZ, zB = b.maxZ;

    if (zone.type === 'flat') {
      // Flat zones are rendered by buildUpperFloor() if upperFloor config exists.
      // Only render here as fallback if no upperFloor config.
      if (!state.apartmentConfig || !state.apartmentConfig.upperFloor) {
        const h = zone.height;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([
          xL, h, zF,  xR, h, zF,  xR, h, zB,
          xL, h, zF,  xR, h, zB,  xL, h, zB,
        ], 3));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, ceilMat);
        mesh.receiveShadow = true;
        ceilGroup.add(mesh);
      }

    } else if (zone.type === 'slope') {
      const yStart = zone.startHeight;
      const yEnd = zone.endHeight;

      // Roof/slope surface — the actual roof, rendered across full bounds
      const slopeGeo = new THREE.BufferGeometry();
      slopeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        xL, yStart, zF,  xR, yStart, zF,  xR, yEnd, zB,
        xL, yStart, zF,  xR, yEnd, zB,    xL, yEnd, zB,
      ], 3));
      slopeGeo.computeVertexNormals();
      const slopeMesh = new THREE.Mesh(slopeGeo, ceilMat);
      slopeMesh.receiveShadow = true;
      ceilGroup.add(slopeMesh);
    }
  }

  scene.add(ceilGroup);
}

// ─── BUILD UPPER FLOOR (6. ETASJE) GEOMETRY ───

function buildUpperFloor() {
  const config = state.apartmentConfig;
  if (!config || !config.upperFloor) return;

  const uf = config.upperFloor;
  const floorY = uf.floorY || 2.25;
  const { scene } = state;
  const floorGroup = new THREE.Group();
  floorGroup.name = 'UpperFloor';

  // Materials
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xD4C8B8, side: THREE.DoubleSide,
    roughness: 0.7, metalness: 0.0
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xF5F5F0, side: THREE.DoubleSide,
    roughness: 0.95, metalness: 0.0
  });

  // Get stairwell bounds for cutout
  const sw = uf.stairwell ? uf.stairwell.bounds : null;

  // Build floor planes for each area
  for (const area of uf.areas) {
    const b = area.bounds;
    if (sw) {
      // Build floor with stairwell cutout using multiple quads
      _buildFloorWithCutout(floorGroup, floorMat, b, floorY, sw);
    } else {
      // Simple floor plane
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        b.minX, floorY, b.minZ,  b.maxX, floorY, b.minZ,  b.maxX, floorY, b.maxZ,
        b.minX, floorY, b.minZ,  b.maxX, floorY, b.maxZ,  b.minX, floorY, b.maxZ,
      ], 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, floorMat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      floorGroup.add(mesh);
    }
  }

  // Build edge walls (hemskant/railing) from floor up to roof
  const roofZone = ceilingZones.find(z => z.type === 'slope');
  if (uf.walls && roofZone) {
    for (const wall of uf.walls) {
      _buildEdgeWall(floorGroup, wallMat, wall, floorY, roofZone);
    }
  }

  // Build staircase geometry (separate group — belongs to ground floor visually)
  if (uf.stairwell) {
    const stairGroup = new THREE.Group();
    stairGroup.name = 'Staircase';
    if (uf.stairwell.type === 'quarter-turn') {
      _buildQuarterTurnStaircase(stairGroup, uf.stairwell, floorY);
    } else {
      _buildStaircase(stairGroup, uf.stairwell, floorY);
    }
    stairGroup.traverse(child => { if (child.isMesh) child.castShadow = false; });
    scene.add(stairGroup);
  }

  // Build exterior upper walls (gable walls from OBJ top to roof line)
  if (roofZone && config.walls && config.walls.exterior) {
    _buildExteriorUpperWalls(floorGroup, config.walls.exterior, floorY, roofZone, config);
  }

  // Disable shadow casting on staircase elements to avoid confusing dark lines
  floorGroup.traverse(child => {
    if (child.isMesh) child.castShadow = false;
  });

  scene.add(floorGroup);
}

// ─── TERRACE ───

function buildTerrace() {
  const config = state.apartmentConfig;
  if (!config || !config.terrace) return;

  const tc = config.terrace;
  const floorY = tc.floorY || 2.70;
  const b = tc.bounds;
  const { scene } = state;
  const terraceGroup = new THREE.Group();
  terraceGroup.name = 'Terrace';

  // Materials
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xC0B8A8, side: THREE.DoubleSide,
    roughness: 0.8, metalness: 0.0
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xF0F0F0, side: THREE.DoubleSide,
    roughness: 0.5, metalness: 0.1
  });

  // Floor plane
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    b.minX, floorY, b.minZ,  b.maxX, floorY, b.minZ,  b.maxX, floorY, b.maxZ,
    b.minX, floorY, b.minZ,  b.maxX, floorY, b.maxZ,  b.minX, floorY, b.maxZ,
  ], 3));
  floorGeo.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.receiveShadow = true;
  terraceGroup.add(floorMesh);

  // Railings (reuse _buildEdgeWall railing pattern but at terrace floorY)
  if (tc.walls) {
    for (const wall of tc.walls) {
      _buildTerraceRailing(terraceGroup, railMat, wall, floorY);
    }
  }

  // Steps from upper floor to terrace
  if (tc.steps) {
    const steps = tc.steps;
    const sb = steps.bounds;
    const ufFloorY = config.upperFloor ? (config.upperFloor.floorY || 2.25) : 2.25;
    const risePerStep = steps.riseTotal / steps.count;
    const depthPerStep = (sb.maxZ - sb.minZ) / steps.count; // positive Z (north toward terrace)

    const stepMat = new THREE.MeshStandardMaterial({
      color: 0xD4C8B8, roughness: 0.7, metalness: 0.0
    });

    for (let i = 0; i < steps.count; i++) {
      const stepY = ufFloorY + risePerStep * (i + 1);
      const stepZ = sb.minZ + depthPerStep * i;
      const stepW = sb.maxX - sb.minX;
      const stepD = depthPerStep;
      const stepH = risePerStep;

      const geo = new THREE.BoxGeometry(stepW, stepH, stepD);
      const mesh = new THREE.Mesh(geo, stepMat);
      mesh.position.set(
        (sb.minX + sb.maxX) / 2,
        stepY - stepH / 2,
        stepZ + depthPerStep / 2
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      terraceGroup.add(mesh);
    }
  }

  scene.add(terraceGroup);
}

function _buildTerraceRailing(group, mat, wallDef, floorY) {
  const railHeight = wallDef.railHeight || 1.0;
  const topY = floorY + railHeight;
  const postWidth = 0.04;
  const postDepth = 0.04;
  const railThick = 0.05;
  const postSpacing = 0.12;
  const isZAxis = wallDef.axis === 'z';
  const pos = wallDef.pos;

  if (isZAxis) {
    const fromX = wallDef.fromX;
    const toX = wallDef.toX;
    const length = toX - fromX;
    const numPosts = Math.max(2, Math.ceil(length / postSpacing) + 1);

    // Top rail
    const topGeo = new THREE.BoxGeometry(length, railThick, railThick);
    const topMesh = new THREE.Mesh(topGeo, mat);
    topMesh.position.set((fromX + toX) / 2, topY - railThick / 2, pos);
    group.add(topMesh);

    // Posts
    for (let i = 0; i < numPosts; i++) {
      const x = fromX + (length * i / (numPosts - 1));
      const postGeo = new THREE.BoxGeometry(postWidth, railHeight, postDepth);
      const postMesh = new THREE.Mesh(postGeo, mat);
      postMesh.position.set(x, floorY + railHeight / 2, pos);
      group.add(postMesh);
    }
  } else {
    const fromZ = wallDef.fromZ;
    const toZ = wallDef.toZ;
    const length = toZ - fromZ;
    const numPosts = Math.max(2, Math.ceil(Math.abs(length) / postSpacing) + 1);

    // Top rail
    const topGeo = new THREE.BoxGeometry(railThick, railThick, Math.abs(length));
    const topMesh = new THREE.Mesh(topGeo, mat);
    topMesh.position.set(pos, topY - railThick / 2, (fromZ + toZ) / 2);
    group.add(topMesh);

    // Posts
    for (let i = 0; i < numPosts; i++) {
      const z = fromZ + (length * i / (numPosts - 1));
      const postGeo = new THREE.BoxGeometry(postDepth, railHeight, postWidth);
      const postMesh = new THREE.Mesh(postGeo, mat);
      postMesh.position.set(pos, floorY + railHeight / 2, z);
      group.add(postMesh);
    }
  }
}

// Build a floor plane with a rectangular cutout for the stairwell
function _buildFloorWithCutout(group, mat, areaBounds, floorY, swBounds) {
  const a = areaBounds;
  const s = swBounds;

  // Check if stairwell overlaps this area
  const overlapMinX = Math.max(a.minX, s.minX);
  const overlapMaxX = Math.min(a.maxX, s.maxX);
  const overlapMinZ = Math.max(a.minZ, s.minZ);
  const overlapMaxZ = Math.min(a.maxZ, s.maxZ);

  if (overlapMinX >= overlapMaxX || overlapMinZ >= overlapMaxZ) {
    // No overlap — full floor plane
    _addFloorQuad(group, mat, a.minX, a.maxX, a.minZ, a.maxZ, floorY);
    return;
  }

  // Split into up to 4 rectangles around the cutout:
  // Top strip (above stairwell)
  if (overlapMinZ > a.minZ) {
    _addFloorQuad(group, mat, a.minX, a.maxX, a.minZ, overlapMinZ, floorY);
  }
  // Bottom strip (below stairwell)
  if (overlapMaxZ < a.maxZ) {
    _addFloorQuad(group, mat, a.minX, a.maxX, overlapMaxZ, a.maxZ, floorY);
  }
  // Left strip (left of stairwell, between top and bottom)
  if (overlapMinX > a.minX) {
    _addFloorQuad(group, mat, a.minX, overlapMinX, overlapMinZ, overlapMaxZ, floorY);
  }
  // Right strip (right of stairwell, between top and bottom)
  if (overlapMaxX < a.maxX) {
    _addFloorQuad(group, mat, overlapMaxX, a.maxX, overlapMinZ, overlapMaxZ, floorY);
  }
}

function _addFloorQuad(group, mat, xL, xR, zF, zB, y) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    xL, y, zF,  xR, y, zF,  xR, y, zB,
    xL, y, zF,  xR, y, zB,  xL, y, zB,
  ], 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
}

// Build a railing or wall edge from the floor up
function _buildEdgeWall(group, mat, wallDef, floorY, roofZone) {
  const pos = wallDef.pos;
  const isZAxis = wallDef.axis === 'z';
  const railHeight = wallDef.railHeight || 1.0;
  const isRailing = wallDef.type === 'railing';
  const topY = floorY + railHeight;

  const railMat = new THREE.MeshStandardMaterial({
    color: 0xF0F0F0, side: THREE.DoubleSide,
    roughness: 0.5, metalness: 0.1
  });

  if (isRailing) {
    // Build railing: posts + top rail (no bottom panel — matches real apartment photos)
    const postWidth = 0.04;
    const postDepth = 0.04;
    const railThick = 0.05;
    const postSpacing = 0.12; // ~12cm between balusters (matches photos)

    if (isZAxis) {
      const fromX = wallDef.fromX;
      const toX = wallDef.toX;
      const length = toX - fromX;
      const numPosts = Math.max(2, Math.ceil(length / postSpacing) + 1);

      // Top rail (wooden handrail)
      const topGeo = new THREE.BoxGeometry(length, railThick, railThick);
      const topMesh = new THREE.Mesh(topGeo, railMat);
      topMesh.position.set((fromX + toX) / 2, topY - railThick / 2, pos);
      topMesh.castShadow = true;
      group.add(topMesh);

      // Vertical posts (balusters)
      for (let i = 0; i < numPosts; i++) {
        const x = fromX + (length * i / (numPosts - 1));
        const postGeo = new THREE.BoxGeometry(postWidth, railHeight, postDepth);
        const postMesh = new THREE.Mesh(postGeo, railMat);
        postMesh.position.set(x, floorY + railHeight / 2, pos);
        postMesh.castShadow = true;
        group.add(postMesh);
      }
    } else {
      // Railing along Z axis at X = pos
      const fromZ = wallDef.fromZ;
      const toZ = wallDef.toZ;
      const length = toZ - fromZ;
      const numPosts = Math.max(2, Math.ceil(length / postSpacing) + 1);

      // Top rail
      const topGeo = new THREE.BoxGeometry(railThick, railThick, length);
      const topMesh = new THREE.Mesh(topGeo, railMat);
      topMesh.position.set(pos, topY - railThick / 2, (fromZ + toZ) / 2);
      topMesh.castShadow = true;
      group.add(topMesh);

      // Vertical posts
      for (let i = 0; i < numPosts; i++) {
        const z = fromZ + (length * i / (numPosts - 1));
        const postGeo = new THREE.BoxGeometry(postDepth, railHeight, postWidth);
        const postMesh = new THREE.Mesh(postGeo, railMat);
        postMesh.position.set(pos, floorY + railHeight / 2, z);
        postMesh.castShadow = true;
        group.add(postMesh);
      }
    }
  } else {
    // Solid wall (legacy behavior)
    const roofRate = (roofZone.endHeight - roofZone.startHeight) /
                     (roofZone.slopeEndZ - roofZone.slopeStartZ);

    if (isZAxis) {
      const roofH = roofZone.startHeight + roofRate * (pos - roofZone.slopeStartZ);
      const fromX = wallDef.fromX;
      const toX = wallDef.toX;
      if (roofH > floorY) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([
          fromX, floorY, pos,  toX, floorY, pos,  toX, roofH, pos,
          fromX, floorY, pos,  toX, roofH, pos,   fromX, roofH, pos,
        ], 3));
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, mat));
      }
    } else {
      const fromZ = wallDef.fromZ;
      const toZ = wallDef.toZ;
      const roofHStart = roofZone.startHeight + roofRate * (fromZ - roofZone.slopeStartZ);
      const roofHEnd = roofZone.startHeight + roofRate * (toZ - roofZone.slopeStartZ);
      if (roofHEnd > floorY || roofHStart > floorY) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([
          pos, floorY, fromZ,       pos, floorY, toZ,         pos, roofHEnd, toZ,
          pos, floorY, fromZ,       pos, roofHEnd, toZ,       pos, roofHStart, fromZ,
        ], 3));
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, mat));
      }
    }
  }
}

// Build quarter-turn (L-shaped) staircase geometry between floors
function _buildQuarterTurnStaircase(group, stairwell, floorY) {
  const width = stairwell.width || 0.85;
  const runs = stairwell.runs || [];

  // Count total treads for rise calculation
  const totalTreads = runs.reduce((sum, r) => sum + r.treads, 0);
  const risePerTread = floorY / totalTreads;
  const treadThickness = 0.03;

  // Materials
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0xC4A882, side: THREE.DoubleSide,
    roughness: 0.6, metalness: 0.0
  });
  const stringerColor = stairwell.stringer ? parseInt(stairwell.stringer.color) : 0xF0F0F0;
  const stringerMat = new THREE.MeshStandardMaterial({
    color: stringerColor, side: THREE.DoubleSide,
    roughness: 0.5, metalness: 0.1
  });
  const railColor = stairwell.railing ? parseInt(stairwell.railing.color) : 0xF0F0F0;
  const railMat = new THREE.MeshStandardMaterial({
    color: railColor, side: THREE.DoubleSide,
    roughness: 0.5, metalness: 0.1
  });
  const handrailColorVal = stairwell.railing ? parseInt(stairwell.railing.handrailColor) : 0x8B6914;
  const handrailMat = new THREE.MeshStandardMaterial({
    color: handrailColorVal, roughness: 0.4, metalness: 0.1
  });

  const railHeight = (stairwell.railing && stairwell.railing.height) || 1.0;
  const balusterSpacing = (stairwell.railing && stairwell.railing.balusterSpacing) || 0.12;
  const stringerThick = (stairwell.stringer && stairwell.stringer.thickness) || 0.04;

  // Track cumulative tread index for Y calculation
  let treadIndex = 0;
  const halfW = width / 2;

  // Collect handrail points for continuous curve
  const handrailPoints = [];

  // Find pivot point from winder run to determine stringer/railing sides
  const winderRun = runs.find(r => r.pivotX !== undefined);
  const pivotX = winderRun ? winderRun.pivotX : 0;
  const pivotZ = winderRun ? winderRun.pivotZ : 0;

  for (const run of runs) {
    if (run.direction) {
      // ── Straight run ──
      const isZ = run.direction === 'z';
      const fromX = run.from.x, fromZ = run.from.z;
      const toX = run.to.x, toZ = run.to.z;
      const runLength = isZ ? Math.abs(toZ - fromZ) : Math.abs(toX - fromX);
      const treadDepth = runLength / run.treads;
      const dirSign = isZ ? Math.sign(toZ - fromZ) : Math.sign(toX - fromX);

      // Railing on the RIGHT side when walking up (open/stue side):
      //   Lower run (X-dir): right = SOUTH → railSign = -dirSign
      //   Upper run (Z-dir): right = EAST  → railSign = +dirSign
      const railSign = isZ ? dirSign : -dirSign;
      const stringerSign = -railSign;

      for (let i = 0; i < run.treads; i++) {
        const y = (treadIndex + i + 1) * risePerTread;
        const t = i / run.treads;

        // Each step is a solid block filling the full rise height.
        // Top surface at Y = y, bottom at Y = y - risePerTread (= top of previous step).
        if (isZ) {
          const z = fromZ + dirSign * treadDepth * i;
          const zEnd = z + dirSign * treadDepth;
          const zMid = (z + zEnd) / 2;

          const treadGeo = new THREE.BoxGeometry(width, risePerTread, Math.abs(treadDepth));
          const treadMesh = new THREE.Mesh(treadGeo, stepMat);
          treadMesh.position.set(fromX, y - risePerTread / 2, zMid);
          treadMesh.castShadow = true;
          treadMesh.receiveShadow = true;
          group.add(treadMesh);

          // White riser face on the front of each step
          const riserGeo = new THREE.PlaneGeometry(width, risePerTread);
          const riserMesh = new THREE.Mesh(riserGeo, stringerMat);
          riserMesh.position.set(fromX, y - risePerTread / 2, z);
          riserMesh.rotation.y = dirSign > 0 ? Math.PI : 0;
          group.add(riserMesh);

          // Handrail point on outer (railing) side
          const outerX = fromX + railSign * halfW;
          handrailPoints.push(new THREE.Vector3(outerX, y + railHeight, zMid));
        } else {
          const x = fromX + dirSign * treadDepth * i;
          const xEnd = x + dirSign * treadDepth;
          const xMid = (x + xEnd) / 2;

          const treadGeo = new THREE.BoxGeometry(Math.abs(treadDepth), risePerTread, width);
          const treadMesh = new THREE.Mesh(treadGeo, stepMat);
          treadMesh.position.set(xMid, y - risePerTread / 2, fromZ);
          treadMesh.castShadow = true;
          treadMesh.receiveShadow = true;
          group.add(treadMesh);

          // White riser face on the front of each step
          const riserGeo = new THREE.PlaneGeometry(width, risePerTread);
          const riserMesh = new THREE.Mesh(riserGeo, stringerMat);
          riserMesh.position.set(x, y - risePerTread / 2, fromZ);
          riserMesh.rotation.y = Math.PI / 2 + (dirSign > 0 ? Math.PI : 0);
          group.add(riserMesh);

          // Handrail point on outer (railing) side
          const outerZ = fromZ + railSign * halfW;
          handrailPoints.push(new THREE.Vector3(xMid, y + railHeight, outerZ));
        }
      }

      // ── Stringer (closed side panel with curved bottom edge) ──
      // Real staircase has a solid white panel with:
      //   - Top edge: follows the stair slope (straight line)
      //   - Bottom edge: smooth concave curve rising from floor to near the top
      // This creates the elegant curved profile visible in the apartment photos.
      {
        const firstTreadY = (treadIndex + 1) * risePerTread;
        const lastTreadY = (treadIndex + run.treads) * risePerTread;
        const topMargin = 0.03;
        const segments = 14; // smoothness of the curve
        const minOffset = 0.08; // minimum stringer height at the top end
        const verts = [];

        for (let s = 0; s < segments; s++) {
          const t0 = s / segments;
          const t1 = (s + 1) / segments;

          // Top edge Y: linear interpolation along stair slope
          const topY0 = firstTreadY + (lastTreadY - firstTreadY) * t0 + topMargin;
          const topY1 = firstTreadY + (lastTreadY - firstTreadY) * t1 + topMargin;

          // Bottom edge Y: smooth curve from floor (Y=0) to near the top
          // The curve follows: bottomY = topY - max(minOffset, topY * (1-t)^0.7)
          // At t=0: bottomY = topY - topY = 0 (floor level)
          // At t=1: bottomY = topY - minOffset (narrow strip at top)
          const bY0 = topY0 - Math.max(minOffset, topY0 * Math.pow(1 - t0, 0.7));
          const bY1 = topY1 - Math.max(minOffset, topY1 * Math.pow(1 - t1, 0.7));

          if (isZ) {
            const sx = fromX + stringerSign * halfW;
            const z0 = fromZ + dirSign * runLength * t0;
            const z1 = fromZ + dirSign * runLength * t1;
            // Two triangles per segment (DoubleSide material handles back face)
            verts.push(
              sx, bY0, z0,  sx, bY1, z1,  sx, topY1, z1,
              sx, bY0, z0,  sx, topY1, z1,  sx, topY0, z0,
            );
          } else {
            const sz = fromZ + stringerSign * halfW;
            const x0 = fromX + dirSign * runLength * t0;
            const x1 = fromX + dirSign * runLength * t1;
            verts.push(
              x0, bY0, sz,  x1, bY1, sz,  x1, topY1, sz,
              x0, bY0, sz,  x1, topY1, sz,  x0, topY0, sz,
            );
          }
        }

        const stringerGeo = new THREE.BufferGeometry();
        stringerGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        stringerGeo.computeVertexNormals();
        const mesh = new THREE.Mesh(stringerGeo, stringerMat);
        mesh.castShadow = true;
        group.add(mesh);
      }

      // ── Under-stair soffit (underside panel) ──
      // The underside of the staircase is enclosed with a white panel,
      // forming a ceiling for the kitchen area underneath (visible in photo 6059cc2f).
      // This is a sloped panel following the stair angle, NOT a side panel.
      {
        const firstTreadY = (treadIndex + 1) * risePerTread;
        const lastTreadY = (treadIndex + run.treads) * risePerTread;
        const soffitDrop = 0.05; // soffit sits slightly below tread bottoms

        if (isZ) {
          const lx = fromX - halfW; // inner side (stringer side)
          const rx = fromX + halfW; // outer side (baluster side)
          const sz0 = fromZ;
          const sz1 = fromZ + dirSign * runLength;
          const y0 = firstTreadY - soffitDrop;
          const y1 = lastTreadY - soffitDrop;
          // Sloped rectangle under the treads
          const verts = [
            // Top face (visible from below)
            lx, y0, sz0,  rx, y1, sz1,  rx, y0, sz0,
            lx, y0, sz0,  lx, y1, sz1,  rx, y1, sz1,
            // Bottom face (visible from above — shouldn't be seen but just in case)
            lx, y0, sz0,  rx, y0, sz0,  rx, y1, sz1,
            lx, y0, sz0,  rx, y1, sz1,  lx, y1, sz1,
          ];
          const soffitGeo = new THREE.BufferGeometry();
          soffitGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          soffitGeo.computeVertexNormals();
          const soffitMesh = new THREE.Mesh(soffitGeo, stringerMat);
          soffitMesh.castShadow = true;
          soffitMesh.receiveShadow = true;
          group.add(soffitMesh);
        }
      }

      // ── Baluster posts on outer (railing) side ──
      {
        const numBalusters = Math.max(2, Math.ceil(runLength / balusterSpacing) + 1);
        for (let i = 0; i < numBalusters; i++) {
          const t = i / (numBalusters - 1);
          const y = ((treadIndex + 1) + (run.treads - 1) * t) * risePerTread;
          const balH = railHeight;
          // First and last posts are thicker newel posts
          const isNewel = (i === 0 || i === numBalusters - 1);
          const postRadius = isNewel ? 0.03 : 0.015;
          const postSegs = isNewel ? 8 : 6;

          if (isZ) {
            const bx = fromX + railSign * halfW;
            const bz = fromZ + dirSign * runLength * t;
            const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, balH, postSegs);
            const postMesh = new THREE.Mesh(postGeo, railMat);
            postMesh.position.set(bx, y + balH / 2, bz);
            postMesh.castShadow = true;
            group.add(postMesh);
          } else {
            const bx = fromX + dirSign * runLength * t;
            const bz = fromZ + railSign * halfW;
            const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, balH, postSegs);
            const postMesh = new THREE.Mesh(postGeo, railMat);
            postMesh.position.set(bx, y + balH / 2, bz);
            postMesh.castShadow = true;
            group.add(postMesh);
          }
        }
      }

      treadIndex += run.treads;

    } else if (run.pivotX !== undefined) {
      // ── Winder (quarter turn) — rectangular-clipped polygon treads ──
      // Angular lines from the pivot are clipped against the rectangular
      // turn area, producing treads that fill the entire area.
      const pivotX = run.pivotX;
      const pivotZ = run.pivotZ;
      const startAngle = (run.startAngleDeg || 0) * Math.PI / 180;
      const sweep = (run.sweepDeg || 90) * Math.PI / 180;

      // Compute the bounding box of the turn area from adjacent runs.
      // Z-direction run determines X bounds; X-direction run determines Z bounds.
      // If a direction is missing, use the sweep midpoint to determine which
      // side of the pivot the box extends toward.
      const zDirRun = runs.find(r => r.direction === 'z');
      const xDirRun = runs.find(r => r.direction && r.direction !== 'z');
      const midAngle = startAngle + sweep / 2;

      let boxMinX, boxMaxX, boxMinZ, boxMaxZ;
      if (zDirRun) {
        boxMinX = zDirRun.from.x - halfW;
        boxMaxX = zDirRun.from.x + halfW;
      } else {
        const xDir = Math.cos(midAngle) > 0 ? width : -width;
        boxMinX = Math.min(pivotX, pivotX + xDir);
        boxMaxX = Math.max(pivotX, pivotX + xDir);
      }
      if (xDirRun) {
        boxMinZ = xDirRun.from.z - halfW;
        boxMaxZ = xDirRun.from.z + halfW;
      } else {
        const zDir = Math.sin(midAngle) > 0 ? width : -width;
        boxMinZ = Math.min(pivotZ, pivotZ + zDir);
        boxMaxZ = Math.max(pivotZ, pivotZ + zDir);
      }

      // Helper: find where a ray from pivot at angle `a` hits the bounding box
      function rayHitBox(a) {
        const dx = Math.cos(a), dz = Math.sin(a);
        let tMin = Infinity;
        let hitX = pivotX, hitZ = pivotZ;
        // Check all 4 walls
        const walls = [
          { val: boxMaxX, comp: dx, axis: 'x' }, // east
          { val: boxMinX, comp: dx, axis: 'x' }, // west
          { val: boxMaxZ, comp: dz, axis: 'z' }, // north
          { val: boxMinZ, comp: dz, axis: 'z' }, // south
        ];
        for (const w of walls) {
          const origin = w.axis === 'x' ? pivotX : pivotZ;
          const comp = w.comp;
          if (Math.abs(comp) < 0.0001) continue;
          const t = (w.val - origin) / comp;
          if (t <= 0.001) continue; // behind or at the ray origin (1mm dead zone)
          if (t >= tMin) continue;
          const hx = pivotX + t * dx, hz = pivotZ + t * dz;
          if (hx >= boxMinX - 0.001 && hx <= boxMaxX + 0.001 &&
              hz >= boxMinZ - 0.001 && hz <= boxMaxZ + 0.001) {
            tMin = t;
            hitX = Math.min(Math.max(hx, boxMinX), boxMaxX);
            hitZ = Math.min(Math.max(hz, boxMinZ), boxMaxZ);
          }
        }
        return { x: hitX, z: hitZ };
      }

      // Helper: which wall is a point on?
      function wallId(p) {
        if (Math.abs(p.x - boxMaxX) < 0.01) return 'east';
        if (Math.abs(p.x - boxMinX) < 0.01) return 'west';
        if (Math.abs(p.z - boxMaxZ) < 0.01) return 'north';
        if (Math.abs(p.z - boxMinZ) < 0.01) return 'south';
        return 'unknown';
      }

      // Helper: generate corner points between two hit points (CW perimeter order)
      // Perimeter order: south(→E) → east(→N) → north(→W) → west(→S)
      function wallPointsBetween(h0, h1) {
        const w0 = wallId(h0), w1 = wallId(h1);
        if (w0 === w1) return []; // same wall, direct connection
        const corners = [
          { wall: ['south', 'east'], x: boxMaxX, z: boxMinZ },  // SE
          { wall: ['east', 'north'], x: boxMaxX, z: boxMaxZ },  // NE
          { wall: ['north', 'west'], x: boxMinX, z: boxMaxZ },  // NW
          { wall: ['west', 'south'], x: boxMinX, z: boxMinZ },  // SW
        ];
        // Walk CW from w0 to w1, adding corners we pass through
        const wallOrder = ['south', 'east', 'north', 'west'];
        const idx0 = wallOrder.indexOf(w0);
        const idx1 = wallOrder.indexOf(w1);
        if (idx0 < 0 || idx1 < 0) return [];
        const pts = [];
        let cur = idx0;
        while (cur !== idx1) {
          const corner = corners[cur]; // corner between wallOrder[cur] and wallOrder[(cur+1)%4]
          pts.push({ x: corner.x, z: corner.z });
          cur = (cur + 1) % 4;
        }
        return pts;
      }

      for (let i = 0; i < run.treads; i++) {
        const y = (treadIndex + i + 1) * risePerTread;
        const a0 = startAngle + sweep * (i / run.treads);
        const a1 = startAngle + sweep * ((i + 1) / run.treads);

        // Find where the two bounding angles hit the box walls
        const hit0 = rayHitBox(a0);
        const hit1 = rayHitBox(a1);
        const cornerPts = wallPointsBetween(hit0, hit1);

        // Build polygon: pivot → hit0 → [corner points] → hit1 → pivot
        const poly = [
          { x: pivotX, z: pivotZ },
          { x: hit0.x, z: hit0.z },
          ...cornerPts,
          { x: hit1.x, z: hit1.z },
        ];

        // ── Tread: Shape + ExtrudeGeometry (Three.js handles triangulation) ──
        // Shape is in XY plane; after rotateX(-π/2) the shape Y becomes world Z.
        // Since rotateX(-π/2) maps (X,Y,Z)→(X,Z,-Y), we negate Z in the shape
        // so world Z = -(-poly.z) = poly.z (correct position).
        const treadShape = new THREE.Shape();
        treadShape.moveTo(poly[0].x, -poly[0].z);
        for (let p = 1; p < poly.length; p++) {
          treadShape.lineTo(poly[p].x, -poly[p].z);
        }
        treadShape.closePath();

        // Extrude the full rise height so each step is a solid block.
        // Top surface at Y = y, bottom at Y = y - risePerTread (= top of previous step).
        // This eliminates all gaps — no separate riser geometry needed.
        const stepGeo = new THREE.ExtrudeGeometry(treadShape, {
          depth: risePerTread, bevelEnabled: false,
        });
        // Rotate so extrusion (local Z) becomes world -Y (downward from tread surface)
        stepGeo.rotateX(-Math.PI / 2);
        const stepMesh = new THREE.Mesh(stepGeo, stepMat);
        stepMesh.position.y = y - risePerTread;
        stepMesh.castShadow = true;
        stepMesh.receiveShadow = true;
        group.add(stepMesh);

        // White riser face along the leading angular edge (pivot → hit0)
        {
          const edgeLen = Math.sqrt((hit0.x - pivotX) ** 2 + (hit0.z - pivotZ) ** 2);
          const riserGeo = new THREE.PlaneGeometry(edgeLen, risePerTread);
          const riserMesh = new THREE.Mesh(riserGeo, stringerMat.clone());
          riserMesh.material.side = THREE.DoubleSide;
          riserMesh.position.set(
            (pivotX + hit0.x) / 2,
            y - risePerTread / 2,
            (pivotZ + hit0.z) / 2,
          );
          const edgeAngle = Math.atan2(hit0.z - pivotZ, hit0.x - pivotX);
          riserMesh.rotation.y = -edgeAngle;
          group.add(riserMesh);
        }

        // Railing post at the outer edge midpoint of each winder tread.
        {
          const midAngle = startAngle + sweep * ((i + 0.5) / run.treads);
          const midHit = rayHitBox(midAngle);

          const postGeo = new THREE.CylinderGeometry(0.015, 0.015, railHeight, 6);
          const postMesh = new THREE.Mesh(postGeo, railMat);
          postMesh.position.set(midHit.x, y + railHeight / 2, midHit.z);
          postMesh.castShadow = true;
          group.add(postMesh);

          handrailPoints.push(new THREE.Vector3(midHit.x, y + railHeight, midHit.z));
        }
      }

      // Winder soffit — flat panel under the winder section to close off the bottom
      {
        const soffitY = (treadIndex + 1) * risePerTread - risePerTread; // bottom of first winder tread
        const soffitW = boxMaxX - boxMinX;
        const soffitD = boxMaxZ - boxMinZ;
        const soffitGeo = new THREE.PlaneGeometry(soffitW, soffitD);
        const soffitMesh = new THREE.Mesh(soffitGeo, stringerMat);
        soffitMesh.rotation.x = -Math.PI / 2;
        soffitMesh.position.set(
          (boxMinX + boxMaxX) / 2,
          soffitY,
          (boxMinZ + boxMaxZ) / 2,
        );
        soffitMesh.material = stringerMat.clone();
        soffitMesh.material.side = THREE.DoubleSide;
        group.add(soffitMesh);
      }

      treadIndex += run.treads;
    }
  }

  // ── Continuous handrail along all runs ──
  if (handrailPoints.length >= 2) {
    // Build handrail as straight segments between consecutive points
    // (CatmullRomCurve would smooth/cut across the L-shaped corner)
    for (let i = 0; i < handrailPoints.length - 1; i++) {
      const p0 = handrailPoints[i];
      const p1 = handrailPoints[i + 1];
      const dir = new THREE.Vector3().subVectors(p1, p0);
      const len = dir.length();
      if (len < 0.001) continue;

      const segGeo = new THREE.CylinderGeometry(0.025, 0.025, len, 6);
      const segMesh = new THREE.Mesh(segGeo, handrailMat);
      // Position at midpoint between p0 and p1
      segMesh.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
      // Rotate cylinder to align with direction
      const axis = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.normalize());
      segMesh.quaternion.copy(quat);
      segMesh.castShadow = true;
      group.add(segMesh);
    }

  }
}

// Build spiral staircase geometry between floors (legacy)
function _buildStaircase(group, stairwell, floorY) {
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0xC4A882, side: THREE.DoubleSide,
    roughness: 0.6, metalness: 0.0
  });
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x888888, roughness: 0.3, metalness: 0.6
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xF0F0F0, side: THREE.DoubleSide,
    roughness: 0.5, metalness: 0.1
  });

  const cx = stairwell.centerX || 0;
  const cz = stairwell.centerZ || 0;
  const radius = stairwell.radius || 0.75;
  const numSteps = stairwell.numSteps || 14;
  const totalRotation = (stairwell.totalRotationDeg || 270) * Math.PI / 180;
  const startAngle = (stairwell.startAngleDeg || -90) * Math.PI / 180;

  // Central pole
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, floorY + 1.0, 8);
  const poleMesh = new THREE.Mesh(poleGeo, poleMat);
  poleMesh.position.set(cx, (floorY + 1.0) / 2, cz);
  poleMesh.castShadow = true;
  group.add(poleMesh);

  // Build pie-shaped steps
  for (let i = 0; i < numSteps; i++) {
    const y = (floorY / numSteps) * (i + 1);
    const angle = startAngle + totalRotation * (i / numSteps);
    const nextAngle = startAngle + totalRotation * ((i + 1) / numSteps);

    // Step tread — pie-slice shape
    const innerR = 0.06;
    const outerR = radius - 0.05;
    const segments = 6;
    const verts = [];

    for (let s = 0; s < segments; s++) {
      const a0 = angle + (nextAngle - angle) * (s / segments);
      const a1 = angle + (nextAngle - angle) * ((s + 1) / segments);

      const ix0 = cx + innerR * Math.cos(a0), iz0 = cz + innerR * Math.sin(a0);
      const ix1 = cx + innerR * Math.cos(a1), iz1 = cz + innerR * Math.sin(a1);
      const ox0 = cx + outerR * Math.cos(a0), oz0 = cz + outerR * Math.sin(a0);
      const ox1 = cx + outerR * Math.cos(a1), oz1 = cz + outerR * Math.sin(a1);

      verts.push(
        ix0, y, iz0,  ox0, y, oz0,  ox1, y, oz1,
        ix0, y, iz0,  ox1, y, oz1,  ix1, y, iz1,
      );
    }

    const stepGeo = new THREE.BufferGeometry();
    stepGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    stepGeo.computeVertexNormals();
    const stepMesh = new THREE.Mesh(stepGeo, stepMat);
    stepMesh.castShadow = true;
    stepMesh.receiveShadow = true;
    group.add(stepMesh);

    // Railing post at outer edge of each step
    const midAngle = (angle + nextAngle) / 2;
    const postX = cx + (outerR + 0.02) * Math.cos(midAngle);
    const postZ = cz + (outerR + 0.02) * Math.sin(midAngle);
    const postGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6);
    const postMesh = new THREE.Mesh(postGeo, railMat);
    postMesh.position.set(postX, y + 0.5, postZ);
    postMesh.castShadow = true;
    group.add(postMesh);
  }

  // Handrail — curved tube following the outer edge
  const railPoints = [];
  for (let i = 0; i <= numSteps * 3; i++) {
    const t = i / (numSteps * 3);
    const angle = startAngle + totalRotation * t;
    const y = (floorY / numSteps) + (floorY - floorY / numSteps) * t + 1.0;
    const rx = cx + (radius - 0.03) * Math.cos(angle);
    const rz = cz + (radius - 0.03) * Math.sin(angle);
    railPoints.push(new THREE.Vector3(rx, y, rz));
  }
  const railCurve = new THREE.CatmullRomCurve3(railPoints);
  const railGeo = new THREE.TubeGeometry(railCurve, 40, 0.025, 6, false);
  const handrailMat = new THREE.MeshStandardMaterial({
    color: 0x8B6914, roughness: 0.4, metalness: 0.1
  });
  const railMesh = new THREE.Mesh(railGeo, handrailMat);
  railMesh.castShadow = true;
  group.add(railMesh);
}

// Build exterior upper walls — gable/side walls from floor level up to roof line
function _buildExteriorUpperWalls(group, ext, floorY, roofZone, config) {
  const extMat = new THREE.MeshStandardMaterial({
    color: 0x8899AA, side: THREE.DoubleSide,
    transparent: true, opacity: 0.4,
    roughness: 0.9, metalness: 0.0
  });

  const roofRate = (roofZone.endHeight - roofZone.startHeight) /
                   (roofZone.slopeEndZ - roofZone.slopeStartZ);
  const roofAtZ = (z) => roofZone.startHeight + roofRate * (z - roofZone.slopeStartZ);

  const minX = ext.minX, maxX = ext.maxX;
  const minZ = ext.minZ, maxZ = ext.maxZ;
  const roofAtFront = roofAtZ(minZ);
  const roofAtBack = roofAtZ(maxZ);

  // Find Z where roof crosses floorY (gable starts here)
  const gableStartZ = (floorY - roofZone.startHeight) / roofRate + roofZone.slopeStartZ;

  // ── Side walls (East X=maxX, West X=minX) ──
  // Triangular gable from gableStartZ to maxZ
  for (const xPos of [minX, maxX]) {
    const clampedStartZ = Math.max(minZ, gableStartZ);
    if (clampedStartZ >= maxZ) continue;

    const roofStart = Math.max(floorY, roofAtZ(clampedStartZ));
    const roofEnd = roofAtBack;

    // Triangle: bottom-left, bottom-right, top-right (approx — actually a triangle/trap)
    const verts = [];

    // Build as a series of segments for smooth slope
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const z0 = clampedStartZ + (maxZ - clampedStartZ) * (i / steps);
      const z1 = clampedStartZ + (maxZ - clampedStartZ) * ((i + 1) / steps);
      const h0 = roofAtZ(z0);
      const h1 = roofAtZ(z1);

      // Quad from floorY to roof between z0 and z1
      verts.push(
        xPos, floorY, z0,  xPos, floorY, z1,  xPos, h1, z1,
        xPos, floorY, z0,  xPos, h1, z1,      xPos, h0, z0,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, extMat);
    mesh.userData.wallSide = (xPos === minX) ? 'west' : 'east';
    group.add(mesh);
  }

  // ── Back wall (North Z=maxZ) ── skip if terrace exists (open to terrace)
  if (roofAtBack > floorY && !(config && config.terrace)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      minX, floorY, maxZ,      maxX, floorY, maxZ,      maxX, roofAtBack, maxZ,
      minX, floorY, maxZ,      maxX, roofAtBack, maxZ,   minX, roofAtBack, maxZ,
    ], 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, extMat);
    mesh.userData.wallSide = 'north';
    group.add(mesh);
  }

  // ── Front wall (South Z=minZ) ── only if roof > floorY at front
  if (roofAtFront > floorY) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      minX, floorY, minZ,      maxX, floorY, minZ,      maxX, roofAtFront, minZ,
      minX, floorY, minZ,      maxX, roofAtFront, minZ,  minX, roofAtFront, minZ,
    ], 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, extMat);
    mesh.userData.wallSide = 'south';
    group.add(mesh);
  }
}

// ─── OBJ LOADING ───

function loadOBJ(objPath, scale, yShift) {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();

    // Clipping plane at upper floor level — prevents OBJ walls from poking through 6th floor
    const config = state.apartmentConfig;
    const upperFloorY = (config && config.upperFloor) ? (config.upperFloor.floorY || 2.25) : null;
    const clipPlane = upperFloorY
      ? new THREE.Plane(new THREE.Vector3(0, -1, 0), upperFloorY)
      : null;

    // Enable clipping on the renderer
    if (clipPlane && state.renderer) {
      state.renderer.localClippingEnabled = true;
    }

    loader.load(
      objPath,
      (obj) => {
        obj.scale.set(scale, scale, scale);
        obj.position.y = yShift;

        // Compute stairwell bounds for filtering OBJ meshes
        const swBounds = (config && config.upperFloor && config.upperFloor.stairwell)
          ? config.upperFloor.stairwell.bounds : null;

        obj.traverse((child) => {
          // Hide OBJ staircase sketch LineSegments (wireframe lines from architectural model)
          if (child.isLineSegments && swBounds) {
            child.visible = false;
          }

          if (child.isMesh) {
            const name = child.name || '';

            // Hide unnamed OBJ meshes that contain staircase sketch geometry
            // These are staircase meshes from the architectural model that we replace
            // with our own config-driven staircase
            if (!name && swBounds) {
              child.geometry.computeBoundingBox();
              const bb = child.geometry.boundingBox;
              const meshMinY = bb.min.y * scale + yShift;
              const meshMaxY = bb.max.y * scale + yShift;
              // If this unnamed mesh spans floor-to-ceiling, it's likely staircase geometry
              if (meshMinY < 0.1 && meshMaxY > 1.5) {
                child.visible = false;
              }
            }

            // Hide InnerSide meshes that overlap with the stairwell opening
            if (name.startsWith('InnerSide') && swBounds) {
              child.geometry.computeBoundingBox();
              const bb = child.geometry.boundingBox;
              const meshMinX = bb.min.x * scale + 0; // OBJ position.x is 0
              const meshMaxX = bb.max.x * scale;
              const meshMinZ = bb.min.z * scale;
              const meshMaxZ = bb.max.z * scale;

              // Check if this mesh passes through the stairwell zone
              const overlapsX = meshMaxX > swBounds.minX && meshMinX < swBounds.maxX;
              const overlapsZ = meshMaxZ > swBounds.minZ && meshMinZ < swBounds.maxZ;
              if (overlapsX && overlapsZ) {
                child.visible = false;
              }
            }

            if (name.startsWith('WholeFloor')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xD4C8B8, side: THREE.DoubleSide,
                roughness: 0.7, metalness: 0.0
              });
              child.receiveShadow = true;
            } else if (name.startsWith('ExternalWalls')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x8899AA, side: THREE.DoubleSide,
                transparent: true, opacity: 0.4,
                roughness: 0.9, metalness: 0.0,
                clippingPlanes: clipPlane ? [clipPlane] : [],
              });
            } else if (name.startsWith('FloorFillerTop')) {
              child.visible = false;
            } else if (name.startsWith('InnerSide')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xC4B8A8, side: THREE.DoubleSide,
                transparent: true, opacity: 0.6,
                roughness: 0.9, metalness: 0.0,
                clippingPlanes: clipPlane ? [clipPlane] : [],
              });
              child.receiveShadow = true;
            } else {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xAAAAAA, side: THREE.DoubleSide,
                transparent: true, opacity: 0.5,
                roughness: 0.8, metalness: 0.0,
                clippingPlanes: clipPlane ? [clipPlane] : [],
              });
            }
          }
        });

        obj.userData.isOBJ = true;
        obj.name = 'OBJModel';
        state.scene.add(obj);

        const box = new THREE.Box3().setFromObject(obj);
        state.objCenter = box.getCenter(new THREE.Vector3());
        state.objSize = box.getSize(new THREE.Vector3());

        state.controls.target.copy(state.objCenter);
        state.camera.position.set(state.objCenter.x + 6, state.objCenter.y + 5, state.objCenter.z + 8);
        state.controls.update();

        document.getElementById('status').textContent = 'OBJ lastet. Juster kontrollene i sidepanelet.';
        resolve();
      },
      null,
      (err) => {
        document.getElementById('status').textContent = 'Feil: ' + err.message;
        reject(err);
      }
    );
  });
}
