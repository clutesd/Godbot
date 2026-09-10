/** Standalone WebGL acceptance scene using production renderer modules. No archive or user data. */
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { TerrainDecor } from '../src/render/terrain/TerrainDecor';
import { WaterSystem } from '../src/render/terrain/WaterSystem';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { EcologyField, DEFAULT_ECOLOGY_QUALITY } from '../src/render/ecology/EcologyField';
import { EcologyPostProcessing } from '../src/render/atmosphere/EcologyPostProcessing';

const params = new URLSearchParams(location.search);
const requestedMode = params.get('mode') ?? 'night';
const mode = ['day', 'twilight', 'night', 'storm', 'winter', 'damage'].includes(requestedMode) ? requestedMode : 'night';
const baseline = params.has('baseline');
const quality = Math.max(0, Math.min(2, Math.floor(Number(params.get('quality') ?? 2) || 0))) as 0 | 1 | 2;
const seed = params.get('seed') ?? 'witness-the-saffron-river';
const simulation = new Simulation({ seed, world: { size: 32, cellSize: 2.25, seaLevel: 0.34 }, startingPopulation: 48, settlementCount: [2, 2] });
simulation.step(5);
const world = simulation.state.world;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#101b30');
scene.fog = new THREE.FogExp2('#16283c', 0.004);
const surface = new TerrainSurface(world);
const ecology = new EcologyField(world, seed);
const water = new WaterSystem(world, surface, seed, baseline ? undefined : ecology, quality);
const vegetation = new VegetationRenderer(world, surface, seed, 3000, [], baseline ? undefined : ecology,
  { ...DEFAULT_ECOLOGY_QUALITY, waterComplexity: quality });
vegetation.setSeason(5);
const decor = new TerrainDecor(world, surface, seed, 1);
scene.add(surface.buildMesh(seed), surface.buildApron(), water.group, vegetation.group, decor.group);
const sun = new THREE.DirectionalLight('#fff1d6', 3.2);
sun.position.set(-16, 48, 28);
const moon = new THREE.DirectionalLight('#8fa6d9', 0.48);
moon.position.set(20, 28, -12);
const ambient = new THREE.HemisphereLight('#91b6ca', '#5c392e', 0.16);
scene.add(sun, moon, ambient);
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 900);
const coast = world.cells.filter(c => !c.water && c.coast && c.wood > 0.2)
  .sort((a, b) => (b.wood * b.moisture) - (a.wood * a.moisture))[0] ?? world.cells.find(c => !c.water)!;
camera.position.set(coast.worldX + 25, surface.heightAt(coast.worldX, coast.worldZ) + 23, coast.worldZ + 31);
camera.lookAt(coast.worldX - 2, surface.seaLevelY + 1, coast.worldZ - 2);
if (params.has('close')) {
  const woodland = world.cells.filter(c => !c.water && c.wood > 0.5).sort((a, b) => b.moisture - a.moisture)[0]!;
  const y = surface.heightAt(woodland.worldX, woodland.worldZ);
  camera.position.set(woodland.worldX + 6, y + 4, woodland.worldZ + 8);
  camera.lookAt(woodland.worldX, y + 0.3, woodland.worldZ);
}
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.info.autoReset = false;
const errors: string[] = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
};
document.body.style.cssText = 'margin:0;background:#101b30;color:#f1eee3;font:14px system-ui;overflow:hidden';
document.body.append(renderer.domElement);
const caption = document.createElement('div');
caption.style.cssText = 'position:fixed;left:32px;top:24px;letter-spacing:3px;text-shadow:0 2px 8px #000';
caption.innerHTML = `<div style="font:32px Georgia;letter-spacing:7px">GODBOX</div><p>LIVING ECOLOGY · ${mode.toUpperCase()}${baseline ? ' · BASELINE' : ''}</p>`;
document.body.append(caption);
const controls = document.createElement('div');
controls.style.cssText = 'position:fixed;left:32px;bottom:24px;display:flex;gap:20px';
for (const scenario of ['day', 'twilight', 'night', 'storm', 'winter', 'damage']) {
  const link = document.createElement('a');
  const query = new URLSearchParams(params); query.set('mode', scenario);
  link.href = `?${query}`;
  link.textContent = scenario; link.style.color = '#c7d1d4'; controls.append(link);
}
document.body.append(controls);
const post = new EcologyPostProcessing(renderer, scene, camera, baseline ? 0 : quality);
post.resize(innerWidth, innerHeight);
vegetation.setViewport(innerHeight, 1);
const daylight = mode === 'day' ? 1 : mode === 'twilight' ? 0.22 : 0;
sun.intensity = 0.08 + daylight * 3.25;
moon.intensity = 0.1 + (1 - daylight) * 0.38;
ambient.intensity = 0.16 + daylight * 1.36;
scene.background.lerp(new THREE.Color('#91aaa0'), daylight);
if (mode === 'winter' || mode === 'storm' || mode === 'damage') {
  for (const w of world.weather!.cells) {
    if (mode === 'winter') { w.temperature = 0.23; w.snowpack = 0.3; }
    if (mode === 'damage') w.treeDamage = 1;
    if (mode === 'storm') { w.wind = 0.9; w.precipitation = 'rain'; w.kind = 'thunderstorm'; w.intensity = 0.9; }
  }
  if (mode === 'winter') vegetation.setSeason(11);
  if (mode === 'storm') world.weather!.wind = 0.9;
  world.environmentRevision = (world.environmentRevision ?? 0) + 1;
}
ecology.sync([], mode === 'winter' ? 11 : 5);
water.syncHydrology();
vegetation.updateLod(camera.position);
const result = document.createElement('pre');
result.id = 'webgl-result';
result.style.cssText = 'display:none;position:fixed;right:24px;bottom:20px;max-width:50vw;max-height:40vh;overflow:auto;background:#101b30dd;padding:12px;font-size:11px';
document.body.append(result);
let frame = 0;
const times: number[] = [];
function render() {
  const start = performance.now();
  const t = params.has('still') ? 36 : 36 + frame / 60;
  ecology.animate(t, daylight);
  water.update(t);
  vegetation.updateLeaves(t);
  renderer.info.reset();
  post.render(ecology.night.value);
  times.push(performance.now() - start);
  frame++;
  const gl = renderer.getContext();
  result.textContent = JSON.stringify({ complete: frame >= 8, frame, mode, errors,
    glError: gl.getError(), maxAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    points: renderer.info.render.points, programs: renderer.info.programs?.length,
    vegetation: vegetation.report, cpuFrameMs: times.slice(3) });
  if (errors.length || params.has('report')) result.style.display = 'block';
  if (!params.has('still') || frame < 8) requestAnimationFrame(render);
}
render();
