import type { GodboxConfigInput } from './config';

export type GodboxPresetName = 'default' | 'abundant-world' | 'scarcity' | 'archipelago' | 'unstable-climate' | 'fragmented-politics' | 'highly-connected-world';
export type GodboxTimePresetName = 'documentary' | 'slow-observer' | 'default' | 'accelerated-experiment' | 'batch/headless' | 'fast-test' | 'fast' | 'normal' | 'long-observation';

/** Presets alter starting pressures and rates. None inserts events or selects outcomes. */
export const GODBOX_PRESETS: Record<GodboxPresetName, GodboxConfigInput> = {
  default: {},
  'abundant-world': { world: { resourceAbundance: 1.35 } },
  scarcity: { world: { resourceAbundance: 0.68 } },
  archipelago: { settlementCount: [6, 8], world: { seaLevel: 0.48 } },
  'unstable-climate': { world: { climateVariability: 1.45 } },
  'fragmented-politics': { society: { politicalIntegration: 0.45, politicalFragmentation: 1.8 } },
  'highly-connected-world': { society: { contactRate: 1.35, tradeConnectivity: 1.45 }, knowledge: { diffusionRate: 1.3 } },
};

/** Viewing presets alter presentation and camera cadence only; authoritative history is untouched. */
export const GODBOX_TIME_PRESETS: Record<GodboxTimePresetName, GodboxConfigInput> = {
  documentary: {
    camera: { shotSeconds: [14, 24], transitionSeconds: 6.5 },
    presentation: { quietMonthsPerSecond: 6, ordinaryMonthsPerSecond: 2, significantMonthsPerSecond: 0.6, momentousMonthsPerSecond: 0.3, personalMonthsPerSecond: 0.8, transitionSeconds: 5, quietRampSeconds: 45, eventMemoryMonths: 18 },
  },
  'slow-observer': {
    camera: { shotSeconds: [18, 30], transitionSeconds: 7.5 },
    presentation: { quietMonthsPerSecond: 2.5, ordinaryMonthsPerSecond: 0.8, significantMonthsPerSecond: 0.3, momentousMonthsPerSecond: 0.16, personalMonthsPerSecond: 0.45, transitionSeconds: 6, quietRampSeconds: 70, eventMemoryMonths: 24 },
  },
  default: {
    camera: { shotSeconds: [13, 22], transitionSeconds: 6 },
    presentation: { quietMonthsPerSecond: 7.2, ordinaryMonthsPerSecond: 2.4, significantMonthsPerSecond: 0.72, momentousMonthsPerSecond: 0.36, personalMonthsPerSecond: 0.9, transitionSeconds: 4.5, quietRampSeconds: 40, eventMemoryMonths: 16 },
  },
  'accelerated-experiment': {
    camera: { shotSeconds: [8, 14], transitionSeconds: 3.5 },
    presentation: { quietMonthsPerSecond: 48, ordinaryMonthsPerSecond: 18, significantMonthsPerSecond: 4, momentousMonthsPerSecond: 2, personalMonthsPerSecond: 6, transitionSeconds: 2.5, quietRampSeconds: 16, eventMemoryMonths: 9 },
  },
  'batch/headless': {
    simulation: { maxTicksPerFrame: 240 },
    presentation: { quietMonthsPerSecond: 1_000_000, ordinaryMonthsPerSecond: 1_000_000, significantMonthsPerSecond: 1_000_000, momentousMonthsPerSecond: 1_000_000, personalMonthsPerSecond: 1_000_000, transitionSeconds: 0.2, quietRampSeconds: 0, eventMemoryMonths: 0 },
  },
  /** Pacing-only acceleration for automated checks. Historical rules, rates, and horizon are untouched. */
  'fast-test': {
    simulation: { maxTicksPerFrame: 480 },
    presentation: { quietMonthsPerSecond: 1_000_000, ordinaryMonthsPerSecond: 1_000_000, significantMonthsPerSecond: 1_000_000, momentousMonthsPerSecond: 1_000_000, personalMonthsPerSecond: 1_000_000, transitionSeconds: 0.2, quietRampSeconds: 0, eventMemoryMonths: 0, deepTimeAcceleration: 1 },
  },
  fast: {
    camera: { shotSeconds: [7, 12], transitionSeconds: 2.5 },
    simulation: { maxTicksPerFrame: 60 },
    presentation: { quietMonthsPerSecond: 96, ordinaryMonthsPerSecond: 30, significantMonthsPerSecond: 8, momentousMonthsPerSecond: 4, personalMonthsPerSecond: 10, transitionSeconds: 2, quietRampSeconds: 8, eventMemoryMonths: 8, deepTimeAcceleration: 8 },
  },
  normal: {
    camera: { shotSeconds: [13, 22], transitionSeconds: 6 },
    presentation: { quietMonthsPerSecond: 7.2, ordinaryMonthsPerSecond: 2.4, significantMonthsPerSecond: 0.72, momentousMonthsPerSecond: 0.36, personalMonthsPerSecond: 0.9, transitionSeconds: 4.5, quietRampSeconds: 40, eventMemoryMonths: 16, deepTimeAcceleration: 6 },
  },
  'long-observation': {
    camera: { shotSeconds: [20, 34], transitionSeconds: 8 },
    simulation: { maxTicksPerFrame: 8 },
    presentation: { quietMonthsPerSecond: 4, ordinaryMonthsPerSecond: 1.2, significantMonthsPerSecond: 0.3, momentousMonthsPerSecond: 0.15, personalMonthsPerSecond: 0.5, transitionSeconds: 6, quietRampSeconds: 90, eventMemoryMonths: 24, deepTimeAcceleration: 10 },
  },
};

export function presetConfig(name: GodboxPresetName, overrides: GodboxConfigInput = {}): GodboxConfigInput {
  const preset = GODBOX_PRESETS[name];
  return {
    ...preset,
    ...overrides,
    simulation: { ...preset.simulation, ...overrides.simulation },
    world: { ...preset.world, ...overrides.world },
    camera: { ...preset.camera, ...overrides.camera },
    presentation: { ...preset.presentation, ...overrides.presentation },
    experiment: { ...preset.experiment, ...overrides.experiment },
    society: { ...preset.society, ...overrides.society },
    historicalPace: { ...preset.historicalPace, ...overrides.historicalPace },
    render: { ...preset.render, ...overrides.render },
    audio: { ...preset.audio, ...overrides.audio },
    knowledge: { ...preset.knowledge, ...overrides.knowledge },
    advanced: { ...preset.advanced, ...overrides.advanced },
  };
}

export function timePresetConfig(name: GodboxTimePresetName, overrides: GodboxConfigInput = {}): GodboxConfigInput {
  const preset = GODBOX_TIME_PRESETS[name];
  return {
    ...preset,
    ...overrides,
    simulation: { ...preset.simulation, ...overrides.simulation },
    world: { ...preset.world, ...overrides.world },
    camera: { ...preset.camera, ...overrides.camera },
    presentation: { ...preset.presentation, ...overrides.presentation },
    experiment: { ...preset.experiment, ...overrides.experiment },
    society: { ...preset.society, ...overrides.society },
    historicalPace: { ...preset.historicalPace, ...overrides.historicalPace },
    render: { ...preset.render, ...overrides.render },
    audio: { ...preset.audio, ...overrides.audio },
    knowledge: { ...preset.knowledge, ...overrides.knowledge },
    advanced: { ...preset.advanced, ...overrides.advanced },
  };
}
