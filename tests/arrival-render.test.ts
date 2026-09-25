import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { FoundingPodRenderer } from '../src/render/founding/FoundingPodRenderer';
import { FOUNDING_HEARTH_DISTANCE, FOUNDING_HEARTH_RESERVE_RADIUS, FOUNDING_VESSEL_KEEP_OUT_RADIUS, foundingHearthEstablished, foundingHearthOffset, foundingHearthWorldPosition, foundingSettlementHearthOffset } from '../src/shared/FoundingCampLayout';
import { arrivalCaption, arrivalSequenceFocus, foundingArrivalDialogue } from '../src/render/founding/ArrivalPresentation';
import { arrivalRenderPolicy, arrivalVegetationAnchor } from '../src/render/founding/ArrivalRenderBudget';
import { ARRIVAL_END_SECONDS, podPosition, podTouchdown } from '../src/sim/founding/FoundingArrival';
import { OpeningHandoff } from '../src/sim/founding/OpeningHandoff';
import { CameraDirector } from '../src/render/CameraDirector';
import { Historian } from '../src/historian/Historian';

describe('Arrival presentation contracts', () => {
  it('keeps the authored prologue on a lightweight render budget until history begins', () => {
    const simulation = new Simulation({ seed: 'arrival-render-budget', startMode: 'arrival' });
    const arrival = simulation.state.arrival;
    if (!arrival) throw new Error('Expected Arrival state');

    const opening = arrivalRenderPolicy(simulation.state);
    expect(opening).toEqual({
      active: true,
      animateHumans: false,
      refreshWorldPresentation: false,
      refreshVegetationLod: false,
      updateAmbientWorldEffects: false,
    });

    arrival.elapsedSeconds = 30;
    expect(arrivalRenderPolicy(simulation.state)).toEqual({
      active: true,
      animateHumans: true,
      refreshWorldPresentation: false,
      refreshVegetationLod: true,
      updateAmbientWorldEffects: false,
    });

    const anchor = arrivalVegetationAnchor(simulation.state);
    expect(anchor).toEqual({
      x: arrival.pods[0]?.position.x,
      z: arrival.pods[0]?.position.z,
    });

    arrival.phase = 'FOUNDING_ORIENTATION';
    expect(arrivalRenderPolicy(simulation.state)).toEqual({
      active: false,
      animateHumans: true,
      refreshWorldPresentation: true,
      refreshVegetationLod: true,
      updateAmbientWorldEffects: true,
    });
    expect(arrivalVegetationAnchor(simulation.state)).toBeUndefined();

    arrival.phase = 'HISTORY_RUNNING';
    expect(arrivalRenderPolicy(simulation.state).active).toBe(false);
  });


  it('recovers the authored Arrival camera continuously from a low manual handoff', () => {
    const simulation = new Simulation({ seed: 'arrival-manual-camera-recovery', startMode: 'arrival' });
    const arrival = simulation.state.arrival;
    if (!arrival) throw new Error('Expected Arrival state');
    arrival.phase = 'ARRIVAL_SEQUENCE';
    arrival.elapsedSeconds = 20;
    for (const cell of simulation.state.world.cells) cell.wood = 0;
    for (const settlement of simulation.state.settlements) settlement.structurePlots = [];

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
    const director = new CameraDirector(
      camera,
      simulation.config,
      new Historian(simulation.config),
      undefined,
      undefined,
      () => 0,
    );

    // Let the authored Arrival camera own the lens first, then emulate manual control descending
    // below its normal lens floor.
    for (let frame = 0; frame < 30; frame += 1) {
      arrival.elapsedSeconds = 20 + frame / 60;
      director.update(1 / 60, frame / 60, simulation.state, () => 0);
    }
    camera.position.set(0, 0.25, 0);
    camera.lookAt(1, 0.25, 0);
    camera.updateMatrixWorld(true);
    const manualPosition = camera.position.clone();

    director.resumeFromExternalPose();
    expect(camera.position.distanceTo(manualPosition)).toBeLessThan(1e-9);

    arrival.elapsedSeconds += 1 / 60;
    director.update(1 / 60, 0.51, simulation.state, () => 0);
    expect(camera.position.distanceTo(manualPosition)).toBeLessThan(0.08);

    for (let frame = 1; frame <= 120; frame += 1) {
      arrival.elapsedSeconds += 1 / 60;
      director.update(1 / 60, 0.51 + frame / 60, simulation.state, () => 0);
    }

    expect(camera.position.y).toBeGreaterThan(manualPosition.y + 0.25);
    expect(camera.position.distanceTo(manualPosition)).toBeGreaterThan(0.5);
    expect(simulation.state.month).toBe(0);
    expect(simulation.historyRunning).toBe(false);
  });

  it('finishes the Arrival film into a frozen orientation before Month 1 can exist', () => {
    const simulation = new Simulation({ seed: 'arrival-orientation-authority', startMode: 'arrival' });
    simulation.advanceArrival(ARRIVAL_END_SECONDS + 10);

    expect(simulation.state.arrival?.phase).toBe('FOUNDING_ORIENTATION');
    expect(simulation.historyRunning).toBe(false);
    expect(simulation.foundingOrientationRunning).toBe(true);
    expect(simulation.state.month).toBe(0);
    expect(simulation.state.history.filter(event => event.type === 'ARRIVAL_DAY')).toHaveLength(1);

    // Even direct callers cannot accidentally start the civilization while orientation is playing.
    simulation.step(24);
    expect(simulation.state.month).toBe(0);
    expect(simulation.state.arrival?.phase).toBe('FOUNDING_ORIENTATION');

    expect(simulation.beginHistory()).toBe(true);
    expect(simulation.historyRunning).toBe(true);
    expect(simulation.state.arrival?.phase).toBe('HISTORY_RUNNING');
    simulation.step(1);
    expect(simulation.state.month).toBe(1);
    expect(simulation.beginHistory()).toBe(false);
  });

  it('crosses the opening gate once and commits Month 1 on the following live frame', () => {
    const simulation = new Simulation({ seed: 'opening-handoff-first-tick', startMode: 'arrival', autoRun: true });
    simulation.advanceArrival(ARRIVAL_END_SECONDS + 1);
    expect(simulation.foundingOrientationRunning).toBe(true);
    expect(simulation.state.month).toBe(0);

    const handoff = new OpeningHandoff(simulation);
    expect(handoff.presentationActive(simulation)).toBe(true);
    expect(handoff.beginIfReady(simulation, false)).toBe(false);
    expect(simulation.historyRunning).toBe(false);

    expect(handoff.beginIfReady(simulation, true)).toBe(true);
    expect(simulation.historyRunning).toBe(true);
    expect(simulation.state.month).toBe(0);
    expect(handoff.pendingFirstTick).toBe(true);
    expect(handoff.presentationActive(simulation)).toBe(true);

    // The next live frame commits exactly one first month; normal scheduling owns everything after.
    expect(handoff.commitFirstTick(simulation)).toBe(true);
    expect(simulation.state.month).toBe(1);
    expect(handoff.pendingFirstTick).toBe(false);
    expect(handoff.presentationActive(simulation)).toBe(false);
    expect(handoff.commitFirstTick(simulation)).toBe(false);
    expect(simulation.state.month).toBe(1);
    expect(handoff.beginIfReady(simulation, true)).toBe(false);
  });

  it('repairs a resumed archive persisted at HISTORY_RUNNING Month 0', () => {
    const simulation = new Simulation({ seed: 'opening-handoff-resume', startMode: 'arrival', autoRun: true });
    simulation.advanceArrival(ARRIVAL_END_SECONDS + 1);
    expect(simulation.beginHistory()).toBe(true);
    expect(simulation.state.month).toBe(0);

    // A new controller represents a fresh page load after the authority phase was persisted but
    // before the following requestAnimationFrame had a chance to commit Month 1.
    const resumedHandoff = new OpeningHandoff(simulation);
    expect(resumedHandoff.pendingFirstTick).toBe(true);
    expect(resumedHandoff.commitFirstTick(simulation)).toBe(true);
    expect(simulation.state.month).toBe(1);
    expect(resumedHandoff.commitFirstTick(simulation)).toBe(false);
  });

  it('bounds effect buffers and retires them leaving five persistent hulls', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    const scene = new THREE.Scene();
    const view = new FoundingPodRenderer(s.state); scene.add(view.root);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(35, 40, 50);
    view.update(camera);
    expect(view.root.children.filter(o => o instanceof THREE.Group && o.visible)).toHaveLength(0);
    const objects = [...view.root.children];
    for (let i = 0; i < (ARRIVAL_END_SECONDS - 1) * 10; i++) { s.advanceArrival(0.1); view.update(camera); }
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
  }, 15000);

  it('skins every founding vessel as a bronze relic with site-colored luminous runes', () => {
    const s = new Simulation({ seed: 'arrival-bronze-runes', startMode: 'arrival' });
    const view = new FoundingPodRenderer(s.state);

    const hulls = view.root.children.filter((object): object is THREE.Group =>
      object instanceof THREE.Group && Boolean(object.userData.podId));
    expect(hulls).toHaveLength(5);

    for (const [index, hull] of hulls.entries()) {
      const pod = s.state.arrival!.pods[index]!;
      expect(hull.userData.siteColor).toBe(pod.color);
      expect(hull.userData.foundingProfile).toBe(pod.name);

      const shell = hull.getObjectByName('bronze-hull') as THREE.Mesh | undefined;
      expect(shell).toBeDefined();
      const shellMaterial = shell!.material as THREE.MeshStandardMaterial;
      expect(shellMaterial.metalness).toBeGreaterThan(0.7);
      expect(shellMaterial.roughness).toBeLessThan(0.5);

      const runes = hull.getObjectByName('ancient-runes');
      expect(runes).toBeDefined();
      const runeCore = runes!.getObjectByName('founding-rune-core') as THREE.Mesh | undefined;
      const runeHalo = runes!.getObjectByName('founding-rune-halo') as THREE.Mesh | undefined;
      expect(runeCore).toBeDefined();
      expect(runeHalo).toBeDefined();
      expect((runeCore!.material as THREE.MeshBasicMaterial).color.getHexString())
        .toBe(new THREE.Color(pod.color).getHexString());
      expect((runeHalo!.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending);
    }

    view.dispose();
  });

  it('keeps the central Arrival cinematic through the human anchors, then releases it', () => {
    expect(foundingArrivalDialogue(undefined, 'Elsewhere', 'Ordinary history')).toBeUndefined();
    expect(foundingArrivalDialogue('worker:someone', 'A worker', 'Ordinary history')).toBeUndefined();
    expect(foundingArrivalDialogue('founding:overview:event-1', 'ARRIVAL DAY · THE 5 LANDINGS', 'Five communities begin.')).toEqual({
      eyebrow: 'ARRIVAL DAY · ORIENTATION',
      title: 'ARRIVAL DAY · THE 5 LANDINGS',
      text: 'Five communities begin.',
    });
    expect(foundingArrivalDialogue('founding-cast:framing:event-1', 'A FEW LIVES', 'We will follow only a few.')).toBeUndefined();
    expect(foundingArrivalDialogue('founding-cast:introduction:0:person-1', 'Mara · Seed', '23 on Arrival Day.')).toEqual({
      eyebrow: 'ARRIVAL DAY · A FOUNDER',
      title: 'Mara · Seed',
      text: '23 on Arrival Day.',
    });
    expect(foundingArrivalDialogue('founding-release:event-1', 'THE FIRST DAY', 'The first day continues.')).toBeUndefined();
  });


  it('updates Arrival effects only when active and camera-relevant', () => {
    const s = new Simulation({ seed: 'arrival-trail-budget', startMode: 'arrival' });
    const view = new FoundingPodRenderer(s.state);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    camera.position.set(35, 40, 50);
    const trails = view.root.children.filter((object): object is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> =>
      object instanceof THREE.Mesh && object.geometry.getAttribute('position')?.count === 128);
    expect(trails).toHaveLength(10);

    view.update(camera);
    expect(trails.every(trail => (trail.geometry.getAttribute('position') as THREE.BufferAttribute).version === 0)).toBe(true);

    const first = s.state.arrival!.pods[0]!;
    s.state.arrival!.elapsedSeconds = first.entrySeconds + 0.1;

    // Active but outside the camera frustum: no buffer uploads and no transparent overdraw.
    camera.lookAt(1000, 40, 1000);
    camera.updateMatrixWorld(true);
    view.update(camera);
    expect(trails.every(trail => (trail.geometry.getAttribute('position') as THREE.BufferAttribute).version === 0)).toBe(true);

    const current = podPosition(first, s.state.arrival!.elapsedSeconds);
    camera.lookAt(current.x, current.y, current.z);
    camera.updateMatrixWorld(true);
    view.update(camera);
    const versionsAfterEntry = trails.map(trail => (trail.geometry.getAttribute('position') as THREE.BufferAttribute).version);
    expect(versionsAfterEntry.filter(version => version > 0)).toHaveLength(2);

    s.state.arrival!.elapsedSeconds = podTouchdown(first) + 5;
    view.update(camera);
    const versionsAfterRetirement = trails.map(trail => (trail.geometry.getAttribute('position') as THREE.BufferAttribute).version);
    expect(versionsAfterRetirement[0]).toBe(versionsAfterEntry[0]);
    expect(versionsAfterRetirement[1]).toBe(versionsAfterEntry[1]);
    view.dispose();
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
    s.advanceArrival(ARRIVAL_END_SECONDS);
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

  it('brakes into authoritative ground and keeps the authored opening continuous', () => {
    const s = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    for (const pod of s.state.arrival!.pods) {
      const finish = podTouchdown(pod);
      const early = podPosition(pod, pod.entrySeconds).y - podPosition(pod, pod.entrySeconds + 1).y;
      const late = podPosition(pod, finish - 1).y - podPosition(pod, finish).y;
      expect(early).toBeGreaterThan(late * 5);
      expect(podPosition(pod, finish + 5)).toEqual(podPosition(pod, finish));
    }
    expect(new Set(s.state.arrival!.pods.map(p => p.entrySeconds)).size).toBe(5);
    let previous = arrivalSequenceFocus(s.state.arrival!);
    const visitedSites = new Set<number>();
    let closestSiteRadius = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= ARRIVAL_END_SECONDS * 10; step += 1) {
      const second = step / 10;
      s.state.arrival!.elapsedSeconds = second;
      const focus = arrivalSequenceFocus(s.state.arrival!);
      expect([focus.target.x, focus.target.y, focus.target.z, focus.radius, focus.height, focus.transitionSeconds, focus.azimuthOffset, focus.fov]
        .every(Number.isFinite)).toBe(true);
      if (focus.cameraPosition) {
        expect([focus.cameraPosition.x, focus.cameraPosition.y, focus.cameraPosition.z].every(Number.isFinite)).toBe(true);
      }
      expect(['pristine', 'descent', 'touchdown', 'site-flythrough', 'handoff']).toContain(focus.beat);
      expect(focus.fov).toBeGreaterThanOrEqual(30);
      expect(focus.fov).toBeLessThanOrEqual(38);
      if (focus.beat === 'site-flythrough' && focus.siteIndex !== undefined) {
        visitedSites.add(focus.siteIndex);
        closestSiteRadius = Math.min(closestSiteRadius, focus.radius);
      }
      if (step > 0) {
        expect(Math.hypot(
          focus.target.x - previous.target.x,
          focus.target.y - previous.target.y,
          focus.target.z - previous.target.z,
        )).toBeLessThan(4);
        expect(Math.abs(focus.radius - previous.radius)).toBeLessThan(2);
        expect(Math.abs(focus.height - previous.height)).toBeLessThan(2);
      }
      const caption = arrivalCaption(second);
      expect(caption.opacity).toBeGreaterThanOrEqual(0);
      expect(caption.opacity).toBeLessThanOrEqual(1);
      previous = focus;
    }
    expect([...visitedSites]).toEqual([0, 1, 2, 3, 4]);
    expect(closestSiteRadius).toBeLessThan(2);

    // Every founding site gets a true stationary close hold rather than immediately climbing away.
    for (let siteIndex = 0; siteIndex < 5; siteIndex += 1) {
      s.state.arrival!.elapsedSeconds = 30 + siteIndex * 8 + 6.2;
      const heldA = arrivalSequenceFocus(s.state.arrival!);
      s.state.arrival!.elapsedSeconds += 0.8;
      const heldB = arrivalSequenceFocus(s.state.arrival!);
      expect(heldA.beat).toBe('site-flythrough');
      expect(heldA.siteIndex).toBe(siteIndex);
      expect(heldA.cameraPosition).toBeDefined();
      expect(heldB.cameraPosition).toEqual(heldA.cameraPosition);
      expect(heldB.target).toEqual(heldA.target);
      expect(heldA.height).toBeLessThan(1);
      expect(heldA.fov).toBeLessThanOrEqual(31);
    }
  });
});
