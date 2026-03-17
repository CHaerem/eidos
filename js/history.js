// ─── EDIT HISTORY ───
// Undo/redo system for apartment config changes.
// Stores deep-copy snapshots of the entire config (~5-10 KB each).

import { state } from './state.js';

const MAX_STACK = 50;
const undoStack = [];
const redoStack = [];

// Listeners notified on history change (for UI updates)
let onChange = null;

export function setHistoryChangeListener(fn) {
  onChange = fn;
}

function notify() {
  if (onChange) onChange({ undoCount: undoStack.length, redoCount: redoStack.length });
}

// Call BEFORE mutating state.apartmentConfig
export function pushSnapshot() {
  if (!state.apartmentConfig) return;
  undoStack.push(JSON.parse(JSON.stringify(state.apartmentConfig)));
  if (undoStack.length > MAX_STACK) undoStack.shift();
  redoStack.length = 0; // new action invalidates redo
  notify();
}

// Restore previous state
export async function undo(rebuildFn) {
  if (undoStack.length === 0) return false;
  redoStack.push(JSON.parse(JSON.stringify(state.apartmentConfig)));
  state.apartmentConfig = undoStack.pop();
  if (rebuildFn) await rebuildFn();
  notify();
  return true;
}

// Re-apply undone state
export async function redo(rebuildFn) {
  if (redoStack.length === 0) return false;
  undoStack.push(JSON.parse(JSON.stringify(state.apartmentConfig)));
  state.apartmentConfig = redoStack.pop();
  if (rebuildFn) await rebuildFn();
  notify();
  return true;
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  notify();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function getHistorySize() {
  return { undoCount: undoStack.length, redoCount: redoStack.length };
}
