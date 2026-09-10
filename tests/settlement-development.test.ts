import { connect, contrastingSocieties, learn, residents, run, societyFixture, sponsor } from './fixtures/settlementDevelopment';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceSettlementDevelopment, developmentContext, evaluatePressures, responseForNeed, serviceSupply } from '../src/sim/development/SettlementDevelopmentSystem';
import { repairWeatherDamage } from '../src/sim/weather/WeatherConsequences';
import { structureDestination } from '../src/shared/StructureDestinations';
import type { Settlement } from '../src/sim/types';
import { PlacementContract } from '../src/shared/placement/PlacementContract';
import { developmentBuildingRole, developmentPresentationEra, resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { BUILD_STAGE, composeBuilding } from '../src/render/assets/BuildingComposer';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';

describe('Settlement development decisions', () => {
  it('uses institutions and actual activity rather than a generic population unlock', () => {
    const { state, settlements: [s, other] } = societyFixture();
    const c = developmentContext(state, s!);
    expect(responseForNeed(c, 'government')).toBeUndefined();
    expect(responseForNeed(c, 'religion')).toBeUndefined();
    expect(responseForNeed(c, 'knowledge')).toBeUndefined();
    sponsor(state, s!, 'council'); sponsor(state, s!, 'temple'); sponsor(state, s!, 'knowledge-keepers');
    const organized = developmentContext(state, s!);
    expect(responseForNeed(organized, 'government')?.institutionId).toContain('council');
    expect(responseForNeed(organized, 'religion')?.form).toBe('sanctuary');
    expect(responseForNeed(organized, 'knowledge')?.name).toBe('teaching house');
    expect(responseForNeed(organized, 'trade')).toBeUndefined();
    connect(state, s!, other!);
    expect(responseForNeed(developmentContext(state, s!), 'trade')).toBeDefined();
  });

  it('satisfies order through elders, temple authority, civic guards or warriors according to society', () => {
    const { state, settlements: [s] } = societyFixture();
    sponsor(state, s!, 'council'); sponsor(state, s!, 'temple');
    const c = developmentContext(state, s!);
    c.culture.dimensions.hierarchy = 0.2; s!.politicalPower.kinship = 0.9;
    expect(responseForNeed(c, 'security')?.name).toBe('mutual watch ground');
    const decentralized = evaluatePressures(c);
    expect(decentralized.informal.security).toBeGreaterThan(decentralized.pressures.security!);
    c.culture.dimensions.hierarchy = 0.8; c.culture.dimensions.religiousTendency = 0.9;
    expect(responseForNeed(c, 'security')?.name).toBe('temple watch');
    c.culture.dimensions.religiousTendency = 0.1;
    expect(responseForNeed(c, 'security')?.name).toBe('civic guard house');
    c.culture.dimensions.militarism = 0.9;
    expect(responseForNeed(c, 'security')?.form).toBe('tower');
  });

  it('requires practical knowledge, specialist labor, transport, fuel and materials independently', () => {
    const { state, settlements: [s] } = societyFixture();
    sponsor(state, s!, 'craft-circle');
    let c = developmentContext(state, s!);
    expect(responseForNeed(c, 'manufacturing', 3)?.level).toBe(1);
    learn(s!, 'precision-tools', 'mechanical-power', 'precision-manufacturing', 'iron-working');
    s!.infrastructure.roads = 0.5;
    c = developmentContext(state, s!);
    expect(responseForNeed(c, 'manufacturing', 3)?.form).toBe('works');
    s!.knowledge.records['mechanical-power']!.dormant = true;
    expect(responseForNeed(c, 'manufacturing', 3)?.level).toBe(2);
    s!.knowledge.records['mechanical-power']!.dormant = false;
    s!.resources.wood = 0;
    expect(responseForNeed(c, 'manufacturing', 3)?.level).toBe(2);
    expect(responseForNeed(c, 'energy', 3)).toBeUndefined();
    s!.resources = { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 };
    run(state, 36);
    expect(s!.development?.project).toBeUndefined();
    expect(s!.buildings).toBe(4);
  });

  it('keeps tiny settlements simple even when advanced knowledge is inherited', () => {
    const { state, settlements: [s] } = societyFixture();
    state.people = state.people.filter(p => p.homeId !== s!.id).concat(residents(state, s!).slice(0, 8));
    residents(state, s!).forEach((p, i) => { p.occupation = i < 1 ? 'builder' : 'forager'; });
    sponsor(state, s!, 'craft-circle'); sponsor(state, s!, 'knowledge-keepers');
    learn(s!, 'precision-tools', 'mechanical-power', 'precision-manufacturing', 'electrical-generation', 'scientific-method', 'modern-medicine');
    const c = developmentContext(state, s!);
    expect(responseForNeed(c, 'manufacturing', 3)).toBeUndefined();
    expect(responseForNeed(c, 'energy', 3)).toBeUndefined();
    expect(responseForNeed(c, 'knowledge', 3)).toBeUndefined();
    expect(responseForNeed(c, 'government', 3)).toBeUndefined();
    run(state, 120);
    expect(s!.structurePlots!.every(p => !p.development || p.development.level === 1)).toBe(true);
  });
});

describe('Persistent society and construction', () => {
  it('pays the recorded construction cost exactly once and sends builders to the reserved site', () => {
    const { state, settlements: [s] } = societyFixture();
    sponsor(state, s!, 'temple');
    state.month++;
    advanceSettlementDevelopment(state, s!, residents(state, s!), 0);
    const project = structuredClone(s!.development!.project!);
    expect(project).toBeDefined();
    expect(structureDestination(s!, 'construction-site')?.id).toBe(project.plotId);
    const before = { ...s!.resources };
    const events = advanceSettlementDevelopment(state, s!, residents(state, s!), 10);
    expect(events).toHaveLength(1);
    for (const key of ['wood', 'minerals', 'goods', 'wealth'] as const) expect(s!.resources[key]).toBeCloseTo(before[key] - project.response.cost[key]);
    expect(advanceSettlementDevelopment(state, s!, residents(state, s!), 10)).toEqual([]);
    expect(s!.development?.project).toBeUndefined();
  });

  it('stops projects after the sponsor disappears and releases unfinished sites into decay', () => {
    const { state, settlements: [s] } = societyFixture();
    sponsor(state, s!, 'temple');
    run(state, 1, 0.001);
    const project = s!.development!.project!;
    const plotId = project.plotId;
    expect(project.response.institutionId).toContain('temple');
    s!.institutionIds = [];
    const resources = { ...s!.resources };
    run(state, 130);
    const site = s!.structurePlots!.find(p => p.id === plotId)!;
    expect(site.development?.status).toBe('abandoned');
    expect(s!.resources).toEqual(resources);
    const condition = site.condition;
    repairWeatherDamage(s!, 20, state.month + 1);
    expect(site.condition).toBe(condition);
    s!.alive = false;
    run(state, 120);
    expect(s!.development?.project).toBeUndefined();
  });

  it('develops contrasting agricultural sacred, civic trading, martial and decentralized places over decades', () => {
    const { state, settlements: [sacred, civic, martial, clan] } = contrastingSocieties();
    const events = run(state, 600);
    const active = (s: Settlement) => s.structurePlots!.filter(p => p.development?.status === 'active').map(p => p.development!);
    expect(active(sacred!).some(b => b.form === 'field')).toBe(true);
    expect(active(sacred!).some(b => b.name === 'temple')).toBe(true);
    expect(active(civic!).some(b => b.need === 'trade')).toBe(true);
    expect(active(civic!).some(b => b.need === 'government')).toBe(true);
    expect(active(martial!).some(b => b.form === 'tower')).toBe(true);
    expect(active(clan!).some(b => ['religion', 'government', 'security'].includes(b.need))).toBe(false);
    expect(new Set(state.settlements.map(s => active(s).map(b => `${b.need}:${b.form}:${b.level}`).sort().join(','))).size).toBe(4);
    expect(events.some(e => e.context?.['action'] === 'expanded')).toBe(true);
    const contract = new PlacementContract(state.world);
    for (const s of state.settlements) for (const p of s.structurePlots!) {
      expect(contract.validate({ type: 'small-building', worldX: p.worldX, worldZ: p.worldZ, footprintRadius: p.radius }).valid).toBe(true);
    }
  });

  it('retains a shrine identity through expansion, abandonment, ruin and institutional reuse', () => {
    const { state, settlements: [s] } = societyFixture();
    state.cultures[0]!.dimensions.religiousTendency = 0.95; sponsor(state, s!, 'temple');
    run(state, 150);
    const shrine = s!.structurePlots!.find(p => p.development?.need === 'religion')!;
    expect(shrine.development?.level).toBe(2);
    const identity = { id: shrine.id, x: shrine.worldX, z: shrine.worldZ, founded: shrine.foundedMonth, origin: structuredClone(shrine.development!.origin) };
    s!.alive = false; run(state, 800);
    expect(shrine.development?.status).toBe('ruin');
    expect(shrine.condition).toBe(0);
    s!.alive = true; s!.institutionIds = []; state.cultures[0]!.dimensions.religiousTendency = 0.1;
    sponsor(state, s!, 'knowledge-keepers'); learn(s!, 'durable-records');
    run(state, 500);
    expect(s!.structurePlots!.some(p => p.development?.history.some(h => h.action === 'reused'))).toBe(true);
    expect({ id: shrine.id, x: shrine.worldX, z: shrine.worldZ, founded: shrine.foundedMonth, origin: shrine.development!.origin }).toEqual(identity);
    expect(shrine.development!.history.length).toBeLessThanOrEqual(12);
  });

  it('uses regional surplus only across an operating connection', () => {
    const { state, settlements: [center, village] } = societyFixture();
    sponsor(state, center!, 'knowledge-keepers'); sponsor(state, village!, 'knowledge-keepers');
    run(state, 150);
    const archive = center!.structurePlots!.find(p => p.development?.need === 'knowledge')!;
    archive.development!.services.knowledge = 10;
    connect(state, center!, village!);
    run(state, 12, 0);
    expect(serviceSupply(center!).knowledge).toBeGreaterThan(5);
    expect(village!.development?.providers.knowledge).toBe(center!.id);
    state.tradeRoutes[0]!.weatherBlocked = true; run(state, 12, 0);
    expect(village!.development?.providers.knowledge).toBeUndefined();
  });

  it('does not spend or complete construction on invalid terrain', () => {
    const { state, settlements: [s] } = societyFixture();
    sponsor(state, s!, 'temple'); state.cultures[0]!.dimensions.religiousTendency = 0.9;
    state.world.terrain.waterLevel.fill(2);
    const resources = { ...s!.resources };
    run(state, 48);
    expect(s!.development?.project).toBeUndefined();
    expect(s!.resources).toEqual(resources);
    expect(s!.structurePlots).toHaveLength(4);
  });

  it('replays development, spending, history and plots exactly without drawing randomness', () => {
    const a = societyFixture(); const b = societyFixture();
    for (const fixture of [a, b]) { sponsor(fixture.state, fixture.settlements[0]!, 'temple'); sponsor(fixture.state, fixture.settlements[1]!, 'council'); }
    expect(run(a.state, 180)).toEqual(run(b.state, 180));
    expect(a.state.settlements).toEqual(b.state.settlements);
    expect(a.state.settlements.every(s => Object.values(s.resources).every(n => n >= 0 && Number.isFinite(n)))).toBe(true);
  });

  it('renders cultural responses as distinct geometry with local material constraints', () => {
    const { state, settlements: [s] } = societyFixture(); sponsor(state, s!, 'council');
    const c = developmentContext(state, s!);
    const palette = new MaterialPalette({ culture: c.culture.style, era: 'early' });
    const profile = CultureStyleProfileFactory.createFromCulture(c.culture.id, c.culture.style);
    const height = (hierarchy: number) => {
      c.culture.dimensions.hierarchy = hierarchy;
      const response = responseForNeed(c, 'government')!;
      const grammar = resolveBuildingGrammar(profile, developmentPresentationEra(response), developmentBuildingRole(response), 'same-plot', response);
      expect(grammar.postStyle).not.toBe('steel'); expect(grammar.wallLayer).not.toBe('panel');
      const result = composeBuilding(grammar, palette, 'same-plot', BUILD_STAGE.DETAIL);
      const box = new THREE.Box3().setFromObject(result.group);
      const h = box.max.y - box.min.y;
      result.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      return h;
    };
    expect(height(0.2)).toBeLessThan(height(0.9));
    palette.dispose();
  });
});
