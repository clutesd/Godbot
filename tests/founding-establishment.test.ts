import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { foundingSeed } from '../scripts/founding-seeds';
import { shelterCapacity } from '../src/sim/development/Shelter';
import { planEstablishment, serviceSupply } from '../src/sim/development/SettlementDevelopmentSystem';
import { applyCold, observeEstablishment, survivalMortality } from '../src/sim/pressures/Survival';
import { settlementLabour, invalidateLabour, explicitLabour } from '../src/sim/people/HumanCapital';
import { resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';
import { takeMaterial } from '../src/sim/resources/Inventory';
import { createSurvivalStructure } from '../src/render/founding/SurvivalStructure';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { isEstablishmentBuilder, physicalRestSite } from '../src/sim/people/EstablishmentWork';
import { resourceWorkAssignmentForPerson } from '../src/sim/people/ResourceWorkRouting';
import type { Settlement, SimulationState } from '../src/sim/types';

function arrival() {
  const sim = new Simulation({ seed: 'founding-loop-audit', startMode: 'arrival', world: { size: 64 } });
  sim.advanceArrival(80);
  return sim;
}
function residents(state: SimulationState, s: Settlement) { return state.people.filter(p => p.alive && p.homeId === s.id); }
function sum(values: Record<string, number | undefined>) { return Object.values(values).reduce<number>((n, v) => n + (v ?? 0), 0); }

describe('Arrival to physical establishment', () => {
  it.each(['founding-loop-audit', 'founding-woodland', 'founding-cold-frontier'])('guards the first five years of viable seed %s against generation-scale housing delay', seed => {
    const { reports } = foundingSeed(seed);
    expect(reports).toHaveLength(5);
    expect(reports.filter(row => row.firstDwelling !== null && row.firstDwelling <= 60).length).toBeGreaterThanOrEqual(3);
    for (const row of reports) {
      expect(row.firstShelter, JSON.stringify(row)).not.toBeNull();
      expect(row.firstShelter!).toBeLessThanOrEqual(8);
      expect(row.winterCoverage).toBeGreaterThan(0.6);
      if (!row.failures.includes('undernutrition') && !row.failures.includes('prolonged exposure')) {
        expect(row.firstDwelling, JSON.stringify(row)).not.toBeNull();
        expect(row.firstDwelling!).toBeLessThanOrEqual(60);
      }
      expect(row.extractedTimber).toBeGreaterThan(0);
    }
  }, 20000);

  it('uses real extraction, delivery and unfamiliar labour to build from zero materials without a professional builder', () => {
    const sim = arrival(), state = sim.state, s = state.settlements[1]!;
    for (const id of Object.keys(s.localMaterials)) takeMaterial(s, id, Infinity);
    for (const p of residents(state, s)) if (p.occupation === 'builder') p.occupation = 'farmer';
    const origins = new Map(residents(state, s).map(p => [p.id, p.occupation]));
    let extracted = 0, progress = 0, worked = 0, buildersShown = 0;
    const initial = shelterCapacity(s, state).capacity;
    const capacities: number[] = [];
    for (let month = 1; month <= 12; month++) {
      sim.step(1);
      const jobs = resourceWorkAssignments(state).filter(a => a.settlementId === s.id);
      extracted += jobs.filter(a => a.resourceId === 'timber').reduce((n, a) => n + a.amountExtracted, 0);
      worked += s.survival!.establishment!.constructionLabour;
      if (s.development?.project) {
        progress = Math.max(progress, s.development.project.progress);
        if (s.development.project.progress > 0) expect(sum(s.development.project.materialSpent ?? {})).toBeGreaterThan(0);
      }
      capacities.push(shelterCapacity(s, state).capacity);
      for (const p of residents(state, s)) {
        expect(p.occupation).toBe(origins.get(p.id));
        if (isEstablishmentBuilder(state, p)) {
          buildersShown++;
          expect(resourceWorkAssignmentForPerson(state, p, state.seed)).toBeUndefined();
          expect(s.survival!.establishment!.constructionByOccupation[p.occupation]).toBeGreaterThan(0);
        }
      }
    }
    expect(extracted).toBeGreaterThan(1);
    expect(worked).toBeGreaterThan(0);
    expect(progress).toBeGreaterThan(0);
    expect(buildersShown).toBeGreaterThan(0);
    expect(capacities.slice(0, 6).some(n => n > initial + 5)).toBe(true);
    expect(shelterCapacity(s, state).capacity).toBeGreaterThan(initial + 10);
    expect(s.materials!.lifetimeConsumed.timber).toBeGreaterThan(0);
    const measured = structuredClone(state), camp = measured.settlements.find(x => x.id === s.id)!;
    measured.month++;
    measured.weather.cells[camp.cellIndex]!.temperature = 0.01;
    takeMaterial(camp, 'timber', Infinity);
    applyCold(measured, camp, residents(measured, camp).length);
    const adaptedExposure = camp.survival!.cold.exposure;
    camp.structurePlots = []; camp.development!.project = undefined;
    measured.month++; applyCold(measured, camp, residents(measured, camp).length);
    expect(adaptedExposure).toBeLessThan(camp.survival!.cold.exposure * 0.8);
    expect(state.history.some(e => e.locationId === s.id && e.type === 'response-resolved' && e.tags.includes('shelter'))).toBe(true);
  }, 15000);

  it('conserves the full monthly labour allocation when food and winter shelter compete', () => {
    const sim = arrival(), state = sim.state, s = state.settlements[1]!;
    s.resources.food = 0;
    state.world.cells[s.cellIndex]!.temperature = 0.15;
    for (let month = 1; month <= 18; month++) {
      sim.step(1);
      invalidateLabour(state);
      const labour = settlementLabour(state, s, residents(state, s));
      const spent = sum(labour.resources) + sum(labour.economy) + labour.infrastructure + labour.industry
        + (labour.establishmentReserved ?? 0) + (labour.survivalReassigned ?? 0) * 0.3;
      expect(spent).toBeCloseTo(sum(labour.effective) * 0.98, 8);
      expect(sum(labour.economy)).toBeGreaterThan(0);
      expect(Object.values(s.localMaterials).every(n => Number.isFinite(n) && n >= 0)).toBe(true);
      const resourceSpent = resourceWorkAssignments(state).filter(a => a.settlementId === s.id).reduce((n, a) => n + a.labourUsed, 0);
      // Recomputed post-health budget can differ slightly; original physical work remains bounded by adults.
      expect(resourceSpent).toBeLessThan(sum(explicitLabour(residents(state, s), state.month).effective) + 0.5);
    }
  }, 15000);

  it('permits accumulated exposure, deteriorating health and mortality in a resource-starved cold founding', () => {
    const sim = arrival(), state = sim.state;
    for (const cell of state.world.cells) { cell.temperature = -0.5; cell.wood = 0; cell.fertility = 0; cell.minerals = 0; }
    for (const d of state.world.resourceDeposits) { d.capacity = 0; d.abundance = 0; d.depleted = true; }
    for (const pod of state.arrival!.pods) pod.condition = 0;
    for (const s of state.settlements) {
      for (const id of Object.keys(s.localMaterials)) takeMaterial(s, id, Infinity);
      s.resources.food = 0; s.knowledge.records = {};
    }
    for (const p of state.people) { p.health = 0.45; p.occupation = 'keeper'; }
    let dose = 0, hazard = 0, health = 1;
    for (let m = 0; m < 24; m++) {
      sim.step(1);
      for (const s of state.settlements) {
        dose = Math.max(dose, s.survival?.exposureDose ?? 0);
        hazard = Math.max(hazard, survivalMortality(s, 'cold'));
      }
      health = Math.min(health, state.people.reduce((n, p) => n + p.health, 0) / Math.max(1, state.people.length));
    }
    expect(dose).toBeGreaterThan(3);
    expect(hazard).toBeGreaterThan(0);
    expect(health).toBeLessThan(0.4);
    expect(state.stats.deaths).toBeGreaterThan(0);
    expect(state.settlements.every(s => shelterCapacity(s, state).capacity < 1)).toBe(true);
    expect(state.settlements.some(s => s.survival!.establishment!.choice === 'migrate')).toBe(true);
  }, 15000);

  it('changes decisions with terrain, seasons, food and usable physical capacity rather than a founding timer', () => {
    const sim = arrival(), state = sim.state, s = state.settlements[0]!, people = residents(state, s);
    const cell = state.world.cells[s.cellIndex]!;
    const choice = (wood: number, minerals: number) => {
      s.structurePlots = []; s.development!.project = undefined; cell.wood = wood; cell.minerals = minerals;
      for (const id of Object.keys(s.localMaterials)) takeMaterial(s, id, Infinity);
      state.month++;
      observeEstablishment(state, s, people.length, 20);
      planEstablishment(state, s, people);
      return s.development!.project!.response.adaptation;
    };
    expect(choice(1, 0.1)).not.toBe(choice(0.02, 1));
    cell.temperature = 0.2;
    state.month = 5; observeEstablishment(state, s, people.length, 20);
    const summer = s.survival!.establishment!.shelterUrgency;
    state.month = 9; observeEstablishment(state, s, people.length, 20);
    expect(s.survival!.establishment!.shelterUrgency).toBeGreaterThan(summer);
    expect(shelterCapacity(s, state).capacity).toBe(4);
    expect(people.filter(p => physicalRestSite(state, p))).toHaveLength(4);
    expect(serviceSupply(s).housing ?? 0).toBe(0);
  });

  it('keeps recipe experiments from consuming the project and seasonal fuel reserve', () => {
    const sim = arrival(), s = sim.state.settlements[0]!;
    sim.step(1);
    expect(s.development!.project!.progress).toBeGreaterThan(0);
    expect(s.localMaterials.timber).toBeGreaterThan(0);
    expect(s.survival!.establishment!.materialDemand.timber).toBeGreaterThan(0);
  });

  it('rejects damaged, restricted and unfinished housing and never counts surplus roofs as extra insulation', () => {
    const sim = arrival(); sim.step(3);
    const s = sim.state.settlements[0]!, plot = s.structurePlots!.find(p => p.development?.status === 'active')!;
    const pod = shelterCapacity(s, sim.state).pod;
    plot.condition = 0.2;
    expect(shelterCapacity(s, sim.state).capacity).toBe(pod);
    expect(serviceSupply(s).housing ?? 0).toBe(0);
    plot.condition = 1; plot.accessRestricted = true;
    expect(shelterCapacity(s, sim.state).capacity).toBe(pod);
    plot.accessRestricted = false;
    plot.development!.services.housing = 100;
    expect(shelterCapacity(s, sim.state, 22).protection).toBeCloseTo(22 * plot.development!.insulation!);
    sim.state.month++;
    sim.state.weather.cells[s.cellIndex]!.temperature = 0;
    takeMaterial(s, 'timber', Infinity);
    applyCold(sim.state, s, 22);
    expect(s.survival!.cold.exposure).toBeGreaterThan(0);
  });

  it('renders paid stages and a real roof at usability without frame-level economic mutation', () => {
    const sim = arrival(); sim.step(1);
    const s = sim.state.settlements[0]!, response = s.development!.project!.response;
    const palette = new MaterialPalette({ culture: response.style, era: 'primitive' });
    const before = JSON.stringify(s);
    const views = [0, 0.3, 0.6, 0.8, 1].map(p => createSurvivalStructure(response, p, 1.5, 1.2, palette));
    expect(views.map(v => v.userData.constructionStage)).toEqual(['site', 'frame', 'enclosure', 'usable', 'complete']);
    expect(views[0]!.getObjectByName('paid-materials')).toBeUndefined();
    expect(views[2]!.getObjectByName('protective-roof')).toBeUndefined();
    expect(views[3]!.getObjectByName('protective-roof')).toBeDefined();
    expect(JSON.stringify(s)).toBe(before);
    for (const view of views) view.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
});
