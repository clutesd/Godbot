import { podPosition, podTouchdown, type FoundingArrivalState } from '../../sim/founding/FoundingArrival';

export const WATCHER_LINES = [
  { start: 2.5, end: 7.5, text: 'Before them, only the world.' },
  { start: 11.5, end: 16.5, text: 'Five vessels entered the sky.' },
  { start: 27, end: 34, text: 'Five landings. Five beginnings.' },
  { start: 41.5, end: 45.5, text: 'ARRIVAL DAY' },
] as const;

export function arrivalCaption(seconds: number): { text: string; opacity: number } {
  const line = WATCHER_LINES.find(l => seconds >= l.start && seconds <= l.end);
  return line ? { text: line.text, opacity: Math.min(1, (seconds - line.start) / 1.05, (line.end - seconds) / 0.9) } : { text: '', opacity: 0 };
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
    eyebrow: sceneId.startsWith('founding:community:')
      ? 'ARRIVAL DAY · CONTRAST'
      : 'ARRIVAL DAY · ORIENTATION',
    title,
    text,
  };
}

export type ArrivalSequenceBeat = 'pristine' | 'descent' | 'touchdown' | 'handoff';

export interface ArrivalSequenceFocus {
  readonly beat: ArrivalSequenceBeat;
  readonly anchorId: string;
  readonly target: Readonly<{ x: number; y: number; z: number }>;
}

/**
 * The opening no longer owns a bespoke camera spline. It only tells CameraDirector what matters
 * right now; the normal camera spring and safety authority decide how to photograph it.
 */
export function arrivalSequenceFocus(arrival: FoundingArrivalState): ArrivalSequenceFocus {
  const t = arrival.elapsedSeconds;
  const center = arrival.pods.reduce(
    (sum, pod) => ({
      x: sum.x + pod.position.x / Math.max(1, arrival.pods.length),
      y: sum.y + pod.groundY / Math.max(1, arrival.pods.length),
      z: sum.z + pod.position.z / Math.max(1, arrival.pods.length),
    }),
    { x: 0, y: 0, z: 0 },
  );

  if (t < 11.5) {
    return {
      beat: 'pristine',
      anchorId: 'world',
      target: { x: center.x, y: center.y + 1.4, z: center.z },
    };
  }

  // Deliberately resist covering all five vessels. Two representative descents read as an event;
  // five rapid subject changes read as a camera demo.
  const active = t < 24.5 ? arrival.pods[0] : t < 35 ? arrival.pods.at(-1) : undefined;

  if (active) {
    const position = podPosition(active, t);
    const touchdown = podTouchdown(active);
    const descending = t < touchdown;
    return {
      beat: descending ? 'descent' : 'touchdown',
      anchorId: active.id,
      target: {
        x: position.x,
        y: descending ? position.y : active.groundY + 1.05,
        z: position.z,
      },
    };
  }

  return {
    beat: 'handoff',
    anchorId: 'landings',
    target: { x: center.x, y: center.y + 0.9, z: center.z },
  };
}
