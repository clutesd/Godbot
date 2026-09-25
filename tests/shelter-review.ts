import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Simulation } from '../src/sim/Simulation';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { createSurvivalStructure } from '../src/render/founding/SurvivalStructure';
const sim = new Simulation({ seed: 'founding-loop-audit', startMode: 'arrival', world: { size: 64 } });
sim.advanceArrival(80); sim.beginHistory(); sim.step(1);
const response = sim.state.settlements[0]!.development!.project!.response;
const palette = new MaterialPalette({culture: response.style, era:'primitive'});
const scene = new THREE.Scene(); scene.background = new THREE.Color('#a8bec2');
scene.add(new THREE.HemisphereLight('#eff4ef', '#76664c', 2.3));
const light = new THREE.DirectionalLight('#ffdeb1', 3); light.position.set(-3, 7, 5); scene.add(light);
const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(devicePixelRatio); document.body.append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(36,innerWidth/innerHeight,0.1,100); camera.position.set(4,4.5,8); camera.lookAt(0,0.3,0);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#797c58',roughness:1})); floor.rotation.x=-Math.PI/2;floor.position.y=-0.01;scene.add(floor);
for(const [i,adaptation] of (['lean-to','hut','earth-shelter','cache'] as const).entries()) {
 const building=createSurvivalStructure({...response,adaptation,temporary:adaptation==='lean-to'},1,1.5,1.2,palette);
 building.position.set((i%2-0.5)*2.3,0,(Math.floor(i/2)-0.5)*2); scene.add(building);
}
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0,0.3,0); controls.update();
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
renderer.setAnimationLoop(()=>renderer.render(scene,camera));
