import { initScene } from './scene.js';
import { initRoom } from './room.js';
import { initRoomDetails } from './room-details.js';
import { initSimulator, updateSimulator } from './simulator.js';
import { initInteraction } from './interaction.js';
import { initUI } from './ui.js';

async function init() {
  initScene();
  await initRoom();
  await initRoomDetails();
  initSimulator();
  initInteraction();
  initUI();
  updateSimulator();
}

init();
