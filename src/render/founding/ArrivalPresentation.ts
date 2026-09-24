import { podPosition, podTouchdown, type FoundingArrivalState } from '../../sim/founding/FoundingArrival';

export const WATCHER_LINES = [
  { start: 2.5, end: 8.5, text: 'Before them, only the world.' },
  { start: 13.5, end: 19.5, text: 'Five vessels entered the sky.' },
  { start: 34, end: 40, text: 'Five landings. Five beginnings.' },
  { start: 73, end: 79, text: 'ARRIVAL DAY' },
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

export type ArrivalSequenceBeat = 'pristine' | 'descent' | 'touchdown' | 'site-flythrough' | 'handoff';

export interface ArrivalSequenceFocus {
  readonly beat: ArrivalSequenceBeat;
  readonly target: Readonly<{ x: number; y: number; z: number }>;
  readonly radius: number;
  readonly height: number;
  readonly transitionSeconds: number;
  readonly azimuthOffset: number;
  readonly fov: number;
  readonly siteIndex?: number;
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
 * Arrival is an authored short film rather than a surveillance pass. It establishes the untouched
 * world, follows the first vessel into touchdown, then drops to human scale and physically visits
 * all five founding sites. Each site gets a slow approach and a readable linger before the camera
 * leaves. Only after the people have been seen does the lens rise back to the world-scale handoff.
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
      fov: 38,
    };
  }

  const heroPosition = podPosition(hero, t);
  const touchdown = podTouchdown(hero);
  const heroTarget = {
    x: heroPosition.x,
    y: t < touchdown ? heroPosition.y : hero.groundY + 0.55,
    z: heroPosition.z,
  };

  if (t < 16.5) {
    const reveal = smoothstep((t - 12.5) / 4);
    return {
      beat: 'descent',
      target: mixPoint(worldTarget, heroTarget, reveal),
      radius: lerp(52, 21, reveal),
      height: lerp(37, 11.5, reveal),
      transitionSeconds: 3.8,
      azimuthOffset: lerp(-0.04, 0.03, reveal),
      fov: lerp(38, 36, reveal),
    };
  }

  if (t < touchdown) {
    const descent = smoothstep((t - 16.5) / Math.max(0.1, touchdown - 16.5));
    return {
      beat: 'descent',
      target: heroTarget,
      radius: lerp(21, 10.5, descent),
      height: lerp(11.5, 4.1, descent),
      transitionSeconds: 3.2,
      azimuthOffset: lerp(0.03, 0.1, descent),
      fov: lerp(36, 34, descent),
    };
  }

  if (t < 30) {
    const settle = smoothstep((t - touchdown) / Math.max(0.1, 30 - touchdown));
    return {
      beat: 'touchdown',
      target: {
        x: hero.position.x,
        y: hero.groundY + lerp(0.55, 0.28, settle),
        z: hero.position.z,
      },
      radius: lerp(10.5, 6.2, settle),
      height: lerp(4.1, 1.85, settle),
      transitionSeconds: 3.2,
      azimuthOffset: lerp(0.1, 0.16, settle),
      fov: lerp(34, 32, settle),
      siteIndex: 0,
    };
  }

  const siteStart = 30;
  const siteSeconds = 8;
  const siteCount = arrival.pods.length;
  const siteEnd = siteStart + siteSeconds * siteCount;
  if (siteCount && t < siteEnd) {
    const rawIndex = Math.floor((t - siteStart) / siteSeconds);
    const siteIndex = Math.min(siteCount - 1, Math.max(0, rawIndex));
    const pod = arrival.pods[siteIndex]!;
    const previous = siteIndex === 0 ? hero : arrival.pods[siteIndex - 1]!;
    const local = clamp01((t - siteStart - siteIndex * siteSeconds) / siteSeconds);
    const transferEnd = 0.4;
    const transfer = smoothstep(local / transferEnd);
    const linger = smoothstep((local - transferEnd) / (1 - transferEnd));

    // Aim just outside the hull where the founder ring emerges. This lets vessel and people share
    // the frame without placing the bronze artifact directly between the lens and its inhabitants.
    const pathLength = Math.max(0.001, Math.hypot(pod.entryOffset.x, pod.entryOffset.z));
    const side = siteIndex % 2 === 0 ? 1 : -1;
    const sideX = -pod.entryOffset.z / pathLength * side;
    const sideZ = pod.entryOffset.x / pathLength * side;
    const siteTarget = {
      x: pod.position.x + sideX * 1.35,
      y: pod.groundY + 0.2,
      z: pod.position.z + sideZ * 1.35,
    };

    const previousPathLength = Math.max(0.001, Math.hypot(previous.entryOffset.x, previous.entryOffset.z));
    const previousSide = (siteIndex - 1) % 2 === 0 ? 1 : -1;
    const previousTarget = siteIndex === 0
      ? { x: hero.position.x, y: hero.groundY + 0.28, z: hero.position.z }
      : {
          x: previous.position.x - previous.entryOffset.z / previousPathLength * previousSide * 1.35,
          y: previous.groundY + 0.2,
          z: previous.position.z + previous.entryOffset.x / previousPathLength * previousSide * 1.35,
        };

    const siteAzimuth = [0.2, -0.22, 0.29, -0.18, 0.24][siteIndex] ?? 0.16;
    return {
      beat: 'site-flythrough',
      target: mixPoint(previousTarget, siteTarget, transfer),
      radius: local < transferEnd ? lerp(6.2, 6.8, transfer) : lerp(6.8, 4.15, linger),
      height: local < transferEnd ? lerp(1.85, 2.3, transfer) : lerp(2.3, 1.05, linger),
      transitionSeconds: local < transferEnd ? 3.4 : 4.1,
      azimuthOffset: siteAzimuth + (linger - 0.5) * 0.1,
      fov: local < transferEnd ? lerp(32, 34, transfer) : lerp(34, 30.5, linger),
      siteIndex,
    };
  }

  const handoff = smoothstep((t - siteEnd) / Math.max(0.1, 80 - siteEnd));
  const last = arrival.pods[siteCount - 1] ?? hero;
  const lastTarget = { x: last.position.x, y: last.groundY + 0.3, z: last.position.z };
  return {
    beat: 'handoff',
    target: mixPoint(lastTarget, worldTarget, handoff),
    radius: lerp(5.2, 54, handoff),
    height: lerp(1.6, 32, handoff),
    transitionSeconds: lerp(4.2, 5.2, handoff),
    azimuthOffset: lerp(0.2, 0.02, handoff),
    fov: lerp(31, 38, handoff),
  };
}
