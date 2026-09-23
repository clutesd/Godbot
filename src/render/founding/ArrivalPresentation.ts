import { podPosition, podTouchdown, type FoundingArrivalState } from '../../sim/founding/FoundingArrival';

export const WATCHER_LINES = [
  { start: 2.5, end: 8.5, text: 'Before them, only the world.' },
  { start: 13.5, end: 19.5, text: 'Five vessels entered the sky.' },
  { start: 29, end: 36.5, text: 'Five landings. Five beginnings.' },
  { start: 41, end: 45.5, text: 'ARRIVAL DAY' },
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

export type ArrivalSequenceBeat = 'pristine' | 'descent' | 'touchdown' | 'handoff';

export interface ArrivalSequenceFocus {
  readonly beat: ArrivalSequenceBeat;
  readonly target: Readonly<{ x: number; y: number; z: number }>;
  readonly radius: number;
  readonly height: number;
  readonly transitionSeconds: number;
  readonly azimuthOffset: number;
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

/**
 * Arrival is one continuous camera idea: establish the untouched world, discover one vessel,
 * stay with it through touchdown, then gradually widen until all five landings belong to one frame.
 * No beat requires an editorial teleport; CameraDirector can keep screen direction and momentum.
 */
export function arrivalSequenceFocus(arrival: FoundingArrivalState): ArrivalSequenceFocus {
  const t = arrival.elapsedSeconds;
  const count = Math.max(1, arrival.pods.length);
  const center = arrival.pods.reduce(
    (sum, pod) => ({
      x: sum.x + pod.position.x / count,
      y: sum.y + pod.groundY / count,
      z: sum.z + pod.position.z / count,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const worldTarget = { x: center.x, y: center.y + 1.6, z: center.z };
  const hero = arrival.pods[0];

  if (!hero || t < 12.5) {
    return {
      beat: 'pristine',
      target: worldTarget,
      radius: 52,
      height: 37,
      transitionSeconds: 4.2,
      azimuthOffset: -0.04,
    };
  }

  const heroPosition = podPosition(hero, t);
  const touchdown = podTouchdown(hero);
  const heroTarget = {
    x: heroPosition.x,
    y: t < touchdown ? heroPosition.y : hero.groundY + 1.05,
    z: heroPosition.z,
  };

  if (t < 16.5) {
    const reveal = smoothstep((t - 12.5) / 4);
    return {
      beat: 'descent',
      target: mixPoint(worldTarget, heroTarget, reveal),
      radius: lerp(52, 22, reveal),
      height: lerp(37, 12, reveal),
      transitionSeconds: 3.8,
      azimuthOffset: lerp(-0.04, 0.03, reveal),
    };
  }

  if (t < touchdown) {
    const descent = smoothstep((t - 16.5) / Math.max(0.1, touchdown - 16.5));
    return {
      beat: 'descent',
      target: heroTarget,
      radius: lerp(22, 15.5, descent),
      height: lerp(12, 7.8, descent),
      transitionSeconds: 3.1,
      azimuthOffset: lerp(0.03, 0.075, descent),
    };
  }

  if (t < 29.5) {
    return {
      beat: 'touchdown',
      target: heroTarget,
      radius: 14.5,
      height: 7.2,
      transitionSeconds: 3,
      azimuthOffset: 0.075,
    };
  }

  const widen = smoothstep((t - 29.5) / 10);
  return {
    beat: 'handoff',
    target: mixPoint({ x: hero.position.x, y: hero.groundY + 1.05, z: hero.position.z }, worldTarget, widen),
    radius: lerp(14.5, 54, widen),
    height: lerp(7.2, 32, widen),
    transitionSeconds: lerp(3.1, 4.6, widen),
    azimuthOffset: lerp(0.075, 0.02, widen),
  };
}
