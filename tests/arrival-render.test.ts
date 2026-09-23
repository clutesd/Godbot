import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { FoundingPodRenderer } from '../src/render/founding/FoundingPodRenderer';
import { FOUNDING_HEARTH_DISTANCE, FOUNDING_HEARTH_RESERVE_RADIUS, FOUNDING_VESSEL_KEEP_OUT_RADIUS, foundingHearthEstablished, foundingHearthOffset, foundingHearthWorldPosition, foundingSettlementHearthOffset } from '../src/shared/FoundingCampLayout';
import { arrivalCaption, arrivalSequenceFocus, foundingArrivalDialogue } from '../src/render/founding/ArrivalPresentation';
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
  it('keeps the central Arrival cinematic through the human anchors, then releases it', () => {
    expect(foundingArrivalDialogue(undefined, 'Elsewhere', 'Ordinary history')).toBeUndefined();
    expect(foundingArrivalDialogue('worker:someone', 'A worker', 'Ordinary history')).toBeUndefined();
    expect(foundingArrivalDialogue('founding:overview:event-1', 'ARRIVAL DAY · THE 5 LANDINGS', 'Five communities begin.')).toEqual({
      eyebrow: 'ARRIVAL DAY · ORIENTATION',
      title: 'ARRIVAL DAY · THE 5 LANDINGS',
      text: 'Five communities begin.',
    });
    expect(foundingArrivalDialogue('founding:community:2:pod-3', 'Riverhold · THIRD VESSEL', 'Riverhold began here.')).toEqual({
      eyebrow: 'ARRIVAL DAY · CONTRAST',
      title: 'Riverhold · THIRD VESSEL',
      text: 'Riverhold began here.',
    });
    expect(foundingArrivalDialogue('founding-cast:framing:event-1', 'A FEW LIVES', 'We will follow only a few.')).toBeUndefined();
    expect(foundingArrivalDialogue('founding-cast:introduction:0:person-1', 'Mara · Seed', '23 on Arrival Day.')).toEqual({
      eyebrow: 'ARRIVAL DAY · A FOUNDER',
      title: 'Mara · Seed',
      text: '23 on Arrival Day.',
    });
    expect(foundingArrivalDialogue('founding-release:event-1', 'THE FIRST DAY', 'The first day continues.')).toBeUndefined();
  });

  it('keeps founding hearths beside the vessel instead of under its footprint', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    const spokeStep = Math.PI / 8;
    for (const pod of s.state.arrival!.pods) {
      const offset = foundingHearthOffset(pod);
      const distance = Math.hypot(offset.x, offset.z);
      expect(distance).toBeCloseTo(FOUNDING_HEARTH_DISTANCE, 8);
      expect(distance).toBeGreaterThan(FOUNDING_VESSEL_KEEP_OUT_RADIUS + 1);
      expect(distance).toBeLessThan(3);
      const spoke = Math.atan2(offset.z, offset.x) / spokeStep;
      expect(Math.abs(spoke - Math.round(spoke))).toBeLessThan(1e-8);

      // The fire is approximately perpendicular to the descent corridor, so it reads as a camp
      // beside the landed artifact rather than something placed in its approach/egress line.
      const approachLength = Math.hypot(pod.entryOffset.x, pod.entryOffset.z);
      const dot = (-pod.entryOffset.x / approachLength) * (offset.x / distance)
        + (-pod.entryOffset.z / approachLength) * (offset.z / distance);
      expect(Math.abs(dot)).toBeLessThan(0.21);
    }
  });

  it('reserves future hearth ground without claiming the hearth exists at touchdown', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    s.advanceArrival(46);
    const founding = s.state.settlements.filter(settlement => settlement.foundingPodId);
    expect(founding).toHaveLength(5);
    expect(founding.every(settlement => !foundingHearthEstablished(settlement))).toBe(true);

    const achieved = founding[0]!;
    achieved.survival ??= {
      observations: {}, deprivation: 0, exposureDose: 0,
      cold: { severity: 0, shelterCoverage: 1, fuelNeed: 0, fuelUsed: 0, exposure: 0 },
      experience: {}, nextDecisionMonth: 0, lastConsequenceMonth: -120, lastSpecializationMonth: -120,
      reassignedLabour: 0, lastResolvedMonth: -1,
    };
    achieved.survival.firstFire = { month: 2, eventId: 'first-fire:test' };
    expect(foundingHearthEstablished(achieved)).toBe(true);
    expect(founding.slice(1).every(settlement => !foundingHearthEstablished(settlement))).toBe(true);
  });

  it('resolves every founding-camp fire system to the same off-vessel hearth', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    for (const pod of s.state.arrival!.pods) {
      const settlement = { foundingPodId: pod.id };
      expect(foundingSettlementHearthOffset(settlement, s.state.arrival!.pods)).toEqual(foundingHearthOffset(pod));
    }
    expect(foundingSettlementHearthOffset({}, s.state.arrival!.pods)).toBeUndefined();
    const settlement = s.state.settlements.find(candidate => candidate.foundingPodId === s.state.arrival!.pods[0]!.id);
    // Before settlement emergence this may be absent; the reserve itself remains deliberately large enough
    // for the stone ring plus people tending it.
    expect(FOUNDING_HEARTH_RESERVE_RADIUS).toBeGreaterThan(0.75);
    if (settlement) expect(foundingHearthWorldPosition(settlement, s.state.arrival!.pods)).toBeDefined();
  });

  it('brakes into authoritative ground and keeps focus/caption values finite', () => {
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
      const focus = arrivalSequenceFocus(s.state.arrival!);
      expect([focus.target.x, focus.target.y, focus.target.z].every(Number.isFinite)).toBe(true);
      expect(['pristine', 'descent', 'touchdown', 'handoff']).toContain(focus.beat);
      const caption = arrivalCaption(second);
      expect(caption.opacity).toBeGreaterThanOrEqual(0);
      expect(caption.opacity).toBeLessThanOrEqual(1);
    }
  });
});
