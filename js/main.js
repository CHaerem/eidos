import { initScene } from './scene.js';
import { initRoom } from './room.js';
import { initSimulator, updateSimulator } from './simulator.js';
import { initInteraction } from './interaction.js';
import { initUI } from './ui.js';

async function init() {
  initScene();
  await initRoom();
  initSimulator();
  initInteraction();
  initUI();
  updateSimulator();
}

init();
