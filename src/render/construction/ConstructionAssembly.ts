import * as THREE from 'three';
import type { StructureMaterial } from '../../sim/development/types';
import type { AssemblyPiece, Vec3 } from '../assets/GeometryBuilder';
import { constructionStagePresentation } from './ConstructionVisualGrammar';

const STAGE_START = [0, 0.2, 0.45, 0.78, 0.92, 1] as const;

export interface ConstructionPiece extends AssemblyPiece {
  meshIndex: number;
  face: number;
  startProgress: number;
  endProgress: number;
}
export interface ConstructionAssemblyPlan {
  pieces: readonly ConstructionPiece[];
  width: number;
  depth: number;
  height: number;
  material: StructureMaterial;
  /** Bounded visual catch-up, always at or below authoritative paid progress. */
  progress?: number;
}
export interface ConstructionWorkZone {
  piece: number;
  face: number;
  contact: Vec3;
  stand: { x: number; z: number };
  platform: number;
}

function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** One sequence of real target-building parts, shared by fabric, access and worker contact. */
export function constructionAssemblyPlan(source: THREE.Object3D, fit: number, seed: string, material: StructureMaterial): ConstructionAssemblyPlan {
  const full = source instanceof THREE.LOD ? source.levels[0]!.object : source;
  const width = Number(full.userData['bodyWidth'] ?? source.userData['footprintWidth'] ?? 1) * fit;
  const depth = Number(full.userData['bodyDepth'] ?? source.userData['footprintDepth'] ?? 1) * fit;
  const pieces: ConstructionPiece[] = [];
  let meshIndex = 0;
  full.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const p of (object.geometry.userData['assemblyPieces'] ?? []) as AssemblyPiece[]) {
      const min = { x: p.min.x * fit, y: p.min.y * fit, z: p.min.z * fit };
      const max = { x: p.max.x * fit, y: p.max.y * fit, z: p.max.z * fit };
      const x = (min.x + max.x) / 2, z = (min.z + max.z) / 2;
      const face = Math.abs(x / width) > Math.abs(z / depth) ? x >= 0 ? 0 : 2 : z >= 0 ? 1 : 3;
      pieces.push({ ...p, min, max, meshIndex, face, startProgress: 0, endProgress: 0 });
    }
    meshIndex++;
  });
  const firstFace = Math.floor(unit(seed) * 4);
  const faceOrder = (p: ConstructionPiece) => (p.face - firstFace + 4) % 4;
  const course = (p: ConstructionPiece) => Math.round(p.min.y / Math.max(0.025, fit * 0.12));
  pieces.sort((a, b) => a.stage - b.stage
    || (a.stage === 4 ? course(b) - course(a) : a.stage === 2 && material === 'timber' ? faceOrder(a) - faceOrder(b) : course(a) - course(b))
    || faceOrder(a) - faceOrder(b)
    || (a.face % 2 ? a.min.x - b.min.x : a.min.z - b.min.z)
    || a.min.y - b.min.y || a.meshIndex - b.meshIndex || a.start - b.start);
  for (let stage = 0; stage < 5; stage++) {
    const stagePieces = pieces.filter(p => p.stage === stage);
    stagePieces.forEach((p, i) => {
      const start = STAGE_START[stage]!, span = STAGE_START[stage + 1]! - start;
      p.startProgress = start + span * i / stagePieces.length;
      p.endProgress = start + span * (i + 1) / stagePieces.length;
    });
  }
  return { pieces, width, depth, height: Number(source.userData['buildingHeight'] ?? 1) * fit, material };
}

export function constructionActivePiece(plan: ConstructionAssemblyPlan, progress: number): number {
  let lo = 0, hi = plan.pieces.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (plan.pieces[mid]!.endProgress <= progress) lo = mid + 1; else hi = mid; }
  return Math.min(lo, Math.max(0, plan.pieces.length - 1));
}

export function constructionActiveWorkZone(plan: ConstructionAssemblyPlan, progress: number): ConstructionWorkZone {
  const index = constructionActivePiece(plan, progress), p = plan.pieces[index];
  const face = p?.face ?? 1;
  const contact = p ? { x: (p.min.x + p.max.x) / 2, y: p.max.y, z: (p.min.z + p.max.z) / 2 } : { x: 0, y: 0.05, z: plan.depth / 2 };
  // Work on the outside surface of the selected member, never the centre of the building.
  if (p) {
    if (face === 0) contact.x = p.max.x;
    if (face === 1) contact.z = p.max.z;
    if (face === 2) contact.x = p.min.x;
    if (face === 3) contact.z = p.min.z;
    // Tall posts are fastened at their lower connection first.
    if (p.stage === 1) contact.y = p.min.y + Math.min(0.2, p.max.y - p.min.y);
  }
  const stand = { x: contact.x, z: contact.z };
  const clearance = 0.14;
  if (face === 0) stand.x = Math.max(plan.width / 2, contact.x) + clearance;
  if (face === 1) stand.z = Math.max(plan.depth / 2, contact.z) + clearance;
  if (face === 2) stand.x = Math.min(-plan.width / 2, contact.x) - clearance;
  if (face === 3) stand.z = Math.min(-plan.depth / 2, contact.z) - clearance;
  const stage = constructionStagePresentation(progress).stage;
  const platform = stage >= 1 ? Math.floor(Math.max(0, contact.y - 0.16) / 0.2) * 0.2 : 0;
  return { piece: index, face, contact, stand, platform };
}

/** Per-site index buffers; shared attributes/materials. Updating paid progress only changes draw ranges. */
export class ConstructionAssembly {
  readonly group = new THREE.Group();
  readonly plan: ConstructionAssemblyPlan;
  private readonly batches: { mesh: THREE.Mesh; pieces: ConstructionPiece[]; counts: number[] }[] = [];
  private readonly moving: THREE.Mesh;
  private lastPiece = -1;

  constructor(source: THREE.Object3D, fit: number, seed: string, material: StructureMaterial) {
    this.plan = constructionAssemblyPlan(source, fit, seed, material);
    this.group.name = 'Physical building assembly';
    this.group.userData['constructionCue'] = 'future-building-shell';
    this.group.scale.setScalar(fit);
    const full = source instanceof THREE.LOD ? source.levels[0]!.object : source;
    let meshIndex = 0;
    full.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const pieces = this.plan.pieces.filter(p => p.meshIndex === meshIndex);
      meshIndex++;
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries((object.geometry as THREE.BufferGeometry).attributes)) geometry.setAttribute(name, attribute);
      const indices: number[] = [], counts: number[] = [];
      for (const p of pieces) {
        for (let i = p.start; i < p.start + p.count; i++) indices.push(object.geometry.index!.getX(i));
        counts.push(indices.length);
      }
      geometry.setIndex(indices);
      geometry.boundingSphere = object.geometry.boundingSphere;
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData['constructionCue'] = 'future-building-fabric';
      this.group.add(mesh); this.batches.push({ mesh, pieces, counts });
    });
    this.moving = new THREE.Mesh(new THREE.BufferGeometry());
    this.moving.name = 'Member being seated';
    this.moving.castShadow = true; this.moving.receiveShadow = true;
    this.group.add(this.moving);
  }

  update(progress: number, delta?: number, installationContact?: boolean): void {
    const authoritative = Math.max(0, Math.min(1, progress));
    let paid = delta === undefined || this.plan.progress === undefined || authoritative === 1 ? authoritative
      : Math.min(authoritative, Math.max(authoritative - 0.08, this.plan.progress + Math.max(0, Math.min(0.1, delta)) * 0.04));
    if (delta !== undefined && installationContact !== undefined && this.plan.progress !== undefined && authoritative < 1) {
      const next = this.plan.pieces[constructionActivePiece(this.plan, this.plan.progress)];
      if (next) {
        // Seat already-paid fabric on a contact beat. Bound the lag so hidden/interrupted crews
        // never become an alternative authority over the project's outcome.
        const limit = installationContact ? next.endProgress : next.startProgress + (next.endProgress - next.startProgress) * 0.6;
        paid = Math.min(authoritative, Math.max(this.plan.progress, authoritative - 0.08, Math.min(paid, limit), installationContact ? next.endProgress : 0));
      }
    }
    this.plan.progress = paid;
    for (const { mesh, pieces, counts } of this.batches) {
      let lo = 0, hi = pieces.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (pieces[mid]!.endProgress <= paid) lo = mid + 1; else hi = mid; }
      mesh.geometry.setDrawRange(0, lo ? counts[lo - 1]! : 0);
    }
    const index = constructionActivePiece(this.plan, paid), piece = this.plan.pieces[index];
    this.moving.visible = !!piece && paid > piece.startProgress && paid < piece.endProgress && paid < 1;
    if (!piece || !this.moving.visible) return;
    const batch = this.batches[piece.meshIndex]!;
    if (index !== this.lastPiece) {
      for (const [name, attribute] of Object.entries(batch.mesh.geometry.attributes)) this.moving.geometry.setAttribute(name, attribute);
      this.moving.geometry.setIndex(batch.mesh.geometry.index);
      this.moving.geometry.boundingSphere = batch.mesh.geometry.boundingSphere;
      const localIndex = batch.pieces.indexOf(piece);
      this.moving.geometry.setDrawRange(localIndex ? batch.counts[localIndex - 1]! : 0, piece.count);
      this.moving.material = batch.mesh.material;
      this.lastPiece = index;
    }
    // The incoming opaque member seats over its own paid interval, never on a renderer clock.
    const t = (paid - piece.startProgress) / (piece.endProgress - piece.startProgress);
    const remaining = 1 - t * t * (3 - 2 * t);
    this.moving.position.y = 0.08 * remaining;
    this.moving.scale.set(1, 0.85 + 0.15 * t, 1);
    this.moving.position.y += piece.min.y / this.group.scale.y * (1 - this.moving.scale.y);
  }
}
