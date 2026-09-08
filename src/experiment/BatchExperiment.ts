import type { GodboxConfigInput } from '../config';
import type { GodboxPresetName } from '../presets';
import { Simulation, type SimulationSummary } from '../sim/Simulation';
import { representedPopulation } from '../sim/advanced/AdvancedCivilizationSystem';
import type { OutcomeClassification } from '../sim/types';

export interface ExperimentRun extends SimulationSummary {
  run: { seed: string; requestedYears: number; elapsedMs: number; monthsPerSecond: number };
  trajectory: ExperimentSnapshot[];
}

export interface ExperimentSnapshot {
  year: number;
  population: number;
  settlements: number;
  polities: number;
  activeWars: number;
  activeTradeRoutes: number;
  discoveries: number;
  industrialCenters: number;
}

export interface DistributionSummary {
  reached: number;
  minimum: number | null;
  firstQuartile: number | null;
  median: number | null;
  thirdQuartile: number | null;
  maximum: number | null;
}

export interface DescriptiveAssociation {
  variables: [string, string];
  sampleSize: number;
  coefficient: number | null;
  wording: string;
}

export interface BatchReport {
  experiment: {
    runs: number;
    years: number;
    startingPopulation: number;
    seedPrefix: string;
    seeds: string[];
    config: GodboxPresetName;
  };
  summary: {
    outcomeCounts: Partial<Record<OutcomeClassification, number>>;
    frequencies: {
      industrialization: number;
      atomicThreshold: number;
      nuclearWeapons: number;
      nuclearWar: number;
      majorNuclearExchange: number;
      interplanetary: number;
      extinctionOrCollapse: number;
      postBiologicalOrUnknown: number;
    };
    medianSurvivalYearsAfterAtomic: number | null;
    medianRunDurationMs: number | null;
    medianMonthsPerSecond: number | null;
    operationalDistributions: {
      finalPopulation: DistributionSummary;
      finalSettlements: DistributionSummary;
      finalPolities: DistributionSummary;
      warsPerMillennium: DistributionSummary;
      tradeActionsPerYear: DistributionSummary;
      discoveriesPerCentury: DistributionSummary;
    };
    trajectoryCheckpoints: Array<{
      year: number;
      population: DistributionSummary;
      settlements: DistributionSummary;
      polities: DistributionSummary;
      activeWars: DistributionSummary;
      activeTradeRoutes: DistributionSummary;
    }>;
    milestones: Record<string, DistributionSummary>;
    associations: DescriptiveAssociation[];
  };
  results: ExperimentRun[];
}

export function simulateExperimentRun(seed: string, years: number, population: number, overrides: GodboxConfigInput = {}): ExperimentRun {
  const simulation = new Simulation({ ...overrides, seed, startingPopulation: population });
  const started = performance.now();
  const trajectory: ExperimentSnapshot[] = [snapshot(simulation)];
  const sampleYears = 50;
  while (simulation.year < years) {
    simulation.step(Math.min(sampleYears * 12, years * 12 - simulation.state.month));
    trajectory.push(snapshot(simulation));
  }
  const elapsedMs = performance.now() - started;
  return {
    run: { seed, requestedYears: years, elapsedMs: Number(elapsedMs.toFixed(1)), monthsPerSecond: Math.round(years * 12 / Math.max(0.001, elapsedMs / 1000)) },
    trajectory,
    ...simulation.summary(),
  };
}

export function buildBatchReport(results: ExperimentRun[], years: number, population: number, seedPrefix: string, config: GodboxPresetName = 'default'): BatchReport {
  const total = Math.max(1, results.length);
  const count = (predicate: (run: ExperimentRun) => boolean): number => results.filter(predicate).length;
  const outcomes: Partial<Record<OutcomeClassification, number>> = {};
  for (const result of results) outcomes[result.outcomeClassification] = (outcomes[result.outcomeClassification] ?? 0) + 1;
  const milestone = (selector: (run: ExperimentRun) => number | null): DistributionSummary => distribution(results.map(selector).filter((value): value is number => value !== null));
  const atomicSurvival = results.filter((result) => result.atomicThresholdYear !== null).map((result) => Math.max(0, result.year - (result.atomicThresholdYear ?? result.year)));
  return {
    experiment: { runs: results.length, years, startingPopulation: population, seedPrefix, seeds: results.map((result) => result.seed), config },
    summary: {
      outcomeCounts: outcomes,
      frequencies: {
        industrialization: count((result) => result.firstIndustrializationYear !== null) / total,
        atomicThreshold: count((result) => result.atomicThresholdYear !== null) / total,
        nuclearWeapons: count((result) => result.nuclearWeaponsStates > 0) / total,
        nuclearWar: count((result) => result.nuclearUses > 0) / total,
        majorNuclearExchange: count((result) => result.nuclearWars > 0) / total,
        interplanetary: count((result) => result.selfSustainingBodies >= 2) / total,
        extinctionOrCollapse: count((result) => result.outcomeClassification === 'EXTINCT' || result.outcomeClassification === 'COLLAPSED') / total,
        postBiologicalOrUnknown: count((result) => result.outcomeClassification === 'POST-BIOLOGICAL' || result.outcomeClassification === 'UNKNOWN') / total,
      },
      medianSurvivalYearsAfterAtomic: median(atomicSurvival),
      medianRunDurationMs: median(results.map((result) => result.run.elapsedMs)),
      medianMonthsPerSecond: median(results.map((result) => result.run.monthsPerSecond)),
      operationalDistributions: {
        finalPopulation: distribution(results.map((result) => result.representedPopulation)),
        finalSettlements: distribution(results.map((result) => result.settlements)),
        finalPolities: distribution(results.map((result) => result.polities)),
        warsPerMillennium: distribution(results.map((result) => result.wars / Math.max(0.001, result.year / 1000))),
        tradeActionsPerYear: distribution(results.map((result) => result.trades / Math.max(1, result.year))),
        discoveriesPerCentury: distribution(results.map((result) => result.discoveries / Math.max(0.01, result.year / 100))),
      },
      trajectoryCheckpoints: trajectoryCheckpoints(results),
      milestones: {
        industrializationYear: milestone((result) => result.firstIndustrializationYear),
        atomicThresholdYear: milestone((result) => result.atomicThresholdYear),
        nuclearWeaponsYear: milestone((result) => result.advancedMilestones.nuclearWeapons),
        machineIntelligenceYear: milestone((result) => result.advancedMilestones.machineIntelligence),
        firstOrbitYear: milestone((result) => result.firstOrbitYear),
        offworldSettlementYear: milestone((result) => result.advancedMilestones.offworldSettlement),
        interplanetaryYear: milestone((result) => result.advancedMilestones.interplanetary),
      },
      associations: [
        association(results, 'final institutional capacity', (result) => result.institutionalCapacity, 'extinction or collapse', (result) => Number(result.outcomeClassification === 'EXTINCT' || result.outcomeClassification === 'COLLAPSED')),
        association(results, 'nuclear weapon development', (result) => Number(result.nuclearWeaponsStates > 0), 'nuclear use or war', (result) => Number(result.nuclearUses > 0)),
        association(results, 'interplanetary presence', (result) => Number(result.selfSustainingBodies >= 2), 'extinction or collapse', (result) => Number(result.outcomeClassification === 'EXTINCT' || result.outcomeClassification === 'COLLAPSED')),
      ],
    },
    results,
  };
}

function trajectoryCheckpoints(results: readonly ExperimentRun[]): BatchReport['summary']['trajectoryCheckpoints'] {
  const years = [...new Set(results.flatMap((result) => result.trajectory.map((point) => point.year)))].sort((a, b) => a - b);
  return years.map((year) => {
    const points = results.map((result) => result.trajectory.find((point) => point.year === year)).filter((point): point is ExperimentSnapshot => Boolean(point));
    return {
      year,
      population: distribution(points.map((point) => point.population)),
      settlements: distribution(points.map((point) => point.settlements)),
      polities: distribution(points.map((point) => point.polities)),
      activeWars: distribution(points.map((point) => point.activeWars)),
      activeTradeRoutes: distribution(points.map((point) => point.activeTradeRoutes)),
    };
  });
}

function snapshot(simulation: Simulation): ExperimentSnapshot {
  return {
    year: simulation.year,
    population: representedPopulation(simulation.state),
    settlements: simulation.state.settlements.filter((settlement) => settlement.alive).length,
    polities: simulation.state.polities.length,
    activeWars: simulation.state.wars.filter((war) => war.active).length,
    activeTradeRoutes: simulation.state.tradeRoutes.filter((route) => route.active).length,
    discoveries: simulation.state.stats.discoveries,
    industrialCenters: simulation.state.settlements.filter((settlement) => settlement.industry.active).length,
  };
}

function distribution(values: readonly number[]): DistributionSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    reached: sorted.length,
    minimum: sorted[0] ?? null,
    firstQuartile: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    thirdQuartile: percentile(sorted, 0.75),
    maximum: sorted.at(-1) ?? null,
  };
}

function percentile(sorted: readonly number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return Number(((sorted[lower] ?? 0) + ((sorted[lower + 1] ?? sorted[lower] ?? 0) - (sorted[lower] ?? 0)) * fraction).toFixed(2));
}

function median(values: readonly number[]): number | null {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

function association(results: readonly ExperimentRun[], leftName: string, left: (run: ExperimentRun) => number, rightName: string, right: (run: ExperimentRun) => number): DescriptiveAssociation {
  const coefficient = results.length < 5 ? null : correlation(results.map(left), results.map(right));
  return {
    variables: [leftName, rightName],
    sampleSize: results.length,
    coefficient: coefficient === null ? null : Number(coefficient.toFixed(4)),
    wording: coefficient === null
      ? 'The sample is too small or lacks enough variation for a stable descriptive coefficient.'
      : 'This is a descriptive Pearson/point-biserial association within these runs; it does not establish causation.',
  };
}

function correlation(a: readonly number[], b: readonly number[]): number | null {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * ((b[index] ?? 0) - meanB), 0);
  const denominatorA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0));
  const denominatorB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominatorA === 0 || denominatorB === 0 ? null : numerator / (denominatorA * denominatorB);
}
