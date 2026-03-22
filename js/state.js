// ─── SHARED STATE ───
// Single source of truth for mutable state that crosses module boundaries.

const _selectionListeners = [];

export const state = {
  // Scene references (set by scene.js)
  scene: null,
  camera: null,
  renderer: null,
  controls: null,

  // Apartment config (loaded by room.js from config/apartment.json)
  apartmentConfig: null,

  // Room data (set by room.js after OBJ load)
  objCenter: null,
  objSize: null,

  // Furniture state (managed by interaction.js)
  placedItems: [],
  nextItemId: 1,

  // Entity selection state (managed by interaction.js)
  // { type: 'wall'|'window'|'door'|'protrusion'|'furniture', id: string } or null
  selectedEntity: null,
  hoveredEntity: null,

  // Backward-compatible getter for selectedItemId
  get selectedItemId() {
    if (this.selectedEntity?.type === 'furniture') {
      return parseInt(this.selectedEntity.id);
    }
    return null;
  },
  set selectedItemId(val) {
    if (val === null) {
      this.selectedEntity = null;
    } else {
      this.selectedEntity = { type: 'furniture', id: String(val) };
    }
  },

  // Edit mode — when false, only orbit navigation works (no selection/drag)
  editMode: false,

  // Measure mode — click-to-measure without needing Shift
  measureMode: false,

  // XR mode — null | 'vr' | 'ar-furniture' | 'ar-table'
  xrMode: null,

  // VR rig (set by scene.js)
  vrRig: null,

  // Simulator state (managed by simulator.js)
  simGroup: null,
  arcMesh: null,
  bsMesh: null,

  // Internal: selectEntity function reference (set by interaction.js)
  _selectEntityFn: null,
};

/**
 * Register a listener for selection changes.
 * Callback receives (newEntity, oldEntity) where entity is { type, id } or null.
 */
export function onSelectionChange(callback) {
  _selectionListeners.push(callback);
}

/**
 * Notify all listeners of a selection change.
 */
export function notifySelectionChange(newEntity, oldEntity) {
  for (const cb of _selectionListeners) {
    try { cb(newEntity, oldEntity); } catch (e) { console.warn('Selection listener error:', e); }
  }
}

const _editModeListeners = [];

/**
 * Register a listener for edit mode changes.
 * Callback receives (isEditMode: boolean).
 */
export function onEditModeChange(callback) {
  _editModeListeners.push(callback);
}

/**
 * Toggle edit mode on/off, notifying all listeners.
 */
export function setEditMode(enabled) {
  if (state.editMode === enabled) return;
  state.editMode = enabled;
  for (const cb of _editModeListeners) {
    try { cb(enabled); } catch (e) { console.warn('Edit mode listener error:', e); }
  }
}

// ─── XR Mode (VR/AR) ───

const _xrModeListeners = [];

/**
 * Register a listener for XR mode changes.
 * Callback receives (mode: null | 'vr' | 'ar-furniture' | 'ar-table').
 */
export function onXRModeChange(callback) {
  _xrModeListeners.push(callback);
}

/**
 * Set XR mode, notifying all listeners.
 */
export function setXRMode(mode) {
  if (state.xrMode === mode) return;
  state.xrMode = mode;
  for (const cb of _xrModeListeners) {
    try { cb(mode); } catch (e) { console.warn('XR mode listener error:', e); }
  }
}

// ─── Measure Mode ───

const _measureModeListeners = [];

export function onMeasureModeChange(callback) {
  _measureModeListeners.push(callback);
}

export function setMeasureMode(enabled) {
  if (state.measureMode === enabled) return;
  state.measureMode = enabled;
  for (const cb of _measureModeListeners) {
    try { cb(enabled); } catch (e) { console.warn('Measure mode listener error:', e); }
  }
}

/** Clear all listeners — used in tests for isolation. */
export function clearAllListeners() {
  _selectionListeners.length = 0;
  _editModeListeners.length = 0;
  _xrModeListeners.length = 0;
  _measureModeListeners.length = 0;
}
