import { describe, it, expect } from 'vitest';

// ─── Tests for terrace steps, visibility toggles, and history icons ───
// Tests logic without THREE.js dependency

// ─── Terrace Step Geometry (mirrors room.js buildTerrace logic) ───

function computeTerraceSteps(steps, ufFloorY = 2.25) {
  const sb = steps.bounds;
  const risePerStep = steps.riseTotal / steps.count;
  const depthPerStep = (sb.maxZ - sb.minZ) / steps.count;
  const direction = steps.direction || 'toTerrace';

  const result = [];
  for (let i = 0; i < steps.count; i++) {
    const stepIdx = direction === 'fromTerrace' ? (steps.count - 1 - i) : i;
    const treadHeight = ufFloorY + risePerStep * (stepIdx + 1);
    const totalH = treadHeight - ufFloorY;
    const stepZ = sb.minZ + depthPerStep * i;

    result.push({
      index: i,
      stepIdx,
      topY: treadHeight,
      totalH,
      centerY: ufFloorY + totalH / 2,
      centerZ: stepZ + depthPerStep / 2,
      width: sb.maxX - sb.minX,
      depth: depthPerStep,
    });
  }
  return result;
}

// ─── Wall-Room Adjacency (mirrors ui.js toggleRoomWalls logic) ───

function meshTouchesRoom(meshMinX, meshMaxX, meshMinZ, meshMaxZ, roomBounds, tol = 0.15) {
  const b = roomBounds;
  const overlapX = meshMinX < b.maxX - tol && meshMaxX > b.minX + tol;
  const overlapZ = meshMinZ < b.maxZ - tol && meshMaxZ > b.minZ + tol;
  const touchMinX = Math.abs(meshMaxX - b.minX) < tol || Math.abs(meshMinX - b.minX) < tol;
  const touchMaxX = Math.abs(meshMinX - b.maxX) < tol || Math.abs(meshMaxX - b.maxX) < tol;
  const touchMinZ = Math.abs(meshMaxZ - b.minZ) < tol || Math.abs(meshMinZ - b.minZ) < tol;
  const touchMaxZ = Math.abs(meshMinZ - b.maxZ) < tol || Math.abs(meshMaxZ - b.maxZ) < tol;
  return (overlapZ && (touchMinX || touchMaxX)) || (overlapX && (touchMinZ || touchMaxZ));
}

// ─── History Icon Mapping (mirrors ui.js historyIcon logic) ───

function historyIcon(label) {
  const l = label.toLowerCase();
  if (l.includes('kalibrering') || l.includes('mål')) return '📐';
  if (l.includes('vegg') || l.includes('wall')) return '🧱';
  if (l.includes('vindu') || l.includes('window')) return '🪟';
  if (l.includes('dør') || l.includes('door')) return '🚪';
  if (l.includes('tak') || l.includes('ceiling') || l.includes('roof')) return '⛺';
  if (l.includes('terrasse') || l.includes('terrace')) return '☀️';
  if (l.includes('møbel') || l.includes('furniture')) return '🪑';
  if (l.includes('rom') || l.includes('room')) return '📦';
  if (l.includes('trapp') || l.includes('stair')) return '🪜';
  if (l.includes('protrusion') || l.includes('bjelke')) return '🔲';
  if (l.includes('config') || l.includes('update')) return '⚙️';
  return '✏️';
}

// ─── TESTS ───

describe('Terrace step geometry', () => {
  const baseSteps = {
    count: 2,
    riseTotal: 0.45,
    bounds: { minX: 0.5, maxX: 2.0, minZ: 2.50, maxZ: 3.10 },
  };

  it('computes correct number of steps', () => {
    const steps = computeTerraceSteps(baseSteps);
    expect(steps.length).toBe(2);
  });

  it('toTerrace: ascending from south (minZ) to north (maxZ)', () => {
    const steps = computeTerraceSteps({ ...baseSteps, direction: 'toTerrace' });
    // Step 0 (south) should be lower than step 1 (north)
    expect(steps[0].topY).toBeLessThan(steps[1].topY);
    expect(steps[0].centerZ).toBeLessThan(steps[1].centerZ);
  });

  it('fromTerrace: descending from south (minZ) to north (maxZ)', () => {
    const steps = computeTerraceSteps({ ...baseSteps, direction: 'fromTerrace' });
    // Step 0 (south) should be higher than step 1 (north)
    expect(steps[0].topY).toBeGreaterThan(steps[1].topY);
  });

  it('solid blocks extend from floor level', () => {
    const steps = computeTerraceSteps({ ...baseSteps, direction: 'toTerrace' });
    const ufFloorY = 2.25;
    // Step 0: totalH = risePerStep * 1 = 0.225
    expect(steps[0].totalH).toBeCloseTo(0.225, 3);
    expect(steps[0].centerY).toBeCloseTo(ufFloorY + 0.225 / 2, 3);
    // Step 1: totalH = risePerStep * 2 = 0.45
    expect(steps[1].totalH).toBeCloseTo(0.45, 3);
    expect(steps[1].centerY).toBeCloseTo(ufFloorY + 0.45 / 2, 3);
  });

  it('last step top matches terrace floor', () => {
    const steps = computeTerraceSteps({ ...baseSteps, direction: 'toTerrace' });
    const terraceFloorY = 2.25 + 0.45; // ufFloorY + riseTotal
    expect(steps[steps.length - 1].topY).toBeCloseTo(terraceFloorY, 3);
  });

  it('step width and depth computed from bounds', () => {
    const steps = computeTerraceSteps(baseSteps);
    expect(steps[0].width).toBeCloseTo(1.5, 2); // 2.0 - 0.5
    expect(steps[0].depth).toBeCloseTo(0.3, 2); // (3.10 - 2.50) / 2
  });

  it('default direction is toTerrace', () => {
    const steps = computeTerraceSteps(baseSteps);
    expect(steps[0].topY).toBeLessThan(steps[1].topY);
  });

  it('3-step staircase distributes evenly', () => {
    const threeSteps = {
      count: 3,
      riseTotal: 0.60,
      direction: 'toTerrace',
      bounds: { minX: 0, maxX: 1.5, minZ: 2.50, maxZ: 3.40 },
    };
    const steps = computeTerraceSteps(threeSteps);
    expect(steps.length).toBe(3);
    expect(steps[0].topY).toBeCloseTo(2.25 + 0.20, 3);
    expect(steps[1].topY).toBeCloseTo(2.25 + 0.40, 3);
    expect(steps[2].topY).toBeCloseTo(2.25 + 0.60, 3);
  });
});

describe('Wall-room adjacency detection', () => {
  const stueBounds = { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 };

  it('detects south exterior wall touching stue', () => {
    // South wall mesh at Z ≈ -2.50
    expect(meshTouchesRoom(-4.38, 4.38, -2.58, -2.50, stueBounds)).toBe(true);
  });

  it('detects west interior wall touching stue', () => {
    // Wall A at X = -2.08
    expect(meshTouchesRoom(-2.16, -2.00, -2.50, 2.50, stueBounds)).toBe(true);
  });

  it('does not detect distant wall', () => {
    // Wall at X = 10 (far away)
    expect(meshTouchesRoom(9.9, 10.1, -2.50, 2.50, stueBounds)).toBe(false);
  });

  it('does not detect non-overlapping wall in other axis', () => {
    // Wall at Z = 2.50 (north wall), stue maxZ = 0.70
    expect(meshTouchesRoom(-4.38, 4.38, 2.42, 2.58, stueBounds)).toBe(false);
  });

  it('detects interior wall B touching garderobe', () => {
    const garderobeBounds = { minX: -4.38, maxX: -2.08, minZ: -2.50, maxZ: -0.54 };
    // Wall B: axis='z', pos=-0.54, spans X from -4.38 to -2.08
    expect(meshTouchesRoom(-4.38, -2.08, -0.62, -0.46, garderobeBounds)).toBe(true);
  });
});

describe('History icon mapping', () => {
  it('calibration icons', () => {
    expect(historyIcon('Kalibrering: stue width')).toBe('📐');
    expect(historyIcon('Nytt mål lagt til')).toBe('📐');
  });

  it('wall icons', () => {
    expect(historyIcon('Flytt vegg A')).toBe('🧱');
    expect(historyIcon('Update wall position')).toBe('🧱');
  });

  it('window and door icons', () => {
    expect(historyIcon('Legg til vindu')).toBe('🪟');
    expect(historyIcon('Ny dør lagt til')).toBe('🚪');
  });

  it('ceiling and terrace icons', () => {
    expect(historyIcon('Endre takhøyde')).toBe('⛺');
    expect(historyIcon('Terrasse oppdatert')).toBe('☀️');
  });

  it('furniture and room icons', () => {
    expect(historyIcon('Nytt møbel plassert')).toBe('🪑');
    expect(historyIcon('Rom endret')).toBe('📦');
  });

  it('stair and protrusion icons', () => {
    expect(historyIcon('Juster trapp')).toBe('🪜');
    expect(historyIcon('Ny bjelke')).toBe('🔲');
  });

  it('config/update icons', () => {
    expect(historyIcon('Oppdater config')).toBe('⚙️');
    expect(historyIcon('Config update')).toBe('⚙️');
  });

  it('default icon for unknown labels', () => {
    expect(historyIcon('Noe annet')).toBe('✏️');
    expect(historyIcon('Random endring')).toBe('✏️');
  });
});
