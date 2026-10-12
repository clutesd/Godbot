import * as THREE from 'three';
import type { StructurePlot } from '../../sim/types';
import { stableHash } from '../../sim/prng';

/** The footprint and rubble derive from the same plot as the damaged building. */
export function createStructureRuin(plot: StructurePlot, ground: number): THREE.Group {
  const group = new THREE.Group(); group.name = `War ruins ${plot.id}`;
  group.position.set(plot.worldX, ground, plot.worldZ);
  const vaporized = plot.destruction?.vaporized === true;
  const material = new THREE.MeshStandardMaterial({ color: vaporized ? '#373631' : '#726c5e', roughness: 1 });
  const scar = new THREE.Mesh(new THREE.CircleGeometry(plot.radius * (vaporized ? 1.2 : 1), 24),
    new THREE.MeshBasicMaterial({ color: '#39332c', transparent: true, opacity: vaporized ? 0.7 : 0.25, depthWrite: false }));
  scar.rotation.x = -Math.PI / 2; scar.position.y = 0.014; group.add(scar);
  if (vaporized) return group;
  const rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 28);
  rubble.name = `Collapsed building rubble ${plot.id}`; rubble.castShadow = rubble.receiveShadow = true;
  const transform = new THREE.Object3D();
  for (let i = 0; i < 28; i++) {
    const h = (suffix: string) => stableHash(`${plot.id}:${i}:${suffix}`);
    const x = (h('x') - 0.5) * plot.width * 1.15, z = (h('z') - 0.5) * plot.depth * 1.15;
    const size = 0.05 + h('size') * Math.min(0.18, plot.width * 0.1);
    const central = 1 - Math.min(1, Math.hypot(x / plot.width, z / plot.depth));
    transform.position.set(x, 0.03 + central * plot.height * 0.13 + size * 0.12, z);
    transform.rotation.set(h('pitch') * 1.3, h('yaw') * Math.PI * 2, h('roll') * 1.1);
    transform.scale.set(size * 1.7, size * 0.6, size); transform.updateMatrix(); rubble.setMatrixAt(i, transform.matrix);
  }
  group.add(rubble);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(plot.width * 0.72, plot.height * 0.2, 0.07), material);
    wall.position.set(side * plot.width * 0.1, plot.height * 0.1, side * plot.depth * 0.4);
    wall.rotation.z = side * 0.13; wall.castShadow = true; group.add(wall);
  }
  return group;
}

interface Tracked { plot: StructurePlot; shell: THREE.Object3D; ruins?: THREE.Group; baseY: number; baseScale: THREE.Vector3; baseTilt: number }
/** Holds each original shell until its recorded hit, then settles it into its own rubble. */
export class StructureDestruction {
  private readonly tracked = new Map<string, Tracked>();
  private readonly started = new Map<string, number>();
  private elapsed = NaN;

  hitOccurred(plot: StructurePlot, month: number, reducedMotion: boolean): boolean {
    const fact = plot.destruction;
    if (!fact || fact.month < month || reducedMotion) return true;
    if (!Number.isFinite(this.started.get(fact.eventId))) this.started.set(fact.eventId, this.elapsed);
    return this.elapsed - this.started.get(fact.eventId)! >= fact.impactAt;
  }

  bind(plot: StructurePlot, shell: THREE.Object3D, ruins?: THREE.Group): void {
    this.tracked.set(plot.id, { plot, shell, ruins, baseY: shell.position.y, baseScale: shell.scale.clone(), baseTilt: shell.rotation.z });
    const fact = plot.destruction;
    if (fact && !this.started.has(fact.eventId)) this.started.set(fact.eventId, this.elapsed);
  }
  update(elapsed: number, month: number, reducedMotion: boolean): void {
    this.elapsed = elapsed;
    for (const [id, item] of this.tracked) {
      if (!item.shell.parent?.parent) { this.tracked.delete(id); continue; }
      const { plot, shell, ruins } = item, fact = plot.destruction;
      if (!fact) continue;
      if (!Number.isFinite(this.started.get(fact.eventId))) this.started.set(fact.eventId, elapsed);
      const age = reducedMotion || fact.month < month ? Infinity : elapsed - (this.started.get(fact.eventId) ?? elapsed) - fact.impactAt;
      const collapse = THREE.MathUtils.clamp(age / (fact.vaporized ? 0.24 : 1.1), 0, 1);
      const ease = collapse * collapse * (3 - 2 * collapse);
      shell.visible = plot.condition > 0 || collapse < 1;
      if (ruins) ruins.visible = age >= 0;
      const before = fact.beforeCondition;
      const condition = THREE.MathUtils.lerp(before, plot.condition, ease);
      shell.scale.copy(item.baseScale);
      shell.scale.y *= fact.vaporized ? 1 - ease : 0.12 + condition * 0.88;
      if (fact.vaporized) { shell.scale.x *= 1 - ease; shell.scale.z *= 1 - ease; }
      shell.rotation.z = item.baseTilt + (1 - condition) * 0.12;
      shell.position.y = item.baseY;
    }
    if (this.started.size > 256) {
      const active = new Set([...this.tracked.values()].map(t => t.plot.destruction?.eventId));
      for (const key of this.started.keys()) if (!active.has(key)) this.started.delete(key);
    }
  }
}
