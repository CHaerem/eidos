// Minimal THREE.js mock for vitest
// Only stubs used by history-diff.js and other modules

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}

class BufferGeometry {
  setFromPoints() { return this; }
  setAttribute() { return this; }
  computeVertexNormals() {}
  computeBoundingBox() {}
  dispose() {}
}

class EdgesGeometry extends BufferGeometry {
  constructor() { super(); }
}

class PlaneGeometry extends BufferGeometry {
  constructor() { super(); }
}

class BoxGeometry extends BufferGeometry {
  constructor() { super(); }
}

class Float32BufferAttribute {
  constructor() {}
}

class Material {
  dispose() {}
}

class LineBasicMaterial extends Material {
  constructor(params = {}) { super(); Object.assign(this, params); }
}

class MeshBasicMaterial extends Material {
  constructor(params = {}) { super(); Object.assign(this, params); }
}

class MeshStandardMaterial extends Material {
  constructor(params = {}) { super(); Object.assign(this, params); }
}

class Object3D {
  constructor() {
    this.children = [];
    this.name = '';
    this.visible = true;
    this.position = new Vector3();
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = new Vector3(1, 1, 1);
    this.renderOrder = 0;
    this.userData = {};
  }
  add(child) { this.children.push(child); }
  remove(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
  }
  traverse(fn) {
    fn(this);
    for (const child of this.children) {
      if (child.traverse) child.traverse(fn);
      else fn(child);
    }
  }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      if (child.getObjectByName) {
        const found = child.getObjectByName(name);
        if (found) return found;
      }
    }
    return null;
  }
}

class Group extends Object3D {}
class Scene extends Object3D {}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material;
    this.isMesh = true;
    this.castShadow = false;
    this.receiveShadow = false;
  }
}

class Line extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material;
  }
}

class LineSegments extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material;
  }
}

class CylinderGeometry extends BufferGeometry {
  constructor() { super(); }
}

class Shape {
  constructor() { this.points = []; }
  moveTo() {}
  lineTo() {}
  getPoints() { return []; }
}

class CanvasTexture {
  constructor() {}
}

class SpriteMaterial extends Material {
  constructor(params = {}) { super(); Object.assign(this, params); }
}

class Sprite extends Object3D {
  constructor(material) {
    super();
    this.material = material;
    this.scale = new Vector3(1, 1, 1);
  }
}

class Box3 {
  constructor() { this.min = new Vector3(); this.max = new Vector3(); }
  setFromObject() { return this; }
  isEmpty() { return true; }
  getCenter(target) { return target || new Vector3(); }
  getSize(target) { return target || new Vector3(); }
}

const DoubleSide = 2;

export {
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  EdgesGeometry,
  PlaneGeometry,
  BoxGeometry,
  CylinderGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Group,
  Scene,
  Mesh,
  Line,
  LineSegments,
  Shape,
  CanvasTexture,
  SpriteMaterial,
  Sprite,
  Box3,
  DoubleSide,
};
