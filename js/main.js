import { state } from './state.js';
import { initScene } from './scene.js';
import { initRoom } from './room.js';
import { initRoomDetails } from './room-details.js';
import { initSimulator, updateSimulator } from './simulator.js';
import { initInteraction } from './interaction.js';
import { initUI } from './ui.js';
import { initEidosAPI } from './eidos-api.js';
import { initDimensionClick } from './dimensions.js';
import { loadFurnitureFromConfig } from './furniture.js';
import { initAR } from './ar.js';

async function init() {
  initScene();
  await initRoom();
  await initRoomDetails();
  initSimulator();
  initInteraction();
  initUI();
  updateSimulator();

  // Load furniture placements from config (must be after initInteraction + initUI)
  loadFurnitureFromConfig();

  // Expose state for debugging (accessible via window._state.scene etc.)
  window._state = state;

  // Initialize Eidos API for AI-assisted model manipulation
  initEidosAPI();

  // Enable click-to-edit on dimension labels in 3D viewport
  initDimensionClick();

  // Initialize AR capabilities and wire AR toolbar buttons
  initAR();

  // Default view: fly to stue (largest room, most useful starting point)
  const stue = state.apartmentConfig?.rooms?.find(r => r.id === 'stue');
  if (stue) {
    // Small delay to ensure flyToRoom is available after scene setup
    setTimeout(() => window.flyToRoom?.(stue.bounds, 0), 100);
  }
}

init();
