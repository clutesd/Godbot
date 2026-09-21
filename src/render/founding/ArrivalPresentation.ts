import * as THREE from 'three';
import { podPosition, type FoundingArrivalState } from '../../sim/founding/FoundingArrival';

export const WATCHER_LINES = [
  { start: 3, end: 8.5, text: 'No kingdoms yet stood here.' },
  { start: 9, end: 13, text: 'No roads crossed the land.' },
  { start: 15, end: 21, text: 'Five vessels crossed the silent sky.' },
  { start: 23, end: 30, text: 'They carried memory, knowledge, fear — and the first seeds of history.' },
  { start: 37, end: 42, text: 'What follows will belong to them.' },
  { start: 42.5, end: 46, text: 'ARRIVAL DAY' },
] as const;

export function arrivalCaption(seconds: number): { text: string; opacity: number } {
  const line = WATCHER_LINES.find(l => seconds >= l.start && seconds <= l.end);
  return line ? { text: line.text, opacity: Math.min(1, (seconds - line.start) / 1.2, (line.end - seconds) / 1.1) } : { text: '', opacity: 0 };
}

export interface FoundingArrivalDialogue {
  eyebrow: string;
  title: string;
  text: string;
}

/**
 * The one-time FoundingChapter remains Historian-grounded, but its Year-Zero orientation beats
 * belong to the Arrival cinematic rather than the ordinary Watcher HUD.
 */
export function foundingArrivalDialogue(
  sceneId: string | undefined,
  title: string,
  text: string,
): FoundingArrivalDialogue | undefined {
  if (!sceneId?.startsWith('founding:')) return undefined;
  return {
    eyebrow: sceneId.startsWith('founding:community:')
      ? 'ARRIVAL DAY · FOUNDING COMMUNITY'
      : 'ARRIVAL DAY · ORIENTATION',
    title,
    text,
  };
}

/** Slow compositions blend through the existing camera controller, without time-based timers. */
export function arrivalCameraPose(arrival: FoundingArrivalState): { position: THREE.Vector3; target: THREE.Vector3 } {
  const t = arrival.elapsedSeconds;
  const first = arrival.pods[0]!;
  const last = arrival.pods[4]!;
  const center = arrival.pods.reduce((v, p) => v.add(new THREE.Vector3(p.position.x / 5, p.groundY / 5, p.position.z / 5)), new THREE.Vector3());
  const spread = Math.max(30, ...arrival.pods.map(p => Math.hypot(p.position.x - center.x, p.position.z - center.z)));
  const wide = center.clone().add(new THREE.Vector3(spread * 0.65, spread * 0.72, spread * 0.95));
  const p = podPosition(first, t);
  const ground = new THREE.Vector3(first.position.x, first.groundY + 1, first.position.z);
  const lastGround = new THREE.Vector3(last.position.x, last.groundY + 1, last.position.z);
  const shots = [
    { t: 0, position: wide, target: center },
    { t: 12, position: wide.clone().add(new THREE.Vector3(4, 1, -3)), target: center.clone().add(new THREE.Vector3(0, 2, 0)) },
    { t: 18, position: wide.clone().add(new THREE.Vector3(3, 8, 0)), target: center.clone().add(new THREE.Vector3(0, 17, 0)) },
    { t: 25, position: ground.clone().add(new THREE.Vector3(15, 10, 19)), target: new THREE.Vector3(p.x, Math.max(ground.y, p.y), p.z) },
    { t: 30, position: ground.clone().add(new THREE.Vector3(12, 8, 16)), target: ground },
    { t: 35, position: wide.clone().add(new THREE.Vector3(-8, 4, -4)), target: center.clone().add(new THREE.Vector3(0, 4, 0)) },
    { t: 40, position: lastGround.clone().add(new THREE.Vector3(10, 7, -15)), target: lastGround },
    { t: 43, position: lastGround.clone().add(new THREE.Vector3(11, 8, -16)), target: lastGround },
    { t: 46, position: lastGround.clone().add(new THREE.Vector3(18, 16, -22)), target: lastGround },
  ];
  const index = Math.max(0, shots.findIndex((s, i) => i < shots.length - 1 && t >= s.t && t <= shots[i + 1]!.t));
  const a = shots[index]!;
  const b = shots[index + 1]!;
  const f = THREE.MathUtils.smoothstep(t, a.t, b.t);
  return { position: a.position.clone().lerp(b.position, f), target: a.target.clone().lerp(b.target, f) };
}
