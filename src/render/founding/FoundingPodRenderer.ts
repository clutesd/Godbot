import * as THREE from 'three';
import { podPosition, podTouchdown, type FoundingPod } from '../../sim/founding/FoundingArrival';
import type { SimulationState } from '../../sim/types';

const TRAIL_SAMPLES = 64;
const DUST_COUNT = 56;
interface PodVisual {
  pod: FoundingPod;
  hull: THREE.Group;
  hatch: THREE.Group;
  light: THREE.MeshBasicMaterial;
  trails: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

/** Five persistent artifacts, fixed-size effect buffers, no scene allocations in update(). */
export class FoundingPodRenderer {
  readonly root = new THREE.Group();
  private readonly visuals: PodVisual[] = [];
  private effectsRetired = false;
  private readonly direction = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly hullMaterial = new THREE.MeshStandardMaterial({ color: '#aaa79b', roughness: 0.78, metalness: 0.35 });
  private readonly shieldMaterial = new THREE.MeshStandardMaterial({ color: '#302f2b', roughness: 0.95, metalness: 0.15 });
  private readonly hullGeometry = new THREE.CylinderGeometry(0.48, 0.92, 1.65, 8);
  private readonly shieldGeometry = new THREE.CylinderGeometry(0.95, 0.69, 0.3, 8);
  private readonly legGeometry = new THREE.CylinderGeometry(0.045, 0.08, 0.9, 5);
  private readonly footGeometry = new THREE.BoxGeometry(0.35, 0.09, 0.32);
  private readonly bandGeometry = new THREE.TorusGeometry(0.73, 0.028, 4, 8);
  private readonly hatchGeometry = new THREE.BoxGeometry(0.43, 0.72, 0.07);

  constructor(private readonly state: SimulationState) {
    this.root.name = 'founding-vessels';
    for (const pod of state.arrival?.pods ?? []) this.visuals.push(this.create(pod));
  }

  private create(pod: FoundingPod): PodVisual {
    const hull = new THREE.Group();
    hull.name = pod.id;
    hull.userData['podId'] = pod.id;
    const shell = new THREE.Mesh(this.hullGeometry, this.hullMaterial);
    shell.castShadow = true;
    const shield = new THREE.Mesh(this.shieldGeometry, this.shieldMaterial);
    shield.position.y = -0.88;
    hull.add(shell, shield);
    const light = new THREE.MeshBasicMaterial({ color: pod.color, transparent: true, opacity: 0.8 });
    const band = new THREE.Mesh(this.bandGeometry, light);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.15;
    hull.add(band);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.49, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), this.hullMaterial);
    cap.position.y = 0.82;
    cap.scale.y = 0.5;
    hull.add(cap);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + Math.PI / 4;
      const leg = new THREE.Mesh(this.legGeometry, this.shieldMaterial);
      leg.position.set(Math.cos(angle) * 0.8, -0.75, Math.sin(angle) * 0.8);
      leg.rotation.z = Math.cos(angle) * -0.42;
      leg.rotation.x = Math.sin(angle) * 0.42;
      const foot = new THREE.Mesh(this.footGeometry, this.shieldMaterial);
      foot.position.set(Math.cos(angle), -1.05, Math.sin(angle));
      hull.add(leg, foot);
    }
    const hatch = new THREE.Group();
    hatch.position.set(0, -0.58, -0.87);
    const door = new THREE.Mesh(this.hatchGeometry, this.shieldMaterial);
    door.position.y = 0.36;
    hatch.add(door);
    hull.add(hatch);
    const trails = [0, 1].map(layer => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 6), 3).setUsage(THREE.DynamicDrawUsage));
      const colors = new Float32Array(TRAIL_SAMPLES * 6);
      const color = new THREE.Color(pod.color);
      const indices: number[] = [];
      for (let i = 0; i < TRAIL_SAMPLES; i++) {
        const fade = (1 - i / TRAIL_SAMPLES) ** 1.5;
        for (let j = 0; j < 2; j++) color.clone().multiplyScalar(fade).toArray(colors, i * 6 + j * 3);
        if (i < TRAIL_SAMPLES - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
        opacity: layer ? 0.14 : 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.frustumCulled = false;
      return mesh;
    });
    const cell = this.state.world.cells[pod.cellIndex]!;
    const dustColor = cell.temperature < 0.2 ? '#dde3df' : cell.coast || cell.moisture > 0.7 ? '#a6b9b4' : cell.biome === 'forest' ? '#9a9870' : '#bbac8c';
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const dustMaterial = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(dustColor) }, opacity: { value: 0 } },
      vertexShader: 'void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(340./max(1.,-p.z),2.,38.);}',
      fragmentShader: 'uniform vec3 color;uniform float opacity;void main(){float d=length(gl_PointCoord-vec2(.5));gl_FragColor=vec4(color,opacity*(1.-smoothstep(.1,.5,d)));}',
      transparent: true, depthWrite: false });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    dust.frustumCulled = false;
    this.root.add(hull, ...trails, dust);
    hull.visible = false;
    return { pod, hull, hatch, light, trails, dust };
  }

  update(camera: THREE.Camera): void {
    const arrival = this.state.arrival;
    if (!arrival || this.effectsRetired) return;
    const t = arrival.elapsedSeconds;
    for (const v of this.visuals) {
      const p = podPosition(v.pod, t);
      const age = t - podTouchdown(v.pod);
      v.hull.visible = t >= v.pod.entrySeconds;
      v.hull.position.set(p.x, p.y, p.z);
      const settling = age >= 0 ? Math.exp(-age * 4) : 0;
      v.hull.rotation.z = age < 0 ? (1 - Math.min(1, (t - v.pod.entrySeconds) / v.pod.descentSeconds)) * 0.18 : Math.sin(age * 31) * settling * 0.015;
      v.hull.position.y -= settling * Math.sin(Math.max(0, age) * 16) * 0.045;
      v.hatch.rotation.x = -THREE.MathUtils.smoothstep(age, 0.8, 2.8) * 1.8;
      v.light.opacity = age < 0 ? 0.9 : Math.max(0.12, Math.exp(-age * 0.6));
      for (let layer = 0; layer < v.trails.length; layer++) {
        const trail = v.trails[layer]!;
        trail.visible = t >= v.pod.entrySeconds && age < 4.5;
        if (!trail.visible) continue;
        trail.material.opacity = (layer ? 0.13 : 0.9) * (1 - THREE.MathUtils.smoothstep(age, 0, 4.5));
        const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
        const headTime = Math.min(t, podTouchdown(v.pod));
        for (let i = 0; i < TRAIL_SAMPLES; i++) {
          const time = Math.max(v.pod.entrySeconds, headTime - i / (TRAIL_SAMPLES - 1) * 5.5);
          const a = podPosition(v.pod, time);
          const b = podPosition(v.pod, time + 0.03);
          this.direction.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
          this.eye.set(camera.position.x - a.x, camera.position.y - a.y, camera.position.z - a.z).normalize();
          this.side.crossVectors(this.direction, this.eye).normalize();
          const width = (layer ? 0.47 : 0.075) * (1 + i / TRAIL_SAMPLES * 1.6) * (0.9 + Math.sin(i * 0.7 + v.pod.entrySeconds) * 0.1);
          for (let j = 0; j < 2; j++) {
            const sign = j ? 1 : -1;
            positions.setXYZ(i * 2 + j, a.x + this.side.x * width * sign, a.y + this.side.y * width * sign, a.z + this.side.z * width * sign);
          }
        }
        positions.needsUpdate = true;
      }
      v.dust.visible = age >= 0 && age < 6;
      v.dust.material.uniforms['opacity']!.value = age < 0 ? 0 : Math.max(0, 0.35 * (1 - age / 6));
      if (v.dust.visible) {
        const positions = v.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < DUST_COUNT; i++) {
          const angle = i * 2.39996;
          const speed = 0.35 + (i % 9) * 0.08;
          const radius = 0.6 + Math.sqrt(Math.max(0, age)) * speed * 2;
          positions.setXYZ(i, v.pod.position.x + Math.cos(angle) * radius, v.pod.groundY + 0.12 + Math.sin(i * 4.7) ** 2 * Math.sqrt(age) * 0.8, v.pod.position.z + Math.sin(angle) * radius);
        }
        positions.needsUpdate = true;
      }
    }
    if (arrival.phase === 'HISTORY_RUNNING') this.retireEffects();
  }

  private retireEffects(): void {
    for (const v of this.visuals) for (const object of [...v.trails, v.dust]) {
      this.root.remove(object);
      object.geometry.dispose();
      object.material.dispose();
    }
    this.effectsRetired = true;
  }

  dispose(): void {
    if (!this.effectsRetired) this.retireEffects();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const g of [this.hullGeometry, this.shieldGeometry, this.legGeometry, this.footGeometry, this.bandGeometry, this.hatchGeometry]) geometries.add(g);
    materials.add(this.hullMaterial); materials.add(this.shieldMaterial);
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.root.removeFromParent();
    this.root.clear();
  }
}
