import type { Person, Settlement, Vec2 } from '../../sim/types';
import { resourceVisualUnit as unit } from '../../sim/resources/ResourceWorkPresentation';
import type { RestSupportFootprint } from './RestPresentation';

export interface WorldAttentionCue extends Vec2 {
  id: string;
  kind: 'fire' | 'construction';
  structureId: string;
  radius: number;
}
export interface WorldAttentionState {
  targetId?: string;
  kind?: WorldAttentionCue['kind'];
  headYaw: number;
  torsoYaw: number;
  seconds: number;
  hold: number;
  nextCheck: number;
  nextNotice: number;
  seen: number;
  memory: Map<string, number>;
  /** Last acquisition workload, for inspection/performance regression tests. */
  candidatesChecked?: number;
}
const CELL = 4;
export const WORLD_ATTENTION_CANDIDATE_CAP = 16;

/** Read-only evidence adapter. No progress, casualties or incidents are manufactured here. */
export function worldAttentionCues(settlements: readonly Settlement[], people: readonly Person[],
  placements: ReadonlyMap<string, readonly RestSupportFootprint[]>): WorldAttentionCue[] {
  const crews = new Set(people.filter(p => p.alive && p.activity === 'construct' && !p.navigation?.traveling
    && p.navigation?.schedulePhase !== 'emergency').map(p => `${p.homeId}:${p.navigation?.destinationId}`));
  const cues: WorldAttentionCue[] = [];
  for (const settlement of settlements) {
    if (!settlement.alive) continue;
    const structures = placements.get(settlement.id) ?? [];
    for (const plot of settlement.structurePlots ?? []) {
      if (!plot.fire || plot.fire.intensity <= 0.05) continue;
      const at = structures.find(s => s.key === plot.id) ?? plot;
      cues.push({ id: `fire:${plot.id}:${plot.fire.startedMonth}`, kind: 'fire', structureId: plot.id,
        x: at.worldX, z: at.worldZ, radius: 4 });
    }
    const project = settlement.development?.project;
    const site = project && structures.find(s => s.key === project.plotId);
    if (project && site && project.progress < 1
      && (crews.has(`${settlement.id}:${project.plotId}`) || crews.has(`${settlement.id}:${settlement.id}:construction-site`))) {
      cues.push({ id: `construction:${project.plotId}:${project.startedMonth}`, kind: 'construction', structureId: site.key,
        x: site.worldX, z: site.worldZ, radius: 2.4 });
    }
  }
  return cues;
}

/** Sparse, bounded perception with smooth head-led attention. Owns no routes or simulation data. */
export class WorldAttentionPresentation {
  private readonly cues = new Map<string, WorldAttentionCue>();
  private readonly buckets = new Map<string, WorldAttentionCue[]>();
  private readonly states = new Map<string, WorldAttentionState>();
  private now = 0;
  private frame = 0;
  get size(): number { return this.states.size; }
  refresh(cues: readonly WorldAttentionCue[]): void {
    this.cues.clear(); this.buckets.clear();
    // Fixed bucket order makes the cap independent of settlement/placement iteration order.
    for (const cue of [...cues].sort((a, b) => Number(b.kind === 'fire') - Number(a.kind === 'fire') || a.id.localeCompare(b.id))) {
      const snapshot = { ...cue };
      this.cues.set(cue.id, snapshot);
      const key = `${Math.floor(cue.x / CELL)}:${Math.floor(cue.z / CELL)}`;
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(snapshot); this.buckets.set(key, bucket);
    }
  }
  beginFrame(delta: number): void { this.frame++; this.now += Math.max(0, Math.min(0.1, delta)); }
  resolve(person: Person, visual: Readonly<Vec2> & { facing: number; speed: number }, delta: number,
    structures: readonly RestSupportFootprint[], enabled = true): WorldAttentionState {
    let state = this.states.get(person.id);
    if (!state) {
      state = { headYaw: 0, torsoYaw: 0, seconds: 0, hold: 0, nextCheck: this.now + unit(`${person.id}:notice`) * 0.65,
        nextNotice: 0, seen: this.frame, memory: new Map() };
      this.states.set(person.id, state);
    }
    state.seen = this.frame;
    const dt = Math.max(0, Math.min(0.1, delta));
    const eligible = enabled && person.alive && person.health > 0.2;
    let cue = state.targetId ? this.cues.get(state.targetId) : undefined;
    if (!eligible || !cue || state.seconds >= state.hold
      || Math.hypot(cue.x - visual.x, cue.z - visual.z) > cue.radius) {
      cue = undefined; state.targetId = undefined; state.kind = undefined;
    }
    if (cue && this.now >= state.nextCheck) {
      state.nextCheck = this.now + 0.5;
      if (!attentionLineClear(visual, cue, structures)) { cue = undefined; state.targetId = undefined; state.kind = undefined; }
    }
    if (eligible && !cue && this.now >= state.nextCheck && this.now >= state.nextNotice) {
      state.nextCheck = this.now + 0.4 + unit(`${person.id}:perception`) * 0.35;
      let best = -Infinity, inspected = 0;
      const bx = Math.floor(visual.x / CELL), bz = Math.floor(visual.z / CELL);
      scan: for (let x = bx - 1; x <= bx + 1; x++) for (let z = bz - 1; z <= bz + 1; z++) {
        for (const candidate of this.buckets.get(`${x}:${z}`) ?? []) {
          if (inspected >= WORLD_ATTENTION_CANDIDATE_CAP) break scan;
          inspected++;
          const distance = Math.hypot(candidate.x - visual.x, candidate.z - visual.z);
          const yaw = angle(Math.atan2(candidate.x - visual.x, candidate.z - visual.z) - visual.facing);
          if ((state.memory.get(candidate.id) ?? 0) > this.now || distance < 0.18 || distance > candidate.radius
            || Math.abs(yaw) > (candidate.kind === 'fire' ? 1.9 : 1.25)
            || candidate.kind === 'construction' && (person.activity === 'construct'
              || unit(`${person.id}:${candidate.id}:curiosity`) > 0.25 + person.traits.curiosity * 0.65)
            || !attentionLineClear(visual, candidate, structures)) continue;
          const score = (candidate.kind === 'fire' ? 3 : 1) - distance / candidate.radius;
          if (score > best || score === best && candidate.id < (cue?.id ?? '')) { cue = candidate; best = score; }
        }
      }
      state.candidatesChecked = inspected;
      if (cue) {
        state.targetId = cue.id; state.kind = cue.kind; state.seconds = 0;
        state.hold = (cue.kind === 'fire' ? 1.2 : 0.65) + unit(`${person.id}:${cue.id}:hold`) * 0.9;
        state.memory.delete(cue.id);
        state.memory.set(cue.id, this.now + (cue.kind === 'fire' ? 45 : 28));
        state.nextCheck = this.now + 0.5;
        state.nextNotice = this.now + state.hold + 4 + unit(`${person.id}:restraint`) * 4;
        if (state.memory.size > 4) state.memory.delete(state.memory.keys().next().value!);
      }
    }
    state.seconds += dt;
    const yaw = cue ? angle(Math.atan2(cue.x - visual.x, cue.z - visual.z) - visual.facing) : 0;
    state.headYaw = approach(state.headYaw, clamp(yaw, 0.7), dt * 1.7);
    const torso = cue && state.seconds > 0.3 && visual.speed < 0.05 ? clamp(yaw * 0.18, 0.13) : 0;
    state.torsoYaw = approach(state.torsoYaw, torso, dt * 0.32);
    return state;
  }
  prune(): void { for (const [id, state] of this.states) if (state.seen !== this.frame) this.states.delete(id); }
  clear(): void { this.states.clear(); this.cues.clear(); this.buckets.clear(); this.now = 0; this.frame = 0; }
}

/** Sight is not walkability: look at the workface, but never through an intervening building. */
export function attentionLineClear(from: Vec2, cue: WorldAttentionCue, structures: readonly RestSupportFootprint[]): boolean {
  for (const s of structures) {
    if (s.key === cue.structureId) continue;
    const c = Math.cos(s.rotationY), sn = Math.sin(s.rotationY);
    const local = (p: Vec2) => ({ x: c * (p.x - s.worldX) - sn * (p.z - s.worldZ),
      z: sn * (p.x - s.worldX) + c * (p.z - s.worldZ) });
    const a = local(from), b = local(cue);
    let enter = 0, leave = 1;
    for (const [start, end, half] of [[a.x, b.x, s.width / 2], [a.z, b.z, s.depth / 2]] as const) {
      const d = end - start;
      if (Math.abs(d) < 1e-8) { if (Math.abs(start) > half) { enter = 2; break; } }
      else { const u = (-half - start) / d, v = (half - start) / d; enter = Math.max(enter, Math.min(u, v)); leave = Math.min(leave, Math.max(u, v)); }
    }
    if (enter <= leave) return false;
  }
  return true;
}
function angle(v: number): number { return Math.atan2(Math.sin(v), Math.cos(v)); }
function clamp(v: number, limit: number): number { return Math.max(-limit, Math.min(limit, v)); }
function approach(a: number, b: number, step: number): number { return a + clamp(b - a, step); }
