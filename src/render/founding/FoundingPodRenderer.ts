import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isArrivalFilmPhase, podPosition, podTouchdown, type FoundingPod } from '../../sim/founding/FoundingArrival';
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
    color: '#88714e', roughness: 0.47, metalness: 0.76, vertexColors: true,
  });
  private readonly shieldMaterial = new THREE.MeshStandardMaterial({
    color: '#293d3b', roughness: 0.86, metalness: 0.32,
  });
  private readonly collarMaterial = new THREE.MeshStandardMaterial({
    color: '#a88b55', roughness: 0.57, metalness: 0.72,
  });
  private readonly hullGeometry = this.relicShell();

  /** Flat panels with deterministic oxidation; no texture downloads or shader hooks. */
  private relicShell(): THREE.BufferGeometry {
    const geometry = new THREE.LatheGeometry([
      new THREE.Vector2(0.78, -0.85), new THREE.Vector2(0.88, -0.65),
      new THREE.Vector2(0.76, -0.38), new THREE.Vector2(0.58, 0.48),
      new THREE.Vector2(0.48, 0.72), new THREE.Vector2(0.32, 0.91),
      new THREE.Vector2(0.26, 1.02),
    ], 10).toNonIndexed();
    geometry.computeVertexNormals();
    const positions = geometry.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i += 3) {
      const weather = (Math.sin(i * 12.9898 + 17.2) * 43758.5453) % 1;
      const color = new THREE.Color(weather > 0.35 ? '#688a77' : '#c1ad88');
      color.multiplyScalar(0.7 + Math.abs(weather) * 0.3);
      for (let j = 0; j < 3; j++) colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }
  private readonly shieldGeometry = new THREE.CylinderGeometry(0.95, 0.69, 0.3, 10);
  private readonly bandGeometry = new THREE.TorusGeometry(0.73, 0.028, 5, 20);
  private readonly hatchGeometry = new THREE.BoxGeometry(0.43, 0.72, 0.07);
  private readonly runeStrokeGeometry = new THREE.BoxGeometry(0.016, 0.24, 0.012);

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

    // Merge static ornament by material: the rich silhouette costs only two extra draws.
    const bronze: THREE.BufferGeometry[] = [];
    const stone: THREE.BufferGeometry[] = [];
    const place = (geometry: THREE.BufferGeometry, bucket: THREE.BufferGeometry[],
      x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
      const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      flat.applyMatrix4(matrix); bucket.push(flat); geometry.dispose();
    };
    for (const [y, radius, thickness] of [[-0.83, 0.87, 0.055], [-0.62, 0.9, 0.045],
      [0.49, 0.59, 0.038], [0.74, 0.48, 0.035], [1.05, 0.3, 0.035]] as const) {
      place(new THREE.TorusGeometry(radius, thickness, 4, 10), bronze, 0, y, 0, Math.PI / 2);
    }
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI * 2 / 10;
      // Raised structural ribs frame the narrow inscription tablets.
      place(new THREE.BoxGeometry(0.065, 1.28, 0.08), bronze,
        Math.sin(angle) * 0.73, -0.06, Math.cos(angle) * 0.73,
        -0.23 * Math.cos(angle), angle, 0.23 * Math.sin(angle));
      place(new THREE.BoxGeometry(0.17, 0.42, 0.12), stone,
        Math.sin(angle) * 0.34, 1.1 + (i % 2) * 0.09, Math.cos(angle) * 0.34, 0, angle);
      place(new THREE.OctahedronGeometry(0.075, 0), bronze,
        Math.sin(angle) * 0.91, -0.61, Math.cos(angle) * 0.91);
      for (let mark = 0; mark < 3; mark++) {
        place(new THREE.BoxGeometry(0.022, 0.045 + mark * 0.014, 0.018), bronze,
          Math.sin(angle + (mark - 1) * 0.065) * 0.905, -0.75,
          Math.cos(angle + (mark - 1) * 0.065) * 0.905, 0, angle, 0.25);
      }
    }
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + Math.PI / 4;
      place(new THREE.BoxGeometry(0.18, 0.68, 0.25), stone,
        Math.sin(angle) * 0.88, -0.72, Math.cos(angle) * 0.88,
        -0.35 * Math.cos(angle), angle, 0.35 * Math.sin(angle));
      place(new THREE.BoxGeometry(0.31, 0.12, 0.4), bronze,
        Math.sin(angle), -1.035, Math.cos(angle), 0, angle);
    }
    for (const [parts, material, name] of [
      [bronze, this.collarMaterial, 'relic-bronze-ribs'],
      [stone, this.shieldMaterial, 'relic-crown-and-buttresses'],
    ] as const) {
      const mesh = new THREE.Mesh(mergeGeometries([...parts])!, material);
      mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
      hull.add(mesh); parts.forEach(part => part.dispose());
    }
    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.19), light);
    heart.name = 'sealed-crown-heart'; heart.position.y = 1.14; heart.scale.y = 1.45;
    hull.add(heart);
    const seal = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.023, 4, 10), this.collarMaterial);
    seal.name = 'crown-astrolabe'; seal.position.y = 1.16; seal.rotation.x = 0.35;
    hull.add(seal);
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
   * Build stacked inscriptions in dark tablets from a shared stroke geometry, then batch their
   * inlays and halos per vessel to keep cinematic detail inexpensive.
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
      const angle = (face + 0.5) * Math.PI * 2 / 10;
      const y = -0.03;
      const taper = THREE.MathUtils.clamp((y + 0.825) / 1.65, 0, 1);
      const radius = THREE.MathUtils.lerp(0.92, 0.48, taper) - 0.015;
      const glyph = new THREE.Group();
      glyph.name = `rune-${face + 1}`;
      glyph.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      glyph.rotation.y = Math.PI / 2 - angle;
      glyph.rotation.x = -0.206;
      const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.66, 0.045), this.shieldMaterial);
      tablet.name = 'recessed-inscription-tablet';
      tablet.position.z = -0.014; glyph.add(tablet);

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
      // Smaller stacked marks read as an inscription rather than isolated painted symbols.
      addStroke(glyph, 0, 0.22, Math.PI / 4, 0.32);
      addStroke(glyph, 0, 0.22, -Math.PI / 4, 0.32);
      addStroke(glyph, -0.035, -0.23, 0.5, 0.24);
      addStroke(glyph, 0.035, -0.23, -0.5, 0.24);
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
    for (const parent of [runes, hatchSigil]) {
      parent.updateMatrixWorld(true);
      const inverse = parent.matrixWorld.clone().invert();
      for (const [material, name] of [[core, 'founding-rune-core'], [halo, 'founding-rune-halo']] as const) {
        const parts: THREE.BufferGeometry[] = [];
        const strokes: THREE.Mesh[] = [];
        parent.traverse(object => {
          if (object instanceof THREE.Mesh && object.material === material) {
            parts.push(object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
            strokes.push(object);
          }
        });
        const mesh = new THREE.Mesh(mergeGeometries(parts)!, material); mesh.name = name;
        strokes.forEach(stroke => stroke.removeFromParent());
        parts.forEach(part => part.dispose()); parent.add(mesh);
      }
    }
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
    if (!isArrivalFilmPhase(arrival.phase)) this.retireEffects();
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
    for (const g of [this.hullGeometry, this.shieldGeometry, this.bandGeometry, this.hatchGeometry, this.runeStrokeGeometry]) geometries.add(g);
    materials.add(this.hullMaterial); materials.add(this.shieldMaterial); materials.add(this.collarMaterial);
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.root.removeFromParent();
    this.root.clear();
  }
}
