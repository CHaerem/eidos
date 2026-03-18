import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../js/state.js';
import {
  pushSnapshot, undo, redo, jumpTo,
  canUndo, canRedo, getHistorySize, getEntries, getPointer, clearHistory
} from '../js/history.js';

// Helper: create a minimal config object
function makeConfig(wallPos = -2.08, measurements = []) {
  return {
    walls: { interior: [{ id: 'A', pos: wallPos }] },
    rooms: [{ id: 'stue', bounds: { minX: 0, maxX: 5 } }],
    measurements: { entries: [...measurements] },
  };
}

describe('history.js — undo/redo', () => {
  beforeEach(() => {
    clearHistory();
    state.apartmentConfig = makeConfig();
  });

  it('starts with empty history', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    expect(getHistorySize()).toEqual({ undoCount: 0, redoCount: 0 });
    expect(getEntries()).toEqual([]);
    expect(getPointer()).toBe(-1);
  });

  it('pushSnapshot captures current config with label', () => {
    pushSnapshot('Test endring');
    expect(canUndo()).toBe(true);
    expect(getHistorySize().undoCount).toBe(1);
    const entries = getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].label).toBe('Test endring');
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it('pushSnapshot uses default label when none provided', () => {
    pushSnapshot();
    expect(getEntries()[0].label).toBe('Endring');
  });

  it('undo restores previous state', async () => {
    pushSnapshot('Før endring');
    const originalPos = state.apartmentConfig.walls.interior[0].pos;

    state.apartmentConfig.walls.interior[0].pos = -1.50;
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);

    const result = await undo();
    expect(result).toBe(true);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(originalPos);
  });

  it('redo re-applies undone state', async () => {
    pushSnapshot('Snapshot 1');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    await undo();
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);

    await redo();
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);
  });

  it('new action after undo clears future entries', async () => {
    pushSnapshot('Endring 1');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    await undo();
    expect(canRedo()).toBe(true);

    pushSnapshot('Endring 2');
    state.apartmentConfig.walls.interior[0].pos = -1.80;

    expect(canRedo()).toBe(false);
    expect(getHistorySize().redoCount).toBe(0);
  });

  it('multiple undos work in sequence', async () => {
    pushSnapshot('Pos -2.08');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('Pos -1.50');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    pushSnapshot('Pos -1.00');
    state.apartmentConfig.walls.interior[0].pos = -0.50;

    await undo();
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.00);

    await undo();
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);

    await undo();
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);

    expect(canUndo()).toBe(false);
  });

  it('undo on empty stack returns false', async () => {
    const result = await undo();
    expect(result).toBe(false);
  });

  it('redo on empty stack returns false', async () => {
    const result = await redo();
    expect(result).toBe(false);
  });

  it('snapshots are deep copies (mutations do not affect history)', async () => {
    pushSnapshot('Før push');
    state.apartmentConfig.measurements.entries.push({ room: 'stue', dim: 'width', value: 5.0 });
    expect(state.apartmentConfig.measurements.entries.length).toBe(1);

    await undo();
    expect(state.apartmentConfig.measurements.entries.length).toBe(0);
  });

  it('calls rebuild function on undo/redo', async () => {
    let rebuildCount = 0;
    const mockRebuild = async () => { rebuildCount++; };

    pushSnapshot('Snapshot');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    await undo(mockRebuild);
    expect(rebuildCount).toBe(1);

    await redo(mockRebuild);
    expect(rebuildCount).toBe(2);
  });
});

describe('history.js — labels and entries', () => {
  beforeEach(() => {
    clearHistory();
    state.apartmentConfig = makeConfig();
  });

  it('getEntries returns entries in order with labels', () => {
    pushSnapshot('Flytt vegg');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('Endre tak');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    const entries = getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].label).toBe('Flytt vegg');
    expect(entries[1].label).toBe('Endre tak');
    expect(entries[0].index).toBe(0);
    expect(entries[1].index).toBe(1);
  });

  it('active flag marks current pointer position', () => {
    pushSnapshot('A');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('B');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    const entries = getEntries();
    expect(entries[0].active).toBe(false);
    expect(entries[1].active).toBe(true);
  });

  it('entries have timestamps', () => {
    const before = Date.now();
    pushSnapshot('Tidsstempel-test');
    const after = Date.now();

    const entries = getEntries();
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(entries[0].timestamp).toBeLessThanOrEqual(after);
  });
});

describe('history.js — jumpTo', () => {
  beforeEach(() => {
    clearHistory();
    state.apartmentConfig = makeConfig();
  });

  it('jumpTo restores config at given index', async () => {
    pushSnapshot('Original');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('Endring 1');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    pushSnapshot('Endring 2');
    state.apartmentConfig.walls.interior[0].pos = -0.50;

    // Jump back to index 0 (original state: -2.08)
    await jumpTo(0);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);
  });

  it('jumpTo updates pointer and active flag', async () => {
    pushSnapshot('A');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('B');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    pushSnapshot('C');
    state.apartmentConfig.walls.interior[0].pos = -0.50;

    await jumpTo(1);
    expect(getPointer()).toBe(1);

    const entries = getEntries();
    expect(entries[0].active).toBe(false);
    expect(entries[1].active).toBe(true);
    expect(entries[2].active).toBe(false);
  });

  it('jumpTo calls rebuild function', async () => {
    let rebuildCount = 0;
    const mockRebuild = async () => { rebuildCount++; };

    pushSnapshot('A');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('B');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    await jumpTo(0, mockRebuild);
    expect(rebuildCount).toBe(1);
  });

  it('jumpTo with invalid index returns false', async () => {
    pushSnapshot('A');
    expect(await jumpTo(-1)).toBe(false);
    expect(await jumpTo(99)).toBe(false);
  });

  it('jumpTo preserves current state for future navigation', async () => {
    pushSnapshot('Original');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('Midten');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    // Jump back to original
    await jumpTo(0);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);

    // Jump forward to midten
    await jumpTo(1);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);
  });

  it('jumpTo forward and back preserves all entries', async () => {
    pushSnapshot('Step 1');
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    pushSnapshot('Step 2');
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    pushSnapshot('Step 3');
    state.apartmentConfig.walls.interior[0].pos = -0.50;

    // Jump to beginning
    await jumpTo(0);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);

    // Jump to end (the saved "(nåværende)" entry)
    const entries = getEntries();
    await jumpTo(entries.length - 1);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-0.50);
  });
});
