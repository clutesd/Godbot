import type { GodboxConfigInput } from './src/config';
import { presetConfig, timePresetConfig, type GodboxPresetName, type GodboxTimePresetName } from './src/presets';

/**
 * The deliberate intervention surface for GODBOX.
 * Change this file, restart the app, and a new deterministic observation begins.
 */
export const GODBOX_PRESET: GodboxPresetName = 'default';
export const GODBOX_TIME_PRESET: GodboxTimePresetName = 'documentary';

const LOCAL_OVERRIDES: GodboxConfigInput = {
  seed: 'witness-the-saffron-river',
  startingPopulation: 360,
  settlementCount: [5, 7],
  simulation: {
    maxTicksPerFrame: 12,
    populationSoftCap: 2600,
    historyLimit: 50_000,
  },
  world: {
    size: 52,
    cellSize: 2.25,
    seaLevel: 0.34,
    mountainLevel: 0.72,
    noiseScale: 0.075,
    resourceAbundance: 1,
    climateVariability: 0.82,
  },
  experiment: {
    // A ~300,000-year human-history horizon. Quiet deep time accelerates; eventful eras slow down.
    runYears: 300_000,
    autoNextRun: true,
    intermissionSeconds: 8,
    resumeOngoing: true,
  },
  audio: {
    enabled: true,
    basePath: '/audio/',
    crossfadeSeconds: 3.5,
    masterVolume: 0.55,
  },
  knowledge: {
    discoveryRate: 1,
    lossRate: 1,
    diffusionRate: 1,
    industrializationDifficulty: 1,
  },
  advanced: {
    developmentRate: 1,
    riskRate: 1,
    statisticalPopulationCap: 12_000_000_000,
    planetaryStabilityYears: 300,
    collapseSustainYears: 60,
  },
  autoRun: true,
};

export const GODBOX_CONFIG: GodboxConfigInput = timePresetConfig(GODBOX_TIME_PRESET, presetConfig(GODBOX_PRESET, LOCAL_OVERRIDES));
