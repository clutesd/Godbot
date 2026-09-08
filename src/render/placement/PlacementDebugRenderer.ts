/**
 * PlacementDebugRenderer.ts
 * 
 * Development-only visualization for placement validation.
 * Shows rejected footprints, slope maps, water masks, terrain normals.
 * 
 * Enable via dev flag to save time when asset placement begins.
 */

import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import { TerrainQueries } from './TerrainQueries';
import type { PlacementFootprint, Footprint } from './PlacementFootprint';

export interface PlacementDebugConfig {
  enabled: boolean;
  showFootprints?: boolean; // Show all registered footprints
  showSlope?: boolean; // Show slope heatmap
  showWater?: boolean; // Show water mask
  showNormals?: boolean; // Show terrain normals as arrows
  showRejections?: boolean; // Show rejected placement attempts
  footprintOpacity?: number;
  normalScale?: number;
}

/**
 * Debug visualization for placement validation
 */
export class PlacementDebugRenderer {
  private readonly config: PlacementDebugConfig;
  private readonly terrain: TerrainQueries;
  private readonly world: WorldState;
  private readonly debugGroup = new THREE.Group();
  private readonly slopeHeatmap?: THREE.Mesh;
  private readonly footprintVisuals: Map<string, THREE.Mesh>;
  private readonly rejectionMarkers: THREE.Group;
  private readonly normalArrows: THREE.Group;

  constructor(world: WorldState, config: PlacementDebugConfig = { enabled: false }) {
    this.config = config;
    this.world = world;
    this.terrain = new TerrainQueries(world);
    this.footprintVisuals = new Map();
    this.rejectionMarkers = new THREE.Group();
    this.normalArrows = new THREE.Group();

    if (config.enabled) {
      if (config.showSlope) {
        this.slopeHeatmap = this.createSlopeHeatmap();
        this.debugGroup.add(this.slopeHeatmap);
      }

      if (config.showNormals) {
        this.createNormalVisualization();
        this.debugGroup.add(this.normalArrows);
      }

      this.debugGroup.add(this.rejectionMarkers);
    }
  }

  /**
   * Add to scene
   */
  addToScene(scene: THREE.Scene): void {
    if (this.config.enabled) {
      scene.add(this.debugGroup);
    }
  }

  /**
   * Create slope heatmap (red = steep, green = flat)
   */
  private createSlopeHeatmap(): THREE.Mesh {
    const { size, cellSize } = this.world;
    const textureSize = Math.min(size, 512); // Cap for performance
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d')!;

    const stepSize = Math.ceil(size / textureSize);

    for (let z = 0; z < textureSize; z++) {
      for (let x = 0; x < textureSize; x++) {
        const cellZ = z * stepSize;
        const cellX = x * stepSize;
        const cellIndex = cellZ * size + cellX;

        if (cellIndex >= this.world.cells.length) continue;

        const cell = this.world.cells[cellIndex];
        const slope = Math.min(cell ? this.terrain.getCellSlope(cell) : 0, 60);
        const normalized = slope / 60; // 0 (flat) to 1 (steep)

        // Red for steep, green for flat
        const r = Math.floor(normalized * 255);
        const g = Math.floor((1 - normalized) * 255);
        const b = 0;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, z, 1, 1);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    const geometry = new THREE.PlaneGeometry(size * cellSize, size * cellSize);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.01; // Slightly above terrain
    mesh.rotation.x = -Math.PI / 2; // Lay flat
    return mesh;
  }

  /**
   * Visualize terrain normals as arrows
   */
  private createNormalVisualization(): void {
    const { size, cellSize } = this.world;
    const normalScale = this.config.normalScale || 5;
    const sampleStep = Math.max(1, Math.floor(size / 16)); // ~16x16 grid

    for (let z = 0; z < size; z += sampleStep) {
      for (let x = 0; x < size; x += sampleStep) {
        const cell = this.world.cells[z * size + x];
        if (!cell || cell.water) continue;

        const normal = this.terrain.calculateNormal(cell);
        const worldX = (x - size / 2) * cellSize;
        const worldZ = (z - size / 2) * cellSize;
        const worldY = cell.elevation * 50; // Scale up for visibility

        const arrow = new THREE.ArrowHelper(normal, new THREE.Vector3(worldX, worldY, worldZ), normalScale, 0xff6600);
        this.normalArrows.add(arrow);
      }
    }
  }

  /**
   * Show a registered footprint
   */
  addFootprintVisualization(footprint: Footprint): void {
    if (!this.config.showFootprints) return;

    const geometry = new THREE.CylinderGeometry(footprint.radius, footprint.radius, 0.2, 16);
    const material = new THREE.MeshBasicMaterial({
      color: this.getFootprintColor(footprint.kind),
      transparent: true,
      opacity: this.config.footprintOpacity || 0.5,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(footprint.worldX, 0.1, footprint.worldZ);
    mesh.rotation.x = -Math.PI / 2; // Lay flat

    this.debugGroup.add(mesh);
    this.footprintVisuals.set(footprint.id, mesh);
  }

  /**
   * Remove footprint visualization
   */
  removeFootprintVisualization(footprintId: string): void {
    const mesh = this.footprintVisuals.get(footprintId);
    if (mesh) {
      this.debugGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.footprintVisuals.delete(footprintId);
    }
  }

  /**
   * Mark a rejected placement attempt
   */
  markRejectedPlacement(worldX: number, worldZ: number, reason: string): void {
    if (!this.config.showRejections) return;
    void reason;

    const geometry = new THREE.SphereGeometry(2, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.7,
    });

    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(worldX, 0.5, worldZ);

    // Add tooltip text (would need text renderer in full implementation)
    this.rejectionMarkers.add(marker);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      this.rejectionMarkers.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }, 5000);
  }

  /**
   * Show all current footprints
   */
  visualizeFootprints(footprints: PlacementFootprint): void {
    if (!this.config.showFootprints) return;

    for (const footprint of footprints.getAllFootprints()) {
      this.addFootprintVisualization(footprint);
    }
  }

  /**
   * Get color for footprint kind
   */
  private getFootprintColor(kind: string): number {
    const colors: Record<string, number> = {
      building: 0x00ff00, // Green
      route: 0x0000ff, // Blue
      infrastructure: 0xffff00, // Yellow
      settlement: 0xff00ff, // Magenta
    };
    return colors[kind] || 0xffffff;
  }

  /**
   * Show water mask (blue = water, black = land)
   */
  showWaterMask(): THREE.Mesh | null {
    if (!this.config.showWater) return null;

    const { size, cellSize } = this.world;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const cell = this.world.cells[z * size + x];
        if (!cell) continue;
        ctx.fillStyle = cell.water ? '#4488ff' : '#000000';
        ctx.fillRect(x, z, 1, 1);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(size * cellSize, size * cellSize);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.01;
    mesh.rotation.x = -Math.PI / 2;

    return mesh;
  }

  /**
   * Generate debug statistics
   */
  getDebugStats(): {
    avgSlope: number;
    maxSlope: number;
    waterCells: number;
    coastCells: number;
  } {
    let slopeSum = 0;
    let maxSlope = 0;
    let waterCount = 0;
    let coastCount = 0;

    for (const cell of this.world.cells) {
      const slope = this.terrain.getCellSlope(cell);
      slopeSum += slope;
      maxSlope = Math.max(maxSlope, slope);

      if (cell.water) waterCount++;
      if (cell.coast) coastCount++;
    }

    return {
      avgSlope: slopeSum / this.world.cells.length,
      maxSlope,
      waterCells: waterCount,
      coastCells: coastCount,
    };
  }

  /**
   * Remove all debug visualizations
   */
  clear(): void {
    this.footprintVisuals.forEach(mesh => {
      this.debugGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.footprintVisuals.clear();

    this.normalArrows.clear();
    this.rejectionMarkers.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();
    this.terrain.dispose();
  }
}
