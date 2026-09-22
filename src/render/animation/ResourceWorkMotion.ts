import type { ResourceWorkProfile, ResourceWorkerVariation } from '../../sim/resources/ResourceWorkPresentation';

export interface ResourceWorkMotion {
  lean: number;
  twist: number;
  crouch: number;
  handY: number;
  handZ: number;
  toolAngle: number;
  impact: number;
  basket: number;
  /** Gathered piece is visible only after contact and before the sorting/basket release. */
  held: number;
  reposition: boolean;
}

export function createResourceWorkMotion(): ResourceWorkMotion {
  return { lean: 0, twist: 0, crouch: 0, handY: 0, handZ: 0, toolAngle: 0, impact: 0, basket: 0, held: 0, reposition: false };
}

/** Small safe plant-patch steps occur only after standing at the end of a harvesting cycle. */
export function resourceWorkAlternateAnchor(profile: ResourceWorkProfile, variation: ResourceWorkerVariation, seconds: number): boolean {
  if (profile.kind !== 'plant') return false;
  const time = Math.max(0, seconds) * variation.cycleSpeed * (0.94 + profile.intensity * 0.12) / profile.cycleSeconds + variation.phaseOffset * 4;
  return Math.floor(time + 0.06) % 2 === 1;
}

const smooth = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Absolute presentation time + stable identity: independent of render order and frame rate. */
export function sampleResourceWorkMotion(
  profile: ResourceWorkProfile, variation: ResourceWorkerVariation, seconds: number, out: ResourceWorkMotion,
): ResourceWorkMotion {
  const time = Math.max(0, seconds) * variation.cycleSpeed * (0.94 + profile.intensity * 0.12) / profile.cycleSeconds + variation.phaseOffset * 4;
  const phase = time % 1;
  const rest = Math.floor(time) % 4 === 3;
  out.reposition = rest && phase > 0.45;
  out.impact = 0;
  out.basket = 0;
  out.held = 0;
  if (profile.kind === 'plant' || profile.kind === 'generic') {
    // Stand -> crouch -> reach/pluck -> inspect -> basket -> stand. The hands follow the action.
    const crouch = smooth(phase / 0.2) * (1 - smooth((phase - 0.72) / 0.22));
    const reach = smooth((phase - 0.16) / 0.18) * (1 - smooth((phase - 0.46) / 0.18));
    const basket = smooth((phase - 0.62) / 0.09) * (1 - smooth((phase - 0.8) / 0.12));
    out.crouch = crouch * 0.18;
    out.lean = crouch * 0.26;
    out.twist = basket * 0.35;
    out.handY = 0.55 - reach * 0.46 - basket * 0.15;
    out.handZ = 0.18 + reach * 0.26;
    out.toolAngle = 0;
    out.basket = basket;
    out.held = phase >= 0.46 && phase < 0.8 ? 1 : 0;
    out.impact = phase > 0.4 && phase < 0.46 ? Math.sin((phase - 0.4) / 0.06 * Math.PI) : 0;
    out.reposition = phase > 0.94;
    return out;
  }
  // Slow loaded backswing and anticipation, committed strike, brief impact hold, fast return.
  const lift = smooth(phase / 0.34);
  const power = smooth((phase - 0.43) / 0.22);
  const recovery = smooth((phase - 0.76) / (0.18 * variation.recovery));
  const raised = lift * (1 - power);
  const contact = power * (1 - recovery);
  const strength = variation.strikeStrength;
  out.handY = rest ? 0.44 + Math.sin(phase * Math.PI) * 0.05 : 0.55 + raised * 0.43 - contact * 0.12;
  out.handZ = rest ? 0.23 : 0.23 - raised * 0.17;
  out.toolAngle = rest ? 1.9 : 1.3 - raised * 1.9 + contact * 0.85;
  out.lean = rest ? 0.1 : contact * 0.25 * strength - raised * 0.09;
  out.twist = rest ? Math.sin(phase * Math.PI * 2) * 0.12 : (raised * -0.28 + contact * 0.16) * (profile.kind === 'timber' ? strength : 0.45);
  out.crouch = rest ? Math.sin(phase * Math.PI) * (profile.kind === 'mineral' ? 0.17 : 0.045) : contact * 0.06;
  if (!rest && phase >= 0.65 && phase < 0.74) out.impact = Math.sin((phase - 0.65) / 0.09 * Math.PI);
  if (rest) {
    // Every fourth cycle sorts a loosened piece: reach, acquire, lift and place beside the face.
    // This is documentary motion for already-recorded extraction, never another yield event.
    const reach = smooth(phase / 0.2) * (1 - smooth((phase - 0.3) / 0.18));
    out.handY = 0.45 - reach * 0.25;
    out.handZ = 0.2 + reach * 0.08;
    out.impact = phase >= 0.22 && phase < 0.3 ? Math.sin((phase - 0.22) / 0.08 * Math.PI) : 0;
    out.held = phase >= 0.3 && phase < 0.72 ? 1 : 0;
    out.basket = smooth((phase - 0.55) / 0.17) * (1 - smooth((phase - 0.72) / 0.16));
    out.twist = out.basket * 0.38;
  }
  return out;
}
