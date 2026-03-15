// ─── SHARED STATE ───
// Single source of truth for mutable state that crosses module boundaries.

export const state = {
  // Scene references (set by scene.js)
  scene: null,
  camera: null,
  renderer: null,
  controls: null,

  // Room data (set by room.js after OBJ load)
  objCenter: null,
  objSize: null,

  // Furniture state (managed by interaction.js)
  placedItems: [],
  selectedItemId: null,
  nextItemId: 1,

  // Simulator state (managed by simulator.js)
  simGroup: null,
  arcMesh: null,
  bsMesh: null,
};
