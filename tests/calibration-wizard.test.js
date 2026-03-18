import { describe, it, expect } from 'vitest';

// ─── Calibration wizard tests ───
// Tests wizard step generation, measurement storage, guide positioning,
// and drag constraint logic without THREE.js dependency.

// Helper: create a full apartment config for calibration testing
function makeConfig() {
  return {
    rooms: [
      { id: 'stue', name: 'Stue', bounds: { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 }, ceilingType: 'slope' },
      { id: 'kjokken', name: 'Kjøkken', bounds: { minX: -2.08, maxX: 1.81, minZ: 0.70, maxZ: 2.50 }, ceilingType: 'flat' },
      { id: 'bad', name: 'Bad', bounds: { minX: -4.38, maxX: -0.97, minZ: 0.70, maxZ: 2.50 }, ceilingType: 'flat' },
      { id: 'entre', name: 'Entre', bounds: { minX: -4.38, maxX: -2.92, minZ: -0.54, maxZ: 2.50 }, ceilingType: 'flat' },
      { id: 'garderobe', name: 'Garderobe', bounds: { minX: -4.38, maxX: -2.08, minZ: -2.50, maxZ: -0.54 }, ceilingType: 'flat' },
    ],
    upperFloor: {
      floorY: 2.25,
      rooms: [
        { id: 'soverom', name: 'Soverom', bounds: { minX: -4.38, maxX: -0.77, minZ: -2.50, maxZ: 2.50 }, ceilingType: 'flat' },
        { id: 'hems', name: 'Hems', bounds: { minX: -0.77, maxX: 4.38, minZ: 0.60, maxZ: 2.50 }, ceilingType: 'flat' },
        { id: 'terrasse', name: 'Terrasse', bounds: { minX: -4.48, maxX: 4.48, minZ: 2.50, maxZ: 7.61 } },
      ],
    },
    walls: {
      exterior: { minX: -4.38, maxX: 4.38, minZ: -2.50, maxZ: 2.50, thickness: 0.08 },
      interior: [],
    },
    measurements: { defaultWallThickness: 0.08, priors: { wallPositionWeight: 0.1, wallThicknessWeight: 10.0, heightWeight: 1.0 }, entries: [] },
    ceiling: {
      defaultHeight: 2.50,
      zones: [{ id: 'roof', type: 'slope', bounds: { minX: -4.38, maxX: 4.38, minZ: -2.50, maxZ: 2.50 }, slopeStartZ: -2.50, slopeEndZ: 2.50, startHeight: 2.214, endHeight: 4.81 }],
    },
  };
}

// ─── Wizard step generation ───

const ROOM_ORDER = [
  { id: 'stue', floor: 5 },
  { id: 'kjokken', floor: 5 },
  { id: 'bad', floor: 5 },
  { id: 'entre', floor: 5 },
  { id: 'garderobe', floor: 5 },
  { id: 'soverom', floor: 6 },
  { id: 'hems', floor: 6 },
];

function buildCalibrationSteps(cfg) {
  const steps = [];
  for (const { id, floor } of ROOM_ORDER) {
    const allRooms = [...(cfg.rooms || []), ...(cfg.upperFloor?.rooms || [])];
    const room = allRooms.find(r => r.id === id);
    if (!room) continue;
    const dims = (room.ceilingType === 'slope')
      ? ['width', 'depth', 'height_low', 'height_high']
      : ['width', 'depth', 'height'];
    for (const dim of dims) {
      steps.push({ roomId: id, floor, dim, roomName: room.name || id, room });
    }
  }
  return steps;
}

describe('Calibration Wizard Steps', () => {
  it('generates correct number of steps', () => {
    const cfg = makeConfig();
    const steps = buildCalibrationSteps(cfg);
    // stue: 4 (slope: w,d,h_low,h_high), kjokken/bad/entre/garderobe: 3 each, soverom/hems: 3 each
    expect(steps.length).toBe(4 + 3 + 3 + 3 + 3 + 3 + 3);
  });

  it('first step is stue width', () => {
    const steps = buildCalibrationSteps(makeConfig());
    expect(steps[0].roomId).toBe('stue');
    expect(steps[0].dim).toBe('width');
    expect(steps[0].floor).toBe(5);
  });

  it('slope rooms have height_low and height_high', () => {
    const steps = buildCalibrationSteps(makeConfig());
    const stueDims = steps.filter(s => s.roomId === 'stue').map(s => s.dim);
    expect(stueDims).toContain('height_low');
    expect(stueDims).toContain('height_high');
    expect(stueDims).not.toContain('height');
  });

  it('flat rooms have single height', () => {
    const steps = buildCalibrationSteps(makeConfig());
    const kjDims = steps.filter(s => s.roomId === 'kjokken').map(s => s.dim);
    expect(kjDims).toContain('height');
    expect(kjDims).not.toContain('height_low');
  });

  it('excludes terrasse from steps', () => {
    const steps = buildCalibrationSteps(makeConfig());
    expect(steps.find(s => s.roomId === 'terrasse')).toBeUndefined();
  });

  it('6th floor rooms have floor=6', () => {
    const steps = buildCalibrationSteps(makeConfig());
    const soveromSteps = steps.filter(s => s.roomId === 'soverom');
    expect(soveromSteps.every(s => s.floor === 6)).toBe(true);
  });

  it('room order follows ROOM_ORDER', () => {
    const steps = buildCalibrationSteps(makeConfig());
    const roomIds = [...new Set(steps.map(s => s.roomId))];
    expect(roomIds).toEqual(['stue', 'kjokken', 'bad', 'entre', 'garderobe', 'soverom', 'hems']);
  });
});

// ─── Measurement storage ───

describe('Measurement Storage', () => {
  it('stores measurement in entries array', () => {
    const cfg = makeConfig();
    cfg.measurements.entries.push({ room: 'stue', dim: 'width', value: 6.42 });
    expect(cfg.measurements.entries).toHaveLength(1);
    expect(cfg.measurements.entries[0].value).toBe(6.42);
  });

  it('updates existing measurement', () => {
    const cfg = makeConfig();
    cfg.measurements.entries.push({ room: 'stue', dim: 'width', value: 6.42 });
    const idx = cfg.measurements.entries.findIndex(e => e.room === 'stue' && e.dim === 'width');
    cfg.measurements.entries[idx].value = 6.38;
    expect(cfg.measurements.entries[0].value).toBe(6.38);
  });

  it('removes measurement by splicing', () => {
    const cfg = makeConfig();
    cfg.measurements.entries.push({ room: 'stue', dim: 'width', value: 6.42 });
    cfg.measurements.entries.push({ room: 'stue', dim: 'depth', value: 3.20 });
    const idx = cfg.measurements.entries.findIndex(e => e.room === 'stue' && e.dim === 'width');
    cfg.measurements.entries.splice(idx, 1);
    expect(cfg.measurements.entries).toHaveLength(1);
    expect(cfg.measurements.entries[0].dim).toBe('depth');
  });

  it('supports atZ position for dragged measurements', () => {
    const cfg = makeConfig();
    cfg.measurements.entries.push({ room: 'stue', dim: 'width', value: 6.42, atZ: 0.5 });
    expect(cfg.measurements.entries[0].atZ).toBe(0.5);
  });
});

// ─── Guide positioning ───

describe('Guide Positioning', () => {
  it('width guide midpoint is at midZ of room', () => {
    const b = { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 };
    const midZ = (b.minZ + b.maxZ) / 2;
    expect(midZ).toBeCloseTo(-0.90, 2);
  });

  it('depth guide midpoint is at midX of room', () => {
    const b = { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 };
    const midX = (b.minX + b.maxX) / 2;
    expect(midX).toBeCloseTo(1.15, 2);
  });

  it('guide Y is 1m above floor for floor 5', () => {
    const floorY = 0;
    const guideY = floorY + 1.0;
    expect(guideY).toBe(1.0);
  });

  it('guide Y is 3.25m for floor 6', () => {
    const floorY = 2.25;
    const guideY = floorY + 1.0;
    expect(guideY).toBe(3.25);
  });
});

// ─── Drag constraint logic ───

describe('Drag Constraints', () => {
  it('width guide drag is clamped to room Z bounds', () => {
    const b = { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 };
    const margin = 0.15;
    const clamp = (z) => Math.max(b.minZ + margin, Math.min(b.maxZ - margin, z));

    // Within bounds
    expect(clamp(0.0)).toBeCloseTo(0.0, 2);
    // Beyond maxZ
    expect(clamp(1.5)).toBeCloseTo(0.55, 2);
    // Beyond minZ
    expect(clamp(-5.0)).toBeCloseTo(-2.35, 2);
  });

  it('depth guide drag is clamped to room X bounds', () => {
    const b = { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 };
    const margin = 0.15;
    const clamp = (x) => Math.max(b.minX + margin, Math.min(b.maxX - margin, x));

    // Within bounds
    expect(clamp(1.0)).toBeCloseTo(1.0, 2);
    // Beyond maxX
    expect(clamp(10.0)).toBeCloseTo(4.23, 2);
    // Beyond minX
    expect(clamp(-10.0)).toBeCloseTo(-1.93, 2);
  });

  it('height guides are not draggable', () => {
    // Height axis is 'y', only 'x' and 'z' are draggable
    const draggable = (axis) => axis === 'x' || axis === 'z';
    expect(draggable('x')).toBe(true);
    expect(draggable('z')).toBe(true);
    expect(draggable('y')).toBe(false);
  });
});

// ─── Skip already-measured steps ───

describe('Wizard Skip Logic', () => {
  it('skips already-measured steps at start', () => {
    const cfg = makeConfig();
    cfg.measurements.entries = [
      { room: 'stue', dim: 'width', value: 6.42 },
      { room: 'stue', dim: 'depth', value: 3.20 },
    ];

    const steps = buildCalibrationSteps(cfg);
    let currentStep = 0;
    while (currentStep < steps.length) {
      const s = steps[currentStep];
      if (cfg.measurements.entries.find(e => e.room === s.roomId && e.dim === s.dim)) {
        currentStep++;
      } else {
        break;
      }
    }

    // Should skip first 2 steps (stue width, stue depth)
    expect(currentStep).toBe(2);
    expect(steps[currentStep].roomId).toBe('stue');
    expect(steps[currentStep].dim).toBe('height_low');
  });

  it('skips to done when all measured', () => {
    const cfg = makeConfig();
    const steps = buildCalibrationSteps(cfg);
    // Add all measurements
    for (const s of steps) {
      cfg.measurements.entries.push({ room: s.roomId, dim: s.dim, value: 2.0 });
    }

    let currentStep = 0;
    while (currentStep < steps.length) {
      const s = steps[currentStep];
      if (cfg.measurements.entries.find(e => e.room === s.roomId && e.dim === s.dim)) {
        currentStep++;
      } else {
        break;
      }
    }

    expect(currentStep).toBe(steps.length);
  });
});

// ─── Hit area dimensions ───

describe('Hit Area', () => {
  it('hit box is 40cm for width guide', () => {
    const axis = 'x';
    const length = 6.46;
    const hitW = (axis === 'x') ? length : 0.4;
    const hitH = 0.4;
    const hitD = (axis === 'z') ? length : 0.4;
    expect(hitW).toBe(6.46);
    expect(hitH).toBe(0.4);
    expect(hitD).toBe(0.4);
  });

  it('hit box is 40cm for depth guide', () => {
    const axis = 'z';
    const length = 3.20;
    const hitW = (axis === 'x') ? length : 0.4;
    const hitH = 0.4;
    const hitD = (axis === 'z') ? length : 0.4;
    expect(hitW).toBe(0.4);
    expect(hitH).toBe(0.4);
    expect(hitD).toBe(3.20);
  });
});
