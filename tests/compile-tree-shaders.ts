/** Compile the actual Three programs with an offline Khronos validator. No browser/GPU claims. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_NEAR, TREE_LOD_FAR } from '../src/render/vegetation/TreeLibrary';
import { bindTreeMaterial } from '../src/render/vegetation/TreeMaterials';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';
import { vegetationFixture, disposeVegetation } from './fixtures/vegetation';

const validator = process.env['GLSLANG_VALIDATOR'];
if (!validator) throw new Error('Set GLSLANG_VALIDATOR to an installed glslangValidator executable.');
const { WebGLProgram } = await import('three/src/renderers/webgl/' + 'WebGLProgram.js');
const directory = resolve('node_modules/.tmp/tree-shaders');
mkdirSync(directory, { recursive: true });
const { world, surface } = vegetationFixture();
const weather = new WeatherRenderer(world, surface, 'tree-shader-audit');
const report: { name: string; linked: boolean; attributeSlots: number }[] = [];
for (const [tier, lod] of [['near', TREE_LOD_NEAR], ['far', TREE_LOD_FAR]] as const) {
  for (const [family, variants] of buildTreeLibrary('shader-audit', 1, lod)) {
    const tree = variants[0]!;
    for (const kind of ['bark', 'foliage'] as const) {
      const mesh = new THREE.InstancedMesh(tree[kind], new THREE.MeshStandardMaterial({ vertexColors: true }), 1);
      bindTreeMaterial(mesh, kind, family, tree.height).setXYZW(0, 0.75, 0.6, 0.4, 0);
      if (kind === 'foliage') { mesh.name = 'weather-foliage'; mesh.setColorAt(0, new THREE.Color('green')); }
      const scene = new THREE.Scene(); scene.add(mesh); weather.bindScene(scene);
      for (const pass of ['standard', 'hdr', 'depth', 'distance'] as const) {
        const colourPass = pass === 'standard' || pass === 'hdr';
        const material = (colourPass ? mesh.material : pass === 'depth' ? mesh.customDepthMaterial : mesh.customDistanceMaterial) as THREE.Material;
        const source = THREE.ShaderLib[colourPass ? 'standard' : pass]!;
        const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader };
        material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
        const name = `${family}-${tier}-${kind}-${pass}`;
        const shaders: { kind: number; code: string }[] = [];
        const gl = {
          VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, createProgram: () => ({}),
          createShader: (kind: number) => { const s = { kind, code: '' }; shaders.push(s); return s; },
          shaderSource: (s: { code: string }, code: string) => { s.code = code; },
          compileShader: () => {}, attachShader: () => {}, linkProgram: () => {}, bindAttribLocation: () => {},
        };
        const settings: Record<string, unknown> = {
          ...shader, shaderType: material.type, shaderName: name.replaceAll('-', '_'), precision: 'highp',
          defines: colourPass ? { STANDARD: '' } : {}, envMapCubeUVHeight: null,
          toneMapping: pass === 'standard' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping,
          outputColorSpace: pass === 'standard' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace,
          instancing: true, instancingColor: colourPass && kind === 'foliage',
          vertexColors: colourPass, vertexNormals: colourPass, depthPacking: pass === 'depth' ? THREE.RGBADepthPacking : undefined,
          useDepthPacking: pass === 'depth',
          useFog: colourPass, fog: colourPass, fogExp2: true, opaque: true,
          numDirLights: colourPass ? 2 : 0, numPointLights: colourPass ? 2 : 0, numHemiLights: colourPass ? 1 : 0,
          shadowMapEnabled: colourPass, shadowMapType: THREE.PCFSoftShadowMap, numDirLightShadows: colourPass ? 1 : 0,
          rendererExtensionParallelShaderCompile: false,
        };
        const parameters = new Proxy(settings, { get: (target, key: string) => key in target ? target[key] : key.startsWith('num') ? 0 : undefined });
        new WebGLProgram({ getContext: () => gl }, name, parameters, {});
        const paths = shaders.map(s => {
          const path = resolve(directory, `${name}.${s.kind === 1 ? 'vert' : 'frag'}`);
          // Compatibility with the older validator, matching the existing ecology audit.
          writeFileSync(path, s.code.replace(/\baverage\b/g, 'three_average')); return path;
        });
        const result = spawnSync(validator, ['-l', '-q', ...paths], { encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) throw new Error(`${name}: ${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
        const inputs = result.stdout.split('Pipeline input reflection:')[1]?.split('Pipeline output reflection:')[0] ?? '';
        const attributeSlots = inputs.split('\n').filter(line => line.includes(':')).reduce((sum, line) => sum + (line.includes('type 8b5c') ? 4 : 1), 0);
        if (attributeSlots > 16) throw new Error(`${name}: exceeds WebGL's minimum 16 attribute slots`);
        report.push({ name, linked: true, attributeSlots });
      }
      disposeVegetation(new THREE.Group().add(mesh));
    }
  }
}
weather.dispose();
writeFileSync('docs/tree-shader-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Compiled and linked ${report.length} colour/HDR/depth/distance tree programs; maximum ${Math.max(...report.map(r => r.attributeSlots))} vertex attribute slots.`);
