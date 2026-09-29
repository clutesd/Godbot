import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sleepGlyphSample } from '../src/render/people/SleepGlyphRenderer';
import { createSleepingBedding } from '../src/render/people/SleepingBedding';
import type { IndoorSleepingArea } from '../src/render/people/IndoorSleepingArea';

describe('Sleep presentation polish', () => {
  it('loops breath glyphs through invisible endpoints without a visible reset', () => {
    expect(sleepGlyphSample(0, 0, 0, false).opacity).toBe(0);
    expect(sleepGlyphSample(4.8, 0, 0, false).opacity).toBe(0);
    expect(sleepGlyphSample(2.4, 0, 0, false).opacity).toBeCloseTo(0.65);
    expect(sleepGlyphSample(1, 0.1, 0, false)).not.toEqual(sleepGlyphSample(1, 0.7, 0, false));
  });

  it('reduced motion holds a single quiet cue without drifting or pulsing', () => {
    for (let i = 0; i < 3; i++) expect(sleepGlyphSample(0, 0.2, i, true)).toEqual(sleepGlyphSample(100, 0.2, i, true));
    expect(sleepGlyphSample(0, 0.2, 1, true).opacity).toBe(0);
  });

  it.each([0.5, 1, 2])('keeps all bedding inside the assigned footprint at building scale %s', scale => {
    const area: IndoorSleepingArea = { key: 'home', worldX: 4, worldZ: -2, width: 1.4, depth: 1.2,
      rotationY: Math.PI / 3, floorY: 0.12, doorWidth: 0.34, plotWidth: 1.8, plotDepth: 1.6 };
    const group = createSleepingBedding(area, scale, 0.1);
    expect(group.userData['sleepingSpaces']).toHaveLength(4);
    expect(group.children).toHaveLength(5);
    group.scale.setScalar(scale);
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    expect(bounds.min.x).toBeGreaterThan(-area.width / 2);
    expect(bounds.max.x).toBeLessThan(area.width / 2);
    expect(bounds.min.z).toBeGreaterThan(-area.depth / 2);
    expect(bounds.max.z).toBeLessThan(area.depth / 2);
    expect(bounds.max.y).toBeLessThan(0.15);
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  });
});
