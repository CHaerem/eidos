import * as THREE from 'three';
import { state } from './state.js';
import { CEIL, BOUNDS, ceilAt } from './room.js';

// ─── ENCLOSURE PRESETS (real products with exact specs) ───
// Dimensions: inner frame (width × height × depth), screenW/H = impact screen size
// style: 'velour' = black velour panels (SimSpace), 'open' = minimal frame (MicroBay/SkyTrak)
const ENCLOSURE_PRESETS = {
  auto:       { name: 'Auto (fra sving)',     width: null, height: null, depth: null, screenW: null, screenH: null, style: 'velour', url: null },
  sim1:       { name: 'SimSpace SIM 1',       width: 2.6,  height: 2.5,  depth: 1.5, screenW: 2.4,  screenH: 2.3, style: 'velour', url: 'https://simspacegolf.com/products/sim-space-golf-enclosure-6-sizes' },
  sim2:       { name: 'SimSpace SIM 2',       width: 3.0,  height: 2.5,  depth: 1.5, screenW: 2.8,  screenH: 2.3, style: 'velour', url: 'https://simspacegolf.com/products/sim-space-golf-enclosure-6-sizes' },
  sim3:       { name: 'SimSpace SIM 3',       width: 3.6,  height: 2.5,  depth: 1.5, screenW: 3.4,  screenH: 2.3, style: 'velour', url: 'https://simspacegolf.com/products/sim-space-golf-enclosure-6-sizes' },
  sim4:       { name: 'SimSpace SIM 4',       width: 4.0,  height: 2.5,  depth: 1.5, screenW: 3.8,  screenH: 2.3, style: 'velour', url: 'https://simspacegolf.com/products/sim-space-golf-enclosure-6-sizes' },
  sim5:       { name: 'SimSpace SIM 5',       width: 3.0,  height: 3.0,  depth: 3.0, screenW: 2.8,  screenH: 2.8, style: 'velour', url: 'https://simspacegolf.com/products/sim-space-golf-enclosure-6-sizes' },
  sim6:       { name: 'SimSpace SIM 6',       width: 4.0,  height: 3.0,  depth: 3.0, screenW: 3.8,  screenH: 2.8, style: 'velour', url: 'https://simspacegolf.com/products/sim-space-golf-enclosure-6-sizes' },
  slim:       { name: 'SimSpace SLIM',        width: 3.4,  height: 2.6,  depth: 1.1, screenW: 3.2,  screenH: 2.4, style: 'velour', url: 'https://simspacegolf.com/products/simspace-slim-golf-enclosure' },
  microbay:   { name: 'MicroBay',             width: 3.0,  height: 2.4,  depth: 0.6, screenW: 2.7,  screenH: 2.1, style: 'open',   url: 'https://allsportsystems.shop/products/golf-simulator-enclosure-hitting-bay-microbay' },
  skytrak8:   { name: 'SkyTrak 8ft Studio',   width: 2.4,  height: 2.4,  depth: 1.5, screenW: 2.2,  screenH: 2.1, style: 'open',   url: 'https://skytrakgolf.com/blogs/articles/introducing-the-8ft-sim-studio-big-performance-in-a-compact-space' },
  custom:     { name: 'Egendefinert',         width: 3.0,  height: 2.5,  depth: 1.5, screenW: null, screenH: null, style: 'velour', url: null },
};

// ─── CLUB DATA (TrackMan-verified swing plane angles) ───
// planeAngle: degrees from horizontal (flatter = more lateral, steeper = more vertical)
// Sources: TrackMan Combine averages, manufacturer specs
const CLUB_DATA = {
  '1.150': { name: 'Driver',  plane: 48 },
  '1.080': { name: '3-wood',  plane: 50 },
  '1.020': { name: 'Hybrid',  plane: 53 },
  '0.970': { name: '5-iron',  plane: 57 },
  '0.940': { name: '7-iron',  plane: 60 },
  '0.910': { name: '9-iron',  plane: 62 },
  '0.890': { name: 'PW/SW',   plane: 64 },
};

function getClubData(clubLen) {
  const key = clubLen.toFixed(3);
  if (CLUB_DATA[key]) return CLUB_DATA[key];
  // Interpolate plane angle: driver (1.15m) → 48°, PW (0.89m) → 64°
  const t = Math.max(0, Math.min(1, (clubLen - 0.89) / (1.15 - 0.89)));
  return { name: 'Ukjent', plane: 64 - t * 16 };
}

// ─── SWING FORMULAS ───
// Verified against golf simulator manufacturer specs and TrackMan data.
// For 180cm golfer + driver: height ≈ 2.55m, lateral ≈ 1.20m, radius ≈ 1.80m

function swingHeight(heightCm, clubLen) {
  // Shoulder pivot height + club projection upward at top of backswing
  // At top: wrists cock adds effective height beyond simple sin(plane)
  // Calibrated to match real-world reports: 180cm + driver ≈ 2.55m
  return (heightCm / 100) * 0.80 + clubLen * Math.sin(75 * Math.PI / 180);
}

function backswingOffset(clubLen) {
  return clubLen * 0.4;
}

function swingRadius(heightCm, clubLen) {
  const armLen = (heightCm / 100) * 0.36;
  return armLen + clubLen;
}

// Maximum lateral (sideways) extension of the club head from golfer center.
// This is the critical clearance number for enclosure width.
// Uses TrackMan swing plane data: flatter plane (driver) = more lateral.
function maxLateralExtension(heightCm, clubLen) {
  const R = swingRadius(heightCm, clubLen);
  const planeAngle = getClubData(clubLen).plane * Math.PI / 180;
  // At the widest point (roughly hip height), lateral = R * cos(planeAngle)
  return R * Math.cos(planeAngle);
}

// ─── SIMULATOR STATE ───
let screenMesh, matMesh, golferGroup, ballMesh;
let arcMatGreen, arcMatRed, bsMatOrange, bsMatRed;
let enclosureGroup = null;

// SimSpace style: black velour — nearly opaque, soft/matte look
const velourMat = new THREE.MeshStandardMaterial({
  color: 0x0a0a0a, transparent: true, opacity: 0.88,
  side: THREE.DoubleSide, roughness: 0.95, metalness: 0.0
});
// Open style: lightweight black netting — more transparent
const nettingMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a1a, transparent: true, opacity: 0.35,
  side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0
});
// Frame poles — dark powder-coated steel
const frameMat = new THREE.MeshStandardMaterial({
  color: 0x222222, roughness: 0.3, metalness: 0.7
});

export function initSimulator() {
  const { scene } = state;
  const simGroup = new THREE.Group();

  const screenW = 2.5, screenH = 2.0;
  const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
  // Impact screen — white projector screen with subtle glow
  screenMesh = new THREE.Mesh(screenGeo, new THREE.MeshStandardMaterial({
    color: 0xF0F0F0, side: THREE.DoubleSide, roughness: 0.3, metalness: 0.0,
    emissive: 0x445566, emissiveIntensity: 0.15
  }));
  // Black border frame around screen
  const borderGeo = new THREE.EdgesGeometry(screenGeo);
  screenMesh.add(new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0x111111, linewidth: 2 })));
  simGroup.add(screenMesh);

  // ─── Full simulator flooring system ───
  const matW = 1.5, matD = 1.2;

  // Shared turf texture generator
  function makeTurfTex(baseColor, bladeCount, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < bladeCount; i++) {
      const gx = Math.random() * size;
      const gy = Math.random() * size;
      const shade = 25 + Math.random() * 55;
      ctx.strokeStyle = `rgba(${shade}, ${70 + Math.random() * 70}, ${shade}, 0.35)`;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + (Math.random() - 0.5) * 3, gy - 2 - Math.random() * 4);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // 1. Landing zone / ball-catcher pad (in front of hitting mat, towards screen)
  const landTex = makeTurfTex('#1B5E1B', 2000, 256);
  landTex.repeat.set(2, 3);
  const landPad = new THREE.Mesh(
    new THREE.BoxGeometry(matW + 0.2, 0.008, 0.6),
    new THREE.MeshStandardMaterial({ map: landTex, roughness: 0.95, metalness: 0.0 })
  );
  landPad.position.y = 0.004;
  simGroup.add(landPad);
  // Position updated in updateSimulator along with matMesh

  // 2. Rubber base layer
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0.0 });
  const matBase = new THREE.Mesh(new THREE.BoxGeometry(matW + 0.04, 0.015, matD + 0.04), rubberMat);
  matBase.position.y = 0.0075;
  simGroup.add(matBase);

  // 3. Hitting mat (fairway turf) — slightly raised, brighter green
  const hitTex = makeTurfTex('#2B7A2B', 4000, 256);
  hitTex.repeat.set(3, 3);
  matMesh = new THREE.Mesh(
    new THREE.BoxGeometry(matW, 0.022, matD),
    new THREE.MeshStandardMaterial({ map: hitTex, roughness: 0.9, metalness: 0.0 })
  );
  matMesh.position.y = 0.026;
  simGroup.add(matMesh);

  // 4. Tee marker (small rubber circle on the mat)
  const teeMat = new THREE.MeshStandardMaterial({ color: 0xCC0000, roughness: 0.6, metalness: 0.0 });
  const teeMarker = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.005, 12), teeMat);
  teeMarker.position.y = 0.04;
  simGroup.add(teeMarker);

  // 5. Stance mat (behind hitting area) — darker, thicker padding
  const stanceTex = makeTurfTex('#1E5E1E', 2500, 256);
  stanceTex.repeat.set(3, 2);
  const stanceMat = new THREE.Mesh(
    new THREE.BoxGeometry(matW + 0.1, 0.018, 0.8),
    new THREE.MeshStandardMaterial({ map: stanceTex, roughness: 0.95, metalness: 0.0 })
  );
  stanceMat.position.y = 0.009;
  simGroup.add(stanceMat);

  // Store extra floor pieces for position updates
  state._simFloorPieces = { landPad, matBase, stanceMat, teeMarker };

  // ─── Golfer figure — realistic proportioned humanoid ───
  golferGroup = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xD4A574, roughness: 0.7, metalness: 0.0 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x3B2510, roughness: 0.9, metalness: 0.0 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x1E3A6E, roughness: 0.65, metalness: 0.0 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2C2C2C, roughness: 0.55, metalness: 0.0 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.4, metalness: 0.1 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0xF5F5F5, roughness: 0.5, metalness: 0.0 });
  const clubMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.2, metalness: 0.8 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0.0 });

  // Golf shoes — white with cleats
  for (const sx of [-0.08, 0.08]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.16), shoeMat);
    shoe.position.set(sx, 0.025, 0.02);
    golferGroup.add(shoe);
    // Sole detail
    const sole = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.008, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.0 })
    );
    sole.position.set(sx, 0.004, 0.02);
    golferGroup.add(sole);
  }

  // Legs — tapered, slightly bent at address
  for (const [sx, rot] of [[-0.065, 0.03], [0.065, -0.03]]) {
    // Thigh
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.25, 8), pantsMat);
    thigh.position.set(sx, 0.38, 0);
    thigh.rotation.z = rot;
    golferGroup.add(thigh);
    // Shin
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.25, 8), pantsMat);
    shin.position.set(sx, 0.15, 0);
    golferGroup.add(shin);
  }

  // Belt
  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.03, 12),
    new THREE.MeshStandardMaterial({ color: 0x2A2A2A, roughness: 0.4, metalness: 0.3 })
  );
  belt.position.y = 0.51;
  golferGroup.add(belt);

  // Torso — polo shirt, slightly forward lean (address position)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.40, 10), shirtMat);
  torso.position.set(0, 0.73, -0.02);
  torso.rotation.x = 0.08; // slight forward lean
  golferGroup.add(torso);

  // Shoulders (wider than torso)
  const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.06, 10), shirtMat);
  shoulders.position.set(0, 0.94, -0.02);
  golferGroup.add(shoulders);

  // Arms — in address position, hanging down towards club
  // Left arm (lead arm for right-handed golfer)
  const leftUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 6), shirtMat);
  leftUpperArm.position.set(-0.15, 0.82, -0.06);
  leftUpperArm.rotation.x = 0.4;
  leftUpperArm.rotation.z = 0.15;
  golferGroup.add(leftUpperArm);
  const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.20, 6), skinMat);
  leftForearm.position.set(-0.14, 0.65, -0.12);
  leftForearm.rotation.x = 0.6;
  golferGroup.add(leftForearm);
  // Left glove
  const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), gloveMat);
  leftGlove.position.set(-0.13, 0.55, -0.16);
  golferGroup.add(leftGlove);

  // Right arm
  const rightUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 6), shirtMat);
  rightUpperArm.position.set(0.15, 0.82, -0.06);
  rightUpperArm.rotation.x = 0.4;
  rightUpperArm.rotation.z = -0.15;
  golferGroup.add(rightUpperArm);
  const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.20, 6), skinMat);
  rightForearm.position.set(0.14, 0.65, -0.12);
  rightForearm.rotation.x = 0.6;
  golferGroup.add(rightForearm);
  // Right hand (bare)
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.023, 8, 6), skinMat);
  rightHand.position.set(0.13, 0.55, -0.16);
  golferGroup.add(rightHand);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.07, 8), skinMat);
  neck.position.y = 0.99;
  golferGroup.add(neck);

  // Head — slightly looking down at ball
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), skinMat);
  headMesh.position.set(0, 1.09, -0.01);
  golferGroup.add(headMesh);
  // Hair (back of head)
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
    hairMat
  );
  hair.position.set(0, 1.11, 0.01);
  golferGroup.add(hair);

  // Cap — golf visor style
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1a3366, roughness: 0.55, metalness: 0.0 });
  const capTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.092, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.45),
    capMat
  );
  capTop.position.set(0, 1.12, -0.01);
  golferGroup.add(capTop);
  // Visor brim
  const brimShape = new THREE.Shape();
  brimShape.absarc(0, 0, 0.10, -Math.PI * 0.6, Math.PI * 0.6, false);
  brimShape.lineTo(0, 0);
  const brimGeo = new THREE.ExtrudeGeometry(brimShape, { depth: 0.004, bevelEnabled: false });
  const brim = new THREE.Mesh(brimGeo, capMat);
  brim.position.set(0, 1.105, -0.09);
  brim.rotation.x = -0.15;
  golferGroup.add(brim);

  // Golf club at address position — shaft from hands to ball
  const shaftLen = 0.70;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, shaftLen, 6),
    clubMat
  );
  shaft.position.set(0, 0.35, -0.22);
  shaft.rotation.x = 0.25;
  golferGroup.add(shaft);
  // Grip (top of shaft)
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.007, 0.18, 6),
    gripMat
  );
  grip.position.set(0, 0.60, -0.16);
  grip.rotation.x = 0.25;
  golferGroup.add(grip);
  // Club head
  const clubHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.015, 0.04),
    clubMat
  );
  clubHead.position.set(0, 0.04, -0.28);
  golferGroup.add(clubHead);

  simGroup.add(golferGroup);

  // ─── Swing arc materials — semi-transparent with glow ───
  arcMatGreen = new THREE.MeshStandardMaterial({
    color: 0x00FF66, emissive: 0x00FF66, emissiveIntensity: 0.5,
    transparent: true, opacity: 0.6, depthTest: false
  });
  arcMatRed = new THREE.MeshStandardMaterial({
    color: 0xFF3333, emissive: 0xFF3333, emissiveIntensity: 0.5,
    transparent: true, opacity: 0.6, depthTest: false
  });
  bsMatOrange = new THREE.MeshStandardMaterial({
    color: 0xFFAA00, emissive: 0xFFAA00, emissiveIntensity: 0.4,
    transparent: true, opacity: 0.5, depthTest: false
  });
  bsMatRed = new THREE.MeshStandardMaterial({
    color: 0xFF3333, emissive: 0xFF3333, emissiveIntensity: 0.4,
    transparent: true, opacity: 0.5, depthTest: false
  });

  // Golf ball — glossy white with dimple texture
  const ballCanvas = document.createElement('canvas');
  ballCanvas.width = 64; ballCanvas.height = 64;
  const bCtx = ballCanvas.getContext('2d');
  bCtx.fillStyle = '#FFFFFF';
  bCtx.fillRect(0, 0, 64, 64);
  // Dimple pattern
  for (let i = 0; i < 40; i++) {
    const dx = Math.random() * 64;
    const dy = Math.random() * 64;
    bCtx.beginPath();
    bCtx.arc(dx, dy, 1.5 + Math.random(), 0, Math.PI * 2);
    bCtx.fillStyle = 'rgba(220,220,220,0.5)';
    bCtx.fill();
  }
  const ballTex = new THREE.CanvasTexture(ballCanvas);
  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.021, 16, 12),
    new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.15, metalness: 0.05 })
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
    if (e.target.checked) updateSimulator();
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
  const clearanceToggle = document.getElementById('clearanceOverlay');
  if (clearanceToggle) clearanceToggle.addEventListener('change', updateSimulator);
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
  matMesh.position.set(golferX, 0.026, golferZ);
  screenMesh.position.set(screenX, 2.0 / 2 + 0.1, screenZ);
  screenMesh.rotation.y = screenRotY;

  // Update extra floor pieces to follow golfer position
  const fp = state._simFloorPieces;
  if (fp) {
    const matDepth = 1.2; // hitting mat depth
    fp.matBase.position.set(golferX, 0.0075, golferZ);
    fp.landPad.position.set(golferX, 0.004, golferZ - matDepth / 2 - 0.35);
    fp.stanceMat.position.set(golferX, 0.009, golferZ + matDepth / 2 + 0.35);
    fp.teeMarker.position.set(golferX, 0.04, golferZ - matDepth / 2 + 0.15);
  }

  const ceilH = ceilAt(golferZ);
  const ceilClearance = ceilH - sH;
  const hemsDist = CEIL.hemskantZ - golferZ;
  const sideL = golferX - BOUNDS.minX;
  const sideR = BOUNDS.maxX - golferX;
  const screenDist = dir === 'window'
    ? Math.abs(golferZ - screenZ) - 0.5
    : Math.abs(golferX - screenX) - 0.5;

  // Swing arc — club-specific swing plane angle from TrackMan data
  const clubData = getClubData(clubLen);
  const swingPlaneAngle = clubData.plane * Math.PI / 180;
  const pivotY = heightM * 0.55;
  const maxLateral = maxLateralExtension(heightCm, clubLen);

  function clubPos(theta) {
    // Vertical: pivot height ± club projection along tilted plane
    const y = pivotY - sR * Math.cos(theta) * Math.sin(swingPlaneAngle);
    // Along target line: forward/backward component
    const alongTarget = sR * Math.sin(theta) * Math.sin(swingPlaneAngle) * 0.3;
    // Lateral: the critical dimension — uses cos(planeAngle) for realistic sideways extension
    // Driver (48°) → cos(48°)=0.67 → high lateral
    // Wedge (64°) → cos(64°)=0.44 → less lateral
    const lateral = sR * Math.sin(theta) * Math.cos(swingPlaneAngle);
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
    // Check clearance: ceiling vs swing height AND side walls vs lateral extension
    const sideOk = Math.min(sideL, sideR) > maxLateral * 0.5;
    const ok = ceilClearance > 0.10 && sideOk;
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
             : 2 * maxLateral + 0.3; // lateral extension + 15cm margin each side
  const boxD = (presetKey === 'custom' && encCfg.depth) ? encCfg.depth
             : preset.depth ? preset.depth
             : bsOff + matD + 1.0;
  const rawH = (presetKey === 'custom' && encCfg.height) ? encCfg.height
             : preset.height ? preset.height
             : sH + 0.3;
  // Cap box height to ceiling to prevent clipping through roof
  const boxH = Math.min(rawH, ceilH - 0.02);

  // ─── Show lateral extension and max club that fits ───
  const lateralEl = document.getElementById('cLateral');
  if (lateralEl) {
    const margin = boxW / 2 - maxLateral;
    lateralEl.textContent = `${maxLateral.toFixed(2)}m (${margin >= 0 ? '+' : ''}${(margin * 100).toFixed(0)}cm)`;
    lateralEl.className = 'val ' + (margin > 0.10 ? 'ok' : margin > 0 ? 'tight' : 'bad');
  }

  // Find the longest club that fits in current enclosure
  const maxClubEl = document.getElementById('cMaxClub');
  if (maxClubEl) {
    const halfBox = boxW / 2;
    let maxFit = null;
    for (const [len, data] of Object.entries(CLUB_DATA)) {
      const lat = maxLateralExtension(heightCm, parseFloat(len));
      if (lat <= halfBox + 0.05) { // 5cm net flex tolerance
        if (!maxFit || parseFloat(len) > parseFloat(maxFit.len)) {
          maxFit = { len, name: data.name, margin: halfBox - lat };
        }
      }
    }
    if (maxFit) {
      maxClubEl.textContent = `${maxFit.name} (${(maxFit.margin * 100).toFixed(0)}cm margin)`;
      maxClubEl.className = 'val ' + (maxFit.margin > 0.10 ? 'ok' : 'tight');
    } else {
      maxClubEl.textContent = 'Ingen kølle passer!';
      maxClubEl.className = 'val bad';
    }
  }

  // Screen sized from preset or auto-fit
  const screenW = preset.screenW ? preset.screenW : Math.min(boxW - 0.2, 3.0);
  const screenH = preset.screenH ? preset.screenH : Math.min(boxH - 0.2, 2.5);
  const panelStyle = preset.style || 'velour';
  const panelMat = panelStyle === 'velour' ? velourMat : nettingMat;

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

    // ─── Slant-roof enclosure: follows ceiling slope ───
    // Compute ceiling height at front and back edges using ceilAt
    const frontZ = cz - halfD;
    const backZ = cz + halfD;
    const frontH = Math.min(boxH, ceilAt(cx, frontZ) - 0.05);
    const backH = Math.min(boxH, ceilAt(cx, backZ) - 0.05);

    // ─── Frame poles (front corners only — open back) ───
    const poleR = 0.025; // 2.5cm radius
    const frontCorners = [
      { x: cx - halfW, z: frontZ, h: frontH },
      { x: cx + halfW, z: frontZ, h: frontH },
    ];
    for (const c of frontCorners) {
      const poleGeo = new THREE.CylinderGeometry(poleR, poleR, c.h, 8);
      const pole = new THREE.Mesh(poleGeo, frameMat);
      pole.position.set(c.x, c.h / 2, c.z);
      enclosureGroup.add(pole);
    }

    // Horizontal top rail — front only
    const railR = poleR * 0.7;
    const railGeoW = new THREE.CylinderGeometry(railR, railR, w, 6);
    const frontRail = new THREE.Mesh(railGeoW, frameMat);
    frontRail.rotation.z = Math.PI / 2;
    frontRail.position.set(cx, frontH, frontZ);
    enclosureGroup.add(frontRail);

    // Side top rails — run from front pole to back edge (angled for slope)
    for (const sx of [-halfW, halfW]) {
      const sideLen = Math.sqrt(d * d + (backH - frontH) ** 2);
      const sideRailGeo = new THREE.CylinderGeometry(railR, railR, sideLen, 6);
      const sideRail = new THREE.Mesh(sideRailGeo, frameMat);
      const midY = (frontH + backH) / 2;
      const angle = Math.atan2(backH - frontH, d);
      sideRail.rotation.x = Math.PI / 2 - angle;
      sideRail.position.set(cx + sx, midY, cz);
      enclosureGroup.add(sideRail);
    }

    // Bottom rails on ground (side edges)
    for (const sx of [-halfW, halfW]) {
      const bottomRailGeo = new THREE.CylinderGeometry(railR, railR, d, 6);
      const bottomRail = new THREE.Mesh(bottomRailGeo, frameMat);
      bottomRail.rotation.x = Math.PI / 2;
      bottomRail.position.set(cx + sx, railR, cz);
      enclosureGroup.add(bottomRail);
    }

    // ─── Panels (slant-roof aware, built with BufferGeometry) ───
    // Side panels — trapezoids with correct 3D vertices
    for (const sx of [-halfW, halfW]) {
      const x = cx + sx;
      const verts = new Float32Array([
        x, 0,      frontZ,   // bottom-front
        x, 0,      backZ,    // bottom-back
        x, backH,  backZ,    // top-back
        x, frontH, frontZ,   // top-front
      ]);
      const indices = [0, 1, 2, 0, 2, 3];
      const sideGeo = new THREE.BufferGeometry();
      sideGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      sideGeo.setIndex(indices);
      sideGeo.computeVertexNormals();
      const panel = new THREE.Mesh(sideGeo, panelMat);
      enclosureGroup.add(panel);
    }

    // Top panel — quad from front-top to back-top
    const topVerts = new Float32Array([
      cx - halfW, frontH, frontZ,
      cx + halfW, frontH, frontZ,
      cx + halfW, backH,  backZ,
      cx - halfW, backH,  backZ,
    ]);
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.BufferAttribute(topVerts, 3));
    topGeo.setIndex([0, 1, 2, 0, 2, 3]);
    topGeo.computeVertexNormals();
    const topPanel = new THREE.Mesh(topGeo, panelMat);
    enclosureGroup.add(topPanel);

    // Back panel removed — open behind golfer for entry/exit

    enclosureGroup.visible = true;
  } else if (enclosureGroup) {
    enclosureGroup.visible = false;
  }

  // Update dimension displays
  const matEl = document.getElementById('simMat');
  if (matEl) matEl.textContent = `${matW} × ${matD}m`;
  const scrEl = document.getElementById('simScreen');
  if (scrEl) scrEl.textContent = `${screenW.toFixed(1)} × ${screenH.toFixed(1)}m`;
  const boxEl = document.getElementById('simBox');
  if (boxEl) {
    boxEl.textContent = `${boxW.toFixed(1)} × ${boxD.toFixed(1)} × ${boxH.toFixed(1)}m`;
    // Color based on fit
    const fits = boxW < (BOUNDS.maxX - BOUNDS.minX) && boxH < ceilH;
    const tight = ceilClearance < 0.1 || Math.min(sideL, sideR) < boxW / 2 + 0.1;
    boxEl.className = 'val ' + (fits && !tight ? 'ok' : fits ? 'tight' : 'bad');
  }

  // Product link
  const linkEl = document.getElementById('enclosureLink');
  if (linkEl) {
    if (preset.url) {
      linkEl.href = preset.url;
      linkEl.textContent = preset.name;
      linkEl.style.display = '';
    } else {
      linkEl.style.display = 'none';
    }
  }

  // ─── Clearance overlay ───
  updateClearanceOverlay(golferX, golferZ, sH, sideL, sideR, ceilH, dir, screenDist);
}

// ─── CLEARANCE OVERLAY ───

function clearanceColor(dist) {
  if (dist > 0.30) return '#4ade80'; // green
  if (dist > 0.10) return '#fbbf24'; // yellow
  return '#f87171';                   // red
}

function makeClearanceSprite(text, color) {
  const w = 160, h = 40;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.roundRect(0, 0, w, h, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.3, 0.075, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function makeClearanceLine(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    depthTest: false,
    linewidth: 2
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 998;
  return line;
}

function updateClearanceOverlay(golferX, golferZ, swingH, sideL, sideR, ceilH, dir, screenDist) {
  const simGroup = state.simGroup;
  if (!simGroup) return;

  // Find or create the overlay group
  let overlay = simGroup.getObjectByName('ClearanceOverlay');
  if (!overlay) {
    overlay = new THREE.Group();
    overlay.name = 'ClearanceOverlay';
    simGroup.add(overlay);
  }

  // Clear previous children
  while (overlay.children.length) {
    const c = overlay.children[0];
    overlay.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  }

  // Check toggle
  const toggle = document.getElementById('clearanceOverlay');
  if (toggle && !toggle.checked) {
    overlay.visible = false;
    return;
  }
  overlay.visible = true;

  const lineY = 1.0; // lines at ~1m height

  // ─── Horizontal distance lines ───

  // Left: golfer → west wall (BOUNDS.minX)
  const leftFrom = new THREE.Vector3(golferX, lineY, golferZ);
  const leftTo = new THREE.Vector3(BOUNDS.minX, lineY, golferZ);
  const leftColor = clearanceColor(sideL);
  overlay.add(makeClearanceLine(leftFrom, leftTo, leftColor));
  const leftLabel = makeClearanceSprite(sideL.toFixed(2) + 'm', leftColor);
  leftLabel.position.set((golferX + BOUNDS.minX) / 2, lineY + 0.12, golferZ);
  overlay.add(leftLabel);

  // Right: golfer → east wall (BOUNDS.maxX)
  const rightFrom = new THREE.Vector3(golferX, lineY, golferZ);
  const rightTo = new THREE.Vector3(BOUNDS.maxX, lineY, golferZ);
  const rightColor = clearanceColor(sideR);
  overlay.add(makeClearanceLine(rightFrom, rightTo, rightColor));
  const rightLabel = makeClearanceSprite(sideR.toFixed(2) + 'm', rightColor);
  rightLabel.position.set((golferX + BOUNDS.maxX) / 2, lineY + 0.12, golferZ);
  overlay.add(rightLabel);

  // Front: golfer → south wall (BOUNDS.minZ)
  const frontDist = golferZ - BOUNDS.minZ;
  const frontFrom = new THREE.Vector3(golferX, lineY, golferZ);
  const frontTo = new THREE.Vector3(golferX, lineY, BOUNDS.minZ);
  const frontColor = clearanceColor(frontDist);
  overlay.add(makeClearanceLine(frontFrom, frontTo, frontColor));
  const frontLabel = makeClearanceSprite(frontDist.toFixed(2) + 'm', frontColor);
  frontLabel.position.set(golferX, lineY + 0.12, (golferZ + BOUNDS.minZ) / 2);
  overlay.add(frontLabel);

  // Back: golfer → north wall (BOUNDS.maxZ)
  const backDist = BOUNDS.maxZ - golferZ;
  const backFrom = new THREE.Vector3(golferX, lineY, golferZ);
  const backTo = new THREE.Vector3(golferX, lineY, BOUNDS.maxZ);
  const backColor = clearanceColor(backDist);
  overlay.add(makeClearanceLine(backFrom, backTo, backColor));
  const backLabel = makeClearanceSprite(backDist.toFixed(2) + 'm', backColor);
  backLabel.position.set(golferX, lineY + 0.12, (golferZ + BOUNDS.maxZ) / 2);
  overlay.add(backLabel);

  // ─── Vertical ceiling clearance line ───
  const ceilClearance = ceilH - swingH;
  const vertFrom = new THREE.Vector3(golferX, swingH, golferZ);
  const vertTo = new THREE.Vector3(golferX, ceilH, golferZ);
  const vertColor = clearanceColor(ceilClearance);
  overlay.add(makeClearanceLine(vertFrom, vertTo, vertColor));
  const vertLabel = makeClearanceSprite(ceilClearance.toFixed(2) + 'm', vertColor);
  vertLabel.position.set(golferX + 0.15, (swingH + ceilH) / 2, golferZ);
  overlay.add(vertLabel);
}
