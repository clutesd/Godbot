import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { createAtmosphericSkyMaterial, setAtmosphericSkyPalette, type AtmosphericSkyMaterial } from './AtmosphericScattering';
import { LowMistField } from './LowMistField';

/**
 * Sky, cloud and low-mist atmosphere.
 *
 * The old valley-mist mesh was a single translucent sheet at one fixed world height. Mist is now a
 * terrain/water-aware density field consumed by the depth-aware atmosphere, with its bank motion
 * driven from real weather wind and elapsed presentation time instead of moving the source field.
 */
export class SkyAtmosphere {
  readonly group = new THREE.Group();
  readonly lowMistField: LowMistField;
  private readonly sky: THREE.Mesh;
  private readonly skyMaterial: AtmosphericSkyMaterial;
  private readonly zenith = new THREE.Color();
  private readonly horizon = new THREE.Color();

  constructor(world: WorldState, surface: TerrainSurface, seed: string) {
    this.group.name = 'atmosphere';
    // Larger than the ocean sheet, so the water never pokes out past the horizon.
    const radius = Math.max(world.size * world.cellSize * 6, 760);
    const geometry = new THREE.SphereGeometry(radius, 40, 24);
    this.skyMaterial = createAtmosphericSkyMaterial(
      new THREE.Color('#7fa5c4'),
      new THREE.Color('#c9d4d2'),
    );
    this.sky = new THREE.Mesh(geometry, this.skyMaterial);
    this.sky.name = 'sky';
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);
    this.setPalette(new THREE.Color('#7fa5c4'), new THREE.Color('#c9d4d2'));

    this.lowMistField = new LowMistField(world, surface, seed);
    // Post-processing discovers the field from the atmosphere object so standalone preview scenes
    // that do not construct SkyAtmosphere can still fall back to a zero-density mist texture.
    this.group.userData['lowMistField'] = this.lowMistField;
  }

  /** Broad art-direction palette; directional scattering is applied from EnvironmentFrameState. */
  setPalette(zenith: THREE.Color, horizon: THREE.Color): void {
    this.zenith.copy(zenith);
    this.horizon.copy(horizon);
    setAtmosphericSkyPalette(this.skyMaterial, this.zenith, this.horizon);
  }

  /** Seasonal likelihood/strength, applied to spatial mist rather than a screen-wide sheet. */
  setMistStrength(strength: number): void {
    this.lowMistField.setSeasonalStrength(strength);
  }

  setCloudTint(colour: THREE.Color): void {
    this.skyMaterial.uniforms['uCloudTint']!.value.copy(colour);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.skyMaterial.uniforms['uCloudTime']!.value = elapsedSeconds;
    this.lowMistField.update(deltaSeconds, elapsedSeconds);
  }

  followCamera(camera: THREE.Camera): void {
    // Keep the horizon effectively infinite while preserving world-up for scattering.
    this.sky.position.copy(camera.position);
  }
}
