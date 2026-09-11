/**
 * TerrainField is the high-resolution heightfield that sits underneath the coarse simulation
 * grid. The simulation still reasons in `WorldCell`s; the field is what gives the world its
 * shape, its water and its silhouette, and it is what the renderer meshes.
 */
export interface TerrainField {
  /** Samples per side. Index = z * resolution + x. */
  readonly resolution: number;
  /** World units between neighbouring samples. */
  readonly step: number;
  readonly originX: number;
  readonly originZ: number;
  /** Normalised ground elevation, same 0..1 space as `WorldCell.elevation`. */
  readonly height: Float32Array;
  /**
   * Normalised visible surface of permanent water plus the current dynamic stage/flood projection;
   * -1 where the sample is dry. Static hydrology is snapshotted by DynamicHydrology before weather
   * begins, while temporary inundation is authored independently in `floodDepth`.
   */
  readonly waterLevel: Float32Array;
  /** Temporary weather-driven inundation depth in world units above local ground. */
  readonly floodDepth: Float32Array;
  /** 0..1 normalised river discharge. */
  readonly flow: Float32Array;
  /** 0..1 exposed rock and scree, used for surface blending and boulder scatter. */
  readonly rock: Float32Array;
  readonly lake: Uint8Array;
  readonly river: Uint8Array;
  /** 0..1 waterfall intensity where a channel drops sharply. */
  readonly fall: Float32Array;
  readonly drainage?: { downstream: Int32Array; order: readonly number[]; accumulation: Float32Array };
}

export type LandmarkKind =
  | 'great-peak'
  | 'mountain-pass'
  | 'waterfall'
  | 'sacred-lake'
  | 'deep-canyon'
  | 'cliff-cape'
  | 'river-mouth';

export interface WorldLandmark {
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly worldX: number;
  readonly worldZ: number;
  /** Normalised ground elevation at the landmark. */
  readonly elevation: number;
  /** 0..1 how visually striking the feature is; the camera prefers the strong ones. */
  readonly prominence: number;
}

const at = (values: Float32Array, index: number): number => values[index] ?? 0;

export function fieldExtent(field: TerrainField): number {
  return (field.resolution - 1) * field.step;
}

/** Bilinear sample of any float channel, clamped at the field border. */
export function sampleField(field: TerrainField, values: Float32Array, worldX: number, worldZ: number): number {
  const { resolution, step, originX, originZ } = field;
  const fx = Math.min(resolution - 1, Math.max(0, (worldX - originX) / step));
  const fz = Math.min(resolution - 1, Math.max(0, (worldZ - originZ) / step));
  const x0 = Math.min(resolution - 1, Math.floor(fx));
  const z0 = Math.min(resolution - 1, Math.floor(fz));
  const x1 = Math.min(resolution - 1, x0 + 1);
  const z1 = Math.min(resolution - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const a = at(values, z0 * resolution + x0);
  const b = at(values, z0 * resolution + x1);
  const c = at(values, z1 * resolution + x0);
  const d = at(values, z1 * resolution + x1);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}

export function sampleHeight(field: TerrainField, worldX: number, worldZ: number): number {
  return sampleField(field, field.height, worldX, worldZ);
}

/** Nearest-sample lookup, for the boolean channels where interpolation would be meaningless. */
export function nearestIndex(field: TerrainField, worldX: number, worldZ: number): number {
  const { resolution, step, originX, originZ } = field;
  const x = Math.min(resolution - 1, Math.max(0, Math.round((worldX - originX) / step)));
  const z = Math.min(resolution - 1, Math.max(0, Math.round((worldZ - originZ) / step)));
  return z * resolution + x;
}
