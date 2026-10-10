import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { createPottery, MAX_POTTERY, planPottery, potteryStyle, potteryTier, type PotteryAnchor, type Vessel } from '../src/render/assets/Pottery';
import { CANONICAL_ADULT_HEIGHT } from '../src/render/GodboxRenderer';
import { learn } from './fixtures/settlementDevelopment';

function fixture() {
  const sim = new Simulation({ seed: 'development-acceptance', startingPopulation: 256, world: { size: 20 }, settlementCount: [4, 4] });
  const settlement = sim.state.settlements[0]!;
  settlement.knowledge.records = {};
  const culture = sim.state.cultures[0]!;
  const identity = { primary: culture.style.primary, secondary: culture.style.secondary, accent: culture.style.accent, lineageKey: 'house-one', lineageMarks: 2 };
  return { sim, settlement, culture, identity };
}
const anchor = (key: string, role = 'house'): PotteryAnchor => ({ key, role, localX: key === 'b' ? 4 : key === 'c' ? 8 : key === 'd' ? 12 : 0, localZ: 0, width: 2, depth: 2, rotationY: 0 });

describe('cultural pottery presentation', () => {
  it('derives stable faction styles from existing culture and heraldry without settlement randomness', () => {
    const { culture, identity } = fixture();
    const style = potteryStyle(culture.id, culture.style, identity);
    expect(potteryStyle(culture.id, structuredClone(culture.style), { ...identity })).toEqual(style);
    expect(style).toMatchObject({ primary: identity.primary, secondary: identity.secondary, accent: identity.accent, motif: culture.style.symbol, pattern: culture.style.pattern });
    expect(potteryStyle(culture.id, { ...culture.style, symbol: 'mountain-knot' }, { ...identity, primary: '#001122' })).not.toEqual(style);
    expect(new Set(Array.from({ length: 20 }, (_, i) => potteryStyle(culture.id, culture.style, { ...identity, lineageKey: `house-${i}` }).variant)).size).toBeGreaterThan(1);
  });

  it('requires adopted practical firing, never theory, raw prototypes, dormant knowledge or eras', () => {
    const { settlement } = fixture();
    expect(potteryTier(settlement)).toBe(0);
    learn(settlement, 'pottery-firing');
    const record = settlement.knowledge.records['pottery-firing']!;
    record.practice = 0.3;
    expect(potteryTier(settlement)).toBe(1);
    record.practice = 0.5;
    expect(potteryTier(settlement)).toBe(2);
    record.practice = 0.8;
    expect(potteryTier(settlement)).toBe(3);
    record.dormant = true;
    expect(planPottery(settlement, [anchor('home')])).toEqual([]);
    record.dormant = false; record.adoptedMonth = undefined; record.source = 'discovery';
    expect(potteryTier(settlement)).toBe(0);
    record.source = 'inheritance'; record.practice = 0;
    expect(potteryTier(settlement)).toBe(0);
    record.practice = 0.8; settlement.alive = false;
    expect(potteryTier(settlement)).toBe(0);
  });

  it('places a readable vessel set at practical sites and only one mature prestige vessel', () => {
    const { settlement } = fixture(); learn(settlement, 'pottery-firing');
    settlement.knownRecipes.push('pottery-vessels'); settlement.localMaterials.pottery = 4;
    const anchors = [anchor('a', 'house'), anchor('b', 'granary'), anchor('c', 'workshop'), anchor('d', 'market')];
    const plan = planPottery(settlement, anchors);
    expect(new Set(plan.map(p => p.vessel))).toEqual(new Set(['bowl', 'cooking-pot', 'storage-jar', 'jug', 'ritual']));
    expect(plan.filter(p => p.vessel === 'ritual')).toHaveLength(1);
    expect(plan.filter(p => p.finish === 'greenware')).toHaveLength(2);
    expect(plan.find(p => p.vessel === 'ritual')?.finish).toBe('prestige');
    expect(plan.every(p => p.x > 1.24)).toBe(true);
    expect(planPottery(settlement, ['shrine', 'hall', 'gate-tower', 'factory', 'research'].map(role => anchor(role, role)))).toEqual([]);
    settlement.knowledge.records['pottery-firing']!.practice = 0.3;
    expect(planPottery(settlement, anchors).some(p => p.vessel === 'ritual')).toBe(false);
    const rotated = planPottery(settlement, [{ ...anchor('home'), rotationY: Math.PI / 2 }]);
    expect(rotated[0]!.z).toBeCloseTo(-1.4);
  });

  it('bounds density independently of settlement size and input order', () => {
    const { settlement } = fixture(); learn(settlement, 'pottery-firing');
    const anchors = Array.from({ length: 1000 }, (_, i) => ({ ...anchor(String(i).padStart(4, '0'), 'workshop'), localX: i * 4 }));
    const plan = planPottery(settlement, anchors);
    expect(plan).toHaveLength(MAX_POTTERY);
    expect(planPottery(settlement, anchors.reverse())).toEqual(plan);
  });

  it('respects occupied footprints, avoids overlapping vessels, and uses development forms over legacy roles', () => {
    const { settlement } = fixture(); learn(settlement, 'pottery-firing');
    const home = anchor('home');
    const blocker = { ...anchor('construction'), localX: 2 };
    expect(planPottery(settlement, [home], [home, blocker])).toEqual([]);
    const duplicate = planPottery(settlement, [home, { ...home, key: 'duplicate' }]);
    expect(duplicate).toHaveLength(2);
    expect(Math.hypot(duplicate[0]!.x - duplicate[1]!.x, duplicate[0]!.z - duplicate[1]!.z)).toBeGreaterThanOrEqual(0.55);
    // Existing development response overrides the historical role.
    const response = { form: 'tower', need: 'security' } as NonNullable<PotteryAnchor['development']>;
    expect(planPottery(settlement, [{ ...home, development: response }])).toEqual([]);
    expect(planPottery(settlement, [{ ...anchor('tower', 'gate-tower'), development: { ...response, form: 'store', need: 'food' } }]).map(p => p.vessel)).toEqual(['storage-jar', 'storage-jar']);
  });

  it('renders deterministic finite hollow geometry in one draw call without mutating simulation state', () => {
    const { sim, settlement, culture, identity } = fixture(); learn(settlement, 'pottery-firing');
    settlement.knownRecipes.push('pottery-vessels'); settlement.localMaterials.pottery = 3;
    const before = JSON.stringify(sim.state);
    const style = potteryStyle(culture.id, culture.style, identity);
    const plan = planPottery(settlement, [anchor('a'), anchor('b', 'workshop'), anchor('c', 'granary')]);
    const group = createPottery(plan, style, potteryTier(settlement), () => 0.4);
    expect(group.children).toHaveLength(1);
    const mesh = group.children[0] as THREE.Mesh;
    const repeat = createPottery(plan, style, 3, () => 0.4).children[0] as THREE.Mesh;
    expect(mesh.userData['greenwareCount']).toBeGreaterThan(0);
    expect(mesh.userData['finishedCount']).toBeGreaterThan(0);
    expect(mesh.geometry.getAttribute('position').array).toEqual(repeat.geometry.getAttribute('position').array);
    expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    mesh.geometry.computeBoundingBox();
    // Vessels sit a hair above the ground (scaled with the vessel itself, not a fixed world offset).
    expect(mesh.geometry.boundingBox!.min.y).toBeGreaterThan(0.4);
    expect(mesh.geometry.boundingBox!.min.y).toBeLessThan(0.41);
    expect(mesh.geometry.getAttribute('position').count).toBeLessThan(60000);
    expect(JSON.stringify(sim.state)).toBe(before);
    const early = createPottery(plan, style, 1, () => 0).children[0] as THREE.Mesh;
    expect(early.geometry.getAttribute('position').count).toBeLessThan(mesh.geometry.getAttribute('position').count);
    for (const object of [mesh, repeat, early]) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
    expect(createPottery(plan, style, 0, () => 0).children).toHaveLength(0);
  });

  it('never grows a vessel past human scale, across every vessel, tier and style variant', () => {
    const { culture, identity } = fixture();
    const vessels: Vessel[] = ['bowl', 'cooking-pot', 'storage-jar', 'jug', 'ritual'];
    const motifs = ['sun-step', 'river-eye', 'woven-moon', 'mountain-knot', 'seed-spiral'] as const;
    for (const tier of [1, 2, 3] as const) {
      for (const variant of [0, 1, 2, 3]) {
        for (const motif of motifs) {
          const style = { ...potteryStyle(culture.id, culture.style, identity), motif, variant };
          const placements = vessels.map((vessel, i) => ({ vessel, x: i * 2, z: 0, rotation: 0, finish: 'fired' as const }));
          const group = createPottery(placements, style, tier, () => 0);
          const mesh = group.children[0] as THREE.Mesh;
          mesh.geometry.computeBoundingBox();
          const height = mesh.geometry.boundingBox!.max.y - mesh.geometry.boundingBox!.min.y;
          // Even the tallest ritual/storage vessel must stay well under an adult's height: no
          // tank-scale props, ever, for any combination of tier, culture variant or motif.
          expect(height).toBeLessThan(CANONICAL_ADULT_HEIGHT * 0.5);
          mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        }
      }
    }
  });
});
