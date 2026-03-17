// ─── ROOM FOCUS ───
// Dynamically hides geometry that blocks the camera's view of the focused room.
// Hides UpperFloor for ground-floor rooms, Ceiling for upper-floor rooms,
// and ExternalWalls on the camera's approach side.

import { state } from './state.js';
import { BOUNDS } from './room.js';

let hiddenMeshes = [];    // meshes we set visible=false on
let hiddenGroups = [];    // groups we set visible=false on
let focusActive = false;

export function setRoomFocus(roomId, floor, approachSide) {
  clearRoomFocus();
  focusActive = true;

  const scene = state.scene;
  if (!scene) return;

  // ─── Hide floor above / ceiling ───
  const isGround = floor !== 6 && floor !== 'upper';

  if (isGround) {
    const uf = scene.getObjectByName('UpperFloor');
    if (uf) { uf.visible = false; hiddenGroups.push(uf); }
  } else {
    const ceil = scene.getObjectByName('Ceiling');
    if (ceil) { ceil.visible = false; hiddenGroups.push(ceil); }
  }

  // ─── Hide ExternalWalls on approach side ───
  const objModel = scene.getObjectByName('OBJModel');
  if (objModel && approachSide) {
    const scale = objModel.scale.x;

    // Use exterior wall bounds for OBJ mesh detection (not BOUNDS which may include terrace)
    const ext = state.apartmentConfig?.walls?.exterior;
    const extMinX = ext ? ext.minX : BOUNDS.minX;
    const extMaxX = ext ? ext.maxX : BOUNDS.maxX;
    const extMinZ = ext ? ext.minZ : BOUNDS.minZ;
    const extMaxZ = ext ? ext.maxZ : BOUNDS.maxZ;

    objModel.traverse(child => {
      if (!child.isMesh) return;
      const name = child.name || '';
      if (!name.startsWith('ExternalWalls')) return;

      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      const minX = bb.min.x * scale;
      const maxX = bb.max.x * scale;
      const minZ = bb.min.z * scale;
      const maxZ = bb.max.z * scale;

      // Determine which building side this mesh belongs to
      // by checking which exterior wall bound it hugs
      const tolerance = 0.3;
      let meshSide = null;

      if (Math.abs(minZ - extMinZ) < tolerance || Math.abs(maxZ - extMinZ) < tolerance) {
        meshSide = 'south';
      } else if (Math.abs(maxZ - extMaxZ) < tolerance || Math.abs(minZ - extMaxZ) < tolerance) {
        meshSide = 'north';
      } else if (Math.abs(minX - extMinX) < tolerance || Math.abs(maxX - extMinX) < tolerance) {
        meshSide = 'west';
      } else if (Math.abs(maxX - extMaxX) < tolerance || Math.abs(minX - extMaxX) < tolerance) {
        meshSide = 'east';
      }

      if (meshSide === approachSide) {
        child.visible = false;
        hiddenMeshes.push(child);
      }
    });
  }
}

export function clearRoomFocus() {
  if (!focusActive) return;

  // Restore groups
  for (const g of hiddenGroups) {
    g.visible = true;
  }
  hiddenGroups = [];

  // Restore individual meshes
  for (const m of hiddenMeshes) {
    m.visible = true;
  }
  hiddenMeshes = [];

  focusActive = false;
}

export function isFocusActive() {
  return focusActive;
}
