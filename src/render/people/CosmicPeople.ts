import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roleVisualFamilyFor, type RoleVisualFamily } from './RoleVisualProfile';

/** Presentation dimensions only. Navigation, reach targets and simulation appearance are unchanged. */
export const COSMIC_HEIGHT_MULTIPLIER = 1.14;
export const COSMIC_BUILD_MULTIPLIER = 0.96;
export const COSMIC_CROWN_HEIGHT = 0.94;

export interface CosmicRoleStyle {
  color: string;
  symbol: 'circle' | 'diamond' | 'bar' | 'triangle' | 'crescent' | 'cross' | 'chevron' | 'double-bar' | 'square' | 'hourglass' | 'crown' | 'seed';
  shoulders: number;
  mantle: number;
  halo: number;
}

/** Independent channels leave room for future cultural/status/equipment layers without changing role. */
export const COSMIC_ROLES: Readonly<Record<RoleVisualFamily, CosmicRoleStyle>> = {
  earth: { color: '#a4cf71', symbol: 'seed', shoulders: 0.85, mantle: 0, halo: 0 },
  water: { color: '#63cce2', symbol: 'crescent', shoulders: 0.85, mantle: 0, halo: 0 },
  labor: { color: '#e9b65b', symbol: 'diamond', shoulders: 1.45, mantle: 0, halo: 0 },
  trade: { color: '#ef9062', symbol: 'double-bar', shoulders: 1, mantle: 0.45, halo: 0 },
  guard: { color: '#ef6353', symbol: 'chevron', shoulders: 1.7, mantle: 0, halo: 0 },
  ritual: { color: '#d68ac9', symbol: 'hourglass', shoulders: 0.75, mantle: 1, halo: 0 },
  civic: { color: '#e3d487', symbol: 'triangle', shoulders: 1.3, mantle: 0, halo: 0.8 },
  knowledge: { color: '#ae96ed', symbol: 'bar', shoulders: 0.7, mantle: 1, halo: 0 },
  industry: { color: '#759ee7', symbol: 'square', shoulders: 1.25, mantle: 0, halo: 0 },
  healing: { color: '#a2e7d0', symbol: 'cross', shoulders: 1, mantle: 0.55, halo: 0 },
  elder: { color: '#ede6cd', symbol: 'crown', shoulders: 0.95, mantle: 0.6, halo: 1 },
  ordinary: { color: '#b2bdcc', symbol: 'circle', shoulders: 0.65, mantle: 0, halo: 0 },
};
export const COSMIC_FAMILIES = Object.keys(COSMIC_ROLES) as RoleVisualFamily[];
const symbols = ['circle', 'diamond', 'bar', 'triangle', 'crescent', 'cross', 'chevron', 'double-bar', 'square', 'hourglass', 'crown', 'seed'];
export function cosmicRoleFor(role?: string): CosmicRoleStyle { return COSMIC_ROLES[roleVisualFamilyFor(role)]; }

export function cosmicAppearanceFor(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const a = (hash >>> 0) / 0xffffffff;
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  const b = (hash >>> 0) / 0xffffffff;
  return { height: 0.975 + a * 0.05, build: 0.96 + b * 0.08, seed: a, nebula: 0.65 + b * 0.35, brightness: 0.86 + a * 0.14 };
}

// Elliptical anatomical sections: height, half-width, half-depth, sagittal offset.
// Smooth interpolation gives a sculpted surface without a subdivided/imported character rig.
type Section = readonly [number, number, number, number];
const torso: readonly Section[] = [
  [-0.055, 0.012, 0.02, 0], [-0.035, 0.054, 0.042, -0.004],
  [0.005, 0.076, 0.052, -0.006], [0.07, 0.055, 0.037, -0.002],
  [0.13, 0.067, 0.044, 0], [0.205, 0.094, 0.059, 0.003],
  [0.25, 0.108, 0.049, 0], [0.272, 0.098, 0.04, -0.003],
  [0.293, 0.054, 0.031, -0.003], [0.32, 0.026, 0.024, -0.004],
  [0.35, 0.018, 0.021, -0.007], [0.369, 0.014, 0.019, -0.009],
];

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

function sculpt(sections: readonly Section[], radial: number, surface = 0, samples = 2): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], uvs: number[] = [];
  // Adaptive profile samples preserve curves without wasting vertices on invisible detail.
  const rings = (sections.length - 1) * samples + 1;
  for (let ring = 0; ring < rings; ring++) {
    const i = Math.min(sections.length - 2, Math.floor(ring / samples));
    const y = THREE.MathUtils.lerp(sections[i]![0], sections[i + 1]![0], (ring - i * samples) / samples);
    const [, rx, rz, z] = sectionAt(sections, y);
    for (let j = 0; j < radial; j++) {
      const angle = j / radial * Math.PI * 2;
      vertices.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + z);
      uvs.push(j / radial, ring / (rings - 1));
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
    for (let j = 0; j < radial; j++) {
      const a = end * radial + j, b = end * radial + (j + 1) % radial;
      indices.push(pole, end === 0 ? b : a, end === 0 ? a : b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('cosmicSurface', new THREE.Float32BufferAttribute(new Array(vertices.length / 3).fill(surface), 1));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createCosmicBodyGeometry(): THREE.BufferGeometry { return sculpt(torso, 16); }

export function createCosmicHeadGeometry(): THREE.BufferGeometry {
  return sculpt([
    [-0.105, 0.007, 0.013, 0.005], [-0.086, 0.026, 0.035, 0.003],
    [-0.055, 0.045, 0.05, 0], [-0.012, 0.06, 0.060, -0.004],
    [0.035, 0.061, 0.065, -0.009], [0.075, 0.045, 0.05, -0.01],
    [0.095, 0.021, 0.025, -0.01], [0.10, 0, 0, -0.01],
  ], 24, 1, 3).scale(0.80, 0.75, 0.80);
}

/** Single-mesh resting limbs retain the existing shoulder/hip pivots and instancing. */
export function createCosmicArmGeometry(segment?: 'upper' | 'lower'): THREE.BufferGeometry {
  if (segment) return segment === 'upper' ? sculpt([
    [-0.196, 0.019, 0.020, 0], [-0.15, 0.025, 0.027, 0],
    [-0.075, 0.029, 0.03, 0], [0, 0.025, 0.026, 0], [0.012, 0, 0, 0],
  ], 10) : sculpt([
    [-0.18, 0.009, 0.012, 0.006], [-0.163, 0.016, 0.013, 0.006],
    [-0.14, 0.013, 0.013, 0], [-0.08, 0.022, 0.021, 0],
    [-0.025, 0.024, 0.023, 0], [0, 0.020, 0.021, 0], [0.009, 0, 0, 0],
  ], 10);
  return sculpt([
    [-0.395, 0.008, 0.01, 0.018], [-0.38, 0.016, 0.013, 0.019],
    [-0.35, 0.014, 0.012, 0.014], [-0.325, 0.012, 0.013, 0.01],
    [-0.275, 0.022, 0.021, 0.005], [-0.225, 0.024, 0.023, 0],
    [-0.195, 0.019, 0.02, -0.004], [-0.145, 0.025, 0.027, -0.005],
    [-0.075, 0.029, 0.03, 0], [-0.015, 0.030, 0.032, 0],
    [0.003, 0.022, 0.023, 0], [0.014, 0, 0, 0],
  ], 10).scale(1, 0.95, 1);
}

export function createCosmicLegGeometry(segment?: 'upper' | 'lower'): THREE.BufferGeometry {
  if (segment) return segment === 'upper' ? sculpt([
    [-0.225, 0.023, 0.025, 0], [-0.18, 0.027, 0.03, 0],
    [-0.12, 0.034, 0.037, 0], [-0.045, 0.037, 0.04, 0],
    [0.012, 0.029, 0.031, 0], [0.03, 0, 0, 0],
  ], 10) : sculpt([
    [-0.225, 0.019, 0.046, 0.021], [-0.213, 0.025, 0.054, 0.023],
    [-0.19, 0.019, 0.033, 0.008], [-0.155, 0.017, 0.021, 0],
    [-0.1, 0.024, 0.028, -0.005], [-0.045, 0.029, 0.031, 0],
    [0, 0.024, 0.026, 0], [0.009, 0, 0, 0],
  ], 10);
  return sculpt([
    [-0.42, 0.019, 0.046, 0.021], [-0.408, 0.025, 0.054, 0.023],
    [-0.385, 0.019, 0.033, 0.008], [-0.35, 0.016, 0.02, 0],
    [-0.295, 0.024, 0.028, -0.009], [-0.25, 0.029, 0.031, -0.01],
    [-0.205, 0.023, 0.025, 0], [-0.18, 0.024, 0.026, 0.004],
    [-0.12, 0.034, 0.037, 0], [-0.045, 0.037, 0.04, -0.004],
    [0.012, 0.029, 0.031, -0.003], [0.035, 0, 0, 0],
  ], 10).scale(1, 0.45 / 0.42, 1);
}

/** Rounded, organic segments for the existing physical-work solver; endpoints are unchanged. */
export function createCosmicWorkLimbGeometry(): THREE.BufferGeometry {
  return sculpt([
    [-0.62, 0, 0, 0], [-0.56, 0.018, 0.018, 0], [-0.48, 0.025, 0.026, 0],
    [-0.2, 0.033, 0.034, 0], [0.25, 0.025, 0.025, 0],
    [0.5, 0.024, 0.024, 0], [0.58, 0.012, 0.012, 0], [0.62, 0, 0, 0],
  ], 10);
}

/** One small, shared reflection field for obsidian, including articulated work limbs.
 * Generated once, never per person/frame. It is deliberately neutral, with broad sky-like cards.
 * Caller owns the target; no scene lighting or postprocessing settings are changed. */
export function createCosmicReflectionEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color().setRGB(0.012, 0.017, 0.028);
  const cards = [
    { position: [-3, 2, 2], size: [1.5, 6], color: [2.0, 2.2, 2.6] },
    { position: [3, 1, -2], size: [2, 5], color: [0.7, 0.9, 1.5] },
    { position: [0, 5, 0], size: [5, 4], color: [1.0, 1.0, 1.1] },
  ];
  for (const card of cards) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(card.color[0]!, card.color[1]!, card.color[2]!) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(card.size[0], card.size[1]), material);
    mesh.position.set(card.position[0]!, card.position[1]!, card.position[2]!); mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, 0.12, 0.1, 20, { size: 128 });
  generator.dispose();
  studio.traverse(object => {
    if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
  });
  return target;
}

/** One reusable opaque shader: no per-person textures, lights, transparency, time noise or materials.
 * Sparse object-space stars fade below pixel resolution; the thin rim never fills the silhouette.
 * instanceColor owns role tint only. It must not multiply the obsidian surface itself. */
export function createCosmicBodyMaterial(individuality = true): THREE.MeshStandardMaterial {
  // A physically grounded obsidian shell with a deliberately impossible interior. The entire
  // population still shares one material; individuality is carried by the existing instanced seed.
  // Detail self-simplifies with pixel footprint so close shots feel intricate while distant people
  // remain clean, luminous silhouettes instead of noisy sparkles.
  const material = new THREE.MeshStandardMaterial({
    color: '#080a12',
    roughness: 0.26,
    metalness: 0.12,
    envMapIntensity: 0.72,
  });
  material.name = 'godbox-cosmic-obsidian';

  const daylight = { value: 1 };
  material.userData['daylight'] = daylight;
  const interior = { value: 1 };
  material.userData['interior'] = interior;

  material.onBeforeCompile = shader => {
    shader.uniforms['cosmicDaylight'] = daylight;
    shader.uniforms['cosmicInterior'] = interior;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 cosmicPoint;
      varying vec3 cosmicSeed;
      varying float cosmicSurfaceId;
      varying vec3 cosmicView;
      attribute float cosmicSurface;
      ${individuality ? 'attribute vec3 cosmicVariation;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        cosmicPoint = position;
        cosmicSurfaceId = cosmicSurface;
        cosmicSeed = ${individuality ? 'cosmicVariation' : 'vec3(0.43, 0.8, 0.94)'};`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 cosmicBasis = modelViewMatrix;
        #ifdef USE_INSTANCING
          cosmicBasis *= instanceMatrix;
        #endif
        cosmicView = normalize(vec3(dot(normalize(cosmicBasis[0].xyz), -mvPosition.xyz),
          dot(normalize(cosmicBasis[1].xyz), -mvPosition.xyz), dot(normalize(cosmicBasis[2].xyz), -mvPosition.xyz)));
      `);

    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 cosmicPoint;
      varying vec3 cosmicSeed;
      varying float cosmicSurfaceId;
      varying vec3 cosmicView;
      uniform float cosmicDaylight;
      uniform float cosmicInterior;

      float cosmicHash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }

      float cosmicStarCore(vec3 p, float threshold, float size) {
        vec3 cell = floor(p);
        vec3 local = fract(p) - 0.5;
        float h = cosmicHash(cell);
        float footprint = max(length(fwidth(p)), 0.001);
        float core = step(threshold, h)
          * (1.0 - smoothstep(size, size + 0.045 + footprint * 0.32, length(local)));
        return core * (1.0 - smoothstep(0.62, 2.0, footprint));
      }

      float cosmicStarHalo(vec3 p, float threshold) {
        vec3 cell = floor(p);
        vec3 local = fract(p) - 0.5;
        float h = cosmicHash(cell);
        float footprint = max(length(fwidth(p)), 0.001);
        float halo = step(threshold, h)
          * (1.0 - smoothstep(0.06, 0.34 + footprint * 0.22, length(local)));
        return halo * (1.0 - smoothstep(0.48, 1.55, footprint));
      }`)
      .replace('#include <color_fragment>', `
        // Nearly-black diffuse response preserves a readable solid form in daylight. The colour
        // story is emitted from within rather than painted across the surface.
        diffuseColor.rgb = vec3(0.0022, 0.0028, 0.0048);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Subtle material variation catches grazing light on curved forms. It is intentionally
        // low-frequency so the body reads as polished obsidian rather than plastic glitter.
        float cosmicPolishBand = 0.5 + 0.5 * sin(
          cosmicPoint.y * 8.0 + cosmicPoint.x * 11.0 + cosmicSeed.x * 19.0
        );
        roughnessFactor *= mix(1.04, 0.78, pow(cosmicPolishBand, 3.2));
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 accent = vec3(0.46, 0.62, 0.96);
        #ifdef USE_INSTANCING_COLOR
          accent = vColor.rgb;
        #endif

        float night = 1.0 - cosmicDaylight;
        float viewDistance = length(vViewPosition);
        float distanceRead = smoothstep(8.0, 42.0, viewDistance);

        // Two broad fields create layered depth instead of a single procedural stripe. Their
        // overlap is rare enough to feel like nebula structure rather than camouflage.
        float ribbonA = 0.5 + 0.5 * sin(
          cosmicPoint.y * 12.0
          + cosmicPoint.x * 17.0
          + sin(cosmicPoint.z * 20.0 + cosmicSeed.x * 17.0) * 1.2
          + cosmicSeed.x * 31.0
        );
        float ribbonB = 0.5 + 0.5 * sin(
          cosmicPoint.z * 16.0
          - cosmicPoint.y * 9.0
          + sin(cosmicPoint.x * 23.0 + cosmicSeed.x * 11.0) * 0.92
          + cosmicSeed.x * 47.0
        );
        float ribbonC = 0.5 + 0.5 * sin(
          (cosmicPoint.x + cosmicPoint.z) * 9.0
          - cosmicPoint.y * 5.0
          + cosmicSeed.x * 63.0
        );

        float nebulaMask = pow(
          clamp(ribbonA * 0.62 + ribbonB * 0.38 + ribbonC * 0.18 - 0.30, 0.0, 1.0),
          2.35
        );
        float nebulaCore = pow(clamp(ribbonA * ribbonB - 0.36, 0.0, 1.0), 1.7);

        vec3 deepBlue = vec3(0.010, 0.030, 0.105);
        vec3 violet = vec3(0.105, 0.022, 0.175);
        vec3 cyan = vec3(0.010, 0.125, 0.19);
        vec3 nebulaColour = mix(deepBlue, violet, smoothstep(0.16, 0.84, ribbonA));
        nebulaColour = mix(nebulaColour, cyan, smoothstep(0.56, 0.98, ribbonB) * 0.40);
        nebulaColour = mix(nebulaColour, accent * 0.30, 0.10);

        float nebulaEnergy = cosmicSeed.y * mix(0.10, 0.17, night) * cosmicInterior;
        totalEmissiveRadiance += nebulaColour * nebulaMask * nebulaEnergy;
        totalEmissiveRadiance += mix(violet, accent * 0.24, 0.28) * nebulaCore
          * cosmicSeed.y * mix(0.035, 0.065, night) * cosmicInterior;
        totalEmissiveRadiance += vec3(0.0006, 0.0009, 0.002);

        // Fine stars give close-up richness. Hero stars get a soft HDR halo and survive bloom as
        // isolated points of light. Both fade with pixel footprint before they can shimmer.
        vec3 fineField = (cosmicPoint - cosmicView * 0.012) * 45.0 + cosmicSeed.x * 173.0;
        vec3 heroField = (cosmicPoint - cosmicView * 0.027) * 22.0 + cosmicSeed.x * 311.0;
        float fineStars = cosmicStarCore(fineField, 0.992, 0.055);
        float heroStars = cosmicStarCore(heroField, 0.995, 0.075);
        float heroHalo = cosmicStarHalo(heroField, 0.995);

        float starWarmth = cosmicHash(floor(heroField) + vec3(19.0, 7.0, 3.0));
        vec3 coolStar = vec3(0.60, 0.83, 1.58);
        vec3 warmStar = vec3(1.90, 1.34, 0.72);
        vec3 heroColour = mix(coolStar, warmStar, smoothstep(0.60, 0.94, starWarmth));
        float starEnergy = cosmicSeed.z * mix(0.50, 0.72, night) * cosmicInterior;
        totalEmissiveRadiance += coolStar * fineStars * 0.70 * starEnergy;
        totalEmissiveRadiance += heroColour * heroHalo * 0.22 * starEnergy;
        totalEmissiveRadiance += heroColour * heroStars * 1.86 * starEnergy;

        // Dual-lobe Fresnel: a razor-thin bright edge on top of a broader, much dimmer aura. The
        // broad lobe receives a slight distance lift so tiny people remain unmistakably supernatural.
        float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        float broadRim = pow(1.0 - facing, 3.2);
        float fineRim = pow(1.0 - facing, 7.0);
        vec3 rimColour = mix(vec3(0.34, 0.49, 0.98), accent, 0.12);
        totalEmissiveRadiance += rimColour * broadRim
          * (mix(0.012, 0.020, night) + distanceRead * mix(0.008, 0.018, night));
        totalEmissiveRadiance += rimColour * fineRim * mix(0.12, 0.24, night);

        // A restrained aurora catches shoulders, skulls and limbs in close shots. It never becomes
        // a full-body glow; the black negative space is what gives the material its visual authority.
        float aurora = pow(clamp(ribbonA - 0.67, 0.0, 1.0), 3.1)
          * (0.40 + 0.60 * ribbonB);
        totalEmissiveRadiance += mix(vec3(0.022, 0.055, 0.17), accent * 0.23, 0.24)
          * aurora * mix(0.08, 0.14, night) * cosmicInterior;

        // The face is part of the head surface, so every head/spine transform is inherited.
        // A precise warm-white seam with a tiny central inflection, never a visor or decal.
        if (cosmicSurfaceId > 0.5) {
          float faceT = smoothstep(-0.078, 0.064, cosmicPoint.y);
          float diamond = max(0.0, 1.0 - abs(cosmicPoint.y - 0.006) / 0.013);
          float slitWidth = mix(0.00025, 0.00135, faceT) + diamond * 0.0011;
          float slitDistance = abs(cosmicPoint.x) - slitWidth;
          float aa = max(fwidth(cosmicPoint.x) * 0.7, 0.00015);
          float faceMask = smoothstep(0.002, 0.015, cosmicPoint.z)
            * smoothstep(-0.079, -0.07, cosmicPoint.y);
          float seam = 1.0 - smoothstep(-aa, aa, slitDistance);
          float halo = exp(-max(slitDistance, 0.0) * 600.0) * 0.10;
          totalEmissiveRadiance += mix(vec3(1.0, 0.88, 0.68), accent, 0.16)
            * (seam * mix(3.6, 3.0, night) + halo) * faceMask;
        }
      `);
  };

  material.customProgramCacheKey = () => `cosmic-obsidian-v4-${individuality}`;
  return material;
}

export function updateCosmicBodyMaterial(material: THREE.MeshStandardMaterial, daylight: number): void {
  (material.userData['daylight'] as { value: number }).value = THREE.MathUtils.clamp(daylight, 0, 1);
  material.envMapIntensity = THREE.MathUtils.lerp(0.22, 0.9, THREE.MathUtils.clamp(daylight, 0, 1));
}

export function bindCosmicVariation(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('cosmicVariation', attribute);
  return attribute;
}

/** Core front/back panels and silhouette trims share ONE instanced draw call for every family.
 * Geometry part IDs allow per-instance accessory proportions; glyphs are analytic and antialiased.
 * No billboard, pick target, depth override or permanent floating label is added. */
export class CosmicRoleAccents {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshBasicMaterial;
  private readonly styles: THREE.InstancedBufferAttribute;
  private readonly color = new THREE.Color();

  constructor(capacity: number) {
    const parts: THREE.BufferGeometry[] = [];
    const add = (geometry: THREE.BufferGeometry, part: number) => {
      geometry.setAttribute('cosmicPart', new THREE.Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(part), 1));
      parts.push(geometry);
    };
    // Reuse the exact torso triangles for the emissive inlay. A separate resampled panel can
    // intersect the ribcage between vertices and make the circular ring look broken in profile.
    const inlay = createCosmicBodyGeometry();
    inlay.deleteAttribute('cosmicSurface');
    const position = inlay.getAttribute('position'), normal = inlay.getAttribute('normal');
    const uv = inlay.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      uv.setXY(i, position.getX(i) / 0.15 + 0.5, (position.getY(i) - 0.19) / 0.28 + 0.5);
      position.setXYZ(i, position.getX(i) + normal.getX(i) * 0.00035,
        position.getY(i) + normal.getY(i) * 0.00035, position.getZ(i) + normal.getZ(i) * 0.00035);
    }
    add(inlay, 0);
    for (const side of [-1, 1]) {
      const shoulder = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.039, 0.307, 0.019),
        new THREE.Vector3(side * 0.076, 0.289, 0.025),
        new THREE.Vector3(side * 0.102, 0.269, 0.024),
      ]);
      add(new THREE.TubeGeometry(shoulder, 6, 0.0012, 3, false), 1);
      const seam = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.035, 0.09, -0.039),
        new THREE.Vector3(side * 0.025, 0.03, -0.041),
        new THREE.Vector3(side * 0.042, -0.04, -0.05),
      ]);
      add(new THREE.TubeGeometry(seam, 5, 0.0008, 3, false), 2);
    }
    add(new THREE.TorusGeometry(0.071, 0.0015, 3, 20).rotateX(Math.PI / 2).translate(0, 0.477, -0.01), 3);
    const geometry = mergeGeometries(parts)!;
    parts.forEach(part => part.dispose());
    this.styles = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('cosmicStyle', this.styles);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, fog: true });
    this.material.name = 'godbox-cosmic-role-cores';
    const daylight = { value: 1 };
    this.material.userData['daylight'] = daylight;
    this.material.onBeforeCompile = shader => {
      shader.uniforms['cosmicAccentDaylight'] = daylight;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 cosmicStyle;
        attribute float cosmicPart;
        varying vec2 coreUv;
        varying float glyph;
        varying float part;
        varying float shoulderEnergy;
      `).replace('#include <begin_vertex>', `#include <begin_vertex>
        coreUv = uv; glyph = cosmicStyle.x; part = cosmicPart; shoulderEnergy = cosmicStyle.y;
        if (cosmicPart > 1.5 && cosmicPart < 2.5) transformed *= cosmicStyle.z;
        if (cosmicPart > 2.5) transformed *= cosmicStyle.w;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 coreUv;
        varying float glyph;
        varying float part;
        varying float shoulderEnergy;
        uniform float cosmicAccentDaylight;
      `).replace('#include <color_fragment>', `#include <color_fragment>
        if (part < 0.5) {
          vec2 physical = (coreUv - 0.5) * vec2(0.15, 0.28);
          physical.y -= 0.015;
          vec2 p = physical / 0.019;
          vec2 a = abs(p);
          float d = length(p) - 0.61;
          if (glyph < 0.5) d = abs(length(p) - 0.49) - 0.17;
          else if (glyph < 1.5) d = a.x + a.y - 0.76;
          else if (glyph < 2.5) d = max(a.x - 0.22, a.y - 0.78);
          else if (glyph < 3.5) d = max(a.x * 0.866 + p.y * 0.5 - 0.37, -p.y - 0.55);
          else if (glyph < 4.5) d = max(length(p) - 0.7, 0.61 - length(p - vec2(0.3, 0.18)));
          else if (glyph < 5.5) d = min(max(a.x - 0.2, a.y - 0.7), max(a.x - 0.65, a.y - 0.2));
          else if (glyph < 6.5) d = max(abs(p.y + a.x * 0.85 - 0.24) - 0.19, a.x - 0.7);
          else if (glyph < 7.5) d = max(abs(a.x - 0.34) - 0.17, a.y - 0.66);
          else if (glyph < 8.5) d = abs(max(a.x, a.y) - 0.48) - 0.16;
          else if (glyph < 9.5) d = max(a.x - a.y * 0.82 - 0.13, a.y - 0.7);
          else if (glyph < 10.5) d = min(max(a.x - 0.7, abs(p.y + 0.38) - 0.17), max(abs(a.x - 0.48) - 0.16, abs(p.y - 0.05) - 0.42));
          else d = length(p * vec2(1.65, 0.92)) - 0.7;
          // Every role sits within the same thin circular core. Glyphs are subordinate.
          float glyphDistance = d * 0.019;
          float ringDistance = abs(length(physical) - 0.043) - 0.00135;
          float axisDistance = max(abs(physical.x) - 0.00065,
            max(-physical.y - 0.14, physical.y - 0.11));
          axisDistance = max(axisDistance, 0.046 - abs(physical.y));
          d = min(ringDistance, axisDistance);
          float aa = max(fwidth(d) * 0.8, 0.00025);
          float coverage = 1.0 - smoothstep(-aa, aa, d);
          float halo = (1.0 - smoothstep(0.001, 0.004, max(d, 0.0))) * (1.0 - coverage);
          float coreEnergy = mix(2.5, 3.0, cosmicAccentDaylight);
          float haloEnergy = mix(0.11, 0.08, cosmicAccentDaylight);
          float roleGlyph = 1.0 - smoothstep(-aa, aa, glyphDistance);
          float energy = coverage * coreEnergy + halo * haloEnergy + roleGlyph * 0.42;
          if (energy < 0.025) discard;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.89, 0.72), 0.48) * energy;
        } else {
          float trimEnergy = part < 1.5 ? 0.38 : (part < 2.5 ? 0.20 : 0.50);
          if (part < 1.5) trimEnergy *= mix(0.7, 1.2, clamp(shoulderEnergy - 0.65, 0.0, 1.0));
          diffuseColor.rgb *= trimEnergy * mix(1.32, 0.92, cosmicAccentDaylight);
        }
      `);
    };
    this.material.customProgramCacheKey = () => 'cosmic-role-core-v3';
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.mesh.name = 'Cosmic role cores and silhouettes';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Decorative planes do not alter existing person selection or hover targets.
    this.mesh.raycast = () => {};
  }

  set(index: number, role: string | undefined, matrix: THREE.Matrix4, brightness: number): void {
    const style = cosmicRoleFor(role);
    this.styles.setXYZW(index, symbols.indexOf(style.symbol), style.shoulders, style.mantle, style.halo);
    this.mesh.setColorAt(index, this.color.set(style.color).multiplyScalar(brightness));
    this.mesh.setMatrixAt(index, matrix);
  }

  updateDaylight(daylight: number): void {
    const value = THREE.MathUtils.clamp(daylight, 0, 1);
    (this.material.userData['daylight'] as { value: number }).value = value;
    // Role identity stays chromatically stable across the day/night cycle; only emitted energy shifts.
    this.material.color.setScalar(1);
  }

  endFrame(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.styles.needsUpdate = true;
  }
}
