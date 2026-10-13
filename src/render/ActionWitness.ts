import type { PhysicalActionPresentation } from './people/PhysicalActionPresentation';

/** Presentation evidence only: phase progress is not workflow completion. */
export class ActionWitness {
  private identity?: string;
  private contactAt?: number;
  private followedThrough = false;
  private witnessed = false;

  get complete(): boolean { return this.witnessed; }

  reset(): void {
    this.identity = undefined;
    this.contactAt = undefined;
    this.followedThrough = false;
    this.witnessed = false;
  }

  observe(action: PhysicalActionPresentation | undefined, ageSeconds: number): boolean {
    if (!action || action.blockedReason) { this.reset(); return false; }
    const identity = `${action.personId}:${action.authoritativeActivity}:${action.targetId}`;
    if (identity !== this.identity) { this.reset(); this.identity = identity; }
    const construction = action.actionKind.startsWith('construction-');
    const meaningful = !construction || ['handoff', 'receive', 'assemble', 'complete'].includes(action.phase);
    if (this.contactAt === undefined && meaningful && (action.contactStrength >= 0.7
      || action.phase === 'complete' && action.phaseProgress >= 1)) this.contactAt = ageSeconds;
    if (this.contactAt === undefined) return false;
    if (action.contactStrength < 0.35 || action.phase === 'complete') this.followedThrough = true;
    this.witnessed = this.followedThrough && ageSeconds - this.contactAt >= 1.5;
    return this.witnessed;
  }
}
