import { describe, expect, it } from 'vitest';
import { birdFlightPoint, birdHabitatCount, resolveBirdJourney } from '../src/render/vegetation/AmbientBirds';

describe('Ambient forest birds', () => {
  it('keeps most of each route cycle perched with short flight windows', () => {
    expect(resolveBirdJourney(0.2)).toEqual({ flying: false, reverse: false, progress: 0, perch: 'from' });
    expect(resolveBirdJourney(0.47).flying).toBe(true);
    expect(resolveBirdJourney(0.7)).toEqual({ flying: false, reverse: false, progress: 1, perch: 'to' });
    const returning = resolveBirdJourney(0.96);
    expect(returning.flying).toBe(true);
    expect(returning.reverse).toBe(true);
    expect(returning.progress).toBeGreaterThan(0);
    expect(returning.progress).toBeLessThan(1);
  });

  it('flies a readable arc between tree perches', () => {
    const from = { x: 0, y: 3, z: 0 };
    const to = { x: 10, y: 4, z: 0 };
    expect(birdFlightPoint(from, to, 0, 2)).toEqual(from);
    expect(birdFlightPoint(from, to, 1, 2).x).toBeCloseTo(to.x);
    expect(birdFlightPoint(from, to, 1, 2).y).toBeCloseTo(to.y);
    const midpoint = birdFlightPoint(from, to, 0.5, 2);
    expect(midpoint.x).toBeCloseTo(5);
    expect(midpoint.y).toBeGreaterThan(5);
  });

  it('keeps simultaneous wildlife bounded even in large forests', () => {
    expect(birdHabitatCount(12)).toBe(0);
    expect(birdHabitatCount(24)).toBe(10);
    expect(birdHabitatCount(900)).toBeGreaterThan(10);
    expect(birdHabitatCount(10000)).toBe(36);
  });
});
