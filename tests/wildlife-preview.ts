import * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { LandWildlifeRenderer, type LandAnimalPlan } from '../src/render/wildlife/LandWildlifeRenderer';
const { world, surface } = vegetationFixture('wildlife-review');
const plans: LandAnimalPlan[] = (['elk', 'bear', 'fox', 'squirrel'] as const).map((species, index) => ({
  id: `${species}-test`, species, route: [{ x: index * 0.85 - 1.2, z: 0 }, { x: index * 0.85 - 1.2, z: 0.5 }],
  scale: 1, speed: 0.05, phase: index * 0.17, gaitPhase: index, offsetX: 0, offsetZ: 0, coat: 1,
}));
const wildlife = new LandWildlifeRenderer(world, surface, 'wildlife-review', [], plans);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas')!, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight * 0.88);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#263d37');
const groundY = surface.heightAt(0, 0);
const camera = new THREE.PerspectiveCamera(36, innerWidth / (innerHeight * 0.88), 0.01, 50);
camera.position.set(2.3, groundY + 1.6, 3.9); camera.lookAt(0, groundY + 0.15, 0.2);
scene.add(new THREE.HemisphereLight('#d8ebf3', '#716448', 2.5));
const sun = new THREE.DirectionalLight('#ffe0ad', 3); sun.position.set(-2, 5, 3); scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#657553', roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = groundY - 0.006; scene.add(floor, wildlife.group);
const month = document.querySelector<HTMLInputElement>('#month')!;
renderer.setAnimationLoop(time => {
  world.weather!.month = Number(month.value);
  document.querySelector('#age')!.textContent = ` Month ${month.value}`;
  wildlife.setCamera(camera.position); wildlife.update(time / 1000); renderer.render(scene, camera);
});
