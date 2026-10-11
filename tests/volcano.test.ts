import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { advanceVolcano, createVolcano } from '../src/sim/environment/VolcanoSystem';
import { ashExposure, lavaExposure, traceLavaFlow, volcanoChannels } from '../src/sim/environment/VolcanoFootprint';
import { surfaceHeightAt } from '../src/sim/terrain/SurfaceGeometry';

function fixture(seed = 'volcano-cone') {
  return new Simulation({ seed, startingPopulation: 40, world: { size: 24 }, settlementCount: [2, 2] }).state;
}

describe('Volcano system', () => {
  it('selects a site and schedules the first eruption 200-500 years out', () => {
    const simulation = new Simulation({ seed: 'volcano-site', startingPopulation: 40, world: { size: 24 }, settlementCount: [2, 2] });
    const volcano = simulation.state.volcano;
    expect(volcano).toBeDefined();
    expect(volcano!.phase).toBe('dormant');
    const years = volcano!.nextEruptionMonth / 12;
    expect(years).toBeGreaterThanOrEqual(200);
    expect(years).toBeLessThanOrEqual(500);
  });

  it('vents a constant, non-zero baseline plume even while dormant', () => {
    const simulation = new Simulation({ seed: 'volcano-baseline', startingPopulation: 40, world: { size: 24 }, settlementCount: [2, 2] });
    const volcano = simulation.state.volcano!;
    volcano.nextEruptionMonth = 999999;
    for (let i = 0; i < 6; i++) advanceVolcano(simulation.state, volcano, simulation.state.seed);
    expect(volcano.phase).toBe('dormant');
    expect(volcano.activity).toBeGreaterThan(0);
  });

  it('erupts, ruins nearby structures, and schedules the next eruption centuries later', () => {
    const simulation = new Simulation({ seed: 'volcano-erupt', startingPopulation: 40, world: { size: 24 }, settlementCount: [2, 2] });
    const volcano = simulation.state.volcano!;
    const settlement = simulation.state.settlements[0]!;
    settlement.structurePlots ??= [];
    const plot = {
      id: 'volcano-test-plot', worldX: volcano.worldX, worldZ: volcano.worldZ,
      radius: 1, width: 1, height: 1, depth: 1, condition: 1, foundedMonth: 0,
    };
    settlement.structurePlots.push(plot);

    volcano.nextEruptionMonth = simulation.state.month;
    const beginEvents = advanceVolcano(simulation.state, volcano, simulation.state.seed);
    expect(volcano.phase).toBe('erupting');
    expect(beginEvents.some((event) => event.tags.includes('eruption-begins'))).toBe(true);

    for (let i = 0; i < volcano.eruptionMonths; i++) {
      simulation.state.month += 1;
      advanceVolcano(simulation.state, volcano, simulation.state.seed);
    }
    expect(plot.condition).toBeLessThan(1);
    expect(volcano.phase).toBe('cooling');
    expect(volcano.totalEruptions).toBe(1);
    const restYears = (volcano.nextEruptionMonth - volcano.lastEruptionMonth!) / 12;
    expect(restYears).toBeGreaterThanOrEqual(200);
    expect(restYears).toBeLessThanOrEqual(500);
  });

  it('sculpts a crater into the terrain itself at the volcano site', () => {
    const simulation = new Simulation({ seed: 'volcano-cone', startingPopulation: 40, world: { size: 24 }, settlementCount: [2, 2] });
    const { terrain, volcanicVent } = simulation.state.world;
    expect(volcanicVent).toBeDefined();
    const sample = (x: number, z: number) => {
      const gx = Math.round((x - terrain.originX) / terrain.step), gz = Math.round((z - terrain.originZ) / terrain.step);
      return terrain.height[gz * terrain.resolution + gx]!;
    };
    const centre = sample(volcanicVent!.worldX, volcanicVent!.worldZ);
    const rim = sample(volcanicVent!.worldX + volcanicVent!.craterRadius, volcanicVent!.worldZ);
    const flank = sample(volcanicVent!.worldX + volcanicVent!.coneRadius * 0.6, volcanicVent!.worldZ);
    expect(centre).toBeLessThan(rim);
    expect(flank).toBeLessThan(rim);
    expect(simulation.state.volcano!.worldX).toBe(volcanicVent!.worldX);
  });

  it('creates no volcano when world generation found no site', () => {
    const simulation = new Simulation({ seed: 'volcano-none', startingPopulation: 40, world: { size: 24 }, settlementCount: [2, 2] });
    expect(createVolcano({ ...simulation.state.world, volcanicVent: undefined }, 'volcano-none')).toBeUndefined();
  });

  it('runs one complete eruption through the real monthly simulation and historical event stream', () => {
    const simulation = new Simulation({ seed: 'volcano-cone', world: { size: 24 }, startingPopulation: 40, settlementCount: [2, 2] });
    simulation.state.volcano!.nextEruptionMonth = 2;
    simulation.state.volcano!.eruptionMonths = 6;
    simulation.step(32);
    const volcano = simulation.state.volcano!;
    expect(volcano.phase).toBe('dormant');
    expect(volcano.totalEruptions).toBe(1);
    expect(simulation.state.history.filter(event => event.tags.includes('eruption-begins'))).toHaveLength(1);
    expect(simulation.state.history.filter(event => event.tags.includes('eruption-ends'))).toHaveLength(1);
    for (const cell of simulation.state.world.cells) {
      expect(cell.fertility).toBeGreaterThanOrEqual(0); expect(cell.fertility).toBeLessThanOrEqual(1);
      expect(cell.habitability).toBeGreaterThanOrEqual(0); expect(cell.habitability).toBeLessThanOrEqual(1);
    }
  }, 20_000);

  it('applies damage on the first eruption month, exactly once, and never on the cooling boundary', () => {
    const state = fixture();
    const volcano = state.volcano!;
    const plot = { id: 'vent', worldX: volcano.worldX, worldZ: volcano.worldZ, radius: 1,
      width: 1, height: 1, depth: 1, condition: 1, foundedMonth: 0 };
    state.settlements[0]!.structurePlots = [plot];
    volcano.nextEruptionMonth = 0;
    volcano.eruptionMonths = 6;
    const events = advanceVolcano(state, volcano, state.seed);
    expect(plot.condition).toBeLessThan(1);
    expect(events.find(event => event.tags.includes('eruption-begins'))!.actors).toContain(state.settlements[0]!.id);
    const condition = plot.condition;
    expect(advanceVolcano(state, volcano, state.seed)).toEqual([]);
    expect(plot.condition).toBe(condition);
    for (state.month = 1; state.month < 6; state.month++) advanceVolcano(state, volcano, state.seed);
    const lastCondition = plot.condition;
    const end = advanceVolcano(state, volcano, state.seed);
    expect(volcano.phase).toBe('cooling');
    expect(plot.condition).toBe(lastCondition);
    expect(end.filter(event => event.tags.includes('eruption-ends'))).toHaveLength(1);
    for (state.month = 7; state.month < 30; state.month++) advanceVolcano(state, volcano, state.seed);
    expect(volcano.phase).toBe('cooling');
    advanceVolcano(state, volcano, state.seed);
    expect(volcano.phase).toBe('dormant');
    expect(volcano.activity).toBeCloseTo(0.16);
  });

  it('recovers ash losses over ten years, preserves unrelated damage, and slowly releases nutrients', () => {
    const state = fixture();
    const volcano = state.volcano!;
    const cellIndex = state.world.cells.findIndex(cell => !cell.water);
    const cell = state.world.cells[cellIndex]!;
    cell.worldX = volcano.worldX; cell.worldZ = volcano.worldZ;
    cell.fertility = 0.5; cell.habitability = 0.6;
    volcano.nextEruptionMonth = 0; volcano.eruptionMonths = 6;
    for (state.month = 0; state.month < 6; state.month++) advanceVolcano(state, volcano, state.seed);
    expect(cell.fertility).toBeLessThan(0.5);
    expect(cell.habitability).toBeLessThan(0.6);
    const nutrients = volcano.deposits!.find(deposit => deposit.cellIndex === cellIndex)!.nutrients;
    cell.habitability -= 0.1; // An independent catastrophe must not be undone by recovery.
    advanceVolcano(state, volcano, state.seed);
    expect(cell.fertility).toBeLessThan(0.5); // No instant fertilizer jump at eruption end.
    for (state.month = 7; state.month < 126; state.month++) advanceVolcano(state, volcano, state.seed);
    expect(cell.habitability).toBeCloseTo(0.5, 8);
    expect(cell.fertility).toBeCloseTo(0.5 + nutrients, 8);
    expect(volcano.deposits).toHaveLength(0);
  });

  it('never fertilizes water or increases infertile land during ashfall', () => {
    const state = fixture();
    const volcano = state.volcano!;
    const [water, land] = state.world.cells;
    for (const cell of [water!, land!]) {
      cell.worldX = volcano.worldX; cell.worldZ = volcano.worldZ;
      cell.fertility = 0; cell.habitability = 0;
    }
    water!.water = true; land!.water = false;
    volcano.nextEruptionMonth = 0;
    advanceVolcano(state, volcano, state.seed);
    expect(water!.fertility).toBe(0); expect(land!.fertility).toBe(0);
    expect(volcano.deposits!.some(deposit => deposit.cellIndex === 0)).toBe(false);
  });

  it('resumes identical consequences after serializable state is restored mid-eruption', () => {
    const state = fixture();
    state.volcano!.nextEruptionMonth = 0;
    for (state.month = 0; state.month < 4; state.month++) advanceVolcano(state, state.volcano!, state.seed);
    const restored = structuredClone(state);
    // Archive metadata is ordinary JSON; terrain buffers are retained by the world snapshot.
    restored.volcano = JSON.parse(JSON.stringify(state.volcano));
    for (let month = 4; month < 150; month++) {
      state.month = restored.month = month;
      expect(advanceVolcano(restored, restored.volcano!, restored.seed)).toEqual(advanceVolcano(state, state.volcano!, state.seed));
    }
    expect(restored.volcano).toEqual(state.volcano);
    expect(restored.world.cells).toEqual(state.world.cells);
  });

  it('keeps geometry and consequences independent of when the renderer first asks for channels', () => {
    const state = fixture();
    const restored = structuredClone(state.world);
    const original = volcanoChannels(state.world, state.seed);
    restored.terrain.waterLevel.fill(10); // Transient flood stage must not affect cached flow geometry.
    expect(volcanoChannels(restored, state.seed)).toEqual(original);
    expect(original.length).toBeGreaterThan(0);
    for (const channel of original) for (let i = 1; i < channel.points.length; i++) {
      const a = channel.points[i - 1]!, b = channel.points[i]!;
      expect(surfaceHeightAt(state.world, b.x, b.z)).toBeLessThan(surfaceHeightAt(state.world, a.x, a.z));
    }
  });
});

describe('Volcano footprints', () => {
  it('stops lava in a depression instead of climbing uphill', () => {
    const points = traceLavaFlow({ heightAt: (x, z) => (x - 3) ** 2 + z ** 2, blockedAt: () => false }, { x: 0, z: 0 }, 0, 20);
    expect(points.length).toBeGreaterThan(3);
    expect(points.at(-1)!.x).toBeCloseTo(3);
    expect(points.length).toBeLessThan(10);
  });

  it('stops at water and boundaries without pushing a point inside', () => {
    const points = traceLavaFlow({ heightAt: x => -x, blockedAt: x => x >= 2 }, { x: 0, z: 0 }, 0, 20);
    expect(points.every(point => point.x < 2)).toBe(true);
    expect(points.at(-1)!.x).toBeGreaterThan(1);
  });

  it('restricts lava damage to the advancing channel and includes structure footprints', () => {
    const channels = [{ points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], width: 2 }];
    expect(lavaExposure(channels, 2, 0, 0)).toBe(0);
    expect(lavaExposure(channels, 2, 0, 0.5)).toBe(1);
    expect(lavaExposure(channels, 8, 0, 0.5)).toBe(0);
    expect(lavaExposure(channels, 2, 2, 1)).toBe(0);
    expect(lavaExposure(channels, 2, 2, 1, 2)).toBeGreaterThan(0);
  });

  it('stretches fallout downwind and rotates consistently with the plume', () => {
    const east = { x: 1, z: 0, strength: 1 }, north = { x: 0, z: 1, strength: 1 };
    expect(ashExposure(20, 0, 4.5, east)).toBeGreaterThan(ashExposure(-20, 0, 4.5, east));
    expect(ashExposure(20, 0, 4.5, east)).toBeCloseTo(ashExposure(0, 20, 4.5, north));
    expect(ashExposure(8, 0, 4.5, { ...east, strength: 0 })).toBeCloseTo(ashExposure(-8, 0, 4.5, { ...east, strength: 0 }));
    expect(ashExposure(1000, 0, 4.5, east)).toBe(0);
  });
});
