import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';

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
  wrap.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(8, 12, 5);
  scene.add(dirLight);

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

  // View controls (window.* for onclick in HTML)
  window.setTopDown = function() {
    camera.position.set(state.objCenter.x, 14, state.objCenter.z);
    controls.target.copy(state.objCenter);
    camera.up.set(0, 0, -1);
    controls.update();
  };

  window.set3DView = function() {
    camera.position.set(state.objCenter.x + 6, 5, state.objCenter.z + 8);
    controls.target.copy(state.objCenter);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  window.setFrontView = function() {
    camera.position.set(state.objCenter.x, 1.5, state.objCenter.z - 10);
    controls.target.set(state.objCenter.x, 1.5, state.objCenter.z);
    camera.up.set(0, 1, 0);
    controls.update();
  };

  window.setSideView = function() {
    camera.position.set(10, 2.0, 0);
    controls.target.set(0, 1.0, 0);
    camera.up.set(0, 1, 0);
    controls.update();
  };
}
