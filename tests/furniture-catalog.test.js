import { describe, it, expect } from 'vitest';
import { FURNITURE_CATALOG } from '../js/furniture.js';

describe('FURNITURE_CATALOG — structure validation', () => {
  const entries = Object.entries(FURNITURE_CATALOG);
  const ids = Object.keys(FURNITURE_CATALOG);

  it('catalog is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('all entries have required fields: name, w, h, d', () => {
    for (const [id, entry] of entries) {
      expect(entry.name, `${id} missing name`).toBeDefined();
      expect(typeof entry.name, `${id} name not string`).toBe('string');
      expect(entry.w, `${id} missing w`).toBeDefined();
      expect(entry.h, `${id} missing h`).toBeDefined();
      expect(entry.d, `${id} missing d`).toBeDefined();
    }
  });

  it('all dimensions are positive numbers', () => {
    for (const [id, entry] of entries) {
      expect(typeof entry.w, `${id}.w not number`).toBe('number');
      expect(typeof entry.h, `${id}.h not number`).toBe('number');
      expect(typeof entry.d, `${id}.d not number`).toBe('number');
      expect(entry.w, `${id}.w not positive`).toBeGreaterThan(0);
      expect(entry.h, `${id}.h not positive`).toBeGreaterThan(0);
      expect(entry.d, `${id}.d not positive`).toBeGreaterThan(0);
    }
  });

  it('all dimensions are reasonable (0.1m to 5m)', () => {
    for (const [id, entry] of entries) {
      expect(entry.w, `${id}.w too small`).toBeGreaterThanOrEqual(0.1);
      expect(entry.w, `${id}.w too large`).toBeLessThanOrEqual(5);
      const minH = id === 'hitting_mat_portable' ? 0.01 : 0.1; // mat is flat
      expect(entry.h, `${id}.h too small`).toBeGreaterThanOrEqual(minH);
      expect(entry.h, `${id}.h too large`).toBeLessThanOrEqual(5);
      expect(entry.d, `${id}.d too small`).toBeGreaterThanOrEqual(0.1);
      expect(entry.d, `${id}.d too large`).toBeLessThanOrEqual(5);
    }
  });

  it('all entries have a color', () => {
    for (const [id, entry] of entries) {
      expect(entry.color, `${id} missing color`).toBeDefined();
      expect(typeof entry.color, `${id}.color not number`).toBe('number');
    }
  });
});

describe('FURNITURE_CATALOG — naming conventions', () => {
  const ids = Object.keys(FURNITURE_CATALOG);

  it('catalog IDs use lowercase and underscores only', () => {
    for (const id of ids) {
      expect(id, `${id} has invalid characters`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('no duplicate names in catalog', () => {
    const names = Object.values(FURNITURE_CATALOG).map(e => e.name);
    const unique = new Set(names);
    expect(unique.size, `Duplicate names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`).toBe(names.length);
  });
});

describe('FURNITURE_CATALOG — GLB entries', () => {
  const glbEntries = Object.entries(FURNITURE_CATALOG).filter(([, e]) => e.glb);

  it('at least one GLB entry exists', () => {
    expect(glbEntries.length).toBeGreaterThan(0);
  });

  it('GLB entries have valid .glb paths', () => {
    for (const [id, entry] of glbEntries) {
      expect(entry.glb, `${id}.glb not a string`).toBeTypeOf('string');
      expect(entry.glb, `${id}.glb does not end with .glb`).toMatch(/\.glb$/);
      expect(entry.glb, `${id}.glb path is empty`).not.toBe('');
    }
  });

  it('GLB paths start with models/', () => {
    for (const [id, entry] of glbEntries) {
      expect(entry.glb, `${id}.glb path should start with models/`).toMatch(/^models\//);
    }
  });
});

describe('FURNITURE_CATALOG — IKEA entries', () => {
  const ikeaEntries = Object.entries(FURNITURE_CATALOG).filter(([, e]) => e.ikea);

  it('at least one IKEA entry exists', () => {
    expect(ikeaEntries.length).toBeGreaterThan(0);
  });

  it('IKEA entries have article numbers as strings of digits', () => {
    for (const [id, entry] of ikeaEntries) {
      expect(entry.ikea, `${id}.ikea not a string`).toBeTypeOf('string');
      expect(entry.ikea, `${id}.ikea not numeric`).toMatch(/^\d+$/);
      expect(entry.ikea.length, `${id}.ikea wrong length`).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('FURNITURE_CATALOG — custom entries', () => {
  const customEntries = Object.entries(FURNITURE_CATALOG).filter(([, e]) => e.custom);
  const validBuilders = ['besta', 'soderhamn', 'cana_tv', 'pax_golfsim', 'retractable_screen', 'portable_enclosure', 'hitting_mat_portable', 'vanish_deployed'];

  it('at least one custom entry exists', () => {
    expect(customEntries.length).toBeGreaterThan(0);
  });

  it('custom entries reference valid builder names', () => {
    for (const [id, entry] of customEntries) {
      expect(validBuilders, `${id}.custom "${entry.custom}" not a known builder`).toContain(entry.custom);
    }
  });
});

describe('FURNITURE_CATALOG — known entries', () => {
  it('contains expected furniture types', () => {
    const expected = ['sofa_3', 'spisebord', 'besta_3x', 'soderhamn', 'cana_tv', 'stol', 'sofabord'];
    for (const type of expected) {
      expect(FURNITURE_CATALOG[type], `Missing expected type: ${type}`).toBeDefined();
    }
  });

  it('generic entries have no glb or custom property', () => {
    const genericEntries = Object.entries(FURNITURE_CATALOG).filter(
      ([, e]) => !e.glb && !e.custom
    );
    expect(genericEntries.length).toBeGreaterThan(0);
    for (const [id, entry] of genericEntries) {
      expect(entry.glb, `${id} should not have glb`).toBeUndefined();
      expect(entry.custom, `${id} should not have custom`).toBeUndefined();
    }
  });
});
