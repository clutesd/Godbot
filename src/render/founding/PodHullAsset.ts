import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARRIVAL_HATCH } from './ArrivalChoreography';

const TAU = Math.PI * 2;
// Measured from the front (-Z). Every waist-level component uses this same aperture.
const APERTURE = 0.59;
const SILL = ARRIVAL_HATCH.sill - 1.1;
type Finish = 'ceramic' | 'bronze' | 'dark' | 'steel' | 'interior' | 'light';
interface Part { name: string; geometry: THREE.BufferGeometry; finish: Finish; hatch: boolean }

/** A reusable manufactured vessel: smooth armor, beveled edges, recessed joints and real depth.
 * Built once for the fleet; no textures, geometry generation or new lights in the frame loop. */
export class PodHullAsset {
  readonly parts: Part[] = [];
  private readonly textures: THREE.DataTexture[] = [];
  readonly materials = {
    ceramic: new THREE.MeshStandardMaterial({ color: '#cfc5ac', metalness: 0.34, roughness: 0.56, vertexColors: true }),
    bronze: new THREE.MeshStandardMaterial({ color: '#ae8752', metalness: 0.78, roughness: 0.32 }),
    dark: new THREE.MeshStandardMaterial({ color: '#283c3e', metalness: 0.62, roughness: 0.43 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9aafa9', metalness: 0.86, roughness: 0.25 }),
    interior: new THREE.MeshStandardMaterial({ color: '#111f23', metalness: 0.25, roughness: 0.79, side: THREE.DoubleSide }),
  };

  constructor() {
    // Small, deterministic surface maps keep close-ups tactile. These are material data, not
    // scene textures or random simulation input. Repeat wrapping keeps UV seams continuous.
    for (const [finish, material] of Object.entries(this.materials)) {
      if (finish === 'interior') continue;
      const size = 128, data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const hash = ((Math.imul(x + 37, 374761393) ^ Math.imul(y + 71, 668265263)) >>> 0) % 256;
        const brushed = Math.sin(y * TAU / size * 43) * 13;
        const grain = finish === 'ceramic' ? (hash - 128) * 0.28 : brushed + (hash - 128) * 0.12;
        const value = Math.round(213 + grain);
        const offset = (y * size + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = value; data[offset + 3] = 255;
      }
      const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true; texture.repeat.set(5, 3); texture.needsUpdate = true;
      material.roughnessMap = texture; material.bumpMap = texture;
      material.bumpScale = finish === 'ceramic' ? 0.003 : 0.001;
      this.textures.push(texture);
    }
    const buckets = new Map<string, { finish: Finish; hatch: boolean; geometries: THREE.BufferGeometry[] }>();
    const add = (name: string, finish: Finish, geometry: THREE.BufferGeometry,
      x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, hatch = false): void => {
      const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      geometry.dispose();
      flat.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1)));
      // Surface-level discoloration follows height and panel position, never random triangles.
      if (finish === 'ceramic') {
        const p = flat.getAttribute('position');
        const colors = new Float32Array(p.count * 3);
        const clean = new THREE.Color('#ffffff'), patina = new THREE.Color('#718a79');
        const color = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
          const angle = Math.atan2(p.getX(i), p.getZ(i));
          const weather = Math.max(0, -p.getY(i) - 0.2) * 0.34;
          color.copy(clean).lerp(patina, weather + 0.04 * (1 + Math.cos(angle * 7)));
          color.toArray(colors, i * 3);
        }
        flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      const retained = ['bronze-hull', 'site-light-band', 'hatch-pressure-frame', 'hatch-guide-light',
        'open-hatch-interior', 'hatch-non-slip-treads', 'dark-bronze-hatch', 'sealed-crown-heart'];
      const batch = retained.includes(name) ? name : `${hatch ? 'hatch' : 'vessel'}-${finish}-details`;
      const bucket = buckets.get(batch) ?? { finish, hatch, geometries: [] };
      bucket.geometries.push(flat); buckets.set(batch, bucket);
    };
    const lathe = (profile: number[][], start = 0, length = TAU, segments = 96): THREE.BufferGeometry =>
      new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r!, y!)), segments, start, length);
    const ring = (name: string, finish: Finish, y: number, r: number, width: number, open = false): void => {
      // Closed cross-section gives the cut ends real thickness without any spanning front bar.
      add(name, finish, lathe([[r - 0.018, y - width / 2], [r, y - width / 2],
        [r + 0.008, y - width / 2 + 0.007], [r + 0.008, y + width / 2 - 0.007],
        [r, y + width / 2], [r - 0.018, y + width / 2], [r - 0.018, y - width / 2]],
      open ? Math.PI + APERTURE : 0, open ? TAU - APERTURE * 2 : TAU));
    };
    const box = (w: number, h: number, d: number, bevel = 0.012): THREE.BufferGeometry =>
      new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w / 3, h / 3, d / 3));
    const rod = (name: string, finish: Finish, a: THREE.Vector3, b: THREE.Vector3, radius: number): void => {
      const direction = b.clone().sub(a);
      const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 12);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      add(name, finish, geometry, mid.x, mid.y, mid.z);
    };

    // Twelve individually edged armor petals sit over a dark pressure vessel. Profile samples
    // preserve smooth highlights along the taper while gaps give the plates actual depth.
    const lower = [[0.865, -0.735], [0.884, -0.7], [0.879, -0.64], [0.818, -0.46],
      [0.743, -0.2], [0.676, 0.06], [0.642, 0.22]];
    const upper = [[0.641, 0.235], [0.608, 0.38], [0.555, 0.56], [0.474, 0.74],
      [0.366, 0.9], [0.285, 0.98], [0.272, 1.015]];
    for (let i = 0; i < 12; i++) {
      const start = i * TAU / 12 + 0.012;
      const end = (i + 1) * TAU / 12 - 0.012;
      const frontLeft = Math.PI - APERTURE, frontRight = Math.PI + APERTURE;
      const intervals = end <= frontLeft || start >= frontRight ? [[start, end]]
        : [[start, Math.min(end, frontLeft)], [Math.max(start, frontRight), end]];
      for (const [a, b] of intervals) if (b! > a!) add('bronze-hull', 'ceramic', lathe(lower, a!, b! - a!, 10));
      add('bronze-hull', 'ceramic', lathe(upper, start, end - start, 10));
      // Narrow inset spines repeat down the crown, stopping above the door lintel.
      add('relic-bronze-ribs', 'bronze', lathe(upper.map(([r, y]) => [r! + 0.007, y!]),
        start - 0.016, 0.008, 2));
    }
    add('pressure-vessel', 'dark', lathe(lower.map(([r, y]) => [r! - 0.014, y!]),
      Math.PI + APERTURE, TAU - APERTURE * 2));
    add('pressure-vessel', 'dark', lathe(upper.map(([r, y]) => [r! - 0.014, y!])));

    // Armor edge rolls and recessed belt: the lower two belts are physically interrupted at the door.
    ring('relic-bronze-ribs', 'bronze', -0.71, 0.884, 0.035, true);
    ring('relic-bronze-ribs', 'bronze', -0.48, 0.839, 0.032, true);
    ring('belt-recess', 'dark', -0.14, 0.742, 0.055, true);
    ring('site-light-band', 'light', -0.14, 0.75, 0.015, true);
    ring('relic-bronze-ribs', 'bronze', 0.243, 0.65, 0.027);
    ring('relic-bronze-ribs', 'bronze', 0.75, 0.483, 0.029);

    // Stacked heat shield remains entirely below the walking surface.
    add('ablative-heat-shield', 'dark', lathe([[0, -0.99], [0.66, -0.99], [0.82, -0.95],
      [0.906, -0.86], [0.913, -0.8], [0.89, -0.77], [0, -0.77]]));
    for (const y of [-0.91, -0.86, -0.805]) ring('heat-shield-machining', 'bronze', y, 0.87 + (y + 0.91) * 0.36, 0.016);
    for (let i = 0; i < 48; i++) {
      const a = i * TAU / 48;
      add('heat-shield-fasteners', 'steel', new THREE.CylinderGeometry(0.012, 0.012, 0.011, 6),
        Math.sin(a) * 0.904, -0.821, Math.cos(a) * 0.904, Math.PI / 2, a);
    }

    // Four articulated outriggers with piston sleeves, polished shafts and broad beveled feet.
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + i * Math.PI / 2;
      const radial = (r: number, y: number): THREE.Vector3 => new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r);
      const anchor = radial(0.8, -0.48), knee = radial(1.0, -0.81), foot = radial(1.1, -1.025);
      rod('landing-strut-castings', 'dark', anchor, knee, 0.061);
      rod('landing-piston-shafts', 'steel', knee, foot, 0.032);
      rod('landing-tie-rods', 'bronze', radial(0.83, -0.89), foot, 0.018);
      add('landing-strut-castings', 'dark', box(0.31, 0.065, 0.39, 0.022), foot.x, -1.066, foot.z, 0, angle);
      add('landing-foot-insets', 'bronze', box(0.24, 0.012, 0.29), foot.x, -1.026, foot.z, 0, angle);
      for (const p of [anchor, knee]) {
        add('landing-piston-shafts', 'steel', new THREE.CylinderGeometry(0.075, 0.075, 0.125, 20), p.x, p.y, p.z, 0, angle, Math.PI / 2);
      }
    }

    // An enclosed crown, concentric machining and inset radial cooling flutes.
    add('relic-crown-and-buttresses', 'dark', lathe([[0, 0.99], [0.29, 0.99], [0.315, 1.025],
      [0.315, 1.07], [0.27, 1.12], [0.19, 1.155], [0, 1.155]]));
    ring('crown-astrolabe', 'bronze', 1.06, 0.316, 0.025);
    ring('crown-astrolabe', 'bronze', 1.136, 0.227, 0.018);
    add('sealed-crown-heart', 'light', new THREE.SphereGeometry(0.13, 32, 16), 0, 1.124, 0);
    for (let i = 0; i < 24; i++) {
      const a = i * TAU / 24;
      add('crown-flutes', 'bronze', box(0.014, 0.038, 0.071, 0.004), Math.sin(a) * 0.27, 1.095, Math.cos(a) * 0.27, 0, a);
    }

    // A pressure portal with depth, chamfered cheeks and a lintel ABOVE standing head height.
    // No backing card in the egress path: the chamber ends well behind the emerging founders.
    for (const side of [-1, 1]) {
      // Flared reveals join the circular armor cut to the straight pressure seal. Without these
      // the lower armor would leave daylight gaps beside an otherwise sealed, closed hatch.
      const positions: number[] = [], uv: number[] = [], indices: number[] = [];
      for (const [i, [r, y]] of lower.entries()) {
        positions.push(side * r! * Math.sin(APERTURE), y!, -r! * Math.cos(APERTURE), side * 0.398, y!, -0.827);
        uv.push(0, i / (lower.length - 1), 1, i / (lower.length - 1));
        if (i > 0) {
          const n = i * 2;
          if (side > 0) indices.push(n - 2, n - 1, n, n - 1, n + 1, n);
          else indices.push(n - 2, n, n - 1, n - 1, n, n + 1);
        }
      }
      const reveal = new THREE.BufferGeometry();
      reveal.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      reveal.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      reveal.setIndex(indices); reveal.computeVertexNormals();
      add('portal-armor-reveals', 'bronze', reveal);
      add('hatch-pressure-frame', 'bronze', box(0.067, 0.95, 0.20), side * 0.367, -0.255, -0.73);
      add('hatch-seal', 'dark', box(0.027, 0.925, 0.12, 0.007), side * 0.322, -0.265, -0.752);
      add('hatch-guide-light', 'light', box(0.01, 0.72, 0.012, 0.003), side * 0.34, -0.25, -0.839);
      add('portal-cheeks', 'dark', box(0.032, 0.88, 0.29), side * 0.326, -0.28, -0.585);
      for (const y of [-0.6, 0.08]) add('portal-fasteners', 'steel', new THREE.CylinderGeometry(0.019, 0.019, 0.018, 8),
        side * 0.368, y, -0.84, Math.PI / 2);
    }
    add('hatch-pressure-frame', 'bronze', box(0.79, 0.073, 0.20), 0, 0.225, -0.73);
    add('portal-cheeks', 'dark', box(0.65, 0.06, 0.28), 0, 0.173, -0.58);
    add('open-hatch-interior', 'interior', box(0.65, 0.88, 0.035), 0, -0.285, 0.05);
    add('interior-deck', 'dark', box(0.64, 0.045, 0.94), 0, SILL - 0.028, -0.4);
    for (const side of [-1, 1]) {
      add('interior-liners', 'interior', box(0.025, 0.88, 0.8), side * 0.3, -0.285, -0.34);
      for (let j = 0; j < 4; j++) add('interior-ribs', 'bronze', box(0.024, 0.75, 0.022, 0.006),
        side * 0.279, -0.29, -0.55 + j * 0.17);
    }

    // Ramp top is local Z=0: rotating the hatch puts this exact plane under the choreographed feet.
    add('dark-bronze-hatch', 'dark', box(0.64, ARRIVAL_HATCH.length, 0.055), 0, ARRIVAL_HATCH.length / 2, -0.035, 0, 0, 0, true);
    add('hatch-exterior-armor', 'ceramic', box(0.55, 0.76, 0.023), 0, 0.45, -0.071, 0, 0, 0, true);
    for (const side of [-1, 1]) {
      add('hatch-edge-rails', 'bronze', box(0.026, 0.87, 0.034), side * 0.299, 0.45, -0.013, 0, 0, 0, true);
      add('hatch-hinge-knuckles', 'steel', new THREE.CylinderGeometry(0.045, 0.045, 0.115, 24), side * 0.26, 0, -0.031, 0, 0, Math.PI / 2, true);
    }
    for (let i = 0; i < 12; i++) add('hatch-non-slip-treads', 'bronze', box(0.53, 0.018, 0.008, 0.002),
      0, 0.05 + i * 0.072, -0.002, 0, 0, 0, true);

    for (const [name, bucket] of buckets) {
      const geometry = mergeGeometries(bucket.geometries)!;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      this.parts.push({ name, geometry, finish: bucket.finish, hatch: bucket.hatch });
      bucket.geometries.forEach(part => part.dispose());
    }
  }

  instantiate(hull: THREE.Group, hatch: THREE.Group, light: THREE.Material): void {
    for (const part of this.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.finish === 'light' ? light : this.materials[part.finish]);
      mesh.name = part.name;
      mesh.castShadow = part.finish !== 'light'; mesh.receiveShadow = part.finish !== 'light';
      (part.hatch ? hatch : hull).add(mesh);
    }
  }

  dispose(): void {
    this.parts.forEach(part => part.geometry.dispose());
    Object.values(this.materials).forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
  }
}
