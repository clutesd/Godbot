import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { FoundingPodRenderer } from '../src/render/founding/FoundingPodRenderer';
import { arrivalCameraPose, arrivalCaption, foundingArrivalDialogue } from '../src/render/founding/ArrivalPresentation';
import { podPosition, podTouchdown } from '../src/sim/founding/FoundingArrival';

describe('Arrival presentation contracts', () => {
  it('bounds effect buffers and retires them leaving five persistent hulls', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    const scene = new THREE.Scene();
    const view = new FoundingPodRenderer(s.state); scene.add(view.root);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(35, 40, 50);
    view.update(camera);
    expect(view.root.children.filter(o => o instanceof THREE.Group && o.visible)).toHaveLength(0);
    const objects = [...view.root.children];
    for (let i = 0; i < 450; i++) { s.advanceArrival(0.1); view.update(camera); }
    expect(view.root.children).toEqual(objects);
    s.advanceArrival(1.1); view.update(camera);
    expect(view.root.children).toHaveLength(5);
    expect(view.root.children.every(o => o.visible && o.userData.podId)).toBe(true);
    const pods = [...view.root.children];
    for (let i = 0; i < 100; i++) view.update(camera);
    expect(view.root.children).toEqual(pods);
    view.dispose();
    expect(scene.children).toHaveLength(0);
    expect(view.root.children).toHaveLength(0);
  }, 10000);
  it('routes only the one-time founding chapter into Arrival Day cinematic dialogue', () => {
    expect(foundingArrivalDialogue(undefined, 'Elsewhere', 'Ordinary history')).toBeUndefined();
    expect(foundingArrivalDialogue('worker:someone', 'A worker', 'Ordinary history')).toBeUndefined();
    expect(foundingArrivalDialogue('founding:overview:event-1', 'ARRIVAL DAY · THE 5 LANDINGS', 'Five communities begin.')).toEqual({
      eyebrow: 'ARRIVAL DAY · ORIENTATION',
      title: 'ARRIVAL DAY · THE 5 LANDINGS',
      text: 'Five communities begin.',
    });
    expect(foundingArrivalDialogue('founding:community:pod-3', 'Riverhold · THIRD VESSEL', 'Riverhold began here.')).toEqual({
      eyebrow: 'ARRIVAL DAY · FOUNDING COMMUNITY',
      title: 'Riverhold · THIRD VESSEL',
      text: 'Riverhold began here.',
    });
  });

  it('brakes into authoritative ground and keeps camera/caption values finite', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    for (const pod of s.state.arrival!.pods) {
      const finish = podTouchdown(pod);
      const early = podPosition(pod, pod.entrySeconds).y - podPosition(pod, pod.entrySeconds + 1).y;
      const late = podPosition(pod, finish - 1).y - podPosition(pod, finish).y;
      expect(early).toBeGreaterThan(late * 5);
      expect(podPosition(pod, finish + 5)).toEqual(podPosition(pod, finish));
    }
    expect(new Set(s.state.arrival!.pods.map(p => p.entrySeconds)).size).toBe(5);
    for (let second = 0; second <= 46; second++) {
      s.state.arrival!.elapsedSeconds = second;
      const pose = arrivalCameraPose(s.state.arrival!);
      expect([...pose.position.toArray(), ...pose.target.toArray()].every(Number.isFinite)).toBe(true);
      const caption = arrivalCaption(second);
      expect(caption.opacity).toBeGreaterThanOrEqual(0);
      expect(caption.opacity).toBeLessThanOrEqual(1);
    }
  });
});
