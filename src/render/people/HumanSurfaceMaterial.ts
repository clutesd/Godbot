import * as THREE from 'three';

/**
 * HumanSurfaceMaterial.ts
 *
 * One opaque physically-based shader for every surface the species is made of.
 *
 * The inhabitants of Godbox are not humans. Their bodies are living obsidian: deep charcoal
 * volcanic glass, dielectric rather than metallic, read almost entirely through environment
 * reflection and directional highlight rather than through diffuse albedo. A minority of the
 * surface — eyes, sternum, clavicle channels, spine, limb seams, temple marks and a small
 * cultural glyph — is a luminous inlay cut into the glass. Everything else is reflection.
 *
 * The whole settlement still shares ONE compiled program and ONE texture-free material family.
 * Everything individual arrives through instanced attributes:
 *
 *   instanceColor       the person's luminous accent colour (culture and role derived)
 *   humanTone    vec4   obsidian body rgb + finish (0 raw volcanic .. 1 mirror polished)
 *   humanTrim    vec4   adornment alloy rgb + distal cuff/anklet width along the limb axis
 *   humanDrape   vec4   woven drape rgb + luminous gain
 *   humanFit     vec4   limb band position, band swell, pattern+seed, marking density
 *   humanShape   vec4   mode-dependent proportions (see HUMAN_SURFACE_MODE)
 *   humanParts   vec4   up to four visible adornment part ids
 *   humanGarment vec4   drape length, drape flare, outer length, spare
 *
 * and through per-vertex channels authored by HumanSculpt:
 *
 *   humanSurface vec4   material zone, limb axis, baked occlusion, adornment part id
 *
 * Because adornment is an axis rather than geometry, arm rings, forearm guards, anklets and
 * cuffs slide to any point on any limb per person at zero geometric cost, and a ring genuinely
 * changes both the silhouette and the material of the limb it sits on.
 */

/** Which proportion channels `humanShape` carries, chosen per mesh. The program is shared. */
export const HUMAN_SURFACE_MODE = {
  /** humanShape = (shoulder, hip, belly, unused); carries the body markings. */
  torso: 0,
  /** humanShape = (lengthScale, unused, unused, thickness); carries limb seams and rings. */
  limb: 1,
  /** humanShape = (headScale, ...); carries the face. */
  head: 2,
  /** humanShape = (shoulder, hip, belly, unused); drape fitted by humanGarment. */
  garment: 3,
  /** humanShape = (headScale, ...); crest, temple pieces and crowns. */
  headgear: 4,
} as const;

export type HumanSurfaceMode = typeof HUMAN_SURFACE_MODE[keyof typeof HUMAN_SURFACE_MODE];

export interface HumanSurfaceAttributes {
  tone: THREE.InstancedBufferAttribute;
  trim: THREE.InstancedBufferAttribute;
  drape: THREE.InstancedBufferAttribute;
  fit: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  parts: THREE.InstancedBufferAttribute;
  garment: THREE.InstancedBufferAttribute;
}

/** Volcanic glass, not absolute black. Dark enough to read as obsidian, open enough to hold light. */
const DEFAULT_OBSIDIAN = new THREE.Color('#1e1f25');
const DEFAULT_ALLOY = new THREE.Color('#c8973f');
const DEFAULT_DRAPE = new THREE.Color('#17161a');

/**
 * Binds the per-instance appearance channels to a mesh and seeds them with a safe neutral person,
 * so a renderer that only fills some channels never produces a featureless or inside-out body.
 */
export function bindHumanSurface(mesh: THREE.InstancedMesh): HumanSurfaceAttributes {
  const count = mesh.instanceMatrix.count;
  const make = (size: number, fill: readonly number[]) => {
    const array = new Float32Array(count * size);
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) array[i * size + c] = fill[c]!;
    return new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  };
  const attributes: HumanSurfaceAttributes = {
    tone: make(4, [DEFAULT_OBSIDIAN.r, DEFAULT_OBSIDIAN.g, DEFAULT_OBSIDIAN.b, 0.5]),
    trim: make(4, [DEFAULT_ALLOY.r, DEFAULT_ALLOY.g, DEFAULT_ALLOY.b, 0]),
    drape: make(4, [DEFAULT_DRAPE.r, DEFAULT_DRAPE.g, DEFAULT_DRAPE.b, 1]),
    fit: make(4, [0, 0, 0, 1]),
    shape: make(4, [1, 1, 1, 1]),
    parts: make(4, [0, 0, 0, 0]),
    garment: make(4, [1, 1, 1, 0]),
  };
  mesh.geometry.setAttribute('humanTone', attributes.tone);
  mesh.geometry.setAttribute('humanTrim', attributes.trim);
  mesh.geometry.setAttribute('humanDrape', attributes.drape);
  mesh.geometry.setAttribute('humanFit', attributes.fit);
  mesh.geometry.setAttribute('humanShape', attributes.shape);
  mesh.geometry.setAttribute('humanParts', attributes.parts);
  mesh.geometry.setAttribute('humanGarment', attributes.garment);
  const surfaceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const mode = surfaceMaterial?.userData['mode'] as { value: number } | undefined;
  if (mode?.value === HUMAN_SURFACE_MODE.head) {
    for (let slot = 0; slot < count; slot++) {
      attributes.parts.setW(slot, 1);
      attributes.garment.setZ(slot, 0);
    }
  }
  if (mode && !mesh.customDepthMaterial) mesh.customDepthMaterial = createHumanDepthMaterial(mode.value);
  return attributes;
}

export function markHumanSurfaceUpdated(attributes: HumanSurfaceAttributes): void {
  attributes.tone.needsUpdate = true;
  attributes.trim.needsUpdate = true;
  attributes.drape.needsUpdate = true;
  attributes.fit.needsUpdate = true;
  attributes.shape.needsUpdate = true;
  attributes.parts.needsUpdate = true;
  attributes.garment.needsUpdate = true;
}

const VERTEX_COMMON = /* glsl */`
  attribute vec4 humanSurface;
  attribute vec4 humanTone;
  attribute vec4 humanTrim;
  attribute vec4 humanDrape;
  attribute vec4 humanFit;
  attribute vec4 humanShape;
  attribute vec4 humanParts;
  attribute vec4 humanGarment;
  uniform float humanMode;
  varying vec3 humanPoint;
  varying vec4 humanToneV;
  varying vec4 humanTrimV;
  varying vec4 humanDrapeV;
  varying vec4 humanSurfaceV;
  varying vec3 humanBandV;
  varying vec3 humanIdentityV;
`;

const HEAD_DEFORM = /* glsl */`
  vec3 humanFootVector(vec3 p) {
    // Quaternion supplied by locomotion: exact cancellation of the shin orientation.
    vec4 q = humanGarment;
    return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p);
  }
  vec3 humanHeadPoint(vec3 p) {
    float jaw = 1.0 - smoothstep(-0.060, -0.023, p.y);
    float neck = 1.0 - smoothstep(-0.078, -0.062, p.y);
    float cheek = exp(-pow((p.y + 0.019) / 0.018, 2.0));
    p.x *= mix(1.0, humanShape.y, jaw) * mix(1.0, humanShape.w, cheek);
    p.x *= mix(1.0, humanParts.w, neck);
    p.x += sign(p.x) * humanParts.y * exp(-pow((p.y - 0.020) / 0.020, 2.0));
    float front = smoothstep(0.010, 0.036, p.z);
    p.z += front * (humanParts.x * exp(-pow((p.y - 0.012) / 0.009, 2.0))
      - humanParts.z * exp(-pow(p.y / 0.007, 2.0)) * smoothstep(0.008, 0.017, abs(p.x)));
    p.y += max(0.0, p.y - 0.022) * (humanShape.z - 1.0);
    return p;
  }
`;

const VERTEX_BODY = /* glsl */`
  humanPoint = position;
  humanIdentityV = humanMode < 0.5 ? humanParts.xyz : vec3(0.4, 0.0, humanGarment.z);
  humanToneV = humanTone;
  // The alloy colour plus the ring's position on the limb axis: the fragment stage needs that
  // position to turn one lit groove around the centre of the band, and cannot read an attribute.
  humanTrimV = vec4(humanTrim.rgb, humanFit.x);
  humanDrapeV = humanDrape;

  float humanAxis = humanSurface.y;
  humanSurfaceV = vec4(humanSurface.x, humanSurface.z, humanFit.z, humanAxis);

  // Adornment on a limb is a ring, not a sleeve: a narrow raised band anywhere on the limb axis,
  // plus a cuff or anklet that climbs from the distal tip. Both are material, not extra geometry.
  float humanRing = (1.0 - smoothstep(0.0, 0.040, abs(humanAxis - humanFit.x)))
    * step(0.004, humanFit.x);
  float humanCuff = smoothstep(1.002 - humanTrim.w, 1.028 - humanTrim.w, humanAxis)
    * step(0.004, humanTrim.w);
  humanBandV = vec3(humanRing, humanCuff, humanFit.w);

  // Adornment parts share one geometry; a person collapses every component they are not wearing.
  // Four ids ride humanParts and two more are packed into one spare float as low + high * 32,
  // which buys two extra components for a handful of instructions instead of a new attribute.
  float humanPartId = humanSurface.w;
  float humanVisible = 1.0;
  if (humanPartId > 0.5) {
    float humanExtraLow = mod(humanGarment.w, 32.0);
    float humanExtraHigh = floor(humanGarment.w / 32.0);
    humanVisible = min(1.0,
      step(abs(humanPartId - humanParts.x), 0.25) + step(abs(humanPartId - humanParts.y), 0.25)
      + step(abs(humanPartId - humanParts.z), 0.25) + step(abs(humanPartId - humanParts.w), 0.25)
      + step(abs(humanPartId - humanExtraLow), 0.25) + step(abs(humanPartId - humanExtraHigh), 0.25));
  }

  if (humanMode < 0.5 || (humanMode > 2.5 && humanMode < 3.5)) {
    // Torso and torso adornment share one taper, so a broad-shouldered person's collar is broad too.
    float along = clamp((transformed.y + 0.058) / 0.427, 0.0, 1.0);
    float shoulders = smoothstep(0.52, 0.86, along);
    float hips = 1.0 - smoothstep(0.0, 0.30, along);
    float middle = max(0.0, 1.0 - shoulders - hips);
    float lateral = humanShape.x * shoulders + humanShape.y * hips + humanShape.z * middle;
    if (humanMode > 2.5 && humanPartId < 1.5) {
      // One drape part becomes a hip wrap, a short panel or a floor-length ceremonial fall.
      float hemY = transformed.y;
      if (hemY < 0.012) transformed.y = 0.012 + (hemY - 0.012) * humanGarment.x;
      float below = clamp((0.012 - hemY) / 0.112, 0.0, 1.0);
      transformed.xz *= mix(1.0, humanGarment.y, below);
    }
    float ribs = smoothstep(0.09, 0.16, transformed.y) * (1.0 - smoothstep(0.23, 0.29, transformed.y));
    lateral *= mix(1.0, humanShape.w, ribs);
    if (humanMode > 2.5 && humanSurface.x > 0.5 && humanSurface.x < 1.5)
      transformed.z += humanFit.y * pow(clamp((0.05 - transformed.y) / 0.3, 0.0, 1.0), 2.0);
    transformed.x *= lateral;
    transformed.z *= mix(1.0, lateral, 0.62);
    float twist = humanFit.x * smoothstep(0.08, 0.25, transformed.y);
    transformed.xz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * transformed.xz;
  } else if (humanMode < 1.5) {
    transformed.y *= humanShape.x;
    transformed.xz *= humanShape.w;
    // Articulate after proportion scaling so a short leg still has a flat sole.
    if (humanParts.y > 1.5 && humanSurface.y > 0.985) {
      vec3 ankle = vec3(0.0, -0.225 * humanShape.x, 0.0);
      transformed = humanFootVector(transformed - ankle) + ankle;
    } else if (humanParts.y > 0.5 && humanParts.y < 1.5) {
      float fingers = smoothstep(0.87, 1.0, humanSurface.y);
      transformed.z += fingers * fingers * (0.005 + humanParts.z * 0.004);
    }
    // A ring or a forearm guard has to change the outline, not only the material.
    transformed.xz *= 1.0 + humanFit.y * max(humanRing, humanCuff * 0.8);
  } else {
    if (humanMode < 2.5) transformed = humanHeadPoint(transformed);
    else {
      transformed.y += max(0.0, transformed.y - 0.022) * (humanShape.z - 1.0);
      transformed.x *= humanShape.y;
    }
    // Heads scale about the jaw: a child gains cranium without burying its chin in its chest.
    transformed = (transformed - vec3(0.0, -0.05, 0.0)) * humanShape.x + vec3(0.0, -0.05, 0.0);
  }
  transformed *= humanVisible;
`;

const FRAGMENT_COMMON = /* glsl */`
  uniform float humanDaylight;
  uniform float humanMode;
  varying vec3 humanPoint;
  varying vec4 humanToneV;
  varying vec4 humanTrimV;
  varying vec4 humanDrapeV;
  varying vec4 humanSurfaceV;
  varying vec3 humanBandV;
  varying vec3 humanIdentityV;

  /**
   * One engraved channel. Returns the lit core and the bloom that reads as light trapped under
   * glass around it, which is what stops a seam looking like a painted-on neon line.
   */
  vec2 humanChannel(float d, float width) {
    float aa = max(fwidth(d), 1e-6) * 0.8;
    float a = abs(d);
    float core = 1.0 - smoothstep(width - aa, width + aa, a);
    float halo = 1.0 - smoothstep(width, width * 5.5 + aa, a);
    return vec2(core, max(0.0, halo - core));
  }

  /** Conchoidal grain. Volcanic glass is not optically uniform; this is what breaks the highlight. */
  float humanGrain(vec3 p) {
    return sin(p.y * 231.0 + sin(p.x * 173.0) * 2.1) * sin(p.x * 197.0 + p.z * 151.0);
  }

  /** Sparse fracture paths. Two fields that only draw where they nearly cancel, so lines stay rare. */
  float humanFracture(vec3 p, float seed) {
    float a = sin(p.y * 97.0 + p.x * 131.0 + seed * 19.0);
    float b = sin(p.y * 61.0 - p.z * 112.0 + seed * 7.0);
    return humanChannel(a * 0.62 + b * 0.38, 0.013).x;
  }

  /** Five cultural geometries in a normalised glyph space. Culture is shape, never only colour. */
  float humanGlyph(vec2 q, float id) {
    vec2 a = abs(q);
    if (id < 0.5) return abs(abs(a.x * 0.80 + q.y * 0.60) - 0.30) - 0.055;
    if (id < 1.5) return abs(a.x + a.y - 0.62) - 0.055;
    if (id < 2.5) return max(min(min(abs(q.y - 0.34), abs(q.y)), abs(q.y + 0.34)) - 0.045,
      a.x - 0.62 + abs(q.y) * 0.45);
    if (id < 3.5) return min(abs(a.x - 0.34), abs(a.y - 0.34)) - 0.05;
    return max(abs(q.y - sin(q.x * 7.5) * 0.17) - 0.05, a.x - 0.66);
  }
`;

/**
 * Every material returned here shares one compiled program; only the mode and the day/night
 * uniforms differ, so a whole population of distinct people still costs one shader.
 *
 * The response is deliberately physical rather than standard: obsidian only reads as a dense,
 * expensive mineral when a polished dielectric coat sits over a dark, slightly rough body. A
 * clearcoat lobe is the cheapest way to get that second highlight, and it is the one addition
 * made here — no transmission, no iridescence, no sheen, and still no per-person material.
 */
export function createHumanSurfaceMaterial(mode: HumanSurfaceMode = HUMAN_SURFACE_MODE.torso,
  detail = true): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.0,
  });
  material.name = `godbox-obsidian-surface-${mode}`;

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
      .replace('#include <common>', `#include <common>\n${VERTEX_COMMON}\n${HEAD_DEFORM}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        if (humanMode < 0.5 || (humanMode > 2.5 && humanMode < 3.5)) {
          float twist = humanFit.x * smoothstep(0.08, 0.25, position.y);
          objectNormal.xz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * objectNormal.xz;
        }
        if (humanMode > 1.5 && humanMode < 2.5) {
          vec3 tangent = normalize(cross(abs(objectNormal.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0), objectNormal));
          vec3 bitangent = cross(objectNormal, tangent);
          vec3 p = humanHeadPoint(position);
          objectNormal = normalize(cross(humanHeadPoint(position + tangent * 0.0001) - p,
            humanHeadPoint(position + bitangent * 0.0001) - p));
        }
        if (humanMode > 0.5 && humanMode < 1.5 && humanParts.y > 1.5 && humanSurface.y > 0.985) {
          objectNormal = humanFootVector(objectNormal);
        }
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON}`)
      .replace('#include <color_fragment>', /* glsl */`
        float humanZone = humanSurfaceV.x;
        float humanAo = humanSurfaceV.y;
        float humanAxis = humanSurfaceV.w;
        float humanPattern = floor(humanSurfaceV.z);
        float humanSeed = fract(humanSurfaceV.z);
        float humanFinish = humanToneV.w;
        float humanDensity = humanBandV.z;

        // The luminous accent is the one colour a person carries. Everything else is mineral.
        vec3 humanLight = vec3(1.0, 0.70, 0.30);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          humanLight = vColor.rgb;
        #endif

        vec3 humanObsidian = humanToneV.rgb;
        vec3 humanBase = humanObsidian;
        // Obsidian, not black chrome. The body lobe stays tight enough to give a mineral its
        // small bright highlight, while the coat above it is deliberately *broader* than a mirror:
        // a near-zero coat roughness turns every light source into a hard streak, which is exactly
        // what reads as chrome. A broad coat spreads the same energy into a reflection that
        // describes curvature instead of smearing across it.
        float humanRough = mix(0.32, 0.135, humanFinish);
        float humanMetal = 0.0;
        float humanCoat = mix(0.46, 0.82, humanFinish);
        float humanCoatRough = mix(0.26, 0.095, humanFinish);
        float humanIsGlass = 1.0;

        if (humanZone < 0.5) {
          // The body itself. Everything above is already the obsidian response, so this branch
          // exists only so that no later zone can ever claim it: a body painted with an ornament
          // material is the difference between a species of living glass and a gold mannequin.
          humanBase = humanObsidian;
        } else if (humanZone < 1.5) {
          // Woven drape: dense, matte, and deliberately the least reflective thing on the body.
          humanBase = humanDrapeV.rgb; humanRough = 0.86; humanCoat = 0.06; humanCoatRough = 0.6;
          humanIsGlass = 0.0;
        } else if (humanZone < 2.5) {
          // Carved mineral: the raw end of the ornament vocabulary, before the species casts alloy.
          humanBase = mix(humanTrimV.rgb, humanObsidian, 0.62) * 0.95;
          humanRough = mix(0.82, 0.58, humanFinish); humanCoat = 0.1; humanCoatRough = 0.5;
          humanIsGlass = 0.0;
        } else if (humanZone < 3.5) {
          // The crest: the same glass as the body, worked into finer ridges. It stays a shade
          // darker than the body, because a crest that is lighter than the face reads as hair.
          humanBase = humanObsidian * 0.92;
          humanRough = mix(0.46, 0.22, humanFinish);
          humanCoat = mix(0.35, 0.92, humanFinish); humanCoatRough = mix(0.34, 0.12, humanFinish);
        } else if (humanZone < 4.5) {
          // Cast and polished alloy. The only genuinely metallic surface the species wears.
          humanBase = humanTrimV.rgb; humanRough = mix(0.38, 0.11, humanFinish);
          humanMetal = 1.0; humanCoat = 0.0; humanIsGlass = 0.0;
        } else if (humanZone < 5.5) {
          humanBase = vec3(0.24, 0.17, 0.10); humanRough = 0.9; humanCoat = 0.0; humanIsGlass = 0.0;
        } else {
          // Inlay geometry: glass cut away so the channel beneath shows through.
          humanBase = humanObsidian * 0.45; humanRough = 0.16; humanCoat = 1.0; humanCoatRough = 0.05;
        }

        float humanFootprint = max(length(fwidth(humanPoint)), 1e-5);
        float humanDetail = 1.0 - smoothstep(0.0015, 0.011, humanFootprint);

        if (humanIsGlass > 0.5) {
          // Mineral clouding. Real volcanic glass is not optically uniform at any scale: it holds
          // slow drifts of density that survive polishing. Three low-frequency fields, phased by
          // the person's own seed, give every individual a slightly different body without a
          // texture, a material or a draw call of their own — and this is also what stops a
          // hundred people sharing one highlight pattern and reading as one moulded product.
          float humanCloud = sin(humanPoint.y * 7.3 + humanSeed * 31.0)
            * sin(humanPoint.x * 9.1 - humanPoint.z * 6.2 + humanSeed * 17.0)
            + 0.6 * sin(humanPoint.y * 15.7 - humanPoint.x * 11.3 + humanSeed * 53.0);
          humanRough += humanCloud * 0.030;
          humanCoatRough += humanCloud * 0.022;
          humanBase *= 1.0 + humanCloud * 0.055;
        }
        ${detail ? `
        if (humanIsGlass > 0.5) {
          // Grain plus slow flow banding. Without both, a dark body is either a mirror or a void.
          float humanG = humanGrain(humanPoint * (0.9 + humanSeed * 0.25));
          humanRough += humanG * mix(0.050, 0.018, humanFinish) * humanDetail;
          humanBase *= 1.0 + humanG * 0.045 * humanDetail;
          float humanBanding = sin(humanPoint.y * 44.0 + humanPoint.x * 23.0 + humanSeed * 6.3);
          humanRough += humanBanding * mix(0.030, 0.010, humanFinish);
          humanBase *= 1.0 + humanBanding * 0.026;
        }` : ''}

        // ------------------------------------------------------------------------------------
        // Luminous inlay. Core is the lit channel, halo is the bloom through the surrounding
        // glass, carve is a recess that is engraved but unlit. Together they must stay a small
        // minority of the body, or the species stops reading as mineral and starts reading as neon.
        // ------------------------------------------------------------------------------------
        float humanCore = 0.0;
        float humanHalo = 0.0;
        float humanCarve = 0.0;
        vec3 humanP = humanPoint;
        float humanAsymmetry = (1.0 - humanIdentityV.x) * 0.7 + 0.15;
        float humanSide = step(0.0, humanP.x);
        float humanHanded = step(0.5, humanSeed);
        float humanPreferred = 1.0 - abs(humanSide - humanHanded);

        if (humanMode < 0.5) {
          float humanFront = smoothstep(0.004, 0.022, humanP.z);
          float humanBack = 1.0 - smoothstep(-0.026, -0.006, humanP.z);
          // Sternum. Not a strip of light: a channel that opens at the throat hollow, carries
          // its full width across the chest and closes again into the abdomen. A constant-width
          // line over that distance is the single thing that makes inlay read as an LED.
          float humanAlong = clamp((humanP.y - 0.070) / 0.206, 0.0, 1.0);
          float humanSternumWidth = 0.00085
            + 0.00125 * smoothstep(0.0, 0.5, humanAlong) * (1.0 - smoothstep(0.78, 1.0, humanAlong));
          vec2 humanSternum = humanChannel(humanP.x - (humanSeed - 0.5) * 0.012 * sin(humanAlong * 3.14), humanSternumWidth) * humanFront
            * smoothstep(0.068, 0.094, humanP.y) * (1.0 - smoothstep(0.242, 0.272, humanP.y));
          // Clavicle channels: two arcs exactly where the collarbone is, which is what makes the
          // shoulder-to-neck transition read as structure rather than as a slope. They thin to
          // nothing at the shoulder, so neither end terminates in a blunt cut.
          float humanClavY = 0.270 + (humanPreferred - 0.5) * humanAsymmetry * 0.020 - abs(humanP.x) * 0.26 - humanP.x * humanP.x * 2.1;
          float humanClavWidth = 0.0018 * (1.0 - smoothstep(0.020, 0.072, abs(humanP.x)));
          vec2 humanClav = humanChannel(humanP.y - humanClavY, humanClavWidth) * humanFront
            * (1.0 - smoothstep(0.056, 0.078, abs(humanP.x)))
            * smoothstep(0.009, 0.021, abs(humanP.x));
          // A short pair of branches off the sternum. Light in a mineral finds a path; it does not
          // run in a single straight pipe.
          float humanBranchY = 0.142 + humanPreferred * 0.039 + humanPattern * 0.003 - abs(humanP.x) * (0.8 + humanSeed * 0.7);
          vec2 humanBranch = humanChannel(humanP.y - humanBranchY, 0.0010) * humanFront
            * (1.0 - smoothstep(0.013, 0.027, abs(humanP.x)))
            * smoothstep(0.0015, 0.007, abs(humanP.x)) * mix(1.0 - humanAsymmetry, 1.0, humanPreferred);
          // Spine: the same channel answered on the back, so the body is finished from behind.
          vec2 humanSpine = humanChannel(humanP.x, 0.0013) * humanBack
            * smoothstep(0.0, 0.04, humanP.y) * (1.0 - smoothstep(0.262, 0.298, humanP.y));
          // One small cultural glyph over the solar plexus. Geometry, not a badge.
          vec2 humanQ = vec2(humanP.x - (humanSeed - 0.5) * 0.038, humanP.y - 0.186) / 0.019;
          vec2 humanMark = humanChannel(humanGlyph(humanQ, humanPattern) * 0.019, 0.0013)
            * humanFront * (1.0 - smoothstep(0.9, 1.35, length(humanQ)));
          // Nodes. Light pools where channels meet, and those pools are what make a pattern look
          // grown into the body rather than printed onto it.
          float humanNodes = (1.0 - smoothstep(0.0022, 0.0040,
              length(vec2(humanP.x, (humanP.y - 0.2495) * 0.85))))
            + (1.0 - smoothstep(0.0019, 0.0036,
              length(vec2(humanP.x, (humanP.y - 0.1520) * 0.85))))
            + (1.0 - smoothstep(0.0017, 0.0032,
              length(vec2(humanP.x, (humanP.y - 0.0760) * 0.85))));
          humanCore += humanSternum.x + humanClav.x + humanSpine.x + humanMark.x
            + humanBranch.x + humanNodes * humanFront * step(0.48, humanIdentityV.y);
          humanHalo += humanSternum.y + humanClav.y + humanSpine.y + humanMark.y + humanBranch.y
            + humanNodes * humanFront * step(0.48, humanIdentityV.y) * 1.4;
          ${detail ? `
          // Fracture paths over the flanks only: the body is glass, and glass remembers stress.
          float humanFlank = smoothstep(0.050, 0.088, abs(humanP.x)) * humanDetail;
          float humanCrack = humanFracture(humanP, humanSeed) * humanFlank * 0.34;
          humanCore += humanCrack * 0.3;
          humanHalo += humanCrack;
          humanCarve += humanFracture(humanP * 1.7, humanSeed + 3.0) * humanFlank * 0.3;` : ''}
        } else if (humanMode < 1.5) {
          // Limb seam: a single channel along the front of the forearm or shin, tapering to
          // nothing at both ends so the limb never reads as a striped tube with cut-off stripes.
          float humanSpan = smoothstep(0.08, 0.22, humanAxis) * (1.0 - smoothstep(0.56, 0.74, humanAxis));
          vec2 humanSeam = humanChannel(humanP.x - (humanSeed - 0.5) * 0.018 * sin(humanAxis * 5.0), 0.0011 * humanSpan + 0.0003)
            * smoothstep(0.0, 0.012, humanP.z) * humanSpan;
          humanCore += humanSeam.x; humanHalo += humanSeam.y;
          // Finger definition. The hand is one sculpted mass, so the digits are cut into it: a
          // knuckle break across the back and three separations down the finger plane. At
          // documentary range this reads as a hand far better than four thin procedural fingers.
          float humanFingers = smoothstep(0.868, 0.890, humanAxis);
          float humanDigit = humanChannel(sin(humanP.z / 0.0098 * 3.14159265), 0.30).x
            * humanFingers * smoothstep(0.002, 0.008, abs(humanP.z));
          float humanKnuckle = humanChannel(humanAxis - 0.872, 0.006).x
            * smoothstep(0.0, 0.005, abs(humanP.x));
          humanCarve += humanDigit * 1.0 + humanKnuckle * 0.6;
          humanRough += (humanDigit * 0.26 + humanKnuckle * 0.16);
          // Hands and feet meet the world and never hold the finish the torso does. Without this
          // the near-horizontal top of a foot mirrors the open sky and the species gets white shoes.
          float humanWorn = smoothstep(0.78, 1.0, humanAxis);
          humanRough += humanWorn * 0.34;
          humanCoat *= 1.0 - humanWorn * 0.70;
          humanBase *= 1.0 - humanWorn * 0.12;
          // The ring itself is alloy, with one lit groove turned around its centre.
          float humanBand = max(humanBandV.x, humanBandV.y);
          humanBase = mix(humanBase, humanTrimV.rgb, humanBand);
          humanMetal = mix(humanMetal, 1.0, humanBand);
          humanRough = mix(humanRough, mix(0.40, 0.12, humanFinish), humanBand);
          humanCoat = mix(humanCoat, 0.0, humanBand);
          vec2 humanGroove = humanChannel(humanAxis - humanTrimV.w, 0.004) * step(0.35, humanBandV.x);
          humanCore += humanGroove.x * 0.7; humanHalo += humanGroove.y * 0.7;
        } else if (humanMode < 2.5) {
          // --------------------------------------------------------------------------------
          // The face. No sclera, no iris, no attempt at photoreal human rendering: a strong brow
          // and cheek plane, a restrained nose, a mouth groove, two recessed luminous eyes.
          // --------------------------------------------------------------------------------
          float humanFace = smoothstep(0.008, 0.026, humanP.z);
          float humanEye = length(vec2((abs(humanP.x) - 0.0198) / 0.0125, (humanP.y - 0.0004) / 0.0051));
          float humanSocket = 1.0 - smoothstep(0.80, 2.05, humanEye);
          float humanLens = 1.0 - smoothstep(0.70, 1.0, humanEye);
          // The socket is cut back into the skull before anything lights up inside it.
          humanBase *= mix(1.0, 0.34, humanSocket * humanFace);
          humanRough = mix(humanRough, humanRough + 0.14, humanSocket * humanFace * 0.6);
          humanCore += humanLens * humanFace * (1.0 + humanIdentityV.z * 0.12);
          // Observed faces gain a cut lid and small internal lens, never a different material.
          humanCarve += humanChannel(humanEye - 1.22, 0.12).x * humanFace * humanIdentityV.z * humanDetail;
          humanHalo += (1.0 - smoothstep(0.95, 1.9, humanEye)) * humanFace * 0.8;
          // Brow shelf and cheek plane: shadow, not colour, is what gives the head its structure.
          float humanBrow = (1.0 - smoothstep(0.024, 0.044, abs(humanP.x)))
            * (1.0 - smoothstep(0.0025, 0.0115, abs(humanP.y - 0.0096)));
          humanBase *= mix(1.0, 0.70, humanBrow * humanFace);
          humanRough = mix(humanRough, humanRough + 0.20, humanBrow * humanFace);
          float humanCheek = (1.0 - smoothstep(0.010, 0.028, abs(abs(humanP.x) - 0.0310)))
            * (1.0 - smoothstep(0.008, 0.026, abs(humanP.y + 0.0160)));
          humanRough = mix(humanRough, humanRough * 0.62, humanCheek * humanFace);
          // The hollow under the cheekbone: without it the lower face is one unbroken plane.
          float humanHollow = (1.0 - smoothstep(0.010, 0.030, abs(abs(humanP.x) - 0.0250)))
            * (1.0 - smoothstep(0.008, 0.024, abs(humanP.y + 0.0330)));
          humanBase *= mix(1.0, 0.76, humanHollow * humanFace);
          float humanMouth = (1.0 - smoothstep(0.0115, 0.0175, abs(humanP.x)))
            * (1.0 - smoothstep(0.0016, 0.0040, abs(humanP.y + 0.0452)));
          humanBase *= mix(1.0, 0.52, humanMouth * humanFace);
          // Temple marks sit on the side planes, where they read in profile and three-quarter.
          float humanTemple = smoothstep(0.030, 0.040, abs(humanP.x));
          vec2 humanMarks = humanChannel(abs(humanP.y - 0.004 - abs(humanP.z) * 0.10) - 0.0125, 0.0015)
            * humanTemple * (1.0 - smoothstep(0.026, 0.040, abs(humanP.y - 0.004)))
            * (1.0 - smoothstep(0.016, 0.034, abs(humanP.z)));
          humanCore += humanMarks.x * mix(0.28, 1.0, humanPreferred); humanHalo += humanMarks.y * mix(0.28, 1.0, humanPreferred);
          // One crown seam running from the brow back over the skull.
          vec2 humanCrown = humanChannel(humanP.x - (humanSeed - 0.5) * 0.018, 0.0017) * smoothstep(0.030, 0.044, humanP.y)
            * (1.0 - smoothstep(0.052, 0.070, humanP.y));
          humanCore += humanCrown.x * 0.8; humanHalo += humanCrown.y * 0.8;
        } else if (humanMode < 3.5) {
          // Adornment engraving. Drape panels carry a centre channel and a repeating cultural row;
          // alloy pieces carry precise parallel channels whose spacing is the civilisation's hand.
          if (humanZone > 0.5 && humanZone < 1.5) {
            float humanPanel = smoothstep(0.018, 0.040, humanP.z);
            vec2 humanCentre = humanChannel(humanP.x, 0.0024) * humanPanel;
            // Fine repeated engraving. Large motifs on a narrow panel read as a chain of beads
            // rather than as worked cloth, so the glyph is kept small and the rows kept close.
            float humanRow = (humanP.y - 0.02) / mix(0.034, 0.021, humanFinish);
            vec2 humanQ = vec2(humanP.x / 0.016, sin(humanRow * 6.2831853) * 0.80);
            vec2 humanMotif = humanChannel(humanGlyph(humanQ, humanPattern) * 0.016, 0.0013)
              * humanPanel * (1.0 - smoothstep(0.013, 0.021, abs(humanP.x)))
              * (1.0 - smoothstep(0.02, 0.04, humanP.y));
            humanCore += humanCentre.x + humanMotif.x * 0.4;
            humanHalo += humanCentre.y + humanMotif.y * 0.4;
          } else {
            // Turned channels in cast alloy. They are a texture on the metal, not a row of
            // rungs: close pitch, narrow cut, and almost no light of their own.
            float humanPitch = mix(0.0085, 0.0042, humanFinish);
            vec2 humanRibs = humanChannel(sin(humanP.y / humanPitch * 6.2831853), 0.07)
              * smoothstep(0.004, 0.018, abs(humanP.z) + abs(humanP.x) * 0.3);
            humanCore += humanRibs.x * 0.05;
            humanHalo += humanRibs.y * 0.10;
            humanCarve += humanRibs.x * 0.26;
          }
        } else {
          // Crest and crown: ridges that run front to back over the skull. On a dark polished
          // surface only a roughness break reads at all, so the ridges are cut into the highlight
          // rather than into the albedo, and the crest becomes worked glass instead of a helmet.
          float humanRidge = sin(atan(humanP.x, humanP.z) * 7.0)
            * (0.55 + 0.45 * smoothstep(-0.02, 0.03, humanP.y))
            * (1.0 - smoothstep(0.058, 0.080, humanP.y));
          humanBase *= 1.0 + humanRidge * 0.26;
          humanRough += humanRidge * 0.32;
          humanCoatRough += humanRidge * 0.18;
          // A second, finer pass across the ridges breaks them into worked facets rather than a
          // corrugation, so the crest never reads as a moulded shell.
          float humanFacet = sin(humanP.y * 150.0 + atan(humanP.x, humanP.z) * 4.0)
            * (1.0 - smoothstep(0.060, 0.080, humanP.y));
          humanRough += humanFacet * 0.07;
          humanBase *= 1.0 + humanFacet * 0.04;
          vec2 humanCentre = humanChannel(humanP.x, 0.0017) * smoothstep(0.0, 0.03, humanP.y)
            * (1.0 - smoothstep(0.055, 0.075, humanP.y));
          humanCore += humanCentre.x * 0.55; humanHalo += humanCentre.y * 0.55;
        }

        humanCore = clamp(humanCore * humanDensity, 0.0, 1.0);
        humanHalo = clamp(humanHalo * humanDensity, 0.0, 1.0);
        humanCarve = clamp(humanCarve, 0.0, 1.0);

        // A channel is cut into the glass: the surround darkens, and the light sits down inside it.
        humanBase = mix(humanBase, humanBase * 0.38, humanCarve * 0.85);
        humanBase = mix(humanBase, humanBase * 0.22, humanCore);
        humanRough = mix(humanRough, 0.10, humanCore * 0.7);
        humanRough = clamp(humanRough, 0.035, 1.0);

        // Baked crevice occlusion. Without it a procedural body has no joints, only tubes.
        humanBase *= mix(0.68, 1.0, humanAo);
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
        // Hot enough to survive daylight and tone mapping, restrained enough to stay an inlay.
        float humanEnergy = humanDrapeV.w * mix(1.7, 3.6, humanNight);
        totalEmissiveRadiance += humanLight * (humanCore * humanEnergy + humanHalo * humanEnergy * 0.16);
        // A warm rim keeps a dark species separated from terrain and buildings at documentary range.
        float humanFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
        float humanRim = pow(1.0 - humanFacing, 4.0);
        totalEmissiveRadiance += mix(humanLight, vec3(0.62, 0.68, 0.84), 0.42)
          * humanRim * mix(0.045, 0.115, humanNight);
        // Obsidian must never collapse to a flat silhouette after dark.
        totalEmissiveRadiance += humanBase * humanNight * 0.055;
      `)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          // Polished volcanic glass, not chrome: a dielectric coat whose strength and tightness
          // are the difference between a raw primitive body and a ceremonial mirror finish.
          material.clearcoat = clamp(humanCoat, 0.0, 1.0);
          material.clearcoatRoughness = clamp(humanCoatRough, 0.0525, 1.0);
        #endif
      `);
  };

  material.customProgramCacheKey = () => `godbox-obsidian-presence-v3-${detail}`;
  return material;
}

/** Shadow silhouettes must use the same selection, head planes and ankle pose as the colour pass. */
function createHumanDepthMaterial(mode: number): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = shader => {
    shader.uniforms['humanMode'] = { value: mode };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_COMMON}\n${HEAD_DEFORM}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
  };
  material.customProgramCacheKey = () => 'godbox-presence-depth-v3';
  return material;
}

export function updateHumanSurfaceMaterial(material: THREE.MeshStandardMaterial, daylight: number): void {
  const value = THREE.MathUtils.clamp(daylight, 0, 1);
  (material.userData['daylight'] as { value: number }).value = value;
  // Obsidian is read through its environment. The reflection never drops to nothing, or the
  // species loses its anatomy after dark and becomes a cut-out.
  material.envMapIntensity = THREE.MathUtils.lerp(0.5, 1.1, value);
}

/** Packs the cultural marking geometry and a stable per-person seed into one float channel. */
export const TEXTILE_PATTERNS = ['chevron', 'diamond', 'terrace', 'crossweave', 'wave'] as const;

export function packPatternSeed(pattern: string | undefined, seed: number): number {
  const index = Math.max(0, TEXTILE_PATTERNS.indexOf(pattern as typeof TEXTILE_PATTERNS[number]));
  return index + THREE.MathUtils.clamp(seed, 0, 0.999);
}
