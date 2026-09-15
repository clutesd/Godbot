import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { ResourceWorkScene } from '../src/render/resources/ResourceWorkScene';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { recordResourceWorkAssignment, beginResourceWorkMonth } from '../src/sim/resources/ResourceWorkAssignments';
import { resourceWorkDestinationId } from '../src/sim/people/ResourceWorkRouting';
import type { Person } from '../src/sim/types';
interface Triangle { xy: number[]; z: number; color: string }

const light = new THREE.Vector3(-0.4, 1, 0.65).normalize();

function project(group: THREE.Group, camera: THREE.Camera): Triangle[] {
  camera.updateMatrixWorld(); group.updateMatrixWorld(true);
  const triangles: Triangle[] = [];
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const attribute = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    const material = object.material as THREE.MeshStandardMaterial;
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      const transform = object.matrixWorld.clone();
      const tint = material.color.clone();
      if (object instanceof THREE.InstancedMesh) {
        const matrix = new THREE.Matrix4(); object.getMatrixAt(instance, matrix); transform.multiply(matrix);
        if (object.instanceColor) { const color = new THREE.Color(); object.getColorAt(instance, color); tint.multiply(color); }
      }
      for (let i = 0; i < (geometry.index?.count ?? attribute.count); i += 3) {
        const indices = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(i + j) : i + j);
        const points = indices.map(j => new THREE.Vector3().fromBufferAttribute(attribute, j).applyMatrix4(transform));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        const color = tint.clone();
        if (colors && material.vertexColors) color.multiply(new THREE.Color().fromBufferAttribute(colors, indices[0]!));
        color.multiplyScalar(0.68 + Math.max(0, normal.dot(light)) * 0.55);
        const projected = points.map(point => point.project(camera));
        if (projected.every(p => Math.abs(p.x) > 1.3 || Math.abs(p.y) > 1.3)) continue;
        triangles.push({ xy: projected.flatMap(p => [(p.x + 1) * 280, (1 - p.y) * 155]),
          z: projected.reduce((sum, p) => sum + p.z, 0), color: `#${color.getHexString()}` });
      }
    }
  });
  return triangles.sort((a, b) => b.z - a.z);
}


const { simulation, world, surface } = vegetationFixture('resource-work-study');
for(const cell of world.cells) {cell.landform='lowland';cell.movementCost=1;}
const work = new ResourceWorkScene(world, 'resource-work-study');
const sites = new ResourceSiteRenderer(world,surface,work);
const rig = new ResourceWorkerRenderer();
const group = new THREE.Group(); group.add(sites.group,rig.group);
const body=new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.12,0.34,2,5),new THREE.MeshStandardMaterial({color:'#ad8159'}),4);
const head=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12,1),new THREE.MeshStandardMaterial({color:'#d6b180'}),4);
group.add(body,head);
const marker=new THREE.Object3D(),colour=new THREE.Color('#ad8159');
const y=surface.heightAt(0,0);
const camera=new THREE.PerspectiveCamera(34,560/310,.01,100);
camera.position.set(1.3,y+1.05,1.9);camera.lookAt(.12,y+.12,0);
const panels=[];
for(const resourceId of ['timber','stone','plant-fiber','copper-ore','iron-ore','coal','uranium-ore','medicinal-flora']) {
 simulation.state.month++;beginResourceWorkMonth(simulation.state);
 const assignment={month:simulation.state.month,source:'world-resource' as const,settlementId:simulation.state.settlements[0]!.id,siteId:'study-site',resourceId,worldPosition:{x:0,z:0},gatherOccupations:['forager' as const],labourByOccupation:{forager:12},amountExtracted:12,labourUsed:12};
 recordResourceWorkAssignment(simulation.state,assignment);sites.update();
 const site=[...work.sites.values()][0]!;
 const people=simulation.state.people.slice(0,4).map((p,i)=>({...p,homeId:assignment.settlementId,alive:true,role:'gatherer',occupation:'forager',activity:'gather',health:1,displacedSinceMonth:undefined,position:{...site.stations[i]!.anchor},navigation:{...p.navigation!,destinationId:resourceWorkDestinationId(assignment),traveling:false,schedulePhase:'work'}} as Person));
 work.bindWorkers(people);
 for(const t of [0,1,2]) {
 rig.beginFrame();let i=0;
 for(const person of people){const worker=work.workers.get(person.id)!;worker.blend=1;rig.sample(worker,t,0,true);const m=rig.motion;const p=worker.station.anchor,f=worker.station.facing;
 marker.position.set(p.x,y+(.47-m.crouch)*.28,p.z);marker.rotation.set(m.lean,f+m.twist,0);marker.scale.setScalar(.28);marker.updateMatrix();body.setMatrixAt(i,marker.matrix);
 marker.position.y=y+(.84-m.crouch)*.28;marker.rotation.set(0,f,0);marker.updateMatrix();head.setMatrixAt(i++,marker.matrix);
 rig.draw(worker,p.x,y,p.z,.28,f,colour);
 }rig.endFrame();panels.push({title:resourceId+' / '+t+'s',triangles:project(group,camera)});
 }
}
mkdirSync('output/resource-work',{recursive:true});writeFileSync('output/resource-work/contact-sheet.json',JSON.stringify(panels));
