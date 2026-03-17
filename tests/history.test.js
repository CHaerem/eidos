import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../js/state.js';
import {
  pushSnapshot, undo, redo,
  canUndo, canRedo, getHistorySize, clearHistory
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

  it('starts with empty stacks', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    expect(getHistorySize()).toEqual({ undoCount: 0, redoCount: 0 });
  });

  it('pushSnapshot captures current config', () => {
    pushSnapshot();
    expect(canUndo()).toBe(true);
    expect(getHistorySize().undoCount).toBe(1);
  });

  it('undo restores previous state', async () => {
    // Snapshot before change
    pushSnapshot();
    const originalPos = state.apartmentConfig.walls.interior[0].pos;

    // Mutate config
    state.apartmentConfig.walls.interior[0].pos = -1.50;
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);

    // Undo
    const result = await undo();
    expect(result).toBe(true);
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(originalPos);
  });

  it('redo re-applies undone state', async () => {
    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    await undo(); // back to original
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);

    await redo(); // forward to -1.50
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);
  });

  it('new action after undo clears redo stack', async () => {
    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    await undo();
    expect(canRedo()).toBe(true);

    // New action
    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -1.80;

    expect(canRedo()).toBe(false);
    expect(getHistorySize().redoCount).toBe(0);
  });

  it('multiple undos work in sequence', async () => {
    // Change 1
    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    // Change 2
    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -1.00;

    // Change 3
    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -0.50;

    expect(getHistorySize().undoCount).toBe(3);

    await undo(); // → -1.00
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.00);

    await undo(); // → -1.50
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-1.50);

    await undo(); // → -2.08 (original)
    expect(state.apartmentConfig.walls.interior[0].pos).toBe(-2.08);

    expect(canUndo()).toBe(false);
    expect(getHistorySize().redoCount).toBe(3);
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
    pushSnapshot();
    const originalEntries = state.apartmentConfig.measurements.entries;

    // Mutate deeply nested array
    state.apartmentConfig.measurements.entries.push({ room: 'stue', dim: 'width', value: 5.0 });
    expect(state.apartmentConfig.measurements.entries.length).toBe(1);

    // Undo should restore empty entries
    await undo();
    expect(state.apartmentConfig.measurements.entries.length).toBe(0);
  });

  it('calls rebuild function on undo/redo', async () => {
    let rebuildCount = 0;
    const mockRebuild = async () => { rebuildCount++; };

    pushSnapshot();
    state.apartmentConfig.walls.interior[0].pos = -1.50;

    await undo(mockRebuild);
    expect(rebuildCount).toBe(1);

    await redo(mockRebuild);
    expect(rebuildCount).toBe(2);
  });
});
