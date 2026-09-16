import { SeededRandom } from '../prng';
import { WalkabilityLayer } from '../people/WalkabilityLayer';
import { surfaceHeightAt, waterDepthAt } from '../terrain/SurfaceGeometry';
import type { KnowledgeDomain, SimulationState, Vec2, WorldState } from '../types';

export type ArrivalPhase = 'PRISTINE_WORLD' | 'ARRIVAL_SEQUENCE' | 'FOUNDERS_LANDED' | 'HISTORY_RUNNING';
export interface FoundingPod {
  id: string;
  groupId: string;
  name: string;
  color: string;
  position: Vec2;
  groundY: number;
  cellIndex: number;
  domains: KnowledgeDomain[];
  knowledge: string[];
  population: number;
  personIds: string[];
  settlementId?: string;
  landed: boolean;
  entrySeconds: number;
  descentSeconds: number;
  entryOffset: Vec2;
  /** Immutable manifest; supplies are transferred once to the camp's finite stock. */
  supplies: { food: number; goods: number; timber: number; stone: number };
  /** Immutable landing conditions. Optional only for archives created before this field existed. */
  site?: {
    biome: string;
    landform: string;
    elevation: number;
    fertility: number;
    woodland: number;
    waterAccess: number;
    habitability: number;
    parentRock: string;
  };
  condition: number;
  /** Cramped emergency protection, never a home for the whole founding group. */
  shelterCapacity?: number;
}
export interface FoundingArrivalState {
  phase: ArrivalPhase;
  elapsedSeconds: number;
  pods: FoundingPod[];
  minimumSeparation: number;
}
export const ARRIVAL_END_SECONDS = 46;
export const FOUNDING_PROFILES: readonly { name: string; color: string; domains: KnowledgeDomain[]; knowledge: string[] }[] = [
  { name: 'Seed', color: '#c5a45d', domains: ['agriculture', 'biology'], knowledge: ['crop-selection', 'seasonal-observation'] },
  { name: 'Forge', color: '#679dae', domains: ['materials', 'mechanics'], knowledge: ['iron-working', 'leverage'] },
  { name: 'Lifeline', color: '#65937b', domains: ['medicine', 'biology'], knowledge: ['contagion-patterns'] },
  { name: 'Covenant', color: '#a46060', domains: ['records', 'manufacturing'], knowledge: ['durable-records', 'counting-measure'] },
  { name: 'Horizon', color: '#9680b0', domains: ['navigation', 'transport'], knowledge: ['celestial-navigation', 'buoyancy-currents'] },
];

/** Reject unsafe footprints as well as isolated coarse cells. Never move a landing later. */
export function validLandingSite(world: WorldState, point: Vec2, walk = new WalkabilityLayer(world)): boolean {
  const y = surfaceHeightAt(world, point.x, point.z);
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const edge = { x: point.x + Math.cos(angle) * 3.2, z: point.z + Math.sin(angle) * 3.2 };
    if (!walk.isSegmentWalkable(point, edge) || waterDepthAt(world, edge.x, edge.z) > 0.005
      || Math.abs(surfaceHeightAt(world, edge.x, edge.z) - y) > 0.85) return false;
  }
  return waterDepthAt(world, point.x, point.z) <= 0.005;
}

export function createFoundingArrival(world: WorldState, seed: string): FoundingArrivalState {
  const random = new SeededRandom(`${seed}:arrival`);
  const walk = new WalkabilityLayer(world);
  const margin = Math.max(4, Math.floor(world.size * 0.12));
  const candidates = world.cells.filter(c => !c.water && c.slope < 0.24 && c.habitability > 0.12
    && c.x >= margin && c.z >= margin && c.x < world.size - margin && c.z < world.size - margin)
    .map(c => ({ cell: c, tie: random.float(), point: { x: c.worldX, z: c.worldZ } }))
    .filter(c => validLandingSite(world, c.point, walk));
  const separation = Math.max(8, world.size * world.cellSize * 0.17);
  const selected: typeof candidates = [];
  for (let i = 0; i < 5; i++) {
    const ranked = candidates.filter(c => selected.every(s => Math.hypot(c.point.x - s.point.x, c.point.z - s.point.z) >= separation))
      .map(c => ({ ...c, score: c.cell.habitability * 0.4 + c.cell.fertility * 0.18 + c.tie * 0.35
        + (selected.some(s => s.cell.biome === c.cell.biome) ? 0 : 0.22)
        + (selected.length ? Math.min(...selected.map(s => Math.hypot(c.point.x - s.point.x, c.point.z - s.point.z))) / (world.size * world.cellSize) : 0) }))
      .sort((a, b) => b.score - a.score);
    if (!ranked[0]) throw new Error('This world cannot support five safe, separated arrival sites. Try a larger world or a different seed.');
    selected.push(ranked[0]);
  }
  return { phase: 'PRISTINE_WORLD', elapsedSeconds: 0, minimumSeparation: separation,
    pods: selected.map((site, i) => {
      const profile = FOUNDING_PROFILES[i]!;
      return { id: `${seed}:pod:${i + 1}`, groupId: `${seed}:founders:${i + 1}`, ...profile,
        domains: [...profile.domains], knowledge: [...profile.knowledge], position: site.point,
        groundY: surfaceHeightAt(world, site.point.x, site.point.z), cellIndex: site.cell.z * world.size + site.cell.x,
        population: 22, personIds: [], landed: false, condition: 1, shelterCapacity: 4,
        entrySeconds: 13 + [0, 1.8, 4.3, 5.5, 7.6][i]!, descentSeconds: 12 + [0, 1.2, -0.4, 0.7, 1.4][i]!,
        entryOffset: { x: -20 + i * 6, z: -25 - i * 2 }, supplies: { food: 100, goods: 6, timber: 8, stone: 3 },
        site: {
          biome: site.cell.biome,
          landform: site.cell.landform,
          elevation: site.cell.elevation,
          fertility: site.cell.fertility,
          woodland: site.cell.wood,
          waterAccess: site.cell.soil?.waterAccess ?? 0,
          habitability: site.cell.habitability,
          parentRock: site.cell.geology?.family ?? 'unknown',
        } };
    }) };
}

export function podTouchdown(pod: FoundingPod): number { return pod.entrySeconds + pod.descentSeconds; }

/** Shared trajectory: cubic easing brakes continuously into the authoritative ground point. */
export function podPosition(pod: FoundingPod, seconds: number): { x: number; y: number; z: number } {
  if (seconds >= podTouchdown(pod)) return { ...pod.position, y: pod.groundY + 1.1 };
  const t = Math.max(0, Math.min(1, (seconds - pod.entrySeconds) / pod.descentSeconds));
  const remaining = (1 - t) ** 2;
  return { x: pod.position.x + pod.entryOffset.x * remaining * (1 - t),
    z: pod.position.z + pod.entryOffset.z * remaining,
    y: pod.groundY + 1.1 + 48 * remaining };
}

/** Wall-clock director with monotonic transitions. The simulation owns all mutations. */
export class FoundingArrivalDirector {
  advance(state: FoundingArrivalState, delta: number, land: (pod: FoundingPod) => void, emerge: (pod: FoundingPod, count: number) => void, finish: () => void): void {
    if (state.phase === 'HISTORY_RUNNING') return;
    if (!Number.isFinite(delta) || delta < 0) return;
    const previous = state.elapsedSeconds;
    const t = Math.min(ARRIVAL_END_SECONDS, previous + delta);
    // Fixed event ordering makes replay and skipped preview time match real-time playback.
    for (let tick = Math.floor(previous * 10 + 1e-8) + 1; tick <= Math.floor(t * 10 + 1e-8); tick++) {
      state.elapsedSeconds = tick / 10;
      if (state.elapsedSeconds >= 12) state.phase = 'ARRIVAL_SEQUENCE';
      for (const pod of state.pods) {
        if (state.elapsedSeconds + 1e-8 >= podTouchdown(pod) && !pod.landed) { land(pod); pod.landed = true; }
        if (pod.landed) emerge(pod, Math.min(pod.population, Math.max(0, Math.floor((state.elapsedSeconds - podTouchdown(pod) - 1.5) * 5 + 1e-8))));
      }
    }
    state.elapsedSeconds = t;
    if (state.pods.every(p => p.landed)) state.phase = 'FOUNDERS_LANDED';
    if (t >= ARRIVAL_END_SECONDS && state.pods.every(p => p.personIds.length === p.population)) {
      state.phase = 'HISTORY_RUNNING';
      finish();
    }
  }
}

export function assertPristine(state: SimulationState): void {
  const forbidden = [state.people, state.settlements, state.cultures, state.institutions, state.polities, state.wars,
    state.history, state.tradeRoutes, state.relations, state.notableFigures ?? [], state.households ?? [], state.socialRelationships ?? [], state.ideas ?? []];
  if (state.month !== 0 || forbidden.some(a => a.length) || Object.keys(state.transportation.segments).length
    || Object.keys(state.transportation.projects).length || Object.keys(state.transportation.stops).length
    || state.world.cells.some(c => Object.keys(c.modifications ?? {}).length || c.lastLoggingMonth !== undefined)
    || state.world.resourceDeposits.some(d => (d.extracted ?? 0) > 0 || (d.accessTrails?.length ?? 0) > 0 || d.controlledBy || Object.keys(d.discoveredBy).length)) {
    throw new Error('Arrival requires an authoritative pristine Year Zero.');
  }
}
