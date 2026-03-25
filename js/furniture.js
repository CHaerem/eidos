import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ─── GLB LOADER (singleton) ───
const _gltfLoader = new GLTFLoader();
const _dracoLoader = new DRACOLoader();
_dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
_dracoLoader.setDecoderConfig({ type: 'js' });
_gltfLoader.setDRACOLoader(_dracoLoader);

// Cache loaded GLB scenes to avoid re-fetching
const _glbCache = new Map();

/**
 * Load a GLB file and return a cloned scene group.
 * Caches the original for fast re-use.
 * @param {string} url - Path to .glb file (e.g. 'models/furniture/besta.glb')
 * @param {object} opts - { scale, rotateY } for fitting the model
 * @returns {Promise<THREE.Group>}
 */
export async function loadGLB(url, opts = {}) {
  let original = _glbCache.get(url);

  if (!original) {
    const gltf = await new Promise((resolve, reject) => {
      _gltfLoader.load(url, resolve, undefined, reject);
    });
    original = gltf.scene;
    _glbCache.set(url, original);
  }

  const clone = original.clone(true);

  // Clone materials to avoid cross-contamination
  clone.traverse(obj => {
    if (obj.isMesh && obj.material) {
      obj.material = Array.isArray(obj.material)
        ? obj.material.map(m => m.clone())
        : obj.material.clone();
    }
  });

  // Apply scale
  if (opts.scale) {
    clone.scale.setScalar(opts.scale);
  }

  // Apply Y rotation (degrees)
  if (opts.rotateY) {
    clone.rotation.y = opts.rotateY * Math.PI / 180;
  }

  // Normalize: put base at Y=0 and center on XZ
  const box = new THREE.Box3().setFromObject(clone);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Shift so bottom sits at Y=0, centered on XZ
    clone.position.set(-center.x, -box.min.y, -center.z);

    // Wrap in group so position offset is internal
    const wrapper = new THREE.Group();
    wrapper.add(clone);
    wrapper.userData._glbSize = { w: size.x, h: size.y, d: size.z };
    return wrapper;
  }

  return clone;
}

// ─── FURNITURE CATALOG ───
// Items with 'glb' property will load real 3D models.
// Items without 'glb' use the built-in box/custom mesh as fallback.
export const FURNITURE_CATALOG = {
  // ─── IKEA GLB models (real 3D from IKEA's CDN) ───
  kallax:      { name: 'KALLAX Hylle (2×2)', w: 0.77, h: 0.77, d: 0.39, color: 0xFFFFFF, glb: 'models/furniture/kallax.glb', ikea: '20275814' },
  kallax_2x4:  { name: 'KALLAX Hylle (2×4)', w: 0.77, h: 1.47, d: 0.39, color: 0xFFFFFF, glb: 'models/furniture/kallax-2x4.glb', ikea: '40346924' },
  billy:       { name: 'BILLY Bokhylle', w: 0.80, h: 2.02, d: 0.28, color: 0xFFFFFF, glb: 'models/furniture/billy-bokhylle.glb', ikea: '00263850' },

  // ─── Custom-built models (detailed geometry in code) ───
  besta_3x:    { name: 'BESTÅ skap (3×)', w: 1.80, h: 1.92, d: 0.40, color: 0x3B3B3B, custom: 'besta' },
  soderhamn:   { name: 'Söderhamn hjørne 3-s', w: 1.92, h: 0.83, d: 1.92, color: 0x8B8B8B, custom: 'soderhamn' },
  cana_tv:     { name: 'Bolia Cana + Frame TV', w: 1.28, h: 1.11, d: 0.40, color: 0xC4A87C, custom: 'cana_tv' },

  // ─── Golf simulator storage + deployment ───
  pax_golfsim: { name: 'PAX Høyskap (golfsim)', w: 1.00, h: 2.01, d: 0.58, color: 0xE8DCC8, custom: 'pax_golfsim' },
  retractable_screen: { name: 'Retractable skjerm', w: 2.60, h: 0.12, d: 0.15, color: 0x222222, custom: 'retractable_screen' },
  portable_enclosure: { name: 'Sammenleggbar enclosure', w: 2.40, h: 2.80, d: 1.80, color: 0x111111, custom: 'portable_enclosure' },
  hitting_mat_portable: { name: 'Slagmatte (sammenleggbar)', w: 1.50, h: 0.025, d: 1.20, color: 0x2B6E2B, custom: 'hitting_mat_portable' },

  // ─── Generic fallbacks (box geometry with correct dimensions) ───
  sofa_3:      { name: 'Sofa (3-seter)', w: 2.1, h: 0.85, d: 0.9, color: 0x6B4C3B },
  sofa_2:      { name: 'Sofa (2-seter)', w: 1.5, h: 0.85, d: 0.9, color: 0x6B4C3B },
  stol:        { name: 'Lenestol', w: 0.85, h: 0.85, d: 0.85, color: 0x7B5C4B },
  sofabord:    { name: 'Sofabord', w: 1.2, h: 0.45, d: 0.6, color: 0x8B7355 },
  spisebord:   { name: 'Spisebord', w: 1.6, h: 0.75, d: 0.9, color: 0x8B7355 },
  tv_benk:     { name: 'TV-benk', w: 1.8, h: 0.5, d: 0.4, color: 0x444444 },
  bokhylle:    { name: 'Bokhylle', w: 1.0, h: 1.8, d: 0.35, color: 0x9B8365 },
  gulvlampe:   { name: 'Gulvlampe', w: 0.3, h: 1.6, d: 0.3, color: 0xCCCCCC },
  kjokkenbenk: { name: 'Kjøkkenbenk', w: 2.5, h: 0.9, d: 0.6, color: 0xEEEEEE },
  spisestol:   { name: 'Spisestol', w: 0.45, h: 0.9, d: 0.45, color: 0x8B7355 },
};

// ─── HELPERS ───

// PBR material factory with shadow support
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.5,
    metalness: opts.metalness ?? 0.0,
    ...opts,
  });
}

function enableShadows(group) {
  group.traverse(c => {
    if (c.isMesh && c.material.visible !== false) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
}

function addEdges(mesh, group) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  edges.position.copy(mesh.position);
  edges.rotation.copy(mesh.rotation);
  group.add(edges);
}

function addLabel(name, h, group) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 256, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.6, 0.2, 1);
  sprite.position.y = h + 0.25;
  group.add(sprite);
}

// ─── BESTÅ skap (3×60cm = 180cm breed, 40cm dyp, 192cm høy) ───
function createBesta(group) {
  const W = 1.80, H = 1.92, D = 0.40;
  const frameW = 0.60, wallT = 0.018;
  const drawerH = 0.26;
  const drawerGap = 0.003;
  const cabinetMat = mat(0x2B2B2B, { roughness: 0.4, metalness: 0.0 }); // smooth laminate
  const drawerMat = mat(0x3C3C3C, { roughness: 0.4 });
  const handleMat = mat(0x888888, { roughness: 0.3, metalness: 0.8 }); // metal handles
  const shelfMat = mat(0x2B2B2B, { roughness: 0.4 });

  for (let i = 0; i < 3; i++) {
    const offsetX = -W/2 + frameW/2 + i * frameW;
    const cabinetGroup = new THREE.Group();

    const back = new THREE.Mesh(new THREE.BoxGeometry(frameW, H, wallT), cabinetMat);
    back.position.set(0, H/2, -D/2 + wallT/2);
    cabinetGroup.add(back);

    const top = new THREE.Mesh(new THREE.BoxGeometry(frameW, wallT, D), cabinetMat);
    top.position.set(0, H - wallT/2, 0);
    cabinetGroup.add(top);

    const bottom = new THREE.Mesh(new THREE.BoxGeometry(frameW, wallT, D), cabinetMat);
    bottom.position.set(0, wallT/2, 0);
    cabinetGroup.add(bottom);

    const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, D), cabinetMat);
    left.position.set(-frameW/2 + wallT/2, H/2, 0);
    cabinetGroup.add(left);

    const right = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, D), cabinetMat);
    right.position.set(frameW/2 - wallT/2, H/2, 0);
    cabinetGroup.add(right);

    // Drawer section (bottom)
    const dividerY = wallT + drawerH * 2 + drawerGap;
    const divider = new THREE.Mesh(new THREE.BoxGeometry(frameW - 2*wallT, wallT, D - wallT), shelfMat);
    divider.position.set(0, dividerY, wallT/2);
    cabinetGroup.add(divider);

    for (let d = 0; d < 2; d++) {
      const dY = wallT + d * (drawerH + drawerGap) + drawerH / 2;
      const dW = frameW - 2*wallT - 0.006;
      const dH = drawerH - drawerGap;
      const drawerFront = new THREE.Mesh(new THREE.BoxGeometry(dW, dH, 0.018), drawerMat);
      drawerFront.position.set(0, dY, D/2 - 0.009);
      cabinetGroup.add(drawerFront);
      addEdges(drawerFront, cabinetGroup);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.012, 0.02), handleMat);
      handle.position.set(0, dY, D/2 + 0.003);
      cabinetGroup.add(handle);
    }

    // Open shelves (above drawers)
    const shelfStart = dividerY + wallT;
    const shelfZone = H - wallT - shelfStart;
    const numShelves = 3;
    for (let s = 1; s < numShelves; s++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(frameW - 2*wallT, wallT, D - wallT), shelfMat);
      shelf.position.set(0, shelfStart + s * (shelfZone / numShelves), wallT/2);
      cabinetGroup.add(shelf);
    }

    cabinetGroup.position.x = offsetX;
    group.add(cabinetGroup);
  }

  // Dividing lines between cabinets
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111111 });
  for (let i = 1; i < 3; i++) {
    const x = -W/2 + i * frameW;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, D/2), new THREE.Vector3(x, H, D/2)
    ]);
    group.add(new THREE.Line(lineGeo, lineMat));
  }

  // Bounding box for raycasting (children[0])
  const boundingBox = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  boundingBox.position.y = H/2;
  group.add(boundingBox);
  group.children.splice(group.children.indexOf(boundingBox), 1);
  group.children.unshift(boundingBox);
}

// ─── Söderhamn hjørnesofa 3-seter (L-form ~192×192cm, h=83cm) ───
function createSoderhamn(group) {
  const seatH = 0.40, backH = 0.83, seatD = 0.99;
  const cushionT = 0.18;
  const backCushionT = 0.20;
  const sectionW = 0.93;
  const cornerW = 0.99;
  const totalArm1 = cornerW + sectionW;
  const totalArm2 = cornerW + sectionW;
  const legH = 0.14;

  const frameMat = mat(0x6E6E6E, { roughness: 0.8 }); // fabric base
  const cushionMat = mat(0x8E8E8E, { roughness: 0.9 }); // soft fabric
  const backMat = mat(0x7E7E7E, { roughness: 0.9 }); // soft fabric
  const legMat = mat(0x333333, { roughness: 0.3, metalness: 0.6 }); // metal legs

  // Bounding box for raycasting (children[0])
  const boundingBox = new THREE.Mesh(
    new THREE.BoxGeometry(totalArm1, backH, totalArm2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  boundingBox.position.set(0, backH/2, 0);
  group.add(boundingBox);

  function sofaSegment(w, d, x, z, backSide) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, seatH - cushionT - legH, d), frameMat);
    base.position.set(x, legH + (seatH - cushionT - legH)/2, z);
    group.add(base);

    const cushion = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, cushionT, d - 0.04), cushionMat);
    cushion.position.set(x, seatH - cushionT/2, z);
    group.add(cushion);

    if (backSide === 'z-') {
      const bc = new THREE.Mesh(new THREE.BoxGeometry(w, backH - seatH, backCushionT), backMat);
      bc.position.set(x, seatH + (backH - seatH)/2, z - d/2 + backCushionT/2);
      group.add(bc);
    } else if (backSide === 'x-') {
      const bc = new THREE.Mesh(new THREE.BoxGeometry(backCushionT, backH - seatH, d), backMat);
      bc.position.set(x - w/2 + backCushionT/2, seatH + (backH - seatH)/2, z);
      group.add(bc);
    } else if (backSide === 'both') {
      const bc1 = new THREE.Mesh(new THREE.BoxGeometry(w, backH - seatH, backCushionT), backMat);
      bc1.position.set(x, seatH + (backH - seatH)/2, z - d/2 + backCushionT/2);
      group.add(bc1);
      const bc2 = new THREE.Mesh(new THREE.BoxGeometry(backCushionT, backH - seatH, d), backMat);
      bc2.position.set(x - w/2 + backCushionT/2, seatH + (backH - seatH)/2, z);
      group.add(bc2);
    }

    const legR = 0.02;
    const positions = [
      [x - w/2 + 0.06, z - d/2 + 0.06],
      [x + w/2 - 0.06, z - d/2 + 0.06],
      [x - w/2 + 0.06, z + d/2 - 0.06],
      [x + w/2 - 0.06, z + d/2 - 0.06],
    ];
    for (const [lx, lz] of positions) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, legH, 6), legMat);
      leg.position.set(lx, legH/2, lz);
      group.add(leg);
    }
  }

  const cx = -totalArm1/2 + cornerW/2;
  const cz = -totalArm2/2 + cornerW/2;
  sofaSegment(cornerW, cornerW, cx, cz, 'both');

  const arm1x = -totalArm1/2 + cornerW + sectionW/2;
  const arm1z = -totalArm2/2 + seatD/2;
  sofaSegment(sectionW, seatD, arm1x, arm1z, 'z-');

  const arm2x = -totalArm1/2 + seatD/2;
  const arm2z = -totalArm2/2 + cornerW + sectionW/2;
  sofaSegment(seatD, sectionW, arm2x, arm2z, 'x-');
}

// ─── Bolia Cana HiFi-møbel (128×46×40cm) + Samsung The Frame 50" ───
function createCanaTv(group) {
  const benchW = 1.28, benchH = 0.46, benchD = 0.40;
  const legH = 0.12, legR = 0.015;
  const sideH = benchH - legH - 0.025;

  const oakMat = mat(0xC4A87C, { roughness: 0.7 }); // natural oak
  const frontMat = mat(0xB89B6A, { roughness: 0.8 }); // woven front
  const legMat = mat(0x8B7355, { roughness: 0.6 }); // wood legs
  const tvMat = mat(0x111111, { roughness: 0.2, metalness: 0.1 }); // TV frame
  const screenMat = mat(0x222233, { roughness: 0.1, metalness: 0.1 }); // glossy screen

  // Bounding box for raycasting (children[0])
  const totalH = benchH + 0.645;
  const boundingBox = new THREE.Mesh(
    new THREE.BoxGeometry(benchW, totalH, benchD),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  boundingBox.position.y = totalH/2;
  group.add(boundingBox);

  // Top plate
  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(benchW, 0.025, benchD), oakMat);
  topPlate.position.set(0, benchH - 0.0125, 0);
  group.add(topPlate);

  // Side panels
  const leftSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, sideH, benchD), oakMat);
  leftSide.position.set(-benchW/2 + 0.01, legH + sideH/2, 0);
  group.add(leftSide);

  const rightSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, sideH, benchD), oakMat);
  rightSide.position.set(benchW/2 - 0.01, legH + sideH/2, 0);
  group.add(rightSide);

  // Center divider
  const divider = new THREE.Mesh(new THREE.BoxGeometry(0.02, sideH, benchD - 0.04), oakMat);
  divider.position.set(0, legH + sideH/2, 0);
  group.add(divider);

  // Front panels (woven texture effect)
  const doorW = (benchW - 0.06) / 2;
  for (let i = 0; i < 2; i++) {
    const dx = -benchW/2 + 0.03 + doorW/2 + i * (doorW + 0.02);
    const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(doorW, sideH - 0.02, 0.015), frontMat);
    frontPanel.position.set(dx, legH + sideH/2, benchD/2 - 0.007);
    group.add(frontPanel);
    addEdges(frontPanel, group);

    const lineMatW = new THREE.LineBasicMaterial({ color: 0x9B8060, transparent: true, opacity: 0.5 });
    for (let j = 1; j <= 6; j++) {
      const ly = legH + j * (sideH / 7);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(dx - doorW/2 + 0.01, ly, benchD/2 + 0.001),
        new THREE.Vector3(dx + doorW/2 - 0.01, ly, benchD/2 + 0.001),
      ]);
      group.add(new THREE.Line(lineGeo, lineMatW));
    }
  }

  // Back panel
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(benchW - 0.04, sideH, 0.012), oakMat);
  backPanel.position.set(0, legH + sideH/2, -benchD/2 + 0.006);
  group.add(backPanel);

  // Bottom shelf
  const bottomShelf = new THREE.Mesh(new THREE.BoxGeometry(benchW - 0.04, 0.015, benchD - 0.04), oakMat);
  bottomShelf.position.set(0, legH + 0.0075, 0);
  group.add(bottomShelf);

  // Legs
  const legPositions = [
    [-benchW/2 + 0.04, -benchD/2 + 0.04],
    [benchW/2 - 0.04, -benchD/2 + 0.04],
    [-benchW/2 + 0.04, benchD/2 - 0.04],
    [benchW/2 - 0.04, benchD/2 - 0.04],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR * 1.3, legH, 6), legMat);
    leg.position.set(lx, legH/2, lz);
    group.add(leg);
  }

  // Samsung The Frame 50" TV
  const tvW = 1.1252, tvH = 0.6452, tvD = 0.0254;
  const frameT = 0.025;

  const tvFrame = new THREE.Mesh(new THREE.BoxGeometry(tvW, tvH, tvD), tvMat);
  tvFrame.position.set(0, benchH + tvH/2 + 0.005, 0);
  group.add(tvFrame);
  addEdges(tvFrame, group);

  const scrW = tvW - 2 * frameT;
  const scrH = tvH - 2 * frameT;
  const screen = new THREE.Mesh(new THREE.BoxGeometry(scrW, scrH, 0.003), screenMat);
  screen.position.set(0, benchH + tvH/2 + 0.005, tvD/2 + 0.001);
  group.add(screen);

  const frameBorderMat = new THREE.LineBasicMaterial({ color: 0x444444 });
  const by = benchH + 0.005;
  const frameLineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-scrW/2, by + frameT, tvD/2 + 0.002),
    new THREE.Vector3(scrW/2, by + frameT, tvD/2 + 0.002),
    new THREE.Vector3(scrW/2, by + tvH - frameT, tvD/2 + 0.002),
    new THREE.Vector3(-scrW/2, by + tvH - frameT, tvD/2 + 0.002),
    new THREE.Vector3(-scrW/2, by + frameT, tvD/2 + 0.002),
  ]);
  group.add(new THREE.Line(frameLineGeo, frameBorderMat));
}

// ─── PAX Høyskap for golfsim-lagring ───
function createPaxGolfsim(group) {
  const W = 1.00, H = 2.01, D = 0.58;
  const woodMat = mat(0xE8DCC8, { roughness: 0.7 }); // Birch-look
  const doorMat = mat(0xF5EFE0, { roughness: 0.6 });
  const darkMat = mat(0x333333, { roughness: 0.8 });
  const greenMat = mat(0x2B6E2B, { roughness: 0.9 });
  const handleMat = mat(0xAAAAAA, { roughness: 0.3, metalness: 0.7 });

  // Main cabinet body (back + sides + top + bottom)
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.015), woodMat);
  backPanel.position.set(0, H / 2, D / 2 - 0.0075);
  group.add(backPanel);
  for (const sx of [-W / 2 + 0.01, W / 2 - 0.01]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, H, D), woodMat);
    side.position.set(sx, H / 2, 0);
    group.add(side);
  }
  const topB = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, D), woodMat);
  topB.position.set(0, H - 0.01, 0);
  group.add(topB);
  const bottomB = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, D), woodMat);
  bottomB.position.set(0, 0.01, 0);
  group.add(bottomB);

  // Doors (2 panels, slightly in front)
  for (const sx of [-W / 4, W / 4]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(W / 2 - 0.02, H - 0.04, 0.018), doorMat);
    door.position.set(sx, H / 2, -D / 2 + 0.009);
    group.add(door);
    addEdges(door, group);
    // Handle
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 6), handleMat);
    handle.position.set(sx + (sx > 0 ? -0.15 : 0.15), H / 2, -D / 2 - 0.005);
    group.add(handle);
  }

  // Interior shelves (visible through slightly open door gap)
  // Shelf 1: rolled hitting mat
  const matRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 16), greenMat);
  matRoll.rotation.z = Math.PI / 2;
  matRoll.position.set(0, 0.15, 0.05);
  group.add(matRoll);
  // Shelf 2: folded net frame
  const shelf1 = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.015, D - 0.04), woodMat);
  shelf1.position.set(0, 0.40, 0);
  group.add(shelf1);
  const netBundle = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.20, 0.30), darkMat);
  netBundle.position.set(0, 0.52, 0);
  group.add(netBundle);
  // Shelf 3: launch monitor + accessories
  const shelf2 = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.015, D - 0.04), woodMat);
  shelf2.position.set(0, 0.75, 0);
  group.add(shelf2);
  // Launch monitor (small box like Garmin R10)
  const lm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.06), mat(0x111111, { roughness: 0.3, metalness: 0.4 }));
  lm.position.set(-0.20, 0.80, -0.05);
  group.add(lm);
  // Projector (compact)
  const proj = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.10, 0.20), mat(0x222222, { roughness: 0.4, metalness: 0.3 }));
  proj.position.set(0.10, 0.82, 0);
  group.add(proj);
  // Upper half: regular shelves (other storage)
  for (const sy of [1.10, 1.50]) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.015, D - 0.04), woodMat);
    sh.position.set(0, sy, 0);
    group.add(sh);
  }
  // Label on top
  addEdges(backPanel, group);
}

// ─── Retractable screen (wall/ceiling mounted) ───
function createRetractableScreen(group) {
  const W = 2.60, H_case = 0.12, D_case = 0.15;
  const caseMat = mat(0x222222, { roughness: 0.4, metalness: 0.3 });
  const screenMat = mat(0xEEEEEE, { roughness: 0.95, metalness: 0.0 });

  // Housing case (roller)
  const housing = new THREE.Mesh(new THREE.BoxGeometry(W, H_case, D_case), caseMat);
  housing.position.set(0, H_case / 2, 0);
  group.add(housing);
  addEdges(housing, group);

  // Deployed screen hanging down
  const screenH = 2.0;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.10, screenH),
    new THREE.MeshStandardMaterial({
      color: 0xF8F8F8, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide
    })
  );
  screen.position.set(0, -screenH / 2, 0);
  group.add(screen);

  // Bottom bar (weight bar)
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, W - 0.08, 8), caseMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, -screenH, 0);
  group.add(bar);

  // Projected image area (slightly inset, darker rectangle)
  const imgArea = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.30, screenH - 0.20),
    new THREE.MeshStandardMaterial({
      color: 0x1a3322, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide
    })
  );
  imgArea.position.set(0, -screenH / 2, -0.001);
  group.add(imgArea);
}

// ─── Portable/foldable enclosure (deployed state) ───
function createPortableEnclosure(group) {
  const W = 2.40, H = 2.80, D = 1.80;
  const frameMat = mat(0x333333, { roughness: 0.3, metalness: 0.7 });
  const netMat = new THREE.MeshStandardMaterial({
    color: 0x111111, roughness: 0.9, metalness: 0.0,
    transparent: true, opacity: 0.3, side: THREE.DoubleSide
  });
  const poleR = 0.015;

  // 4 corner poles (front only + 2 mid-side)
  const corners = [
    [-W/2, 0, -D/2], [W/2, 0, -D/2],  // front
    [-W/2, 0, D*0.3], [W/2, 0, D*0.3], // back (shorter, open entry)
  ];
  for (const [cx, cy, cz] of corners) {
    const poleH = cz < 0 ? H : H * 0.7; // Back poles shorter
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, poleH, 8), frameMat);
    pole.position.set(cx, poleH / 2, cz);
    group.add(pole);
  }

  // Top frame rails
  const topRailF = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 0.7, poleR * 0.7, W, 6), frameMat);
  topRailF.rotation.z = Math.PI / 2;
  topRailF.position.set(0, H, -D / 2);
  group.add(topRailF);

  // Side rails
  for (const sx of [-W/2, W/2]) {
    const sideD = D * 0.8;
    const sideRail = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 0.7, poleR * 0.7, sideD, 6), frameMat);
    sideRail.rotation.x = Math.PI / 2;
    sideRail.position.set(sx, H * 0.85, -D / 2 + sideD / 2);
    group.add(sideRail);
  }

  // Side net panels
  for (const sx of [-W/2, W/2]) {
    const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.8, H), netMat);
    sideNet.rotation.y = Math.PI / 2;
    sideNet.position.set(sx, H / 2, -D / 2 + D * 0.4);
    group.add(sideNet);
  }

  // Top net
  const topNet = new THREE.Mesh(new THREE.PlaneGeometry(W, D * 0.8), netMat);
  topNet.rotation.x = Math.PI / 2;
  topNet.position.set(0, H, -D / 2 + D * 0.4);
  group.add(topNet);

  // Bottom frame rail (front)
  const bottomRail = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 0.7, poleR * 0.7, W, 6), frameMat);
  bottomRail.rotation.z = Math.PI / 2;
  bottomRail.position.set(0, poleR, -D / 2);
  group.add(bottomRail);
}

// ─── Portable hitting mat ───
function createHittingMatPortable(group) {
  const W = 1.50, D = 1.20, H = 0.025;

  // Rubber base
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.04, 0.012, D + 0.04),
    mat(0x1a1a1a, { roughness: 0.92 })
  );
  base.position.y = 0.006;
  group.add(base);

  // Turf layer
  const turfCanvas = document.createElement('canvas');
  turfCanvas.width = 256; turfCanvas.height = 256;
  const ctx = turfCanvas.getContext('2d');
  ctx.fillStyle = '#2B7A2B';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3500; i++) {
    const gx = Math.random() * 256;
    const gy = Math.random() * 256;
    const shade = 25 + Math.random() * 55;
    ctx.strokeStyle = `rgba(${shade}, ${70 + Math.random() * 70}, ${shade}, 0.4)`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + (Math.random() - 0.5) * 3, gy - 2 - Math.random() * 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(turfCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);

  const turf = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.0 })
  );
  turf.position.y = 0.012 + H / 2;
  group.add(turf);

  // Alignment marks
  const lineMat = mat(0xFFFFFF, { roughness: 0.5 });
  const centerLine = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.001, D * 0.6), lineMat);
  centerLine.position.set(0, H + 0.013, 0);
  group.add(centerLine);

  // Tee position marker
  const tee = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12), mat(0xCC0000));
  tee.position.set(0, H + 0.014, -D / 4);
  group.add(tee);
}

// ─── FACTORY ───

/**
 * Create furniture mesh synchronously (fallback/box geometry).
 * Used when GLB is not available or for immediate placement.
 */
export function createFurnitureMesh(type) {
  const cat = FURNITURE_CATALOG[type];
  if (!cat) return null;
  const group = new THREE.Group();

  if (cat.custom === 'besta') {
    createBesta(group);
  } else if (cat.custom === 'soderhamn') {
    createSoderhamn(group);
  } else if (cat.custom === 'cana_tv') {
    createCanaTv(group);
  } else if (cat.custom === 'pax_golfsim') {
    createPaxGolfsim(group);
  } else if (cat.custom === 'retractable_screen') {
    createRetractableScreen(group);
  } else if (cat.custom === 'portable_enclosure') {
    createPortableEnclosure(group);
  } else if (cat.custom === 'hitting_mat_portable') {
    createHittingMatPortable(group);
  } else {
    const geo = new THREE.BoxGeometry(cat.w, cat.h, cat.d);
    const boxMat = new THREE.MeshStandardMaterial({ color: cat.color, roughness: 0.7, metalness: 0.0 });
    const box = new THREE.Mesh(geo, boxMat);
    box.position.y = cat.h / 2;
    group.add(box);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
    );
    edges.position.y = cat.h / 2;
    group.add(edges);
  }

  addLabel(cat.name, cat.h, group);
  enableShadows(group);
  group.userData.type = type;
  group.userData.entityType = 'furniture';
  return group;
}

/**
 * Create furniture mesh — loads GLB if available, falls back to box geometry.
 * Always returns a THREE.Group with correct position/scale.
 */
export async function createFurnitureMeshAsync(type) {
  const cat = FURNITURE_CATALOG[type];
  if (!cat) return null;

  // Try GLB first
  if (cat.glb) {
    try {
      const group = await loadGLB(cat.glb, {
        scale: cat.glbScale || 1,
        rotateY: cat.glbRotateY || 0,
      });
      addLabel(cat.name, cat.h, group);
      enableShadows(group);
      group.userData.type = type;
      group.userData.entityType = 'furniture';
      group.userData.isGLB = true;
      return group;
    } catch (e) {
      console.warn(`GLB load failed for ${type} (${cat.glb}), using fallback:`, e.message);
    }
  }

  // Fallback to built-in mesh
  return createFurnitureMesh(type);
}

/**
 * Add a new furniture type to the catalog at runtime.
 * Used by the Claude skill to add IKEA models.
 */
export function addToCatalog(id, entry) {
  FURNITURE_CATALOG[id] = entry;
}

// ─── PERSISTENCE ───

import { state } from './state.js';
import { register } from './entity-registry.js';

/**
 * Load furniture placements from config and recreate meshes.
 * Called once at startup from main.js.
 */
export async function loadFurnitureFromConfig() {
  const cfg = state.apartmentConfig;
  if (!cfg?.furniture?.length) return;

  // Load all furniture in parallel (GLB models load async)
  const loadPromises = cfg.furniture.map(async (entry) => {
    const cat = FURNITURE_CATALOG[entry.type];
    if (!cat) return;

    // Use async loader (tries GLB first, falls back to box)
    const mesh = await createFurnitureMeshAsync(entry.type);
    if (!mesh) return;

    const x = entry.x ?? 0;
    const z = entry.z ?? 0;
    const rotation = entry.rotation ?? 0;

    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotation * Math.PI / 180;
    state.scene.add(mesh);

    const id = entry.id ?? state.nextItemId++;
    if (id >= state.nextItemId) state.nextItemId = id + 1;

    // Register as entity for selection/hover
    mesh.userData.entityId = String(id);
    register('furniture', String(id), mesh);

    state.placedItems.push({ id, type: entry.type, x, z, rotation, mesh });
  });

  await Promise.all(loadPromises);
}

/**
 * Save current furniture placements to config (in-memory).
 * Call after any furniture change (add, move, rotate, delete).
 */
export function saveFurnitureToConfig() {
  const cfg = state.apartmentConfig;
  if (!cfg) return;
  cfg.furniture = state.placedItems.map(item => ({
    id: item.id,
    type: item.type,
    x: parseFloat(item.x.toFixed(3)),
    z: parseFloat(item.z.toFixed(3)),
    rotation: item.rotation,
  }));
}
