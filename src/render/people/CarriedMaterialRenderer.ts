import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type CarriedShape = 'basket' | 'bag' | 'ledger' | 'timber' | 'masonry' | 'metal' | 'ceramic' | 'crop';
export function carriedShape(id: string): CarriedShape {
  if (/timber|wood|log/.test(id)) return 'timber';
  if (/stone|masonry|ore|coal/.test(id)) return 'masonry';
  if (/metal|iron|copper|steel|tin/.test(id)) return 'metal';
  if (/ceramic|pottery|clay/.test(id)) return 'ceramic';
  if (/crop|grain|fiber|herb|flora/.test(id)) return 'crop';
  if (id === 'ledger' || id === 'basket') return id;
  return 'bag';
}

/** Small, reusable silhouettes in person-local metres, centered between the hands. */
export function carriedGeometry(kind: CarriedShape): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, colour: string, x = 0, y = 0, z = 0) => {
    const p = g.index ? g.toNonIndexed() : g;
    if (p !== g) g.dispose();
    p.translate(x, y, z);
    const c = new THREE.Color(colour);
    const colors = new Float32Array(p.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    p.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(p);
  };
  const band = (radius: number, tube: number, y: number) => add(new THREE.TorusGeometry(radius, tube, 4, 12).rotateX(Math.PI / 2), '#b9a178', 0, y);
  if (kind === 'timber' || kind === 'crop') {
    for (let i = 0; i < 3; i++) {
      const r = kind === 'timber' ? 0.047 : 0.035;
      add(new THREE.CylinderGeometry(r * 0.8, r, kind === 'timber' ? 0.65 : 0.38, 7).rotateZ(Math.PI / 2), kind === 'timber' ? '#906742' : '#c9b565', 0, i === 2 ? 0.055 : -0.018, i === 2 ? 0 : (i - 0.5) * 0.09);
    }
    for (const x of [-0.12, 0.12]) add(new THREE.TorusGeometry(0.085, 0.009, 4, 8).rotateY(Math.PI / 2), '#c3ad82', x);
  } else if (kind === 'masonry') {
    for (let i = 0; i < 3; i++) add(new THREE.DodecahedronGeometry(0.1).scale(1, 0.75, 0.8).rotateY(i * 1.7), i === 1 ? '#9b978b' : '#817f76', (i - 1) * 0.095, i === 1 ? 0.045 : 0);
  } else if (kind === 'metal') {
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.43, 0.045, 0.055), '#8b969b', 0, i === 2 ? 0.04 : 0, i === 2 ? 0 : (i - 0.5) * 0.075);
  } else if (kind === 'ceramic') {
    add(new THREE.LatheGeometry([new THREE.Vector2(0.055, -0.11), new THREE.Vector2(0.1, -0.06), new THREE.Vector2(0.105, 0.025), new THREE.Vector2(0.06, 0.08), new THREE.Vector2(0.055, 0.12), new THREE.Vector2(0.042, 0.12), new THREE.Vector2(0.044, 0.07)], 10), '#b87c52');
  } else if (kind === 'basket') {
    add(new THREE.CylinderGeometry(0.13, 0.09, 0.18, 10, 1, true), '#a88650');
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 10), '#80653e', 0, -0.085);
    for (const y of [-0.065, 0, 0.085]) band(y === 0.085 ? 0.13 : y === 0 ? 0.11 : 0.096, 0.009, y);
    add(new THREE.TorusGeometry(0.115, 0.012, 4, 12, Math.PI), '#c3a36a', 0, 0.085);
  } else if (kind === 'ledger') {
    add(new THREE.BoxGeometry(0.18, 0.045, 0.14), '#795538');
    add(new THREE.BoxGeometry(0.165, 0.025, 0.142), '#d6c69c');
  } else {
    add(new THREE.SphereGeometry(0.12, 8, 6).scale(0.9, 1.15, 0.8), '#b6a17a');
    add(new THREE.CylinderGeometry(0.038, 0.025, 0.06, 7), '#b6a17a', 0, 0.13);
    band(0.028, 0.009, 0.11);
  }
  const merged = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return merged;
}

export class CarriedMaterialRenderer {
  readonly group = new THREE.Group();
  private readonly pools = new Map<CarriedShape, THREE.InstancedMesh>();
  private readonly marker = new THREE.Object3D();
  constructor(private readonly capacity: number) {
    for (const kind of ['basket', 'bag', 'ledger', 'timber', 'masonry', 'metal', 'ceramic', 'crop'] as const) {
      const mesh = new THREE.InstancedMesh(carriedGeometry(kind), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'metal' ? 0.45 : 0.94, metalness: kind === 'metal' ? 0.5 : 0 }), capacity);
      mesh.name = `Carried ${kind}`; mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.pools.set(kind, mesh); this.group.add(mesh);
    }
  }
  beginFrame(): void { for (const mesh of this.pools.values()) mesh.count = 0; }
  draw(id: string, x: number, y: number, z: number, size: number, facing: number): void {
    const mesh = this.pools.get(carriedShape(id))!;
    if (mesh.count >= this.capacity || size <= 0) return;
    this.marker.position.set(x, y, z); this.marker.rotation.set(0, facing, 0); this.marker.scale.setScalar(size);
    this.marker.updateMatrix(); mesh.setMatrixAt(mesh.count++, this.marker.matrix);
  }
  endFrame(): void { for (const mesh of this.pools.values()) mesh.instanceMatrix.needsUpdate = true; }
}
