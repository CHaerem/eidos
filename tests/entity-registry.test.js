import { describe, it, expect, beforeEach, vi } from 'vitest';
import { register, lookup, getMesh, getAllOfType, getInteractables, clear, size } from '../js/entity-registry.js';

// ─── Mock helpers ───

function mockMesh(name = 'mesh') {
  return {
    isMesh: true,
    name,
    userData: {},
    material: { clone: () => ({ emissive: { getHex: () => 0, setHex: () => {} } }) },
    traverse: function(fn) { fn(this); },
    parent: null,
  };
}

function mockGroup(children = []) {
  const group = {
    isMesh: false,
    userData: {},
    traverse: function(fn) {
      fn(this);
      for (const c of children) c.traverse(fn);
    },
    parent: null,
  };
  for (const c of children) c.parent = group;
  return group;
}

describe('entity-registry.js — register & lookup', () => {
  beforeEach(() => {
    clear();
  });

  it('register adds entity to forward map and interactables', () => {
    const mesh = mockMesh('wall-mesh');
    register('wall', 'A', mesh);

    expect(size()).toBe(1);
    expect(getInteractables().length).toBe(1);
    expect(getInteractables()[0]).toBe(mesh);
  });

  it('register tags userData with entityType and entityId', () => {
    const mesh = mockMesh('window-mesh');
    register('window', 'W1', mesh);

    expect(mesh.userData.entityType).toBe('window');
    expect(mesh.userData.entityId).toBe('W1');
  });

  it('register clones materials to prevent cross-contamination', () => {
    const cloneSpy = vi.fn(() => ({ emissive: { getHex: () => 0, setHex: () => {} } }));
    const mesh = {
      isMesh: true,
      name: 'test',
      userData: {},
      material: { clone: cloneSpy },
      traverse: function(fn) { fn(this); },
      parent: null,
    };

    register('wall', 'A', mesh);
    expect(cloneSpy).toHaveBeenCalledOnce();
    // material should now be the cloned version
    expect(mesh.material).not.toHaveProperty('clone', cloneSpy);
  });

  it('register clones array materials', () => {
    const cloneSpy1 = vi.fn(() => ({ id: 'cloned1' }));
    const cloneSpy2 = vi.fn(() => ({ id: 'cloned2' }));
    const mesh = {
      isMesh: true,
      name: 'multi-mat',
      userData: {},
      material: [
        { clone: cloneSpy1 },
        { clone: cloneSpy2 },
      ],
      traverse: function(fn) { fn(this); },
      parent: null,
    };

    register('door', 'D1', mesh);
    expect(cloneSpy1).toHaveBeenCalledOnce();
    expect(cloneSpy2).toHaveBeenCalledOnce();
    expect(mesh.material[0]).toEqual({ id: 'cloned1' });
    expect(mesh.material[1]).toEqual({ id: 'cloned2' });
  });

  it('lookup returns entity info for registered mesh', () => {
    const mesh = mockMesh('wall-mesh');
    register('wall', 'A', mesh);

    const result = lookup(mesh);
    expect(result).toEqual({ type: 'wall', id: 'A' });
  });

  it('lookup walks parent chain to find entity', () => {
    const childMesh = mockMesh('child');
    const parentGroup = mockGroup([childMesh]);
    register('protrusion', 'P1', parentGroup);

    // lookup on child should find parent's entity tag
    const result = lookup(childMesh);
    expect(result).toEqual({ type: 'protrusion', id: 'P1' });
  });

  it('lookup returns null for unregistered mesh', () => {
    const unregistered = mockMesh('random');
    const result = lookup(unregistered);
    expect(result).toBeNull();
  });

  it('lookup returns null for mesh with no parent chain match', () => {
    const mesh = mockMesh('orphan');
    mesh.parent = { userData: {}, parent: null };
    const result = lookup(mesh);
    expect(result).toBeNull();
  });
});

describe('entity-registry.js — getMesh', () => {
  beforeEach(() => {
    clear();
  });

  it('getMesh returns registered Object3D', () => {
    const mesh = mockMesh('window-mesh');
    register('window', 'W1', mesh);

    const result = getMesh('window', 'W1');
    expect(result).toBe(mesh);
  });

  it('getMesh returns null for unknown type', () => {
    const mesh = mockMesh('wall-mesh');
    register('wall', 'A', mesh);

    expect(getMesh('window', 'A')).toBeNull();
  });

  it('getMesh returns null for unknown id', () => {
    const mesh = mockMesh('wall-mesh');
    register('wall', 'A', mesh);

    expect(getMesh('wall', 'B')).toBeNull();
  });

  it('getMesh returns null when registry is empty', () => {
    expect(getMesh('wall', 'A')).toBeNull();
  });
});

describe('entity-registry.js — getAllOfType', () => {
  beforeEach(() => {
    clear();
  });

  it('getAllOfType returns all entities of given type', () => {
    register('wall', 'A', mockMesh('wall-A'));
    register('wall', 'B', mockMesh('wall-B'));
    register('window', 'W1', mockMesh('window-W1'));

    const walls = getAllOfType('wall');
    expect(walls.length).toBe(2);
    expect(walls.map(e => e.id).sort()).toEqual(['A', 'B']);
    expect(walls.every(e => e.type === 'wall')).toBe(true);
  });

  it('getAllOfType returns empty array for unknown type', () => {
    register('wall', 'A', mockMesh('wall-A'));
    const doors = getAllOfType('door');
    expect(doors).toEqual([]);
  });

  it('getAllOfType includes object3d reference', () => {
    const mesh = mockMesh('wall-A');
    register('wall', 'A', mesh);

    const results = getAllOfType('wall');
    expect(results[0].object3d).toBe(mesh);
  });
});

describe('entity-registry.js — getInteractables', () => {
  beforeEach(() => {
    clear();
  });

  it('getInteractables returns flat mesh array', () => {
    register('wall', 'A', mockMesh('wall-A'));
    register('window', 'W1', mockMesh('window-W1'));

    const interactables = getInteractables();
    expect(interactables.length).toBe(2);
    expect(interactables.every(m => m.isMesh)).toBe(true);
  });

  it('getInteractables includes child meshes from groups', () => {
    const child1 = mockMesh('child1');
    const child2 = mockMesh('child2');
    const group = mockGroup([child1, child2]);

    register('furniture', 'F1', group);

    const interactables = getInteractables();
    // group itself is not a mesh (isMesh=false), so only children are added
    expect(interactables.length).toBe(2);
    expect(interactables).toContain(child1);
    expect(interactables).toContain(child2);
  });

  it('getInteractables returns empty array when registry is empty', () => {
    expect(getInteractables()).toEqual([]);
  });
});

describe('entity-registry.js — clear & size', () => {
  beforeEach(() => {
    clear();
  });

  it('clear empties both maps', () => {
    register('wall', 'A', mockMesh('wall-A'));
    register('window', 'W1', mockMesh('window-W1'));
    expect(size()).toBe(2);
    expect(getInteractables().length).toBe(2);

    clear();

    expect(size()).toBe(0);
    expect(getInteractables().length).toBe(0);
    expect(getMesh('wall', 'A')).toBeNull();
  });

  it('size returns correct count', () => {
    expect(size()).toBe(0);

    register('wall', 'A', mockMesh('wall-A'));
    expect(size()).toBe(1);

    register('window', 'W1', mockMesh('window-W1'));
    expect(size()).toBe(2);

    register('door', 'D1', mockMesh('door-D1'));
    expect(size()).toBe(3);
  });
});

describe('entity-registry.js — multiple entity types', () => {
  beforeEach(() => {
    clear();
  });

  it('handles mixed entity types correctly', () => {
    register('wall', 'A', mockMesh('wall-A'));
    register('window', 'W1', mockMesh('window-W1'));
    register('door', 'D1', mockMesh('door-D1'));
    register('protrusion', 'P1', mockMesh('protrusion-P1'));
    register('furniture', 'F1', mockMesh('furniture-F1'));

    expect(size()).toBe(5);
    expect(getAllOfType('wall').length).toBe(1);
    expect(getAllOfType('window').length).toBe(1);
    expect(getAllOfType('door').length).toBe(1);
    expect(getAllOfType('protrusion').length).toBe(1);
    expect(getAllOfType('furniture').length).toBe(1);
  });

  it('re-registering same key overwrites forward map', () => {
    const mesh1 = mockMesh('wall-A-v1');
    const mesh2 = mockMesh('wall-A-v2');

    register('wall', 'A', mesh1);
    register('wall', 'A', mesh2);

    // Forward map points to the latest
    expect(getMesh('wall', 'A')).toBe(mesh2);
    // But interactables keeps growing (caller should clear() before rebuild)
    expect(size()).toBe(1);
  });
});
