import * as THREE from 'three';

const CHANNELS = [
  ['waterDepth', 1, 0], ['waterFlow', 1, 1], ['waterKind', 1, 2], ['waterHierarchy', 1, 3],
  ['waterFlowDirection', 2, 4], ['waterRapid', 1, 6], ['waterWind', 1, 7],
  ['waterWindDirection', 2, 8], ['waterRain', 1, 10], ['waterStorm', 1, 11],
  ['waterFreezePrevious', 1, 12], ['waterFreeze', 1, 13], ['waterSnow', 1, 14], ['waterEmergence', 1, 15],
] as const;

const WATER_DISCONTINUITY_MIN_DROP = 0.68;
const WATER_DISCONTINUITY_SLOPE = 0.85;

/**
 * Inland water is emitted as a non-indexed triangle fan per wet hydrology sample. Normally the
 * neighbouring samples share a gently interpolated surface, but a real waterfall/cliff can put one
 * vertex several world units above the other two. Rendering that triangle literally creates the
 * tall crystalline spikes seen at sharp drops.
 *
 * Treat those near-vertical triangles as discontinuities instead. Because the geometry is
 * non-indexed, collapsing only the outlier vertex makes the offending triangle degenerate without
 * moving neighbouring water. The dedicated waterfall sheet remains responsible for the vertical
 * body of water, while ordinary rivers/lakes keep their smooth interpolation.
 */
export function stabilizeInlandWaterGeometry(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return 0;
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || position.count % 3 !== 0) return 0;

  let collapsed = 0;
  for (let start = 0; start < position.count; start += 3) {
    const indices = [start, start + 1, start + 2] as const;
    let low = indices[0];
    let high = indices[0];
    for (const index of indices.slice(1)) {
      if (position.getY(index) < position.getY(low)) low = index;
      if (position.getY(index) > position.getY(high)) high = index;
    }

    const lowY = position.getY(low);
    const highY = position.getY(high);
    const verticalSpan = highY - lowY;
    const horizontalSpan = Math.hypot(position.getX(high) - position.getX(low), position.getZ(high) - position.getZ(low));
    const allowedSpan = Math.max(WATER_DISCONTINUITY_MIN_DROP, horizontalSpan * WATER_DISCONTINUITY_SLOPE);
    if (verticalSpan <= allowedSpan) continue;

    const middle = indices.find(index => index !== low && index !== high)!;
    const highGap = highY - position.getY(middle);
    const lowGap = position.getY(middle) - lowY;
    const outlier = highGap >= lowGap ? high : low;
    const anchors = indices.filter(index => index !== outlier);
    const anchor = anchors.reduce((best, candidate) => {
      const candidateDistance = Math.hypot(position.getX(candidate) - position.getX(outlier), position.getZ(candidate) - position.getZ(outlier));
      const bestDistance = Math.hypot(position.getX(best) - position.getX(outlier), position.getZ(best) - position.getZ(outlier));
      return candidateDistance < bestDistance ? candidate : best;
    });

    position.setXYZ(outlier, position.getX(anchor), position.getY(anchor), position.getZ(anchor));
    collapsed += 1;
  }

  if (collapsed > 0) position.needsUpdate = true;
  return collapsed;
}

/** Four vec4 bindings instead of fourteen individual attribute locations. Legacy named views
 * share this same buffer for hydrology inspection/tests, with no duplicated GPU storage. */
export function packInlandAttributes(geometry: THREE.BufferGeometry): void {
  stabilizeInlandWaterGeometry(geometry);
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
