// ─── EIDOS API ───
// High-level browser API for AI-assisted 3D model manipulation.
// Exposes window.eidos with functions Claude can call via preview_eval.

import { state } from './state.js';
import { initRoom, clearRoomGeometry, BOUNDS, ceilAt } from './room.js';
import { initRoomDetails, clearRoomDetails } from './room-details.js';
import { updateSimulator } from './simulator.js';

// ─── JSON path helpers ───

function getByPath(obj, path) {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ─── Core API ───

const eidos = {
  // Read the current apartment config (or a specific path)
  getConfig(path) {
    return getByPath(state.apartmentConfig, path);
  },

  // Update config in memory and optionally rebuild
  async updateConfig(path, value, shouldRebuild = true) {
    setByPath(state.apartmentConfig, path, value);
    if (shouldRebuild) {
      await this.rebuild();
    }
    return this.getConfig(path);
  },

  // Full rebuild: clear existing geometry and re-init from current config
  async rebuild() {
    const config = state.apartmentConfig;
    if (!config) {
      console.warn('eidos.rebuild(): no config loaded');
      return;
    }

    // Clear existing geometry
    clearRoomGeometry();
    clearRoomDetails();

    // Rebuild from current in-memory config
    await initRoom(config);
    await initRoomDetails(config);

    // Update simulator to match new geometry
    try { updateSimulator(); } catch (e) { /* simulator may not be ready */ }

    console.log('eidos.rebuild() complete');
  },

  // ─── Query helpers ───

  getBounds() {
    return { ...BOUNDS };
  },

  getCeilingAt(x, z) {
    return ceilAt(x, z);
  },

  getRooms() {
    const config = state.apartmentConfig;
    const rooms = [...(config.rooms || [])];
    if (config.upperFloor && config.upperFloor.rooms) {
      rooms.push(...config.upperFloor.rooms.map(r => ({ ...r, floor: 'upper' })));
    }
    return rooms;
  },

  getWindows() {
    return state.apartmentConfig.windows || [];
  },

  getWalls() {
    const w = state.apartmentConfig.walls || {};
    return {
      exterior: w.exterior,
      interior: w.interior || [],
      column: w.column,
    };
  },

  getStaircaseInfo() {
    const config = state.apartmentConfig;
    const uf = config.upperFloor;
    if (!uf || !uf.stairwell) return null;
    const sw = uf.stairwell;
    const totalTreads = (sw.runs || []).reduce((sum, r) => sum + (r.treads || 0), 0);
    const risePerTread = totalTreads > 0 ? (uf.floorY || 2.25) / totalTreads : 0;
    return {
      type: sw.type,
      width: sw.width,
      totalTreads,
      risePerTread: Math.round(risePerTread * 1000) / 1000,
      floorY: uf.floorY,
      runs: sw.runs,
      bounds: sw.bounds,
    };
  },

  // ─── Furniture helpers ───

  getFurniture() {
    return (state.placedItems || []).map(item => ({
      id: item.id,
      type: item.type,
      x: item.mesh?.position?.x,
      z: item.mesh?.position?.z,
      rotation: item.rotation,
    }));
  },

  // ─── Scene info ───

  getSceneInfo() {
    let meshCount = 0;
    state.scene.traverse(() => meshCount++);
    return {
      meshCount,
      bounds: this.getBounds(),
      cameraPosition: state.camera?.position?.toArray(),
      cameraTarget: state.controls?.target?.toArray(),
    };
  },
};

// ─── Init ───

export function initEidosAPI() {
  window.eidos = eidos;
  console.log('Eidos API ready — use window.eidos.*');
}
