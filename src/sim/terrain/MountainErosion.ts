import { smoothstep } from './noise';

/**
 * A small stream-power pass for the high country, before permanent hydrology is routed.
 * Drainage collects into branching gullies, leaving divides as connected ridges. Eight-way
 * routing uses physical distance so diagonals have no advantage over cardinal directions.
 * Lowlands and coastlines are protected; incision cannot create a new local sink.
 */
export function erodeMountainDrainage(
  height: Float32Array, resolution: number, step: number, seaLevel: number,
): void {
  const order = Array.from(height.keys()).sort((a, b) => height[b]! - height[a]! || a - b);
  const downstream = new Int32Array(height.length).fill(-1);
  const catchment = new Float32Array(height.length).fill(step * step);
  const slopes = new Float32Array(height.length);
  for (const index of order) {
    const x = index % resolution;
    const z = Math.floor(index / resolution);
    let steepest = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if ((!dx && !dz) || x + dx < 0 || x + dx >= resolution || z + dz < 0 || z + dz >= resolution) continue;
        const next = index + dz * resolution + dx;
        const slope = (height[index]! - height[next]!) / (step * Math.hypot(dx, dz));
        if (slope > steepest) {
          steepest = slope;
          downstream[index] = next;
        }
      }
    }
    slopes[index] = steepest;
    const next = downstream[index]!;
    if (next >= 0) catchment[next] = catchment[next]! + catchment[index]!;
  }

  // Process upstream first against the unchanged downstream height: even the deepest incision
  // stays above its outlet, and the later outlet incision can only increase that clearance.
  for (const index of order) {
    const next = downstream[index]!;
    if (next < 0) continue;
    const elevation = height[index]!;
    const upland = smoothstep(seaLevel + 0.14, seaLevel + 0.32, elevation);
    const drainage = smoothstep(2, 55, catchment[index]!);
    const incision = Math.min(0.038, Math.sqrt(catchment[index]!) * slopes[index]! * 0.19) * upland * drainage;
    height[index] = elevation - Math.min(incision, (elevation - height[next]!) * 0.72);
  }
}
