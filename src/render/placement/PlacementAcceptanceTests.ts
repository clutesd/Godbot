import { PlacementContract, DEFAULT_SLOPE_TOLERANCES, type PlacementConstraints } from './PlacementContract';
import { PlacementFootprint } from './PlacementFootprint';
import { TerrainQueries } from './TerrainQueries';
import { RuinStateManager } from './RuinStateManager';
import type { WorldState } from '../../sim/types';
import { SeededRandom } from '../../sim/prng';

export interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

/** Executable smoke gate for the persistent placement contract. */
export class PlacementAcceptanceTests {
  private readonly contract: PlacementContract;
  private readonly footprints: PlacementFootprint;
  private readonly terrain: TerrainQueries;
  private readonly ruins = new RuinStateManager();
  private readonly results: TestResult[] = [];

  constructor(private readonly world: WorldState) {
    this.contract = new PlacementContract(world);
    this.footprints = new PlacementFootprint(world, this.contract, 'acceptance-footprints');
    this.terrain = new TerrainQueries(world);
  }

  async runAllTests(): Promise<TestResult[]> {
    await this.record('No underwater building footprints', () => this.noUnderwaterBuildingFootprints());
    await this.record('Dry centers cannot hide wet footprint edges', () => this.dryCenterCannotHideWetPerimeter());
    await this.record('No persistent footprint drift', () => this.noPersistentFootprintDrift());
    await this.record('Explicit water crossing modes', () => this.explicitWaterCrossings());
    await this.record('Slope tolerance enforcement', () => this.slopeToleranceEnforcement());
    await this.record('Footprint lifecycle persistence', () => this.footprintLifecyclePersistence());
    await this.record('Terrain normal generation', () => this.terrainNormalGeneration());
    await this.record('Footprint clearance enforcement', () => this.footprintClearance());
    await this.record('Ruin state progression', () => this.ruinStateProgression());
    return this.results;
  }

  private noUnderwaterBuildingFootprints(): string[] {
    const violations: string[] = [];
    const rng = new SeededRandom('acceptance:underwater');
    const halfSpan = this.world.size * this.world.cellSize / 2;
    let placed = 0;
    for (let index = 0; index < 80; index += 1) {
      const radius = 0.42 + index % 4 * 0.14;
      const worldX = rng.range(-halfSpan, halfSpan);
      const worldZ = rng.range(-halfSpan, halfSpan);
      const validation = this.contract.validate({ type: 'small-building', worldX, worldZ, footprintRadius: radius });
      if (!validation.valid) continue;
      const registered = this.footprints.registerFootprint({ kind: 'building', worldX, worldZ, radius, placedMonth: 0, entityId: `acceptance-building-${index}`, persistent: true });
      if (!registered.success) continue;
      placed += 1;
      for (let sample = 0; sample < 12; sample += 1) {
        const angle = sample / 12 * Math.PI * 2;
        if (this.terrain.queryTerrainAt(worldX + Math.cos(angle) * radius, worldZ + Math.sin(angle) * radius)?.water) {
          violations.push(`building-${index} footprint reaches water`);
          break;
        }
      }
    }
    if (placed === 0) violations.push('no dry footprint was exercised');
    return violations;
  }

  private dryCenterCannotHideWetPerimeter(): string[] {
    const radius = this.world.cellSize * 1.05;
    for (const cell of this.world.cells) {
      if (cell.water || cell.x < 2 || cell.z < 2 || cell.x >= this.world.size - 2 || cell.z >= this.world.size - 2) continue;
      const perimeterTouchesWater = Array.from({ length: 12 }, (_, index) => {
        const angle = index / 12 * Math.PI * 2;
        return this.terrain.queryTerrainAt(cell.worldX + Math.cos(angle) * radius, cell.worldZ + Math.sin(angle) * radius)?.water === true;
      }).some(Boolean);
      if (!perimeterTouchesWater) continue;
      const validation = this.contract.validate({ type: 'small-building', worldX: cell.worldX, worldZ: cell.worldZ, footprintRadius: radius, slopeTolerance: 90 });
      const registration = this.footprints.registerFootprint({ kind: 'building', worldX: cell.worldX, worldZ: cell.worldZ, radius, placedMonth: 0, entityId: 'wet-perimeter-bypass', persistent: true });
      const violations: string[] = [];
      if (validation.valid || !validation.reason?.includes('water')) violations.push('contract accepted a dry center whose footprint reached water');
      if (registration.success || !registration.reason?.includes('water')) violations.push('public footprint registration bypassed the wet perimeter check');
      return violations;
    }
    return ['no dry-center/wet-perimeter shoreline case was exercised'];
  }

  private noPersistentFootprintDrift(): string[] {
    const violations: string[] = [];
    const sample = this.footprints.getFootprintsByKind('building').slice(0, 10);
    if (sample.length === 0) return ['no persistent footprint was available'];
    for (const footprint of sample) {
      const moved = this.footprints.moveFootprint(footprint.id, footprint.worldX + 1, footprint.worldZ);
      const after = this.footprints.getFootprint(footprint.id);
      if (moved.success || after?.worldX !== footprint.worldX || after?.worldZ !== footprint.worldZ) violations.push(`${footprint.entityId} drifted`);
    }
    return violations;
  }

  private explicitWaterCrossings(): string[] {
    const violations: string[] = [];
    const waterCells = this.world.cells.filter((cell) => cell.water).slice(0, 24);
    for (const cell of waterCells) {
      const base: PlacementConstraints = { type: 'infrastructure', worldX: cell.worldX, worldZ: cell.worldZ, footprintRadius: 0.2 };
      const pedestrian = this.contract.validate(base);
      const crossing = this.contract.validate({ ...base, waterTolerant: true });
      if (pedestrian.valid || !pedestrian.reason?.includes('water')) violations.push(`water at ${cell.x},${cell.z} accepted without crossing mode`);
      if (!crossing.valid && crossing.reason?.includes('water')) violations.push(`explicit crossing at ${cell.x},${cell.z} rejected as water`);
    }
    return violations;
  }

  private slopeToleranceEnforcement(): string[] {
    const violations: string[] = [];
    for (const cell of this.world.cells.filter((candidate) => !candidate.water).slice(0, 120)) {
      const major = this.contract.validate({ type: 'major-building', worldX: cell.worldX, worldZ: cell.worldZ, footprintRadius: 0.35 });
      const small = this.contract.validate({ type: 'small-building', worldX: cell.worldX, worldZ: cell.worldZ, footprintRadius: 0.35 });
      if (major.valid && major.terrain.maxSlope > DEFAULT_SLOPE_TOLERANCES.majorBuilding * 1.35) violations.push(`major building accepted at ${major.terrain.maxSlope.toFixed(1)} degrees`);
      if (major.valid && !small.valid && small.reason?.includes('slope')) violations.push('small building was stricter than major building');
    }
    return violations;
  }

  private footprintLifecyclePersistence(): string[] {
    const site = this.findDrySite(0.42, this.footprints);
    if (!site) return ['no dry lifecycle site found'];
    const result = this.footprints.registerFootprint({ kind: 'building', ...site, radius: 0.42, placedMonth: 0, entityId: 'lifecycle-building', persistent: true });
    if (!result.success || !result.footprintId) return [`registration failed: ${result.reason ?? 'unknown'}`];
    const before = this.footprints.getFootprint(result.footprintId);
    this.ruins.recordDamage('lifecycle-building', 0.3);
    this.ruins.recordRuin('lifecycle-building', 10);
    this.ruins.updateDecay(30);
    const after = this.footprints.getFootprint(result.footprintId);
    if (!before || !after) return ['footprint disappeared during ruin lifecycle'];
    return before.worldX === after.worldX && before.worldZ === after.worldZ ? [] : ['footprint moved during ruin lifecycle'];
  }

  private terrainNormalGeneration(): string[] {
    const violations: string[] = [];
    for (const cell of this.world.cells.filter((candidate) => !candidate.water).slice(0, 32)) {
      const normal = this.terrain.calculateNormal(cell);
      if (!Number.isFinite(normal.length()) || Math.abs(normal.length() - 1) > 0.01) violations.push(`invalid normal at ${cell.x},${cell.z}`);
    }
    return violations;
  }

  private footprintClearance(): string[] {
    const registry = new PlacementFootprint(this.world, this.contract, 'acceptance-clearance');
    const violations: string[] = [];
    const firstSite = this.findDrySite(0.34, registry);
    if (!firstSite) return ['no dry clearance site found'];
    const first = registry.registerFootprint({ kind: 'building', ...firstSite, radius: 0.34, placedMonth: 0, entityId: 'clearance-a', persistent: true });
    const overlap = registry.registerFootprint({ kind: 'building', ...firstSite, radius: 0.34, placedMonth: 0, entityId: 'clearance-b', persistent: true });
    const separateSite = this.findDrySite(0.34, registry);
    const separate = separateSite ? registry.registerFootprint({ kind: 'building', ...separateSite, radius: 0.34, placedMonth: 0, entityId: 'clearance-c', persistent: true }) : { success: false };
    if (!first.success) violations.push('first footprint rejected');
    if (overlap.success) violations.push('overlapping footprint accepted');
    if (!separate.success) violations.push('separate footprint rejected');
    registry.dispose();
    return violations;
  }

  private ruinStateProgression(): string[] {
    const violations: string[] = [];
    const id = 'acceptance-ruin';
    this.ruins.recordRuin(id, 10);
    this.ruins.updateDecay(15);
    if (!['ruined', 'overgrown'].includes(this.ruins.getRuinState(id)?.stage ?? '')) violations.push('early ruin stage invalid');
    this.ruins.updateDecay(25);
    if (!['overgrown', 'reclaimed'].includes(this.ruins.getRuinState(id)?.stage ?? '')) violations.push('middle ruin stage invalid');
    this.ruins.updateDecay(120);
    if (!['reclaimed', 'archaeological'].includes(this.ruins.getRuinState(id)?.stage ?? '')) violations.push('late ruin stage invalid');
    return violations;
  }

  private findDrySite(radius: number, footprints: PlacementFootprint): { worldX: number; worldZ: number } | undefined {
    for (const cell of this.world.cells) {
      if (cell.water || cell.slope > 0.34) continue;
      const validation = this.contract.validate({ type: 'small-building', worldX: cell.worldX, worldZ: cell.worldZ, footprintRadius: radius });
      if (validation.valid && footprints.isAreaClear(cell.worldX, cell.worldZ, radius).clear) return { worldX: cell.worldX, worldZ: cell.worldZ };
    }
    return undefined;
  }

  private async record(name: string, audit: () => string[]): Promise<void> {
    const start = performance.now();
    const violations = audit();
    this.results.push({ name, passed: violations.length === 0, details: violations.length === 0 ? 'passed' : violations.slice(0, 5).join('; '), duration: performance.now() - start });
  }

  getSummary(): { passed: number; failed: number; total: number; allPassed: boolean; totalDuration: number } {
    const passed = this.results.filter((result) => result.passed).length;
    return { passed, failed: this.results.length - passed, total: this.results.length, allPassed: passed === this.results.length, totalDuration: this.results.reduce((sum, result) => sum + result.duration, 0) };
  }

  dispose(): void {
    this.contract.dispose();
    this.footprints.dispose();
    this.terrain.dispose();
    this.ruins.dispose();
  }
}
