import * as THREE from 'three';
import { state } from './state.js';
import { CEIL, BOUNDS, ceilAt } from './room.js';

// ─── ENCLOSURE PRESETS (real products) ───
const ENCLOSURE_PRESETS = {
  auto:       { name: 'Auto (fra sving)',     width: null, height: null, depth: null },
  sim1:       { name: 'SimSpace SIM 1',       width: 2.6,  height: 2.5,  depth: 1.5 },
  sim2:       { name: 'SimSpace SIM 2',       width: 3.0,  height: 2.5,  depth: 1.5 },
  sim3:       { name: 'SimSpace SIM 3',       width: 3.6,  height: 2.5,  depth: 1.5 },
  sim4:       { name: 'SimSpace SIM 4',       width: 4.0,  height: 2.5,  depth: 1.5 },
  sim5:       { name: 'SimSpace SIM 5',       width: 3.0,  height: 3.0,  depth: 3.0 },
  sim6:       { name: 'SimSpace SIM 6',       width: 4.0,  height: 3.0,  depth: 3.0 },
  slim:       { name: 'SimSpace SLIM',        width: 3.4,  height: 2.6,  depth: 1.1 },
  microbay:   { name: 'MicroBay',             width: 3.0,  height: 2.4,  depth: 0.6 },
  skytrak8:   { name: 'SkyTrak 8ft Studio',   width: 2.4,  height: 2.4,  depth: 1.5 },
  custom:     { name: 'Egendefinert',         width: 3.0,  height: 2.5,  depth: 1.5 },
};

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

// Realistic net material — dark semi-transparent like real golf sim netting
const netMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a1a, transparent: true, opacity: 0.55,
  side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0
});
// Frame poles material — dark metal
const frameMat = new THREE.MeshStandardMaterial({
  color: 0x2a2a2a, roughness: 0.4, metalness: 0.6
});

export function initSimulator() {
  const { scene } = state;
  const simGroup = new THREE.Group();

  const screenW = 2.5, screenH = 2.0;
  const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
  screenMesh = new THREE.Mesh(screenGeo, new THREE.MeshStandardMaterial({
    color: 0xDDDDDD, side: THREE.DoubleSide, roughness: 0.15, metalness: 0.0,
    emissive: 0x222222, emissiveIntensity: 0.3
  }));
  screenMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(screenGeo), new THREE.LineBasicMaterial({ color: 0x444444 })));
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
  const encPresetEl = document.getElementById('enclosurePreset');
  if (encPresetEl) {
    encPresetEl.addEventListener('change', () => {
      const cfg = state.apartmentConfig;
      if (!cfg.simulator) cfg.simulator = {};
      if (!cfg.simulator.enclosure) cfg.simulator.enclosure = {};
      cfg.simulator.enclosure.preset = encPresetEl.value;
      updateSimulator();
    });
  }
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
  const presetKey = encCfg.preset || 'auto';
  const preset = ENCLOSURE_PRESETS[presetKey] || ENCLOSURE_PRESETS.auto;
  const matW = 1.5, matD = 1.2;

  // Resolve dimensions: preset → custom override → auto-calculate
  const bsOff = backswingOffset(clubLen);
  const boxW = (presetKey === 'custom' && encCfg.width) ? encCfg.width
             : preset.width ? preset.width
             : 2 * sR + 0.5;
  const boxD = (presetKey === 'custom' && encCfg.depth) ? encCfg.depth
             : preset.depth ? preset.depth
             : bsOff + matD + 1.0;
  const boxH = (presetKey === 'custom' && encCfg.height) ? encCfg.height
             : preset.height ? preset.height
             : sH + 0.3;

  // Screen sized to fit enclosure (slightly smaller than box width)
  const screenW = Math.min(boxW - 0.1, 3.0);
  const screenH = Math.min(boxH - 0.2, 2.5);

  // Update screen mesh geometry to match
  screenMesh.geometry.dispose();
  screenMesh.geometry = new THREE.PlaneGeometry(screenW, screenH);
  // Update edge wireframe
  if (screenMesh.children.length > 0) {
    screenMesh.children[0].geometry.dispose();
    screenMesh.children[0].geometry = new THREE.EdgesGeometry(screenMesh.geometry);
  }
  screenMesh.position.y = screenH / 2 + 0.1;

  // Update preset selector if present
  const presetEl = document.getElementById('enclosurePreset');
  if (presetEl && presetEl.value !== presetKey) presetEl.value = presetKey;

  // Build enclosure — realistic golf sim cage with nets and frame poles
  if (enclosureGroup && encCfg.visible !== false) {
    // Clear previous
    while (enclosureGroup.children.length) {
      const c = enclosureGroup.children[0];
      enclosureGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }

    // Box centered on golfer
    const topY = boxH;
    let cx, cz, w, d;
    if (dir === 'window') {
      cx = golferX;
      cz = golferZ - boxD * 0.4; // 60% front, 40% back
      w = boxW;
      d = boxD;
    } else {
      cx = golferX + boxD * 0.1;
      cz = golferZ;
      w = boxD;
      d = boxW;
    }

    const halfW = w / 2;
    const halfD = d / 2;

    // ─── Frame poles (vertical corners + horizontal top rails) ───
    const poleR = 0.025; // 2.5cm radius
    const poleGeo = new THREE.CylinderGeometry(poleR, poleR, topY, 6);
    const corners = [
      [cx - halfW, cz - halfD],
      [cx + halfW, cz - halfD],
      [cx - halfW, cz + halfD],
      [cx + halfW, cz + halfD],
    ];
    for (const [px, pz] of corners) {
      const pole = new THREE.Mesh(poleGeo, frameMat);
      pole.position.set(px, topY / 2, pz);
      enclosureGroup.add(pole);
    }

    // Horizontal top rails
    const railGeoW = new THREE.CylinderGeometry(poleR * 0.7, poleR * 0.7, w, 6);
    const railGeoD = new THREE.CylinderGeometry(poleR * 0.7, poleR * 0.7, d, 6);
    // Front and back top rails (along X)
    for (const rz of [cz - halfD, cz + halfD]) {
      const rail = new THREE.Mesh(railGeoW, frameMat);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(cx, topY, rz);
      enclosureGroup.add(rail);
    }
    // Left and right top rails (along Z)
    for (const rx of [cx - halfW, cx + halfW]) {
      const rail = new THREE.Mesh(railGeoD, frameMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(rx, topY, cz);
      enclosureGroup.add(rail);
    }

    // ─── Net panels ───
    // Side nets (left, right)
    const sideGeo = new THREE.PlaneGeometry(d, topY);
    for (const sx of [-halfW, halfW]) {
      const panel = new THREE.Mesh(sideGeo, netMat);
      panel.rotation.y = Math.PI / 2;
      panel.position.set(cx + sx, topY / 2, cz);
      enclosureGroup.add(panel);
    }

    // Top net
    const topGeo = new THREE.PlaneGeometry(w, d);
    const topPanel = new THREE.Mesh(topGeo, netMat);
    topPanel.rotation.x = -Math.PI / 2;
    topPanel.position.set(cx, topY, cz);
    enclosureGroup.add(topPanel);

    // Back net (behind golfer)
    const backGeo = new THREE.PlaneGeometry(w, topY);
    const backPanel = new THREE.Mesh(backGeo, netMat);
    backPanel.position.set(cx, topY / 2, cz + halfD);
    enclosureGroup.add(backPanel);

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
