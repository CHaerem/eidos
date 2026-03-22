// ─── AR MODULE ───
// WebXR AR furniture placement + table model, with iOS model-viewer fallback.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { state, setXRMode } from './state.js';
import { BOUNDS } from './room.js';
import { FURNITURE_CATALOG, createFurnitureMesh } from './furniture.js';

// ─── Capability detection ───

let _capabilities = null;

async function detectCapabilities() {
  const result = { webxrAR: false, hitTest: false, isIOS: false, hasModelViewer: false };
  result.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  result.hasModelViewer = typeof customElements !== 'undefined' &&
    !!customElements.get('model-viewer');

  if (navigator.xr) {
    try {
      result.webxrAR = await navigator.xr.isSessionSupported('immersive-ar');
      result.hitTest = result.webxrAR; // hit-test implied on Chrome Android
    } catch (e) {
      // WebXR not available
    }
  }
  return result;
}

export async function isARSupported() {
  if (!_capabilities) _capabilities = await detectCapabilities();
  return _capabilities;
}

// ─── AR Session State ───

let arSession = null;
let arHitTestSource = null;
let arReferenceSpace = null;
let arReticle = null;       // placement marker
let arPreviewMesh = null;   // ghost furniture
let arPlacedItems = [];     // items placed during AR session
let arCurrentType = null;   // furniture type being placed

// ─── Reticle (placement marker) ───

function createReticle() {
  const ring = new THREE.RingGeometry(0.12, 0.2, 32).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4488ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(ring, mat);
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ─── WebXR AR Furniture Placement (Android Chrome) ───

async function startWebXRAR(mode) {
  const renderer = state.renderer;
  if (!renderer) return;

  try {
    const overlay = document.getElementById('ar-overlay');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: overlay ? { root: overlay } : undefined
    });

    arSession = session;
    renderer.xr.setReferenceSpaceType('local');
    renderer.xr.setSession(session);

    // Show overlay
    if (overlay) overlay.classList.add('visible');

    // Update status text
    const status = document.getElementById('ar-status');
    if (status) {
      status.textContent = mode === 'ar-table'
        ? 'Pek mot en flat overflate'
        : 'Pek telefonen mot gulvet';
    }

    // Create reticle
    arReticle = createReticle();
    state.scene.add(arReticle);

    // Create preview mesh for furniture mode
    if (mode === 'ar-furniture' && arCurrentType) {
      arPreviewMesh = createFurnitureMesh(arCurrentType);
      if (arPreviewMesh) {
        arPreviewMesh.traverse(child => {
          if (child.isMesh) {
            child.material = child.material.clone();
            child.material.transparent = true;
            child.material.opacity = 0.5;
          }
        });
        arPreviewMesh.visible = false;
        state.scene.add(arPreviewMesh);
      }
    } else if (mode === 'ar-table') {
      arPreviewMesh = buildTableModelScene();
      if (arPreviewMesh) {
        arPreviewMesh.visible = false;
        state.scene.add(arPreviewMesh);
      }
    }

    // Set up hit testing once session starts
    session.addEventListener('end', onARSessionEnd);

    // Request hit test source after reference space is available
    session.requestReferenceSpace('viewer').then(viewerSpace => {
      session.requestHitTestSource({ space: viewerSpace }).then(source => {
        arHitTestSource = source;
      });
    });

    session.requestReferenceSpace('local').then(refSpace => {
      arReferenceSpace = refSpace;
    });

    // Notify state
    setXRMode(mode);
    document.body.classList.add('xr-active');

  } catch (e) {
    console.warn('AR session failed:', e);
    const status = document.getElementById('ar-status');
    if (status) status.textContent = 'AR ikke tilgjengelig: ' + e.message;
  }
}

function onARSessionEnd() {
  // Clean up
  if (arReticle) {
    state.scene.remove(arReticle);
    arReticle = null;
  }
  if (arPreviewMesh && !arPlacedItems.includes(arPreviewMesh)) {
    state.scene.remove(arPreviewMesh);
  }
  arPreviewMesh = null;
  arHitTestSource = null;
  arReferenceSpace = null;
  arSession = null;
  arCurrentType = null;
  arPlacedItems = [];

  // Hide overlay
  const overlay = document.getElementById('ar-overlay');
  if (overlay) overlay.classList.remove('visible');

  // Restore state
  setXRMode(null);
  document.body.classList.remove('xr-active');
}

// Called each frame from scene.js animation loop when in AR mode
export function updateAR(frame) {
  if (!arHitTestSource || !arReferenceSpace || !frame) return;

  const hitTestResults = frame.getHitTestResults(arHitTestSource);

  if (hitTestResults.length > 0) {
    const hit = hitTestResults[0];
    const pose = hit.getPose(arReferenceSpace);

    if (pose) {
      // Update reticle
      if (arReticle) {
        arReticle.visible = true;
        arReticle.matrix.fromArray(pose.transform.matrix);
      }

      // Update preview mesh position
      if (arPreviewMesh) {
        arPreviewMesh.visible = true;
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.transform.matrix));
        arPreviewMesh.position.copy(pos);
      }
    }
  } else {
    if (arReticle) arReticle.visible = false;
    if (arPreviewMesh) arPreviewMesh.visible = false;
  }
}

// ─── Place action (confirm placement) ───

function placeItem() {
  if (!arPreviewMesh || !arPreviewMesh.visible) return;

  // Make the preview permanent
  arPreviewMesh.traverse(child => {
    if (child.isMesh && child.material.transparent) {
      child.material.opacity = 1.0;
      child.material.transparent = false;
    }
  });
  arPlacedItems.push(arPreviewMesh);

  // Create new preview for next placement (furniture mode only)
  if (state.xrMode === 'ar-furniture' && arCurrentType) {
    arPreviewMesh = createFurnitureMesh(arCurrentType);
    if (arPreviewMesh) {
      arPreviewMesh.traverse(child => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.transparent = true;
          child.material.opacity = 0.5;
        }
      });
      arPreviewMesh.visible = false;
      state.scene.add(arPreviewMesh);
    }
  } else {
    arPreviewMesh = null;
  }

  // Update status
  const status = document.getElementById('ar-status');
  if (status) status.textContent = 'Plassert! Pek for å plassere flere, eller trykk Avbryt.';
}

function cancelAR() {
  if (arSession) {
    arSession.end();
  }
}

// ─── iOS Fallback: model-viewer + GLB export ───

async function startModelViewerAR(furnitureType) {
  const mesh = furnitureType ? createFurnitureMesh(furnitureType) : buildTableModelScene();
  if (!mesh) return;

  // Export to GLB
  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(mesh, resolve, reject, { binary: true });
  });

  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);

  // Create model-viewer element
  const wrap = document.getElementById('ar-model-viewer-wrap');
  if (!wrap) return;

  wrap.innerHTML = '';
  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', url);
  mv.setAttribute('ar', '');
  mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  mv.setAttribute('camera-controls', '');
  mv.setAttribute('touch-action', 'pan-y');
  mv.setAttribute('style', 'width:100%;height:400px;background:transparent');
  mv.setAttribute('auto-rotate', '');

  // For iOS: also provide USDZ if possible
  // model-viewer handles USDZ conversion automatically for iOS AR Quick Look

  wrap.appendChild(mv);

  // Show overlay
  const overlay = document.getElementById('ar-overlay');
  if (overlay) overlay.classList.add('visible');

  // The model-viewer component handles the AR session itself
  // When user clicks the AR button inside model-viewer, it opens AR Quick Look on iOS
}

// ─── Table Model: Scene Snapshot ───

function buildTableModelScene() {
  const scene = state.scene;
  if (!scene) return null;

  const group = new THREE.Group();
  const scale = 0.05; // 1:20

  // Clone relevant scene children
  scene.children.forEach(child => {
    // Skip helpers, lights, grid, cameras, VR rig, AR elements
    if (child.isLight || child.isCamera || child === state.vrRig) return;
    if (child.isGridHelper) return;
    if (child === arReticle) return;
    if (child.name === 'TeleportMarker') return;

    try {
      const clone = child.clone(true);
      // Clone materials to avoid cross-contamination
      clone.traverse(obj => {
        if (obj.isMesh && obj.material) {
          obj.material = Array.isArray(obj.material)
            ? obj.material.map(m => m.clone())
            : obj.material.clone();
        }
      });
      group.add(clone);
    } catch (e) {
      // Skip objects that can't be cloned
    }
  });

  // Scale to miniature
  group.scale.setScalar(scale);

  // Center the model
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);
  group.position.y -= box.min.y; // Sit on surface

  return group;
}

// ─── Public API ───

export async function startARFurniture(furnitureType) {
  arCurrentType = furnitureType || 'stol';
  const caps = await isARSupported();

  if (caps.webxrAR) {
    await startWebXRAR('ar-furniture');
  } else if (caps.isIOS || caps.hasModelViewer) {
    await startModelViewerAR(furnitureType);
  } else {
    alert('AR er ikke støttet på denne enheten.');
  }
}

export async function startARTableModel() {
  const caps = await isARSupported();

  if (caps.webxrAR) {
    await startWebXRAR('ar-table');
  } else if (caps.isIOS || caps.hasModelViewer) {
    await startModelViewerAR(null); // null = full scene
  } else {
    alert('AR er ikke støttet på denne enheten.');
  }
}

// ─── Init: wire UI buttons, check capabilities ───

export async function initAR() {
  const caps = await isARSupported();

  // Wire window functions for HTML onclick
  window._startARFurniture = () => startARFurniture();
  window._startARTableModel = () => startARTableModel();
  window._arPlace = () => placeItem();
  window._arCancel = () => cancelAR();

  // Enable AR toolbar button if any AR method is supported
  const arBtn = document.getElementById('toolbar-ar');
  const arSupported = caps.webxrAR || caps.isIOS || caps.hasModelViewer;
  if (arBtn) {
    arBtn.disabled = !arSupported;
    arBtn.title = arSupported ? 'AR' : 'AR ikke støttet';
  }

  // Enable popover buttons
  const furnitureBtn = document.getElementById('ar-furniture-btn');
  const tableBtn = document.getElementById('ar-table-btn');
  const vrBtn = document.getElementById('ar-vr-btn');

  if (furnitureBtn) furnitureBtn.disabled = !arSupported;
  if (tableBtn) tableBtn.disabled = !arSupported;

  // VR button in popover — check VR support
  if (vrBtn && navigator.xr) {
    try {
      const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
      vrBtn.disabled = !vrSupported;
    } catch (e) {
      vrBtn.disabled = true;
    }
  }
}
