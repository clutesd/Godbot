import * as THREE from 'three';

const CHANNELS = [
  ['waterDepth', 1, 0], ['waterFlow', 1, 1], ['waterKind', 1, 2], ['waterHierarchy', 1, 3],
  ['waterFlowDirection', 2, 4], ['waterRapid', 1, 6], ['waterWind', 1, 7],
  ['waterWindDirection', 2, 8], ['waterRain', 1, 10], ['waterStorm', 1, 11],
  ['waterFreezePrevious', 1, 12], ['waterFreeze', 1, 13], ['waterSnow', 1, 14], ['waterEmergence', 1, 15],
] as const;

/** Tenth-of-a-millimetre buckets: finer than any position the mesher distinguishes. */
const WELD_QUANTUM = 1e4;

/**
 * Canonical vertex id per physical point. The water mesh is non-indexed and welds its shared points
 * several times over (lighting, open-edge detection, cascade slope), so do it once with integer
 * hashing. Per-vertex string keys cost more than the meshing itself on a large map.
 */
export function weldWaterVertices(positions: ArrayLike<number>, count: number): Int32Array {
  const quantized = new Int32Array(count * 3);
  for (let index = 0; index < count * 3; index += 1) quantized[index] = Math.round(positions[index]! * WELD_QUANTUM);
  const ids = new Int32Array(count);
  const buckets = new Map<number, number[]>();
  for (let index = 0; index < count; index += 1) {
    const x = quantized[index * 3]!, y = quantized[index * 3 + 1]!, z = quantized[index * 3 + 2]!;
    const hash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
    const bucket = buckets.get(hash);
    if (!bucket) { buckets.set(hash, [index]); ids[index] = index; continue; }
    let match = -1;
    for (const candidate of bucket) {
      if (quantized[candidate * 3] === x && quantized[candidate * 3 + 1] === y && quantized[candidate * 3 + 2] === z) { match = ids[candidate]!; break; }
    }
    if (match >= 0) ids[index] = match;
    else { bucket.push(index); ids[index] = index; }
  }
  return ids;
}

/**
 * Inland water is deliberately non-indexed so shoreline clipping can be exact, but raw per-face
 * normals would reveal every triangle at grazing angles. Average normals for vertices that occupy
 * the same physical point, preserving real river/lake slope while removing tessellation facets.
 */
export function smoothInlandWaterNormals(geometry: THREE.BufferGeometry, welded?: Int32Array): void {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || position.count % 3 !== 0) {
    geometry.computeVertexNormals();
    return;
  }

  const count = position.count;
  const ids = welded ?? weldWaterVertices((position.array as ArrayLike<number>), count);
  const accumulated = new Float64Array(count * 3);
  for (let start = 0; start < count; start += 3) {
    const ax = position.getX(start), ay = position.getY(start), az = position.getZ(start);
    const bx = position.getX(start + 1) - ax, by = position.getY(start + 1) - ay, bz = position.getZ(start + 1) - az;
    const cx = position.getX(start + 2) - ax, cy = position.getY(start + 2) - ay, cz = position.getZ(start + 2) - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    if (nx * nx + ny * ny + nz * nz <= 1e-12) continue;
    for (let offset = 0; offset < 3; offset += 1) {
      const id = ids[start + offset]! * 3;
      accumulated[id] = accumulated[id]! + nx;
      accumulated[id + 1] = accumulated[id + 1]! + ny;
      accumulated[id + 2] = accumulated[id + 2]! + nz;
    }
  }

  const normals = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const id = ids[index]!;
    const x = accumulated[id * 3]!, y = accumulated[id * 3 + 1]!, z = accumulated[id * 3 + 2]!;
    const length = Math.hypot(x, y, z);
    normals[index * 3] = length > 1e-12 ? x / length : 0;
    normals[index * 3 + 1] = length > 1e-12 ? y / length : 1;
    normals[index * 3 + 2] = length > 1e-12 ? z / length : 0;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

/** Four vec4 bindings instead of fourteen individual attribute locations. Legacy named views
 * share this same buffer for hydrology inspection/tests, with no duplicated GPU storage. */
export function packInlandAttributes(geometry: THREE.BufferGeometry): void {
  // Geometry is already contoured and stabilized before attributes are packed.
  const count = geometry.getAttribute('position').count;
  const packed = new Float32Array(count * 16);
  for (const [name, size, offset] of CHANNELS) {
    const source = geometry.getAttribute(name);
    for (let i = 0; i < count; i++) {
      packed[i * 16 + offset] = source.getX(i);
      if (size === 2) packed[i * 16 + offset + 1] = source.getY(i);
    }
  }
  const buffer = new THREE.InterleavedBuffer(packed, 16);
  for (let i = 0; i < 4; i++) geometry.setAttribute(`waterPacked${i}`, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4));
  for (const [name, size, offset] of CHANNELS) geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
}

export function packInlandShader(source: string): string {
  let shader = source;
  for (const [name, size, offset] of CHANNELS) {
    const components = 'xyzw'.slice(offset % 4, offset % 4 + size);
    shader = shader.replace(`attribute ${size === 2 ? 'vec2' : 'float'} ${name};`,
      `#define ${name} waterPacked${Math.floor(offset / 4)}.${components}`);
  }
  return shader.replace('#include <common>', '#include <common>\nattribute vec4 waterPacked0;\nattribute vec4 waterPacked1;\nattribute vec4 waterPacked2;\nattribute vec4 waterPacked3;');
}
