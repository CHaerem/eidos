import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { state } from './state.js';

// ─── CEILING CONSTANTS ───
// Populated from config/apartment.json in initRoom()
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

// ─── CEILING HEIGHT FUNCTION ───
// Supports multiple ceiling types via config.ceiling.type:
//   "flat"  — uniform height everywhere
//   "slope" — loft-style: slope from window wall to hemskant, then flat under hems

let ceilingType = 'slope';
let flatCeilingHeight = 2.50;

export function ceilAt(z) {
  if (ceilingType === 'flat') {
    return flatCeilingHeight;
  }

  // Slope (loft) ceiling — default for backward compatibility
  const d = z - CEIL.windowZ;
  if (d <= 0) return CEIL.ceilWindow;
  if (d <= CEIL.hemskantDist) {
    return CEIL.ceilWindow + d * (CEIL.ceilHemskant - CEIL.ceilWindow) / CEIL.hemskantDist;
  }
  return CEIL.ceilUnderHems;
}

// ─── INIT ROOM ───
export async function initRoom() {
  let config;
  try {
    const resp = await fetch('config/apartment.json');
    config = await resp.json();
  } catch (e) {
    console.warn('Could not load apartment config, using defaults:', e);
    CEIL.hemskantZ = CEIL.windowZ + CEIL.hemskantDist;
    buildCeiling();
    await loadOBJ('Vibes%20Gate%2020%20-%20Ground%20Floor.obj', 0.1, 1.22);
    return;
  }

  // Store config in shared state for other modules
  state.apartmentConfig = config;

  // Populate ceiling constants
  const c = config.ceiling;
  ceilingType = c.type || 'slope';

  if (ceilingType === 'flat') {
    flatCeilingHeight = c.height || 2.50;
    // Still need room bounds for CEIL
    Object.assign(CEIL, {
      roomMinX: c.roomMinX || (config.bounds && config.bounds.minX) || -4.38,
      roomMaxX: c.roomMaxX || (config.bounds && config.bounds.maxX) || 4.38,
      windowZ: c.windowZ || (config.bounds && config.bounds.minZ) || -2.50,
      backZ: c.backZ || (config.bounds && config.bounds.maxZ) || 2.50,
    });
  } else {
    // Slope ceiling
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
  }
  CEIL.hemskantZ = CEIL.windowZ + (CEIL.hemskantDist || 0);

  // Populate generic bounds
  if (config.bounds) {
    Object.assign(BOUNDS, config.bounds);
  } else {
    // Fall back to exterior walls or ceiling constants
    const ext = config.walls && config.walls.exterior;
    BOUNDS.minX = (ext && ext.minX) || CEIL.roomMinX;
    BOUNDS.maxX = (ext && ext.maxX) || CEIL.roomMaxX;
    BOUNDS.minZ = (ext && ext.minZ) || CEIL.windowZ;
    BOUNDS.maxZ = (ext && ext.maxZ) || CEIL.backZ;
  }

  // Build ceiling geometry based on type
  buildCeiling();

  // Load OBJ if specified
  if (config.objPath) {
    await loadOBJ(config.objPath, config.objScale || 1, config.objYShift || 0);
  }
}

function buildCeiling() {
  const { scene } = state;
  const ceilGroup = new THREE.Group();
  ceilGroup.name = 'Ceiling';

  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0xF5F5F0, side: THREE.FrontSide,
    roughness: 0.95, metalness: 0.0
  });

  if (ceilingType === 'flat') {
    // Simple flat ceiling
    const xL = BOUNDS.minX, xR = BOUNDS.maxX;
    const zF = BOUNDS.minZ, zB = BOUNDS.maxZ;
    const h = flatCeilingHeight;

    const flatGeo = new THREE.BufferGeometry();
    flatGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      xL, h, zF,  xR, h, zF,  xR, h, zB,
      xL, h, zF,  xR, h, zB,  xL, h, zB,
    ], 3));
    flatGeo.computeVertexNormals();
    const flatMesh = new THREE.Mesh(flatGeo, ceilMat);
    flatMesh.receiveShadow = true;
    ceilGroup.add(flatMesh);

  } else {
    // Slope (loft) ceiling
    const xL = CEIL.roomMinX, xR = CEIL.roomMaxX;
    const zW = CEIL.windowZ, zH = CEIL.hemskantZ;
    const yW = CEIL.ceilWindow, yH = CEIL.ceilHemskant;
    const zB = CEIL.backZ;

    // Slope from window to hemskant
    const slopeGeo = new THREE.BufferGeometry();
    slopeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      xL, yW, zW,  xR, yW, zW,  xR, yH, zH,
      xL, yW, zW,  xR, yH, zH,  xL, yH, zH,
    ], 3));
    slopeGeo.computeVertexNormals();
    const slopeMesh = new THREE.Mesh(slopeGeo, ceilMat);
    slopeMesh.receiveShadow = true;
    ceilGroup.add(slopeMesh);

    // Flat ceiling under hems
    const flatGeo = new THREE.BufferGeometry();
    flatGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      xL, CEIL.ceilUnderHems, zH,  xR, CEIL.ceilUnderHems, zH,  xR, CEIL.ceilUnderHems, zB,
      xL, CEIL.ceilUnderHems, zH,  xR, CEIL.ceilUnderHems, zB,  xL, CEIL.ceilUnderHems, zB,
    ], 3));
    flatGeo.computeVertexNormals();
    const flatMesh = new THREE.Mesh(flatGeo, ceilMat);
    flatMesh.receiveShadow = true;
    ceilGroup.add(flatMesh);

    // Hemskant vertical edge
    const kantGeo = new THREE.BufferGeometry();
    kantGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      xL, yH, zH,  xR, yH, zH,  xR, CEIL.ceilUnderHems, zH,
      xL, yH, zH,  xR, CEIL.ceilUnderHems, zH,  xL, CEIL.ceilUnderHems, zH,
    ], 3));
    kantGeo.computeVertexNormals();
    const kantMesh = new THREE.Mesh(kantGeo, ceilMat);
    kantMesh.receiveShadow = true;
    ceilGroup.add(kantMesh);
  }

  scene.add(ceilGroup);
}

function loadOBJ(objPath, scale, yShift) {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();
    loader.load(
      objPath,
      (obj) => {
        obj.scale.set(scale, scale, scale);
        obj.position.y = yShift;

        obj.traverse((child) => {
          if (child.isMesh) {
            const name = child.name || '';
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
                roughness: 0.9, metalness: 0.0
              });
            } else if (name.startsWith('FloorFillerTop')) {
              child.visible = false;
            } else if (name.startsWith('InnerSide')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xC4B8A8, side: THREE.DoubleSide,
                transparent: true, opacity: 0.6,
                roughness: 0.9, metalness: 0.0
              });
              child.receiveShadow = true;
            } else {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xAAAAAA, side: THREE.DoubleSide,
                transparent: true, opacity: 0.5,
                roughness: 0.8, metalness: 0.0
              });
            }
          }
        });

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
