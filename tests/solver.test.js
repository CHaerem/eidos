import { describe, it, expect } from 'vitest';
import { solveConstraints, buildAdjacency, applyToConfig } from '../js/solver.js';

// Minimal config matching Vibes Gate 20B structure
const exterior = { minX: -4.38, maxX: 4.38, minZ: -2.50, maxZ: 2.50, thickness: 0.08 };

const interiorWalls = [
  { id: 'A', axis: 'x', pos: -2.08, from: -2.50, to: 2.50 },
  { id: 'B', axis: 'x', pos: -2.92, from: -0.54, to: 2.50 },
  { id: 'C', axis: 'x', pos: 0.49, from: 0.70, to: 2.50 },
  { id: 'D', axis: 'z', pos: -0.54, from: -4.38, to: -2.08 },
  { id: 'E', axis: 'z', pos: 0.70, from: -2.08, to: 4.38 },
];

const rooms = [
  { id: 'garderobe', bounds: { minX: -4.38, maxX: -2.08, minZ: -2.50, maxZ: -0.54 }, ceilingType: 'flat' },
  { id: 'entre', bounds: { minX: -4.38, maxX: -2.92, minZ: -0.54, maxZ: 2.50 }, ceilingType: 'flat' },
  { id: 'bad', bounds: { minX: -2.92, maxX: 0.49, minZ: 0.70, maxZ: 2.50 }, ceilingType: 'flat' },
  { id: 'stue', bounds: { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 }, ceilingType: 'slope' },
  { id: 'kjokken', bounds: { minX: 0.49, maxX: 4.38, minZ: 0.70, maxZ: 2.50 }, ceilingType: 'flat' },
];

const ceilingZones = [
  { id: 'flat1', type: 'flat', bounds: { minX: -4.38, maxX: -0.77 }, height: 2.25 },
  { id: 'flat2', type: 'flat', bounds: { minX: -0.77, maxX: 4.38 }, height: 2.25 },
  { id: 'roof', type: 'slope', bounds: { minX: -4.38, maxX: 4.38 }, startHeight: 2.214, endHeight: 4.81 },
];

const defaultPriors = { wallPositionWeight: 0.1, wallThicknessWeight: 10.0, heightWeight: 1.0 };

describe('buildAdjacency', () => {
  it('maps room dimensions to wall/exterior boundaries', () => {
    const adj = buildAdjacency(rooms, interiorWalls, exterior);

    // Garderobe width (along X): from exterior minX to wall A
    const gw = adj['garderobe:width'];
    expect(gw).toBeDefined();
    expect(gw.lo.type).toBe('ext');
    expect(gw.hi.type).toBe('wall');
    expect(gw.hi.id).toBe('A');
  });

  it('returns entries for all rooms and dimensions', () => {
    const adj = buildAdjacency(rooms, interiorWalls, exterior);
    for (const room of rooms) {
      expect(adj[`${room.id}:width`]).toBeDefined();
      expect(adj[`${room.id}:depth`]).toBeDefined();
    }
  });
});

describe('solveConstraints — no measurements', () => {
  it('returns noop result with priors', () => {
    const result = solveConstraints({
      measurements: [],
      exterior, interiorWalls, rooms,
      ceilingZones,
      upperFloorY: 2.25,
    });

    // Should return wall positions matching the config
    expect(result.wallPositions.A).toBe(-2.08);
    expect(result.wallThicknesses.A).toBe(0.08);
    expect(result.heights.floorY).toBe(2.25);
  });
});

describe('solveConstraints — height constraints', () => {
  it('single flat room height measurement adjusts floorY', () => {
    const result = solveConstraints({
      measurements: [{ room: 'garderobe', dim: 'height', value: 2.20 }],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    // floorY should be between prior (2.25) and measurement (2.20)
    expect(result.heights.floorY).toBeGreaterThan(2.19);
    expect(result.heights.floorY).toBeLessThan(2.26);
    // With heightWeight=1.0 and one measurement, should compromise
    expect(result.heights.floorY).not.toBe(2.25);
  });

  it('two flat room measurements constrain same floorY', () => {
    const result = solveConstraints({
      measurements: [
        { room: 'garderobe', dim: 'height', value: 2.20 },
        { room: 'bad', dim: 'height', value: 2.18 },
      ],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    // Two measurements (2.20 + 2.18) / 2 = 2.19, prior = 2.25
    // With weight 1.0 and 2 measurements, should be closer to measurements
    expect(result.heights.floorY).toBeGreaterThan(2.17);
    expect(result.heights.floorY).toBeLessThan(2.23);
  });

  it('slope room height_low adjusts slopeStart', () => {
    const result = solveConstraints({
      measurements: [{ room: 'stue', dim: 'height_low', value: 2.30 }],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    // slopeStart should move from prior (2.214) toward measurement (2.30)
    expect(result.heights.slopeStart).toBeGreaterThan(2.21);
    expect(result.heights.slopeStart).toBeLessThan(2.31);
    // slopeEnd should stay near prior (not constrained)
    expect(result.heights.slopeEnd).toBeCloseTo(4.81, 0);
  });

  it('slope room height_high adjusts slopeEnd', () => {
    const result = solveConstraints({
      measurements: [{ room: 'stue', dim: 'height_high', value: 4.50 }],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    expect(result.heights.slopeEnd).toBeGreaterThan(4.49);
    expect(result.heights.slopeEnd).toBeLessThan(4.82);
  });

  it('height measurements produce residuals', () => {
    const result = solveConstraints({
      measurements: [
        { room: 'garderobe', dim: 'height', value: 2.20 },
        { room: 'bad', dim: 'height', value: 2.30 },
      ],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    // Both constrain floorY but differ — residuals should be non-zero
    expect(result.residuals['garderobe:height']).toBeDefined();
    expect(result.residuals['bad:height']).toBeDefined();
    // Residuals should have opposite signs (solver compromises)
    const rg = result.residuals['garderobe:height'];
    const rb = result.residuals['bad:height'];
    expect(rg * rb).toBeLessThan(0); // opposite signs
  });
});

describe('solveConstraints — width/depth constraints', () => {
  it('garderobe width measurement adjusts wall A position', () => {
    const result = solveConstraints({
      measurements: [{ room: 'garderobe', dim: 'width', value: 2.50 }],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    // Wall A should move to accommodate width=2.50
    // Original width: 4.38 - 2.08 = 2.30, new target = 2.50
    // Wall should move closer to center (less negative)
    expect(result.wallPositions.A).toBeGreaterThan(-2.10);
    expect(result.wallPositions.A).toBeLessThan(-1.80);
  });
});

describe('applyToConfig', () => {
  it('updates wall positions and room bounds', () => {
    const config = JSON.parse(JSON.stringify({
      walls: { interior: interiorWalls, exterior },
      rooms,
      ceiling: { zones: ceilingZones },
      upperFloor: { floorY: 2.25, areas: [] },
    }));

    const result = solveConstraints({
      measurements: [{ room: 'garderobe', dim: 'height', value: 2.20 }],
      exterior, interiorWalls, rooms,
      priors: defaultPriors,
      ceilingZones,
      upperFloorY: 2.25,
    });

    applyToConfig(config, result);

    // floorY should be updated
    expect(config.upperFloor.floorY).toBeCloseTo(result.heights.floorY, 6);

    // Flat ceiling zones should have updated height
    const flatZone = config.ceiling.zones.find(z => z.type === 'flat');
    expect(flatZone.height).toBeCloseTo(result.heights.floorY, 6);
  });
});
