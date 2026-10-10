/**
 * Offline GLSL compile/link check for the built environment's surface materials.
 *
 * Companion to compile-ecology-shaders.ts, and the same bargain: Three's real `WebGLProgram`
 * assembles each material's shader exactly as the renderer would — every `#include` resolved,
 * every define applied — so the structural faults that a substring test cannot see are caught
 * here. Set `GLSLANG_VALIDATOR` to a Khronos `glslangValidator` executable to link them as well;
 * without it the script exports the generated sources and asserts their structure, and does not
 * claim compilation.
 *
 * What it is guarding: every architectural material carries two injected stages — a procedural
 * pattern and the baked occlusion that spends `aSurfaceDetail.w` — and the two inject into the
 * same chunks. A duplicated varying, a declaration that lands after its use, or a chunk that
 * stopped existing in a Three upgrade would break the whole settlement rather than one material.
 *
 * Run: npx tsx tests/compile-architecture-shaders.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { MaterialPalette, SURFACE_KEYS } from '../src/render/materials/MaterialPalette';
import { ARCHITECTURAL_MATERIALS } from '../src/render/architecture/MaterialLibrary';
import type { CultureStyle } from '../src/sim/types';

const { WebGLProgram } = await import('three/src/renderers/webgl/' + 'WebGLProgram.js');
const directory = resolve('node_modules/.tmp/architecture-shaders');
mkdirSync(directory, { recursive: true });

const CULTURE: CultureStyle = {
  primary: '#c36557', secondary: '#313550', accent: '#d9a748',
  symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['go', 'do'],
};

/** Every material a settlement can draw on, named for the file it is written to. */
const subjects: { name: string; material: THREE.MeshStandardMaterial }[] = [];
for (const era of ['primitive', 'village', 'advanced'] as const) {
  const palette = new MaterialPalette({ culture: CULTURE, era });
  for (const surface of SURFACE_KEYS) subjects.push({ name: `${era}-surface-${surface}`, material: palette.getSurfaceMaterial(surface) });
  // The architectural library is era-independent in structure; one era's set covers every program.
  if (era === 'village') {
    for (const id of ARCHITECTURAL_MATERIALS) subjects.push({ name: `arch-${id}`, material: palette.getArchitecturalMaterial(id) });
  }
}

const report: unknown[] = [];
const paths: string[] = [];
for (const { name, material } of subjects) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

  const shaders: { kind: number; code: string }[] = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, createProgram: () => ({}),
    createShader: (kind: number) => { const s = { kind, code: '' }; shaders.push(s); return s; },
    shaderSource: (s: { code: string }, code: string) => { s.code = code; },
    compileShader: () => {}, attachShader: () => {}, linkProgram: () => {}, bindAttribLocation: () => {},
  };
  const settings: Record<string, unknown> = {
    ...shader, shaderType: material.type, shaderName: name.replaceAll('-', '_'), precision: 'highp',
    defines: { STANDARD: '', PHYSICAL: '' },
    envMapCubeUVHeight: null, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace,
    vertexNormals: true, useFog: true, fog: true, fogExp2: true,
    numDirLights: 2, numPointLights: 18, numHemiLights: 1, opaque: !material.transparent,
    shadowMapEnabled: true, shadowMapType: THREE.PCFSoftShadowMap, numDirLightShadows: 1,
    rendererExtensionParallelShaderCompile: false,
  };
  const parameters = new Proxy(settings, {
    get: (target, key: string) => (key in target ? target[key] : key.startsWith('num') ? 0 : undefined),
  });
  new WebGLProgram({ getContext: () => gl }, name, parameters, {});

  const vertex = shaders.find(s => s.kind === 1)!.code;
  const fragment = shaders.find(s => s.kind === 2)!.code;
  const occurrences = (source: string, needle: string): number => source.split(needle).length - 1;

  // The structural invariants of the two injected stages, asserted on the assembled source.
  const checks: Array<[string, boolean]> = [
    ['vertex declares the detail attribute once', occurrences(vertex, 'attribute vec4 aSurfaceDetail;') === 1],
    ['vertex declares the occlusion varying once', occurrences(vertex, 'varying float vGbOcclusion;') === 1],
    ['vertex writes the occlusion varying', occurrences(vertex, 'vGbOcclusion = aSurfaceDetail.w;') === 1],
    ['fragment declares the occlusion varying once', occurrences(fragment, 'varying float vGbOcclusion;') === 1],
    ['fragment declares the strength uniform once', occurrences(fragment, 'uniform vec2 gbOcclusionStrength;') === 1],
    ['fragment reads occlusion once', occurrences(fragment, 'float gbOcclude =') === 1],
    ['fragment spends occlusion on indirect light', occurrences(fragment, 'reflectedLight.indirectDiffuse *= gbAmbientAccess;') === 1],
    ['occlusion is declared before it is spent',
      fragment.indexOf('float gbAmbientAccess') < fragment.indexOf('reflectedLight.indirectDiffuse *= gbAmbientAccess;')],
    ['no unresolved include survived', !/#include </.test(vertex) && !/#include </.test(fragment)],
    ['no unresolved template survived', !vertex.includes('${') && !fragment.includes('${')],
  ];
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label);
  if (failed.length > 0) throw new Error(`${name}: ${failed.join('; ')}`);

  for (const { kind, code } of shaders) {
    const path = resolve(directory, `${name}.${kind === 1 ? 'vert' : 'frag'}`);
    // Older glslang builds reserve "average"; Three's common helper is ordinary GLSL in browsers.
    writeFileSync(path, code.replace(/\baverage\b/g, 'three_average'));
    paths.push(path);
  }
  report.push({ name, generated: true, patterned: material.userData['surfaceProgram'] ?? material.userData['proceduralSurface'] ?? 'occlusion-only' });
}

let linked = false;
if (process.env['GLSLANG_VALIDATOR']) {
  // In one batch: glslang is slow to start and there are a couple of hundred files.
  const result = spawnSync(process.env['GLSLANG_VALIDATOR'], ['-l', '-q', ...paths], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  linked = true;
}

console.log(JSON.stringify({ materials: subjects.length, shaders: paths.length, linked, directory, report }, null, 2));
