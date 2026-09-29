import { podPosition, podTouchdown, type FoundingArrivalState } from '../../sim/founding/FoundingArrival';

export const WATCHER_LINES = [
  { start: 0.8, end: 4.5, text: 'Before them, only the world.' },
  { start: 5.5, end: 11.5, text: 'Five vessels entered the sky.' },
  { start: 24, end: 30, text: 'Five landings. Five beginnings.' },
  { start: 34, end: 37.5, text: 'ARRIVAL DAY' },
] as const;

export function arrivalCaption(seconds: number): { text: string; opacity: number } {
  const line = WATCHER_LINES.find(l => seconds >= l.start && seconds <= l.end);
  return line ? { text: line.text, opacity: Math.min(1, (seconds - line.start) / 1.35, (line.end - seconds) / 1.15) } : { text: '', opacity: 0 };
}

export interface FoundingArrivalDialogue {
  eyebrow: string;
  title: string;
  text: string;
}

/**
 * Arrival Day remains Historian-grounded, but the opening avoids repeating a full cast list or
 * narrating every transition. The HUD appears only once authoritative history is ready to speak.
 */
export function foundingArrivalDialogue(
  sceneId: string | undefined,
  title: string,
  text: string,
): FoundingArrivalDialogue | undefined {
  if (!sceneId) return undefined;
  if (sceneId.startsWith('founding-cast:introduction:')) {
    return { eyebrow: 'ARRIVAL DAY · A FOUNDER', title, text };
  }
  if (!sceneId.startsWith('founding:')) return undefined;
  return {
    eyebrow: 'ARRIVAL DAY · ORIENTATION',
    title,
    text,
  };
}

export type ArrivalSequenceBeat = 'pristine' | 'fleet' | 'descent' | 'touchdown' | 'doorway' | 'first-steps' | 'site-flythrough' | 'handoff';

export interface ArrivalSequenceFocus {
  readonly beat: ArrivalSequenceBeat;
  /** Beat identity for telemetry; a new ID never implies a camera cut. */
  readonly shotId: string;
  readonly target: Readonly<{ x: number; y: number; z: number }>;
  readonly radius: number;
  readonly height: number;
  readonly transitionSeconds: number;
  readonly azimuthOffset: number;
  readonly fov: number;
  readonly siteIndex?: number;
  /** Optional authored lens position for human-scale site photography. */
  readonly cameraPosition?: Readonly<{ x: number; y: number; z: number }>;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixPoint = (
  a: Readonly<{ x: number; y: number; z: number }>,
  b: Readonly<{ x: number; y: number; z: number }>,
  amount: number,
): { x: number; y: number; z: number } => ({
  x: lerp(a.x, b.x, amount),
  y: lerp(a.y, b.y, amount),
  z: lerp(a.z, b.z, amount),
});

interface FoundingSiteComposition {
  readonly target: Readonly<{ x: number; y: number; z: number }>;
  readonly stagingCamera: Readonly<{ x: number; y: number; z: number }>;
  readonly closeCamera: Readonly<{ x: number; y: number; z: number }>;
}

/**
 * Founder emergence is authoritative and deliberately staged south of each hatch. Photograph that
 * actual gathering ring instead of guessing at an arbitrary point around the vessel. Close lenses
 * stay inside the terrain-checked landing footprint; only the inter-site staging pose sits farther
 * out and higher.
 */
function foundingSiteComposition(
  pod: FoundingArrivalState['pods'][number],
  siteIndex: number,
): FoundingSiteComposition {
  const side = siteIndex % 2 === 0 ? 1 : -1;
  return {
    target: { x: pod.position.x, y: pod.groundY + 0.24, z: pod.position.z - 1.6 },
    closeCamera: {
      x: pod.position.x + side * 1.45,
      y: pod.groundY + 0.92,
      z: pod.position.z - 2.68,
    },
    stagingCamera: {
      x: pod.position.x + side * 3.2,
      y: pod.groundY + 3.2,
      z: pod.position.z - 5.2,
    },
  };
}

/**
 * The opening lens looks across the hero landing corridor rather than straight down it. That keeps
 * the untouched world readable while the first vessel begins beyond the frame and crosses into it.
 */
function openingWorldComposition(pod: FoundingArrivalState['pods'][number]): {
  target: Readonly<{ x: number; y: number; z: number }>;
  camera: Readonly<{ x: number; y: number; z: number }>;
} {
  const length = Math.max(0.001, Math.hypot(pod.entryOffset.x, pod.entryOffset.z));
  const approachX = pod.entryOffset.x / length;
  const approachZ = pod.entryOffset.z / length;
  const sideX = -approachZ;
  const sideZ = approachX;
  return {
    target: { x: pod.position.x, y: pod.groundY + 3.8, z: pod.position.z },
    camera: {
      x: pod.position.x + sideX * 34,
      y: pod.groundY + 24,
      z: pod.position.z + sideZ * 34,
    },
  };
}

/**
 * Arrival is an authored short film rather than a surveillance pass. It establishes the untouched
 * world, follows the first vessel into touchdown, then drops to human scale for emergence and gathering. The title stays with
 * the people; geography never replaces the human subject at the handoff.
 */
export function arrivalSequenceFocus(arrival: FoundingArrivalState): ArrivalSequenceFocus {
  const t = arrival.elapsedSeconds;
  const hero = arrival.pods[0];
  if (!hero) return { beat: 'pristine', shotId: 'empty', target: { x: 0, y: 0, z: 0 }, radius: 52, height: 37, transitionSeconds: 1, azimuthOffset: 0, fov: 38 };
  const touchdown = podTouchdown(hero);
  const fleetEnd = hero.entrySeconds + hero.descentSeconds * 0.3;
  const firstSteps = touchdown + 3;
  // The hero's last passengers have left the ramp before the film acknowledges other groups.
  const disembarked = touchdown + 1.5 + hero.population / 5 + 3.5;

  const opening = openingWorldComposition(hero);
  if (t < hero.entrySeconds) {
    return { beat: 'pristine', shotId: 'pristine-world', target: opening.target, cameraPosition: opening.camera,
      radius: 42, height: 24, transitionSeconds: 0.9, azimuthOffset: 0, fov: 38, siteIndex: 0 };
  }

  if (t < fleetEnd) {
    const position = podPosition(hero, t);
    // Hold the landscape for the first instant of entry, then pan into the vessel only after it has
    // physically crossed toward the frame. The lens never chases an invisible off-screen subject.
    const reveal = smoothstep((t - hero.entrySeconds - 0.55) / Math.max(0.1, fleetEnd - hero.entrySeconds - 0.8));
    const vesselTarget = { x: position.x, y: position.y - 0.3, z: position.z };
    return { beat: 'fleet', shotId: 'fleet-ingress', target: mixPoint(opening.target, vesselTarget, reveal), cameraPosition: opening.camera,
      radius: 42, height: 24, transitionSeconds: 0.72, azimuthOffset: 0, fov: 38, siteIndex: 0 };
  }

  if (t < disembarked) {
    const position = podPosition(hero, t);
    const descent = smoothstep((t - fleetEnd) / (touchdown - fleetEnd));
    const intimacy = smoothstep((t - touchdown) / 3);
    const composition = foundingSiteComposition(hero, 0);
    const target = t < touchdown ? { ...position, y: position.y - 0.15 }
      : mixPoint({ x: hero.position.x, y: hero.groundY + 0.6, z: hero.position.z }, composition.target, intimacy);
    const radius = t < touchdown ? lerp(11, 5.5, descent) : lerp(5.5, 1.85, intimacy);
    const height = t < touchdown ? lerp(4, 1.7, descent) : lerp(1.7, 0.92, intimacy);
    const wideCamera = { x: hero.position.x + radius * 0.48, y: target.y + height, z: hero.position.z - radius };
    return { beat: t < touchdown ? 'descent' : t < touchdown + 0.8 ? 'touchdown' : t < firstSteps ? 'doorway' : 'first-steps',
      shotId: 'hero', target, cameraPosition: t < touchdown ? mixPoint(opening.camera, wideCamera, descent) : mixPoint(wideCamera, composition.closeCamera, intimacy),
      radius, height, transitionSeconds: t < touchdown ? 0.65 : 0.45, azimuthOffset: 0, fov: lerp(36, 32, intimacy), siteIndex: 0 };
  }


  const composition = foundingSiteComposition(hero, 0);
  return { beat: 'handoff', shotId: 'hero', target: composition.target, cameraPosition: composition.closeCamera,
    radius: 1.85, height: 0.92, transitionSeconds: 0.5, azimuthOffset: 0, fov: 32, siteIndex: 0 };
}
