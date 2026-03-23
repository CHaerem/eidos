import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { state, setXRMode } from './state.js';
import { BOUNDS } from './room.js';
import { clearRoomFocus } from './room-focus.js';
import { updateDimensionPulse } from './dimensions.js';
import { updateAR } from './ar.js';

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
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  wrap.appendChild(renderer.domElement);

  // Generate procedural environment map for realistic reflections
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(50, 32, 16);
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512;
  envCanvas.height = 256;
  const envCtx = envCanvas.getContext('2d');
  const grad = envCtx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#87CEEB');    // sky blue at top
  grad.addColorStop(0.4, '#E8D5B7'); // warm horizon
  grad.addColorStop(0.5, '#FFF8F0'); // bright horizon line
  grad.addColorStop(0.6, '#D4C8B8'); // ground reflection
  grad.addColorStop(1, '#8B7355');   // dark ground
  envCtx.fillStyle = grad;
  envCtx.fillRect(0, 0, 512, 256);
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const envMat = new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide });
  envScene.add(new THREE.Mesh(envGeo, envMat));
  const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
  scene.environment = envMap;
  pmremGenerator.dispose();
  envScene.clear();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Hemisphere light (warm sky, cool ground)
  scene.add(new THREE.HemisphereLight(0xfff0e0, 0x8090a0, 0.7));

  // Ambient light for interior fill (warm)
  scene.add(new THREE.AmbientLight(0xfff8f0, 0.2));

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

  // Fill light (softer, from opposite side — warm blue tint)
  const fillLight = new THREE.DirectionalLight(0xdde4ff, 0.35);
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

  // ─── WebXR / VR Setup ───

  // VR camera rig — a group we can move around (teleport)
  const vrRig = new THREE.Group();
  vrRig.position.set(0, 0, 0);
  scene.add(vrRig);
  vrRig.add(camera);
  state.vrRig = vrRig;

  // Controllers
  const controllerModelFactory = new XRControllerModelFactory();

  const controller0 = renderer.xr.getController(0);
  vrRig.add(controller0);
  const controller1 = renderer.xr.getController(1);
  vrRig.add(controller1);

  const grip0 = renderer.xr.getControllerGrip(0);
  grip0.add(controllerModelFactory.createControllerModel(grip0));
  vrRig.add(grip0);
  const grip1 = renderer.xr.getControllerGrip(1);
  grip1.add(controllerModelFactory.createControllerModel(grip1));
  vrRig.add(grip1);

  // Teleport ray — visible line from controller
  const teleportLineGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -5)
  ]);
  const teleportLineMat = new THREE.LineBasicMaterial({ color: 0x4488ff, linewidth: 2 });
  const teleportLine = new THREE.Line(teleportLineGeom, teleportLineMat);
  teleportLine.visible = false;
  controller0.add(teleportLine);

  // Teleport target marker
  const teleportMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.25, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6 })
  );
  teleportMarker.visible = false;
  scene.add(teleportMarker);

  // Raycaster for teleport
  const vrRaycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  let teleportTarget = null;

  // Find floor mesh for raycasting (WholeFloor or any horizontal surface at y≈0)
  function getFloorMeshes() {
    const floors = [];
    scene.traverse(obj => {
      if (obj.isMesh && obj.name && (obj.name.includes('Floor') || obj.name.includes('floor'))) {
        floors.push(obj);
      }
    });
    // Fallback: invisible floor plane for raycasting
    if (floors.length === 0) {
      const floorPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      floorPlane.position.y = BOUNDS.floorY || 0;
      scene.add(floorPlane);
      floors.push(floorPlane);
    }
    return floors;
  }

  // Squeeze button (grip) = teleport aim
  controller0.addEventListener('squeezestart', () => {
    if (!renderer.xr.isPresenting) return;
    teleportLine.visible = true;
  });

  controller0.addEventListener('squeezeend', () => {
    if (!renderer.xr.isPresenting) return;
    teleportLine.visible = false;
    teleportMarker.visible = false;
    if (teleportTarget) {
      vrRig.position.x = teleportTarget.x;
      vrRig.position.z = teleportTarget.z;
      teleportTarget = null;
    }
  });

  // Thumbstick smooth locomotion
  const vrSpeed = 2.0; // m/s
  const vrRotSpeed = 1.5; // rad/s

  // Store pre-XR camera state for clean restore
  let preXRCameraPos = null;
  let preXRTarget = null;

  // Programmatic VR session start (called from toolbar button)
  window._startVRSession = async function() {
    if (!navigator.xr) return;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor']
      });
      renderer.xr.setSession(session);
    } catch (e) {
      console.warn('VR session failed:', e);
    }
  };

  // Track XR session state
  renderer.xr.addEventListener('sessionstart', () => {
    // Save camera state for clean restore
    preXRCameraPos = camera.position.clone();
    preXRTarget = controls.target.clone();

    // Position player in the living room at standing height
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    vrRig.position.set(cx, BOUNDS.floorY || 0, cz);

    // Detach camera from orbit controls during VR
    controls.enabled = false;

    // Notify state system + hide UI
    setXRMode('vr');
    document.body.classList.add('xr-active');
  });

  renderer.xr.addEventListener('sessionend', () => {
    // Restore orbit controls
    vrRig.position.set(0, 0, 0);
    vrRig.remove(camera);

    // Restore pre-VR camera position
    if (preXRCameraPos) {
      camera.position.copy(preXRCameraPos);
      controls.target.copy(preXRTarget);
    } else {
      camera.position.set(8, 6, 10);
      controls.target.set(0, 1, 0);
    }

    controls.enabled = true;
    vrRig.add(camera);
    controls.update();

    // Notify state system + restore UI
    setXRMode(null);
    document.body.classList.remove('xr-active');
    preXRCameraPos = null;
    preXRTarget = null;
  });

  // Check VR support and configure toolbar button
  async function initVRButton() {
    const vrBtn = document.getElementById('toolbar-vr');
    if (!vrBtn) return;
    if (navigator.xr) {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      if (supported) {
        vrBtn.disabled = false;
        vrBtn.title = 'VR Walkthrough (V)';
        vrBtn.addEventListener('click', () => window._startVRSession());
      } else {
        vrBtn.disabled = true;
        vrBtn.title = 'VR ikke støttet';
      }
    } else {
      vrBtn.disabled = true;
      vrBtn.title = 'WebXR ikke tilgjengelig';
    }
  }
  initVRButton();

  // Animation loop — must use setAnimationLoop for WebXR
  const clock = new THREE.Clock();

  renderer.setAnimationLoop(function xrAnimate(timestamp, frame) {
    const dt = clock.getDelta();

    if (renderer.xr.isPresenting) {
      const session = renderer.xr.getSession();

      // AR hit-test update (furniture/table placement)
      if (state.xrMode === 'ar-furniture' || state.xrMode === 'ar-table') {
        updateAR(frame);
      }

      // Thumbstick smooth locomotion
      if (session && session.inputSources) {
        for (const source of session.inputSources) {
          if (source.gamepad && source.gamepad.axes.length >= 4) {
            const axes = source.gamepad.axes;

            // Determine which hand: right hand = move, left hand = rotate
            if (source.handedness === 'right') {
              // Right thumbstick: forward/back (axes[3]) and strafe (axes[2])
              const forward = -axes[3]; // push up = forward
              const strafe = axes[2];   // push right = strafe right

              if (Math.abs(forward) > 0.15 || Math.abs(strafe) > 0.15) {
                // Get camera forward direction (horizontal only)
                const dir = new THREE.Vector3();
                camera.getWorldDirection(dir);
                dir.y = 0;
                dir.normalize();

                // Strafe direction (perpendicular)
                const right = new THREE.Vector3();
                right.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

                vrRig.position.addScaledVector(dir, forward * vrSpeed * dt);
                vrRig.position.addScaledVector(right, strafe * vrSpeed * dt);
              }
            } else if (source.handedness === 'left') {
              // Left thumbstick horizontal: snap-turn rotation
              const rotate = axes[2];
              if (Math.abs(rotate) > 0.15) {
                vrRig.rotateY(-rotate * vrRotSpeed * dt);
              }
            }
          }
        }
      }

      // Teleport ray update
      if (teleportLine.visible) {
        tempMatrix.identity().extractRotation(controller0.matrixWorld);
        vrRaycaster.ray.origin.setFromMatrixPosition(controller0.matrixWorld);
        vrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const floors = getFloorMeshes();
        const hits = vrRaycaster.intersectObjects(floors, true);
        if (hits.length > 0) {
          teleportTarget = hits[0].point.clone();
          teleportMarker.position.copy(teleportTarget);
          teleportMarker.position.y += 0.02;
          teleportMarker.visible = true;
        } else {
          teleportTarget = null;
          teleportMarker.visible = false;
        }
      }
    } else {
      controls.update();
    }

    updateDimensionPulse();
    renderer.render(scene, camera);

    // Rotate compass (only outside VR)
    if (!renderer.xr.isPresenting && compassRing) {
      const t = controls.target;
      const origin = t.clone().project(camera);
      const north = new THREE.Vector3(t.x, t.y, t.z + 1).project(camera);
      const sx = north.x - origin.x;
      const sy = -(north.y - origin.y);
      const angle = Math.atan2(sx, -sy) * (180 / Math.PI);
      compassRing.setAttribute('transform', `rotate(${angle}, 50, 50)`);
    }
  });

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  });

  // View controls — computed from BOUNDS (config-driven)
  // These use BOUNDS which are populated from apartment.json in room.js
  // ─── Smooth camera transitions ───
  function animateCamera(targetPos, targetLook, targetUp, duration = 400) {
    const startPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const startLook = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    const startUp = { x: camera.up.x, y: camera.up.y, z: camera.up.z };
    const startTime = performance.now();

    function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    function step() {
      const t = Math.min(1, (performance.now() - startTime) / duration);
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
      camera.up.set(
        startUp.x + (targetUp.x - startUp.x) * e,
        startUp.y + (targetUp.y - startUp.y) * e,
        startUp.z + (targetUp.z - startUp.z) * e
      ).normalize();
      controls.update();

      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  window.setTopDown = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const height = Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ) * 1.5;
    animateCamera({ x: cx, y: height, z: cz }, { x: cx, y: 0, z: cz }, { x: 0, y: 0, z: -1 });
  };

  window.set3DView = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    animateCamera({ x: cx + spanX * 0.7, y: 5, z: cz + spanX * 0.9 }, { x: cx, y: 1, z: cz }, { x: 0, y: 1, z: 0 });
  };

  window.setFrontView = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanZ = BOUNDS.maxZ - BOUNDS.minZ;
    animateCamera({ x: cx, y: 1.5, z: BOUNDS.minZ - spanZ * 1.5 }, { x: cx, y: 1.5, z: cz }, { x: 0, y: 1, z: 0 });
  };

  window.setSideView = function() {
    clearRoomFocus();
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    animateCamera({ x: BOUNDS.maxX + spanX * 0.8, y: 2.0, z: cz }, { x: cx, y: 1.0, z: cz }, { x: 0, y: 1, z: 0 });
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
