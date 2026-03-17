import { state } from './state.js';
import { initScene } from './scene.js';
import { initRoom } from './room.js';
import { initRoomDetails } from './room-details.js';
import { initSimulator, updateSimulator } from './simulator.js';
import { initInteraction } from './interaction.js';
import { initUI } from './ui.js';
import { initEidosAPI } from './eidos-api.js';
import { initDimensionClick } from './dimensions.js';

async function init() {
  initScene();
  await initRoom();
  await initRoomDetails();
  initSimulator();
  initInteraction();
  initUI();
  updateSimulator();

  // Expose state for debugging (accessible via window._state.scene etc.)
  window._state = state;

  // Initialize Eidos API for AI-assisted model manipulation
  initEidosAPI();

  // Enable click-to-edit on dimension labels in 3D viewport
  initDimensionClick();
}

init();
