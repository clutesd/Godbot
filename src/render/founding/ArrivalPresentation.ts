import { podPosition, podTouchdown, type FoundingArrivalState } from '../../sim/founding/FoundingArrival';

export const WATCHER_LINES = [
  { start: 2.5, end: 8.5, text: 'Before them, only the world.' },
  { start: 13.5, end: 19.5, text: 'Five vessels entered the sky.' },
  { start: 34, end: 40, text: 'Five landings. Five beginnings.' },
  { start: 72, end: 77, text: 'ARRIVAL DAY' },
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
    const composition = foundingSiteComposition(pod, siteIndex);
    const local = clamp01((t - siteStart - siteIndex * siteSeconds) / siteSeconds);

    // Site zero is already under the lens after touchdown, so it gets an especially long first
    // look. Later sites use a three-part film grammar: shallow scenic transit, deliberate descent,
    // then a true hold where the camera stops moving and lets the founders read.
    if (siteIndex === 0) {
      const approachEnd = 0.34;
      if (local < approachEnd) {
        const approach = smoothstep(local / approachEnd);
        return {
          beat: 'site-flythrough',
          target: composition.target,
          cameraPosition: mixPoint(composition.stagingCamera, composition.closeCamera, approach),
          radius: lerp(4.8, 1.85, approach),
          height: lerp(3.2, 0.92, approach),
          transitionSeconds: 1.8,
          azimuthOffset: 0,
          fov: lerp(34, 31, approach),
          siteIndex,
        };
      }
      return {
        beat: 'site-flythrough',
        target: composition.target,
        cameraPosition: composition.closeCamera,
        radius: 1.85,
        height: 0.92,
        transitionSeconds: 1.2,
        azimuthOffset: 0,
        fov: 31,
        siteIndex,
      };
    }

    const previous = foundingSiteComposition(arrival.pods[siteIndex - 1]!, siteIndex - 1);
    const transitEnd = 0.5;
    const approachEnd = 0.75;

    if (local < transitEnd) {
      const transit = smoothstep(local / transitEnd);
      const transitCamera = mixPoint(previous.closeCamera, composition.stagingCamera, transit);
      // A shallow crane arc clears ordinary terrain/foliage without ever becoming an aerial reset.
      transitCamera.y += Math.sin(transit * Math.PI) * 3.8;
      return {
        beat: 'site-flythrough',
        target: mixPoint(previous.target, composition.target, transit),
        cameraPosition: transitCamera,
        radius: lerp(1.85, 5.1, transit),
        height: transitCamera.y - lerp(previous.target.y, composition.target.y, transit),
        transitionSeconds: 1.7,
        azimuthOffset: 0,
        fov: lerp(31, 35, Math.sin(transit * Math.PI)),
        siteIndex,
      };
    }

    if (local < approachEnd) {
      const approach = smoothstep((local - transitEnd) / (approachEnd - transitEnd));
      return {
        beat: 'site-flythrough',
        target: composition.target,
        cameraPosition: mixPoint(composition.stagingCamera, composition.closeCamera, approach),
        radius: lerp(5.1, 1.85, approach),
        height: lerp(3.2, 0.92, approach),
        transitionSeconds: 1.8,
        azimuthOffset: 0,
        fov: lerp(34, 31, approach),
        siteIndex,
      };
    }

    return {
      beat: 'site-flythrough',
      target: composition.target,
      cameraPosition: composition.closeCamera,
      radius: 1.85,
      height: 0.92,
      transitionSeconds: 1.2,
      azimuthOffset: 0,
      fov: 31,
      siteIndex,
    };
  }

  const handoff = smoothstep((t - siteEnd) / Math.max(0.1, 78 - siteEnd));
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
