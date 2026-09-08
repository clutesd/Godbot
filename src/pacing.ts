import { Historian } from './historian/Historian';
import { PresentationDirector, type PresentationMode } from './historian/PresentationDirector';
import { GODBOX_TIME_PRESETS, timePresetConfig, type GodboxTimePresetName } from './presets';
import { Simulation } from './sim/Simulation';
import { KNOWLEDGE_BY_ID } from './sim/knowledge/catalog';
import type { HistoricalEvent, Settlement } from './sim/types';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  return value;
}

function percentile(values: readonly number[], amount = 0.5): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * amount;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return Number(((sorted[lower] ?? 0) + ((sorted[lower + 1] ?? sorted[lower] ?? 0) - (sorted[lower] ?? 0)) * fraction).toFixed(2));
}

interface HistorySamples {
  runtimeMs: number[];
  majorDiscoveryGaps: number[];
  majorTransitionGaps: number[];
  adoptionLags: number[];
  transformationLags: number[];
  industrialStaging: number[];
  settlementLifetimes: number[];
  polityLifetimes: number[];
  warDurations: number[];
  settlementToTown: number[];
  townToIndustry: number[];
  settlementToIndustry: number[];
  industryToAtomic: number[];
  majorEventsPerCentury: number[];
  eraGenerations: number[];
  warsPerCentury: number[];
  wars: number;
  atomicRuns: number;
  industrialRuns: number;
}

function emptySamples(): HistorySamples {
  return { runtimeMs: [], majorDiscoveryGaps: [], majorTransitionGaps: [], adoptionLags: [], transformationLags: [], industrialStaging: [], settlementLifetimes: [], polityLifetimes: [], warDurations: [], settlementToTown: [], townToIndustry: [], settlementToIndustry: [], industryToAtomic: [], majorEventsPerCentury: [], eraGenerations: [], warsPerCentury: [], wars: 0, atomicRuns: 0, industrialRuns: 0 };
}

function distribution(values: readonly number[]): Record<string, number | null> {
  if (values.length === 0) return { count: 0, minimum: null, p25: null, median: null, p75: null, maximum: null };
  return {
    count: values.length,
    minimum: percentile(values, 0),
    p25: percentile(values, 0.25),
    median: percentile(values),
    p75: percentile(values, 0.75),
    maximum: percentile(values, 1),
  };
}

function eventNumber(event: HistoricalEvent): number {
  return Number.parseInt(event.id.replace('event-', ''), 10) || 0;
}

function collectRun(seed: string, years: number, samples: HistorySamples): void {
  const simulation = new Simulation({ seed, startingPopulation: 360, simulation: { historyLimit: 50_000 } });
  const started = performance.now();
  const townMonths = new Map<string, number>();
  const polityFirst = new Map<string, number>();
  const polityLast = new Map<string, number>();
  const events: HistoricalEvent[] = [];
  let lastEventNumber = 0;
  for (let month = 1; month <= years * 12; month += 1) {
    simulation.step();
    for (const settlement of simulation.state.settlements) if (settlement.alive && settlement.urbanization >= 0.3 && !townMonths.has(settlement.id)) townMonths.set(settlement.id, month);
    for (const polity of simulation.state.polities) {
      if (!polityFirst.has(polity.id)) polityFirst.set(polity.id, polity.formedMonth);
      polityLast.set(polity.id, month);
    }
    const latestNumber = eventNumber(simulation.state.history.at(-1) ?? { id: 'event-0' } as HistoricalEvent);
    if (latestNumber > lastEventNumber) {
      for (let index = simulation.state.history.length - 1; index >= 0; index -= 1) {
        const event = simulation.state.history[index];
        if (!event || eventNumber(event) <= lastEventNumber) break;
        if (event.type !== 'birth' && event.type !== 'death') events.push(event);
      }
      lastEventNumber = latestNumber;
    }
  }
  samples.runtimeMs.push(performance.now() - started);
  samples.wars += simulation.state.stats.wars;
  samples.warsPerCentury.push(simulation.state.stats.wars / Math.max(0.01, years / 100));
  const majorDiscoveries = events.filter((event) => event.type === 'discovery' && KNOWLEDGE_BY_ID.get(String(event.context.knowledge))?.major).map((event) => event.month).sort((a, b) => a - b);
  const transitions = events.filter((event) => event.type === 'technology-transformation' || event.type === 'industrialization' || event.type === 'atomic-threshold').map((event) => event.month).sort((a, b) => a - b);
  for (let index = 1; index < majorDiscoveries.length; index += 1) samples.majorDiscoveryGaps.push(((majorDiscoveries[index] ?? 0) - (majorDiscoveries[index - 1] ?? 0)) / 12);
  for (let index = 1; index < transitions.length; index += 1) samples.majorTransitionGaps.push(((transitions[index] ?? 0) - (transitions[index - 1] ?? 0)) / 12);
  for (const settlement of simulation.state.settlements) collectSettlement(settlement, simulation.state.month, events, townMonths, samples);
  for (const [id, first] of polityFirst) samples.polityLifetimes.push(((polityLast.get(id) ?? first) - first) / 12);
  for (const war of simulation.state.wars) if (war.resolvedMonth !== undefined) samples.warDurations.push((war.resolvedMonth - war.startMonth) / 12);
  const firstIndustry = events.find((event) => event.type === 'industrialization')?.month;
  const atomic = simulation.state.advanced.atomic.thresholdMonth;
  if (firstIndustry !== undefined) samples.industrialRuns += 1;
  if (atomic !== undefined) samples.atomicRuns += 1;
  if (firstIndustry !== undefined && atomic !== undefined) samples.industryToAtomic.push((atomic - firstIndustry) / 12);
  const discoveries = new Map(events.filter((event) => event.type === 'discovery').map((event) => [`${event.locationId}:${event.context.knowledge}`, event.month]));
  const adoptions = events.filter((event) => event.type === 'knowledge-adopted');
  for (const event of adoptions) {
    const discovery = discoveries.get(`${event.locationId}:${event.context.knowledge}`);
    if (discovery !== undefined) samples.adoptionLags.push((event.month - discovery) / 12);
  }
  for (const event of events.filter((candidate) => candidate.type === 'technology-transformation')) {
    const adoption = adoptions.find((candidate) => candidate.locationId === event.locationId && candidate.context.knowledge === event.context.knowledge);
    if (adoption) samples.transformationLags.push((event.month - adoption.month) / 12);
  }
  for (let century = 0; century < Math.ceil(years / 100); century += 1) {
    samples.majorEventsPerCentury.push(events.filter((event) => event.month >= century * 1200 && event.month < Math.min(years * 12, (century + 1) * 1200) && event.significance >= 0.7).length);
  }
  const durable = events.find((event) => event.type === 'knowledge-adopted' && event.context.knowledge === 'durable-records')?.month ?? simulation.state.month;
  const industrial = firstIndustry ?? simulation.state.month;
  const atomicMonth = atomic ?? simulation.state.month;
  for (const duration of [durable, Math.max(0, industrial - durable), Math.max(0, atomicMonth - industrial)]) samples.eraGenerations.push(duration / 12 / simulation.config.historicalPace.generationYears);
}

function collectSettlement(settlement: Settlement, horizonMonth: number, events: readonly HistoricalEvent[], townMonths: ReadonlyMap<string, number>, samples: HistorySamples): void {
  const abandoned = events.find((event) => event.type === 'settlement-abandoned' && event.actors.includes(settlement.id));
  samples.settlementLifetimes.push(((abandoned?.month ?? horizonMonth) - settlement.foundedMonth) / 12);
  const town = townMonths.get(settlement.id);
  const industrial = events.find((event) => event.type === 'industrialization' && event.locationId === settlement.id)?.month;
  if (town !== undefined) samples.settlementToTown.push((town - settlement.foundedMonth) / 12);
  if (industrial !== undefined) {
    samples.settlementToIndustry.push((industrial - settlement.foundedMonth) / 12);
    if (town !== undefined) samples.townToIndustry.push((industrial - town) / 12);
    if (settlement.industry.startedMonth !== undefined) samples.industrialStaging.push((industrial - settlement.industry.startedMonth) / 12);
  }
}

function presentationTrace(seed: string, years: number, pace: GodboxTimePresetName): Record<string, unknown> {
  const simulation = new Simulation({ ...timePresetConfig(pace), seed, startingPopulation: 360 });
  const historian = new Historian(simulation.config);
  const director = new PresentationDirector(simulation.config);
  let scene = historian.chooseScene(simulation.state);
  let shotAge = 0;
  let shotDuration = durationForScene(simulation, scene.score, scene.kind);
  let accumulator = 0;
  let seconds = 0;
  let shots = 1;
  const maximumSeconds = 120_000;
  while (simulation.year < years && seconds < maximumSeconds) {
    const deltaSeconds = 1;
    const speed = director.update(deltaSeconds, simulation.state, { ...scene, eventType: scene.event?.type, eventMonth: scene.event?.month });
    accumulator += speed;
    const wholeMonths = Math.floor(accumulator);
    if (wholeMonths > 0) {
      simulation.step(Math.min(wholeMonths, years * 12 - simulation.state.month));
      accumulator -= wholeMonths;
    }
    seconds += deltaSeconds;
    shotAge += deltaSeconds;
    if (shotAge >= shotDuration) {
      scene = historian.chooseScene(simulation.state);
      shotAge = 0;
      shotDuration = durationForScene(simulation, scene.score, scene.kind);
      shots += 1;
    }
  }
  const telemetry = director.telemetry();
  const totalViewing = Object.values(telemetry.viewingSeconds).reduce((sum, value) => sum + value, 0);
  const shares = Object.fromEntries(Object.entries(telemetry.viewingSeconds).map(([mode, value]) => [mode, Number((value / Math.max(1, totalViewing)).toFixed(3))])) as Record<PresentationMode, number>;
  return {
    simulatedYears: simulation.year,
    representedViewingMinutes: Number((seconds / 60).toFixed(2)),
    observedYearsPerRealMinute: Number((simulation.year / Math.max(1, seconds) * 60).toFixed(2)),
    averageShotSeconds: Number((seconds / shots).toFixed(2)),
    viewingTimeShare: shares,
    endingTelemetry: telemetry,
  };
}

function durationForScene(simulation: Simulation, score: number, kind: string): number {
  const scales: Record<string, number> = { 'world-establishing': 1.25, 'regional-travel': 1.15, 'settlement-approach': 1, 'street-observation': 1.1, 'worker-follow': 1.12, 'traveler-follow': 1.08, 'institution-exterior': 1.24, 'discovery-scene': 1.35, 'battle-overview': 1.3, 'aftermath-pullback': 1.4, 'city-growth-timelapse': 1.35, 'night-transition': 1.18, 'infrastructure-scene': 1.25, 'landscape-pause': 1.18, 'atomic-threshold': 1.55, 'orbital-establishing': 1.55, 'civilization-ending': 1.7, 'historian-context': 1.3 };
  const [minimum, maximum] = simulation.config.camera.shotSeconds;
  return (minimum + (maximum - minimum) * (0.28 + score * 0.45)) * (scales[kind] ?? 1);
}

const runs = boundedInteger('runs', 5, 1, 100);
const years = boundedInteger('years', 1800, 10, 10_000);
const viewYears = boundedInteger('view-years', 300, 10, 1800);
const seedPrefix = argument('seed-prefix', 'pacing-audit');
const pace = argument('pace', 'documentary') as GodboxTimePresetName;
if (!(pace in GODBOX_TIME_PRESETS)) throw new Error(`--pace must be one of: ${Object.keys(GODBOX_TIME_PRESETS).join(', ')}`);
const samples = emptySamples();
for (let index = 0; index < runs; index += 1) collectRun(`${seedPrefix}-${String(index + 1).padStart(2, '0')}`, years, samples);
const runtimeSeconds = samples.runtimeMs.reduce((sum, value) => sum + value, 0) / 1000;
const report = {
  experiment: { runs, years, seedPrefix, pace },
  simulation: {
    headlessMonthsPerSecond: Math.round(runs * years * 12 / Math.max(0.001, runtimeSeconds)),
    medianMajorDiscoveryGapYears: percentile(samples.majorDiscoveryGaps),
    medianMajorTechnologyTransitionGapYears: percentile(samples.majorTransitionGaps),
    medianDiscoveryToAdoptionYears: percentile(samples.adoptionLags),
    medianAdoptionToTransformationYears: percentile(samples.transformationLags),
    medianIndustrialStagingYears: percentile(samples.industrialStaging),
    medianSettlementLifetimeYears: percentile(samples.settlementLifetimes),
    medianPolityLifetimeYears: percentile(samples.polityLifetimes),
    polityLifetimeUpperQuartileYears: percentile(samples.polityLifetimes, 0.75),
    warsPerCentury: Number((samples.wars / Math.max(1, runs * years / 100)).toFixed(2)),
    medianWarDurationYears: percentile(samples.warDurations),
    medianSettlementToTownYears: percentile(samples.settlementToTown),
    medianTownToIndustrializationYears: percentile(samples.townToIndustry),
    medianSettlementToIndustrializationYears: percentile(samples.settlementToIndustry),
    medianIndustrializationToAtomicYears: percentile(samples.industryToAtomic),
    medianGenerationsPerBroadEra: percentile(samples.eraGenerations),
    medianMajorEventsPerCentury: percentile(samples.majorEventsPerCentury),
    industrializationReach: `${samples.industrialRuns}/${runs}`,
    atomicThresholdReach: `${samples.atomicRuns}/${runs}`,
  },
  distributions: {
    headlessMonthsPerSecond: distribution(samples.runtimeMs.map((milliseconds) => years * 12 / Math.max(0.001, milliseconds / 1000))),
    majorDiscoveryGapYears: distribution(samples.majorDiscoveryGaps),
    majorTechnologyTransitionGapYears: distribution(samples.majorTransitionGaps),
    discoveryToAdoptionYears: distribution(samples.adoptionLags),
    adoptionToTransformationYears: distribution(samples.transformationLags),
    industrialStagingYears: distribution(samples.industrialStaging),
    settlementLifetimeYears: distribution(samples.settlementLifetimes),
    polityLifetimeYears: distribution(samples.polityLifetimes),
    warsPerCenturyByRun: distribution(samples.warsPerCentury),
    warDurationYears: distribution(samples.warDurations),
    settlementToTownYears: distribution(samples.settlementToTown),
    townToIndustrializationYears: distribution(samples.townToIndustry),
    settlementToIndustrializationYears: distribution(samples.settlementToIndustry),
    industrializationToAtomicYears: distribution(samples.industryToAtomic),
    generationsPerBroadEra: distribution(samples.eraGenerations),
    majorEventsPerCentury: distribution(samples.majorEventsPerCentury),
  },
  presentation: presentationTrace(`${seedPrefix}-view`, viewYears, pace),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
