import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createConstructionWorksite } from '../src/render/construction/ConstructionWorksite';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import type { DevelopmentResponse } from '../src/sim/development/types';
import type { CultureStyle } from '../src/sim/types';

const style: CultureStyle = {
  primary: '#b15d45',
  secondary: '#35405c',
  accent: '#d8ad4f',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['ka', 'ri'],
};

function response(material: DevelopmentResponse['material']): DevelopmentResponse {
  return {
    need: 'housing',
    form: 'dwelling',
    name: 'Test dwelling',
    level: 1,
    material,
    cultureId: 'test-culture',
    style,
    services: { housing: 1 },
    reasons: ['test'],
    capabilities: [],
    cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 },
    labor: 4,
  };
}

function cues(group: THREE.Object3D, cue: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  group.traverse(object => {
    if (object.userData['constructionCue'] === cue) matches.push(object);
  });
  return matches;
}

describe('construction worksite presentation', () => {
  it('makes an active timber project read as a deliberate worksite', () => {
    const palette = new MaterialPalette({ culture: style, era: 'early' });
    const site = createConstructionWorksite({
      width: 2.2,
      depth: 1.7,
      progress: 0.25,
      response: response('timber'),
      seedKey: 'plot-a',
    }, palette);

    expect(site.userData['constructionWorksite']).toBe(true);
    expect(site.name).toBe('construction-worksite:plot-a');
    expect(cues(site, 'work-pad')).toHaveLength(1);
    expect(cues(site, 'staged-material').length).toBeGreaterThanOrEqual(4);
    expect(cues(site, 'site-furniture').length).toBeGreaterThanOrEqual(2);
    expect(cues(site, 'survey-marker')).toHaveLength(4);
  });

  it('keeps staged material presentation deterministic for the same project', () => {
    const palette = new MaterialPalette({ culture: style, era: 'village' });
    const spec = {
      width: 2.4,
      depth: 1.8,
      progress: 0.48,
      response: response('masonry'),
      seedKey: 'plot-stable',
    } as const;
    const first = createConstructionWorksite(spec, palette);
    const second = createConstructionWorksite(spec, palette);

    const positions = (root: THREE.Object3D): string[] => cues(root, 'staged-material').map(object =>
      `${object.position.x.toFixed(4)}:${object.position.y.toFixed(4)}:${object.position.z.toFixed(4)}:${object.rotation.y.toFixed(4)}`,
    );
    expect(positions(second)).toEqual(positions(first));
  });
});
