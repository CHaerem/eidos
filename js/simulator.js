import * as THREE from 'three';
import { state } from './state.js';
import { CEIL, BOUNDS, ceilAt } from './room.js';

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
let enclosureGroup = null;
const netMat = new THREE.MeshBasicMaterial({
  color: 0x888888, transparent: true, opacity: 0.08,
  side: THREE.DoubleSide, depthWrite: false
});
const netWireMat = new THREE.LineBasicMaterial({
  color: 0x666666, transparent: true, opacity: 0.2
});

export function initSimulator() {
  const { scene } = state;
  const simGroup = new THREE.Group();

  const screenW = 2.5, screenH = 2.0;
  const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
  screenMesh = new THREE.Mesh(screenGeo, new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide, roughness: 0.3, metalness: 0.0 }));
  screenMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(screenGeo), new THREE.LineBasicMaterial({ color: 0x666666 })));
  simGroup.add(screenMesh);

  const matW = 1.5, matD = 1.2;
  matMesh = new THREE.Mesh(
    new THREE.BoxGeometry(matW, 0.02, matD),
    new THREE.MeshStandardMaterial({ color: 0x2D7A2D, roughness: 0.8, metalness: 0.0 })
  );
  matMesh.position.y = 0.01;
  simGroup.add(matMesh);

  golferGroup = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4466AA, roughness: 0.6, metalness: 0.0 });
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

  // Enclosure net group — updated dynamically in updateSimulator
  enclosureGroup = new THREE.Group();
  enclosureGroup.name = 'Enclosure';
  simGroup.add(enclosureGroup);

  scene.add(simGroup);
  state.simGroup = simGroup;

  // Load defaults from config
  const simCfg = state.apartmentConfig?.simulator || {};

  // Update simulator slider ranges from config bounds
  const simXSlider = document.getElementById('simXSlider');
  const simZSlider = document.getElementById('simZSlider');
  const hSlider = document.getElementById('hSlider');
  const clubSelect = document.getElementById('clubSelect');
  if (simXSlider) {
    simXSlider.min = (BOUNDS.minX + 0.5).toFixed(2);
    simXSlider.max = (BOUNDS.maxX - 0.5).toFixed(2);
    if (simCfg.posX != null) simXSlider.value = simCfg.posX;
  }
  if (simZSlider) {
    simZSlider.min = (BOUNDS.minZ + 0.5).toFixed(2);
    simZSlider.max = (BOUNDS.maxZ - 0.5).toFixed(2);
    if (simCfg.posZ != null) simZSlider.value = simCfg.posZ;
  }
  if (hSlider && simCfg.playerHeight) hSlider.value = simCfg.playerHeight;
  if (clubSelect && simCfg.club) clubSelect.value = simCfg.club;
  if (simCfg.direction) {
    const dirRadio = document.querySelector(`input[name="dir"][value="${simCfg.direction}"]`);
    if (dirRadio) dirRadio.checked = true;
  }

  // Toggle
  document.getElementById('simToggle').addEventListener('change', (e) => {
    simGroup.visible = e.target.checked;
    document.getElementById('simControls').style.display = e.target.checked ? '' : 'none';
  });

  // Control wiring
  document.getElementById('hSlider').addEventListener('input', updateSimulator);
  const clubEl = document.getElementById('clubSelect');
  if (clubEl) clubEl.addEventListener('change', updateSimulator);
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
  const clubEl = document.getElementById('clubSelect');
  const clubLen = clubEl ? parseFloat(clubEl.value) : 0.940; // default 7-iron
  const dirEl = document.querySelector('input[name="dir"]:checked');
  const dir = dirEl ? dirEl.value : 'window';
  const simX = parseFloat(document.getElementById('simXSlider').value);
  const simZ = parseFloat(document.getElementById('simZSlider').value);

  document.getElementById('hVal').textContent = heightCm;
  document.getElementById('simXVal').textContent = simX.toFixed(1);
  document.getElementById('simZVal').textContent = simZ.toFixed(1);

  // Persist simulator settings to config
  if (state.apartmentConfig) {
    const sim = state.apartmentConfig.simulator || {};
    sim.playerHeight = heightCm;
    sim.posX = simX;
    sim.posZ = simZ;
    sim.club = clubEl ? clubEl.value : '0.940';
    sim.direction = dir;
    state.apartmentConfig.simulator = sim;
  }

  const heightM = heightCm / 100;
  const sR = swingRadius(heightCm, clubLen);
  const sH = swingHeight(heightCm, clubLen);

  let golferX = simX, golferZ = simZ;
  let screenX, screenZ, screenRotY = 0;

  // Screen placement — uses config-driven BOUNDS
  const screenOffset = (state.apartmentConfig && state.apartmentConfig.simulator && state.apartmentConfig.simulator.screenDistance) || 0.3;
  if (dir === 'window') {
    screenX = golferX;
    screenZ = BOUNDS.minZ + screenOffset;
    screenRotY = 0;
  } else {
    screenX = BOUNDS.maxX - screenOffset;
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
  const sideL = golferX - BOUNDS.minX;
  const sideR = BOUNDS.maxX - golferX;
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

  // ─── Enclosure net ───
  const encCfg = state.apartmentConfig?.simulator?.enclosure || {};
  const screenW = 2.5, screenH = 2.0;
  const matW = 1.5, matD = 1.2;

  // Auto-calculate or use custom dimensions
  const bsOff = backswingOffset(clubLen);
  const boxW = (encCfg.auto === false && encCfg.width) ? encCfg.width : 2 * sR + 0.5;
  const boxD = (encCfg.auto === false && encCfg.depth) ? encCfg.depth : bsOff + matD + 1.0;
  const boxH = (encCfg.auto === false && encCfg.height) ? encCfg.height : sH + 0.3;

  // Build enclosure — 4 net panels (left, right, top, back) + wireframe edges
  if (enclosureGroup && encCfg.visible !== false) {
    // Clear previous
    while (enclosureGroup.children.length) {
      const c = enclosureGroup.children[0];
      enclosureGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }

    // Box centered on golfer, extending forward toward screen and back for backswing
    const frontZ = dir === 'window' ? golferZ - boxD * 0.7 : golferZ;
    const backZ = dir === 'window' ? golferZ + boxD * 0.3 : golferZ;
    const leftX = dir === 'window' ? golferX - boxW / 2 : golferX - boxD * 0.3;
    const rightX = dir === 'window' ? golferX + boxW / 2 : golferX + boxD * 0.7;
    const topY = boxH;

    let cx, cz, w, d;
    if (dir === 'window') {
      cx = golferX;
      cz = (frontZ + backZ) / 2;
      w = boxW;
      d = boxD;
    } else {
      cx = (leftX + rightX) / 2;
      cz = golferZ;
      w = boxD;
      d = boxW;
    }

    // Side panels (left, right)
    const sideGeoL = new THREE.PlaneGeometry(d, topY);
    const sideL_mesh = new THREE.Mesh(sideGeoL, netMat);
    sideL_mesh.rotation.y = Math.PI / 2;
    sideL_mesh.position.set(cx - w / 2, topY / 2, cz);
    enclosureGroup.add(sideL_mesh);

    const sideGeoR = new THREE.PlaneGeometry(d, topY);
    const sideR_mesh = new THREE.Mesh(sideGeoR, netMat);
    sideR_mesh.rotation.y = Math.PI / 2;
    sideR_mesh.position.set(cx + w / 2, topY / 2, cz);
    enclosureGroup.add(sideR_mesh);

    // Top panel
    const topGeo = new THREE.PlaneGeometry(w, d);
    const topMesh = new THREE.Mesh(topGeo, netMat);
    topMesh.rotation.x = -Math.PI / 2;
    topMesh.position.set(cx, topY, cz);
    enclosureGroup.add(topMesh);

    // Back panel (behind golfer)
    const backGeo = new THREE.PlaneGeometry(w, topY);
    const backZ_pos = dir === 'window' ? cz + d / 2 : cz + d / 2;
    const backMesh = new THREE.Mesh(backGeo, netMat);
    backMesh.position.set(cx, topY / 2, backZ_pos);
    enclosureGroup.add(backMesh);

    // Wireframe box outline for clarity
    const boxGeo = new THREE.BoxGeometry(w, topY, d);
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      netWireMat
    );
    wireframe.position.set(cx, topY / 2, cz);
    enclosureGroup.add(wireframe);

    enclosureGroup.visible = true;
  } else if (enclosureGroup) {
    enclosureGroup.visible = false;
  }

  // Update dimension displays
  const matEl = document.getElementById('simMat');
  if (matEl) matEl.textContent = `${matW} × ${matD}m`;
  const scrEl = document.getElementById('simScreen');
  if (scrEl) scrEl.textContent = `${screenW} × ${screenH}m`;
  const boxEl = document.getElementById('simBox');
  if (boxEl) {
    boxEl.textContent = `${boxW.toFixed(1)} × ${boxD.toFixed(1)} × ${boxH.toFixed(1)}m`;
    // Color based on fit
    const fits = boxW < (BOUNDS.maxX - BOUNDS.minX) && boxH < ceilH;
    const tight = ceilClearance < 0.1 || Math.min(sideL, sideR) < boxW / 2 + 0.1;
    boxEl.className = 'val ' + (fits && !tight ? 'ok' : fits ? 'tight' : 'bad');
  }
}
