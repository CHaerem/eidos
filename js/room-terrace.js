import * as THREE from 'three';
import { state } from './state.js';

// ─── TERRACE ───

export function buildTerrace() {
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

  // Railings (reuse _buildTerraceRailing railing pattern but at terrace floorY)
  if (tc.walls) {
    for (const wall of tc.walls) {
      _buildTerraceRailing(terraceGroup, railMat, wall, floorY);
    }
  }

  // Steps from upper floor to terrace
  // Steps ascend from south (interior, low) toward north (terrace, high).
  // Each step is a solid block extending from ufFloorY to its tread height.
  // direction config: "toTerrace" (default, ascending toward maxZ) or "fromTerrace" (ascending toward minZ)
  if (tc.steps) {
    const steps = tc.steps;
    const sb = steps.bounds;
    const ufFloorY = config.upperFloor ? (config.upperFloor.floorY || 2.25) : 2.25;
    const risePerStep = steps.riseTotal / steps.count;
    const depthPerStep = (sb.maxZ - sb.minZ) / steps.count;
    const direction = steps.direction || 'toTerrace'; // ascending toward maxZ by default

    const stepMat = new THREE.MeshStandardMaterial({
      color: 0xD4C8B8, roughness: 0.7, metalness: 0.0
    });

    for (let i = 0; i < steps.count; i++) {
      // Step index 0 is nearest the interior (minZ), ascending toward terrace (maxZ)
      const stepIdx = direction === 'fromTerrace' ? (steps.count - 1 - i) : i;
      const treadHeight = ufFloorY + risePerStep * (stepIdx + 1);
      const totalH = treadHeight - ufFloorY; // solid block from floor to tread
      const stepZ = sb.minZ + depthPerStep * i;
      const stepW = sb.maxX - sb.minX;

      const geo = new THREE.BoxGeometry(stepW, totalH, depthPerStep);
      const mesh = new THREE.Mesh(geo, stepMat);
      mesh.position.set(
        (sb.minX + sb.maxX) / 2,
        ufFloorY + totalH / 2,
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
