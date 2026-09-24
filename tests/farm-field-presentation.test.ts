import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { FarmFieldRenderer } from '../src/render/farming/FarmFieldRenderer';

function fixture(month = 6) {
  const f = vegetationFixture(`farm-field-polish:${month}`);
  const state = structuredClone(f.simulation.state);
  const settlement = state.settlements[0]!;
  settlement.alive = true;
  settlement.structurePlots = [];
  settlement.agriculture = { month, labour: 5, yieldPerWorker: 2, production: 10, irrigation: 0.6 };
  state.month = month;
  const weather = state.weather.cells[settlement.cellIndex]!;
  weather.snowpack = 0;
  weather.floodDepth = 0;
  weather.cropDamage = 0;
  weather.wind = 0;
  weather.blizzard = 0;
  return { state, settlement, surface: f.surface };
}

function mesh(renderer: FarmFieldRenderer, name: string): THREE.Mesh | THREE.InstancedMesh {
  const found = renderer.group.getObjectByName(name) as THREE.Mesh | THREE.InstancedMesh | undefined;
  if (!found) throw new Error(`Missing farm presentation mesh: ${name}`);
  return found;
}

function visibleCount(object: THREE.Mesh | THREE.InstancedMesh): number {
  return 'count' in object ? object.count : object.geometry.getAttribute('position')?.count ?? 0;
}

describe('farm field visual polish', () => {
  it('renders readable cultivated rows, crops, ripe heads and harvest material from existing agriculture state', () => {
    const { state, surface } = fixture(6);
    const renderer = new FarmFieldRenderer();
    renderer.update(state, (x, z) => surface.heightAt(x, z), () => true);

    expect(renderer.fields.size).toBeGreaterThan(0);
    expect(visibleCount(mesh(renderer, 'Cultivated farm soil'))).toBeGreaterThan(0);
    expect(visibleCount(mesh(renderer, 'Cultivated farm furrows'))).toBeGreaterThan(0);
    expect(visibleCount(mesh(renderer, 'Farm field borders'))).toBeGreaterThan(0);
    expect(mesh(renderer, 'Farm crop stalks').count).toBeGreaterThan(24);
    expect(mesh(renderer, 'Farm crop leaves').count).toBeGreaterThan(48);
    expect(mesh(renderer, 'Farm crop heads').count).toBeGreaterThan(0);
    expect(mesh(renderer, 'Farm harvest bundles').count).toBeGreaterThan(0);
    expect(mesh(renderer, 'Farm harvest sacks').count).toBeGreaterThan(0);
    expect(mesh(renderer, 'Farm row marker posts').count).toBeGreaterThan(0);
    expect(mesh(renderer, 'Farm harvest baskets').count).toBeGreaterThan(0);
    expect(visibleCount(mesh(renderer, 'Farm irrigation and wet-soil cues'))).toBeGreaterThan(0);
  });

  it('drapes cultivated soil and rows over rolling terrain instead of using one flat center height', () => {
    const { state } = fixture(6);
    const renderer = new FarmFieldRenderer();
    const heightAt = (x: number, z: number) => 0.18 * x - 0.11 * z + Math.sin(x * 1.7) * 0.035 + Math.cos(z * 1.3) * 0.025;
    renderer.update(state, heightAt, () => true);

    const soil = mesh(renderer, 'Cultivated farm soil');
    const position = soil.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(40);
    let minY = Infinity, maxY = -Infinity;
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
      const lift = y - heightAt(x, z);
      expect(lift).toBeGreaterThan(0.003);
      expect(lift).toBeLessThan(0.006);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(maxY - minY).toBeGreaterThan(0.08);

    const rows = mesh(renderer, 'Cultivated farm furrows').geometry.getAttribute('position');
    const rowGroundOffsets = Array.from({ length: rows.count }, (_, index) =>
      rows.getY(index) - heightAt(rows.getX(index), rows.getZ(index)));
    expect(Math.min(...rowGroundOffsets)).toBeGreaterThan(0.006);
    expect(Math.max(...rowGroundOffsets)).toBeLessThan(0.023);
    expect(Math.max(...rowGroundOffsets) - Math.min(...rowGroundOffsets)).toBeGreaterThan(0.01);
  });

  it('uses irrigation only as a visual cue and clears it when existing irrigation authority is absent', () => {
    const { state, settlement, surface } = fixture(5);
    const renderer = new FarmFieldRenderer();
    renderer.update(state, (x, z) => surface.heightAt(x, z), () => true);
    expect(visibleCount(mesh(renderer, 'Farm irrigation and wet-soil cues'))).toBeGreaterThan(0);

    settlement.agriculture!.irrigation = 0;
    renderer.update(state, (x, z) => surface.heightAt(x, z), () => true);
    expect(visibleCount(mesh(renderer, 'Farm irrigation and wet-soil cues'))).toBe(0);
  });

  it('keeps dormant fields cultivated but removes active crop and harvest evidence', () => {
    const { state, surface } = fixture(0);
    const renderer = new FarmFieldRenderer();
    renderer.update(state, (x, z) => surface.heightAt(x, z), () => true);

    expect(visibleCount(mesh(renderer, 'Cultivated farm soil'))).toBeGreaterThan(0);
    expect(visibleCount(mesh(renderer, 'Cultivated farm furrows'))).toBeGreaterThan(0);
    expect(mesh(renderer, 'Farm crop stalks').count).toBe(0);
    expect(mesh(renderer, 'Farm crop leaves').count).toBe(0);
    expect(mesh(renderer, 'Farm crop heads').count).toBe(0);
    expect(mesh(renderer, 'Farm harvest bundles').count).toBe(0);
  });

  it('is presentation-only and does not mutate simulation authority', () => {
    const { state, surface } = fixture(6);
    const before = JSON.stringify(state);
    const renderer = new FarmFieldRenderer();
    renderer.update(state, (x, z) => surface.heightAt(x, z), () => true);
    expect(JSON.stringify(state)).toBe(before);
  });
});
