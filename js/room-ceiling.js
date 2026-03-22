import * as THREE from 'three';
import { state } from './state.js';
import { ceilingZones } from './room.js';

// ─── BUILD CEILING/ROOF GEOMETRY ───

export function buildCeiling() {
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
