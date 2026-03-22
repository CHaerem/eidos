// ─── AR MODULE ───
// WebXR AR furniture placement + table model, with iOS model-viewer/Quick Look fallback.

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

  // model-viewer may load async — check both now and after a short delay
  result.hasModelViewer = typeof customElements !== 'undefined' &&
    !!customElements.get('model-viewer');

  if (navigator.xr) {
    try {
      result.webxrAR = await navigator.xr.isSessionSupported('immersive-ar');
      result.hitTest = result.webxrAR;
    } catch (e) {
      // WebXR not available
    }
  }
  return result;
}

export async function isARSupported() {
  if (!_capabilities) _capabilities = await detectCapabilities();
  // Re-check model-viewer (it loads async from CDN)
  if (!_capabilities.hasModelViewer && typeof customElements !== 'undefined') {
    _capabilities.hasModelViewer = !!customElements.get('model-viewer');
  }
  return _capabilities;
}

// ─── AR Session State ───

let arSession = null;
let arHitTestSource = null;
let arReferenceSpace = null;
let arReticle = null;
let arPreviewMesh = null;
let arPlacedItems = [];
let arCurrentType = null;

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

// ─── GLB Export Helper ───

async function exportToGLB(object3D) {
  // Add temporary lights so GLB has decent shading in Quick Look
  const exportScene = new THREE.Scene();
  exportScene.add(object3D);

  // Add lights to the export scene for better appearance in AR viewers
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  exportScene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(2, 4, 3);
  exportScene.add(dirLight);

  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(exportScene, resolve, reject, {
      binary: true,
      embedImages: true,
      forceIndices: true,
      truncateDrawRange: true,
    });
  });

  // Clean up
  exportScene.remove(object3D);

  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  return URL.createObjectURL(blob);
}

// ─── Furniture mesh preparation for export ───

function prepareFurnitureForExport(type) {
  const mesh = createFurnitureMesh(type);
  if (!mesh) return null;

  // Ensure all materials use MeshStandardMaterial for proper GLB export
  mesh.traverse(child => {
    if (child.isMesh) {
      const mat = child.material;
      if (mat && !mat.isMeshStandardMaterial) {
        const stdMat = new THREE.MeshStandardMaterial({
          color: mat.color || new THREE.Color(0x888888),
          roughness: 0.7,
          metalness: 0.0,
          transparent: mat.transparent || false,
          opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
        });
        child.material = stdMat;
      }
    }
  });

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

    // Show overlay with WebXR controls
    showAROverlay('webxr', mode);

    // Create reticle
    arReticle = createReticle();
    state.scene.add(arReticle);

    // Create preview mesh
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

    session.addEventListener('end', onARSessionEnd);

    session.requestReferenceSpace('viewer').then(viewerSpace => {
      session.requestHitTestSource({ space: viewerSpace }).then(source => {
        arHitTestSource = source;
      });
    });

    session.requestReferenceSpace('local').then(refSpace => {
      arReferenceSpace = refSpace;
    });

    setXRMode(mode);
    document.body.classList.add('xr-active');

  } catch (e) {
    console.warn('AR session failed:', e);
  }
}

function onARSessionEnd() {
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

  hideAROverlay();
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
      if (arReticle) {
        arReticle.visible = true;
        arReticle.matrix.fromArray(pose.transform.matrix);
      }
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

// ─── Place / Cancel ───

function placeItem() {
  if (!arPreviewMesh || !arPreviewMesh.visible) return;

  arPreviewMesh.traverse(child => {
    if (child.isMesh && child.material.transparent) {
      child.material.opacity = 1.0;
      child.material.transparent = false;
    }
  });
  arPlacedItems.push(arPreviewMesh);

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
}

function cancelAR() {
  if (arSession) {
    arSession.end();
  } else {
    // iOS/model-viewer mode — just hide the overlay
    hideAROverlay();
  }
}

// ─── AR Overlay UI Management ───

function showAROverlay(mode, arType) {
  const overlay = document.getElementById('ar-overlay');
  if (!overlay) return;

  const status = document.getElementById('ar-status');
  const controls = document.getElementById('ar-controls');
  const mvWrap = document.getElementById('ar-model-viewer-wrap');

  if (mode === 'webxr') {
    // WebXR mode: show place/cancel buttons
    if (status) status.textContent = arType === 'ar-table'
      ? 'Pek mot en flat overflate'
      : 'Pek telefonen mot gulvet';
    if (controls) controls.style.display = 'flex';
    if (mvWrap) mvWrap.style.display = 'none';
  } else if (mode === 'model-viewer') {
    // model-viewer mode: show the 3D viewer
    if (status) status.textContent = 'Trykk AR-knappen for å se i rommet ditt';
    if (controls) controls.style.display = 'none';
    if (mvWrap) mvWrap.style.display = 'block';
  }

  overlay.classList.add('visible');
}

function hideAROverlay() {
  const overlay = document.getElementById('ar-overlay');
  if (overlay) overlay.classList.remove('visible');

  // Clean up model-viewer
  const mvWrap = document.getElementById('ar-model-viewer-wrap');
  if (mvWrap) {
    // Revoke blob URLs to free memory
    const mv = mvWrap.querySelector('model-viewer');
    if (mv) {
      const src = mv.getAttribute('src');
      if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);
    }
    mvWrap.innerHTML = '';
  }
}

// ─── iOS model-viewer + Quick Look Fallback ───

async function startModelViewerAR(furnitureType, isTableModel = false) {
  // Show loading state
  const overlay = document.getElementById('ar-overlay');
  const status = document.getElementById('ar-status');
  if (overlay) overlay.classList.add('visible');
  if (status) status.textContent = 'Forbereder 3D-modell...';

  const controls = document.getElementById('ar-controls');
  if (controls) controls.style.display = 'none';

  try {
    // Create mesh
    let mesh;
    let title;
    if (isTableModel) {
      mesh = buildTableModelScene();
      title = 'Leilighetsmodell (1:20)';
    } else {
      mesh = prepareFurnitureForExport(furnitureType);
      const catEntry = FURNITURE_CATALOG[furnitureType];
      title = catEntry ? catEntry.name : furnitureType;
    }

    if (!mesh) {
      if (status) status.textContent = 'Kunne ikke lage 3D-modell.';
      return;
    }

    // Export to GLB
    const glbUrl = await exportToGLB(mesh);

    // Create model-viewer element
    const mvWrap = document.getElementById('ar-model-viewer-wrap');
    if (!mvWrap) return;

    mvWrap.innerHTML = '';

    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', glbUrl);
    mv.setAttribute('ar', '');
    mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
    mv.setAttribute('ar-scale', 'auto');
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('touch-action', 'pan-y');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('shadow-intensity', '1');
    mv.setAttribute('environment-image', 'neutral');
    mv.setAttribute('alt', title);
    mv.style.cssText = 'width:100%;height:55vh;background:transparent;--poster-color:transparent;';

    // AR button text (shown inside model-viewer)
    mv.setAttribute('ar-button-text', 'Se i rommet ditt');

    // Slot for custom AR button styling
    const arBtn = document.createElement('button');
    arBtn.setAttribute('slot', 'ar-button');
    arBtn.className = 'mv-ar-button';
    arBtn.textContent = '📱 Se i rommet ditt';
    mv.appendChild(arBtn);

    mvWrap.appendChild(mv);

    // Update status
    if (status) status.textContent = title;

    // Show model-viewer mode
    showAROverlay('model-viewer', null);

    // Add close button functionality
    const cancelBtn = document.getElementById('ar-cancel');
    if (cancelBtn) {
      cancelBtn.style.display = 'block';
      cancelBtn.onclick = () => hideAROverlay();
    }

  } catch (e) {
    console.warn('Model-viewer AR failed:', e);
    if (status) status.textContent = 'Feil ved eksport: ' + e.message;
  }
}

// ─── Table Model: Scene Snapshot ───

function buildTableModelScene() {
  const scene = state.scene;
  if (!scene) return null;

  const group = new THREE.Group();
  const scale = 0.05; // 1:20

  scene.children.forEach(child => {
    if (child.isLight || child.isCamera || child === state.vrRig) return;
    if (child.isGridHelper) return;
    if (child === arReticle) return;
    if (child.name === 'TeleportMarker') return;

    try {
      const clone = child.clone(true);
      clone.traverse(obj => {
        if (obj.isMesh && obj.material) {
          // Clone and convert to StandardMaterial for GLB compatibility
          const srcMat = Array.isArray(obj.material) ? obj.material : [obj.material];
          const newMats = srcMat.map(m => {
            if (m.isMeshStandardMaterial) return m.clone();
            return new THREE.MeshStandardMaterial({
              color: m.color || new THREE.Color(0x888888),
              roughness: 0.7,
              metalness: 0.0,
              transparent: m.transparent || false,
              opacity: m.opacity !== undefined ? m.opacity : 1.0,
              side: m.side !== undefined ? m.side : THREE.FrontSide,
            });
          });
          obj.material = newMats.length === 1 ? newMats[0] : newMats;
        }
      });
      group.add(clone);
    } catch (e) {
      // Skip
    }
  });

  group.scale.setScalar(scale);

  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return group;
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);
  group.position.y -= box.min.y;

  return group;
}

// ─── Public API ───

export async function startARFurniture(furnitureType) {
  arCurrentType = furnitureType || 'stol';
  const caps = await isARSupported();

  if (caps.webxrAR) {
    await startWebXRAR('ar-furniture');
  } else if (caps.isIOS || caps.hasModelViewer) {
    await startModelViewerAR(furnitureType, false);
  } else {
    alert('AR er ikke støttet på denne enheten.');
  }
}

export async function startARTableModel() {
  const caps = await isARSupported();

  if (caps.webxrAR) {
    await startWebXRAR('ar-table');
  } else if (caps.isIOS || caps.hasModelViewer) {
    await startModelViewerAR(null, true);
  } else {
    alert('AR er ikke støttet på denne enheten.');
  }
}

// Start AR with a specific furniture type from the catalog
export async function startARWithType(type) {
  arCurrentType = type;
  const caps = await isARSupported();

  if (caps.webxrAR) {
    await startWebXRAR('ar-furniture');
  } else if (caps.isIOS || caps.hasModelViewer) {
    await startModelViewerAR(type, false);
  } else {
    alert('AR er ikke støttet på denne enheten.');
  }
}

// ─── Init ───

export async function initAR() {
  // Wait a moment for model-viewer to register as custom element
  await new Promise(r => setTimeout(r, 500));
  const caps = await isARSupported();

  // Wire window functions for HTML onclick
  window._startARFurniture = () => startARFurniture();
  window._startARTableModel = () => startARTableModel();
  window._startARWithType = (type) => startARWithType(type);
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
  const tableBtn = document.getElementById('ar-table-btn');
  const vrBtn = document.getElementById('ar-vr-btn');

  if (tableBtn) tableBtn.disabled = !arSupported;

  // VR button in popover
  if (vrBtn && navigator.xr) {
    try {
      const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
      vrBtn.disabled = !vrSupported;
    } catch (e) {
      vrBtn.disabled = true;
    }
  }

  // Populate furniture picker in AR popover
  populateARFurniturePicker();
}

// ─── AR Furniture Picker (for popover) ───

function populateARFurniturePicker() {
  const picker = document.getElementById('ar-furniture-picker');
  if (!picker) return;

  picker.innerHTML = '';
  for (const [type, item] of Object.entries(FURNITURE_CATALOG)) {
    const btn = document.createElement('button');
    btn.className = 'ar-furniture-item';
    btn.textContent = item.name;
    btn.onclick = () => startARWithType(type);
    picker.appendChild(btn);
  }
}
