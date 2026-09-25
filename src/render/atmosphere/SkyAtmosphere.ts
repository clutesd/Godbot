import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { createAtmosphericSkyMaterial, setAtmosphericSkyPalette, type AtmosphericSkyMaterial } from './AtmosphericScattering';
import { LowMistField } from './LowMistField';
import { softPointTexture } from './sprites';

export interface WeatherAtmosphereFrame {
  cloud: number;
  storm: number;
  intensity: number;
  windX: number;
  windZ: number;
}

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
  private readonly clouds: THREE.Points | undefined;
  private readonly zenith = new THREE.Color();
  private readonly horizon = new THREE.Color();
  private readonly cloudTint = new THREE.Color('#eef2f2');
  private readonly stormTint = new THREE.Color('#66717b');
  private cloudTarget = 0;
  private stormTarget = 0;
  private rainTarget = 0;
  private windTargetX = 0;
  private windTargetZ = 0;
  private cloudCover = 0;
  private stormCover = 0;
  private rainStrength = 0;
  private windX = 0;
  private windZ = 0;

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
    this.cloudTint.copy(colour);
    this.applyCloudAppearance();
  }

  setWeatherFrame(frame: WeatherAtmosphereFrame): void {
    this.cloudTarget = THREE.MathUtils.clamp(frame.cloud, 0, 1);
    this.stormTarget = THREE.MathUtils.clamp(frame.storm, 0, 1);
    this.rainTarget = THREE.MathUtils.clamp(frame.intensity, 0, 1);
    this.windTargetX = THREE.MathUtils.clamp(frame.windX, -1, 1);
    this.windTargetZ = THREE.MathUtils.clamp(frame.windZ, -1, 1);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    const blend = 1 - Math.exp(-Math.min(1, deltaSeconds) * 1.35);
    this.cloudCover += (this.cloudTarget - this.cloudCover) * blend;
    this.stormCover += (this.stormTarget - this.stormCover) * blend;
    this.rainStrength += (this.rainTarget - this.rainStrength) * blend;
    this.windX += (this.windTargetX - this.windX) * blend;
    this.windZ += (this.windTargetZ - this.windZ) * blend;
    if (this.clouds) {
      const wind = Math.hypot(this.windX, this.windZ);
      const direction = Math.abs(this.windZ) > 0.04 ? Math.sign(this.windZ) : 1;
      this.clouds.rotation.y += deltaSeconds * (0.0018 + wind * 0.013) * direction;
      this.clouds.position.y = -this.stormCover * 5.5;
      this.applyCloudAppearance();
    }
    this.lowMistField.update(deltaSeconds, elapsedSeconds);
  }

  private applyCloudAppearance(): void {
    if (!this.clouds) return;
    const material = this.clouds.material;
    if (!(material instanceof THREE.PointsMaterial)) return;
    const cover = THREE.MathUtils.clamp(this.cloudCover, 0, 1);
    const storm = THREE.MathUtils.clamp(this.stormCover, 0, 1);
    material.opacity = 0.12 + cover * 0.34 + storm * 0.2;
    material.size = 23 + cover * 8 + storm * 5;
    material.color.copy(this.cloudTint).lerp(this.stormTint, THREE.MathUtils.clamp(storm * 0.82 + this.rainStrength * 0.16, 0, 0.92));
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
