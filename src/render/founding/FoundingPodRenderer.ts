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
  runeCore: THREE.MeshBasicMaterial;
  runeHalo: THREE.MeshBasicMaterial;
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
  private readonly projectionView = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly effectSphere = new THREE.Sphere();
  private readonly trailTail = new THREE.Vector3();
  private readonly hullMaterial = new THREE.MeshStandardMaterial({
    color: '#805b32', roughness: 0.38, metalness: 0.78,
  });
  private readonly shieldMaterial = new THREE.MeshStandardMaterial({
    color: '#2e2820', roughness: 0.56, metalness: 0.62,
  });
  private readonly collarMaterial = new THREE.MeshStandardMaterial({
    color: '#b07a3f', roughness: 0.3, metalness: 0.84,
  });
  private readonly hullGeometry = new THREE.CylinderGeometry(0.48, 0.92, 1.65, 10);
  private readonly shieldGeometry = new THREE.CylinderGeometry(0.95, 0.69, 0.3, 10);
  private readonly legGeometry = new THREE.CylinderGeometry(0.045, 0.08, 0.9, 5);
  private readonly footGeometry = new THREE.BoxGeometry(0.35, 0.09, 0.32);
  private readonly bandGeometry = new THREE.TorusGeometry(0.73, 0.028, 5, 20);
  private readonly hatchGeometry = new THREE.BoxGeometry(0.43, 0.72, 0.07);
  private readonly runeStrokeGeometry = new THREE.BoxGeometry(0.032, 0.24, 0.018);

  constructor(private readonly state: SimulationState) {
    this.root.name = 'founding-vessels';
    for (const pod of state.arrival?.pods ?? []) this.visuals.push(this.create(pod));
  }

  private create(pod: FoundingPod): PodVisual {
    const hull = new THREE.Group();
    hull.name = pod.id;
    hull.userData['podId'] = pod.id;
    hull.userData['siteColor'] = pod.color;
    hull.userData['foundingProfile'] = pod.name;
    const shell = new THREE.Mesh(this.hullGeometry, this.hullMaterial);
    shell.name = 'bronze-hull';
    shell.castShadow = true;
    const shield = new THREE.Mesh(this.shieldGeometry, this.shieldMaterial);
    shield.position.y = -0.88;
    hull.add(shell, shield);
    const light = new THREE.MeshBasicMaterial({ color: pod.color, transparent: true, opacity: 0.8 });
    const band = new THREE.Mesh(this.bandGeometry, light);
    band.name = 'site-light-band';
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.15;
    hull.add(band);

    // Bright bronze collars catch the light like worked ceremonial metal instead of a modern
    // painted seam. Their slightly different radii follow the tapered shell.
    for (const [y, scale] of [[0.55, 0.78], [-0.56, 1.12]] as const) {
      const collar = new THREE.Mesh(this.bandGeometry, this.collarMaterial);
      collar.name = 'bronze-collar';
      collar.rotation.x = Math.PI / 2;
      collar.position.y = y;
      collar.scale.setScalar(scale);
      hull.add(collar);
    }

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.49, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.hullMaterial);
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
    door.name = 'dark-bronze-hatch';
    door.position.y = 0.36;
    hatch.add(door);
    hull.add(hatch);

    const { core: runeCore, halo: runeHalo } = this.addRunes(hull, hatch, pod);

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
    return { pod, hull, hatch, light, runeCore, runeHalo, trails, dust };
  }

  /**
   * Build sparse, hand-cut-looking sigils from a tiny shared stroke geometry. The runes sit just
   * proud of the shell, so they read from cinematic distance without textures or runtime draws.
   * Each founding profile owns only two lightweight materials: a crisp colored inlay and a larger
   * additive echo that suggests a soft supernatural glow even when post-processing bloom is off.
   */
  private addRunes(hull: THREE.Group, hatch: THREE.Group, pod: FoundingPod): {
    core: THREE.MeshBasicMaterial;
    halo: THREE.MeshBasicMaterial;
  } {
    const core = new THREE.MeshBasicMaterial({
      color: pod.color, transparent: true, opacity: 0.68, depthWrite: false,
    });
    const halo = new THREE.MeshBasicMaterial({
      color: pod.color, transparent: true, opacity: 0.11, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const runes = new THREE.Group();
    runes.name = 'ancient-runes';

    const addStroke = (
      parent: THREE.Object3D, x: number, y: number, rotation: number, length: number, outward = 0,
    ): void => {
      const glow = new THREE.Mesh(this.runeStrokeGeometry, halo);
      glow.name = 'founding-rune-halo';
      glow.position.set(x, y, 0.018 + outward);
      glow.rotation.z = rotation;
      glow.scale.set(1.75, length * 1.08, 1);
      parent.add(glow);

      const stroke = new THREE.Mesh(this.runeStrokeGeometry, core);
      stroke.name = 'founding-rune-core';
      stroke.position.set(x, y, 0.028 + outward);
      stroke.rotation.z = rotation;
      stroke.scale.y = length;
      parent.add(stroke);
    };

    // Four deliberately simple rune grammars repeat around the decagonal shell. Repetition makes
    // them feel like one old written system while the site color makes each vessel culturally legible.
    for (let face = 0; face < 10; face++) {
      const angle = face * Math.PI * 2 / 10;
      const y = -0.32 + (face % 3) * 0.29;
      const taper = THREE.MathUtils.clamp((y + 0.825) / 1.65, 0, 1);
      const radius = THREE.MathUtils.lerp(0.92, 0.48, taper) + 0.025;
      const glyph = new THREE.Group();
      glyph.name = `rune-${face + 1}`;
      glyph.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      glyph.rotation.y = Math.PI / 2 - angle;

      switch (face % 4) {
        case 0:
          addStroke(glyph, 0, 0, 0, 0.9);
          addStroke(glyph, -0.05, 0.02, Math.PI / 3.2, 0.58);
          addStroke(glyph, 0.05, -0.04, -Math.PI / 3.2, 0.52);
          break;
        case 1:
          addStroke(glyph, -0.045, 0, 0, 0.78);
          addStroke(glyph, 0.045, 0, 0, 0.78);
          addStroke(glyph, 0, 0.015, Math.PI / 2, 0.55);
          break;
        case 2:
          addStroke(glyph, 0, 0, Math.PI / 4, 0.86);
          addStroke(glyph, 0, 0, -Math.PI / 4, 0.86);
          addStroke(glyph, 0, -0.065, Math.PI / 2, 0.48);
          break;
        default:
          addStroke(glyph, 0, 0, 0, 0.82);
          addStroke(glyph, -0.055, 0.045, -Math.PI / 4, 0.55);
          addStroke(glyph, 0.055, -0.045, -Math.PI / 4, 0.55);
          break;
      }
      runes.add(glyph);
    }

    // The hatch carries one larger threshold sigil. It remains readable after touchdown when the
    // door opens and the shell runes become partially hidden by people and camp clutter.
    const hatchSigil = new THREE.Group();
    hatchSigil.name = 'hatch-sigil';
    hatchSigil.position.set(0, 0.37, -0.045);
    hatchSigil.rotation.y = Math.PI;
    addStroke(hatchSigil, 0, 0, 0, 0.86, 0.004);
    addStroke(hatchSigil, -0.055, 0.02, Math.PI / 3, 0.58, 0.004);
    addStroke(hatchSigil, 0.055, 0.02, -Math.PI / 3, 0.58, 0.004);
    hatch.add(hatchSigil);
    hull.add(runes);
    return { core, halo };
  }

  update(camera: THREE.Camera): void {
    const arrival = this.state.arrival;
    if (!arrival || this.effectsRetired) return;
    camera.updateMatrixWorld();
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);
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
      const runePulse = 0.5 + Math.sin(t * 0.72 + v.pod.entrySeconds * 0.41) * 0.5;
      v.runeCore.opacity = (age < 0 ? 0.66 : 0.48) + runePulse * 0.12;
      v.runeHalo.opacity = (age < 0 ? 0.11 : 0.07) + runePulse * 0.045;
      const headTime = Math.min(t, podTouchdown(v.pod));
      const tailTime = Math.max(v.pod.entrySeconds, headTime - 5.5);
      const tail = podPosition(v.pod, tailTime);
      this.trailTail.set(tail.x, tail.y, tail.z);
      this.effectSphere.center.copy(v.hull.position).add(this.trailTail).multiplyScalar(0.5);
      this.effectSphere.radius = v.hull.position.distanceTo(this.trailTail) * 0.5 + 2.5;
      const trailInView = this.frustum.intersectsSphere(this.effectSphere);
      for (let layer = 0; layer < v.trails.length; layer++) {
        const trail = v.trails[layer]!;
        trail.visible = t >= v.pod.entrySeconds && age < 4.5 && trailInView;
        if (!trail.visible) continue;
        trail.material.opacity = (layer ? 0.13 : 0.9) * (1 - THREE.MathUtils.smoothstep(age, 0, 4.5));
        const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
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
      this.effectSphere.center.set(v.pod.position.x, v.pod.groundY + 1.4, v.pod.position.z);
      this.effectSphere.radius = 7;
      const dustInView = this.frustum.intersectsSphere(this.effectSphere);
      v.dust.visible = age >= 0 && age < 6 && dustInView;
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
    for (const g of [this.hullGeometry, this.shieldGeometry, this.legGeometry, this.footGeometry, this.bandGeometry, this.hatchGeometry, this.runeStrokeGeometry]) geometries.add(g);
    materials.add(this.hullMaterial); materials.add(this.shieldMaterial); materials.add(this.collarMaterial);
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.root.removeFromParent();
    this.root.clear();
  }
}
