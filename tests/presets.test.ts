import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { GODBOX_PRESETS, GODBOX_TIME_PRESETS, presetConfig, timePresetConfig } from '../src/presets';
import { Simulation } from '../src/sim/Simulation';

describe('Configuration presets', () => {
  it('changes conditions without carrying scripted history', () => {
    expect(Object.keys(GODBOX_PRESETS)).toEqual(['default', 'abundant-world', 'scarcity', 'archipelago', 'unstable-climate', 'fragmented-politics', 'highly-connected-world']);
    for (const preset of Object.values(GODBOX_PRESETS)) {
      expect(preset).not.toHaveProperty('history');
      expect(preset).not.toHaveProperty('outcome');
      expect(preset).not.toHaveProperty('events');
    }
  });

  it('merges preset conditions with deliberate local overrides', () => {
    const abundant = configWith(presetConfig('abundant-world', { world: { seaLevel: 0.4 } }));
    expect(abundant.world.resourceAbundance).toBe(1.35);
    expect(abundant.world.seaLevel).toBe(0.4);
    const connected = new Simulation(presetConfig('highly-connected-world', { seed: 'connected-preset' }));
    expect(connected.config.society.tradeConnectivity).toBe(1.45);
    expect(connected.config.knowledge.diffusionRate).toBe(1.3);
  });

  it('offers config-only viewing cadences without changing historical process rates', () => {
    expect(Object.keys(GODBOX_TIME_PRESETS)).toEqual(['documentary', 'slow-observer', 'default', 'accelerated-experiment', 'batch/headless', 'fast-test', 'fast', 'normal', 'long-observation']);
    const documentary = configWith(timePresetConfig('documentary'));
    const accelerated = configWith(timePresetConfig('accelerated-experiment'));
    expect(documentary.presentation.ordinaryMonthsPerSecond * 5).toBeGreaterThanOrEqual(5);
    expect(documentary.presentation.ordinaryMonthsPerSecond * 5).toBeLessThanOrEqual(15);
    expect(accelerated.presentation.quietMonthsPerSecond).toBeGreaterThan(documentary.presentation.quietMonthsPerSecond);
    expect(accelerated.historicalPace).toEqual(documentary.historicalPace);
    expect(accelerated.knowledge).toEqual(documentary.knowledge);
  });
});
