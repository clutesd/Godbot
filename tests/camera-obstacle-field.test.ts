import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CameraFrameWatchdog,
  CameraObstacleField,
  assessFrame,
  chooseExteriorAnchor,
  combineCameraProbes,
  type CameraObstacleBox,
  type FrameSample,
} from '../src/render/CameraObstacleField';

const building = (over: Partial<CameraObstacleBox> = {}): CameraObstacleBox => ({
  id: 'hall', kind: 'building', worldX: 0, worldZ: 0, halfWidth: 2, halfDepth: 1.5, rotationY: 0,
  baseY: 0, eaveY: 2.2, topY: 3.4, overhang: 0.5, entrance: true, ...over,
});
const fieldOf = (...boxes: CameraObstacleBox[]): CameraObstacleField => {
  const field = new CameraObstacleField();
  field.set(boxes);
  return field;
};
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

describe('camera obstacle field geometry', () => {
  it('treats walls as hard and lets the lens sit outside them, including rotated buildings', () => {
    const field = fieldOf(building());
    expect(field.probe(v(0, 1, 0), 0.12)).toBeGreaterThan(2);
    expect(field.probe(v(2.05, 1, 0), 0.12)).toBeGreaterThan(2);
    expect(field.probe(v(2.7, 1, 0), 0.12)).toBe(0);
    expect(field.probe(v(0, 3.7, 0), 0.12)).toBe(0);

    const turned = fieldOf(building({ rotationY: Math.PI / 2 }));
    // A quarter turn swaps the extents: depth (1.5) now runs along world X, width (2) along world Z.
    expect(turned.probe(v(1.4, 1, 0), 0)).toBeGreaterThan(2);
    expect(turned.probe(v(1.6, 1, 0), 0)).toBe(0);
    expect(turned.probe(v(0, 1, 1.9), 0)).toBeGreaterThan(2);
  });

  it('models roof overhang as a wider cap above a narrower body', () => {
    const field = fieldOf(building());
    // Beside the wall and below the eave is open air, but it is covered ground...
    expect(field.probe(v(2.4, 1, 0), 0.12)).toBe(0);
    expect(field.coveredAbove(v(2.4, 1, 0))).toBe(true);
    expect(field.coveredAbove(v(3.4, 1, 0))).toBe(false);
    // ...while the same lateral position at roof height is inside the overhanging roof.
    expect(field.probe(v(2.4, 2.6, 0), 0.12)).toBeGreaterThan(2);
    // Rays see the roof cap before the wall body.
    expect(field.rayHit(v(8, 1, 0), v(-1, 0, 0), 20)).toBeCloseTo(6, 5);
    expect(field.rayHit(v(8, 2.6, 0), v(-1, 0, 0), 20)).toBeCloseTo(5.5, 5);
    expect(field.rayHit(v(8, 4.5, 0), v(-1, 0, 0), 20)).toBeUndefined();
  });

  it('checks segments without letting a façade target block itself', () => {
    const field = fieldOf(building());
    expect(field.segmentBlocked(v(0, 1, 8), v(0, 1, -8))).toBe(true);
    expect(field.segmentBlocked(v(0, 1, 8), v(0, 1, 2.25))).toBe(false);
    expect(field.segmentBlocked(v(0, 1, 8), v(0, 1, 1.5))).toBe(false);
  });

  it('combines probes by strongest obstruction', () => {
    const combined = combineCameraProbes(undefined, () => 0.5, () => 2)!;
    expect(combined(v(0, 0, 0), 0)).toBe(2);
    expect(combineCameraProbes(undefined, undefined)).toBeUndefined();
  });
});

describe('meaningful exterior anchors', () => {
  const request = {
    focusX: 1, focusZ: 0, viewerX: 0, viewerZ: 20, searchRadius: 10, seed: 'scene', kind: 'institution-exterior' as const,
  };

  it('frames an entrance that faces the lens instead of the plot centre', () => {
    const field = fieldOf(building());
    const anchor = chooseExteriorAnchor(field, request)!;
    expect(anchor.feature).toBe('entrance');
    expect(Math.hypot(anchor.x, anchor.z)).toBeGreaterThan(1.5);
    expect(anchor.y).toBeGreaterThan(0.6);
    expect(anchor.y).toBeLessThan(1.3);
    expect(Math.cos(anchor.azimuth) * (request.viewerX - anchor.x) + Math.sin(anchor.azimuth) * (request.viewerZ - anchor.z)).toBeGreaterThan(0);
    expect(anchor.minStandoff).toBeGreaterThan(Math.hypot(2.5, 2) - 0.1);
  });

  it('shows the readable side when the entrance faces away from the approach', () => {
    const anchor = chooseExteriorAnchor(fieldOf(building()), { ...request, viewerZ: -20 })!;
    expect(anchor.feature).toBe('facade');
    expect(anchor.z).toBeLessThan(0);
  });

  it('is drawn to visible work and to machinery rather than to the nearest quiet wall', () => {
    const quiet = building({ id: 'quiet', worldX: 0 });
    const site = building({ id: 'site', kind: 'scaffold', worldX: 6, activity: 1, entrance: false });
    const yard = chooseExteriorAnchor(fieldOf(quiet, site), { ...request, kind: 'settlement-approach', focusX: 3 })!;
    expect(yard.boxId).toBe('site');
    expect(yard.feature).toBe('work-yard');

    const plant: CameraObstacleBox = building({ id: 'plant', kind: 'infrastructure', halfWidth: 1.2, halfDepth: 1.2, overhang: 0, topY: 3.4, eaveY: 3, activity: 0.5 });
    const machine = chooseExteriorAnchor(fieldOf(plant), { ...request, kind: 'infrastructure-scene', focusX: 0 })!;
    expect(machine.feature).toBe('machinery');
    expect(machine.y).toBeGreaterThan(1);
  });

  it('is deterministic and rotates to another building once one has been used', () => {
    const a = building({ id: 'a', worldX: -3 });
    const b = building({ id: 'b', worldX: 3 });
    const field = fieldOf(a, b);
    const first = chooseExteriorAnchor(field, { ...request, focusX: 0 })!;
    expect(chooseExteriorAnchor(field, { ...request, focusX: 0 })).toEqual(first);
    const second = chooseExteriorAnchor(field, { ...request, focusX: 0, avoid: new Set([first.boxId]) })!;
    expect(second.boxId).not.toBe(first.boxId);
  });
});

describe('frame assessment', () => {
  it('accepts a clean façade view from a comfortable distance', () => {
    const field = fieldOf(building());
    const frame = assessFrame(field, v(0, 1.3, 9), v(0, 1, 2.25));
    expect(frame.dominance).toBe(0);
    expect(frame.obstructed).toBe(false);
    expect(frame.dominated).toBe(false);
    expect(frame.quality).toBeGreaterThan(0.9);
  });

  it('flags a wall filling the frame and a subject hidden behind it', () => {
    const field = fieldOf(building());
    const frame = assessFrame(field, v(0, 1.2, 2.1), v(0, 1, -8), { subjects: [v(0, 1, -8)] });
    expect(frame.dominated).toBe(true);
    expect(frame.obstructed).toBe(true);
    expect(frame.quality).toBeLessThan(0.3);
  });

  it('flags a lens pressed beside a wall even though nothing covers the subject', () => {
    const field = fieldOf(building({ halfDepth: 6 }));
    const frame = assessFrame(field, v(2.6, 1.2, 0), v(2.6, 1.2, -8), { subjects: [v(2.6, 1.2, -8)] });
    expect(frame.obstructed).toBe(false);
    expect(frame.dominated).toBe(true);
    expect(frame.quality).toBeLessThan(0.78);
  });

  it('flags a lens standing under an overhang with the wall dominating', () => {
    const field = fieldOf(building({ halfDepth: 6, overhang: 1.2 }));
    const trapped = assessFrame(field, v(2.5, 1.2, 0), v(2.5, 1.2, -8), { subjects: [v(2.5, 1.2, -8)] });
    expect(trapped.covered).toBe(true);
    expect(trapped.dominated).toBe(true);
    expect(trapped.quality).toBeLessThan(0.5);
    // Standing near the eave edge is merely cramped: covered and never "strong", but not a trap.
    const cramped = assessFrame(field, v(2.9, 1.2, 0), v(2.9, 1.2, -8), { subjects: [v(2.9, 1.2, -8)] });
    expect(cramped.covered).toBe(true);
    expect(cramped.dominated).toBe(false);
    expect(cramped.quality).toBeLessThan(0.78);
    expect(cramped.quality).toBeGreaterThan(trapped.quality);
  });

  it('counts soft foliage toward dominance without making it a hard collision', () => {
    const field = fieldOf();
    const foliage = (p: THREE.Vector3): number => (p.z < 0 && p.z > -1.5 ? 3 : 0);
    const open = assessFrame(field, v(0, 1, 2), v(0, 1, -4));
    const leafy = assessFrame(field, v(0, 1, 0.2), v(0, 1, -4), { softProbe: foliage });
    expect(open.dominance).toBe(0);
    expect(leafy.dominance).toBeGreaterThan(0.2);
    expect(field.probe(v(0, 1, -1), 0.12)).toBe(0);
  });
});

describe('bad-frame watchdog', () => {
  const good: FrameSample = { quality: 0.92, obstructed: false, dominated: false, speed: 0.04, corrected: false };
  const run = (watchdog: CameraFrameWatchdog, seconds: number, sample: FrameSample | ((t: number) => FrameSample)): string[] => {
    const verdicts: string[] = [];
    for (let t = 0; t < seconds; t += 0.2) {
      verdicts.push(watchdog.update(0.2, typeof sample === 'function' ? sample(t) : sample));
    }
    return verdicts;
  };

  it('never disturbs a strong static shot, however long it holds, and reports stillness', () => {
    const watchdog = new CameraFrameWatchdog();
    const verdicts = run(watchdog, 120, t => ({ ...good, quality: 0.9 + Math.sin(t) * 0.03, speed: 0.03 + Math.abs(Math.sin(t * 0.16)) * 0.05 }));
    expect(new Set(verdicts)).toEqual(new Set(['ok']));
    expect(watchdog.goodSeconds).toBeGreaterThan(100);
  });

  it('asks for exactly one reframe after a sustained obstruction, then retires the shot', () => {
    const watchdog = new CameraFrameWatchdog();
    const blocked: FrameSample = { quality: 0.2, obstructed: true, dominated: true, speed: 0.05, corrected: true };
    const verdicts = run(watchdog, 12, blocked);
    const firstReframe = verdicts.indexOf('reframe');
    const retire = verdicts.indexOf('retire');
    expect(firstReframe).toBeGreaterThan(0);
    expect(firstReframe * 0.2).toBeLessThan(3.2);
    expect(verdicts.filter(verdict => verdict === 'reframe')).toHaveLength(1);
    expect(retire).toBeGreaterThan(firstReframe);
    expect((retire - firstReframe) * 0.2).toBeGreaterThan(1.5);
  });

  it('treats repeated tiny corrections without composition improvement as a failed frame', () => {
    const watchdog = new CameraFrameWatchdog();
    const jitter: FrameSample = { quality: 0.55, obstructed: false, dominated: false, speed: 0.06, corrected: true };
    const verdicts = run(watchdog, 14, jitter);
    expect(verdicts).toContain('reframe');
    expect(verdicts).toContain('retire');
    expect(verdicts.indexOf('reframe') * 0.2).toBeGreaterThan(2.5);
  });

  it('is patient with a lens that is genuinely improving', () => {
    const watchdog = new CameraFrameWatchdog();
    const recovering = (t: number): FrameSample => ({ quality: Math.min(0.9, 0.3 + t * 0.12), obstructed: false, dominated: false, speed: 0.1, corrected: true });
    expect(new Set(run(watchdog, 6, recovering))).toEqual(new Set(['ok']));
  });

  it('forgives brief occlusions (a passing crowd or cart) instead of reframing', () => {
    const watchdog = new CameraFrameWatchdog();
    const verdicts = run(watchdog, 30, t => (t % 6 < 0.8
      ? { quality: 0.3, obstructed: true, dominated: false, speed: 0.02, corrected: false } : good));
    expect(new Set(verdicts)).toEqual(new Set(['ok']));
  });

  it('is deterministic for an identical sample stream', () => {
    const stream = (t: number): FrameSample => ({ quality: t < 4 ? 0.9 : 0.25, obstructed: t >= 4, dominated: t >= 4, speed: 0.05, corrected: t >= 4 });
    expect(run(new CameraFrameWatchdog(), 20, stream)).toEqual(run(new CameraFrameWatchdog(), 20, stream));
  });
});
