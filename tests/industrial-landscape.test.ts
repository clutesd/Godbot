import { describe, expect, it } from 'vitest';
import { learn } from './fixtures/settlementDevelopment';
import {
  CREW, INDUSTRIAL_KNOWLEDGE, MACHINE_KNOWLEDGE, METAL_KNOWLEDGE, WOOD_KNOWLEDGE, placeFacility, processingWorld, runFacilityMonth, step, stock,
} from './fixtures/processingFacilities';
import { Simulation } from '../src/sim/Simulation';
import { PeopleSystem } from '../src/sim/people/PeopleSystem';
import { facilityConservationError } from '../src/sim/processing/FacilityInventory';
import { facilityTierSpec } from '../src/sim/processing/FacilityCatalog';
import { ensureProcessingAuthority, facilityUpgradeBlocker, facilitiesOf } from '../src/sim/processing/FacilitySystem';
import { industryDiagnosticLines, settlementIndustryDiagnostic } from '../src/sim/processing/FacilityDiagnostics';
import {
  facilityWorkAssignments, facilityWorkDutyFromDestinationId, facilityIdFromDestinationId, isFacilityWorkDestinationId,
} from '../src/sim/people/FacilityWorkRouting';
import { advanceSettlementMaterialUse } from '../src/sim/resources/MaterialUse';
import { facilityVisual } from '../src/render/industry/FacilityPresentation';
import { facilityStations } from '../src/render/industry/FacilityWorkstations';
import { FacilityCrewScene } from '../src/render/industry/FacilityCrewScene';
import { assignMarketStalls, type MarketStall } from '../src/render/people/MarketStallPresentation';
import { LocalActivityPresentation, type LocalActivityContext, type LocalWorkstation } from '../src/render/people/LocalActivityPresentation';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { buildSocialGroups, groupKeyFor } from '../src/render/people/PeoplePresentation';
import type { Person } from '../src/sim/types';

describe('machinery: the family that makes what the rest of industry wears out', () => {
  it('makes machine parts only in a machine works, out of real iron and forge heat', () => {
    const w = processingWorld('machine-parts');
    const f = placeFacility(w.state, w.s, 'machinery', 1);
    stock(w.s, { iron: 30, timber: 20, charcoal: 20 });
    for (let month = 0; month < 6; month++) runFacilityMonth(w.state, w.s, CREW, w.random);
    const parts = f.processes['catalog:machine-parts'];
    expect(parts?.lifetimeBatches ?? 0).toBeGreaterThan(0);
    // Two iron per batch, and a forge that had to be lit before the first one.
    expect(f.totals.consumed.iron ?? 0).toBeCloseTo(parts!.lifetimeBatches * 2, 4);
    expect(f.totals.consumed.charcoal ?? 0).toBeGreaterThan(parts!.lifetimeBatches);
    expect(w.s.knownRecipes).toContain('machine-parts');
    expect((w.s.localMaterials['machine-parts'] ?? 0) + (f.outputs['machine-parts'] ?? 0)).toBeGreaterThan(0);
    expect(facilityConservationError(f)).toBeLessThan(1e-4);

    // The settlement cannot make them anywhere else: a governed settlement with the same stock,
    // the same skills and no machine works produces nothing.
    const bare = processingWorld('machine-parts-bare');
    learn(bare.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE, ...INDUSTRIAL_KNOWLEDGE, ...MACHINE_KNOWLEDGE);
    bare.s.infrastructure.workshops = 0.6;
    bare.s.buildings = 2;
    stock(bare.s, { iron: 20, timber: 10, charcoal: 10 });
    step(bare.state, bare.system, 12);
    expect(facilitiesOf(bare.s, 'machinery')).toHaveLength(0);
    expect(bare.s.localMaterials['machine-parts'] ?? 0).toBe(0);
  });

  it('assembles engines only in a tier-three works, from parts, steel and copper', () => {
    const w = processingWorld('engine-works');
    const shop = placeFacility(w.state, w.s, 'machinery', 2);
    shop.inputs.iron = 10; shop.inputs.timber = 4; shop.inputs.charcoal = 8;
    shop.inputs['machine-parts'] = 12; shop.inputs.steel = 10; shop.inputs.copper = 4;
    runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(shop.processes['catalog:engine-assembly']).toBeUndefined();
    expect(shop.totals.produced.engine ?? 0).toBe(0);

    const t = processingWorld('engine-works-3');
    const works = placeFacility(t.state, t.s, 'machinery', 3);
    stock(t.s, { 'machine-parts': 60, steel: 40, copper: 20, iron: 40, charcoal: 30, timber: 20 });
    for (let month = 0; month < 10; month++) {
      works.power = { carrier: 'electric', demand: 22, supplied: 22, coverage: 1 };
      runFacilityMonth(t.state, t.s, CREW, t.random);
    }
    expect(works.processes['catalog:engine-assembly']?.lifetimeBatches ?? 0).toBeGreaterThan(0);
    expect(works.totals.consumed.steel ?? 0).toBeGreaterThan(0);
    expect(works.totals.consumed.copper ?? 0).toBeGreaterThan(0);
    expect((t.s.localMaterials.engine ?? 0) + (works.outputs.engine ?? 0)).toBeGreaterThan(0);
    expect(facilityConservationError(works)).toBeLessThan(1e-4);
  });

  it('is demanded by the industry it serves: machine wear is paid in machine parts before raw metal', () => {
    const industrial = (seed: string, stocked: Record<string, number>) => {
      const world = processingWorld(seed);
      const s = world.s;
      s.industry.active = true;
      s.industry.intensity = 0.8;
      s.infrastructure.power = 0.5;
      s.infrastructure.rail = 0;
      s.infrastructure.bridges = 0;
      stock(s, stocked);
      world.state.month = 2;
      advanceSettlementMaterialUse(world.state, s, world.state.people.filter(p => p.homeId === s.id && p.alive));
      return s;
    };
    const stocked = industrial('machine-wear', { 'machine-parts': 4, engine: 2, steel: 8 });
    expect(stocked.localMaterials['machine-parts']!).toBeLessThan(4);
    expect(stocked.localMaterials.engine!).toBeLessThan(2);
    expect(stocked.materialUse?.materials['machine-parts']?.demand ?? 0).toBeGreaterThan(0);
    expect(stocked.materialUse?.materials.engine?.supplied ?? 0).toBeGreaterThan(0);
    const machineWear = 8 - stocked.localMaterials.steel!;

    // With no machine shop in the economy the same wear is paid in raw metal instead: the
    // requirement substitutes rather than blocking.
    const substituted = industrial('machine-wear-substitute', { steel: 8 });
    expect(8 - substituted.localMaterials.steel!).toBeGreaterThan(machineWear);
  });

  it('founds, builds and runs a machine workshop through the ordinary planner', () => {
    const w = processingWorld('machinery-growth');
    learn(w.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE, ...INDUSTRIAL_KNOWLEDGE, ...MACHINE_KNOWLEDGE);
    w.s.buildings = 20;
    w.s.infrastructure.workshops = 0.4;
    ensureProcessingAuthority(w.state);
    // Worked metal is what justifies a machine shop; timber and fuel are what it also needs.
    for (let month = 0; month < 48; month++) {
      stock(w.s, { iron: 6, timber: 6, charcoal: 5, lumber: 2, bronze: 1 });
      runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 2 });
    }
    const shop = facilitiesOf(w.s, 'machinery')[0];
    expect(shop, 'the planner never founded a machine workshop').toBeDefined();
    expect(shop!.progress).toBe(1);
    expect(shop!.history.some(entry => entry.action === 'founded')).toBe(true);
    expect(shop!.history.some(entry => entry.action === 'completed')).toBe(true);
    expect(shop!.processes['catalog:machine-parts']?.lifetimeBatches ?? 0).toBeGreaterThan(0);
    expect((w.s.localMaterials['machine-parts'] ?? 0) + (shop!.outputs['machine-parts'] ?? 0)).toBeGreaterThan(0);
    const diagnostic = settlementIndustryDiagnostic(w.state, w.s).families.find(entry => entry.family === 'machinery')!;
    expect(diagnostic.standing).toBe('operating');
    expect(diagnostic.tier).toBe(1);
  });

  it('places the machinery ladder behind metallurgy: its trigger material is worked metal', () => {
    for (const tier of [1, 2, 3]) expect(facilityTierSpec('machinery', tier)).toBeDefined();
    const w = processingWorld('machinery-trigger');
    learn(w.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE, ...INDUSTRIAL_KNOWLEDGE, ...MACHINE_KNOWLEDGE);
    w.s.buildings = 12;
    stock(w.s, { timber: 40, lumber: 10 });
    const diagnostic = settlementIndustryDiagnostic(w.state, w.s).families.find(entry => entry.family === 'machinery')!;
    expect(diagnostic.standing).toBe('absent');
    expect(diagnostic.blocker).toBe('no-raw-material');
  });
});

describe('ceramics: clay becomes fired pottery only at a kiln, never by decoration alone', () => {
  it('fires pottery only in a pottery yard, out of real clay and a warmed kiln', () => {
    const w = processingWorld('pottery-yard');
    const f = placeFacility(w.state, w.s, 'ceramics', 1);
    learn(w.s, 'pottery-firing');
    stock(w.s, { clay: 20, timber: 10 });
    for (let month = 0; month < 6; month++) runFacilityMonth(w.state, w.s, CREW, w.random);
    const batches = f.processes['catalog:pottery-vessels'];
    expect(batches?.lifetimeBatches ?? 0).toBeGreaterThan(0);
    expect(f.totals.consumed.clay ?? 0).toBeGreaterThan(0);
    expect(w.s.knownRecipes).toContain('pottery-vessels');
    expect((w.s.localMaterials.pottery ?? 0) + (f.outputs.pottery ?? 0)).toBeGreaterThan(0);
    expect(facilityConservationError(f)).toBeLessThan(1e-4);

    // Same clay, same skill, no kiln: a governed settlement without one fires nothing.
    const bare = processingWorld('pottery-yard-bare');
    learn(bare.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE, ...INDUSTRIAL_KNOWLEDGE, ...MACHINE_KNOWLEDGE, 'pottery-firing');
    bare.s.infrastructure.workshops = 0.6;
    bare.s.buildings = 2;
    stock(bare.s, { clay: 20, timber: 10 });
    step(bare.state, bare.system, 12);
    expect(facilitiesOf(bare.s, 'ceramics')).toHaveLength(0);
    expect(bare.s.localMaterials.pottery ?? 0).toBe(0);
  });

  it('upgrades the pottery ladder from a clamp kiln to a bottle kiln to an industrial works', () => {
    for (const tier of [1, 2, 3]) expect(facilityTierSpec('ceramics', tier)).toBeDefined();
    const w = processingWorld('pottery-works-3');
    const works = placeFacility(w.state, w.s, 'ceramics', 3);
    learn(w.s, 'pottery-firing');
    for (let month = 0; month < 10; month++) {
      works.power = { carrier: 'electric', demand: 10, supplied: 10, coverage: 1 };
      stock(w.s, { clay: 10, timber: 4 });
      runFacilityMonth(w.state, w.s, CREW, w.random);
    }
    expect(works.processes['catalog:pottery-vessels']?.lifetimeBatches ?? 0).toBeGreaterThan(0);
    expect((w.s.localMaterials.pottery ?? 0) + (works.outputs.pottery ?? 0)).toBeGreaterThan(0);
    expect(facilityConservationError(works)).toBeLessThan(1e-4);
  });
});

describe('industrial diagnostics', () => {
  it('explains each family in the vocabulary of what is actually wrong', () => {
    const w = processingWorld('diagnostics');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    f.inputs.timber = 30;
    runFacilityMonth(w.state, w.s, CREW, w.random);
    const report = settlementIndustryDiagnostic(w.state, w.s);
    expect(report.governed).toBe(true);
    const wood = report.families.find(entry => entry.family === 'wood')!;
    expect(wood.standing).toBe('operating');
    expect(wood.tier).toBe(1);
    expect(wood.summary).toContain('tier 1 of 3');
    // The planner's own blocker function is what the report quotes.
    expect(wood.blocker).toBe(facilityUpgradeBlocker(w.state, w.s, f));

    const textiles = report.families.find(entry => entry.family === 'textiles')!;
    expect(textiles.standing).toBe('no-family-implementation');
    expect(textiles.summary).toContain('no family implementation');

    const lines = industryDiagnosticLines(w.state);
    expect(lines.some(line => line.includes(`${w.s.name}: wood processing tier 1 of 3`))).toBe(true);
    expect(lines.some(line => line.startsWith('No family implementation:'))).toBe(true);
  });

  it('names the missing capability when knowledge is what blocks the next tier', () => {
    const w = processingWorld('diagnostics-knowledge');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    delete w.s.knowledge.records['rotary-machinery'];
    f.saturationMonths = 6;
    const wood = settlementIndustryDiagnostic(w.state, w.s).families.find(entry => entry.family === 'wood')!;
    expect(wood.blocker).toBe('knowledge:rotary-machinery');
    expect(wood.summary).toContain('blocked from tier 2 by rotary machinery');
  });

  it('reports a works that cannot be converted because nothing is saturated', () => {
    const w = processingWorld('diagnostics-saturation');
    const f = placeFacility(w.state, w.s, 'metallurgy', 1);
    f.saturationMonths = 0;
    const metal = settlementIndustryDiagnostic(w.state, w.s).families.find(entry => entry.family === 'metallurgy')!;
    expect(metal.blocker).toBe('not-saturated');
    expect(f.upgrade).toBeUndefined();
  });
});

describe('real people at real machines', () => {
  function staffedWorld(seed: string) {
    const w = processingWorld(seed);
    const f = placeFacility(w.state, w.s, 'wood', 1);
    f.inputs.timber = 40;
    runFacilityMonth(w.state, w.s, CREW, w.random);
    return { ...w, f };
  }

  it('casts a crew only out of worker-months the authority actually spent', () => {
    const w = staffedWorld('crew-from-labour');
    expect(w.f.labour.used).toBeGreaterThan(0);
    const assignments = facilityWorkAssignments(w.state, 'crew-seed');
    const mine = [...assignments.values()].filter(a => a.facilityId === w.f.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThanOrEqual(Math.max(1, Math.round(w.f.labour.used + w.f.labour.haul * 0.5)));
    for (const assignment of mine) {
      const spec = facilityTierSpec('wood', 1)!;
      const person = w.state.people.find(p => assignments.get(p.id) === assignment)!;
      expect(spec.occupations).toContain(person.occupation);
      if (assignment.duty !== 'haul') expect(w.f.labour.byOccupation[person.occupation] ?? 0).toBeGreaterThan(0);
    }
  });

  it('leaves an idle works empty: no labour spent, nobody standing at a machine', () => {
    const w = processingWorld('crew-idle');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(f.labour.used).toBe(0);
    const assignments = facilityWorkAssignments(w.state, 'idle-seed');
    expect([...assignments.values()].filter(a => a.facilityId === f.id)).toHaveLength(0);
  });

  it('is deterministic and never double-books a person', () => {
    const a = staffedWorld('crew-determinism');
    const b = staffedWorld('crew-determinism');
    const keyed = (world: ReturnType<typeof staffedWorld>) => [...facilityWorkAssignments(world.state, 'same-seed')]
      .map(([id, assignment]) => `${id}:${assignment.facilityId}:${assignment.duty}`).sort();
    expect(keyed(a)).toEqual(keyed(b));
    const ids = [...facilityWorkAssignments(a.state, 'same-seed').keys()];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('routes an assigned crew member to the works itself, not the manufacturing district', () => {
    const simulation = new Simulation({ seed: 'facility-routing', startingPopulation: 300, settlementCount: [4, 4] });
    const state = simulation.state;
    const people = new PeopleSystem(state.world, state.seed);
    const settlement = state.settlements[0]!;
    learn(settlement, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE, ...INDUSTRIAL_KNOWLEDGE, ...MACHINE_KNOWLEDGE);
    const facility = placeFacility(state, settlement, 'wood', 2);
    facility.inputs.timber = 60;
    facility.labour = { required: 5, available: 5, used: 3, haul: 1, byOccupation: { builder: 2, artisan: 1 } };
    facility.freight = { inbound: 2, outbound: 1 };
    facility.status = 'active';
    facility.throughput = 0.8;

    let routed: Person | undefined;
    let destination = '';
    for (let month = 1; month <= 36 && !routed; month++) {
      state.month = month;
      const assignments = facilityWorkAssignments(state, state.seed);
      for (const [id, assignment] of assignments) {
        if (assignment.facilityId !== facility.id) continue;
        const person = state.people.find(p => p.id === id)!;
        person.energy = 1;
        people.advancePerson(person, settlement, state);
        if (isFacilityWorkDestinationId(person.navigation?.destinationId)) {
          routed = person;
          destination = person.navigation!.destinationId;
          break;
        }
      }
    }
    expect(routed).toBeDefined();
    expect(facilityIdFromDestinationId(destination)).toBe(facility.id);
    expect(facilityWorkDutyFromDestinationId(destination)).toBeDefined();
    expect(routed!.navigation?.destinationKind).toBe('industrial-site');
    expect(['craft', 'transport', 'travel']).toContain(routed!.activity);
    expect(Math.hypot(routed!.position.x - facility.position.x, routed!.position.z - facility.position.z)).toBeLessThan(6);
  });
});

describe('facility workstations', () => {
  function visualFor(seed: string, tier: number, family: 'wood' | 'metallurgy' | 'machinery' = 'metallurgy') {
    const w = processingWorld(seed);
    const f = placeFacility(w.state, w.s, family, tier);
    f.status = 'active';
    f.throughput = 0.7;
    return { w, f };
  }

  it('offers a furnace mouth only while the furnace is hot, and a dock only while freight moved', () => {
    const { w, f } = visualFor('stations-heat', 1);
    f.heat = 0;
    f.freight = { inbound: 0, outbound: 0 };
    const cold = facilityStations(facilityVisual(w.state, w.s, f)!);
    expect(cold.some(s => s.kind === 'furnace-tending')).toBe(false);
    expect(cold.some(s => s.kind === 'loading-bay')).toBe(false);

    f.heat = 1;
    f.freight = { inbound: 3, outbound: 1 };
    const hot = facilityStations(facilityVisual(w.state, w.s, f)!);
    expect(hot.some(s => s.kind === 'furnace-tending')).toBe(true);
    expect(hot.some(s => s.kind === 'loading-bay' && s.duty === 'haul')).toBe(true);
  });

  it('stands people outside the works, facing the machine they are working', () => {
    const combinations = [['wood', 1], ['wood', 2], ['wood', 3], ['metallurgy', 1], ['metallurgy', 2], ['metallurgy', 3],
      ['machinery', 1], ['machinery', 2], ['machinery', 3]] as const;
    for (const [family, tier] of combinations) {
      const { w, f } = visualFor(`stations-${family}-${tier}`, tier, family);
      f.heat = 1;
      f.condition = 0.8;
      f.freight = { inbound: 1, outbound: 1 };
      f.power.carrier = 'electric'; f.power.coverage = 1;
      const visual = facilityVisual(w.state, w.s, f)!;
      const stations = facilityStations(visual);
      expect(stations.length).toBeGreaterThan(2);
      for (const station of stations) {
        const dx = station.anchor.x - visual.position.x;
        const dz = station.anchor.z - visual.position.z;
        // Outside the radial clearance local activity pushes people out of...
        expect(Math.hypot(dx, dz)).toBeGreaterThan(Math.max(visual.width, visual.depth) * 0.52 + 0.2);
        // ...and outside the works' own pedestrian footprint, which is what actually blocks feet.
        const cos = Math.cos(visual.yaw), sin = Math.sin(visual.yaw);
        const localX = cos * dx - sin * dz;
        const localZ = sin * dx + cos * dz;
        const outside = Math.abs(localX) > visual.width / 2 + 0.14 || Math.abs(localZ) > visual.depth / 2 + 0.14;
        expect(outside).toBe(true);
        const facing = Math.atan2(station.machine.x - station.anchor.x, station.machine.z - station.anchor.z);
        expect(station.facing).toBeCloseTo(facing, 6);
      }
    }
  });

  it('binds only routed residents, one to a station, and holds the station between frames', () => {
    const w = processingWorld('crew-scene');
    const f = placeFacility(w.state, w.s, 'metallurgy', 1);
    f.status = 'active'; f.throughput = 0.6; f.heat = 1;
    const scene = new FacilityCrewScene();
    scene.update(w.state);
    const residents = w.state.people.filter(p => p.homeId === w.s.id && p.alive).slice(0, 3);
    residents.forEach((person, index) => {
      person.navigation = {
        destinationKind: 'industrial-site', destinationId: `facility-work:metallurgy:${index === 2 ? 'haul' : 'process'}:${f.id}`,
        reason: 'test', waypoints: [], waypointIndex: 0, schedulePhase: 'work', traveling: false, crossingMode: 'walk',
      };
      person.position = { x: f.position.x, z: f.position.z };
    });
    const bystander = w.state.people.find(p => p.homeId === w.s.id && !residents.includes(p))!;
    scene.bindWorkers([...residents, bystander]);
    expect(scene.size).toBe(residents.length);
    expect(scene.get(bystander.id)).toBeUndefined();
    const keys = residents.map(person => scene.get(person.id)!.station.key);
    expect(new Set(keys).size).toBe(keys.length);
    scene.bindWorkers([...residents, bystander]);
    expect(residents.map(person => scene.get(person.id)!.station.key)).toEqual(keys);
    expect(scene.occupancy(f.id)).toBe(residents.length);
  });
});

describe('market stalls', () => {
  const stall = (id: string, x: number, z: number, rotationY = 0): MarketStall =>
    ({ id, worldX: x, worldZ: z, rotationY, width: 0.85, depth: 0.48 });

  function shopper(id: string, x: number, z: number, role: Person['role'], activity: Person['activity']): Person {
    return {
      id, name: id, sex: 'female', bornMonth: 0, parents: [], children: [], cultureId: 'culture', energy: 1, prestige: 0,
      traits: { curiosity: 0.5, cooperation: 0.5, sociability: 0.5, aggression: 0.5, ambition: 0.5, riskTolerance: 0.5,
        empathy: 0.5, conformity: 0.5, courage: 0.5, patience: 0.5, conscientiousness: 0.5, loyalty: 0.5 },
      homeId: 'town', householdId: `house-${id}`, occupation: 'carrier', role, activity,
      alive: true, health: 1, ageMonths: 360, position: { x, z }, target: { x, z },
      navigation: { destinationId: 'market', destinationKind: 'market', schedulePhase: 'meal', traveling: false,
        waypoints: [], waypointIndex: 0, reason: 'test' },
    } as Person;
  }

  it('puts the vendor behind their own counter and shoppers at its frontage', () => {
    const stalls = [stall('a', 0, 0), stall('b', 4, 0)];
    const vendor = shopper('vendor', 0.2, 0.4, 'merchant', 'trade');
    const customers = [shopper('buyer-1', -0.2, -0.5, 'transporter', 'socialize'), shopper('buyer-2', 0.1, -0.6, 'transporter', 'socialize')];
    const assignments = assignMarketStalls([vendor, ...customers], stalls);
    const atCounter = assignments.get(vendor.id)!;
    expect(atCounter.role).toBe('vendor');
    expect(atCounter.stall.id).toBe('a');
    // Behind the table, facing it.
    expect(atCounter.socket.z).toBeGreaterThan(atCounter.table.z);
    const facing = Math.atan2(atCounter.table.x - atCounter.socket.x, atCounter.table.z - atCounter.socket.z);
    expect(atCounter.facing).toBeCloseTo(facing, 6);
    for (const customer of customers) {
      const place = assignments.get(customer.id)!;
      expect(place.role).toBe('customer');
      expect(place.stall.id).toBe('a');
      expect(place.socket.z).toBeLessThan(place.table.z);
    }
    // Vendor and customers stand on opposite sides of the same table.
    expect(atCounter.socket.z - assignments.get(customers[0]!.id)!.socket.z).toBeGreaterThan(0.8);
  });

  it('keeps a counter per vendor, caps a frontage, and gives nobody a socket without stalls', () => {
    const stalls = [stall('a', 0, 0), stall('b', 1.6, 0)];
    const vendors = [shopper('v1', 0, 0.3, 'trader', 'trade'), shopper('v2', 1.6, 0.3, 'merchant', 'trade'), shopper('v3', 0.8, 0.3, 'trader', 'trade')];
    const crowd = Array.from({ length: 8 }, (_, i) => shopper(`c${i}`, (i % 4) * 0.4 - 0.6, -0.8, 'transporter', 'socialize'));
    const assignments = assignMarketStalls([...vendors, ...crowd], stalls);
    const counters = [...assignments.values()].filter(entry => entry.role === 'vendor');
    expect(counters).toHaveLength(2);
    expect(new Set(counters.map(entry => entry.stall.id)).size).toBe(2);
    for (const id of ['a', 'b']) {
      expect([...assignments.values()].filter(entry => entry.role === 'customer' && entry.stall.id === id).length).toBeLessThanOrEqual(2);
    }
    expect(assignMarketStalls([...vendors, ...crowd], []).size).toBe(0);
    const repeat = assignMarketStalls([...vendors, ...crowd], stalls);
    expect([...repeat].map(([id, entry]) => `${id}:${entry.key}`)).toEqual([...assignments].map(([id, entry]) => `${id}:${entry.key}`));
  });

  it('refuses a socket the ground will not take', () => {
    const stalls = [stall('a', 0, 0)];
    const vendor = shopper('vendor', 0, 0.3, 'merchant', 'trade');
    const assignments = assignMarketStalls([vendor], stalls, { standable: () => false });
    expect(assignments.size).toBe(0);
  });
});

describe('local life at an assigned post', () => {
  const ground = { heightAt: () => 0, isStandable: () => true };

  function post(people: readonly Person[], workstation: (person: Person) => LocalWorkstation | undefined) {
    const local = new LocalActivityPresentation();
    const visuals = new PeopleVisualStateStore();
    const peers = new Map(people.map(person => [person.id, person]));
    const groups = buildSocialGroups(people);
    const previous = new Map<string, { x: number; z: number }>();
    const tick = (dt = 1 / 30) => {
      local.beginFrame();
      visuals.beginFrame();
      for (const person of people) {
        const at = visuals.get(person.id) ?? person.position;
        previous.set(person.id, { x: at.x, z: at.z });
      }
      return people.map(person => {
        const station = workstation(person);
        const context: LocalActivityContext = {
          base: { x: person.position.x, z: person.position.z, restFacing: station ? Math.atan2(station.focus.x - person.position.x, station.focus.z - person.position.z) : 0 },
          workstation: station,
          visual: visuals.get(person.id),
          group: groups.get(groupKeyFor(person) ?? ''),
          people: peers,
          structures: [],
          safeSegment: () => true,
          visualFor: id => visuals.snapshot(id) ?? previous.get(id),
          nearbyIds: () => people.map(other => other.id),
          revision: 1,
          blocked: false,
        };
        const plan = local.resolve(person, context, dt);
        const visual = visuals.resolve(person.id, {
          destination: plan?.destination ?? person.position, restFacing: plan?.restFacing, localMove: !!plan,
        }, dt, ground);
        return { x: visual.x, z: visual.z, facing: visual.facing, action: plan?.action, animation: plan?.animation, partnerId: plan?.partnerId };
      });
    };
    return { tick };
  }

  function marketPerson(id: string, x: number, z: number, role: Person['role'], activity: Person['activity']): Person {
    return {
      id, name: id, sex: 'male', bornMonth: 0, parents: [], children: [], cultureId: 'culture', energy: 1, prestige: 0,
      traits: { curiosity: 0.5, cooperation: 0.5, sociability: 0.9, aggression: 0.2, ambition: 0.5, riskTolerance: 0.5,
        empathy: 0.5, conformity: 0.5, courage: 0.5, patience: 0.5, conscientiousness: 0.5, loyalty: 0.5 },
      homeId: 'town', householdId: `house-${id}`, occupation: 'carrier', role, activity,
      alive: true, health: 1, ageMonths: 360, position: { x, z }, target: { x, z },
      navigation: { destinationId: 'town:market', destinationKind: 'market', schedulePhase: 'meal', traveling: false,
        waypoints: [], waypointIndex: 0, reason: 'test' },
    } as Person;
  }

  it('keeps a vendor at their counter, working the stall instead of joining a conversation', () => {
    const vendor = marketPerson('vendor', 0, 0.5, 'merchant', 'trade');
    const customer = marketPerson('customer', 0, -0.6, 'transporter', 'socialize');
    const table = { x: 0, z: 0 };
    const scene = post([vendor, customer], person => person.id === 'vendor' ? {
      key: 'stall-a:vendor', focus: table, routine: 'market-vendor', action: 'attend-stall', animation: 'work', attended: true,
    } : undefined);
    const actions = new Set<string>();
    let maxDrift = 0;
    let partnered = false;
    for (let frame = 0; frame < 1800; frame++) {
      const [atCounter] = scene.tick();
      actions.add(atCounter!.action!);
      partnered = partnered || Boolean(atCounter!.partnerId);
      maxDrift = Math.max(maxDrift, Math.hypot(atCounter!.x - vendor.position.x, atCounter!.z - vendor.position.z));
      // Always working over the table rather than turning away from it.
      expect(Math.abs(atCounter!.z)).toBeLessThan(1.2);
    }
    expect([...actions]).toContain('attend-stall');
    expect([...actions]).toContain('arrange-goods');
    expect(partnered).toBe(false);
    expect(maxDrift).toBeLessThan(0.6);
  });

  it('names a works crew beat after the machine it was given', () => {
    const machinist = marketPerson('machinist', 2, 2, 'machinist', 'craft');
    machinist.navigation = {
      destinationId: 'facility-work:metallurgy:process:works-1', destinationKind: 'industrial-site',
      schedulePhase: 'work', traveling: false, waypoints: [], waypointIndex: 0, reason: 'test',
    };
    const scene = post([machinist], () => ({
      key: 'works-1:furnace-tending:0', focus: { x: 2, z: 1.3 }, routine: 'facility-station',
      action: 'tap-the-furnace', animation: 'work', attended: true,
    }));
    const actions = new Set<string>();
    const animations = new Set<string>();
    for (let frame = 0; frame < 1200; frame++) {
      const [at] = scene.tick();
      actions.add(at!.action!);
      animations.add(at!.animation!);
    }
    expect([...actions]).toContain('tap-the-furnace');
    expect([...actions]).toContain('check-the-stock');
    expect([...animations]).toContain('work');
  });
});
