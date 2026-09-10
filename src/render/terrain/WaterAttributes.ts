import * as THREE from 'three';

const CHANNELS = [
  ['waterDepth', 1, 0], ['waterFlow', 1, 1], ['waterKind', 1, 2], ['waterHierarchy', 1, 3],
  ['waterFlowDirection', 2, 4], ['waterRapid', 1, 6], ['waterWind', 1, 7],
  ['waterWindDirection', 2, 8], ['waterRain', 1, 10], ['waterStorm', 1, 11],
  ['waterFreezePrevious', 1, 12], ['waterFreeze', 1, 13], ['waterSnow', 1, 14], ['waterEmergence', 1, 15],
] as const;

/** Four vec4 bindings instead of fourteen individual attribute locations. Legacy named views
 * share this same buffer for hydrology inspection/tests, with no duplicated GPU storage. */
export function packInlandAttributes(geometry: THREE.BufferGeometry): void {
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
