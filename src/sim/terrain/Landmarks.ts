import type { Hydrology } from './Hydrology';
import type { RawHeightfield } from './Heightfield';
import type { LandmarkKind, WorldLandmark } from './TerrainField';
import { clamp01 } from './noise';

const read = (values: Float32Array, index: number): number => values[index] ?? 0;

interface Candidate {
  kind: LandmarkKind;
  index: number;
  prominence: number;
}

interface LandmarkOptions {
  readonly seaLevel: number;
  readonly mountainLevel: number;
  readonly verticalScale: number;
}

/** How far a sample stands above, and sits below, the ring of terrain around it. */
function localRelief(height: Float32Array, resolution: number, index: number, radius: number): { above: number; below: number } {
  const x = index % resolution;
  const z = (index / resolution) | 0;
  const centre = read(height, index);
  let lowest = centre;
  let highest = centre;
  for (let dz = -radius; dz <= radius; dz += radius) {
    for (let dx = -radius; dx <= radius; dx += radius) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
      const value = read(height, nz * resolution + nx);
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
  }
  return { above: centre - lowest, below: highest - centre };
}

function collect(candidates: Candidate[], kind: LandmarkKind, index: number, prominence: number): void {
  if (prominence <= 0) return;
  candidates.push({ kind, index, prominence });
}

/**
 * Picks the rare, deterministic set of natural features a viewer would remember: the great peak,
 * the falls, the sacred lake, the pass. Cities grow near them and the camera seeks them out.
 */
export function detectLandmarks(raw: RawHeightfield, hydrology: Hydrology, options: LandmarkOptions): WorldLandmark[] {
  const { seaLevel, mountainLevel } = options;
  const { height, resolution, step, originX, originZ } = raw;
  const candidates: Candidate[] = [];

  for (let z = 3; z < resolution - 3; z += 1) {
    for (let x = 3; x < resolution - 3; x += 1) {
      const index = z * resolution + x;
      const ground = read(height, index);
      const relief = localRelief(height, resolution, index, 3);

      if (ground > mountainLevel) collect(candidates, 'great-peak', index, clamp01((ground - mountainLevel) * 3.4 + relief.above * 2.2));
      if (hydrology.fall[index]) collect(candidates, 'waterfall', index, clamp01(read(hydrology.fall, index) * 0.7 + read(hydrology.flow, index) * 0.6));
      if (hydrology.lake[index]) collect(candidates, 'sacred-lake', index, clamp01(read(hydrology.filled, index) * 0.5 + read(hydrology.flow, index) * 0.5));
      if (ground > seaLevel + 0.08 && relief.below > 0.1) collect(candidates, 'deep-canyon', index, clamp01(relief.below * 2.6 - read(hydrology.flow, index) * 0.4));
      if (ground > mountainLevel - 0.16 && ground < mountainLevel - 0.02 && relief.above < 0.02 && relief.below > 0.05) {
        collect(candidates, 'mountain-pass', index, clamp01((ground - (mountainLevel - 0.2)) * 3.6));
      }
      if (ground > seaLevel && ground < seaLevel + 0.12 && relief.above > 0.05 && nearOcean(height, resolution, index, seaLevel)) {
        collect(candidates, 'cliff-cape', index, clamp01(relief.above * 5));
      }
      if (hydrology.river[index] && nearOcean(height, resolution, index, seaLevel)) {
        collect(candidates, 'river-mouth', index, clamp01(read(hydrology.flow, index)));
      }
    }
  }

  const perKind: Record<LandmarkKind, number> = {
    'great-peak': 2,
    'mountain-pass': 2,
    waterfall: 2,
    'sacred-lake': 1,
    'deep-canyon': 2,
    'cliff-cape': 1,
    'river-mouth': 2,
  };
  const separation = step * resolution * 0.14;
  const chosen: WorldLandmark[] = [];
  candidates.sort((a, b) => (b.prominence - a.prominence) || (a.index - b.index));

  for (const candidate of candidates) {
    const remaining = perKind[candidate.kind];
    if (remaining <= 0) continue;
    const worldX = originX + (candidate.index % resolution) * step;
    const worldZ = originZ + (((candidate.index / resolution) | 0)) * step;
    if (chosen.some((other) => Math.hypot(other.worldX - worldX, other.worldZ - worldZ) < separation)) continue;
    perKind[candidate.kind] = remaining - 1;
    chosen.push({
      id: `landmark-${candidate.kind}-${chosen.length}`,
      kind: candidate.kind,
      worldX,
      worldZ,
      elevation: read(height, candidate.index),
      prominence: candidate.prominence,
    });
  }
  return chosen;
}

function nearOcean(height: Float32Array, resolution: number, index: number, seaLevel: number): boolean {
  const x = index % resolution;
  const z = (index / resolution) | 0;
  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
      if (read(height, nz * resolution + nx) < seaLevel) return true;
    }
  }
  return false;
}
