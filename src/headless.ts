import { simulateExperimentRun, type ExperimentRun } from './experiment/BatchExperiment';
import { GODBOX_PRESETS, GODBOX_TIME_PRESETS, presetConfig, timePresetConfig, type GodboxPresetName, type GodboxTimePresetName } from './presets';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function human(result: ExperimentRun): string {
  const milestoneText = Object.entries(result.milestones).sort((a, b) => a[1] - b[1]).slice(0, 10).map(([name, year]) => `${name} y${year}`).join(', ') || 'none';
  const regions = result.regionalSpecialization.slice(0, 5).map((region) => `${region.settlement}: ${region.label} [${region.domains.join(', ')}]`).join('\n  ');
  return [
    `GODBOX — ${result.seed} after ${result.year} years`,
    `Population ${result.representedPopulation.toLocaleString()} represented by ${result.explicitIndividuals} persistent individuals; ${result.settlements} settlements`,
    `Knowledge: ${result.discoveries} discoveries, ${result.knowledgeAdoptions} adoptions, ${result.technologyTransformations} transformations, ${result.knowledgeExchanges} transmissions, ${result.knowledgeLost} losses, ${result.rediscoveries} recoveries`,
    `Society: ${result.polities} polities, ${result.wars} wars (${result.battles} battles), ${result.tradeRoutes} routes, ${result.trades} monthly trade actions`,
    `Industrialization: ${result.industrialCenters} centers; first ${result.firstIndustrializationYear === null ? 'not reached' : `in year ${result.firstIndustrializationYear}`}; routes ${Object.entries(result.industrialRoutes).map(([route, count]) => `${route} (${count})`).join(', ') || 'none'}`,
    `Advanced: ${result.outcomeClassification}; atomic ${result.atomicThresholdYear === null ? 'not reached' : `year ${result.atomicThresholdYear}`}; ${result.nuclearWeaponsStates} nuclear states, ${result.nuclearUses} uses (${result.nuclearWars} major exchanges)`,
    `Space and machine: first orbit ${result.firstOrbitYear ?? 'not reached'}; ${result.selfSustainingBodies} self-sustaining bodies; machine capability ${result.machineCapability}`,
    `Fermi hypotheses: ${result.fermiHypotheses.join(', ') || 'not yet formulated'}`,
    `Independent discovery centers: ${result.independentDiscoveryCenters}`,
    `Milestones: ${milestoneText}`,
    `Regional profiles:\n  ${regions || 'none'}`,
    `Runtime: ${result.run.elapsedMs} ms (${result.run.monthsPerSecond} months/s)`,
  ].join('\n');
}

const fallbackSeed = argument('seed', 'witness-the-saffron-river');
const seeds = argument('seeds', '').split(',').map((seed) => seed.trim()).filter(Boolean);
if (seeds.length === 0) seeds.push(fallbackSeed);
const years = Math.max(1, Number.parseInt(argument('years', '250'), 10));
const population = Math.max(24, Number.parseInt(argument('population', '360'), 10));
const config = argument('config', 'default');
const pace = argument('pace', 'batch/headless');
const format = argument('format', 'json').toLowerCase();
if (!(config in GODBOX_PRESETS)) throw new Error(`--config must be one of: ${Object.keys(GODBOX_PRESETS).join(', ')}`);
if (!(pace in GODBOX_TIME_PRESETS)) throw new Error(`--pace must be one of: ${Object.keys(GODBOX_TIME_PRESETS).join(', ')}`);
const results = seeds.map((seed) => simulateExperimentRun(seed, years, population, presetConfig(config as GodboxPresetName, timePresetConfig(pace as GodboxTimePresetName))));

if (format === 'human') process.stdout.write(`${results.map(human).join('\n\n')}\n`);
else process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : { years, population, runs: results }, null, 2)}\n`);
