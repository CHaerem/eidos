import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { state } from './state.js';
import { getFloorTexture } from './textures.js';

// ─── OBJ LOADING ───

export function loadOBJ(objPath, scale, yShift) {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader();

    // Clipping planes — prevent OBJ walls from poking through floor and 6th floor
    const config = state.apartmentConfig;
    const floorY = config?.bounds?.floorY ?? 0;
    const upperFloorY = (config && config.upperFloor) ? (config.upperFloor.floorY || 2.25) : null;

    const clipPlanes = [];
    // Floor clipping — hide geometry below ground level
    clipPlanes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY));
    // Upper floor clipping — hide geometry above 6th floor level
    if (upperFloorY) {
      clipPlanes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), upperFloorY));
    }

    // Enable clipping on the renderer
    if (clipPlanes.length > 0 && state.renderer) {
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
                roughness: 0.7, metalness: 0.0,
                map: getFloorTexture(),
              });
              child.receiveShadow = true;
            } else if (name.startsWith('ExternalWalls')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x8899AA, side: THREE.DoubleSide,
                transparent: true, opacity: 0.4,
                roughness: 0.9, metalness: 0.0,
                clippingPlanes: clipPlanes,
              });
            } else if (name.startsWith('FloorFillerTop')) {
              child.visible = false;
            } else if (name.startsWith('InnerSide')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xC4B8A8, side: THREE.DoubleSide,
                transparent: true, opacity: 0.6,
                roughness: 0.9, metalness: 0.0,
                clippingPlanes: clipPlanes,
              });
              child.receiveShadow = true;
            } else {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xAAAAAA, side: THREE.DoubleSide,
                transparent: true, opacity: 0.5,
                roughness: 0.8, metalness: 0.0,
                clippingPlanes: clipPlanes,
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

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = 'OBJ lastet. Juster kontrollene i sidepanelet.';
        resolve();
      },
      null,
      (err) => {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = 'Feil: ' + err.message;
        reject(err);
      }
    );
  });
}
