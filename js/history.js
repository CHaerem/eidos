// ─── EDIT HISTORY ───
// Undo/redo system for apartment config changes.
// Stores deep-copy snapshots with labels for visual history panel.

import { state } from './state.js';
import { clearHistoryDiff } from './history-diff.js';

const MAX_STACK = 50;

// History is a linear list of entries. `pointer` points to current state.
// Entries before pointer = past (undo), after pointer = future (redo).
const entries = [];  // { config, label, timestamp }
let pointer = -1;    // -1 = no history yet (initial state)

// Listener notified on history change (for UI updates)
let onChange = null;

export function setHistoryChangeListener(fn) {
  onChange = fn;
}

function notify() {
  if (onChange) onChange();
}

// Call BEFORE mutating state.apartmentConfig
export function pushSnapshot(label = 'Endring') {
  if (!state.apartmentConfig) return;
  clearHistoryDiff();  // Remove any active diff overlay

  // Discard any future entries (redo branch)
  if (pointer < entries.length - 1) {
    entries.length = pointer + 1;
  }

  entries.push({
    config: JSON.parse(JSON.stringify(state.apartmentConfig)),
    label,
    timestamp: Date.now()
  });

  // Trim oldest if over limit
  if (entries.length > MAX_STACK) {
    entries.shift();
  }

  pointer = entries.length - 1;
  notify();
}

// Restore previous state
export async function undo(rebuildFn) {
  if (pointer < 0) return false;
  // Save current state as future entry if we're at the tip
  if (pointer === entries.length - 1) {
    entries.push({
      config: JSON.parse(JSON.stringify(state.apartmentConfig)),
      label: '(nåværende)',
      timestamp: Date.now()
    });
  }
  state.apartmentConfig = JSON.parse(JSON.stringify(entries[pointer].config));
  pointer--;
  if (rebuildFn) await rebuildFn();
  notify();
  return true;
}

// Re-apply undone state
export async function redo(rebuildFn) {
  if (pointer >= entries.length - 2) return false;
  pointer += 2;
  const entry = entries[pointer] || entries[entries.length - 1];
  state.apartmentConfig = JSON.parse(JSON.stringify(entry.config));
  if (rebuildFn) await rebuildFn();
  notify();
  return true;
}

// Jump to any point in history
export async function jumpTo(index, rebuildFn) {
  if (index < 0 || index >= entries.length) return false;

  // Save current state at tip if needed
  if (pointer === entries.length - 1) {
    entries.push({
      config: JSON.parse(JSON.stringify(state.apartmentConfig)),
      label: '(nåværende)',
      timestamp: Date.now()
    });
  }

  state.apartmentConfig = JSON.parse(JSON.stringify(entries[index].config));
  pointer = index;
  if (rebuildFn) await rebuildFn();
  notify();
  return true;
}

// Get display-friendly list of history entries
export function getEntries() {
  return entries.map((e, i) => ({
    index: i,
    label: e.label,
    timestamp: e.timestamp,
    active: i === pointer
  }));
}

// Current pointer position (which entry is active, or -1)
export function getPointer() { return pointer; }

// Get raw entries with config references (read-only, do not mutate)
export function getFullEntries() { return entries; }

export function clearHistory() {
  entries.length = 0;
  pointer = -1;
  notify();
}

export function canUndo() { return pointer >= 0; }
export function canRedo() { return pointer < entries.length - 2; }
export function getHistorySize() {
  return { undoCount: pointer + 1, redoCount: Math.max(0, entries.length - pointer - 2) };
}
