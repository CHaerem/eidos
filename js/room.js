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

export function ceilAt(z) {
  const d = z - CEIL.windowZ;
  if (d <= 0) return CEIL.ceilWindow;
  if (d <= CEIL.hemskantDist) {
    return CEIL.ceilWindow + d * (CEIL.ceilHemskant - CEIL.ceilWindow) / CEIL.hemskantDist;
  }
  return CEIL.ceilUnderHems;
}

// ─── INIT ROOM ───
export async function initRoom() {
  // Load apartment config
  try {
    const resp = await fetch('config/apartment.json');
    const config = await resp.json();
    const c = config.ceiling;
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
    CEIL.hemskantZ = CEIL.windowZ + CEIL.hemskantDist;

    // Build ceiling geometry
    buildCeiling();

    // Load OBJ
    await loadOBJ(config.objPath, config.objScale, config.objYShift);
  } catch (e) {
    console.warn('Could not load apartment config, using defaults:', e);
    CEIL.hemskantZ = CEIL.windowZ + CEIL.hemskantDist;
    buildCeiling();
    await loadOBJ('Vibes%20Gate%2020%20-%20Ground%20Floor.obj', 0.1, 1.22);
  }
}

function buildCeiling() {
  const { scene } = state;
  const ceilGroup = new THREE.Group();

  const xL = CEIL.roomMinX, xR = CEIL.roomMaxX;
  const zW = CEIL.windowZ, zH = CEIL.hemskantZ;
  const yW = CEIL.ceilWindow, yH = CEIL.ceilHemskant;
  const zB = CEIL.backZ;

  // Slope
  const slopeGeo = new THREE.BufferGeometry();
  slopeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    xL, yW, zW,  xR, yW, zW,  xR, yH, zH,
    xL, yW, zW,  xR, yH, zH,  xL, yH, zH,
  ], 3));
  slopeGeo.computeVertexNormals();
  ceilGroup.add(new THREE.Mesh(slopeGeo, new THREE.MeshLambertMaterial({
    color: 0x6688AA, transparent: true, opacity: 0.25, side: THREE.DoubleSide
  })));
  ceilGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(slopeGeo),
    new THREE.LineBasicMaterial({ color: 0x5577AA, opacity: 0.5, transparent: true })));

  // Flat ceiling under hems
  const flatGeo = new THREE.BufferGeometry();
  flatGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    xL, CEIL.ceilUnderHems, zH,  xR, CEIL.ceilUnderHems, zH,  xR, CEIL.ceilUnderHems, zB,
    xL, CEIL.ceilUnderHems, zH,  xR, CEIL.ceilUnderHems, zB,  xL, CEIL.ceilUnderHems, zB,
  ], 3));
  flatGeo.computeVertexNormals();
  ceilGroup.add(new THREE.Mesh(flatGeo, new THREE.MeshLambertMaterial({
    color: 0xAA8866, transparent: true, opacity: 0.25, side: THREE.DoubleSide
  })));

  // Hemskant edge
  const kantGeo = new THREE.BufferGeometry();
  kantGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    xL, yH, zH,  xR, yH, zH,  xR, CEIL.ceilUnderHems, zH,
    xL, yH, zH,  xR, CEIL.ceilUnderHems, zH,  xL, CEIL.ceilUnderHems, zH,
  ], 3));
  kantGeo.computeVertexNormals();
  ceilGroup.add(new THREE.Mesh(kantGeo, new THREE.MeshLambertMaterial({
    color: 0xCC4444, transparent: true, opacity: 0.4, side: THREE.DoubleSide
  })));
  ceilGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xL, yH, zH), new THREE.Vector3(xR, yH, zH),
    ]),
    new THREE.LineBasicMaterial({ color: 0xFF4444, linewidth: 2 })
  ));

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
              child.material = new THREE.MeshLambertMaterial({ color: 0xD4C8B8, side: THREE.DoubleSide });
            } else if (name.startsWith('ExternalWalls')) {
              child.material = new THREE.MeshLambertMaterial({ color: 0x8899AA, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
            } else if (name.startsWith('FloorFillerTop')) {
              child.visible = false;
            } else if (name.startsWith('InnerSide')) {
              child.material = new THREE.MeshLambertMaterial({ color: 0xC4B8A8, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
            } else {
              child.material = new THREE.MeshLambertMaterial({ color: 0xAAAAAA, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
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
