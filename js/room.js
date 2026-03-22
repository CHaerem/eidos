import * as THREE from 'three';
import { state } from './state.js';

// ─── Sub-module imports (aliased to avoid conflict with re-exports) ───
import { buildCeiling as _buildCeiling } from './room-ceiling.js';
import { buildUpperFloor as _buildUpperFloor } from './room-upper-floor.js';
import { buildTerrace as _buildTerrace } from './room-terrace.js';
import { loadOBJ as _loadOBJ } from './room-obj-loader.js';

// ─── CEILING CONSTANTS (legacy, for backward compatibility) ───
// Still used by simulator.js (hemskantZ)
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
// Exported as a mutable array so sub-modules can read it.
export let ceilingZones = [];
export let defaultCeilingHeight = 2.50;

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

/** Recursively dispose all geometries and materials in a Three.js object tree. */
export function disposeObject3D(obj) {
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (mat.map) mat.map.dispose();
        if (mat.normalMap) mat.normalMap.dispose();
        if (mat.roughnessMap) mat.roughnessMap.dispose();
        if (mat.metalnessMap) mat.metalnessMap.dispose();
        if (mat.emissiveMap) mat.emissiveMap.dispose();
        mat.dispose();
      }
    }
  });
}

// ─── CLEAR ROOM GEOMETRY ───
export function clearRoomGeometry() {
  const { scene } = state;
  ['Ceiling', 'UpperFloor', 'Staircase', 'Terrace', 'RoomBoundaries'].forEach(name => {
    const obj = scene.getObjectByName(name);
    if (obj) { disposeObject3D(obj); scene.remove(obj); }
  });
  // Remove OBJ model meshes (loaded by loadOBJ)
  const toRemove = [];
  scene.traverse(child => {
    if (child.userData && child.userData.isOBJ) toRemove.push(child);
  });
  toRemove.forEach(obj => { disposeObject3D(obj); scene.remove(obj); });
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
      _buildCeiling();
      await _loadOBJ('Vibes%20Gate%2020%20-%20Ground%20Floor.obj', 0.1, 1.22);
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
  _buildCeiling();

  // Build upper floor (6. etasje) if defined
  _buildUpperFloor();

  // Build rooftop terrace if defined
  _buildTerrace();

  // Build room boundary lines for visual clarity
  buildRoomBoundaryLines();

  // Load OBJ if specified
  if (config.objPath) {
    await _loadOBJ(config.objPath, config.objScale || 1, config.objYShift || 0);
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

// Populate legacy CEIL from zone data (for simulator hemskant, etc.)
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

// ─── ROOM BOUNDARY LINES ───

function buildRoomBoundaryLines() {
  const config = state.apartmentConfig;
  if (!config) return;

  const group = new THREE.Group();
  group.name = 'RoomBoundaries';

  const lineMat = new THREE.LineBasicMaterial({
    color: 0x888888, transparent: true, opacity: 0.2
  });

  // 5th floor room outlines
  for (const room of (config.rooms || [])) {
    const b = room.bounds;
    const y = 0.005; // Just above floor
    const pts = [
      new THREE.Vector3(b.minX, y, b.minZ),
      new THREE.Vector3(b.maxX, y, b.minZ),
      new THREE.Vector3(b.maxX, y, b.maxZ),
      new THREE.Vector3(b.minX, y, b.maxZ),
      new THREE.Vector3(b.minX, y, b.minZ),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, lineMat);
    group.add(line);
  }

  // Upper floor room outlines
  const uf = config.upperFloor;
  if (uf) {
    const floorY = uf.floorY || 2.25;
    for (const room of (uf.rooms || [])) {
      const b = room.bounds;
      const y = floorY + 0.005;
      const pts = [
        new THREE.Vector3(b.minX, y, b.minZ),
        new THREE.Vector3(b.maxX, y, b.minZ),
        new THREE.Vector3(b.maxX, y, b.maxZ),
        new THREE.Vector3(b.minX, y, b.maxZ),
        new THREE.Vector3(b.minX, y, b.minZ),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lineMat);
      group.add(line);
    }
  }

  state.scene.add(group);
}

// ─── Re-exports from sub-modules ───
// These ensure that existing imports like `import { buildCeiling } from './room.js'` still work.
export { buildCeiling } from './room-ceiling.js';
export { buildUpperFloor } from './room-upper-floor.js';
export { buildTerrace } from './room-terrace.js';
export { loadOBJ } from './room-obj-loader.js';
