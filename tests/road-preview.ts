import * as THREE from 'three';
import { roadSurfaceMaterial } from '../src/render/transport/RoadSurfaceMaterial';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor('#414d3b'); renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#e8f1ff', '#71624a', 2));
const sun = new THREE.DirectionalLight('#fff0d2', 3); sun.position.set(-3, 4, 2); scene.add(sun);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0, 5, 5); camera.lookAt(0, 0, 0);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({color:'#667450',roughness:1}));
ground.rotation.x = -Math.PI/2; ground.position.y = -0.002; scene.add(ground);
for (let i=0; i<4; i++) {
 const geo = new THREE.PlaneGeometry(0.65, 5, 8, 90); geo.rotateX(-Math.PI/2);
 const uv = geo.getAttribute('uv'); const attrs: number[]=[];
 for(let j=0;j<uv.count;j++) attrs.push(uv.getX(j),uv.getY(j)*5,i+2);
 geo.setAttribute('roadUV',new THREE.Float32BufferAttribute(attrs,3));
 const mesh=new THREE.Mesh(geo,roadSurfaceMaterial(['#927a59','#897153','#927953','#928b7c'][i]!));
 mesh.position.set((i-1.5)*1.2,0.01,0);scene.add(mesh);
}
renderer.render(scene,camera);
(globalThis as unknown as { roadPreview: unknown }).roadPreview = { programs: renderer.info.programs?.length, calls: renderer.info.render.calls };
