import { DEFAULT_CONFIG, type GodboxConfig } from '../../config';
import { SeededRandom, stableHash } from '../prng';
import { DynamicHydrology } from '../terrain/Hydrology';
import { classifyWaterDepth, waterDepthAt } from '../terrain/SurfaceGeometry';
import { cellAt } from '../world';
import { tornadoDamage, tornadoExposure, tornadoPotential } from './Tornado';
import type { Vec2, WeatherDescriptor, WeatherFront, WeatherKind, WeatherState, WorldCell, WorldState } from '../types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const FREEZING = 0.38;

function precipitationFor(kind: WeatherKind): WeatherDescriptor['precipitation'] {
  if (kind === 'snow' || kind === 'heavy-snow') return 'snow';
  if (['rain', 'heavy-rain', 'thunderstorm', 'tornado', 'hurricane'].includes(kind)) return 'rain';
  return 'none';
}

export class WeatherSystem {
  readonly state: WeatherState;
  private readonly climateMoisture: number[];
  private readonly movementCosts: number[];
  private readonly woodlandCapacity: number[];
  private readonly hydrology: DynamicHydrology;
  private nextFrontId = 1;
  private readonly regionalVariation = new Map<number, number>();
  private variationMonth = -1;
  private seasonalMonth = -1;
  private seasonalCosine = 1;
  private readonly resolvedWeather: WeatherDescriptor = { kind: 'clear', intensity: 0, wind: 0, precipitation: 'none' };

  constructor(
    readonly world: WorldState,
    readonly config: GodboxConfig = DEFAULT_CONFIG,
    readonly random = new SeededRandom(`${config.seed}:weather`),
  ) {
    this.climateMoisture = world.cells.map((cell) => cell.moisture);
    this.movementCosts = world.cells.map((cell) => cell.movementCost);
    this.woodlandCapacity = world.cells.map((cell) => cell.wood);
    this.state = { month: 0, wind: 0.12, windX: 1, windZ: 0, fronts: [], cells: [], tornadoes: [], forestScars: [] };
    world.weather = this.state;
    this.hydrology = new DynamicHydrology(world);
    this.state.cells = world.cells.map((cell) => {
      const waterDepth = waterDepthAt(world, cell.worldX, cell.worldZ);
      return {
      ...this.resolveWeatherAt(cell.worldX, cell.worldZ),
      x: cell.x, z: cell.z, confidence: 1, durationMonths: 1,
      temperature: this.temperatureAt(cell), windX: 1, windZ: 0,
      snowpack: 0, blizzard: 0, snowMonths: 0, cropDamage: 0, travelPenalty: 0, runoff: 0, floodRisk: 0, floodDepth: 0,
      waterDepth, floodState: classifyWaterDepth(waterDepth, cell.moisture), floodMonths: 0,
      treeDamage: 0, lastWindthrowMonth: -1,
      };
    });
  }

  private temperatureAt(cell: WorldCell): number {
    return clamp01(cell.temperature - this.seasonCosine() * 0.16);
  }

  private seasonCosine(): number {
    if (this.seasonalMonth !== this.state.month) {
      this.seasonalMonth = this.state.month;
      this.seasonalCosine = Math.cos(this.state.month / 12 * Math.PI * 2);
    }
    return this.seasonalCosine;
  }

  createFront(position: Vec2, kind: WeatherKind, intensity = 0.5, radius = 12, velocity = 1, lifespan = 3): WeatherFront {
    const direction = this.random.range(-0.65, 0.65);
    const front: WeatherFront = {
      id: `weather-front-${this.nextFrontId++}`, kind, x: position.x, z: position.z,
      radius: Math.max(0.1, radius), directionX: Math.cos(direction), directionZ: Math.sin(direction),
      velocity: Math.max(0, velocity), intensity: clamp01(intensity),
      lifespan: Math.max(1, lifespan), ageMonths: 0, precipitation: precipitationFor(kind),
      wind: clamp01(kind === 'windstorm' ? 0.65 + intensity * 0.35 : kind === 'thunderstorm' ? 0.45 + intensity * 0.5
        : kind === 'heavy-rain' || kind === 'heavy-snow' ? 0.25 + intensity * 0.6 : 0.08 + intensity * 0.5),
      severity: intensity,
    };
    this.state.fronts.push(front);
    return front;
  }

  advanceMonth(): void {
    this.state.month += 1;
    this.state.wind = 0.12 + this.random.float() * 0.2;
    const direction = Math.sin(this.state.month / 9) * 0.6;
    this.state.windX = Math.cos(direction);
    this.state.windZ = Math.sin(direction);
    this.state.fronts = this.state.fronts.filter((front) => front.ageMonths < front.lifespan && front.intensity > 0.08);
    for (const front of this.state.fronts) {
      front.x += front.directionX * front.velocity * 4;
      front.z += front.directionZ * front.velocity * 4;
      front.ageMonths += 1;
      front.intensity *= 0.95;
      front.wind *= 0.98;
    }
    if (this.state.fronts.length < 4 && this.random.chance(0.4)) {
      const cell = this.random.pick(this.world.cells);
      const moist = this.climateMoisture[cell.z * this.world.size + cell.x]!;
      const roll = this.random.float();
      const kind: WeatherKind = roll < 0.035 ? 'windstorm'
        : moist > 0.5 && this.temperatureAt(cell) > 0.55 && roll < 0.12 ? 'thunderstorm'
          : moist > 0.4 && roll < 0.28 ? 'heavy-rain' : moist > 0.3 ? 'rain' : 'cloudy';
      this.createFront({ x: cell.worldX, z: cell.worldZ }, kind, this.random.range(0.5, 1),
        this.world.cellSize * this.random.range(3, 7), this.random.range(0.5, 1.5), this.random.int(2, 5));
    }
    for (const cell of this.world.cells) this.applyWeatherToCell(cell, {});
    this.advanceTornadoes();
    this.hydrology.advance(this.state.cells);
    this.world.environmentRevision = (this.world.environmentRevision ?? 0) + 1;
  }

  private advanceTornadoes(): void {
    this.state.tornadoes = this.state.tornadoes.filter((event) => this.state.month - event.month < 2);
    this.state.forestScars = this.state.forestScars.filter((event) => this.state.month - event.month < 360);
    for (const front of this.state.fronts.slice(0, 4)) {
      const cell = cellAt(this.world, front.x, front.z);
      if (!cell) continue;
      let contrast = 0;
      for (const [offsetX, offsetZ] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
        const neighbor = cellAt(this.world, front.x + offsetX! * this.world.cellSize, front.z + offsetZ! * this.world.cellSize);
        if (neighbor) contrast = Math.max(contrast, Math.abs(this.temperatureAt(neighbor) - this.temperatureAt(cell)));
      }
      const potential = tornadoPotential(front, cell, this.temperatureAt(cell), contrast);
      const random = new SeededRandom(`${this.config.seed}:tornado:${front.id}:${this.state.month}`);
      if (potential <= 0 || !random.chance(potential * 0.12)) continue;
      const intensity = clamp01(0.2 + potential * 0.4 + random.float() * 0.4);
      const lifetimeHours = 0.25 + random.float() * 1.5;
      const speed = this.world.cellSize * random.range(2, 5);
      const direction = { x: front.directionX, z: front.directionZ };
      const path = [{ x: front.x, z: front.z }];
      for (let step = 1; step <= 8; step += 1) {
        const previous = path[step - 1]!;
        const bend = random.range(-0.18, 0.18);
        path.push({ x: previous.x + (direction.x - direction.z * bend) * speed * lifetimeHours / 8,
          z: previous.z + (direction.z + direction.x * bend) * speed * lifetimeHours / 8 });
      }
      const event = { id: `tornado:${front.id}:${this.state.month}`, frontId: front.id, month: this.state.month,
        intensity, width: this.world.cellSize * (0.12 + intensity * 0.55), speed, lifetimeHours, direction, path };
      this.state.tornadoes.push(event);
      this.state.forestScars.push(event);
      for (const land of this.world.cells) {
        if (land.water) continue;
        let exposure = 0;
        for (let sampleZ = -1; sampleZ <= 1; sampleZ += 1) {
          for (let sampleX = -1; sampleX <= 1; sampleX += 1) {
            exposure += tornadoExposure(event, { x: land.worldX + sampleX * this.world.cellSize / 3,
              z: land.worldZ + sampleZ * this.world.cellSize / 3 }) / 9;
          }
        }
        const damage = tornadoDamage(event, exposure, 0.1);
        land.wood *= 1 - damage;
        const conditions = this.state.cells[land.z * this.world.size + land.x]!;
        conditions.cropDamage = clamp01(conditions.cropDamage + damage);
      }
    }
    this.state.forestScars = this.state.forestScars.slice(-128);
  }

  resolveWeatherAt(worldX: number, worldZ: number, descriptor: Partial<WeatherDescriptor> = {}): WeatherDescriptor {
    const cell = cellAt(this.world, worldX, worldZ);
    if (!cell) return { kind: 'clear', intensity: 0, wind: 0, precipitation: 'none' };
    return { ...this.resolveCellWeather(cell, descriptor, worldX, worldZ) };
  }

  private resolveCellWeather(cell: WorldCell, descriptor: Partial<WeatherDescriptor>, worldX = cell.worldX, worldZ = cell.worldZ): WeatherDescriptor {
    const index = cell.z * this.world.size + cell.x;
    const moisture = this.climateMoisture[index] ?? cell.moisture;
    if (this.variationMonth !== this.state.month) {
      this.regionalVariation.clear();
      this.variationMonth = this.state.month;
    }
    const regionX = Math.floor(cell.x / 5);
    const regionZ = Math.floor(cell.z / 5);
    const regionId = regionZ * this.world.size + regionX;
    let variation = this.regionalVariation.get(regionId);
    if (variation === undefined) {
      variation = stableHash(`${this.config.seed}:weather:${this.state.month}`, regionX, regionZ);
      this.regionalVariation.set(regionId, variation);
    }
    let kind: WeatherKind = variation < moisture * 0.24 ? 'rain' : variation < moisture * 0.65 ? 'cloudy' : 'clear';
    let intensity = kind === 'rain' ? 0.35 + variation : kind === 'cloudy' ? 0.3 : 0.06;
    let wind = this.state.wind;
    for (const front of this.state.fronts) {
      const deltaX = front.x - worldX;
      const deltaZ = front.z - worldZ;
      if (Math.abs(deltaX) >= front.radius || Math.abs(deltaZ) >= front.radius) continue;
      const distance = Math.hypot(deltaX, deltaZ);
      if (distance >= front.radius) continue;
      const localIntensity = front.intensity * Math.min(1, (1 - distance / front.radius) * 3);
      if (localIntensity > intensity) {
        kind = front.kind;
        intensity = localIntensity;
      }
      wind = Math.max(wind, front.wind * Math.min(1, (1 - distance / front.radius) * 3));
    }
    kind = descriptor.kind ?? kind;
    intensity = clamp01(descriptor.intensity ?? intensity);
    wind = clamp01(descriptor.wind ?? wind);
    const temperature = this.temperatureAt(cell);
    if (precipitationFor(kind) !== 'none') {
      if (temperature <= FREEZING) kind = ['heavy-rain', 'thunderstorm', 'heavy-snow'].includes(kind) ? 'heavy-snow' : 'snow';
      else if (kind === 'snow' || kind === 'heavy-snow') kind = kind === 'heavy-snow' ? 'heavy-rain' : 'rain';
    }
    this.resolvedWeather.kind = kind;
    this.resolvedWeather.intensity = intensity;
    this.resolvedWeather.wind = wind;
    this.resolvedWeather.precipitation = precipitationFor(kind);
    return this.resolvedWeather;
  }

  applyWeatherToCell(cell: WorldCell, descriptor: Partial<WeatherDescriptor>, months = 1): void {
    if (months <= 0) return;
    const index = cell.z * this.world.size + cell.x;
    const conditions = this.state.cells[index]!;
    conditions.cropDamage *= 0.85 ** months;
    const weather = this.resolveCellWeather(cell, descriptor);
    const temperature = this.temperatureAt(cell);
    const heavy = ['heavy-rain', 'thunderstorm', 'hurricane', 'heavy-snow'].includes(weather.kind);
    const precipitation = weather.intensity * (heavy ? 0.24 : 0.07) * months;
    const rainfall = weather.precipitation === 'rain' ? precipitation : 0;
    conditions.blizzard = weather.kind === 'heavy-snow' && weather.intensity > 0.65 && weather.wind > 0.6 && temperature < FREEZING - 0.03
      ? clamp01((weather.intensity - 0.65) / 0.35) * clamp01((weather.wind - 0.6) / 0.3)
        * clamp01((FREEZING - 0.03 - temperature) / 0.12) : 0;
    if (weather.precipitation === 'snow' && temperature <= FREEZING) {
      const retention = (0.85 + (FREEZING - temperature) * 0.5) * (1 - cell.slope * 0.2);
      conditions.snowpack = Math.min(1.5, conditions.snowpack + precipitation * retention * (1 + conditions.blizzard * 0.35));
    }
    const sunlight = 0.8 + (1 - this.seasonCosine()) * 0.2;
    const melt = Math.min(conditions.snowpack, Math.max(0, temperature - FREEZING) * sunlight * months / (1 + conditions.snowpack * 0.3));
    conditions.snowpack -= melt;
    conditions.snowMonths = conditions.snowpack > 0.05 ? conditions.snowMonths + months : 0;
    const liquid = rainfall + melt;
    conditions.runoff = liquid * (0.2 + cell.moisture * 0.6 + cell.slope * 0.2);
    const evaporation = (0.008 + temperature * 0.015) * months;
    cell.moisture = clamp01(cell.moisture + liquid * 0.6 - evaporation
      + ((this.climateMoisture[index] ?? cell.moisture) - cell.moisture) * 0.04 * months);
    conditions.travelPenalty = conditions.snowpack * 3 + conditions.blizzard + Math.max(0, cell.moisture - 0.75) * 0.8;
    cell.movementCost = this.movementCosts[index]! + conditions.travelPenalty;
    conditions.durationMonths = conditions.kind === weather.kind ? conditions.durationMonths + months : months;
    conditions.kind = weather.kind;
    conditions.intensity = weather.intensity;
    conditions.wind = weather.wind;
    conditions.precipitation = weather.precipitation;
    conditions.temperature = temperature;
    conditions.windX = this.state.windX;
    conditions.windZ = this.state.windZ;
    let strongestWind = this.state.wind;
    for (const front of this.state.fronts) {
      if (Math.abs(front.x - cell.worldX) >= front.radius || Math.abs(front.z - cell.worldZ) >= front.radius) continue;
      const strength = front.wind * clamp01((1 - Math.hypot(front.x - cell.worldX, front.z - cell.worldZ) / front.radius) * 3);
      if (strength <= strongestWind) continue;
      strongestWind = strength;
      conditions.windX = front.directionX;
      conditions.windZ = front.directionZ;
    }
    const vulnerability = clamp01(0.25 + cell.slope + (1 - cell.moisture) * 0.4);
    const hazard = Math.max(0, weather.wind - 0.72) * vulnerability;
    if (!cell.water && hazard > 0 && this.random.chance(hazard * months)) {
      const damage = hazard * this.random.range(0.3, 0.8);
      conditions.treeDamage = clamp01(conditions.treeDamage + damage);
      conditions.lastWindthrowMonth = this.state.month;
      cell.wood = Math.max(0, cell.wood * (1 - damage));
    }
    if (this.state.month - conditions.lastWindthrowMonth > 24) {
      cell.wood += Math.max(0, this.woodlandCapacity[index]! - cell.wood) * (1 - 0.998 ** months);
    }
  }
}
