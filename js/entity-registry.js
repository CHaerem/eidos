// ─── ENTITY REGISTRY ───
// Bidirectional map between config elements and Three.js objects.
// Every interactive mesh is tagged with entityType + entityId in userData,
// and registered here for fast lookup in both directions.

const _forwardMap = new Map();   // "type:id" → Object3D
const _interactables = [];       // flat array of all meshes for raycasting

/**
 * Register a Three.js object as an interactive entity.
 * Tags the object's userData and stores it in the registry.
 * Clones shared materials to prevent cross-contamination during hover/select.
 */
export function register(entityType, entityId, object3d) {
  object3d.userData.entityType = entityType;
  object3d.userData.entityId = entityId;

  const key = `${entityType}:${entityId}`;
  _forwardMap.set(key, object3d);

  // Clone materials so hover/select emissive changes don't leak
  object3d.traverse(child => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(m => m.clone());
      } else {
        child.material = child.material.clone();
      }
      // Collect meshes for raycasting
      _interactables.push(child);
    }
  });
}

/**
 * Look up which entity a mesh belongs to.
 * Walks up the parent chain to find the nearest tagged ancestor.
 * Returns { type, id } or null.
 */
export function lookup(mesh) {
  let current = mesh;
  while (current) {
    if (current.userData?.entityType) {
      return {
        type: current.userData.entityType,
        id: current.userData.entityId,
      };
    }
    current = current.parent;
  }
  return null;
}

/**
 * Get the Object3D for a given entity type and id.
 */
export function getMesh(entityType, entityId) {
  return _forwardMap.get(`${entityType}:${entityId}`) || null;
}

/**
 * Get all registered entities of a given type.
 * Returns array of { type, id, object3d }.
 */
export function getAllOfType(entityType) {
  const results = [];
  for (const [key, obj] of _forwardMap) {
    if (key.startsWith(entityType + ':')) {
      const id = key.slice(entityType.length + 1);
      results.push({ type: entityType, id, object3d: obj });
    }
  }
  return results;
}

/**
 * Get the flat array of all interactable meshes (for raycasting).
 */
export function getInteractables() {
  return _interactables;
}

/**
 * Clear all registrations. Called at the start of each rebuild.
 */
export function clear() {
  _forwardMap.clear();
  _interactables.length = 0;
}

/**
 * Get count of registered entities.
 */
export function size() {
  return _forwardMap.size;
}
