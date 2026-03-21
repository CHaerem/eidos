// ─── EIDOS API ───
// High-level browser API for AI-assisted 3D model manipulation.
// Exposes window.eidos with functions Claude can call via preview_eval.

import { state } from './state.js';
import { initRoom, clearRoomGeometry, BOUNDS, ceilAt } from './room.js';
import { initRoomDetails, clearRoomDetails } from './room-details.js';
import { updateSimulator } from './simulator.js';
import { solveConstraints, applyToConfig, buildAdjacency } from './solver.js';
import { runSolver } from './ui.js';
import { showDimensions, hideDimensions } from './dimensions.js';
import { setRoomFocus, clearRoomFocus } from './room-focus.js';
import { pushSnapshot, undo, redo, canUndo, canRedo, getHistorySize, getEntries, jumpTo } from './history.js';
import { clear as clearEntityRegistry, getMesh, lookup, getAllOfType } from './entity-registry.js';

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
    pushSnapshot(`Oppdater ${path}`);
    setByPath(state.apartmentConfig, path, value);
    if (shouldRebuild) {
      await this.rebuild();
    }
    return this.getConfig(path);
  },

  // Full rebuild: re-init all geometry from config
  // Set fromDisk=true (default) to re-fetch config from disk (for MCP changes)
  // Set fromDisk=false to rebuild from in-memory config (for solver/calibration)
  async rebuild(fromDisk = true) {
    if (fromDisk) {
      // Re-fetch config from disk to pick up MCP tool changes
      try {
        const resp = await fetch('config/apartment.json');
        const freshConfig = await resp.json();
        // Preserve in-memory-only state that isn't saved to disk
        const oldConfig = state.apartmentConfig;
        if (oldConfig?.measurements) {
          freshConfig.measurements = oldConfig.measurements;
        }
        state.apartmentConfig = freshConfig;
      } catch (e) {
        console.warn('eidos.rebuild(): failed to re-fetch config, using in-memory', e);
      }
    }

    const config = state.apartmentConfig;
    if (!config) {
      console.warn('eidos.rebuild(): no config loaded');
      return;
    }

    // Clear existing geometry and entity registry
    clearEntityRegistry();
    clearRoomGeometry();
    clearRoomDetails();

    // Rebuild from fresh config
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

  getDoors() {
    return state.apartmentConfig.doors || [];
  },

  getWalls() {
    const w = state.apartmentConfig.walls || {};
    return {
      exterior: w.exterior,
      interior: w.interior || [],
      column: w.column,
      protrusions: w.protrusions || [],
    };
  },

  getProtrusions() {
    return state.apartmentConfig.walls?.protrusions || [];
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

  // ─── Measurement / Solver API ───

  addMeasurement(room, dim, value) {
    pushSnapshot(`Måling: ${room} ${dim}`);
    const cfg = state.apartmentConfig;
    if (!cfg.measurements) {
      cfg.measurements = { defaultWallThickness: 0.08, priors: { wallPositionWeight: 0.1, wallThicknessWeight: 10.0 }, entries: [] };
    }
    const entries = cfg.measurements.entries;
    const idx = entries.findIndex(e => e.room === room && e.dim === dim);
    if (idx >= 0) {
      entries[idx].value = value;
    } else {
      entries.push({ room, dim, value });
    }
    runSolver();
    return this.getSolverResult();
  },

  removeMeasurement(room, dim) {
    pushSnapshot(`Fjern måling: ${room} ${dim}`);
    const cfg = state.apartmentConfig;
    if (!cfg.measurements) return;
    const entries = cfg.measurements.entries;
    const idx = entries.findIndex(e => e.room === room && e.dim === dim);
    if (idx >= 0) entries.splice(idx, 1);
    runSolver();
    return this.getSolverResult();
  },

  getMeasurements() {
    return state.apartmentConfig?.measurements?.entries || [];
  },

  solve() {
    runSolver();
    return this.getSolverResult();
  },

  getSolverResult() {
    return state._lastSolverResult || null;
  },

  getAdjacency() {
    const cfg = state.apartmentConfig;
    return buildAdjacency(cfg.rooms || [], cfg.walls?.interior || [], cfg.walls?.exterior || {});
  },

  // ─── Dimension lines ───

  showDimensions(roomId, floor) {
    showDimensions(roomId, floor);
  },

  hideDimensions() {
    hideDimensions();
  },

  // ─── Room focus (visibility) ───

  setRoomFocus(roomId, floor, approachSide) {
    setRoomFocus(roomId, floor, approachSide);
  },

  clearRoomFocus() {
    clearRoomFocus();
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

  // ─── History (undo/redo) ───

  async undo() {
    return undo(() => this.rebuild());
  },

  async redo() {
    return redo(() => this.rebuild());
  },

  canUndo() { return canUndo(); },
  canRedo() { return canRedo(); },
  getHistorySize() { return getHistorySize(); },

  // ─── Entity selection (for AI) ───

  getSelectedEntity() {
    return state.selectedEntity || null;
  },

  selectEntity(type, id) {
    if (state._selectEntityFn) {
      state._selectEntityFn(type, id);
    }
  },

  getEntity(type, id) {
    const mesh = getMesh(type, id);
    return mesh ? { type, id, exists: true } : null;
  },

  getEntitiesOfType(type) {
    return getAllOfType(type).map(e => ({ type: e.type, id: e.id }));
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
