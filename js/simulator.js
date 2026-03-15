import * as THREE from 'three';
import { state } from './state.js';
import { CEIL, ceilAt } from './room.js';

// ─── SWING FORMULAS ───
function swingHeight(heightCm, clubLen) {
  return (heightCm / 100) * 0.80 + clubLen * Math.sin(75 * Math.PI / 180);
}
function backswingOffset(clubLen) {
  return clubLen * 0.4;
}
function swingRadius(heightCm, clubLen) {
  const armLen = (heightCm / 100) * 0.36;
  return armLen + clubLen;
}

// ─── SIMULATOR STATE ───
let screenMesh, matMesh, golferGroup, ballMesh;
let arcMatGreen, arcMatRed, bsMatOrange, bsMatRed;

export function initSimulator() {
  const { scene } = state;
  const simGroup = new THREE.Group();

  const screenW = 2.5, screenH = 2.0;
  const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
  screenMesh = new THREE.Mesh(screenGeo, new THREE.MeshLambertMaterial({ color: 0x333333, side: THREE.DoubleSide }));
  screenMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(screenGeo), new THREE.LineBasicMaterial({ color: 0x666666 })));
  simGroup.add(screenMesh);

  const matW = 1.5, matD = 1.2;
  matMesh = new THREE.Mesh(
    new THREE.BoxGeometry(matW, 0.02, matD),
    new THREE.MeshLambertMaterial({ color: 0x2D7A2D })
  );
  matMesh.position.y = 0.01;
  simGroup.add(matMesh);

  golferGroup = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x4466AA });
  const bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 0.9, 8), bodyMat);
  bodyMesh.position.y = 0.9;
  golferGroup.add(bodyMesh);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), bodyMat);
  headMesh.position.y = 1.5;
  golferGroup.add(headMesh);
  simGroup.add(golferGroup);

  arcMatGreen = new THREE.MeshBasicMaterial({ color: 0x00FF66, depthTest: false });
  arcMatRed = new THREE.MeshBasicMaterial({ color: 0xFF3333, depthTest: false });
  bsMatOrange = new THREE.MeshBasicMaterial({ color: 0xFFAA00, depthTest: false });
  bsMatRed = new THREE.MeshBasicMaterial({ color: 0xFF3333, depthTest: false });

  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xFFFFFF })
  );
  simGroup.add(ballMesh);

  scene.add(simGroup);
  state.simGroup = simGroup;

  // Toggle
  document.getElementById('simToggle').addEventListener('change', (e) => {
    simGroup.visible = e.target.checked;
    document.getElementById('simControls').style.display = e.target.checked ? '' : 'none';
  });

  // Control wiring
  document.getElementById('hSlider').addEventListener('input', updateSimulator);
  document.getElementById('clubSelect').addEventListener('change', updateSimulator);
  document.querySelectorAll('input[name="dir"]').forEach(r => r.addEventListener('change', updateSimulator));
  document.getElementById('simXSlider').addEventListener('input', updateSimulator);
  document.getElementById('simZSlider').addEventListener('input', updateSimulator);
}

function setVal(id, val, unit) {
  const el = document.getElementById(id);
  el.textContent = val.toFixed(2) + unit;
  el.className = 'val ' + (val > 0.3 ? 'ok' : val > 0.05 ? 'tight' : 'bad');
}

export function updateSimulator() {
  const heightCm = parseInt(document.getElementById('hSlider').value);
  const clubLen = parseFloat(document.getElementById('clubSelect').value);
  const dir = document.querySelector('input[name="dir"]:checked').value;
  const simX = parseFloat(document.getElementById('simXSlider').value);
  const simZ = parseFloat(document.getElementById('simZSlider').value);

  document.getElementById('hVal').textContent = heightCm;
  document.getElementById('simXVal').textContent = simX.toFixed(1);
  document.getElementById('simZVal').textContent = simZ.toFixed(1);

  const heightM = heightCm / 100;
  const sR = swingRadius(heightCm, clubLen);
  const sH = swingHeight(heightCm, clubLen);

  let golferX = simX, golferZ = simZ;
  let screenX, screenZ, screenRotY = 0;

  if (dir === 'window') {
    screenX = golferX;
    screenZ = CEIL.windowZ + 0.3;
    screenRotY = 0;
  } else {
    screenX = CEIL.roomMaxX - 0.3;
    screenZ = golferZ;
    screenRotY = Math.PI / 2;
  }

  golferGroup.position.set(golferX, 0, golferZ);
  golferGroup.scale.y = heightM / 1.80;
  matMesh.position.set(golferX, 0.01, golferZ);
  screenMesh.position.set(screenX, 2.0 / 2 + 0.1, screenZ);
  screenMesh.rotation.y = screenRotY;

  const ceilH = ceilAt(golferZ);
  const ceilClearance = ceilH - sH;
  const hemsDist = CEIL.hemskantZ - golferZ;
  const sideL = golferX - CEIL.roomMinX;
  const sideR = CEIL.roomMaxX - golferX;
  const screenDist = dir === 'window'
    ? Math.abs(golferZ - screenZ) - 0.5
    : Math.abs(golferX - screenX) - 0.5;

  // Swing arc
  const swingPlaneAngle = 70 * Math.PI / 180;
  const pivotY = heightM * 0.55;

  function clubPos(theta) {
    const y = pivotY - sR * Math.cos(theta) * Math.sin(swingPlaneAngle);
    const alongTarget = sR * Math.sin(theta) * Math.cos(swingPlaneAngle);
    const lateral = sR * Math.sin(theta) * 0.15;
    if (dir === 'window') {
      return new THREE.Vector3(golferX + lateral, Math.max(0, y), golferZ + alongTarget);
    } else {
      return new THREE.Vector3(golferX - alongTarget, Math.max(0, y), golferZ + lateral);
    }
  }

  ballMesh.position.copy(clubPos(0));

  const dsPoints = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const theta = (1 - t) * (150 * Math.PI / 180) + t * (-70 * Math.PI / 180);
    dsPoints.push(clubPos(theta));
  }

  const simGroup = state.simGroup;

  if (state.arcMesh) { simGroup.remove(state.arcMesh); state.arcMesh.geometry.dispose(); }
  if (dsPoints.length > 1) {
    const curve = new THREE.CatmullRomCurve3(dsPoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 40, 0.04, 8, false);
    const ok = ceilClearance > 0.15 && Math.min(sideL, sideR) > sR * 0.3;
    state.arcMesh = new THREE.Mesh(tubeGeo, ok ? arcMatGreen : arcMatRed);
    simGroup.add(state.arcMesh);
  }

  const bsArcPoints = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const theta = t * (150 * Math.PI / 180);
    bsArcPoints.push(clubPos(theta));
  }

  if (state.bsMesh) { simGroup.remove(state.bsMesh); state.bsMesh.geometry.dispose(); }
  if (bsArcPoints.length > 1) {
    const bsCurve = new THREE.CatmullRomCurve3(bsArcPoints);
    const bsTubeGeo = new THREE.TubeGeometry(bsCurve, 20, 0.035, 8, false);
    state.bsMesh = new THREE.Mesh(bsTubeGeo, ceilClearance > 0.05 ? bsMatOrange : bsMatRed);
    simGroup.add(state.bsMesh);
  }

  setVal('cCeil', ceilClearance, 'm');
  setVal('cHems', hemsDist, 'm');
  setVal('cSideL', sideL, 'm');
  setVal('cSideR', sideR, 'm');
  document.getElementById('cScreen').textContent = screenDist.toFixed(2) + 'm';
  document.getElementById('cSwing').textContent = sR.toFixed(2) + 'm';
}
