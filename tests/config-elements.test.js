import { describe, it, expect } from 'vitest';

// ─── Config schema tests for windows, doors, protrusions ───
// Tests config manipulation logic without THREE.js dependency

// Helper: create a minimal apartment config
function makeConfig() {
  return {
    walls: {
      exterior: { minX: -4.38, maxX: 4.38, minZ: -2.50, maxZ: 2.50, thickness: 0.08 },
      interior: [
        { id: 'A', axis: 'x', pos: -2.08, from: -2.50, to: 2.50 },
        { id: 'B', axis: 'z', pos: -0.54, from: -4.38, to: -2.08 },
      ],
      protrusions: [],
    },
    windows: [
      { id: 'W1', wall: 'south', x1: -3.795, x2: -2.613, sillHeight: 1.00, topHeight: 2.20 },
    ],
    doors: [
      { id: 'D1', wall: 'B', pos: -0.54, axis: 'z', from: -3.6, to: -2.8, height: 2.0 },
    ],
    rooms: [
      { id: 'stue', bounds: { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 }, ceilingType: 'slope' },
    ],
  };
}

// ─── Protrusion geometry helpers (mirrors room-details.js logic) ───

function computeProtrusionGeometry(p, ceilAtFn) {
  const b = p.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const fromY = p.fromY ?? 0;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const h = p.height ?? (ceilAtFn(cx, cz) - fromY);
  const cy = fromY + h / 2;
  return { cx, cy, cz, w, h, d, fromY };
}

// ─── Auto-ID generation (mirrors mcp_server.py logic) ───

function autoGenerateId(prefix, existingItems) {
  const existingIds = new Set(existingItems.map(item => item.id));
  let idx = existingItems.length + 1;
  while (existingIds.has(`${prefix}${idx}`)) idx++;
  return `${prefix}${idx}`;
}

// ─── Update element logic (mirrors mcp_server.py logic) ───

function updateElement(config, elementType, elementId, updates) {
  let arr;
  if (elementType === 'wall') {
    arr = config.walls.interior;
  } else if (elementType === 'protrusion') {
    arr = config.walls.protrusions;
  } else if (elementType === 'window') {
    arr = config.windows;
  } else if (elementType === 'door') {
    arr = config.doors;
  }

  const element = arr.find(e => e.id === elementId);
  if (!element) return null;

  const { id: _, ...rest } = updates;
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === 'object' && v !== null && typeof element[k] === 'object' && element[k] !== null) {
      Object.assign(element[k], v);
    } else {
      element[k] = v;
    }
  }
  return element;
}

// ─── TESTS ───

describe('Protrusion config and geometry', () => {
  it('computes center and dimensions from bounds', () => {
    const p = {
      id: 'P1',
      bounds: { minX: 3.50, maxX: 4.38, minZ: 1.80, maxZ: 2.50 },
      height: 2.25,
    };
    const geo = computeProtrusionGeometry(p, () => 2.25);
    expect(geo.cx).toBeCloseTo(3.94, 2);
    expect(geo.cz).toBeCloseTo(2.15, 2);
    expect(geo.w).toBeCloseTo(0.88, 2);
    expect(geo.d).toBeCloseTo(0.70, 2);
    expect(geo.h).toBe(2.25);
    expect(geo.cy).toBeCloseTo(1.125, 2);
  });

  it('uses ceilAt when height is not specified', () => {
    const p = {
      id: 'P1',
      bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    };
    const mockCeilAt = (x, z) => 3.0;
    const geo = computeProtrusionGeometry(p, mockCeilAt);
    expect(geo.h).toBe(3.0);
    expect(geo.cy).toBeCloseTo(1.5, 2);
  });

  it('respects fromY for hanging beams', () => {
    const p = {
      id: 'P1',
      bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      fromY: 1.8,
      height: 0.5,
    };
    const geo = computeProtrusionGeometry(p, () => 2.25);
    expect(geo.fromY).toBe(1.8);
    expect(geo.h).toBe(0.5);
    expect(geo.cy).toBeCloseTo(2.05, 2); // 1.8 + 0.5/2
  });

  it('uses ceilAt minus fromY when height is omitted with fromY', () => {
    const p = {
      id: 'P1',
      bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      fromY: 1.5,
    };
    const mockCeilAt = () => 2.25;
    const geo = computeProtrusionGeometry(p, mockCeilAt);
    expect(geo.h).toBeCloseTo(0.75, 2); // 2.25 - 1.5
  });
});

describe('Auto ID generation', () => {
  it('generates P1 for empty protrusions', () => {
    expect(autoGenerateId('P', [])).toBe('P1');
  });

  it('generates next available ID', () => {
    const existing = [{ id: 'P1' }, { id: 'P2' }];
    expect(autoGenerateId('P', existing)).toBe('P3');
  });

  it('skips existing IDs', () => {
    const existing = [{ id: 'W1' }, { id: 'W3' }];
    // length+1 = 3, W3 exists, so skip to W4
    expect(autoGenerateId('W', existing)).toBe('W4');
  });

  it('works for doors', () => {
    const existing = [{ id: 'D1' }, { id: 'D2' }, { id: 'D3' }];
    expect(autoGenerateId('D', existing)).toBe('D4');
  });
});

describe('update_element logic', () => {
  it('updates window position', () => {
    const config = makeConfig();
    const updated = updateElement(config, 'window', 'W1', { x1: -3.5, x2: -2.3 });
    expect(updated).not.toBeNull();
    expect(updated.x1).toBe(-3.5);
    expect(updated.x2).toBe(-2.3);
    // Other fields unchanged
    expect(updated.sillHeight).toBe(1.00);
    expect(updated.wall).toBe('south');
  });

  it('updates door height', () => {
    const config = makeConfig();
    const updated = updateElement(config, 'door', 'D1', { height: 2.1 });
    expect(updated.height).toBe(2.1);
    expect(updated.from).toBe(-3.6); // unchanged
  });

  it('updates wall position', () => {
    const config = makeConfig();
    const updated = updateElement(config, 'wall', 'A', { pos: -2.20 });
    expect(updated.pos).toBe(-2.20);
    expect(updated.axis).toBe('x'); // unchanged
  });

  it('deep merges protrusion bounds', () => {
    const config = makeConfig();
    config.walls.protrusions.push({
      id: 'P1',
      bounds: { minX: 3.0, maxX: 4.0, minZ: 1.5, maxZ: 2.5 },
    });
    const updated = updateElement(config, 'protrusion', 'P1', {
      bounds: { minX: 3.5 },
    });
    expect(updated.bounds.minX).toBe(3.5);
    expect(updated.bounds.maxX).toBe(4.0); // unchanged
    expect(updated.bounds.minZ).toBe(1.5); // unchanged
  });

  it('does not allow changing ID', () => {
    const config = makeConfig();
    const updated = updateElement(config, 'window', 'W1', { id: 'W99', x1: -3.0 });
    expect(updated.id).toBe('W1'); // ID unchanged
    expect(updated.x1).toBe(-3.0); // other field updated
  });

  it('returns null for non-existent element', () => {
    const config = makeConfig();
    const updated = updateElement(config, 'window', 'W99', { x1: 0 });
    expect(updated).toBeNull();
  });
});

describe('add_door logic', () => {
  it('door on interior wall inherits axis and pos', () => {
    const config = makeConfig();
    const wall = config.walls.interior.find(w => w.id === 'A');
    // Wall A: axis='x', pos=-2.08
    const door = {
      id: autoGenerateId('D', config.doors),
      wall: 'A',
      from: -1.5,
      to: -0.7,
      height: 2.0,
      axis: wall.axis,
      pos: wall.pos,
    };
    expect(door.id).toBe('D2');
    expect(door.axis).toBe('x');
    expect(door.pos).toBe(-2.08);
  });

  it('door on exterior south wall gets correct axis and pos', () => {
    const config = makeConfig();
    const ext = config.walls.exterior;
    const door = {
      id: 'D2',
      wall: 'south',
      from: -1.0,
      to: 0.0,
      height: 2.0,
      axis: 'z',
      pos: ext.minZ,
    };
    expect(door.axis).toBe('z');
    expect(door.pos).toBe(-2.50);
  });

  it('door on exterior east wall gets correct axis and pos', () => {
    const config = makeConfig();
    const ext = config.walls.exterior;
    const door = {
      id: 'D2',
      wall: 'east',
      from: 1.0,
      to: 1.8,
      height: 2.0,
      axis: 'x',
      pos: ext.minX,
    };
    expect(door.axis).toBe('x');
    expect(door.pos).toBe(-4.38);
  });
});
