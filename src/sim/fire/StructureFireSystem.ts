import { stableHash } from '../prng';
import { cellAt } from '../world';
import { practical } from '../knowledge/KnowledgeSystem';
import { disturbForest, modifyLand } from '../environment/EnvironmentalModificationSystem';
import type { FireCause, HistoricalEvent, Settlement, SimulationState, StructurePlot } from '../types';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export interface FireEnvironment { dryness: number; wind: number; windX: number; windZ: number; rain: number; snow: number; flood: number; suppression: number }
export function fireEnvironment(state: SimulationState, settlement: Settlement, plot: StructurePlot): FireEnvironment {
  const cell = cellAt(state.world, plot.worldX, plot.worldZ);
  const weather = cell && state.world.weather?.cells[cell.z * state.world.size + cell.x];
  const snow = weather?.snowFraction ?? (weather?.precipitation === 'snow' ? 1 : 0);
  const wet = weather && weather.precipitation !== 'none' ? weather.intensity : 0;
  return { dryness: 1 - (cell?.moisture ?? 0.5), wind: weather?.wind ?? 0,
    windX: weather?.windX ?? 1, windZ: weather?.windZ ?? 0, rain: wet * (1 - snow), snow: wet * snow,
    flood: Math.max(plot.floodDepth ?? 0, weather?.floodDepth ?? 0),
    suppression: settlement.alive ? clamp(0.08 + settlement.infrastructure.workshops * 0.12
      + practical(settlement, 'civic-administration') * 0.35 + practical(settlement, 'irrigation') * 0.25
      + (settlement.development?.informal.water ?? 0) * 0.015) : 0 };
}
export function fireVulnerability(plot: StructurePlot): number {
  const material = plot.development?.material ?? 'timber';
  return { timber: 1, earth: 0.75, masonry: 0.38, ceramic: 0.45, metal: 0.28 }[material];
}
/** The same deterministic entry point is used by causal simulation and isolated QA fixtures. */
export function igniteStructure(plot: StructurePlot, month: number, cause: FireCause, intensity = 0.12): boolean {
  if (plot.fire || plot.condition <= 0.05 || (plot.floodDepth ?? 0) > 0.12) return false;
  const fuel = (0.55 + fireVulnerability(plot) * 0.65) * plot.condition;
  plot.fire = { cause, startedMonth: month, age: 0, stage: 'ignition', intensity: clamp(intensity), fuel, initialFuel: fuel, smoulderMonths: 0 };
  plot.accessRestricted = true;
  return true;
}
/** Edge-to-edge distance, directional wind, fuel, moisture and response all matter. */
export function spreadRisk(source: StructurePlot, target: StructurePlot, env: FireEnvironment): number {
  if (!source.fire || source.fire.stage === 'smouldering' || target.fire || target.condition <= 0.05) return 0;
  const dx = target.worldX - source.worldX, dz = target.worldZ - source.worldZ;
  const distance = Math.hypot(dx, dz);
  const gap = Math.max(0, distance - source.radius - target.radius);
  if (gap > 12 || env.flood > 0.12) return 0;
  const downwind = distance > 0 ? Math.max(0, (dx * env.windX + dz * env.windZ) / distance) : 0;
  return clamp(0.24 * Math.exp(-gap / 3) * source.fire.intensity * fireVulnerability(target)
    * (0.18 + env.dryness * 1.5) * (1 + env.wind * (0.5 + downwind * 3))
    * (1 - env.suppression * 0.85) * (1 - env.rain * 0.95) * (1 - env.snow * 0.75));
}
export function advanceStructureFire(plot: StructurePlot, env: FireEnvironment, month: number, months = 1): void {
  const fire = plot.fire;
  if (!fire || months <= 0) return;
  fire.age += months;
  if (fire.stage === 'smouldering') {
    fire.smoulderMonths += months;
    fire.intensity *= 0.25 ** months;
    if (fire.smoulderMonths >= 2 || env.flood > 0.12) delete plot.fire;
  } else {
    const suppression = env.rain * 0.85 + env.snow * 0.5 + env.suppression * 0.55 + env.flood * 8;
    const growth = (0.28 + env.dryness * 0.2 + env.wind * 0.1) * fireVulnerability(plot);
    const exhausted = fire.fuel / fire.initialFuel < 0.32;
    fire.intensity = clamp(fire.intensity + (exhausted ? -0.35 : growth) * months - suppression * months);
    const consumed = Math.min(fire.fuel, (0.08 + fire.intensity * 0.3) * months);
    fire.fuel -= consumed;
    const damage = fire.intensity * (0.12 + fireVulnerability(plot) * 0.2) * months;
    plot.condition = Math.max(0, plot.condition - damage);
    if (plot.condition < 0.15) plot.condition = 0;
    plot.char = clamp((plot.char ?? 0) + damage * 1.8);
    plot.scorch = clamp((plot.scorch ?? 0) + damage * 1.3);
    if (damage > 0) plot.damagedMonth = month;
    fire.stage = exhausted ? 'weakening' : fire.intensity > 0.65 ? 'involved' : 'growing';
    if (fire.intensity < 0.04 || fire.fuel <= 0 || env.flood > 0.12) {
      fire.stage = 'smouldering'; fire.intensity = Math.min(0.09, fire.intensity);
      if (env.flood > 0.12) delete plot.fire;
    }
  }
  plot.accessRestricted = Boolean(plot.fire) || plot.condition < 0.65 || env.flood > 0.06;
}

type FireEvent = Omit<HistoricalEvent, 'id' | 'month'>;
export function advanceStructureFires(state: SimulationState, seed: string): FireEvent[] {
  const events: FireEvent[] = [];
  const sites = state.settlements.flatMap(settlement => (settlement.structurePlots ?? []).map(plot => ({ settlement, plot })));
  const existing = sites.filter(({ plot }) => plot.fire);
  const buckets = new Map<string, typeof sites>();
  for (const site of sites) {
    const key = `${Math.floor(site.plot.worldX / 20)}:${Math.floor(site.plot.worldZ / 20)}`;
    const bucket = buckets.get(key) ?? []; bucket.push(site); buckets.set(key, bucket);
  }
  const announce = (settlement: Settlement, plot: StructurePlot, cause: FireCause) => {
    events.push({ type: 'natural-catastrophe', location: { x: plot.worldX, z: plot.worldZ }, locationId: settlement.id,
      actors: [settlement.id, plot.id], causes: [cause, 'structure-fire'], significance: 0.6, magnitude: 0.4, affectedPopulation: 0,
      context: { plotId: plot.id, cause }, tags: ['fire', 'local-damage'],
      outcome: 'Access is closed while fire consumes the structure; damaged fabric requires repair.', summary: `A ${cause === 'spread' ? 'spreading' : cause} fire takes hold in ${settlement.name}.` });
  };
  // Spread reads a tick-start snapshot; iteration order cannot create an instantaneous chain reaction.
  for (const { plot: source } of existing) {
    const bx = Math.floor(source.worldX / 20), bz = Math.floor(source.worldZ / 20);
    for (let x = bx - 1; x <= bx + 1; x++) for (let z = bz - 1; z <= bz + 1; z++) {
      for (const { settlement, plot } of buckets.get(`${x}:${z}`) ?? []) {
        if (plot === source) continue;
        const risk = spreadRisk(source, plot, fireEnvironment(state, settlement, plot));
        if (risk > 0 && stableHash(`${seed}:spread:${state.month}:${source.id}:${plot.id}`) < risk && igniteStructure(plot, state.month, 'spread')) announce(settlement, plot, 'spread');
      }
    }
  }
  for (const { settlement, plot } of sites) {
    const env = fireEnvironment(state, settlement, plot);
    if (!plot.fire && plot.condition > 0.1 && settlement.alive) {
      let cause: FireCause = 'accident';
      let risk = (plot.development?.form === 'workshop' ? 0.0004 : 0.00012) * (0.2 + env.dryness) * fireVulnerability(plot);
      const strike = state.world.weather?.lightning?.find(s => s.month === state.month && Math.hypot(s.x - plot.worldX, s.z - plot.worldZ) < plot.radius + 1.5);
      const attack = state.history.some(e => e.type === 'battle' && state.month - e.month <= 1 && e.location && Math.hypot(e.location.x - plot.worldX, e.location.z - plot.worldZ) < 12);
      if (strike) { cause = 'lightning'; risk += 0.55 * env.dryness; }
      else if (attack) { cause = 'attack'; risk += 0.035 * env.dryness; }
      risk *= (1 - env.suppression) * (1 - env.rain * 0.9) * (1 - env.snow * 0.7);
      if (env.flood < 0.06 && stableHash(`${seed}:ignition:${state.month}:${plot.id}`) < risk && igniteStructure(plot, state.month, cause)) announce(settlement, plot, cause);
    }
    if (plot.fire && plot.fire.startedMonth < state.month) advanceStructureFire(plot, env, state.month);
    if (plot.fire) {
      settlement.weatherRecoverySince ??= state.month;
      const cell = cellAt(state.world, plot.worldX, plot.worldZ);
      if (cell && !cell.water) {
        const damage = plot.fire.intensity * env.dryness * 0.006;
        cell.wood *= 1 - damage;
        disturbForest(cell, damage, state.month);
        modifyLand(cell, 'ruin', (cell.modifications?.ruin?.intensity ?? 0) + damage, state.month, settlement.id);
      }
    }
    if (plot.condition === 0 && plot.development && plot.development.status !== 'ruin') {
      const d = plot.development;
      d.status = 'ruin';
      d.history.push({ month: state.month, action: 'ruined', name: d.name, need: d.need, cultureId: d.cultureId, reasons: ['structure-fire'] });
      d.history = d.history.slice(-12); d.transitionCount++;
      if (settlement.development) settlement.development.revision++;
    }
    if (!plot.fire && plot.scorch) plot.scorch *= 0.999; // decades, not a renderer timeout
  }
  return events;
}
