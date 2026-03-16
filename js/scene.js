import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';
import { BOUNDS } from './room.js';

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

  // Hemisphere light (warm sky, cool ground)
  scene.add(new THREE.HemisphereLight(0xffeedd, 0x8899aa, 0.6));

  // Main directional light with shadows
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
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

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
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
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanX = BOUNDS.maxX - BOUNDS.minX;
    camera.position.set(cx + spanX * 0.7, 5, cz + spanX * 0.9);
    controls.target.set(cx, 1, cz);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  window.setFrontView = function() {
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const spanZ = BOUNDS.maxZ - BOUNDS.minZ;
    camera.position.set(cx, 1.5, BOUNDS.minZ - spanZ * 1.5);
    controls.target.set(cx, 1.5, cz);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  window.setSideView = function() {
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
}
