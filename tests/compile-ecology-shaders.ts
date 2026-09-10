/** Offline GLSL compile/link check. Uses Three's actual WebGLProgram preprocessing; no browser.
 * Run with GLSLANG_VALIDATOR pointing to the Khronos glslangValidator executable. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WaterSystem } from '../src/render/terrain/WaterSystem';
import { EcologyField, DEFAULT_ECOLOGY_QUALITY } from '../src/render/ecology/EcologyField';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';

const { WebGLProgram } = await import('three/src/renderers/webgl/' + 'WebGLProgram.js');
const directory = resolve('node_modules/.tmp/ecology-shaders');
mkdirSync(directory, { recursive: true });
const simulation = new Simulation({ seed: 'witness-the-saffron-river', world: { size: 32 }, startingPopulation: 48, settlementCount: [2, 2] });
simulation.step(5);
const world = simulation.state.world;
const surface = new TerrainSurface(world);
const ecology = new EcologyField(world, simulation.config.seed);
const camera = new THREE.Vector3(12, 14, 22);
const plants = new VegetationRenderer(world, surface, simulation.config.seed, 3000, [], ecology, DEFAULT_ECOLOGY_QUALITY);
plants.setSeason(5); plants.updateLod(camera);
const baselinePlants = new VegetationRenderer(world, surface, simulation.config.seed, 3000);
baselinePlants.setSeason(5); baselinePlants.updateLod(camera);
const modes: { name: string; object: THREE.Mesh | THREE.Points }[] = [];
for (const quality of [0, 1, 2] as const) {
  const water = new WaterSystem(world, surface, simulation.config.seed, ecology, quality);
  water.group.children.forEach((o, i) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshPhysicalMaterial) modes.push({ name: `water-${i}-quality-${quality}`, object: o });
  });
}
plants.group.traverse(o => {
  if (o instanceof THREE.Mesh && o.name === 'luminous-fungus' || o instanceof THREE.Points && o.name === 'fireflies-spores-and-pollen') modes.push({ name: o.name, object: o as THREE.Mesh | THREE.Points });
});
const report: unknown[] = [];
for (const pipeline of ['direct', 'hdr'] as const) for (const mode of modes) {
  const { object } = mode;
  const name = `${mode.name}-${pipeline}`;
  const material = object.material as THREE.MeshPhysicalMaterial | THREE.ShaderMaterial;
  const shaderMaterial = material instanceof THREE.ShaderMaterial;
  const source = shaderMaterial ? material : THREE.ShaderLib.physical;
  const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader };
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
    defines: shaderMaterial ? {} : { STANDARD: '', PHYSICAL: '', USE_CLEARCOAT: '' },
    envMapCubeUVHeight: null, toneMapping: pipeline === 'direct' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping,
    outputColorSpace: pipeline === 'direct' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace,
    instancing: object instanceof THREE.InstancedMesh, instancingColor: object instanceof THREE.InstancedMesh,
    vertexColors: material.vertexColors, vertexNormals: !shaderMaterial,
    useFog: true, fog: true, fogExp2: true, clearcoat: !shaderMaterial,
    numDirLights: 2, numPointLights: 18, numHemiLights: 1, opaque: !material.transparent,
    shadowMapEnabled: !shaderMaterial, shadowMapType: THREE.PCFSoftShadowMap, numDirLightShadows: shaderMaterial ? 0 : 1,
    rendererExtensionParallelShaderCompile: false,
  };
  const parameters = new Proxy(settings, { get: (target, key: string) => key in target ? target[key] : key.startsWith('num') ? 0 : undefined });
  new WebGLProgram({ getContext: () => gl }, name, parameters, {});
  const paths = shaders.map(s => {
    const path = resolve(directory, `${name}.${s.kind === 1 ? 'vert' : 'frag'}`);
    // Older glslang builds reserve "average"; Three's common helper is ordinary GLSL in browsers.
    // Rename only that helper in the offline copy, preserving its signature and all call sites.
    writeFileSync(path, s.code.replace(/\baverage\b/g, 'three_average')); return path;
  });
  if (process.env['GLSLANG_VALIDATOR']) {
    const result = spawnSync(process.env['GLSLANG_VALIDATOR'], ['-l', '-q', ...paths], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`${name}: ${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
    const inputs = result.stdout.split('Pipeline input reflection:')[1]?.split('Pipeline output reflection:')[0] ?? '';
    const attributeSlots = inputs.split('\n').filter(line => line.includes(':')).reduce((sum, line) => sum + (line.includes('type 8b5c') ? 4 : 1), 0);
    if (attributeSlots > 16) throw new Error(`${name} requires ${attributeSlots} vertex attribute slots (WebGL minimum: 16)`);
    report.push({ name, linked: true, attributeSlots });
  } else report.push({ name, generated: true });
}
function resources(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Points)) return;
    geometries.add(o.geometry);
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material);
  });
  return { materials: materials.size, geometries: geometries.size };
}
console.log(JSON.stringify({ shaders: report, baseline: baselinePlants.report, baselineResources: resources(baselinePlants.group),
  uplift: plants.report, upliftResources: resources(plants.group) }, null, 2));
