import { describe, it, expect } from 'vitest';
import { computeDiff, getDiffSummary } from '../js/history-diff.js';

// ─── Tests for config diff computation ───

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
      { id: 'stue', name: 'Stue', bounds: { minX: -2.08, maxX: 4.38, minZ: -2.50, maxZ: 0.70 } },
      { id: 'bad', name: 'Bad', bounds: { minX: -4.38, maxX: -2.08, minZ: -2.50, maxZ: -0.54 } },
    ],
  };
}

describe('computeDiff — identical configs', () => {
  it('returns empty diff for identical configs', () => {
    const a = makeConfig();
    const b = JSON.parse(JSON.stringify(a));
    const diff = computeDiff(a, b);

    expect(diff.walls.added).toEqual([]);
    expect(diff.walls.removed).toEqual([]);
    expect(diff.walls.changed).toEqual([]);
    expect(diff.rooms.changed).toEqual([]);
    expect(diff.windows.changed).toEqual([]);
    expect(diff.doors.changed).toEqual([]);
    expect(diff.protrusions.changed).toEqual([]);
  });

  it('getDiffSummary returns 0 for identical configs', () => {
    const a = makeConfig();
    const b = JSON.parse(JSON.stringify(a));
    expect(getDiffSummary(computeDiff(a, b))).toBe(0);
  });
});

describe('computeDiff — wall changes', () => {
  it('detects wall position change', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.walls.interior[0].pos = -2.20; // wall A moved

    const diff = computeDiff(curr, prev);
    expect(diff.walls.changed.length).toBe(1);
    expect(diff.walls.changed[0].id).toBe('A');
    expect(diff.walls.changed[0].current.pos).toBe(-2.20);
    expect(diff.walls.changed[0].previous.pos).toBe(-2.08);
  });

  it('detects wall added', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.walls.interior.push({ id: 'C', axis: 'z', pos: 0.70, from: -2.08, to: 4.38 });

    const diff = computeDiff(curr, prev);
    expect(diff.walls.added.length).toBe(1);
    expect(diff.walls.added[0].id).toBe('C');
  });

  it('detects wall removed', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.walls.interior = curr.walls.interior.filter(w => w.id !== 'B');

    const diff = computeDiff(curr, prev);
    expect(diff.walls.removed.length).toBe(1);
    expect(diff.walls.removed[0].id).toBe('B');
  });
});

describe('computeDiff — window changes', () => {
  it('detects window added', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.windows.push({ id: 'W2', wall: 'south', x1: 0.5, x2: 1.5, sillHeight: 0.9, topHeight: 2.1 });

    const diff = computeDiff(curr, prev);
    expect(diff.windows.added.length).toBe(1);
    expect(diff.windows.added[0].id).toBe('W2');
  });

  it('detects window removed', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.windows = [];

    const diff = computeDiff(curr, prev);
    expect(diff.windows.removed.length).toBe(1);
    expect(diff.windows.removed[0].id).toBe('W1');
  });

  it('detects window position change', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.windows[0].x1 = -3.5;

    const diff = computeDiff(curr, prev);
    expect(diff.windows.changed.length).toBe(1);
    expect(diff.windows.changed[0].id).toBe('W1');
  });
});

describe('computeDiff — room bounds changes', () => {
  it('detects room bounds changed', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.rooms[0].bounds.maxX = 4.50; // stue got wider

    const diff = computeDiff(curr, prev);
    expect(diff.rooms.changed.length).toBe(1);
    expect(diff.rooms.changed[0].id).toBe('stue');
    expect(diff.rooms.changed[0].current.bounds.maxX).toBe(4.50);
    expect(diff.rooms.changed[0].previous.bounds.maxX).toBe(4.38);
  });

  it('detects room removed', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.rooms = curr.rooms.filter(r => r.id !== 'bad');

    const diff = computeDiff(curr, prev);
    expect(diff.rooms.removed.length).toBe(1);
    expect(diff.rooms.removed[0].id).toBe('bad');
  });
});

describe('computeDiff — protrusion changes', () => {
  it('detects protrusion added', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.walls.protrusions.push({
      id: 'P1', bounds: { minX: 3.0, maxX: 4.0, minZ: 1.5, maxZ: 2.5 }, height: 2.25,
    });

    const diff = computeDiff(curr, prev);
    expect(diff.protrusions.added.length).toBe(1);
    expect(diff.protrusions.added[0].id).toBe('P1');
  });

  it('detects protrusion bounds changed', () => {
    const prev = makeConfig();
    prev.walls.protrusions.push({
      id: 'P1', bounds: { minX: 3.0, maxX: 4.0, minZ: 1.5, maxZ: 2.5 }, height: 2.25,
    });
    const curr = JSON.parse(JSON.stringify(prev));
    curr.walls.protrusions[0].bounds.minX = 3.5;

    const diff = computeDiff(curr, prev);
    expect(diff.protrusions.changed.length).toBe(1);
  });
});

describe('computeDiff — door changes', () => {
  it('detects door position change', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.doors[0].from = -3.8;

    const diff = computeDiff(curr, prev);
    expect(diff.doors.changed.length).toBe(1);
    expect(diff.doors.changed[0].id).toBe('D1');
  });
});

describe('getDiffSummary', () => {
  it('counts total changes correctly', () => {
    const prev = makeConfig();
    const curr = JSON.parse(JSON.stringify(prev));
    curr.walls.interior[0].pos = -2.20;  // 1 changed wall
    curr.windows.push({ id: 'W2', wall: 'south', x1: 0.5, x2: 1.5, sillHeight: 0.9, topHeight: 2.1 }); // 1 added window

    const diff = computeDiff(curr, prev);
    expect(getDiffSummary(diff)).toBe(2);
  });
});

describe('computeDiff — null/missing handling', () => {
  it('handles null configs gracefully', () => {
    const diff = computeDiff(null, null);
    expect(getDiffSummary(diff)).toBe(0);
  });

  it('handles config with missing arrays', () => {
    const diff = computeDiff({ walls: {} }, { walls: {} });
    expect(getDiffSummary(diff)).toBe(0);
  });
});
