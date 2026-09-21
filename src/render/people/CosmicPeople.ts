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
  const material = new THREE.MeshStandardMaterial({ color: '#101320', roughness: 0.8, metalness: 0.12 });
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
      uniform float cosmicDaylight;`)
      .replace('#include <color_fragment>', `
        diffuseColor.rgb = vec3(0.006, 0.008, 0.016);
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 field = cosmicPoint * 37.0 + cosmicSeed.x * 173.0;
        vec3 cell = floor(field);
        float hash = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        vec3 point = fract(field) - vec3(0.5);
        float pixel = max(length(fwidth(field)), 0.001);
        float stars = step(0.964, hash) * (1.0 - smoothstep(0.08, 0.15 + pixel * 0.5, length(point.xy)));
        stars *= 1.0 - smoothstep(0.5, 1.8, pixel);
        float cloud = pow(0.5 + 0.5 * sin(cosmicPoint.y * 12.0 + cosmicSeed.x * 23.0 + sin(cosmicPoint.x * 19.0)), 3.0);
        vec3 nebula = mix(vec3(0.012, 0.009, 0.03), vec3(0.005, 0.02, 0.03), cosmicSeed.x);
        vec3 accent = vec3(0.4, 0.55, 0.8);
        #ifdef USE_INSTANCING_COLOR
          accent = vColor.rgb;
        #endif
        float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 4.0);
        totalEmissiveRadiance += nebula * cloud * cosmicSeed.y + vec3(0.004, 0.006, 0.012);
        totalEmissiveRadiance += mix(vec3(0.34, 0.43, 0.62), accent, 0.35) * rim * mix(0.25, 0.12, cosmicDaylight);
        totalEmissiveRadiance += vec3(0.53, 0.65, 0.86) * stars * cosmicSeed.z * mix(0.7, 0.5, cosmicDaylight);
      `);
  };
  material.customProgramCacheKey = () => `cosmic-obsidian-v1-${individuality}`;
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
    this.material.onBeforeCompile = shader => {
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
          float coverage = 1.0 - smoothstep(-fwidth(d), fwidth(d), d);
          if (coverage < 0.15) discard;
          diffuseColor.rgb *= coverage;
        } else diffuseColor.rgb *= 0.55;
      `);
    };
    this.material.customProgramCacheKey = () => 'cosmic-role-core-v1';
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
    // Small luminous surfaces remain legible at night without HDR values or extra bloom.
    this.material.color.setScalar(THREE.MathUtils.lerp(0.58, 0.88, THREE.MathUtils.clamp(daylight, 0, 1)));
  }

  endFrame(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.styles.needsUpdate = true;
  }
}
