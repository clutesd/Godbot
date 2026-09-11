/** Controlled visual acceptance: the same generated district before work, after logging, and after abandonment. */
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { logProvince, modifyLand, advanceEnvironment } from '../src/sim/environment/EnvironmentalModificationSystem';
import { advanceDeposits } from '../src/sim/resources/WorldResourceSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';

const mode = new URLSearchParams(location.search).get('mode') ?? 'before';
const sim = new Simulation({ seed: 'environment-audit', startingPopulation: 48, world: { size: 28 }, settlementCount: [2, 2] });
const world = sim.state.world;
const timber = world.resourceDeposits.filter(d => d.resourceId === 'timber' && world.cells[d.cellIndex]!.slope < 0.25)
  .sort((a, b) => b.capacity - a.capacity)[0]!;
const quarry = world.resourceDeposits.filter(d => d.resourceId === 'stone')
  .sort((a, b) => Math.hypot(a.worldX - timber.worldX, a.worldZ - timber.worldZ) - Math.hypot(b.worldX - timber.worldX, b.worldZ - timber.worldZ))[0]!;
const surface = new TerrainSurface(world);
const vegetation = new VegetationRenderer(world, surface, 'environment-audit', 4500, []);
if (mode !== 'before') {
  const owner = sim.state.settlements[0]!.id;
  logProvince(world, timber, timber.capacity * 0.7, 120, owner);
  timber.extracted = timber.capacity * 0.7; timber.establishedMonth = 120;
  quarry.extracted = quarry.capacity * 0.8; quarry.abundance = 0.2; quarry.establishedMonth = 120;
  modifyLand(world.cells[quarry.cellIndex]!, 'quarry', 0.9, 120, owner);
  const walking = new WalkabilityLayer(world);
  const from = { x: timber.worldX, z: timber.worldZ }, to = { x: quarry.worldX, z: quarry.worldZ };
  const trail = walking.route(from, to);
  if (trail.length && Math.hypot(trail.at(-1)!.x - to.x, trail.at(-1)!.z - to.z) < 0.1) quarry.accessTrails = [[from, ...trail]];
  if (mode === 'inherited') {
    sim.state.settlements.forEach(s => { s.alive = false; });
    timber.abandonedMonth = 132; quarry.abandonedMonth = 132;
    for (let month = 132; month <= 1320; month += 12) { sim.state.month = month; advanceEnvironment(sim.state); }
  }
  advanceDeposits(world, 5);
}
world.weather!.month = mode === 'before' ? 5 : mode === 'inherited' ? 1325 : 125;
const sites = new ResourceSiteRenderer(world, surface); sites.update();
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ced9d7');
scene.add(surface.buildMesh('environment-audit'), surface.buildApron(), vegetation.group, sites.group);
const sun = new THREE.DirectionalLight('#fff2d9', 3); sun.position.set(-25, 55, 25); scene.add(sun);
scene.add(new THREE.HemisphereLight('#dce7ed', '#645945', 2));
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 500);
const y = surface.heightAt(timber.worldX, timber.worldZ);
camera.position.set(timber.worldX + 25, y + 28, timber.worldZ + 33); camera.lookAt(timber.worldX, y, timber.worldZ);
vegetation.setSeason(5); vegetation.setEcologyYear(mode === 'inherited' ? 110 : 10); vegetation.updateLod(camera.position);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.toneMapping = THREE.ACESFilmicToneMapping;
const errors: string[] = []; renderer.debug.onShaderError = (gl, p) => { errors.push(gl.getProgramInfoLog(p) ?? 'shader error'); };
document.body.style.cssText = 'margin:0;overflow:hidden;font:14px system-ui;color:#263b38';
document.body.append(renderer.domElement);
const title = document.createElement('div'); title.style.cssText = 'position:fixed;left:32px;top:24px';
title.innerHTML = `<div style="font:32px Georgia;letter-spacing:5px">GODBOX</div><p>ENVIRONMENTAL FOUNDATION · ${mode.toUpperCase()}</p><p>Controlled extraction scenario · same seed and camera</p>`;
document.body.append(title);
const controls = document.createElement('div'); controls.style.cssText = 'position:fixed;left:32px;bottom:24px;display:flex;gap:24px';
for (const view of ['before', 'worked', 'inherited']) {
  const link = document.createElement('a'); link.href = `?mode=${view}`; link.textContent = view; link.style.color = '#263b38'; controls.append(link);
}
document.body.append(controls);
renderer.render(scene, camera);
const report = document.createElement('pre'); report.id = 'environment-report'; report.style.display = 'none';
report.textContent = JSON.stringify({ mode, errors, glError: renderer.getContext().getError(), calls: renderer.info.render.calls,
  changedCells: world.cells.filter(c => c.modifications).length, timberRemaining: timber.abundance, quarryRemaining: quarry.abundance });
document.body.append(report);
