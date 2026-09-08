import { buildBatchReport, simulateExperimentRun, type BatchReport } from './experiment/BatchExperiment';
import { GODBOX_PRESETS, GODBOX_TIME_PRESETS, presetConfig, timePresetConfig, type GodboxPresetName, type GodboxTimePresetName } from './presets';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  return value;
}

function human(report: BatchReport): string {
  const frequency = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const outcomes = Object.entries(report.summary.outcomeCounts).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => `${outcome} ${count}`).join(', ');
  const milestones = Object.entries(report.summary.milestones).map(([name, value]) => `${name}: ${value.reached}/${report.experiment.runs} reached, median ${value.median ?? 'n/a'}`).join('\n  ');
  const associations = report.summary.associations.map((item) => `${item.variables.join(' vs ')}: ${item.coefficient ?? 'n/a'} (${item.wording})`).join('\n  ');
  const operations = Object.entries(report.summary.operationalDistributions).map(([name, value]) => `${name}: median ${value.median ?? 'n/a'} [${value.minimum ?? 'n/a'}, ${value.maximum ?? 'n/a'}]`).join('\n  ');
  const trajectory = report.summary.trajectoryCheckpoints.filter((point) => point.year % 250 === 0).map((point) => `year ${point.year}: population median ${point.population.median ?? 'n/a'} [${point.population.minimum ?? 'n/a'}, ${point.population.maximum ?? 'n/a'}], settlements ${point.settlements.median ?? 'n/a'}, polities ${point.polities.median ?? 'n/a'}, active wars ${point.activeWars.median ?? 'n/a'}, active routes ${point.activeTradeRoutes.median ?? 'n/a'}`).join('\n  ');
  const runs = report.results.map((run) => `${run.seed}: ${run.outcomeClassification}; industry ${run.firstIndustrializationYear ?? '—'}, atomic ${run.atomicThresholdYear ?? '—'}, weapons ${run.advancedMilestones.nuclearWeapons ?? '—'}, orbit ${run.firstOrbitYear ?? '—'}, bodies ${run.selfSustainingBodies}; priorities space ${run.developmentPriorities.space}, machine ${run.developmentPriorities.machine}`).join('\n  ');
  const f = report.summary.frequencies;
  return [
    `GODBOX batch - ${report.experiment.runs} reproducible runs x ${report.experiment.years} years (${report.experiment.config})`,
    `Seeds: ${report.experiment.seeds.join(', ')}`,
    `Outcomes: ${outcomes || 'none'}`,
    `Frequencies: industry ${frequency(f.industrialization)}, atomic ${frequency(f.atomicThreshold)}, weapons ${frequency(f.nuclearWeapons)}, nuclear use/war ${frequency(f.nuclearWar)}, major exchange ${frequency(f.majorNuclearExchange)}, interplanetary ${frequency(f.interplanetary)}, extinct/collapsed ${frequency(f.extinctionOrCollapse)}, post-biological/unknown ${frequency(f.postBiologicalOrUnknown)}`,
    `Median observed survival after atomic threshold: ${report.summary.medianSurvivalYearsAfterAtomic ?? 'n/a'} years`,
    `Median runtime: ${report.summary.medianRunDurationMs ?? 'n/a'} ms; median throughput ${report.summary.medianMonthsPerSecond ?? 'n/a'} months/s`,
    `Runs:\n  ${runs}`,
    `Milestones:\n  ${milestones}`,
    `Operational distributions:\n  ${operations}`,
    `Trajectory checkpoints:\n  ${trajectory}`,
    `Associations:\n  ${associations}`,
  ].join('\n');
}

const runs = boundedInteger('runs', 20, 1, 1000);
const years = boundedInteger('years', 1500, 1, 10000);
const population = boundedInteger('population', 360, 24, 10000);
const seedPrefix = argument('seed-prefix', 'fermi-experiment');
const config = argument('config', 'default');
const pace = argument('pace', 'batch/headless');
const format = argument('format', 'json').toLowerCase();
if (!(config in GODBOX_PRESETS)) throw new Error(`--config must be one of: ${Object.keys(GODBOX_PRESETS).join(', ')}`);
if (!(pace in GODBOX_TIME_PRESETS)) throw new Error(`--pace must be one of: ${Object.keys(GODBOX_TIME_PRESETS).join(', ')}`);
if (format !== 'json' && format !== 'human') throw new Error('--format must be json or human');
const presetName = config as GodboxPresetName;
const seeds = Array.from({ length: runs }, (_, index) => `${seedPrefix}-${String(index + 1).padStart(4, '0')}`);
const results = seeds.map((seed) => simulateExperimentRun(seed, years, population, presetConfig(presetName, timePresetConfig(pace as GodboxTimePresetName))));
const report = buildBatchReport(results, years, population, seedPrefix, presetName);
process.stdout.write(format === 'human' ? `${human(report)}\n` : `${JSON.stringify(report, null, 2)}\n`);
