import * as THREE from 'three';
import type { SimulationState } from '../../sim/types';
import type { EnergyPlant, PowerLine } from '../../sim/energy/types';
import { generatorDefinition } from '../../sim/energy/Generation';

/** Presentation reads dispatch; animation never creates fuel, generation or connectivity. */
export class EnergyRenderer {
  readonly group = new THREE.Group();
  private signature = '';
  private machines: { plant: EnergyPlant; rotor?: THREE.Group; piston?: THREE.Mesh; plume?: THREE.Group; lamp: THREE.Mesh }[] = [];
  private readonly metal = new THREE.MeshStandardMaterial({ color: '#627078', metalness: 0.65, roughness: 0.4 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: '#725038', roughness: 0.95 });
  private readonly concrete = new THREE.MeshStandardMaterial({ color: '#b8b5a3', roughness: 0.9 });
  private readonly panel = new THREE.MeshStandardMaterial({ color: '#123756', metalness: 0.55, roughness: 0.25 });
  private readonly wire = new THREE.LineBasicMaterial({ color: '#303a40' });
  private readonly steam = new THREE.MeshBasicMaterial({ color: '#e5e6df', transparent: true, opacity: 0.22, depthWrite: false });
  private readonly smoke = new THREE.MeshBasicMaterial({ color: '#57544d', transparent: true, opacity: 0.25, depthWrite: false });
  private box(group: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); group.add(mesh); return mesh;
  }
  private cylinder(group: THREE.Group, x: number, y: number, z: number, top: number, bottom: number, h: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 12), material); mesh.position.set(x, y, z); group.add(mesh); return mesh;
  }
  update(state: SimulationState, elapsed: number, height: (x: number, z: number) => number): void {
    const signature = `${state.month}:${state.settlements.length}:${state.energy?.lines.length ?? 0}`;
    if (signature !== this.signature) { this.signature = signature; this.rebuild(state, height); }
    for (const machine of this.machines) {
      const running = machine.plant.status === 'running', factor = machine.plant.output / generatorDefinition(machine.plant.kind).capacity;
      if (machine.rotor) machine.rotor.rotation.z = elapsed * Math.min(3, factor * 6) * Number(running);
      if (machine.piston) machine.piston.position.x = running ? Math.sin(elapsed * 4) * 0.18 : 0;
      if (machine.plume) {
        machine.plume.visible = running;
        machine.plume.children.forEach((puff, i) => { const phase = (elapsed * 0.3 + i / 5) % 1; puff.position.y = phase * 1.6; puff.position.x = phase * 0.4; puff.scale.setScalar(0.25 + phase * 0.5); });
      }
      const material = machine.lamp.material as THREE.MeshStandardMaterial;
      material.emissive.set(running ? '#ffbf59' : machine.plant.status === 'failed' ? '#a12014' : '#111111');
      material.emissiveIntensity = running ? 1.5 : 0.2;
    }
  }
  private clear(): void {
    this.group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose(); });
    for (const machine of this.machines) (machine.lamp.material as THREE.Material).dispose();
    this.group.clear(); this.machines = [];
  }
  private rebuild(state: SimulationState, height: (x: number, z: number) => number): void {
    this.clear();
    for (const s of state.settlements.filter(s => s.alive)) {
      for (const plant of s.energy?.plants ?? []) {
        const plot = s.structurePlots?.find(p => p.id === plant.plotId);
        if (!plot || plot.development?.status !== 'active') continue;
        const root = new THREE.Group();
        const scale = Math.min(1, Math.max(0.25, plot.radius / 2));
        // An equipment annex occupies the edge of the existing validated industrial footprint.
        const x = plot.worldX + plot.radius * 0.6, z = plot.worldZ;
        root.position.set(x, height(x, z), z); root.scale.setScalar(scale); this.group.add(root);
        const base = Math.max(0.05, plant.progress);
        this.box(root, 0, 0.1, 0, 1.3, 0.2, 1, this.concrete);
        const lamp = this.box(root, 0.5, 0.4, 0.5, 0.1, 0.12, 0.1, new THREE.MeshStandardMaterial({ color: '#e4b26b' }));
        const machine: typeof this.machines[number] = { plant, lamp };
        this.machines.push(machine);
        if (plant.progress < 1) { this.box(root, 0, base * 0.6, 0, 1, base, 0.7, this.wood); continue; }
        if (['wind', 'windmill', 'waterwheel', 'animal'].includes(plant.kind)) {
          const tall = plant.kind === 'wind' ? 4.2 : plant.kind === 'windmill' ? 2.5 : 0.7;
          this.cylinder(root, 0, tall / 2, 0, 0.07, plant.kind === 'windmill' ? 0.5 : 0.12, tall, plant.kind === 'wind' ? this.concrete : this.wood);
          const rotor = new THREE.Group(); rotor.position.set(0, tall, 0.25); root.add(rotor); machine.rotor = rotor;
          const blades = plant.kind === 'wind' ? 3 : plant.kind === 'waterwheel' ? 10 : 4;
          const radius = plant.kind === 'wind' ? 1.25 : plant.kind === 'windmill' ? 0.95 : 0.6;
          for (let i = 0; i < blades; i++) { const arm = new THREE.Group(); arm.rotation.z = i * Math.PI * 2 / blades; rotor.add(arm); this.box(arm, 0, radius * 0.5, 0, plant.kind === 'waterwheel' ? 0.2 : 0.1, radius, 0.08, plant.kind === 'wind' ? this.concrete : this.wood); }
          if (plant.kind === 'waterwheel') { const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 5, 20), this.wood); rotor.add(ring); }
        } else if (plant.kind === 'solar') {
          for (let i = 0; i < 3; i++) { const panel = this.box(root, (i - 1) * 0.42, 0.55, 0, 0.38, 0.05, 0.9, this.panel); panel.rotation.x = -0.45; this.box(root, (i - 1) * 0.42, 0.25, 0, 0.05, 0.5, 0.05, this.metal); }
        } else if (plant.kind === 'hydro') {
          this.box(root, 0, 0.65, 0, 1.7, 1.3, 0.5, this.concrete);
          for (let i = -1; i <= 1; i++) this.box(root, i * 0.45, 0.4, 0.3, 0.2, 0.65, 0.16, this.panel);
        } else if (plant.kind === 'nuclear') {
          this.cylinder(root, -0.35, 0.65, 0, 0.35, 0.35, 1.3, this.concrete);
          const dome = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), this.concrete); dome.position.set(-0.35, 1.3, 0); root.add(dome);
          const points = [new THREE.Vector2(0.45, 0), new THREE.Vector2(0.3, 0.7), new THREE.Vector2(0.22, 1.2), new THREE.Vector2(0.32, 1.7)];
          const tower = new THREE.Mesh(new THREE.LatheGeometry(points, 16), this.concrete); tower.position.x = 0.65; root.add(tower);
          machine.plume = this.plume(root, 0.65, 1.7, true);
        } else {
          this.cylinder(root, 0, 0.6, 0, 0.4, 0.4, 0.9, this.metal);
          this.cylinder(root, 0.45, 1.1, -0.2, 0.1, 0.16, 2.2, this.concrete);
          machine.plume = this.plume(root, 0.45, 2.2, plant.kind === 'steam');
          machine.piston = this.box(root, 0, 0.4, 0.5, 0.5, 0.12, 0.12, this.metal);
        }
      }
      if ((s.energy?.storageCapacity ?? 0) > 0) {
        const box = new THREE.Group(); box.position.set(s.position.x, height(s.position.x, s.position.z), s.position.z); this.group.add(box);
        this.box(box, -0.4, 0.25, 0, 0.45, 0.5, 0.35, this.panel);
      }
    }
    for (const line of state.energy?.lines ?? []) this.drawLine(line, height);
  }
  private plume(root: THREE.Group, x: number, y: number, steam: boolean): THREE.Group {
    const plume = new THREE.Group(); plume.position.set(x, y, 0); root.add(plume);
    for (let i = 0; i < 5; i++) plume.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), steam ? this.steam : this.smoke));
    return plume;
  }
  private drawLine(line: PowerLine, height: (x: number, z: number) => number): void {
    const count = Math.floor(line.points.length * line.progress);
    const points = line.points.slice(0, count), regional = line.capacity > 80;
    const poleHeight = regional ? 3.5 : 1.8;
    for (const p of points) {
      const root = new THREE.Group(); root.position.set(p.x, height(p.x, p.z), p.z); this.group.add(root);
      this.box(root, 0, poleHeight / 2, 0, regional ? 0.14 : 0.07, poleHeight, regional ? 0.14 : 0.07, regional ? this.metal : this.wood);
      this.box(root, 0, poleHeight, 0, 0.55, 0.07, 0.07, this.metal);
      if (regional) for (const side of [-1, 1]) { const leg = this.box(root, side * 0.2, poleHeight / 2, 0, 0.06, poleHeight, 0.06, this.metal); leg.rotation.z = side * 0.12; }
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      for (const offset of [-0.22, 0.22]) {
        const vertices: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const y = Math.max(height(x, z) + 0.7, height(a.x, a.z) * (1 - t) + height(b.x, b.z) * t + poleHeight - Math.sin(t * Math.PI) * 0.25);
          vertices.push(new THREE.Vector3(x + offset, y, z)); }
        if (line.condition > 0.25) this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), this.wire));
      }
    }
    if (points.length && line.progress >= 1) {
      const p = points[points.length - 1]!, root = new THREE.Group(); root.position.set(p.x, height(p.x, p.z), p.z); this.group.add(root);
      this.box(root, 0.35, 0.25, 0, 0.35, 0.5, 0.3, this.metal);
      for (let i = 0; i < 3; i++) this.cylinder(root, 0.25 + i * 0.1, 0.58, 0, 0.025, 0.035, 0.15, this.concrete);
    }
  }
  dispose(): void { this.clear(); [this.metal, this.wood, this.concrete, this.panel, this.wire, this.steam, this.smoke].forEach(m => m.dispose()); }
}
