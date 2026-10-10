/**
 * SurfaceDetail.ts
 *
 * Close-range material character for the architectural surfaces, without textures and
 * without extra draw calls.
 *
 * Every architectural surface is one shared MeshStandardMaterial (see MaterialPalette), so
 * detail cannot be painted per building. Instead each surface material gets a small procedural
 * fragment program injected through `onBeforeCompile`. It is evaluated in the canonical
 * building frame — the same object space the composer emits into — so the pattern is stable
 * under instancing, deterministic, and never swims with camera or world position.
 *
 * Three channels are modulated: albedo (course/joint/grain tone), roughness (mortar, oxidation,
 * weathering) and a derivative-based normal perturbation that gives mortar joints, tile courses
 * and panel seams real relief. Amplitudes are deliberately small: a settlement view should still
 * read as clean architecture, and the material should only announce itself up close.
 *
 * `aSurfaceDetail` (see GeometryBuilder) optionally carries per-vertex weathering, tone jitter
 * and grain axis. Geometry without the attribute falls back to the zero default, so ordinary
 * THREE geometry sharing these materials is unaffected.
 */

import * as THREE from 'three';
import type { SurfaceKey } from './MaterialPalette';

/** Surfaces that receive procedural character. Emissive and pure-ornament surfaces are left alone. */
const DETAILED_SURFACES: readonly SurfaceKey[] = [
  'hide',
  'thatch',
  'daub',
  'plaster',
  'stone',
  'brick',
  'panel',
  'timber',
  'metal',
  'cloth',
  'roof-thatch',
  'roof-tile',
  'roof-metal',
  'garden',
  'ground',
];

export function surfaceHasProceduralDetail(surface: SurfaceKey): boolean {
  return DETAILED_SURFACES.includes(surface);
}

export const SURFACE_COMMON_GLSL = /* glsl */ `
varying vec3 vGbLocal;
varying vec3 vGbNormalLocal;
varying vec3 vGbDetail;

float gbHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float gbValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(gbHash(i), gbHash(i + vec2(1.0, 0.0)), u.x),
    mix(gbHash(i + vec2(0.0, 1.0)), gbHash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

/** Two octaves only: enough to break uniformity, cheap enough for a whole settlement. */
float gbFbm(vec2 p) {
  return gbValue(p) * 0.66 + gbValue(p * 2.31 + 11.3) * 0.34;
}

/** 1 on the seam line of a unit-period course, 0 in the middle of a course. Continuous, so it is safe to differentiate. */
float gbSeam(float v, float width) {
  return smoothstep(1.0 - width, 1.0, abs(fract(v) - 0.5) * 2.0);
}

/** Screen-space height-to-normal, the same construction Three uses for bump maps. */
vec3 gbPerturbNormal(vec3 nrm, float height) {
  vec3 dPdx = dFdx(-vViewPosition);
  vec3 dPdy = dFdy(-vViewPosition);
  float dHdx = dFdx(height);
  float dHdy = dFdy(height);
  vec3 r1 = cross(dPdy, nrm);
  vec3 r2 = cross(nrm, dPdx);
  float det = dot(dPdx, r1);
  if (abs(det) < 1e-8) return nrm;
  vec3 gradient = sign(det) * (dHdx * r1 + dHdy * r2);
  return normalize(abs(det) * nrm - gradient);
}
`;

/** Face-local frame. `gbTan` follows the element grain axis where the surface uses one. */
export function surfaceFrameGlsl(useGrainAxis: boolean): string {
  const grain = useGrainAxis
    ? 'vec3 gbGrain = vGbDetail.z < 0.25 ? vec3(1.0, 0.0, 0.0) : (vGbDetail.z < 0.75 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));'
    : 'vec3 gbGrain = vec3(1.0, 0.0, 0.0);';
  return /* glsl */ `
  vec3 gbN = normalize(vGbNormalLocal);
  vec3 gbAbsN = abs(gbN);
  float gbUpFace = smoothstep(0.5, 0.9, gbAbsN.y);
  ${grain}
  vec3 gbProj = gbGrain - gbN * dot(gbGrain, gbN);
  float gbProjLen = length(gbProj);
  float gbEndGrain = 1.0 - smoothstep(0.22, 0.62, gbProjLen);
  vec3 gbTan = gbProjLen > 0.25
    ? gbProj / gbProjLen
    : normalize(cross(gbN, gbAbsN.y > 0.7 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0)));
  vec3 gbBit = cross(gbN, gbTan);
  vec2 gbUV = vec2(dot(vGbLocal, gbTan), dot(vGbLocal, gbBit));
  // Roof shells are lofted rings, so courses follow height and tiles follow arc length.
  float gbRadius = max(0.05, length(vGbLocal.xz));
  float gbArc = atan(vGbLocal.z, vGbLocal.x) * gbRadius;
`;
}

export interface ProceduralSurfaceProgram {
  /** Uses the per-vertex grain axis rather than a fixed horizontal course direction. */
  grain: boolean;
  /** Extra baked weathering on top of the per-vertex value. */
  wear: number;
  /** Relief strength in canonical building units. */
  relief: number;
  body: string;
}

/**
 * One canonical building unit is roughly six metres, so a brick course is ~0.012 and a
 * stone course ~0.055. The constants below are chosen from that scale rather than tuned by eye.
 */
function surfaceProgram(surface: SurfaceKey, rank: number): ProceduralSurfaceProgram | undefined {
  const refined = Math.min(1, rank / 5);
  switch (surface) {
    case 'brick':
      return {
        grain: false,
        wear: 0.08,
        relief: 0.0055,
        body: /* glsl */ `
  float gbRow = gbUV.y / 0.0135;
  float gbRowIndex = floor(gbRow);
  float gbCol = gbUV.x / 0.05 + mod(gbRowIndex, 2.0) * 0.5;
  float gbMortar = max(gbSeam(gbRow, 0.22), gbSeam(gbCol, 0.11));
  float gbBrick = gbHash(vec2(floor(gbCol), gbRowIndex)) - 0.5;
  gbTone = 1.0 + gbBrick * 0.17 - gbMortar * 0.2;
  gbRough = 1.0 + gbMortar * 0.14;
  gbHeight = -gbMortar;
`,
      };
    case 'stone':
      return {
        grain: false,
        wear: 0.1,
        relief: 0.012,
        body: /* glsl */ `
  float gbCourse = gbUV.y / 0.055;
  float gbCourseIndex = floor(gbCourse);
  float gbBlockLength = 0.085 + gbHash(vec2(gbCourseIndex, 3.0)) * 0.075;
  float gbBlock = (gbUV.x + gbHash(vec2(gbCourseIndex, 7.0)) * 0.4) / gbBlockLength;
  float gbJoint = max(gbSeam(gbCourse, 0.16), gbSeam(gbBlock, 0.1));
  float gbFace = gbHash(vec2(floor(gbBlock), gbCourseIndex) + 0.5) - 0.5;
  float gbPit = gbFbm(gbUV * 34.0) - 0.5;
  gbTone = 1.0 + gbFace * 0.13 + gbPit * 0.08 - gbJoint * 0.24;
  gbRough = 1.0 + gbJoint * 0.1 + gbPit * 0.08;
  gbHeight = -gbJoint + gbPit * 0.2;
`,
      };
    case 'ground':
      return {
        grain: false,
        wear: 0.14,
        relief: 0.01,
        body: /* glsl */ `
  vec2 gbSlab = vGbLocal.xz / 0.13;
  float gbJoint = max(gbSeam(gbSlab.x, 0.1), gbSeam(gbSlab.y, 0.1));
  float gbFace = gbHash(floor(gbSlab)) - 0.5;
  gbTone = 1.0 + gbFace * 0.1 - gbJoint * 0.18 + (gbFbm(vGbLocal.xz * 17.0) - 0.5) * 0.09;
  gbRough = 1.0 + gbJoint * 0.08;
  gbHeight = -gbJoint;
`,
      };
    case 'timber':
      return {
        grain: true,
        wear: 0.06,
        relief: 0.004,
        body: /* glsl */ `
  float gbPlank = gbUV.y / 0.048;
  float gbJoint = gbSeam(gbPlank, 0.13);
  float gbRing = gbFbm(vec2(gbUV.x * 7.0, floor(gbPlank) * 5.3 + gbUV.y * 74.0));
  float gbEnd = gbFbm(gbUV * 95.0);
  gbTone = 1.0 + (gbRing - 0.5) * 0.2 - gbJoint * 0.3;
  gbTone = mix(gbTone, 1.0 + (gbEnd - 0.5) * 0.24, gbEndGrain);
  gbRough = 1.0 + gbJoint * 0.1 + (gbRing - 0.5) * 0.1;
  gbHeight = -gbJoint + (gbRing - 0.5) * 0.35;
`,
      };
    case 'plaster':
    case 'daub':
      return {
        grain: false,
        wear: surface === 'daub' ? 0.2 : 0.1,
        relief: 0.006,
        body: /* glsl */ `
  float gbMottle = gbFbm(gbUV * 11.0) * 0.68 + gbFbm(gbUV * 37.0) * 0.32;
  float gbStreak = gbFbm(vec2(gbUV.x * 48.0, gbUV.y * 3.4));
  float gbDamp = smoothstep(0.2, 0.0, vGbLocal.y);
  float gbRain = (1.0 - gbUpFace) * gbStreak;
  gbTone = 1.0 + (gbMottle - 0.5) * 0.15 - gbRain * 0.07 - gbDamp * 0.11;
  gbRough = 1.0 + (gbMottle - 0.5) * 0.12 + gbDamp * 0.08;
  gbHeight = (gbMottle - 0.5) * 0.7;
`,
      };
    case 'hide':
      return {
        grain: false,
        wear: 0.12,
        relief: 0.006,
        body: /* glsl */ `
  float gbPanel = gbUV.x / 0.16;
  float gbStitch = gbSeam(gbPanel, 0.08) * (0.55 + 0.45 * step(0.5, fract(gbUV.y / 0.018)));
  float gbHideGrain = gbFbm(gbUV * 21.0);
  gbTone = 1.0 + (gbHideGrain - 0.5) * 0.16 - gbStitch * 0.2 + (gbHash(vec2(floor(gbPanel), 2.0)) - 0.5) * 0.08;
  gbRough = 1.0 + gbStitch * 0.08;
  gbHeight = -gbStitch * 0.6 + (gbHideGrain - 0.5) * 0.4;
`,
      };
    case 'thatch':
    case 'roof-thatch':
      return {
        grain: false,
        wear: 0.16,
        relief: 0.009,
        body: /* glsl */ `
  float gbCourse = (${surface === 'thatch' ? 'gbUV.y' : 'vGbLocal.y'}) / 0.055;
  float gbLip = gbSeam(gbCourse, 0.42);
  float gbStrand = gbFbm(vec2(${surface === 'thatch' ? 'gbUV.x' : 'gbArc'} * 130.0, floor(gbCourse) * 9.1));
  float gbClump = gbFbm(vec2(${surface === 'thatch' ? 'gbUV.x' : 'gbArc'} * 13.0, gbCourse * 0.8));
  gbTone = 1.0 + (gbStrand - 0.5) * 0.17 + (gbClump - 0.5) * 0.12 - gbLip * 0.16;
  gbRough = 1.0 + (gbStrand - 0.5) * 0.1;
  gbHeight = gbLip * 0.8 + (gbStrand - 0.5) * 0.5;
`,
      };
    case 'roof-tile':
      return {
        grain: false,
        wear: 0.12,
        relief: 0.008,
        body: /* glsl */ `
  float gbCourse = vGbLocal.y / 0.032;
  float gbCap = gbArc / 0.038;
  float gbCourseLip = gbSeam(gbCourse, 0.36);
  float gbCapRidge = 1.0 - gbSeam(gbCap, 0.55);
  float gbTile = gbHash(vec2(floor(gbCap), floor(gbCourse))) - 0.5;
  gbTone = 1.0 + gbTile * 0.12 - gbCourseLip * 0.16 + gbCapRidge * 0.07;
  gbRough = 1.0 + gbCourseLip * 0.1;
  gbHeight = gbCourseLip * 0.7 - gbCapRidge * 0.5;
`,
      };
    case 'metal':
      return {
        grain: true,
        wear: 0.06,
        relief: 0.005,
        body: /* glsl */ `
  // Corrugated sheet: ribs along the rolling direction, lapped and riveted across it.
  float gbRib = gbSeam(gbUV.y / 0.018, 0.62);
  float gbLap = gbSeam(gbUV.x / 0.16, 0.06);
  float gbRivet = gbLap * step(0.72, fract(gbUV.y / 0.05));
  float gbOxide = gbFbm(gbUV * 13.0);
  gbTone = 1.0 + (gbRib - 0.5) * 0.1 - gbLap * 0.2 - gbOxide * 0.11 * gbWear + gbRivet * 0.08;
  gbRough = 1.0 + gbLap * 0.12 + gbOxide * (0.3 + 0.6 * gbWear) * ${(0.6 - refined * 0.3).toFixed(3)};
  gbHeight = (gbRib - 0.5) * 0.9 - gbLap * 0.8 + gbRivet * 0.6;
`,
      };
    case 'panel':
      return {
        grain: true,
        wear: 0.04,
        relief: 0.004,
        body: /* glsl */ `
  // Large flush cladding panels with recessed gasket joints: machined, not beaten.
  vec2 gbPanel = gbUV / vec2(0.21, 0.15);
  float gbGasket = max(gbSeam(gbPanel.x, 0.05), gbSeam(gbPanel.y, 0.05));
  float gbSheet = gbHash(floor(gbPanel)) - 0.5;
  float gbFleck = gbFbm(gbUV * 44.0) - 0.5;
  gbTone = 1.0 + gbSheet * 0.045 + gbFleck * 0.04 - gbGasket * 0.26;
  gbRough = 1.0 + gbGasket * 0.2 + gbFleck * 0.06;
  gbHeight = -gbGasket;
`,
      };
    case 'roof-metal':
      return {
        grain: false,
        wear: 0.07,
        relief: 0.006,
        body: /* glsl */ `
  // Standing seam: raised ribs running down the slope, lapped at each course.
  float gbStanding = gbSeam(gbArc / 0.085, 0.12);
  float gbLap = gbSeam(vGbLocal.y / 0.16, 0.06);
  float gbOxide = gbFbm(vec2(gbArc * 9.0, vGbLocal.y * 9.0));
  gbTone = 1.0 + gbStanding * 0.07 - gbLap * 0.18 - gbOxide * 0.1 * gbWear;
  gbRough = 1.0 + gbLap * 0.12 + gbOxide * (0.25 + 0.5 * gbWear) * ${(0.6 - refined * 0.3).toFixed(3)};
  gbHeight = gbStanding * 0.9 - gbLap * 0.6;
`,
      };
    case 'cloth':
      return {
        grain: false,
        wear: 0.08,
        relief: 0.002,
        body: /* glsl */ `
  float gbWarp = gbSeam(gbUV.x / 0.006, 0.5);
  float gbWeft = gbSeam(gbUV.y / 0.006, 0.5);
  float gbFade = gbFbm(gbUV * 9.0);
  gbTone = 1.0 + (gbWarp - gbWeft) * 0.05 + (gbFade - 0.5) * 0.1;
  gbRough = 1.0 + (gbFade - 0.5) * 0.1;
  gbHeight = (gbWarp - gbWeft) * 0.3;
`,
      };
    case 'garden':
      return {
        grain: false,
        wear: 0.0,
        relief: 0.008,
        body: /* glsl */ `
  float gbLeaf = gbFbm(vGbLocal.xz * 90.0);
  float gbClump = gbFbm(vGbLocal.xz * 24.0 + 5.0);
  gbTone = 1.0 + (gbLeaf - 0.5) * 0.26 + (gbClump - 0.5) * 0.2 + gbUpFace * 0.06;
  gbRough = 1.0 + (gbLeaf - 0.5) * 0.12;
  gbHeight = (gbLeaf - 0.5) * 0.8 + (gbClump - 0.5) * 0.6;
`,
      };
    default:
      return undefined;
  }
}

/**
 * How baked occlusion is spent.
 *
 * Nearly all of it goes on indirect light, which is where it belongs: ambient occlusion describes
 * how much of the sky and the bounce a point can see, and in this scene the hemisphere term is
 * bright enough that unoccluded crevices are the whole reason detailed geometry reads flat. A much
 * smaller share dims albedo as well, so a recess stays legible on a face the sun is hitting
 * directly without the structure looking dirty.
 */
const OCCLUSION_AMBIENT = 0.75;
const OCCLUSION_ALBEDO = 0.18;
/** Saturation gained in a crevice: light that reaches it has bounced off the material's own colour. */
const OCCLUSION_SATURATION = 0.3;

/**
 * The two strengths above, as one uniform shared by every material in the world.
 *
 * Every surface program is injected with this same object, so moving it moves the whole built
 * environment at once, with no shader recompile and no material rebuild. That is what makes the
 * setting judgeable: occlusion strength is the kind of number that has to be looked at rather than
 * reasoned about, and the architecture browser exposes it as a slider for exactly that.
 */
const OCCLUSION_UNIFORM = { value: new THREE.Vector2(OCCLUSION_AMBIENT, OCCLUSION_ALBEDO) };

/**
 * How much of the baked occlusion to spend, globally.
 *
 * `ambient` is the share taken off indirect light, `albedo` the smaller share taken off the
 * surface colour itself. Passing nothing restores the defaults.
 */
export function setOcclusionStrength(ambient = OCCLUSION_AMBIENT, albedo = OCCLUSION_ALBEDO): void {
  OCCLUSION_UNIFORM.value.set(Math.max(0, Math.min(1, ambient)), Math.max(0, Math.min(1, albedo)));
}

/** The live occlusion strength, as (ambient, albedo). */
export function occlusionStrength(): THREE.Vector2 {
  return OCCLUSION_UNIFORM.value.clone();
}

/**
 * Read the baked occlusion channel and spend it.
 *
 * Split out from the pattern programs because occlusion is not a material property: it belongs to
 * every surface a structure is built from, including the ornament and trim surfaces that stay
 * deliberately pattern-free. Geometry that never measured occlusion carries zero in the channel —
 * and the attribute defaults to zero — so this is a no-op on anything but a composed structure.
 */
const OCCLUSION_ALBEDO_GLSL = /* glsl */ `
float gbOcclude = clamp(vGbOcclusion, 0.0, 1.0);
float gbAmbientAccess = 1.0 - gbOcclude * gbOcclusionStrength.x;
diffuseColor.rgb *= 1.0 - gbOcclude * gbOcclusionStrength.y;
float gbShadeLuma = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
diffuseColor.rgb = clamp(mix(vec3(gbShadeLuma), diffuseColor.rgb, 1.0 + gbOcclude * ${OCCLUSION_SATURATION.toFixed(3)}), 0.0, 1.0);
`;

const OCCLUSION_LIGHT_GLSL = /* glsl */ `
reflectedLight.indirectDiffuse *= gbAmbientAccess;
reflectedLight.indirectSpecular *= gbAmbientAccess;
`;

/** Declares the shared detail attribute and carries the occlusion channel to the fragment stage. */
export function injectOcclusionVertexStage(source: string): string {
  return source
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aSurfaceDetail;
varying float vGbOcclusion;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vGbOcclusion = aSurfaceDetail.w;`,
    );
}

/** Spends the occlusion channel, with no pattern program attached. */
export function injectOcclusionFragmentStage(source: string): string {
  return source
    .replace(
      '#include <common>',
      '#include <common>\nvarying float vGbOcclusion;\nuniform vec2 gbOcclusionStrength;',
    )
    .replace('#include <map_fragment>', `#include <map_fragment>\n${OCCLUSION_ALBEDO_GLSL}`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${OCCLUSION_LIGHT_GLSL}`);
}

export function injectSurfaceVertexStage(source: string): string {
  return injectOcclusionVertexStage(source)
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vGbLocal;
varying vec3 vGbNormalLocal;
varying vec3 vGbDetail;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vGbLocal = transformed;
vGbNormalLocal = objectNormal;
vGbDetail = aSurfaceDetail.xyz;`,
    );
}

export function injectSurfaceFragmentStage(program: ProceduralSurfaceProgram, source: string): string {
  const detail = /* glsl */ `
float gbTone = 1.0;
float gbRough = 1.0;
float gbHeight = 0.0;
float gbSoot = 0.0;
{
${surfaceFrameGlsl(program.grain)}
  float gbWear = clamp(vGbDetail.x + ${program.wear.toFixed(3)}, 0.0, 1.0);
${program.body}
  gbTone *= 1.0 + vGbDetail.y * 0.09 - gbWear * 0.26;
  gbRough = clamp(gbRough + gbWear * 0.24, 0.35, 1.35);
  gbHeight *= ${program.relief.toFixed(4)};
  gbSoot = gbWear * 0.42;
}
diffuseColor.rgb *= clamp(gbTone, 0.5, 1.35);
// Age dulls colour as well as value: sooted brick and salt-bleached plaster lose saturation.
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), gbSoot);
`;
  return injectOcclusionFragmentStage(source)
    .replace('#include <common>', `#include <common>\n${SURFACE_COMMON_GLSL}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${detail}`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * gbRough, 0.04, 1.0);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\nnormal = gbPerturbNormal(normal, gbHeight);`,
    );
}

/**
 * Install the procedural character for one surface material.
 * Returns false for surfaces that intentionally stay flat (motif inlay, glow, forge, contact shadow).
 */
export function applySurfaceDetail(
  material: THREE.MeshStandardMaterial,
  surface: SurfaceKey,
  eraRank: number,
): boolean {
  const program = surfaceProgram(surface, eraRank);
  if (!program) return false;
  installProceduralSurface(material, program, `godbox-surface:${surface}:${eraRank}`);
  material.userData['proceduralSurface'] = surface;
  return true;
}

/**
 * Install a procedural pattern onto a material.
 *
 * Shared by the legacy surface-key palette and the architectural material library, so there is
 * exactly one place that knows how a pattern is bound to a Three material.
 *
 * `cacheKey` is the program's identity on the GPU. Two materials passing the same key share one
 * compiled shader, which is what lets dozens of architectural materials cost only a handful of
 * programs: the key names the *pattern*, never the material.
 */
export function installProceduralSurface(
  material: THREE.MeshStandardMaterial,
  program: ProceduralSurfaceProgram,
  cacheKey: string,
): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectSurfaceVertexStage(shader.vertexShader);
    shader.fragmentShader = injectSurfaceFragmentStage(program, shader.fragmentShader);
    shader.uniforms['gbOcclusionStrength'] = OCCLUSION_UNIFORM;
  };
  // Two patterns can share identical onBeforeCompile source text, so the default cache key would
  // let them reuse one program. Key on the caller's identity instead.
  material.customProgramCacheKey = () => cacheKey;
  // Geometry without the optional detail attribute (plaza paving, portals, scaffolds) renders
  // as unweathered, straight-grained material rather than failing to bind.
  const defaults = material as unknown as { defaultAttributeValues?: Record<string, number[]> };
  defaults.defaultAttributeValues = { ...(defaults.defaultAttributeValues ?? {}), aSurfaceDetail: [0, 0, 0, 0] };
}

/**
 * Give a material the baked occlusion channel without a pattern program.
 *
 * For the surfaces that are meant to stay smooth — motif inlay, trim, a canvas awning, open water.
 * They are still parts of a building and still sit under its eaves and inside its reveals, so they
 * must take the structure's shading even though they take none of its texture. Every such material
 * compiles to the one shared program, because the injected source is identical.
 */
export function installSurfaceOcclusion(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectOcclusionVertexStage(shader.vertexShader);
    shader.fragmentShader = injectOcclusionFragmentStage(shader.fragmentShader);
    shader.uniforms['gbOcclusionStrength'] = OCCLUSION_UNIFORM;
  };
  material.customProgramCacheKey = () => 'godbox-occlusion';
  const defaults = material as unknown as { defaultAttributeValues?: Record<string, number[]> };
  defaults.defaultAttributeValues = { ...(defaults.defaultAttributeValues ?? {}), aSurfaceDetail: [0, 0, 0, 0] };
}

/** Test/QA hook: the exact shader pair the renderer would compile for a surface. */
export function compileSurfaceDetailPreview(surface: SurfaceKey, eraRank = 3): { vertexShader: string; fragmentShader: string } | undefined {
  const program = surfaceProgram(surface, eraRank);
  if (!program) return undefined;
  return {
    vertexShader: injectSurfaceVertexStage(THREE.ShaderLib.standard.vertexShader),
    fragmentShader: injectSurfaceFragmentStage(program, THREE.ShaderLib.standard.fragmentShader),
  };
}
