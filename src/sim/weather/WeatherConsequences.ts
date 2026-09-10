import { practical } from '../knowledge/KnowledgeSystem';
import type { HistoricalEvent, Settlement, SimulationState, TornadoState } from '../types';
import { tornadoDamage, tornadoExposure } from './Tornado';
import { DANGEROUS_WATER_DEPTH, waterDepthAt } from '../terrain/SurfaceGeometry';

type WeatherEvent = Omit<HistoricalEvent, 'id' | 'month'>;

/** Runs on the environment tick. Damage is retained in the existing repair/reconstruction systems. */
export function applyFloodConsequences(state: SimulationState, months = 1): WeatherEvent[] {
  const events: WeatherEvent[] = [];
  if (months <= 0) return events;
  for (const settlement of state.settlements) {
    if (!settlement.alive) continue;
    let damaged = 0;
    let destroyed = 0;
    let newlyRestricted = 0;
    const resilience = 1 + practical(settlement, 'stone-composites') * 0.8;
    for (const plot of settlement.structurePlots ?? []) {
      let depth = 0;
      // Sample the footprint, not the settlement centre; high foundations remain safe.
      for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
        depth = Math.max(depth, waterDepthAt(state.world, plot.worldX + x * plot.width / 2, plot.worldZ + z * plot.depth / 2));
      }
      plot.floodDepth = depth;
      plot.floodMonths = depth >= DANGEROUS_WATER_DEPTH ? (plot.floodMonths ?? 0) + months : 0;
      const before = plot.condition;
      // Brief wetting leaves access and soil effects; prolonged or deep immersion damages fabric.
      const exposure = Math.max(0, depth - DANGEROUS_WATER_DEPTH);
      const severe = 1 + Math.max(0, depth - 0.45) * 2;
      const loss = exposure * (0.035 + Math.min(3, plot.floodMonths) * 0.035) * severe * months / resilience;
      if (loss > 0 && before > 0) {
        plot.condition = Math.max(0, before - loss);
        if (plot.condition < 0.15) plot.condition = 0;
        plot.damagedMonth = state.month;
        settlement.weatherRecoverySince ??= state.month;
        damaged++;
        if (plot.condition === 0) destroyed++;
      }
      const restricted = depth > 0.06 || plot.condition < 0.65 || Boolean(plot.fire);
      if (restricted && !plot.accessRestricted) newlyRestricted++;
      plot.accessRestricted = restricted;
    }
    if (newlyRestricted || destroyed) events.push({ type: 'natural-catastrophe', location: settlement.position,
      locationId: settlement.id, actors: [settlement.id], causes: ['prolonged-runoff', 'flooding'],
      affectedPopulation: 0, magnitude: Math.min(1, newlyRestricted / Math.max(1, settlement.buildings)),
      context: { damagedStructures: damaged, destroyedStructures: destroyed, restrictedStructures: newlyRestricted },
      outcome: 'Residents leave unsafe buildings. Flood damage requires labor and materials after the water recedes.',
      significance: Math.min(0.9, 0.45 + destroyed * 0.1), tags: ['weather', 'flood', 'local-damage'],
      summary: `Flooding restricts ${newlyRestricted} structures in ${settlement.name}; ${damaged} are damaged and ${destroyed} destroyed.` });
  }
  let damagedSegments = 0;
  const damagedSegmentIds = new Set<string>();
  for (const segment of Object.values(state.transportation.segments)) {
    if (segment.mode === 'water' || segment.status === 'planned') continue;
    let depth = 0;
    // Surveyed points are already densely spaced; use deck height so bridges protect routes.
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1]!;
      const b = segment.points[i]!;
      const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (state.world.terrain.step / 2)));
      for (let j = 0; j <= samples; j++) {
        const t = j / samples;
        depth = Math.max(depth, waterDepthAt(state.world, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, a.y + (b.y - a.y) * t));
      }
    }
    segment.floodDepth = depth;
    segment.floodMonths = depth >= DANGEROUS_WATER_DEPTH ? (segment.floodMonths ?? 0) + months : 0;
    const loss = Math.max(0, depth - 0.16) * (0.12 + Math.min(3, segment.floodMonths) * 0.12) * months;
    if (loss <= 0 || segment.work <= 0) continue;
    if (segment.status === 'complete') { damagedSegments++; damagedSegmentIds.add(segment.id); }
    segment.work = Math.max(0, segment.work - segment.cost * loss);
    segment.status = 'under-construction';
    segment.damagedMonth = state.month;
    state.transportation.revision++;
  }
  const owners = [...new Set(Object.values(state.transportation.projects)
    .filter(project => project.segmentIds.some(id => damagedSegmentIds.has(id))).flatMap(project => [project.a, project.b]))];
  if (damagedSegments) events.push({ type: 'natural-catastrophe', actors: owners.length ? owners : [...damagedSegmentIds], causes: ['flooding'],
    affectedPopulation: 0, magnitude: Math.min(1, damagedSegments * 0.1),
    context: { damagedSegments }, outcome: 'Flood-damaged routes need reconstruction before service resumes.',
    significance: 0.55, tags: ['weather', 'flood', 'transport'], summary: `Flooding damages ${damagedSegments} transport segments.` });
  return events;
}

export function applyTornadoConsequences(state: SimulationState, tornado: TornadoState): WeatherEvent[] {
  const events: WeatherEvent[] = [];
  for (const settlement of state.settlements.filter((entry) => entry.alive)) {
    let damaged = 0;
    let destroyed = 0;
    const resilience = practical(settlement, 'stone-composites') * 0.6 + settlement.infrastructure.workshops * 0.2;
    for (const plot of settlement.structurePlots ?? []) {
      const exposure = tornadoExposure(tornado, { x: plot.worldX, z: plot.worldZ }, plot.radius);
      const loss = tornadoDamage(tornado, exposure, resilience);
      if (loss <= 0.02 || plot.condition === 0) continue;
      const before = plot.condition;
      plot.condition = Math.max(0, before - loss);
      if (plot.condition < 0.15) plot.condition = 0;
      plot.damagedMonth = state.month;
      damaged += 1;
      if (plot.condition === 0) destroyed += 1;
    }
    if (!damaged) continue;
    settlement.weatherRecoverySince ??= state.month;
    events.push({ type: 'natural-catastrophe', location: tornado.path[0], locationId: settlement.id,
      actors: [settlement.id], causes: ['severe-thunderstorm', 'tornado-path'],
      context: { weatherEventId: tornado.id, damagedStructures: damaged, destroyedStructures: destroyed, intensity: tornado.intensity },
      outcome: 'Exposed structures require repair with local labor and materials.', affectedPopulation: 0,
      magnitude: tornado.intensity, significance: Math.min(0.95, 0.5 + destroyed * 0.08 + damaged * 0.02),
      tags: ['weather', 'tornado', 'local-damage'],
      summary: `A tornado damages ${damaged} structures in ${settlement.name}; ${destroyed} are destroyed.` });
  }
  let damagedSegments = 0;
  for (const segment of Object.values(state.transportation.segments)) {
    if (segment.mode === 'water' || segment.status !== 'complete') continue;
    let exposure = 0;
    for (let index = 1; index < segment.points.length; index += 1) {
      const start = segment.points[index - 1]!;
      const end = segment.points[index]!;
      const samples = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / Math.max(0.05, tornado.width / 3)));
      for (let sample = 0; sample <= samples; sample += 1) {
        exposure = Math.max(exposure, tornadoExposure(tornado, { x: start.x + (end.x - start.x) * sample / samples,
          z: start.z + (end.z - start.z) * sample / samples }));
      }
    }
    const damage = tornadoDamage(tornado, exposure, segment.mode === 'rail' ? 0.7 : 0.35);
    if (damage < 0.08) continue;
    segment.work = Math.max(0, segment.cost * (1 - damage));
    segment.status = 'under-construction';
    damagedSegments += 1;
  }
  if (damagedSegments) {
    state.transportation.revision += 1;
    events.push({ type: 'natural-catastrophe', location: tornado.path[0], actors: [], causes: ['tornado-path'],
      context: { weatherEventId: tornado.id, damagedSegments }, outcome: 'Transport segments need reconstruction before service resumes.',
      affectedPopulation: 0, magnitude: tornado.intensity, significance: 0.6, tags: ['weather', 'tornado', 'transport'],
      summary: `A tornado disrupts ${damagedSegments} transport segments.` });
  }
  return events;
}

export function repairWeatherDamage(settlement: Settlement, builders: number, month: number): number {
  if (builders <= 0) return 0;
  let budget = Math.min(0.12, builders * 0.015);
  let repaired = 0;
  for (const plot of settlement.structurePlots ?? []) {
    if (plot.development && plot.development.status !== 'active') continue;
    if (plot.fire || plot.condition >= 1 || plot.damagedMonth === month || (plot.floodDepth ?? 0) > 0.06) continue;
    const work = Math.min(budget, 1 - plot.condition, settlement.resources.wood / 8, settlement.resources.minerals / 1.5);
    if (work <= 0) break;
    plot.condition = Math.min(1, plot.condition + work);
    plot.char = Math.max(0, (plot.char ?? 0) - work * 1.5);
    plot.accessRestricted = plot.condition < 0.65;
    settlement.resources.wood -= work * 8;
    settlement.resources.minerals -= work * 1.5;
    budget -= work;
    repaired += work;
    if (budget <= 0) break;
  }
  return repaired;
}
