/**
 * architectureReachability.ts
 *
 * Observes which architectural archetypes an *unassisted* simulation actually builds, and which of
 * those a viewer would see.
 *
 * Nothing here grants knowledge, materials or plots. It reads simulation state after ordinary
 * months have run and resolves each persistent structure through the same production path the
 * renderer uses: `developmentBuildingRole` and `developmentPresentationEra` into
 * `resolveBuildingSpec` for plots, the energy renderer's plant context for prime movers, and the
 * renderer's own bounded display sample for visibility. An archetype counts as constructed only
 * when a *completed, active* structure resolves to it.
 */

import type { SimulationState, Settlement, StructurePlot } from '../sim/types';
import { BUILDING_ARCHETYPES, type BuildingArchetype } from '../render/architecture/BuildingArchetype';
import { resolveBuildingSpec, type BuildingSpec } from '../render/architecture/BuildingSpec';
import { developmentBuildingRole, developmentFabric, developmentPresentationEra } from '../render/assets/BuildingGrammar';
import { deriveStructureHeritage } from '../render/assets/StructureHeritage';
import { settlementPresentationEra } from '../render/assets/SettlementEra';
import { displayedPlotBudget, selectDisplayedPlots } from '../render/settlement/DisplayedPlots';
import { practical } from '../sim/knowledge/KnowledgeSystem';
import type { DevelopmentBlockCode, DevelopmentResponse, SettlementNeed } from '../sim/development/types';

/** Default culture input: routing and period never read it, only surface dressing does. */
const NEUTRAL_CULTURE = { materialBias: 'mixed', roofLanguage: 'gable-geometric', trimDensity: 0.4 } as const;

export const TRACKED_CAPABILITIES = [
  'pottery-firing', 'leverage', 'stone-composites', 'animal-husbandry', 'agrarian-surplus', 'wheel-axle', 'simple-gearing',
  'irrigation', 'metal-smelting', 'iron-working', 'rotary-machinery', 'precision-tools', 'mechanical-power',
  'standardized-parts', 'thermodynamics', 'industrial-chemistry', 'rail-transport', 'precision-manufacturing',
  'electrical-generation', 'electric-grid', 'automation', 'computation', 'improved-roads', 'civic-administration',
] as const;

export interface ArchetypeTally {
  /** First simulation year a completed, active structure resolved to this archetype. */
  firstConstructed: number | null;
  /** First year one was inside the renderer's display sample. */
  firstVisible: number | null;
  /** First year one was under construction (paid project or plant/segment in progress). */
  firstStarted: number | null;
  peak: number;
  final: number;
  peakVisible: number;
  finalVisible: number;
  /** Settlements that ever completed one. */
  settlements: Set<string>;
  /** Periods it was built in. */
  periods: Set<string>;
  /** Energy plants only: months it ran. */
  runningMonths?: number;
}

export interface ReachabilityRecord {
  seed: string;
  years: number;
  archetypes: Record<BuildingArchetype, ArchetypeTally>;
  /** First year each tracked capability was practised at 0.3 anywhere. */
  capabilities: Record<string, number | null>;
  /** Highest development level reached per need/form. */
  maxLevel: Record<string, number>;
  /** Annual-attempt blocker counts per need across the run (last attempt each year). */
  blockers: Record<string, Partial<Record<DevelopmentBlockCode, number>>>;
  /** Energy plants by kind: ever built / ever ran. */
  plants: Record<string, { built: number; ran: number; firstYear: number | null }>;
  /** Processing facilities by kind (completed). */
  facilities: Record<string, { built: number; firstYear: number | null }>;
  bridges: { complete: number; firstYear: number | null };
  eras: Record<string, number>;
  /** End-state distinct architectural periods standing in each living settlement. */
  generations: { settlement: string; periods: string[]; displayedPeriods: string[]; plots: number; displayed: number }[];
  population: { peak: number; final: number };
  settlements: { peak: number; final: number };
}

function emptyTally(): ArchetypeTally {
  return { firstConstructed: null, firstVisible: null, firstStarted: null, peak: 0, final: 0, peakVisible: 0, finalVisible: 0, settlements: new Set(), periods: new Set() };
}

function waterfront(state: SimulationState, settlement: Settlement): boolean {
  const cell = state.world.cells[settlement.cellIndex];
  return Boolean(cell?.coast || cell?.river || cell?.lake);
}

/** A completed plot resolved exactly as `GodboxRenderer.createPlacedBuilding` resolves it. */
export function plotSpec(state: SimulationState, settlement: Settlement, plot: StructurePlot, response: DevelopmentResponse | undefined = plot.development): BuildingSpec | undefined {
  if (!response) return undefined;
  const development = response === plot.development ? developmentFabric(response) : response;
  const role = developmentBuildingRole(development);
  return resolveBuildingSpec({
    role, era: developmentPresentationEra(development),
    seed: `${settlement.architecture?.dialectKey ?? settlement.id}:${role}:${plot.id}`,
    culture: NEUTRAL_CULTURE, development,
    heritage: plot.development ? deriveStructureHeritage(plot.development) : undefined,
    prosperity: settlement.prosperity, specialization: settlement.specialization, waterfront: waterfront(state, settlement),
  });
}

/** A prime mover resolved exactly as `EnergyRenderer` configures its shell. */
export function plantSpec(settlement: Settlement, plot: StructurePlot, kind: NonNullable<Settlement['energy']>['plants'][number]['kind']): BuildingSpec | undefined {
  if (!plot.development) return undefined;
  return resolveBuildingSpec({
    role: 'energy', era: developmentPresentationEra(plot.development), seed: `${settlement.id}:energy:${plot.id}`,
    culture: NEUTRAL_CULTURE, development: plot.development, energyKind: kind, archetype: 'factory',
    prosperity: settlement.prosperity,
  });
}

export class ArchitectureReachability {
  readonly archetypes = Object.fromEntries(BUILDING_ARCHETYPES.map(id => [id, emptyTally()])) as Record<BuildingArchetype, ArchetypeTally>;
  readonly capabilities: Record<string, number | null> = Object.fromEntries(TRACKED_CAPABILITIES.map(id => [id, null]));
  readonly maxLevel: Record<string, number> = {};
  readonly blockers: Record<string, Partial<Record<DevelopmentBlockCode, number>>> = {};
  readonly plants: Record<string, { built: number; ran: number; firstYear: number | null }> = {};
  readonly facilities: Record<string, { built: number; firstYear: number | null }> = {};
  readonly bridges = { complete: 0, firstYear: null as number | null };
  eras: Record<string, number> = {};
  generations: ReachabilityRecord['generations'] = [];
  private readonly plantsSeen = new Set<string>();
  private readonly plantsRan = new Set<string>();
  private readonly facilitiesSeen = new Set<string>();
  private readonly attemptsSeen = new Set<string>();
  private peakPopulation = 0;
  private peakSettlements = 0;
  private finalPopulation = 0;
  private finalSettlements = 0;

  constructor(private readonly visualDensity = 1) {}

  /** Monthly: only energy plant operation needs month resolution. */
  observeMonth(state: SimulationState): void {
    for (const settlement of state.settlements) {
      if (!settlement.alive) continue;
      for (const plant of settlement.energy?.plants ?? []) {
        if (plant.status !== 'running') continue;
        const plot = settlement.structurePlots?.find(p => p.id === plant.plotId);
        const spec = plot && plantSpec(settlement, plot, plant.kind);
        if (spec && (plant.kind === 'waterwheel' || plant.kind === 'windmill')) {
          const tally = this.archetypes[spec.archetype];
          tally.runningMonths = (tally.runningMonths ?? 0) + 1;
        }
        this.plantsRan.add(`${plant.id}:${plant.kind}`);
      }
    }
  }

  /** Annual: structures, visibility, capabilities, blockers. */
  observeYear(state: SimulationState): void {
    const year = Math.floor(state.month / 12);
    const counts = new Map<BuildingArchetype, number>();
    const visible = new Map<BuildingArchetype, number>();
    const add = (map: Map<BuildingArchetype, number>, id: BuildingArchetype) => map.set(id, (map.get(id) ?? 0) + 1);
    const started = new Set<BuildingArchetype>();
    this.eras = {};
    this.generations = [];
    let population = 0;
    let living = 0;
    for (const settlement of state.settlements) {
      if (!settlement.alive) continue;
      living++;
      population += state.people.filter(p => p.alive && p.homeId === settlement.id).length;
      const era = settlementPresentationEra(settlement);
      this.eras[era] = (this.eras[era] ?? 0) + 1;
      for (const id of TRACKED_CAPABILITIES) if (this.capabilities[id] === null && practical(settlement, id) >= 0.3) this.capabilities[id] = year;
      const displayed = new Set(selectDisplayedPlots(settlement, displayedPlotBudget(settlement, this.visualDensity)).map(p => p.id));
      const periods = new Set<string>();
      const displayedPeriods = new Set<string>();
      for (const plot of settlement.structurePlots ?? []) {
        const development = plot.development;
        if (!development || development.memorial) continue;
        if (development.status !== 'active') continue;
        const spec = plotSpec(state, settlement, plot);
        if (!spec) continue;
        const key = `${development.need}/${development.form}`;
        this.maxLevel[key] = Math.max(this.maxLevel[key] ?? 0, development.level);
        add(counts, spec.archetype);
        periods.add(spec.period);
        const tally = this.archetypes[spec.archetype];
        tally.firstConstructed ??= year;
        tally.settlements.add(settlement.id);
        tally.periods.add(spec.period);
        if (displayed.has(plot.id)) {
          add(visible, spec.archetype);
          displayedPeriods.add(spec.period);
          tally.firstVisible ??= year;
        }
      }
      const project = settlement.development?.project;
      const projectPlot = project && settlement.structurePlots?.find(p => p.id === project.plotId);
      if (project && projectPlot && !project.response.memorial) {
        const spec = plotSpec(state, settlement, projectPlot, project.response);
        if (spec) started.add(spec.archetype);
      }
      for (const plant of settlement.energy?.plants ?? []) {
        const plot = settlement.structurePlots?.find(p => p.id === plant.plotId);
        const record = this.plants[plant.kind] ??= { built: 0, ran: 0, firstYear: null };
        if (plant.progress >= 1 && !this.plantsSeen.has(plant.id + plant.kind)) {
          this.plantsSeen.add(plant.id + plant.kind); record.built++; record.firstYear ??= year;
        }
        if (!plot || plot.development?.status !== 'active') continue;
        if (plant.kind !== 'waterwheel' && plant.kind !== 'windmill') continue;
        const spec = plantSpec(settlement, plot, plant.kind);
        if (!spec) continue;
        if (plant.progress < 1) { started.add(spec.archetype); continue; }
        // Energy plants are drawn by EnergyRenderer, which has no display budget.
        add(counts, spec.archetype); add(visible, spec.archetype);
        const tally = this.archetypes[spec.archetype];
        tally.firstConstructed ??= year; tally.firstVisible ??= year;
        tally.settlements.add(settlement.id); tally.periods.add(spec.period);
      }
      for (const facility of settlement.processing?.facilities ?? []) {
        const key = `${facility.family}:${facility.kind}`;
        const record = this.facilities[key] ??= { built: 0, firstYear: null };
        if (facility.progress >= 1 && !this.facilitiesSeen.has(facility.id + facility.kind)) {
          this.facilitiesSeen.add(facility.id + facility.kind); record.built++; record.firstYear ??= year;
        }
      }
      const attempt = settlement.development?.lastAttempt;
      if (attempt && !this.attemptsSeen.has(`${settlement.id}:${attempt.month}`)) {
        this.attemptsSeen.add(`${settlement.id}:${attempt.month}`);
        for (const candidate of attempt.candidates) {
          const bucket = this.blockers[candidate.need] ??= {};
          for (const blocker of candidate.blockers) bucket[blocker.code] = (bucket[blocker.code] ?? 0) + 1;
        }
      }
      this.generations.push({ settlement: settlement.name, periods: [...periods].sort(), displayedPeriods: [...displayedPeriods].sort(),
        plots: (settlement.structurePlots ?? []).filter(p => p.development?.status === 'active').length, displayed: displayed.size });
    }
    let bridges = 0;
    for (const segment of Object.values(state.transportation.segments)) if (segment.kind === 'bridge' && segment.status === 'complete') bridges++;
    if (bridges > 0) {
      counts.set('bridge', (counts.get('bridge') ?? 0) + bridges);
      visible.set('bridge', (visible.get('bridge') ?? 0) + bridges);
      this.bridges.firstYear ??= year;
      this.archetypes.bridge.firstConstructed ??= year;
      this.archetypes.bridge.firstVisible ??= year;
    }
    this.bridges.complete = Math.max(this.bridges.complete, bridges);
    for (const segment of Object.values(state.transportation.segments)) if (segment.kind === 'bridge' && segment.status !== 'complete') started.add('bridge');
    for (const id of BUILDING_ARCHETYPES) {
      const tally = this.archetypes[id];
      tally.final = counts.get(id) ?? 0;
      tally.finalVisible = visible.get(id) ?? 0;
      tally.peak = Math.max(tally.peak, tally.final);
      tally.peakVisible = Math.max(tally.peakVisible, tally.finalVisible);
      if (started.has(id) || tally.final > 0) tally.firstStarted ??= year;
    }
    this.peakPopulation = Math.max(this.peakPopulation, population);
    this.peakSettlements = Math.max(this.peakSettlements, living);
    this.finalPopulation = population;
    this.finalSettlements = living;
  }

  record(seed: string, years: number): ReachabilityRecord {
    for (const kind of Object.keys(this.plants)) {
      this.plants[kind]!.ran = [...this.plantsRan].filter(key => key.endsWith(`:${kind}`)).length;
    }
    return {
      seed, years, archetypes: this.archetypes, capabilities: this.capabilities, maxLevel: this.maxLevel, blockers: this.blockers,
      plants: this.plants, facilities: this.facilities, bridges: this.bridges, eras: this.eras, generations: this.generations,
      population: { peak: this.peakPopulation, final: this.finalPopulation },
      settlements: { peak: this.peakSettlements, final: this.finalSettlements },
    };
  }
}

/** JSON-safe form: sets become sorted arrays. */
export function serializeReachability(record: ReachabilityRecord): unknown {
  return JSON.parse(JSON.stringify(record, (_key, value) => value instanceof Set ? [...value].sort() : value));
}

export type { SettlementNeed };
