import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { FoundingPodRenderer } from '../src/render/founding/FoundingPodRenderer';
import { ARRIVAL_HATCH, arrivalRampFor, arrivalFounderPose } from '../src/render/founding/ArrivalChoreography';
import { surfaceHeightAt } from '../src/sim/terrain/SurfaceGeometry';
import { podTouchdown } from '../src/sim/founding/FoundingArrival';

/** Check real triangles, including the emissive trim. A bounding box for a horseshoe-shaped
 * belt is deliberately insufficient: it would report a blocked doorway even when cut open. */
function intersectingMeshes(root: THREE.Object3D, box: THREE.Box3): string[] {
  const hits: string[] = [];
  const triangle = new THREE.Triangle();
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const p = object.geometry.getAttribute('position'), indices = object.geometry.index;
    for (let i = 0; i < (indices?.count ?? p.count); i += 3) {
      for (const [j, vertex] of [triangle.a, triangle.b, triangle.c].entries()) {
        vertex.fromBufferAttribute(p, indices ? indices.getX(i + j) : i + j).applyMatrix4(object.matrixWorld);
      }
      if (box.intersectsTriangle(triangle)) { hits.push(object.name); break; }
    }
  });
  return hits;
}

describe('founding vessel physical portal', () => {
  it('leaves both founder lanes clear through the chamber, portal and deployed ramp', () => {
    const sim = new Simulation({ seed: 'pod-egress-clearance', startMode: 'arrival' });
    sim.advanceArrival(35);
    const renderer = new FoundingPodRenderer(sim.state);
    renderer.update(new THREE.PerspectiveCamera());
    const hull = renderer.root.children.find(o => o.userData.podId)!;
    const pod = sim.state.arrival!.pods.find(p => p.id === hull.userData.podId)!;
    // Test actual arrival choreography, including each lane, using taller/wider bounds than
    // the rendered founders. Retain hull world transform to catch hinge/height disagreements.
    const people = pod.personIds.slice(0, 2).map(id => sim.state.people.find(person => person.id === id)!);
    const heightAt = (x: number, z: number) => surfaceHeightAt(sim.state.world, x, z);
    expect(people).toHaveLength(2);
    for (const person of people) {
      expect(person.foundingOrigin).toBeDefined();
      let complete = false;
      for (let step = 0; step <= 120 && !complete; step++) {
        const pose = arrivalFounderPose(person, pod, person.foundingOrigin!.emergedSeconds + step * 0.09, heightAt)!;
        const body = new THREE.Box3(new THREE.Vector3(pose.x - 0.07, pose.footY + 0.04, pose.z - 0.025),
          new THREE.Vector3(pose.x + 0.07, pose.footY + 0.67, pose.z + 0.025));
        expect(intersectingMeshes(hull, body), `lane ${person.id}, step ${step}`).toEqual([]);
        complete = pose.complete;
      }
      expect(complete).toBe(true);
    }
    renderer.dispose();
  });

  it('rotates a sealed door into a supporting walking surface before founders emerge', () => {
    const sim = new Simulation({ seed: 'pod-hinge-clearance', startMode: 'arrival' });
    const renderer = new FoundingPodRenderer(sim.state);
    const pod = sim.state.arrival!.pods[0]!;
    const camera = new THREE.PerspectiveCamera();
    const hull = renderer.root.children.find(o => o.userData.podId === pod.id)!;
    const hatch = hull.getObjectByName('articulated-hatch')!;
    sim.state.arrival!.elapsedSeconds = podTouchdown(pod) - 0.1;
    renderer.update(camera);
    expect(hatch.rotation.x).toBeCloseTo(0, 8);
    // Closed door blocks the aperture; an actually missing door cannot pass this contract.
    hull.updateMatrixWorld(true);
    const center = hatch.localToWorld(new THREE.Vector3(0, 0.45, -0.035));
    expect(intersectingMeshes(hatch, new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(0.1, 0.1, 0.1))))
      .toContain('dark-bronze-hatch');
    sim.state.arrival!.elapsedSeconds = podTouchdown(pod) + 1.7;
    renderer.update(camera);
    const ramp = arrivalRampFor(pod, (x, z) => surfaceHeightAt(sim.state.world, x, z));
    expect(hatch.rotation.x).toBeCloseTo(-ramp.angle, 8);
    const tip = hatch.localToWorld(new THREE.Vector3(0, ARRIVAL_HATCH.length, 0));
    expect(tip.z - pod.position.z).toBeCloseTo(ramp.z, 5);
    expect(tip.y).toBeCloseTo(surfaceHeightAt(sim.state.world, tip.x, tip.z), 3);
    renderer.dispose();
  });

  it('shares fleet geometry and releases surface textures exactly once', () => {
    const sim = new Simulation({ seed: 'pod-resource-budget', startMode: 'arrival' });
    const renderer = new FoundingPodRenderer(sim.state);
    const hulls = renderer.root.children.filter(o => o.userData.podId);
    const shell = hulls[0]!.getObjectByName('bronze-hull') as THREE.Mesh;
    const material = shell.material as THREE.MeshStandardMaterial;
    const borrowedReflection = new THREE.Texture();
    let geometryDisposals = 0, textureDisposals = 0, reflectionDisposals = 0;
    renderer.setReflectionEnvironment(borrowedReflection);
    borrowedReflection.addEventListener('dispose', () => reflectionDisposals++);
    expect(material.envMap).toBe(borrowedReflection);
    shell.geometry.addEventListener('dispose', () => geometryDisposals++);
    material.roughnessMap!.addEventListener('dispose', () => textureDisposals++);
    for (const hull of hulls) {
      expect((hull.getObjectByName('bronze-hull') as THREE.Mesh).geometry).toBe(shell.geometry);
      let draws = 0, triangles = 0;
      hull.traverse(o => {
        if (o instanceof THREE.Mesh) { draws++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; }
      });
      expect(draws).toBeLessThanOrEqual(30);
      expect(triangles).toBeLessThan(65000);
    }
    renderer.dispose();
    expect(geometryDisposals).toBe(1);
    expect(textureDisposals).toBe(1);
    expect(reflectionDisposals).toBe(0);
    borrowedReflection.dispose();
  });
});
