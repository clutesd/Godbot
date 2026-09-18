import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createConstructionWorksite } from '../src/render/construction/ConstructionWorksite';
import { decorateConstructionWorksite } from '../src/render/construction/ConstructionWorksiteInstaller';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import type { DevelopmentResponse } from '../src/sim/development/types';
import type { CultureStyle, Settlement } from '../src/sim/types';

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

function activeSettlement(progress = 0.3, wood = 20): Settlement {
  const projectResponse = response('timber');
  return {
    alive: true,
    constructionProgress: progress,
    resources: { food: 20, wood, minerals: 20, goods: 20, wealth: 20 },
    localMaterials: {},
    development: {
      pressures: {},
      unmet: {},
      informal: {},
      providers: {},
      evaluatedMonth: 0,
      nextAttemptMonth: 1,
      revision: 1,
      project: {
        plotId: 'plot-explicit',
        response: projectResponse,
        action: 'founded',
        startedMonth: 0,
        progress,
        spent: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
        blockedReasons: [],
      },
    },
  } as unknown as Settlement;
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

  it('decorates an explicitly supplied active construction group without module side effects', () => {
    const palette = new MaterialPalette({ culture: style, era: 'early' });
    const settlement = activeSettlement(0.3, 20);
    const activeSite = new THREE.Group();
    activeSite.userData['constructionSite'] = true;
    activeSite.userData['constructionFootprintWidth'] = 2.25;
    activeSite.userData['constructionFootprintDepth'] = 1.65;

    const worksite = decorateConstructionWorksite(activeSite, settlement, palette)!;
    expect(worksite.name).toBe('construction-worksite:plot-explicit');
    expect(worksite.userData['constructionSiteState']).toBe('active');
    expect(cues(worksite, 'staged-material').length).toBeGreaterThan(0);

    // Explicit decoration is idempotent; repeated renderer passes cannot duplicate site furniture.
    expect(decorateConstructionWorksite(activeSite, settlement, palette)).toBe(worksite);
    expect(activeSite.children.filter(child => child.name === worksite.name)).toHaveLength(1);
  });

  it('uses the shared blocked-site authority when explicitly decorating the worksite', () => {
    const palette = new MaterialPalette({ culture: style, era: 'early' });
    const settlement = activeSettlement(0.3, 0);
    const activeSite = new THREE.Group();
    activeSite.userData['constructionFootprintWidth'] = 2;
    activeSite.userData['constructionFootprintDepth'] = 1.5;

    const worksite = decorateConstructionWorksite(activeSite, settlement, palette)!;
    expect(worksite.userData['constructionSiteState']).toBe('blocked-material');
    expect(worksite.userData['blocked']).toBe(true);
    expect(cues(worksite, 'staged-material')).toHaveLength(0);
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
