/** Reproducible acceptance scene; production terrain, volcano and postprocessing. */
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { advanceVolcano, type VolcanoPhase } from '../src/sim/environment/VolcanoSystem';
import { volcanoChannels } from '../src/sim/environment/VolcanoFootprint';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { VolcanoRenderer } from '../src/render/geology/VolcanoRenderer';
import { EcologyPostProcessing } from '../src/render/atmosphere/EcologyPostProcessing';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? 'volcano-cone';
const phases: VolcanoPhase[] = ['dormant', 'unrest', 'erupting', 'cooling'];
const phase = phases.find(value => value === params.get('phase')) ?? 'erupting';
const simulation = new Simulation({ seed, world: { size: 32 }, startingPopulation: 40, settlementCount: [2, 2] });
const { state } = simulation;
const volcano = state.volcano!;
volcano.nextEruptionMonth = 18;
volcano.eruptionMonths = 24;
const targetMonth = { dormant: 0, unrest: 15, erupting: 30, cooling: 53 }[phase];
for (state.month = 1; state.month <= targetMonth; state.month++) advanceVolcano(state, volcano, seed);
state.month = targetMonth;
const surface = new TerrainSurface(state.world);
const scene = new THREE.Scene();
const night = params.has('night');
scene.background = new THREE.Color(night ? '#111a2c' : '#859ba5');
scene.fog = new THREE.FogExp2(scene.background, 0.004);
scene.add(surface.buildMesh(seed));
const presentation = new VolcanoRenderer(state, surface);
scene.add(presentation.group);
scene.add(new THREE.HemisphereLight('#b6d0f4', '#514038', night ? 0.35 : 1.8));
const sun = new THREE.DirectionalLight('#ffe3c2', night ? 0.15 : 3.2);
sun.position.set(-30, 60, 20); scene.add(sun);
const y = surface.heightAt(volcano.worldX, volcano.worldZ);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
const close = params.has('close');
camera.position.set(volcano.worldX + (close ? 21 : 55), y + (close ? 19 : 42), volcano.worldZ + (close ? 24 : 65));
camera.lookAt(volcano.worldX, y + (close ? 1 : 16), volcano.worldZ);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;
const errors: string[] = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
};
document.body.style.cssText = 'margin:0;overflow:hidden;background:#111a2c;color:#eee;font:14px system-ui';
document.body.append(renderer.domElement);
const title = document.createElement('div');
title.style.cssText = 'position:fixed;top:28px;left:32px;text-shadow:0 2px 8px #000';
title.textContent = `GODBOX / VOLCANO STUDY / ${phase.toUpperCase()}`;
document.body.append(title);
const nav = document.createElement('nav');
nav.style.cssText = 'position:fixed;bottom:24px;left:32px;display:flex;gap:24px';
for (const value of [...phases, 'night', 'close']) {
  const query = new URLSearchParams(params);
  if (phases.includes(value as VolcanoPhase)) query.set('phase', value);
  else if (query.has(value)) query.delete(value); else query.set(value, '');
  const link = document.createElement('a'); link.href = `?${query}`; link.textContent = value;
  link.style.color = '#fff'; nav.append(link);
}
document.body.append(nav);
const post = new EcologyPostProcessing(renderer, scene, camera, 1);
post.resize(innerWidth, innerHeight);
const report = document.createElement('pre'); report.id = 'webgl-result'; report.hidden = true; document.body.append(report);
let frame = 0;
const clock = new THREE.Clock();
let elapsed = 36;
function render() {
  const dt = params.has('still') ? 1 / 60 : Math.min(0.1, clock.getDelta());
  elapsed += dt;
  presentation.update(dt, elapsed, camera);
  renderer.info.reset(); post.render(night ? 1 : 0);
  frame++;
  report.textContent = JSON.stringify({ complete: frame >= 8, phase: volcano.phase, activity: volcano.activity,
    errors, glError: renderer.getContext().getError(), visible: presentation.group.visible,
    channels: volcanoChannels(state.world, seed).map(channel => channel.points.length),
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length });
  if (!params.has('still') || frame < 8) requestAnimationFrame(render);
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.resize(innerWidth, innerHeight);
});
render();
