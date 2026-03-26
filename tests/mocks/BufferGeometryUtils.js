// Minimal mock for BufferGeometryUtils used by vitest
import { BufferGeometry } from 'three';

export function mergeGeometries(geometries, useGroups) {
  // Return a stub BufferGeometry — tests don't inspect merged geometry internals
  return new BufferGeometry();
}
