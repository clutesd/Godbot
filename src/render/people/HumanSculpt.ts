import * as THREE from 'three';

/**
 * HumanSculpt.ts
 *
 * The lathe used to build every part of a person. A part is described as a stack of elliptical
 * cross-sections — height, half-width, half-depth and a sagittal (fore/aft) offset — and is swept
 * with monotone Hermite interpolation so the surface curves without overshooting narrow sections.
 *
 * Every sculpted part carries the four channels the human surface shader needs:
 *   humanSurface.x  material zone (obsidian, drape, stone, crest, alloy, wood, glyph)
 *   humanSurface.y  clothing axis, 0 at the proximal attachment and 1 at the distal tip
 *   humanSurface.z  baked crevice occlusion, 1 = fully open surface
 *   humanSurface.w  wardrobe part id, used by the part-selecting atlas meshes
 *
 * Parts are always closed, so merging several of them keeps the result watertight and shadow
 * silhouettes solid.
 */

/** [height, half-width, half-depth, sagittal offset]. Must be ordered by ascending height. */
export type Section = readonly [number, number, number, number];

/**
 * Material zones of the species. The body is living volcanic glass, not skin, and what it wears is
 * carved, cast or woven rather than tailored. The numeric values are stable so a zone can be
 * retuned in the shader without re-authoring geometry.
 */
/** The body itself: deep charcoal volcanic glass, polished, dielectric, environment-driven. */
export const ZONE_OBSIDIAN = 0;
/** Dense woven ceremonial cloth. Dark, matte, used for drapes and panels only. */
export const ZONE_DRAPE = 1;
/** Carved stone and raw mineral adornment. The primitive end of the ornament vocabulary. */
export const ZONE_STONE = 2;
/** The sculpted obsidian crest that occupies the place hair would on a human skull. */
export const ZONE_CREST = 3;
/** Cast and polished alloy: the gold/bronze/pale-metal adornment the species works. */
export const ZONE_ALLOY = 4;
/** Hafts and carried timber. */
export const ZONE_WOOD = 5;
/** A luminous inlay channel. The only zone that emits; always a minority of a body's area. */
export const ZONE_GLYPH = 6;

export interface SculptOptions {
  radial: number;
  /** Extra interpolated rings between authored sections. */
  samples?: number;
  zone?: number;
  /** Legacy head flag. The face is now selected by the material's mode uniform instead. */
  surface?: number;
  /** Maps section height to the 0..1 clothing axis. Constant 1 means "never clothed". */
  cover?: (height: number) => number;
  /** Maps height and radial angle to 0..1 openness. Lower values darken creases. */
  occlusion?: (height: number, angle: number) => number;
  part?: number;
}

function sectionAt(sections: readonly Section[], y: number): Section {
  let i = 0;
  while (i < sections.length - 2 && y > sections[i + 1]![0]) i++;
  const a = sections[i]!, b = sections[i + 1]!;
  const t = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
  // Monotone Hermite tangents smooth the silhouette without overshooting narrow sections.
  const channels = [1, 2, 3].map(channel => {
    const slope = (j: number) => (sections[j + 1]![channel]! - sections[j]![channel]!) / (sections[j + 1]![0] - sections[j]![0]);
    const tangent = (j: number) => {
      if (j === 0) return slope(0);
      if (j === sections.length - 1) return slope(j - 1);
      const left = slope(j - 1), right = slope(j);
      return left * right <= 0 ? 0 : 2 * left * right / (left + right);
    };
    const span = b[0] - a[0];
    return (2 * t ** 3 - 3 * t * t + 1) * a[channel]!
      + (t ** 3 - 2 * t * t + t) * tangent(i) * span
      + (-2 * t ** 3 + 3 * t * t) * b[channel]!
      + (t ** 3 - t * t) * tangent(i + 1) * span;
  });
  return [y, channels[0]!, channels[1]!, channels[2]!];
}

export function sculpt(sections: readonly Section[], options: SculptOptions): THREE.BufferGeometry {
  const { radial, samples = 1, zone = ZONE_OBSIDIAN, surface = 0, part = 0 } = options;
  const cover = options.cover ?? (() => 1);
  const occlusion = options.occlusion ?? (() => 1);
  const vertices: number[] = [], indices: number[] = [], uvs: number[] = [], channels: number[] = [];
  const rings = (sections.length - 1) * samples + 1;
  for (let ring = 0; ring < rings; ring++) {
    const i = Math.min(sections.length - 2, Math.floor(ring / samples));
    const y = THREE.MathUtils.lerp(sections[i]![0], sections[i + 1]![0], (ring - i * samples) / samples);
    const [, rx, rz, z] = sectionAt(sections, y);
    const coverage = cover(y);
    for (let j = 0; j < radial; j++) {
      const angle = j / radial * Math.PI * 2;
      vertices.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + z);
      uvs.push(j / radial, ring / (rings - 1));
      channels.push(zone, coverage, occlusion(y, angle), part);
      if (ring < rings - 1) {
        const a = ring * radial + j, b = ring * radial + (j + 1) % radial;
        indices.push(a, b, a + radial, b, b + radial, a + radial);
      }
    }
  }
  // Closed poles also keep shadow silhouettes watertight.
  for (const end of [0, rings - 1]) {
    const pole = vertices.length / 3;
    const s = end === 0 ? sections[0]! : sections[sections.length - 1]!;
    vertices.push(0, s[0], s[3]); uvs.push(0.5, end === 0 ? 0 : 1);
    channels.push(zone, cover(s[0]), occlusion(s[0], 0), part);
    for (let j = 0; j < radial; j++) {
      const a = end * radial + j, b = end * radial + (j + 1) % radial;
      indices.push(pole, end === 0 ? b : a, end === 0 ? a : b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('humanSurface', new THREE.Float32BufferAttribute(channels, 4));
  geometry.setAttribute('cosmicSurface', new THREE.Float32BufferAttribute(
    new Array(vertices.length / 3).fill(surface), 1));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** A sculpted part swept along +Z instead of +Y, for feet, noses and other forward forms. */
export function sculptForward(sections: readonly Section[], options: SculptOptions): THREE.BufferGeometry {
  return sculpt(sections, options).rotateX(Math.PI / 2);
}

/**
 * Gives a plain three.js primitive the four human-surface channels, so belts, straps, brims and
 * packs can join a sculpted atlas without a second material or a second draw call.
 */
export function decorate(geometry: THREE.BufferGeometry, options: {
  zone?: number; cover?: number; occlusion?: number; part?: number; surface?: number;
} = {}): THREE.BufferGeometry {
  const { zone = ZONE_DRAPE, cover = 1, occlusion = 1, part = 0, surface = 0 } = options;
  const count = geometry.getAttribute('position').count;
  const channels = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    channels[i * 4] = zone;
    channels[i * 4 + 1] = cover;
    channels[i * 4 + 2] = occlusion;
    channels[i * 4 + 3] = part;
  }
  geometry.setAttribute('humanSurface', new THREE.BufferAttribute(channels, 4));
  geometry.setAttribute('cosmicSurface', new THREE.Float32BufferAttribute(new Array(count).fill(surface), 1));
  if (!geometry.index) {
    const index = new Uint16Array(count);
    for (let i = 0; i < count; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }
  return geometry;
}

/** Overwrites the wardrobe part id of an already-built part, before it joins an atlas. */
export function tagPart(geometry: THREE.BufferGeometry, part: number): THREE.BufferGeometry {
  const channel = geometry.getAttribute('humanSurface');
  for (let i = 0; i < channel.count; i++) channel.setW(i, part);
  return geometry;
}
