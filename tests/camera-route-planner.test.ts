import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { planTerrainAwareCameraRoute, smoothCameraRoute } from '../src/render/CameraRoutePlanner';

const terrain = (x: number, z: number): number =>
  Math.sin(x * 0.08) * 1.8 + Math.cos(z * 0.06) * 1.2;

describe('CameraRoutePlanner', () => {
  it('keeps route points above terrain clearance', () => {
    const origin = new THREE.Vector3(0, 4, 0);
    const destination = new THREE.Vector3(42, 3.5, 18);
    const plan = planTerrainAwareCameraRoute(origin, destination, terrain, { clearance: 2.2 });

    expect(plan.points.length).toBeGreaterThanOrEqual(4);
    for (const point of plan.points.slice(1, -1)) {
      expect(point.y).toBeGreaterThanOrEqual(terrain(point.x, point.z) + 2.2 - 1e-6);
    }
  });

  it('produces a bounded lateral corridor instead of wild detours', () => {
    const origin = new THREE.Vector3(0, 5, 0);
    const destination = new THREE.Vector3(36, 5, 0);
    const plan = planTerrainAwareCameraRoute(origin, destination, terrain, {
      lateralOffsets: [-4, -2, 0, 2, 4],
      clearance: 2,
    });

    for (const point of plan.points) {
      expect(Math.abs(point.z)).toBeLessThanOrEqual(4.01);
    }
  });


  it('keeps the smoothed flight path above terrain, not only its sparse control points', () => {
    const ridge = (x: number, z: number): number =>
      1.2 + Math.exp(-((x - 18) ** 2 + (z - 1.5) ** 2) / 22) * 7.5
      + Math.sin(x * 0.35) * 0.45;
    const origin = new THREE.Vector3(0, 5, 0);
    const destination = new THREE.Vector3(36, 5, 3);
    const plan = planTerrainAwareCameraRoute(origin, destination, ridge, {
      clearance: 2.4,
      lateralOffsets: [-5, -2.5, 0, 2.5, 5],
    });
    const smooth = smoothCameraRoute(plan.points, 5, ridge, plan.clearance);

    for (const point of smooth.slice(1, -1)) {
      expect(point.y).toBeGreaterThanOrEqual(ridge(point.x, point.z) + plan.clearance - 1e-6);
    }
  });

  it('remains finite and endpoint-stable for a zero-distance editorial transfer', () => {
    const origin = new THREE.Vector3(4, 6, -3);
    const plan = planTerrainAwareCameraRoute(origin, origin.clone(), terrain, { clearance: 2.2 });
    const smooth = smoothCameraRoute(plan.points, 4, terrain, plan.clearance);

    expect(smooth[0]!.distanceTo(origin)).toBeLessThan(1e-9);
    expect(smooth[smooth.length - 1]!.distanceTo(origin)).toBeLessThan(1e-9);
    for (const point of smooth) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.z)).toBe(true);
    }
  });

  it('smooths sparse waypoints into a continuous route without moving endpoints', () => {
    const points = [
      new THREE.Vector3(0, 3, 0),
      new THREE.Vector3(8, 4, 2),
      new THREE.Vector3(16, 3.5, -1),
      new THREE.Vector3(24, 3, 0),
    ];
    const smooth = smoothCameraRoute(points, 4);

    expect(smooth.length).toBeGreaterThan(points.length);
    expect(smooth[0]!.distanceTo(points[0]!)).toBeLessThan(1e-6);
    expect(smooth[smooth.length - 1]!.distanceTo(points[points.length - 1]!)).toBeLessThan(1e-6);

    let maxTurn = 0;
    for (let i = 1; i < smooth.length - 1; i += 1) {
      const a = smooth[i]!.clone().sub(smooth[i - 1]!).normalize();
      const b = smooth[i + 1]!.clone().sub(smooth[i]!).normalize();
      maxTurn = Math.max(maxTurn, Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)));
    }
    expect(maxTurn).toBeLessThan(THREE.MathUtils.degToRad(42));
  });
});
