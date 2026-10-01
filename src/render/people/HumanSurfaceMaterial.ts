import * as THREE from 'three';

/**
 * HumanSurfaceMaterial.ts
 *
 * One opaque PBR shader for every surface a person is made of. It replaces the single near-black
 * body material that made the population read as silhouettes rather than people.
 *
 * The whole settlement still shares ONE compiled program and ONE texture-free material family.
 * Everything individual arrives through instanced attributes:
 *
 *   instanceColor      primary cloth colour for this part (garment, sleeve, trouser, hat)
 *   humanTone    vec4  skin rgb + weathering
 *   humanTrim    vec4  secondary material rgb (leather, boot, metal, hair) + distal coverage
 *   humanFit     vec4  proximal coverage, clothing swell, pattern+seed, distal-uses-trim
 *   humanShape   vec4  mode-dependent proportions (see HUMAN_SURFACE_MODE)
 *   humanParts   vec4  up to four visible wardrobe part ids
 *   humanGarment vec4  hem length, hem flare, outer length, spare
 *
 * and through per-vertex channels authored by HumanSculpt:
 *
 *   humanSurface vec4  material zone, clothing axis, baked occlusion, wardrobe part id
 *
 * Because coverage is an axis rather than geometry, sleeves, trousers, gloves and boots slide to
 * any length per person at zero geometric cost, and footwear or a rolled sleeve genuinely changes
 * both colour and silhouette.
 */

/** Which proportion channels `humanShape` carries, chosen per mesh. The program is shared. */
export const HUMAN_SURFACE_MODE = {
  /** humanShape = (shoulder, hip, belly, unused) */
  torso: 0,
  /** humanShape = (lengthScale, unused, unused, thickness) */
  limb: 1,
  /** humanShape = (headScale, ...) */
  head: 2,
  /** humanShape = (shoulder, hip, belly, unused); hem fitted by humanGarment */
  garment: 3,
  /** humanShape = (headScale, ...) */
  headgear: 4,
} as const;

export type HumanSurfaceMode = typeof HUMAN_SURFACE_MODE[keyof typeof HUMAN_SURFACE_MODE];

export interface HumanSurfaceAttributes {
  tone: THREE.InstancedBufferAttribute;
  trim: THREE.InstancedBufferAttribute;
  fit: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  parts: THREE.InstancedBufferAttribute;
  garment: THREE.InstancedBufferAttribute;
}

const DEFAULT_SKIN = new THREE.Color('#d8a97f');

/**
 * Binds the per-instance appearance channels to a mesh and seeds them with a safe neutral person,
 * so a renderer that only fills some channels never produces a black or inside-out body.
 */
export function bindHumanSurface(mesh: THREE.InstancedMesh): HumanSurfaceAttributes {
  const count = mesh.instanceMatrix.count;
  const make = (size: number, fill: readonly number[]) => {
    const array = new Float32Array(count * size);
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) array[i * size + c] = fill[c]!;
    const attribute = new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    return attribute;
  };
  const attributes: HumanSurfaceAttributes = {
    tone: make(4, [DEFAULT_SKIN.r, DEFAULT_SKIN.g, DEFAULT_SKIN.b, 0.4]),
    trim: make(4, [0.34, 0.24, 0.16, 0]),
    fit: make(4, [0, 0, 0, 0]),
    shape: make(4, [1, 1, 1, 1]),
    parts: make(4, [0, 0, 0, 0]),
    garment: make(4, [1, 1, 1, 0]),
  };
  mesh.geometry.setAttribute('humanTone', attributes.tone);
  mesh.geometry.setAttribute('humanTrim', attributes.trim);
  mesh.geometry.setAttribute('humanFit', attributes.fit);
  mesh.geometry.setAttribute('humanShape', attributes.shape);
  mesh.geometry.setAttribute('humanParts', attributes.parts);
  mesh.geometry.setAttribute('humanGarment', attributes.garment);
  return attributes;
}

export function markHumanSurfaceUpdated(attributes: HumanSurfaceAttributes): void {
  attributes.tone.needsUpdate = true;
  attributes.trim.needsUpdate = true;
  attributes.fit.needsUpdate = true;
  attributes.shape.needsUpdate = true;
  attributes.parts.needsUpdate = true;
  attributes.garment.needsUpdate = true;
}

const VERTEX_COMMON = /* glsl */`
  attribute vec4 humanSurface;
  attribute vec4 humanTone;
  attribute vec4 humanTrim;
  attribute vec4 humanFit;
  attribute vec4 humanShape;
  attribute vec4 humanParts;
  attribute vec4 humanGarment;
  uniform float humanMode;
  varying vec3 humanPoint;
  varying vec4 humanToneV;
  varying vec4 humanTrimV;
  varying vec3 humanSurfaceV;
  varying vec2 humanClothV;
`;

const VERTEX_BODY = /* glsl */`
  humanPoint = position;
  humanToneV = humanTone;
  humanTrimV = vec4(humanTrim.rgb, humanFit.w);
  humanSurfaceV = vec3(humanSurface.x, humanSurface.z, humanFit.z);

  // Clothing is an axis, not a mesh. A narrow band keeps hems and cuffs crisp instead of smeared.
  float axis = humanSurface.y;
  float proximal = (1.0 - smoothstep(humanFit.x - 0.035, humanFit.x + 0.005, axis))
    * step(0.004, humanFit.x);
  float distal = smoothstep(0.995 - humanTrim.w, 1.035 - humanTrim.w, axis)
    * step(0.004, humanTrim.w);
  humanClothV = vec2(proximal, distal);

  // Wardrobe parts share one geometry; a person collapses every component they are not wearing.
  float wardrobePart = humanSurface.w;
  float visible = 1.0;
  if (wardrobePart > 0.5) {
    visible = min(1.0,
      step(abs(wardrobePart - humanParts.x), 0.25) + step(abs(wardrobePart - humanParts.y), 0.25)
      + step(abs(wardrobePart - humanParts.z), 0.25) + step(abs(wardrobePart - humanParts.w), 0.25));
  }

  if (humanMode < 0.5 || (humanMode > 2.5 && humanMode < 3.5)) {
    // Torso and torso clothing share one taper, so a broad-shouldered person's coat is broad too.
    float along = clamp((transformed.y + 0.058) / 0.427, 0.0, 1.0);
    float shoulders = smoothstep(0.52, 0.86, along);
    float hips = 1.0 - smoothstep(0.0, 0.30, along);
    float middle = max(0.0, 1.0 - shoulders - hips);
    float lateral = humanShape.x * shoulders + humanShape.y * hips + humanShape.z * middle;
    if (humanMode > 2.5 && wardrobePart < 1.5) {
      // One hem part becomes a loincloth, a working tunic, breeches, a skirt or a floor-length robe.
      float hemY = transformed.y;
      if (hemY < 0.012) transformed.y = 0.012 + (hemY - 0.012) * humanGarment.x;
      float below = clamp((0.012 - hemY) / 0.112, 0.0, 1.0);
      transformed.xz *= mix(1.0, humanGarment.y, below);
    }
    transformed.x *= lateral;
    transformed.z *= mix(1.0, lateral, 0.62);
  } else if (humanMode < 1.5) {
    transformed.y *= humanShape.x;
    transformed.xz *= humanShape.w;
    // A boot cuff or a rolled sleeve has to change the outline, not only the colour.
    transformed.xz *= 1.0 + humanFit.y * max(proximal * 0.6, distal);
  } else {
    // Heads scale about the jaw: a child gains cranium without burying its chin in its chest.
    transformed = (transformed - vec3(0.0, -0.05, 0.0)) * humanShape.x + vec3(0.0, -0.05, 0.0);
  }
  transformed *= visible;
`;

const FRAGMENT_COMMON = /* glsl */`
  uniform float humanDaylight;
  varying vec3 humanPoint;
  varying vec4 humanToneV;
  varying vec4 humanTrimV;
  varying vec3 humanSurfaceV;
  varying vec2 humanClothV;

  float humanWeave(vec3 p, float fade) {
    return (sin(p.y * 470.0) * sin(p.x * 430.0 + p.z * 390.0)) * fade;
  }

  // Woven cultural motifs, deliberately low contrast: identity, not camouflage.
  float humanPattern(vec3 p, float id) {
    vec2 q = vec2(p.x + p.z * 0.4, p.y);
    float d;
    if (id < 0.5) d = abs(fract(q.y * 15.0 + abs(q.x) * 24.0) - 0.5);
    else if (id < 1.5) d = abs(abs(fract(q.y * 17.0 + q.x * 17.0) - 0.5)
      - abs(fract(q.y * 17.0 - q.x * 17.0) - 0.5));
    else if (id < 2.5) d = abs(fract(q.y * 11.0) - 0.5);
    else if (id < 3.5) d = min(abs(fract(q.x * 19.0) - 0.5), abs(fract(q.y * 19.0) - 0.5));
    else d = abs(fract(q.y * 12.0 + sin(q.x * 27.0) * 0.26) - 0.5);
    return 1.0 - smoothstep(0.035, 0.1, d);
  }
`;

/**
 * Every material returned here shares one compiled program; only the mode and the day/night
 * uniforms differ, so a whole population of distinct people still costs one shader.
 */
export function createHumanSurfaceMaterial(mode: HumanSurfaceMode = HUMAN_SURFACE_MODE.torso,
  detail = true): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.04,
    envMapIntensity: 0.6,
  });
  material.name = `godbox-human-surface-${mode}`;

  const daylight = { value: 1 };
  const modeUniform = { value: mode as number };
  material.userData['daylight'] = daylight;
  // Kept for callers that still dim the old interior glow; people no longer emit a nebula.
  material.userData['interior'] = { value: 1 };
  material.userData['mode'] = modeUniform;

  material.onBeforeCompile = shader => {
    shader.uniforms['humanDaylight'] = daylight;
    shader.uniforms['humanMode'] = modeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_COMMON}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON}`)
      .replace('#include <color_fragment>', /* glsl */`
        float humanZone = humanSurfaceV.x;
        float humanAo = humanSurfaceV.y;
        vec3 humanCloth = vec3(0.72, 0.68, 0.6);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          humanCloth = vColor.rgb;
        #endif
        vec3 humanTrimColour = humanTrimV.rgb;

        // Bare skin, then whatever the person is wearing over it, painted along the coverage axis.
        vec3 humanSkin = humanToneV.rgb * mix(1.02, 0.84, humanToneV.w);
        vec3 humanDistal = mix(humanCloth, humanTrimColour, humanTrimV.w);
        vec3 humanBase = mix(humanSkin, humanCloth, humanClothV.x);
        humanBase = mix(humanBase, humanDistal, humanClothV.y);
        float humanCovered = max(humanClothV.x, humanClothV.y);

        float humanRough = 0.6;
        float humanMetal = 0.0;
        if (humanZone < 0.5) {
          humanRough = mix(0.56, 0.88, humanCovered);
        } else if (humanZone < 1.5) {
          humanBase = humanCloth; humanRough = 0.9; humanCovered = 1.0;
        } else if (humanZone < 2.5) {
          humanBase = humanTrimColour; humanRough = 0.5; humanMetal = 0.05;
        } else if (humanZone < 3.5) {
          humanBase = humanTrimColour * 0.92; humanRough = 0.62; humanMetal = 0.08;
        } else if (humanZone < 4.5) {
          humanBase = humanTrimColour; humanRough = 0.33; humanMetal = 0.84;
        } else if (humanZone < 5.5) {
          humanBase = vec3(0.30, 0.21, 0.13); humanRough = 0.92;
        } else if (humanZone < 6.5) {
          humanBase = mix(humanCloth, vec3(1.0), 0.34); humanRough = 0.5; humanMetal = 0.26;
          humanCovered = 1.0;
        } else {
          humanRough = 0.5;
        }

        float humanFootprint = max(length(fwidth(humanPoint)), 1e-5);
        float humanDetail = 1.0 - smoothstep(0.0012, 0.009, humanFootprint);
        ${detail ? `
        if (humanCovered > 0.02) {
          // Woven cloth needs a surface, or every garment reads as painted plastic up close.
          humanBase *= 1.0 + humanWeave(humanPoint, humanDetail) * 0.055 * humanCovered;
          float motif = humanPattern(humanPoint, floor(humanSurfaceV.z));
          humanBase = mix(humanBase, humanBase * vec3(1.18, 1.1, 0.96),
            motif * humanCovered * 0.3 * humanDetail);
        }
        if (humanZone < 0.5 || humanZone > 6.5) {
          // Pores and sun-weathering: enough to stop large skin areas looking like vinyl.
          humanBase *= 1.0 + humanWeave(humanPoint * 1.7, humanDetail) * 0.025 * (1.0 - humanCovered);
        }` : ''}

        if (humanZone > 6.5) {
          // A readable stylised face: eye sockets, sclera, iris, brow and mouth from local position.
          vec3 f = humanPoint;
          float front = smoothstep(0.016, 0.034, f.z);
          float eyeDistance = length(vec2((abs(f.x) - 0.0215) / 0.0108, (f.y + 0.001) / 0.0064));
          float socket = 1.0 - smoothstep(0.75, 1.7, eyeDistance);
          float sclera = 1.0 - smoothstep(0.84, 1.0, eyeDistance);
          float iris = 1.0 - smoothstep(0.40, 0.50, eyeDistance);
          humanBase *= mix(1.0, 0.7, socket * front);
          humanBase = mix(humanBase, vec3(0.84, 0.82, 0.78), sclera * front * 0.92);
          humanBase = mix(humanBase, humanTrimColour * 0.3 + vec3(0.015), iris * front);
          float brow = (1.0 - smoothstep(0.0295, 0.038, abs(f.x)))
            * (1.0 - smoothstep(0.0032, 0.0078, abs(f.y - 0.0145)));
          humanBase = mix(humanBase, humanTrimColour * 0.5, brow * front * 0.88);
          float mouth = (1.0 - smoothstep(0.0125, 0.018, abs(f.x)))
            * (1.0 - smoothstep(0.0018, 0.0042, abs(f.y + 0.0455)));
          humanBase = mix(humanBase, humanBase * vec3(0.78, 0.5, 0.48), mouth * front * 0.9);
        }

        // Baked crevice occlusion. Without it a procedural body has no joints, only tubes.
        humanBase *= mix(0.74, 1.0, humanAo);
        diffuseColor.rgb = humanBase;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = humanRough;
      `)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = humanMetal;
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float humanNight = 1.0 - humanDaylight;
        // A restrained rim keeps people separated from terrain and buildings at documentary range.
        float humanFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
        float humanRim = pow(1.0 - humanFacing, 4.0);
        totalEmissiveRadiance += mix(vec3(0.5, 0.58, 0.76), humanBase, 0.4)
          * humanRim * mix(0.028, 0.085, humanNight);
        // People must stay readable after dark without becoming light sources.
        totalEmissiveRadiance += humanBase * humanNight * 0.03;
      `);
  };

  material.customProgramCacheKey = () => `godbox-human-surface-v1-${detail}`;
  return material;
}

export function updateHumanSurfaceMaterial(material: THREE.MeshStandardMaterial, daylight: number): void {
  const value = THREE.MathUtils.clamp(daylight, 0, 1);
  (material.userData['daylight'] as { value: number }).value = value;
  material.envMapIntensity = THREE.MathUtils.lerp(0.18, 0.62, value);
}

/** Packs the cultural textile pattern and a stable per-person seed into one float channel. */
export const TEXTILE_PATTERNS = ['chevron', 'diamond', 'terrace', 'crossweave', 'wave'] as const;

export function packPatternSeed(pattern: string | undefined, seed: number): number {
  const index = Math.max(0, TEXTILE_PATTERNS.indexOf(pattern as typeof TEXTILE_PATTERNS[number]));
  return index + THREE.MathUtils.clamp(seed, 0, 0.999);
}
