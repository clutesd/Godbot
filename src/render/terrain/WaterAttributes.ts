import * as THREE from 'three';

const CHANNELS = [
  ['waterDepth', 1, 0], ['waterFlow', 1, 1], ['waterKind', 1, 2], ['waterHierarchy', 1, 3],
  ['waterFlowDirection', 2, 4], ['waterRapid', 1, 6], ['waterWind', 1, 7],
  ['waterWindDirection', 2, 8], ['waterRain', 1, 10], ['waterStorm', 1, 11],
  ['waterFreezePrevious', 1, 12], ['waterFreeze', 1, 13], ['waterSnow', 1, 14], ['waterEmergence', 1, 15],
] as const;

/**
 * Inland water is deliberately non-indexed so shoreline clipping can be exact, but raw per-face
 * normals would reveal every triangle at grazing angles. Average normals for vertices that occupy
 * the same physical point, preserving real river/lake slope while removing tessellation facets.
 */
export function smoothInlandWaterNormals(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || position.count % 3 !== 0) {
    geometry.computeVertexNormals();
    return;
  }

  const keyFor = (index: number): string =>
    `${position.getX(index).toFixed(4)}:${position.getY(index).toFixed(4)}:${position.getZ(index).toFixed(4)}`;
  const accumulated = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();

  for (let start = 0; start < position.count; start += 3) {
    a.set(position.getX(start), position.getY(start), position.getZ(start));
    b.set(position.getX(start + 1), position.getY(start + 1), position.getZ(start + 1));
    c.set(position.getX(start + 2), position.getY(start + 2), position.getZ(start + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    if (face.lengthSq() <= 1e-12) continue;
    for (let offset = 0; offset < 3; offset += 1) {
      const key = keyFor(start + offset);
      const normal = accumulated.get(key);
      if (normal) normal.add(face);
      else accumulated.set(key, face.clone());
    }
  }

  const normals = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const source = accumulated.get(keyFor(index));
    const length = source ? Math.hypot(source.x, source.y, source.z) : 0;
    normals[index * 3] = length > 1e-12 ? source!.x / length : 0;
    normals[index * 3 + 1] = length > 1e-12 ? source!.y / length : 1;
    normals[index * 3 + 2] = length > 1e-12 ? source!.z / length : 0;
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
