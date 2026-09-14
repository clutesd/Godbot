import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { createAtmosphericSkyMaterial, setAtmosphericSkyPalette, type AtmosphericSkyMaterial } from './AtmosphericScattering';
import { LowMistField } from './LowMistField';
import { softPointTexture } from './sprites';

/**
 * Sky, cloud and low-mist atmosphere.
 *
 * The old valley-mist mesh was a single translucent sheet at one fixed world height. That made it
 * impossible for mist to live naturally inside valleys, along rivers or through treetops. Mist is
 * now represented by a lightweight terrain/water-aware density field consumed by the existing
 * depth-aware atmospheric pass. The sky dome remains a directional-scattering shader.
 */
export class SkyAtmosphere {
  readonly group = new THREE.Group();
  readonly lowMistField: LowMistField;
  private readonly sky: THREE.Mesh;
  private readonly skyMaterial: AtmosphericSkyMaterial;
  private readonly clouds: THREE.Points | undefined;
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

    const random = new SeededRandom(`${seed}:atmosphere`);
    this.clouds = buildClouds(world, random);
    if (this.clouds) this.group.add(this.clouds);
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
    if (!this.clouds) return;
    const material = this.clouds.material;
    if (material instanceof THREE.PointsMaterial) material.color.copy(colour);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    void elapsedSeconds;
    if (this.clouds) this.clouds.rotation.y += deltaSeconds * 0.0042;
    this.lowMistField.update();
  }

  followCamera(camera: THREE.Camera): void {
    // Keep the horizon effectively infinite while preserving world-up for scattering.
    this.sky.position.copy(camera.position);
    this.clouds?.position.set(camera.position.x, 0, camera.position.z);
  }
}

function buildClouds(world: WorldState, random: SeededRandom): THREE.Points | undefined {
  const count = 260;
  const span = world.size * world.cellSize * 2.4;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = random.range(0, Math.PI * 2);
    const distance = (0.45 + Math.sqrt(random.float()) * 0.55) * span * 0.5;
    positions[index * 3] = Math.cos(angle) * distance;
    positions[index * 3 + 1] = random.range(46, 78);
    positions[index * 3 + 2] = Math.sin(angle) * distance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const clouds = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: '#eef2f2',
      size: 26,
      map: softPointTexture(),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: true,
    }),
  );
  clouds.name = 'cloud-layer';
  clouds.frustumCulled = false;
  return clouds;
}
