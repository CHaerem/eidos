import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';
import { BOUNDS } from './room.js';
import { clearRoomFocus } from './room-focus.js';
import { updateDimensionPulse } from './dimensions.js';

// ─── THREE.JS SCENE SETUP ───

export function initScene() {
  const wrap = document.getElementById('canvas-wrap');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a2a);

  const camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
  camera.position.set(8, 6, 10);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  wrap.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Hemisphere light (warm sky, cool ground) — increased for interior visibility
  scene.add(new THREE.HemisphereLight(0xffeedd, 0x8899aa, 0.8));

  // Ambient light for interior fill
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  // Main directional light with shadows
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(5, 10, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 30;
  dirLight.shadow.camera.left = -8;
  dirLight.shadow.camera.right = 8;
  dirLight.shadow.camera.top = 6;
  dirLight.shadow.camera.bottom = -6;
  dirLight.shadow.bias = -0.001;
  scene.add(dirLight);

  // Fill light (softer, from opposite side)
  const fillLight = new THREE.DirectionalLight(0xccddff, 0.3);
  fillLight.position.set(-4, 6, -3);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(15, 30, 0x444444, 0x333333);
  scene.add(grid);

  // Store in shared state
  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;
  state.objCenter = new THREE.Vector3(0, 1.22, 0);
  state.objSize = new THREE.Vector3(8.92, 2.44, 5.16);

  // Compass rotation element (updated each frame)
  const compassRing = document.getElementById('compass-ring');

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateDimensionPulse();
    renderer.render(scene, camera);

    // Rotate compass: project world north (+Z) onto screen to find angle
    if (compassRing) {
      const t = controls.target;
      const origin = t.clone().project(camera);
      const north = new THREE.Vector3(t.x, t.y, t.z + 1).project(camera);
      // Screen-space delta (Y is inverted: screen Y goes down)
      const sx = north.x - origin.x;
      const sy = -(north.y - origin.y);
      // Angle from screen-up (-Y) to north direction; compass SVG has N at top (0°)
      const angle = Math.atan2(sx, -sy) * (180 / Math.PI);
      compassRing.setAttribute('transform', `rotate(${angle}, 50, 50)`);
    }
  }
  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  });

  // View controls — computed from BOUNDS (config-driven)
  // These use BOUNDS which are populated from apartment.json in room.js
  window.setTopDown = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    const spanZ = BOUNDS.maxZ - BOUNDS.minZ;
    const height = Math.max(spanX, spanZ) * 1.5;
    camera.position.set(cx, height, cz);
    controls.target.set(cx, 0, cz);
    camera.up.set(0, 0, -1);
    controls.update();
  };

  window.set3DView = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    camera.position.set(cx + spanX * 0.7, 5, cz + spanX * 0.9);
    controls.target.set(cx, 1, cz);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  window.setFrontView = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanZ = BOUNDS.maxZ - BOUNDS.minZ;
    camera.position.set(cx, 1.5, BOUNDS.minZ - spanZ * 1.5);
    controls.target.set(cx, 1.5, cz);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  window.setSideView = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    camera.position.set(BOUNDS.maxX + spanX * 0.8, 2.0, cz);
    controls.target.set(cx, 1.0, cz);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  // Custom camera view — pos=[x,y,z], target=[x,y,z]
  window.setCameraView = function(px, py, pz, tx, ty, tz) {
    camera.position.set(px, py, pz);
    controls.target.set(tx, ty, tz);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  // Smooth fly-to animation
  window.flyToRoom = function(bounds, floorY = 0) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    const span = Math.max(w, d);

    // Pick approach direction: camera should be outside the building
    // looking in toward the room. Find which exterior wall is closest.
    const distToSouth = Math.abs(bounds.minZ - BOUNDS.minZ);
    const distToNorth = Math.abs(bounds.maxZ - BOUNDS.maxZ);
    const distToWest  = Math.abs(bounds.minX - BOUNDS.minX);
    const distToEast  = Math.abs(bounds.maxX - BOUNDS.maxX);
    const minDist = Math.min(distToSouth, distToNorth, distToWest, distToEast);

    // Approach direction (unit vector pointing outward from building)
    let approachX = 0, approachZ = 0;
    let approachSide = 'south';
    if (minDist === distToSouth)     { approachZ = -1; approachSide = 'south'; }
    else if (minDist === distToNorth){ approachZ =  1; approachSide = 'north'; }
    else if (minDist === distToWest) { approachX = -1; approachSide = 'west'; }
    else                             { approachX =  1; approachSide = 'east'; }

    // Add a secondary bias toward the nearest perpendicular exterior wall
    // This gives a 3/4 view instead of straight-on
    const bldgCx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const bldgCz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const sideX = cx < bldgCx ? -0.35 : 0.35;
    const sideZ = cz < bldgCz ? -0.35 : 0.35;
    if (approachZ !== 0) approachX = sideX;       // side bias when approaching N/S
    else                 approachZ = sideZ;        // side bias when approaching E/W

    // Normalize
    const aLen = Math.sqrt(approachX * approachX + approachZ * approachZ);
    approachX /= aLen;
    approachZ /= aLen;

    // 3/4 architectural view at ~55° elevation
    const viewDist = span * 1.3 + 3.0;
    const elevAngle = 55 * Math.PI / 180;
    const height = floorY + viewDist * Math.sin(elevAngle);
    const hDist = viewDist * Math.cos(elevAngle);

    // Offset left to compensate for the right-side panel (~30% of viewport)
    // Perpendicular to approach direction: rotate 90° CW → (approachZ, -approachX)
    const panelOffset = span * 0.35;
    const offsetX =  approachZ * panelOffset;
    const offsetZ = -approachX * panelOffset;

    const targetPos = {
      x: cx + hDist * approachX + offsetX,
      y: height,
      z: cz + hDist * approachZ + offsetZ
    };
    const targetLook = { x: cx + offsetX, y: floorY + 0.5, z: cz + offsetZ };

    const startPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const startLook = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    const startTime = performance.now();
    const duration = 500; // ms

    camera.up.set(0, 1, 0);

    function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    function step() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const e = easeInOut(t);

      camera.position.set(
        startPos.x + (targetPos.x - startPos.x) * e,
        startPos.y + (targetPos.y - startPos.y) * e,
        startPos.z + (targetPos.z - startPos.z) * e
      );
      controls.target.set(
        startLook.x + (targetLook.x - startLook.x) * e,
        startLook.y + (targetLook.y - startLook.y) * e,
        startLook.z + (targetLook.z - startLook.z) * e
      );
      controls.update();

      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    return { approachSide };
  };
}
