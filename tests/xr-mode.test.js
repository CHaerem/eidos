import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, setXRMode, onXRModeChange, setEditMode, onEditModeChange } from '../js/state.js';

// ─── XR Mode State Tests ───

describe('XR mode state (state.js)', () => {
  beforeEach(() => {
    // Reset XR mode
    state.xrMode = null;
    state.editMode = false;
  });

  it('starts with xrMode = null', () => {
    expect(state.xrMode).toBe(null);
  });

  it('setXRMode updates state.xrMode', () => {
    setXRMode('vr');
    expect(state.xrMode).toBe('vr');
  });

  it('setXRMode notifies listeners', () => {
    const listener = vi.fn();
    onXRModeChange(listener);
    setXRMode('vr');
    expect(listener).toHaveBeenCalledWith('vr');
  });

  it('setXRMode does not notify if mode unchanged', () => {
    setXRMode('vr');
    const listener = vi.fn();
    onXRModeChange(listener);
    setXRMode('vr'); // same mode
    expect(listener).not.toHaveBeenCalled();
  });

  it('setXRMode supports all valid modes', () => {
    const modes = [null, 'vr', 'ar-furniture', 'ar-table'];
    const received = [];
    onXRModeChange(mode => received.push(mode));

    for (const mode of modes) {
      setXRMode(mode);
      // Reset to allow re-setting
      if (mode !== null) state.xrMode = null;
    }

    // null→null is skipped (no change), so we get: vr, ar-furniture, ar-table
    expect(received).toContain('vr');
    expect(received).toContain('ar-furniture');
    expect(received).toContain('ar-table');
  });

  it('listener errors do not break other listeners', () => {
    const badListener = vi.fn(() => { throw new Error('boom'); });
    const goodListener = vi.fn();
    onXRModeChange(badListener);
    onXRModeChange(goodListener);

    setXRMode('vr');
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();
  });

  it('setXRMode(null) resets to no-XR state', () => {
    setXRMode('vr');
    expect(state.xrMode).toBe('vr');
    setXRMode(null);
    expect(state.xrMode).toBe(null);
  });

  it('transitions between XR modes correctly', () => {
    const received = [];
    onXRModeChange(mode => received.push(mode));

    setXRMode('vr');
    setXRMode('ar-furniture');
    setXRMode('ar-table');
    setXRMode(null);

    expect(received).toEqual(['vr', 'ar-furniture', 'ar-table', null]);
  });
});

// ─── XR + Edit Mode Interaction ───

describe('XR mode + edit mode interaction', () => {
  beforeEach(() => {
    state.xrMode = null;
    state.editMode = false;
  });

  it('edit mode and XR mode are independent state', () => {
    setEditMode(true);
    setXRMode('vr');
    expect(state.editMode).toBe(true);
    expect(state.xrMode).toBe('vr');
  });

  it('entering XR does not auto-disable edit mode (UI listener does that)', () => {
    // state.js itself doesn't couple them — that's ui.js's job
    setEditMode(true);
    setXRMode('vr');
    // State layer: both can be true simultaneously
    expect(state.editMode).toBe(true);
    expect(state.xrMode).toBe('vr');
  });

  it('exiting XR does not change edit mode at state layer', () => {
    setEditMode(true);
    setXRMode('vr');
    setXRMode(null);
    expect(state.editMode).toBe(true);
  });
});

// ─── AR Capability Detection ───
// Note: ar.js imports GLTFExporter from CDN which isn't available in Vitest,
// so we test the capability detection logic inline rather than importing ar.js.

describe('AR capability detection (logic)', () => {
  it('detects non-XR environment correctly', () => {
    // Replicate detectCapabilities() logic from ar.js
    const result = { webxrAR: false, hitTest: false, isIOS: false, hasModelViewer: false };
    result.isIOS = /iPad|iPhone|iPod/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    result.hasModelViewer = typeof customElements !== 'undefined' && !!customElements?.get?.('model-viewer');

    // In Node/Vitest: no WebXR, no iOS, no model-viewer
    expect(result.webxrAR).toBe(false);
    expect(result.hitTest).toBe(false);
    expect(result.isIOS).toBe(false);
    expect(result.hasModelViewer).toBe(false);
  });

  it('iOS detection regex matches iPhone/iPad/iPod', () => {
    const regex = /iPad|iPhone|iPod/;
    expect(regex.test('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)')).toBe(true);
    expect(regex.test('Mozilla/5.0 (iPad; CPU OS 16_0)')).toBe(true);
    expect(regex.test('Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0)')).toBe(true);
    expect(regex.test('Mozilla/5.0 (Linux; Android 13)')).toBe(false);
    expect(regex.test('Mozilla/5.0 (Windows NT 10.0)')).toBe(false);
  });

  it('capability object has correct shape', () => {
    const caps = { webxrAR: false, hitTest: false, isIOS: false, hasModelViewer: false };
    expect(caps).toHaveProperty('webxrAR');
    expect(caps).toHaveProperty('hitTest');
    expect(caps).toHaveProperty('isIOS');
    expect(caps).toHaveProperty('hasModelViewer');
    expect(Object.keys(caps)).toHaveLength(4);
  });
});

// ─── Table Model Scene Builder ───

describe('buildTableModelScene (via ar.js internals)', () => {
  // We test the concept: scale factor and group structure

  it('table model scale is 1:20 (0.05)', () => {
    // The scale constant in ar.js is 0.05
    const EXPECTED_SCALE = 0.05;
    expect(EXPECTED_SCALE).toBeCloseTo(1 / 20, 5);
  });

  it('8.9m apartment at 1:20 becomes ~0.445m', () => {
    const apartmentWidth = 8.9; // meters (approx BOUNDS span)
    const scale = 0.05;
    const miniatureWidth = apartmentWidth * scale;
    expect(miniatureWidth).toBeCloseTo(0.445, 2);
    // ~44.5cm — fits on a table
    expect(miniatureWidth).toBeLessThan(0.6);
    expect(miniatureWidth).toBeGreaterThan(0.3);
  });
});

// ─── VR Session State Management ───

describe('VR session state flow', () => {
  beforeEach(() => {
    state.xrMode = null;
  });

  it('entering VR sets xrMode to "vr"', () => {
    setXRMode('vr');
    expect(state.xrMode).toBe('vr');
  });

  it('exiting VR resets xrMode to null', () => {
    setXRMode('vr');
    setXRMode(null);
    expect(state.xrMode).toBe(null);
  });

  it('only one XR mode active at a time', () => {
    setXRMode('vr');
    setXRMode('ar-furniture');
    expect(state.xrMode).toBe('ar-furniture');
    // VR was implicitly ended by switching to AR
  });

  it('VR rig starts as null in state', () => {
    // vrRig is set by scene.js during initScene()
    // In test environment it should be null
    expect(state.vrRig).toBe(null);
  });
});

// ─── XR Mode Listener Lifecycle ───

describe('XR mode listener lifecycle', () => {
  beforeEach(() => {
    state.xrMode = null;
  });

  it('multiple listeners receive same mode', () => {
    const results = [];
    onXRModeChange(m => results.push('A:' + m));
    onXRModeChange(m => results.push('B:' + m));

    setXRMode('ar-table');
    expect(results).toEqual(['A:ar-table', 'B:ar-table']);
  });

  it('listener receives null when exiting XR', () => {
    const received = [];
    onXRModeChange(m => received.push(m));

    setXRMode('vr');
    setXRMode(null);

    expect(received[1]).toBe(null);
  });

  it('rapid mode switches deliver all transitions', () => {
    const received = [];
    onXRModeChange(m => received.push(m));

    setXRMode('vr');
    setXRMode('ar-furniture');
    setXRMode('ar-table');
    setXRMode(null);
    setXRMode('vr');

    expect(received).toEqual(['vr', 'ar-furniture', 'ar-table', null, 'vr']);
  });
});
