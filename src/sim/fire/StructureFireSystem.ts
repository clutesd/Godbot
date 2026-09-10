import { SeededRandom } from '../prng';
import type { Settlement, SimulationState, StructurePlot, WeatherCellState, WorldState } from '../types';

export type StructureFireCause = 'lightning' | 'wildfire' | 'war' | 'sabotage' | 'accident' | 'spread';

export interface StructureFireSnapshot {
  id: string;
  settlementId: string;
  plotId: string;
  cause: StructureFireCause;
  originCause: Exclude<StructureFireCause, 'spread'>;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  height: number;
  intensity: number;
  fuel: number;
  ageMonths: number;
  char: number;
  startedMonth: number;
}

export interface StructureFireScarSnapshot {
  plotId: string;
  settlementId: string;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  severity: number;
  burnedMonth: number;
}

interface ActiveStructureFire extends StructureFireSnapshot {
  lastDamage: number;
}

interface FireRuntime {
  lastAdvancedMonth: number;
  fires: Map<string, ActiveStructureFire>;
  scars: Map<string, StructureFireScarSnapshot>;
}

const runtimes = new WeakMap<WorldState, FireRuntime>();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function runtimeFor(world: WorldState): FireRuntime {
  let runtime = runtimes.get(world);
  if (!runtime) {
    runtime = { lastAdvancedMonth: -1, fires: new Map(), scars: new Map() };
    runtimes.set(world, runtime);
  }
  return runtime;
}

function weatherAt(state: SimulationState, settlement: Settlement): WeatherCellState | undefined {
  return state.weather.cells[settlement.cellIndex];
}

function cellMoisture(state: SimulationState, settlement: Settlement): number {
  return clamp01(state.world.cells[settlement.cellIndex]?.moisture ?? 0.5);
}

function responseCapacity(settlement: Settlement): number {
  const workshops = clamp01(settlement.infrastructure.workshops * 0.12);
  const power = clamp01(settlement.infrastructure.power * 0.16);
  const urban = clamp01(settlement.urbanization) * 0.24;
  const scale = clamp01(settlement.buildings / 90) * 0.16;
  return clamp01(0.06 + workshops + power + urban + scale);
}

function structureVulnerability(settlement: Settlement, plot: StructurePlot): number {
  // The current structure model does not yet expose per-building material composition. Treat
  // early dispersed fabric as more combustible while allowing mature infrastructure to reduce
  // vulnerability. Existing damage also makes fire progression less predictable and easier to
  // collapse.
  const industrial = clamp01(settlement.industry.intensity);
  const maturity = clamp01(
    settlement.urbanization * 0.35
    + settlement.infrastructure.power * 0.06
    + settlement.infrastructure.bridges * 0.025
    + settlement.infrastructure.workshops * 0.035,
  );
  const damaged = clamp01(1 - plot.condition);
  return Math.max(0.35, Math.min(1.25, 0.88 - maturity * 0.28 + industrial * 0.12 + damaged * 0.15));
}

function activeWarAt(state: SimulationState, settlement: Settlement) {
  return state.wars.find((war) => war.active && (war.attacker === settlement.id || war.defender === settlement.id));
}

function hostilityAt(state: SimulationState, settlement: Settlement): number {
  let pressure = 0;
  for (const relation of state.relations) {
    if (relation.a !== settlement.id && relation.b !== settlement.id) continue;
    pressure = Math.max(pressure, clamp01(relation.hostility * 0.7 + relation.grievances * 0.3));
  }
  return pressure;
}

function chooseIgnitionPlot(settlement: Settlement, random: SeededRandom): StructurePlot | undefined {
  const plots = (settlement.structurePlots ?? []).filter((plot) => plot.condition > 0.03 && !runtimeForFirePlot(plot));
  if (!plots.length) return undefined;
  const weights = plots.map((plot) => 0.5 + Math.min(1.5, plot.width * 0.15) + (1 - plot.condition) * 0.25);
  return plots[random.weightedIndex(weights)];
}

// A very small indirection lets chooseIgnitionPlot remain cheap while a runtime is advancing.
// It is rebound only during that synchronous advance call.
let advancingFirePlots: ReadonlySet<string> | undefined;
const runtimeForFirePlot = (plot: StructurePlot): boolean => advancingFirePlots?.has(plot.id) ?? false;

function beginFire(
  state: SimulationState,
  settlement: Settlement,
  plot: StructurePlot,
  cause: StructureFireCause,
  intensity: number,
  originCause: Exclude<StructureFireCause, 'spread'>,
): ActiveStructureFire {
  const runtime = runtimeFor(state.world);
  const existing = runtime.fires.get(plot.id);
  if (existing) {
    existing.intensity = Math.max(existing.intensity, clamp01(intensity));
    existing.fuel = Math.min(1.35, existing.fuel + 0.12);
    return existing;
  }
  const random = new SeededRandom(`${state.seed}:structure-fire:${plot.id}:${state.month}:${cause}`);
  const initialChar = Math.max(0, 1 - plot.condition);
  const fire: ActiveStructureFire = {
    id: `fire:${plot.id}:${state.month}`,
    settlementId: settlement.id,
    plotId: plot.id,
    cause,
    originCause,
    worldX: plot.worldX,
    worldZ: plot.worldZ,
    width: plot.width,
    depth: plot.depth,
    height: plot.height,
    intensity: Math.max(0.08, clamp01(intensity)),
    fuel: Math.min(1.35, 0.58 + Math.min(0.42, plot.width * 0.12) + random.range(0.05, 0.22)),
    ageMonths: 0,
    char: initialChar,
    startedMonth: state.month,
    lastDamage: 0,
  };
  runtime.fires.set(plot.id, fire);
  plot.accessRestricted = true;
  runtime.scars.set(plot.id, {
    plotId: plot.id,
    settlementId: settlement.id,
    worldX: plot.worldX,
    worldZ: plot.worldZ,
    width: plot.width,
    depth: plot.depth,
    severity: Math.max(0.05, initialChar),
    burnedMonth: state.month,
  });
  return fire;
}

export function igniteStructureFire(
  state: SimulationState,
  settlementId: string,
  plotId: string,
  cause: Exclude<StructureFireCause, 'spread'> = 'accident',
  intensity = 0.55,
): boolean {
  const settlement = state.settlements.find((entry) => entry.id === settlementId && entry.alive);
  const plot = settlement?.structurePlots?.find((entry) => entry.id === plotId && entry.condition > 0.03);
  if (!settlement || !plot) return false;
  beginFire(state, settlement, plot, cause, intensity, cause);
  return true;
}

function attemptAmbientIgnition(state: SimulationState, settlement: Settlement): void {
  if (!settlement.alive || !(settlement.structurePlots?.some((plot) => plot.condition > 0.03))) return;
  const weather = weatherAt(state, settlement);
  const worldCell = state.world.cells[settlement.cellIndex];
  const moisture = cellMoisture(state, settlement);
  const dryness = clamp01((0.48 - moisture) * 1.7 + Math.max(0, (weather?.temperature ?? worldCell?.temperature ?? 0.5) - 0.55) * 0.75);
  const rain = weather?.precipitation === 'rain' ? clamp01(weather.intensity) : 0;
  const wind = clamp01(weather?.wind ?? 0);
  const thunder = weather?.kind === 'thunderstorm' ? clamp01(weather.intensity) : 0;
  const war = activeWarAt(state, settlement);
  const warPressure = war
    ? war.phase === 'battle' ? 1
      : war.phase === 'occupation' ? 0.78
        : war.phase === 'retreat' ? 0.52
          : war.phase === 'marching' ? 0.28
            : 0.12
    : 0;
  const hostility = hostilityAt(state, settlement);
  const sabotagePressure = clamp01(settlement.conflictPressure * 0.68 + hostility * 0.52);
  const industrialHazard = clamp01(
    settlement.industry.intensity * 0.65
    + settlement.infrastructure.factories * 0.14
    + settlement.infrastructure.workshops * 0.045
    + settlement.urbanization * 0.14,
  );
  const forestExposure = worldCell?.biome === 'forest' ? 1 : worldCell?.biome === 'grassland' || worldCell?.biome === 'dryland' ? 0.55 : 0.16;
  const random = new SeededRandom(`${state.seed}:fire-ignition:${state.month}:${settlement.id}`);

  const candidates: Array<{ cause: Exclude<StructureFireCause, 'spread'>; probability: number; intensity: number }> = [
    { cause: 'war', probability: 0.02 * warPressure * (0.72 + dryness * 0.28), intensity: 0.62 + warPressure * 0.28 },
    { cause: 'lightning', probability: 0.0045 * thunder * (0.25 + dryness * 0.75) * (1 - rain * 0.65), intensity: 0.46 + thunder * 0.34 },
    { cause: 'wildfire', probability: 0.00038 * dryness * forestExposure * (0.45 + wind * 0.7), intensity: 0.42 + dryness * 0.34 },
    { cause: 'sabotage', probability: 0.00032 * sabotagePressure * (war ? 1.5 : 1), intensity: 0.48 + sabotagePressure * 0.3 },
    { cause: 'accident', probability: 0.0001 + 0.00145 * industrialHazard, intensity: 0.38 + industrialHazard * 0.36 },
  ];

  for (const candidate of candidates) {
    if (!random.chance(candidate.probability)) continue;
    const plot = chooseIgnitionPlot(settlement, random);
    if (plot) beginFire(state, settlement, plot, candidate.cause, candidate.intensity, candidate.cause);
    break;
  }
}

function spreadFromFire(state: SimulationState, fire: ActiveStructureFire, settlement: Settlement, plot: StructurePlot, months: number): void {
  if (fire.intensity < 0.24 || fire.fuel < 0.14) return;
  const weather = weatherAt(state, settlement);
  const rain = weather?.precipitation === 'rain' ? clamp01(weather.intensity) : 0;
  if (rain > 0.82) return;
  const moisture = cellMoisture(state, settlement);
  const dryFactor = 0.4 + (1 - moisture) * 0.65;
  const windX = weather?.windX ?? 0;
  const windZ = weather?.windZ ?? 0;
  const wind = clamp01(weather?.wind ?? 0);
  const targets = (settlement.structurePlots ?? [])
    .filter((target) => target.id !== plot.id && target.condition > 0.03 && !runtimeFor(state.world).fires.has(target.id))
    .map((target) => ({ target, distance: Math.hypot(target.worldX - plot.worldX, target.worldZ - plot.worldZ) - plot.radius - target.radius }))
    .filter(({ distance }) => distance <= 3.1)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  for (const { target, distance } of targets) {
    const dx = target.worldX - plot.worldX;
    const dz = target.worldZ - plot.worldZ;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const alignment = (dx / length) * windX + (dz / length) * windZ;
    const windBoost = 1 + Math.max(0, alignment) * wind * 1.05;
    const proximity = clamp01(1 - Math.max(0, distance) / 3.1);
    const probability = (0.02 + fire.intensity * 0.105) * proximity * windBoost * dryFactor * (1 - rain * 0.8) * months;
    const random = new SeededRandom(`${state.seed}:fire-spread:${state.month}:${fire.id}:${target.id}`);
    if (!random.chance(probability)) continue;
    beginFire(state, settlement, target, 'spread', Math.max(0.22, fire.intensity * 0.64), fire.originCause);
    break; // One new structure per source per month keeps chain reactions legible and bounded.
  }
}

function updateScar(runtime: FireRuntime, settlement: Settlement, plot: StructurePlot, fire: ActiveStructureFire, month: number): void {
  const scar = runtime.scars.get(plot.id) ?? {
    plotId: plot.id,
    settlementId: settlement.id,
    worldX: plot.worldX,
    worldZ: plot.worldZ,
    width: plot.width,
    depth: plot.depth,
    severity: 0,
    burnedMonth: month,
  };
  scar.severity = Math.max(scar.severity, clamp01(fire.char * 0.92 + fire.intensity * 0.18));
  scar.burnedMonth = month;
  runtime.scars.set(plot.id, scar);
}

export function advanceStructureFires(state: SimulationState, months = 1): void {
  if (state.month <= 0 || months <= 0) return;
  const runtime = runtimeFor(state.world);
  if (runtime.lastAdvancedMonth === state.month) return;
  runtime.lastAdvancedMonth = state.month;
  advancingFirePlots = new Set(runtime.fires.keys());
  try {
    for (const settlement of state.settlements) attemptAmbientIgnition(state, settlement);
  } finally {
    advancingFirePlots = undefined;
  }

  let changed = false;
  const current = [...runtime.fires.values()];
  for (const fire of current) {
    const settlement = state.settlements.find((entry) => entry.id === fire.settlementId);
    const plot = settlement?.structurePlots?.find((entry) => entry.id === fire.plotId);
    if (!settlement || !plot || !settlement.alive || plot.condition <= 0 && fire.fuel <= 0.03) {
      runtime.fires.delete(fire.plotId);
      continue;
    }
    const weather = weatherAt(state, settlement);
    const rain = weather?.precipitation === 'rain' ? clamp01(weather.intensity) : 0;
    const snow = weather?.precipitation === 'snow' ? clamp01(weather.intensity) : 0;
    const flood = clamp01((plot.floodDepth ?? 0) / 0.22);
    const response = responseCapacity(settlement);
    const wind = clamp01(weather?.wind ?? 0);
    const suppression = clamp01(rain * 0.68 + snow * 0.34 + flood * 0.9 + response * 0.42);
    const ventilation = 0.86 + wind * 0.3;
    const lowFuelPenalty = fire.fuel < 0.22 ? (0.22 - fire.fuel) * 0.7 : 0;
    fire.intensity = clamp01(fire.intensity + ((0.055 + fire.fuel * 0.045) * ventilation - suppression * 0.18 - lowFuelPenalty) * months);
    const consumed = Math.min(fire.fuel, (0.075 + fire.intensity * 0.15) * months);
    fire.fuel = Math.max(0, fire.fuel - consumed);
    fire.ageMonths += months;

    const vulnerability = structureVulnerability(settlement, plot);
    const loss = fire.intensity * (0.024 + consumed * 0.31) * vulnerability;
    fire.lastDamage = loss;
    if (loss > 0.001 && plot.condition > 0) {
      const before = plot.condition;
      plot.condition = Math.max(0, plot.condition - loss);
      if (plot.condition < 0.1) plot.condition = 0;
      plot.damagedMonth = state.month;
      plot.accessRestricted = true;
      settlement.weatherRecoverySince ??= state.month;
      fire.char = Math.max(fire.char, 1 - plot.condition);
      changed ||= plot.condition !== before;
    }
    updateScar(runtime, settlement, plot, fire, state.month);
    spreadFromFire(state, fire, settlement, plot, months);

    if (fire.fuel <= 0.015 || fire.intensity < 0.025 || flood >= 0.9) {
      runtime.fires.delete(fire.plotId);
      changed = true;
    }
  }

  // Fire scars outlive the flames, then fade as a structure is substantially repaired.
  for (const [plotId, scar] of runtime.scars) {
    if (runtime.fires.has(plotId)) continue;
    const settlement = state.settlements.find((entry) => entry.id === scar.settlementId);
    const plot = settlement?.structurePlots?.find((entry) => entry.id === plotId);
    if (!plot) { runtime.scars.delete(plotId); continue; }
    if (plot.condition > 0.82) scar.severity = Math.max(0, scar.severity - 0.11 * months);
    if (scar.severity < 0.035) runtime.scars.delete(plotId);
  }

  if (changed) state.world.environmentRevision = (state.world.environmentRevision ?? 0) + 1;
}

export function structureFireSnapshots(world: WorldState): readonly StructureFireSnapshot[] {
  const runtime = runtimes.get(world);
  if (!runtime) return [];
  return [...runtime.fires.values()].map(({ lastDamage: _lastDamage, ...fire }) => ({ ...fire }));
}

export function structureFireScars(world: WorldState): readonly StructureFireScarSnapshot[] {
  const runtime = runtimes.get(world);
  if (!runtime) return [];
  return [...runtime.scars.values()].map((scar) => ({ ...scar }));
}

/** Test/debug helper. Normal simulation code never needs to clear the runtime explicitly. */
export function clearStructureFireRuntime(world: WorldState): void {
  runtimes.delete(world);
}
