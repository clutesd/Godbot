import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { FarmFieldRenderer } from '../src/render/farming/FarmFieldRenderer';
import { farmGeometries, farmGeometry } from '../src/shared/FarmGeometry';
import type { Settlement, SimulationState } from '../src/sim/types';
import type { StructureDevelopment } from '../src/sim/development/types';

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
  return object instanceof THREE.InstancedMesh ? object.count : object.geometry.getAttribute('position')?.count ?? 0;
}

function fieldDevelopment(state: SimulationState, settlement: Settlement, status: StructureDevelopment['status']): StructureDevelopment {
  const culture = state.cultures.find(entry => entry.id in settlement.cultureShares) ?? state.cultures[0]!;
  const origin = {
    month: 0,
    action: 'founded' as const,
    name: 'farmstead',
    need: 'food' as const,
    cultureId: culture.id,
    reasons: ['test-field'],
    form: 'field' as const,
    level: 1,
    material: 'earth' as const,
  };
  return {
    need: 'food',
    form: 'field',
    name: 'farmstead',
    level: 1,
    material: 'earth',
    cultureId: culture.id,
    style: structuredClone(culture.style),
    services: { food: 1 },
    reasons: ['test-field'],
    capabilities: ['crop-selection'],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 1,
    status,
    origin,
    history: [],
    transitionCount: 0,
    lastUsedMonth: state.month,
  };
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

    const rowMesh = mesh(renderer, 'Cultivated farm furrows');
    const rows = rowMesh.geometry.getAttribute('position');
    const rowGroundOffsets = Array.from({ length: rows.count }, (_, index) =>
      rows.getY(index) - heightAt(rows.getX(index), rows.getZ(index)));
    expect(Math.min(...rowGroundOffsets)).toBeGreaterThan(0.006);
    expect(Math.max(...rowGroundOffsets)).toBeLessThan(0.023);
    expect(Math.max(...rowGroundOffsets) - Math.min(...rowGroundOffsets)).toBeGreaterThan(0.01);

    const normals = rowMesh.geometry.getAttribute('normal');
    expect(normals.count).toBe(rows.count);
    const upwardShare = Array.from({ length: normals.count }, (_, index) => normals.getY(index))
      .filter(y => y > 0.15).length / normals.count;
    expect(upwardShare).toBeGreaterThan(0.95);
  });

  it('renders every developed farm plot while keeping one deterministic safe work field', () => {
    const { state, settlement } = fixture(6);
    const a = fieldDevelopment(state, settlement, 'active');
    const b = fieldDevelopment(state, settlement, 'active');
    settlement.structurePlots = [
      { id: 'field-a', development: a, worldX: settlement.position.x + 2.1, worldZ: settlement.position.z + 0.7,
        width: 2.6, depth: 1.9, height: 0.4, radius: 1.6, condition: 1, foundedMonth: 4 },
      { id: 'field-b', development: b, worldX: settlement.position.x - 2.4, worldZ: settlement.position.z + 1.1,
        width: 2.4, depth: 1.8, height: 0.4, radius: 1.5, condition: 0.88, foundedMonth: 8 },
    ];

    const geometries = farmGeometries(settlement);
    expect(geometries.map(field => field.id)).toEqual(['field-a', 'field-b']);
    expect(new Set(geometries.map(field => field.rotationY)).size).toBe(2);
    expect(farmGeometry(settlement)?.id).toBe('field-a');

    const renderer = new FarmFieldRenderer();
    renderer.update(state, (x, z) => x * 0.03 - z * 0.02, () => true);
    expect(renderer.renderedFields.size).toBe(2);
    expect([...renderer.renderedFields.keys()]).toEqual(['field-a', 'field-b']);
    expect(renderer.fields.get(settlement.id)?.geometry.id).toBe('field-a');
    expect(mesh(renderer, 'Cultivated farm soil').geometry.getAttribute('position').count).toBeGreaterThanOrEqual(198);
  });

  it('keeps damaged and abandoned farm ground visible without treating it as productive work', () => {
    const { state, settlement } = fixture(6);
    settlement.structurePlots = [
      { id: 'working-field', development: fieldDevelopment(state, settlement, 'active'),
        worldX: settlement.position.x + 2, worldZ: settlement.position.z + 0.6,
        width: 2.5, depth: 1.8, height: 0.4, radius: 1.5, condition: 0.95, foundedMonth: 2 },
      { id: 'old-field', development: fieldDevelopment(state, settlement, 'abandoned'),
        worldX: settlement.position.x - 2.2, worldZ: settlement.position.z + 0.8,
        width: 2.3, depth: 1.7, height: 0.4, radius: 1.45, condition: 0.35, foundedMonth: -30, accessRestricted: true },
    ];

    const renderer = new FarmFieldRenderer();
    renderer.update(state, () => 0, () => true);
    const old = renderer.renderedFields.get('old-field');
    expect(old).toBeDefined();
    expect(old?.state.productive).toBe(false);
    expect(old?.state.stage).toBe('damaged');
    expect(farmGeometry(settlement)?.id).toBe('working-field');
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
