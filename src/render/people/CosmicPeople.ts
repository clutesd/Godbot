import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roleVisualFamilyFor, type RoleVisualFamily } from './RoleVisualProfile';
import {
  createHumanArmGeometry, createHumanForearmGeometry, createHumanHeadGeometry, createHumanLegGeometry,
  createHumanShinGeometry, createHumanThighGeometry, createHumanTorsoGeometry, createHumanUpperArmGeometry,
  createHumanWorkLimbGeometry,
} from './HumanAnatomy';
import {
  HUMAN_SURFACE_MODE, bindHumanSurface, createHumanSurfaceMaterial, updateHumanSurfaceMaterial,
  type HumanSurfaceMode,
} from './HumanSurfaceMaterial';

/**
 * Gives any mesh drawn with the obsidian body material its per-instance material channels. Without
 * it the attributes default to zero and the surface resolves to pure black, so every renderer that
 * draws bodies with this material — articulated work limbs, resting figures, war companies — must
 * call it once at construction. The seeded defaults are already a valid neutral inhabitant.
 */
export function bindCosmicBodySurface(mesh: THREE.InstancedMesh): void {
  bindHumanSurface(mesh);
}

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
/**
 * Role light. Every entry sits inside the species' warm luminous band, so a role shifts the hue of
 * an inhabitant's inlay without ever making them look like a different creature. Culture still
 * dominates that colour; this is the smaller of the two contributions to it.
 */
export const COSMIC_ROLES: Readonly<Record<RoleVisualFamily, CosmicRoleStyle>> = {
  earth: { color: '#d8bd63', symbol: 'seed', shoulders: 0.85, mantle: 0, halo: 0 },
  water: { color: '#8ac8d6', symbol: 'crescent', shoulders: 0.85, mantle: 0, halo: 0 },
  labor: { color: '#edaa50', symbol: 'diamond', shoulders: 1.45, mantle: 0, halo: 0 },
  trade: { color: '#f09a58', symbol: 'double-bar', shoulders: 1, mantle: 0.45, halo: 0 },
  guard: { color: '#ef7048', symbol: 'chevron', shoulders: 1.7, mantle: 0, halo: 0 },
  ritual: { color: '#d892c6', symbol: 'hourglass', shoulders: 0.75, mantle: 1, halo: 0 },
  civic: { color: '#f0d484', symbol: 'triangle', shoulders: 1.3, mantle: 0, halo: 0.8 },
  knowledge: { color: '#b49ae8', symbol: 'bar', shoulders: 0.7, mantle: 1, halo: 0 },
  industry: { color: '#8fabe2', symbol: 'square', shoulders: 1.25, mantle: 0, halo: 0 },
  healing: { color: '#9ce0c4', symbol: 'cross', shoulders: 1, mantle: 0.55, halo: 0 },
  elder: { color: '#f2e4c4', symbol: 'crown', shoulders: 0.95, mantle: 0.6, halo: 1 },
  ordinary: { color: '#ffb45c', symbol: 'circle', shoulders: 0.65, mantle: 0, halo: 0 },
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

/**
 * Body geometry now lives in HumanAnatomy, which owns the same skeleton contract these functions
 * always published: the torso origin, the 0.425 head anchor, 0.19/0.18 arm segments and 0.225/0.225
 * leg segments, with the sole exactly 0.45 below the hip. Callers are unchanged; the anatomy is not.
 */
export function createCosmicBodyGeometry(): THREE.BufferGeometry { return createHumanTorsoGeometry(); }

export function createCosmicHeadGeometry(): THREE.BufferGeometry { return createHumanHeadGeometry(); }

/** Hands are part of the forearm mesh, so a person gains hands without gaining a draw call. */
export function createCosmicArmGeometry(segment?: 'upper' | 'lower'): THREE.BufferGeometry {
  if (segment === 'upper') return createHumanUpperArmGeometry();
  if (segment === 'lower') return createHumanForearmGeometry();
  return createHumanArmGeometry();
}

/** Feet are part of the shin mesh, for the same reason. */
export function createCosmicLegGeometry(segment?: 'upper' | 'lower'): THREE.BufferGeometry {
  if (segment === 'upper') return createHumanThighGeometry();
  if (segment === 'lower') return createHumanShinGeometry();
  return createHumanLegGeometry();
}

/** Rounded, organic segments for the existing physical-work solver; endpoints are unchanged. */
export function createCosmicWorkLimbGeometry(): THREE.BufferGeometry {
  return createHumanWorkLimbGeometry();
}

/** One small, shared reflection field, including articulated work limbs.
 * Generated once, never per person/frame. It is deliberately neutral, with broad sky-like cards.
 * Caller owns the target; no scene lighting or postprocessing settings are changed. */
export function createCosmicReflectionEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color().setRGB(0.07, 0.08, 0.1);
  const cards = [
    { position: [-3, 2, 2], size: [1.5, 6], color: [1.4, 1.5, 1.7] },
    { position: [3, 1, -2], size: [2, 5], color: [0.6, 0.72, 1.0] },
    { position: [0, 5, 0], size: [5, 4], color: [1.0, 1.0, 1.05] },
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

/**
 * The reflection field the obsidian bodies are read through, and the single most important input
 * to how expensive the species looks.
 *
 * Polished volcanic glass has almost no diffuse response: nearly everything the eye uses to follow
 * a shoulder, a ribcage or a calf arrives as a reflection, so a flat grey probe produces a flat
 * black body no matter how good the shading is. This field has structure instead — a bright
 * zenith, a warm horizon band with a hard line at it, a dim warm ground bounce, and three cards
 * acting as key, cool fill and warm rim — so anatomy stays readable with every inlay switched off,
 * and the highlight travelling across a body as it turns is a real moving horizon.
 *
 * One 256px PMREM for the entire population. Generated once, never per person or per frame.
 */
export function createObsidianReflectionEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const studio = new THREE.Scene();
  const radius = 12;
  const dome = new THREE.SphereGeometry(radius, 24, 16);
  const position = dome.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  // Deliberately dark for a daylight probe. A bright even dome lights every square millimetre of
  // a polished body equally, which is precisely how obsidian turns into grey plastic. The energy
  // belongs in the key card, where it becomes a highlight that travels and describes a form.
  const zenith = new THREE.Color().setRGB(0.16, 0.20, 0.29);
  const horizon = new THREE.Color().setRGB(0.44, 0.36, 0.26);
  const ground = new THREE.Color().setRGB(0.040, 0.036, 0.032);
  const scratch = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i) / radius;
    // The horizon is a hard transition rather than a gradient: that edge is what a curved polished
    // surface turns into the long travelling highlight which describes its form.
    if (height >= 0) scratch.copy(horizon).lerp(zenith, Math.pow(Math.min(1, height * 1.35), 0.5));
    else scratch.copy(horizon).lerp(ground, Math.pow(Math.min(1, -height * 6), 0.6));
    colours[i * 3] = scratch.r; colours[i * 3 + 1] = scratch.g; colours[i * 3 + 2] = scratch.b;
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  studio.add(new THREE.Mesh(dome,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const cards = [
    { position: [-3.4, 4.6, 3.2], size: [2.2, 2.2], color: [7.6, 6.9, 5.7] },
    { position: [4.2, 1.5, -2.2], size: [3, 5], color: [0.22, 0.30, 0.55] },
    { position: [0.4, 2.0, -4.8], size: [6, 2.4], color: [0.92, 0.68, 0.46] },
  ];
  for (const card of cards) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(card.color[0]!, card.color[1]!, card.color[2]!),
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(card.size[0], card.size[1]), material);
    mesh.position.set(card.position[0]!, card.position[1]!, card.position[2]!);
    mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  }

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, 0.035, 0.1, 30, { size: 256 });
  generator.dispose();
  studio.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose(); (object.material as THREE.Material).dispose();
    }
  });
  return target;
}

/**
 * The population's surface. Obsidian, drape, carved stone, crest, alloy and wood all resolve from
 * one texture-free program; per-instance attributes carry each individual's material identity.
 * `individuality` keeps the close-range grain and fracture detail; crowd and company meshes can
 * drop it and still share the compiled program.
 */
export function createCosmicBodyMaterial(individuality = true,
  mode: HumanSurfaceMode = HUMAN_SURFACE_MODE.torso): THREE.MeshPhysicalMaterial {
  return createHumanSurfaceMaterial(mode, individuality);
}

export function updateCosmicBodyMaterial(material: THREE.MeshStandardMaterial, daylight: number): void {
  updateHumanSurfaceMaterial(material, daylight);
}

/**
 * Legacy per-instance seed channel. The surface shader no longer reads it — individuality now
 * arrives through the richer humanTone/humanTrim/humanFit/humanShape channels — but callers that
 * only need a stable scratch channel keep working, and the attribute costs nothing when unused.
 */
export function bindCosmicVariation(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('cosmicVariation', attribute);
  return attribute;
}

/** Core front/back panels and silhouette trims share ONE instanced draw call for every family.
 * Geometry part IDs allow per-instance accessory proportions; glyphs are analytic and antialiased.
 * No billboard, pick target, depth override or permanent floating label is added.
 *
 * Ambient settlement people no longer wear these: readable clothing, palette and headwear carry
 * role at documentary range. War companies still use them, where abstraction is the point. */
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
    inlay.deleteAttribute('humanSurface');
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
