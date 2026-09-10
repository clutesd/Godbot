import { describe, expect, it } from 'vitest';
import { resolveUnderstoryAppearance, understoryDistanceScale } from '../src/render/vegetation/UnderstoryField';

describe('Forest understory presentation', () => {
  it('keeps understory fully readable beyond ordinary documentary camera framing', () => {
    expect(understoryDistanceScale(0)).toBe(1);
    expect(understoryDistanceScale(66)).toBe(1);
    expect(understoryDistanceScale(68)).toBe(1);
    expect(understoryDistanceScale(78)).toBe(1);
    expect(understoryDistanceScale(90)).toBeGreaterThan(0);
    expect(understoryDistanceScale(90)).toBeLessThan(1);
    expect(understoryDistanceScale(110)).toBe(0);
    expect(understoryDistanceScale(140)).toBe(0);
  });

  it('lets summer ferns fill a moist forest floor', () => {
    const fern = resolveUnderstoryAppearance('fern', 5, 0.62, 0);
    expect(fern.visible).toBe(true);
    expect(fern.scale).toBeGreaterThan(0.9);
    expect(fern.winter).toBe(0);
  });

  it('kills ferns back under winter and persistent snow', () => {
    expect(resolveUnderstoryAppearance('fern', 11, 0.28, 0).visible).toBe(false);
    expect(resolveUnderstoryAppearance('fern', 5, 0.55, 0.2).visible).toBe(false);
  });

  it('keeps woody shrubs and bushes present through winter', () => {
    const shrub = resolveUnderstoryAppearance('shrub', 11, 0.2, 0.18);
    const bush = resolveUnderstoryAppearance('bush', 11, 0.2, 0.18);
    expect(shrub.visible).toBe(true);
    expect(bush.visible).toBe(true);
    expect(shrub.scale).toBeGreaterThan(0.5);
    expect(bush.scale).toBeGreaterThan(shrub.scale);
    expect(shrub.winter).toBe(1);
    expect(bush.winter).toBe(1);
  });

  it('buries woody understory only under extreme snowpack', () => {
    expect(resolveUnderstoryAppearance('shrub', 11, 0.2, 0.8).visible).toBe(true);
    expect(resolveUnderstoryAppearance('bush', 11, 0.2, 1.3).visible).toBe(false);
  });
});
