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

export function createCosmicBodyGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.18), new THREE.Vector2(0.064, -0.18),
    new THREE.Vector2(0.077, -0.03), new THREE.Vector2(0.117, 0.18),
    new THREE.Vector2(0.049, 0.23), new THREE.Vector2(0.031, 0.30), new THREE.Vector2(0, 0.30),
  ], 7);
}
export function createCosmicHeadGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(0.084, 1).scale(0.86, 1.19, 0.95);
}

/** One reusable opaque shader: no textures, lights, transparency, time noise or per-person materials.
 * Sparse object-space stars fade below pixel resolution; the thin rim never fills the silhouette.
 * instanceColor owns role tint only. It must not multiply the obsidian surface itself. */
export function createCosmicBodyMaterial(individuality = true): THREE.MeshStandardMaterial {
  // A physically grounded obsidian shell with a deliberately impossible interior. The entire
  // population still shares one material; individuality is carried by the existing instanced seed.
  // Detail self-simplifies with pixel footprint so close shots feel intricate while distant people
  // remain clean, luminous silhouettes instead of noisy sparkles.
  const material = new THREE.MeshStandardMaterial({
    color: '#080a12',
    roughness: 0.52,
    metalness: 0.22,
    envMapIntensity: 0.82,
  });
  material.name = 'godbox-cosmic-obsidian';

  const daylight = { value: 1 };
  material.userData['daylight'] = daylight;

  material.onBeforeCompile = shader => {
    shader.uniforms['cosmicDaylight'] = daylight;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 cosmicPoint;
      varying vec3 cosmicSeed;
      ${individuality ? 'attribute vec3 cosmicVariation;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        cosmicPoint = position;
        cosmicSeed = ${individuality ? 'cosmicVariation' : 'vec3(0.43, 0.8, 0.94)'};`);

    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 cosmicPoint;
      varying vec3 cosmicSeed;
      uniform float cosmicDaylight;

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
        diffuseColor.rgb = vec3(0.0032, 0.0042, 0.0105);
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

        float nebulaEnergy = cosmicSeed.y * mix(0.62, 1.04, night);
        totalEmissiveRadiance += nebulaColour * nebulaMask * nebulaEnergy;
        totalEmissiveRadiance += mix(violet, accent * 0.24, 0.28) * nebulaCore
          * cosmicSeed.y * mix(0.16, 0.34, night);
        totalEmissiveRadiance += vec3(0.005, 0.008, 0.021) * mix(0.78, 1.42, night);

        // Fine stars give close-up richness. Hero stars get a soft HDR halo and survive bloom as
        // isolated points of light. Both fade with pixel footprint before they can shimmer.
        vec3 fineField = cosmicPoint * 45.0 + cosmicSeed.x * 173.0;
        vec3 heroField = cosmicPoint * 22.0 + cosmicSeed.x * 311.0;
        float fineStars = cosmicStarCore(fineField, 0.966, 0.068);
        float heroStars = cosmicStarCore(heroField, 0.987, 0.095);
        float heroHalo = cosmicStarHalo(heroField, 0.987);

        float starWarmth = cosmicHash(floor(heroField) + vec3(19.0, 7.0, 3.0));
        vec3 coolStar = vec3(0.60, 0.83, 1.58);
        vec3 warmStar = vec3(1.90, 1.34, 0.72);
        vec3 heroColour = mix(coolStar, warmStar, smoothstep(0.60, 0.94, starWarmth));
        float starEnergy = cosmicSeed.z * mix(0.76, 1.20, night);
        totalEmissiveRadiance += coolStar * fineStars * 0.70 * starEnergy;
        totalEmissiveRadiance += heroColour * heroHalo * 0.22 * starEnergy;
        totalEmissiveRadiance += heroColour * heroStars * 1.86 * starEnergy;

        // Dual-lobe Fresnel: a razor-thin bright edge on top of a broader, much dimmer aura. The
        // broad lobe receives a slight distance lift so tiny people remain unmistakably supernatural.
        float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        float broadRim = pow(1.0 - facing, 1.8);
        float fineRim = pow(1.0 - facing, 5.2);
        vec3 rimColour = mix(vec3(0.34, 0.49, 0.98), accent, 0.48);
        totalEmissiveRadiance += rimColour * broadRim
          * (mix(0.040, 0.090, night) + distanceRead * mix(0.018, 0.050, night));
        totalEmissiveRadiance += rimColour * fineRim * mix(0.30, 0.68, night);

        // A restrained aurora catches shoulders, skulls and limbs in close shots. It never becomes
        // a full-body glow; the black negative space is what gives the material its visual authority.
        float aurora = pow(clamp(ribbonA - 0.67, 0.0, 1.0), 3.1)
          * (0.40 + 0.60 * ribbonB);
        totalEmissiveRadiance += mix(vec3(0.022, 0.055, 0.17), accent * 0.23, 0.24)
          * aurora * mix(0.40, 0.86, night);
      `);
  };

  material.customProgramCacheKey = () => `cosmic-obsidian-v3-${individuality}`;
  return material;
}

export function updateCosmicBodyMaterial(material: THREE.MeshStandardMaterial, daylight: number): void {
  (material.userData['daylight'] as { value: number }).value = THREE.MathUtils.clamp(daylight, 0, 1);
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
    add(new THREE.PlaneGeometry(0.21, 0.24).translate(0, 0.11, 0.105), 0);
    add(new THREE.PlaneGeometry(0.18, 0.21).rotateY(Math.PI).translate(0, 0.11, -0.105), 0);
    for (const side of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.045, 0.056, 0.025, 5).scale(0.9, 1, 1.1).translate(side * 0.132, 0.183, 0), 1);
      add(new THREE.BoxGeometry(0.022, 0.30, 0.025).rotateZ(side * -0.12).translate(side * 0.085, 0.06, -0.112), 2);
    }
    add(new THREE.TorusGeometry(0.115, 0.01, 3, 12).rotateX(Math.PI / 2).translate(0, 0.535, 0), 3);
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
      `).replace('#include <begin_vertex>', `#include <begin_vertex>
        coreUv = uv; glyph = cosmicStyle.x; part = cosmicPart;
        if (cosmicPart > 0.5 && cosmicPart < 1.5) transformed.x = sign(position.x) * 0.132 + (position.x - sign(position.x) * 0.132) * cosmicStyle.y;
        if (cosmicPart > 1.5 && cosmicPart < 2.5) transformed *= cosmicStyle.z;
        if (cosmicPart > 2.5) transformed *= cosmicStyle.w;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 coreUv;
        varying float glyph;
        varying float part;
        uniform float cosmicAccentDaylight;
      `).replace('#include <color_fragment>', `#include <color_fragment>
        if (part < 0.5) {
          vec2 p = (coreUv - 0.5) * 2.0;
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
          float aa = max(fwidth(d) * 1.25, 0.006);
          float coverage = 1.0 - smoothstep(-aa, aa, d);
          float halo = (1.0 - smoothstep(0.025, 0.22, max(d, 0.0))) * (1.0 - coverage);
          float coreEnergy = mix(1.82, 1.28, cosmicAccentDaylight);
          float haloEnergy = mix(0.24, 0.12, cosmicAccentDaylight);
          float energy = coverage * coreEnergy + halo * haloEnergy;
          if (energy < 0.025) discard;
          diffuseColor.rgb *= energy;
        } else {
          float trimEnergy = part < 1.5 ? 0.72 : (part < 2.5 ? 0.48 : 0.84);
          diffuseColor.rgb *= trimEnergy * mix(1.32, 0.92, cosmicAccentDaylight);
        }
      `);
    };
    this.material.customProgramCacheKey = () => 'cosmic-role-core-v2';
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
