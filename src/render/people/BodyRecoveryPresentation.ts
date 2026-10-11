import type { BodyRecord, Person, Vec2 } from '../../sim/types';

const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
interface Recovery {
  bodyId: string; helperId: string; start: number; origin: Vec2; helperOrigin: Vec2;
  yaw: number; approach: number; duration: number;
}
export interface RecoveryPose {
  body: Vec2; helper: Vec2; yaw: number; bend: number; stride: number; dragging: boolean; done: boolean;
}

/** Bounded visual handoff for authoritative recovery jobs; never changes mortality or burial. */
export class BodyRecoveryPresentation {
  private readonly jobs = new Map<string, Recovery>();
  start(body: BodyRecord, helper: Person, origin: Vec2, helperOrigin: Vec2, yaw: number, time: number,
    clear: (a: Vec2, b: Vec2) => boolean): void {
    if (this.jobs.has(body.id) || body.removed || this.bodyForHelper(helper.id, time)) return;
    const grip = { x: origin.x + Math.sin(yaw) * 0.18, z: origin.z + Math.cos(yaw) * 0.18 };
    const end = { x: grip.x + Math.sin(yaw) * 1.4, z: grip.z + Math.cos(yaw) * 1.4 };
    const head = { x: origin.x - Math.sin(yaw) * 0.34, z: origin.z - Math.cos(yaw) * 0.34 };
    if (!clear(helperOrigin, grip) || !clear(head, end)) return;
    const approach = Math.max(1, Math.hypot(helperOrigin.x - grip.x, helperOrigin.z - grip.z) / 0.22);
    this.jobs.set(body.id, { bodyId: body.id, helperId: helper.id, start: time, origin: { ...origin },
      helperOrigin: { ...helperOrigin }, yaw, approach, duration: approach + 12 });
  }
  pose(id: string, time: number, reducedMotion = false): RecoveryPose | undefined {
    const job = this.jobs.get(id);
    if (!job) return;
    const t = Math.max(0, time - job.start);
    const approach = smooth(t / job.approach);
    const pullTime = Math.max(0, t - job.approach - 1.5);
    const pull = smooth(pullTime / 9);
    const dx = Math.sin(job.yaw), dz = Math.cos(job.yaw);
    const body = { x: job.origin.x + dx * pull * 1.4, z: job.origin.z + dz * pull * 1.4 };
    const grip = { x: body.x + dx * 0.18, z: body.z + dz * 0.18 };
    const approachYaw = Math.atan2(grip.x - job.helperOrigin.x, grip.z - job.helperOrigin.z);
    const turn = Math.atan2(Math.sin(job.yaw + Math.PI - approachYaw), Math.cos(job.yaw + Math.PI - approachYaw));
    return { body, helper: { x: job.helperOrigin.x + (grip.x - job.helperOrigin.x) * approach,
      z: job.helperOrigin.z + (grip.z - job.helperOrigin.z) * approach },
    yaw: approachYaw + turn * smooth((t - job.approach + 0.5) / 1),
    bend: smooth((t - job.approach) / 0.75) * (1 - smooth((t - job.duration + 1.5) / 1.5)),
    stride: reducedMotion ? 0 : Math.sin(t * (pullTime > 0 ? 7 : 9)) * (t < job.approach || pullTime > 0 && pullTime < 9 ? 0.22 : 0),
    dragging: pullTime > 0 && pullTime < 9, done: t >= job.duration };
  }
  bodyForHelper(id: string, time: number): string | undefined {
    for (const job of this.jobs.values()) if (job.helperId === id && time - job.start < job.duration) return job.bodyId;
  }
  has(id: string): boolean { return this.jobs.has(id); }
  prune(bodies: readonly BodyRecord[], people: readonly Person[], time: number): void {
    const alive = new Set(people.filter(p => p.alive).map(p => p.id));
    const ids = new Set(bodies.map(b => b.id));
    for (const [id, job] of this.jobs) if (!ids.has(id) || !alive.has(job.helperId)
      || time - job.start >= job.duration && bodies.find(b => b.id === id)?.removed) this.jobs.delete(id);
  }
}
