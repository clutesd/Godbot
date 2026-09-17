import { describe, expect, it } from 'vitest';
import { cameraCanopyDissolveStrength } from '../src/render/vegetation/TreeMaterials';

describe('camera-aware canopy dissolve', () => {
  it('strongly clears foliage that is very close to the centre of the lens', () => {
    expect(cameraCanopyDissolveStrength(2.5, 0.04)).toBeGreaterThan(0.85);
  });

  it('stays completely dormant until the camera director explicitly arms it', () => {
    expect(cameraCanopyDissolveStrength(2.5, 0.04, 0)).toBe(0);
    const partial = cameraCanopyDissolveStrength(2.5, 0.04, 0.5);
    const full = cameraCanopyDissolveStrength(2.5, 0.04, 1);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
  });

  it('keeps distant canopy fully present', () => {
    expect(cameraCanopyDissolveStrength(12, 0.02)).toBe(0);
  });

  it('keeps off-axis foliage present even when it is close to the camera', () => {
    expect(cameraCanopyDissolveStrength(2.5, 0.24)).toBe(0);
  });

  it('uses a graded transition instead of binary disappearance', () => {
    const close = cameraCanopyDissolveStrength(3, 0.08);
    const middle = cameraCanopyDissolveStrength(7, 0.14);
    const edge = cameraCanopyDissolveStrength(10, 0.19);
    expect(close).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(0);
  });
});
