import * as THREE from 'three';
import type { StructureMaterial } from '../../sim/development/types';
import type { AssemblyPiece, Vec3 } from '../assets/GeometryBuilder';
import { BUILD_STAGE } from '../assets/BuildingComposer';
import type { StructureComponentManifest } from '../assets/StructureComponents';
import { CONSTRUCTION_STAGE_THRESHOLDS, constructionStagePresentation } from './ConstructionVisualGrammar';

/**
 * Where each construction stage begins in paid progress, plus a terminating 1.
 *
 * Mirrors CONSTRUCTION_STAGE_THRESHOLDS exactly; derived from it rather than restated so the
 * piece-by-piece reveal can never drift out of step with the stage the rest of the renderer
 * believes the site is in.
 */
const STAGE_START = [
  0,
  CONSTRUCTION_STAGE_THRESHOLDS.foundation,
  CONSTRUCTION_STAGE_THRESHOLDS.frame,
  CONSTRUCTION_STAGE_THRESHOLDS.walls,
  CONSTRUCTION_STAGE_THRESHOLDS.roof,
  CONSTRUCTION_STAGE_THRESHOLDS.utilities,
  CONSTRUCTION_STAGE_THRESHOLDS.fitout,
  CONSTRUCTION_STAGE_THRESHOLDS.detail,
  1,
] as const;

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

interface Box { min: Vec3; max: Vec3 }

/** Work in the canonical root frame, including nested machinery and offset building wings. */
function memberTransform(source: THREE.Object3D, member: THREE.Object3D): THREE.Matrix4 {
  return source.matrixWorld.clone().invert().multiply(member.matrixWorld);
}

function memberBounds(piece: AssemblyPiece, transform: THREE.Matrix4, fit: number): Box {
  const box = new THREE.Box3(new THREE.Vector3(piece.min.x, piece.min.y, piece.min.z),
    new THREE.Vector3(piece.max.x, piece.max.y, piece.max.z)).applyMatrix4(transform);
  return { min: { x: box.min.x * fit, y: box.min.y * fit, z: box.min.z * fit },
    max: { x: box.max.x * fit, y: box.max.y * fit, z: box.max.z * fit } };
}

function supportEnvelope(pieces: readonly ConstructionPiece[]): Box | undefined {
  let bounds: Box | undefined;
  for (const piece of pieces) {
    if (piece.stage !== BUILD_STAGE.FRAME && piece.stage !== BUILD_STAGE.WALLS) continue;
    bounds ??= { min: { ...piece.min }, max: { ...piece.max } };
    for (const axis of ['x', 'y', 'z'] as const) {
      bounds.min[axis] = Math.min(bounds.min[axis], piece.min[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], piece.max[axis]);
    }
  }
  return bounds;
}

function supportsRoof(structure: Box | undefined, roof: ConstructionPiece, clearance: number): boolean {
  if (!structure || structure.min.y >= roof.max.y) return false;
  // A roof spans between perimeter supports; an interior tile need not overlap a post itself.
  return roof.min.x <= structure.max.x + clearance && roof.max.x >= structure.min.x - clearance
    && roof.min.z <= structure.max.z + clearance && roof.max.z >= structure.min.z - clearance;
}

/** The building's original-fabric components (StructureComponents.ts always gives the core —
 * foundation/frame/core/roof — `origin` provenance; a massing annex is always the later addition,
 * per generationForAnnex's own contract). When real multi-generation history exists, this core
 * already stands, so an expansion/upgrade should animate only the new annex being built onto it,
 * not rebuild the whole target from scratch. A fresh single-generation building has no `origin`
 * phase (its core is simply `current`), so this is a no-op for ordinary new construction. */
function preexistingCoreBounds(source: THREE.Object3D, fit: number): Box[] {
  const manifest = source.userData['structureComponents'] as StructureComponentManifest | undefined;
  if (!manifest) return [];
  return manifest.components
    .filter(component => component.provenance.phase === 'origin')
    .map(component => {
      const { center, size } = component.bounds;
      return {
        min: { x: (center.x - size.x / 2) * fit, y: (center.y - size.y / 2) * fit, z: (center.z - size.z / 2) * fit },
        max: { x: (center.x + size.x / 2) * fit, y: (center.y + size.y / 2) * fit, z: (center.z + size.z / 2) * fit },
      };
    });
}

function centerWithin(piece: ConstructionPiece, box: Box): boolean {
  const cx = (piece.min.x + piece.max.x) / 2, cy = (piece.min.y + piece.max.y) / 2, cz = (piece.min.z + piece.max.z) / 2;
  return cx >= box.min.x && cx <= box.max.x && cy >= box.min.y && cy <= box.max.y && cz >= box.min.z && cz <= box.max.z;
}

/** One sequence of real target-building parts, shared by fabric, access and worker contact. */
export function constructionAssemblyPlan(source: THREE.Object3D, fit: number, seed: string, material: StructureMaterial): ConstructionAssemblyPlan {
  source.updateWorldMatrix(true, true);
  const full = source instanceof THREE.LOD ? source.levels[0]!.object : source;
  const width = Number(full.userData['bodyWidth'] ?? source.userData['footprintWidth'] ?? 1) * fit;
  const depth = Number(full.userData['bodyDepth'] ?? source.userData['footprintDepth'] ?? 1) * fit;
  const pieces: ConstructionPiece[] = [];
  let meshIndex = 0;
  full.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const transform = memberTransform(source, object);
    for (const p of (object.geometry.userData['assemblyPieces'] ?? []) as AssemblyPiece[]) {
      const { min, max } = memberBounds(p, transform, fit);
      const x = (min.x + max.x) / 2, z = (min.z + max.z) / 2;
      const face = Math.abs(x / width) > Math.abs(z / depth) ? x >= 0 ? 0 : 2 : z >= 0 ? 1 : 3;
      pieces.push({ ...p, min, max, meshIndex, face, startProgress: 0, endProgress: 0 });
    }
    meshIndex++;
  });
  const firstFace = Math.floor(unit(seed) * 4);
  const faceOrder = (p: ConstructionPiece) => (p.face - firstFace + 4) % 4;
  const course = (p: ConstructionPiece) => Math.round(p.min.y / Math.max(0.025, fit * 0.12));
  // Within a stage: masonry rises course by course, a timber frame is raised face by face, and
  // finishing work comes down from the top (ridge ornament before yard dressing).
  pieces.sort((a, b) => a.stage - b.stage
    || (a.stage >= BUILD_STAGE.FINISH
      ? course(b) - course(a)
      : a.stage === BUILD_STAGE.FRAME && material === 'timber'
        ? faceOrder(a) - faceOrder(b)
        : course(a) - course(b))
    || faceOrder(a) - faceOrder(b)
    || (a.face % 2 ? a.min.x - b.min.x : a.min.z - b.min.z)
    || a.min.y - b.min.y || a.meshIndex - b.meshIndex || a.start - b.start);
  for (let stage = 0; stage < STAGE_START.length - 1; stage++) {
    const stagePieces = pieces.filter(p => p.stage === stage);
    stagePieces.forEach((p, i) => {
      const start = STAGE_START[stage]!, span = STAGE_START[stage + 1]! - start;
      p.startProgress = start + span * i / stagePieces.length;
      p.endProgress = start + span * (i + 1) / stagePieces.length;
    });
  }
  // A building expanded or repurposed onto an existing core should not look identical to one
  // built at its final size from scratch: the pre-existing core reveals immediately, and only the
  // new annex's pieces animate through the ordinary stage progression.
  const coreBounds = preexistingCoreBounds(source, fit);
  if (coreBounds.length > 0) {
    const inherited = pieces.filter(piece => coreBounds.some(box => centerWithin(piece, box)));
    const inheritedSupports = supportEnvelope(inherited);
    for (const piece of inherited) if (piece.stage !== BUILD_STAGE.ROOF
      || supportsRoof(inheritedSupports, piece, Math.max(width, depth) * 0.25)) {
      piece.startProgress = 0;
      piece.endProgress = 0;
    }
    // The draw-range binary search in ConstructionAssembly.update assumes pieces are sorted
    // ascending by endProgress; re-sort after the override to preserve that invariant.
  }
  // Roof-only or disconnected fabric is not an active building. Never show it without an
  // established frame/wall beneath it, even when a coarse heritage box calls it pre-existing.
  // Completion still contains every canonical triangle; the finished asset is untouched.
  const supports = supportEnvelope(pieces);
  const standingSupports = supportEnvelope(pieces.filter(piece => piece.endProgress === 0));
  for (const roof of pieces.filter(piece => piece.stage === BUILD_STAGE.ROOF)) {
    const supported = supportsRoof(supports, roof, Math.max(width, depth) * 0.25);
    if (!supported) { roof.startProgress = 1; roof.endProgress = 1; }
    else if (roof.endProgress === 0 && !supportsRoof(standingSupports, roof, Math.max(width, depth) * 0.25)) {
      roof.startProgress = STAGE_START[BUILD_STAGE.ROOF];
      roof.endProgress = STAGE_START[BUILD_STAGE.ROOF + 1]!;
    }
  }
  pieces.sort((a, b) => a.endProgress - b.endProgress);
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
    if (p.stage === BUILD_STAGE.FOUNDATION) contact.y = p.min.y + Math.min(0.2, p.max.y - p.min.y);
  }
  const stand = { x: contact.x, z: contact.z };
  const clearance = 0.14;
  if (face === 0) stand.x = Math.max(plan.width / 2, contact.x) + clearance;
  if (face === 1) stand.z = Math.max(plan.depth / 2, contact.z) + clearance;
  if (face === 2) stand.x = Math.min(-plan.width / 2, contact.x) - clearance;
  if (face === 3) stand.z = Math.min(-plan.depth / 2, contact.z) - clearance;
  const stage = constructionStagePresentation(progress).stage;
  const platform = stage >= BUILD_STAGE.FOUNDATION ? Math.floor(Math.max(0, contact.y - 0.16) / 0.2) * 0.2 : 0;
  return { piece: index, face, contact, stand, platform };
}

/** Per-site index buffers; shared attributes/materials. Updating paid progress only changes draw ranges. */
export type ConstructionAssemblyMode = 'bounded' | 'contact-led';

export class ConstructionAssembly {
  readonly group = new THREE.Group();
  readonly plan: ConstructionAssemblyPlan;
  private readonly batches: { mesh: THREE.Mesh; pieces: ConstructionPiece[]; counts: number[] }[] = [];
  private readonly moving: THREE.Mesh;
  private lastPiece = -1;
  private contactSeatTarget: number | undefined;

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
      const transform = memberTransform(source, object);
      if (!transform.equals(new THREE.Matrix4())) {
        // Clone only transformed attributes; cached target buffers must remain pristine.
        geometry.setAttribute('position', geometry.getAttribute('position').clone());
        if (geometry.hasAttribute('normal')) geometry.setAttribute('normal', geometry.getAttribute('normal').clone());
        geometry.applyMatrix4(transform);
      }
      const indices: number[] = [], counts: number[] = [];
      for (const p of pieces) {
        for (let i = p.start; i < p.start + p.count; i++) indices.push(object.geometry.index!.getX(i));
        counts.push(indices.length);
      }
      geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geometry, object.material);
      mesh.name = object.name;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData['constructionCue'] = 'future-building-fabric';
      this.group.add(mesh); this.batches.push({ mesh, pieces, counts });
    });
    this.moving = new THREE.Mesh(new THREE.BufferGeometry());
    this.moving.name = 'Member being seated';
    this.moving.castShadow = true; this.moving.receiveShadow = true;
    this.group.add(this.moving);
  }

  update(progress: number, delta?: number, installationContact?: boolean, mode: ConstructionAssemblyMode = 'bounded', validWorkface = true): void {
    const authoritative = Math.max(0, Math.min(1, progress));
    if (delta === undefined) this.contactSeatTarget = undefined;
    let paid: number;
    if (mode === 'contact-led' && delta !== undefined) {
      paid = Math.min(authoritative, this.plan.progress ?? 0);
      // Losing access, visibility or labour cancels the pending seat. A new contact must establish
      // it again; neither a previous strike nor the paid-progress snapshot can animate an empty site.
      if (!validWorkface) this.contactSeatTarget = undefined;
      const next = this.plan.pieces[constructionActivePiece(this.plan, paid)];
      if (validWorkface && installationContact && next && authoritative > next.startProgress + 1e-6) {
        // Empty canonical stage intervals contain no fabric to animate. Cross those only on the
        // contact that starts the next real member, then spend the seating time on that member.
        paid = Math.min(authoritative, Math.max(paid, next.startProgress));
        this.contactSeatTarget = Math.min(authoritative, next.endProgress);
      }
      if (validWorkface && this.contactSeatTarget !== undefined && next) {
        const target = Math.min(authoritative, this.contactSeatTarget);
        const span = Math.max(0.001, next.endProgress - next.startProgress);
        paid = Math.min(target, paid + Math.max(0, Math.min(0.1, delta)) * span / 0.52);
        if (paid >= target - 1e-6) this.contactSeatTarget = undefined;
      }
      // Some canonical (especially primitive) targets have no fabric in the later stages. Once
      // their last member is seated, a real finishing contact may retire that paid empty tail.
      // Zero-span completion members likewise require contact instead of deadlocking at 100% paid.
      if (validWorkface && installationContact && next
        && (paid >= next.endProgress && next === this.plan.pieces[this.plan.pieces.length - 1]
          || authoritative === 1 && next.startProgress === 1 && next.endProgress === 1)) {
        paid = authoritative;
        this.contactSeatTarget = undefined;
      }
    } else {
      paid = delta === undefined || this.plan.progress === undefined || authoritative === 1 ? authoritative
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
