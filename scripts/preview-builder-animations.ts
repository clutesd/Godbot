import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import { sampleConstructionAction } from '../src/render/construction/ConstructionActionPresentation';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { constructionBodyPitch } from '../src/render/construction/ConstructionGesture';
import { createCosmicBodyGeometry, createCosmicHeadGeometry } from '../src/render/people/CosmicPeople';
import type { Person } from '../src/sim/types';
import type { StructureMaterial } from '../src/sim/development/types';

// CPU projection of the production instanced geometry. No WebGL/browser/dependency required.
const output = 'output/builder-animation';
mkdirSync(output, { recursive: true });
const camera = new THREE.OrthographicCamera(-0.33, 0.33, 0.36, -0.18, 0.01, 10);
camera.position.set(0.9, 0.65, -0.7); camera.lookAt(0, 0.12, 0.06); camera.updateMatrixWorld();
const light = new THREE.Vector3(-0.5, 1, -0.8).normalize();
const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const normal = new THREE.Vector3(), edge = new THREE.Vector3();
const instance = new THREE.Matrix4(), transform = new THREE.Matrix4();
const colour = new THREE.Color();
type Triangle = { points: number[][]; fill: string; depth: number };
function project(root: THREE.Object3D): Triangle[] {
  const triangles: Triangle[] = [];
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const positions = object.geometry.getAttribute('position'), indices = object.geometry.index;
    const count = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let inst = 0; inst < count; inst++) {
      transform.copy(object.matrixWorld);
      const material = (Array.isArray(object.material) ? object.material[0]! : object.material) as THREE.MeshStandardMaterial;
      colour.copy(material.color ?? new THREE.Color('#999999'));
      if (object instanceof THREE.InstancedMesh) {
        object.getMatrixAt(inst, instance); transform.multiply(instance);
        if (object.instanceColor) object.getColorAt(inst, colour);
      }
      if (Math.abs(transform.determinant()) < 1e-12) continue;
      const end = Math.min(indices?.count ?? positions.count, object.geometry.drawRange.start + object.geometry.drawRange.count);
      for (let i = object.geometry.drawRange.start; i < end; i += 3) {
        for (let j = 0; j < 3; j++) points[j]!.fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j).applyMatrix4(transform);
        normal.subVectors(points[1]!, points[0]!).cross(edge.subVectors(points[2]!, points[0]!)).normalize();
        const shaded = colour.clone();
        const colors = object.geometry.getAttribute('color');
        if (material.vertexColors && colors) {
          const vertex = new THREE.Color(0, 0, 0);
          for (let j = 0; j < 3; j++) {
            const n = indices ? indices.getX(i + j) : i + j;
            vertex.r += colors.getX(n) / 3; vertex.g += colors.getY(n) / 3; vertex.b += colors.getZ(n) / 3;
          }
          shaded.multiply(vertex);
        }
        shaded.multiplyScalar(0.4 + Math.max(0, normal.dot(light)) * 0.6);
        const depth = points.reduce((sum, p) => sum + p.clone().applyMatrix4(camera.matrixWorldInverse).z, 0) / 3;
        triangles.push({ depth, fill: `#${shaded.getHexString()}`, points: points.map(p => {
          const projected = p.clone().project(camera);
          return [(projected.x + 1) * 160, (1 - projected.y) * 135];
        }) });
      }
    }
  });
  return triangles.sort((a, b) => a.depth - b.depth);
}

const person = { id: 'builder-preview', activity: 'construct' } as Person;
const anchors = { pickup: { x: 0, z: 0 }, delivery: { x: 0, z: 0 }, handoff: { x: 0, z: -0.22 },
  materialCenter: { x: 0, z: 0.13 }, siteCenter: { x: 0, z: 0.24 }, prep: { x: 0, z: 0 }, prepCenter: { x: 0, z: 0.24 },
  workContact: { x: 0, z: 0.24 }, contactHeight: 0.18, platformHeight: 0 };
const rows: { name: string; material: StructureMaterial; phase: 'assemble' | 'pickup'; carrying: boolean }[] = [
  { name: 'Timber / brace and hammer', material: 'timber', phase: 'assemble', carrying: false },
  { name: 'Masonry / lift and bed', material: 'masonry', phase: 'assemble', carrying: true },
  { name: 'Earth / compress and recover', material: 'earth', phase: 'assemble', carrying: false },
  { name: 'Hauler / bend, acquire, lift', material: 'timber', phase: 'pickup', carrying: true },
];
const timeline = process.argv.includes('--motion');
const columns = timeline ? Array.from({ length: 32 }, (_, i) => i / 32) : [0.1, 0.3, 0.415, 0.8];
const frames: { row: number; column: number; label: string; triangles: Triangle[] }[] = [];
for (const [row, spec] of rows.entries()) for (const [column, p] of columns.entries()) {
  const root = new THREE.Group();
  const renderer = new ResourceWorkerRenderer(); root.add(renderer.group);
  const motion = createResourceWorkMotion();
  const action = sampleConstructionAction(person, 'preview', { phase: spec.phase, seconds: p * (spec.phase === 'pickup' ? 0.9 : 1.8), carrying: spec.carrying && (spec.phase === 'pickup' ? p >= 0.62 : p < 0.62) },
    anchors, spec.material, motion, undefined, spec.phase === 'pickup' ? 'hauler' : 'assembler', 2, 0.3);
  const scale = 0.28 * 1.14;
  const torso = new THREE.Mesh(createCosmicBodyGeometry(), new THREE.MeshStandardMaterial({ color: '#465869' }));
  torso.position.set(0, (0.44 - motion.crouch) * scale, (motion.construction?.weight ?? 0) * scale);
  torso.rotation.set(constructionBodyPitch(motion, 1), motion.twist, 0); torso.scale.setScalar(scale); torso.updateMatrixWorld(); root.add(torso);
  const head = new THREE.Mesh(createCosmicHeadGeometry(), new THREE.MeshStandardMaterial({ color: '#687b88' }));
  head.position.set(0, 0.425, 0).applyMatrix4(torso.matrixWorld); head.scale.setScalar(scale);
  head.rotation.set(motion.construction?.headPitch ?? 0, -motion.twist * 0.65, 0); root.add(head);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.045), new THREE.MeshStandardMaterial({ color: '#b49165' }));
  wall.position.set(0, 0.11, 0.265); root.add(wall);
  renderer.setBodyTransform(torso.matrixWorld); renderer.beginFrame();
  renderer.drawPhysical(motion, action.interactionAnchor, action.activeTool, action.carriedObject, '#b49165', 1,
    0, 0, 0, scale, 0, new THREE.Color('#465869'), false, true, false, action.contactEffect ?? 'none', action.contactHeight);
  renderer.endFrame();
  frames.push({ row, column, label: `${spec.name} / ${p}`, triangles: project(root) });
}
writeFileSync(`${output}/${timeline ? 'motion' : 'poses'}.json`, JSON.stringify(frames));
if (!timeline) {
const polygons = frames.map(frame => `<g transform="translate(${frame.column * 320},${frame.row * 300})"><text x="12" y="20" fill="#263940" font-size="13">${frame.label}</text>${frame.triangles.map(t => `<polygon points="${t.points.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ')}" fill="${t.fill}"/>`).join('')}</g>`).join('');
writeFileSync(`${output}/poses.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1200" viewBox="0 0 1280 1200"><rect width="1280" height="1200" fill="#e0e6df"/>${polygons}</svg>`);
console.log(`${output}/poses.svg`);
} else console.log(`${output}/motion.json`);
