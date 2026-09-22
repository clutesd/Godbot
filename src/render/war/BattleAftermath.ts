import * as THREE from 'three';
import type { HistoricalEvent, Vec2, War } from '../../sim/types';
import { campaignPoint } from '../../sim/war/Campaign';
import { createCosmicBodyGeometry, createCosmicHeadGeometry, COSMIC_HEIGHT_MULTIPLIER } from '../people/CosmicPeople';
import type { MilitaryVisualStyle } from './MilitaryVisualLanguage';
import { impactMoment, engagementGap, figurePosition } from './CombatChoreography';

export const MAX_BATTLE_BODIES = 32;
export const AFTERMATH_MONTHS = 12;

/** Presentation receipts, never population entities. Stable IDs are a future cleanup-system seam.
 * Missing/pruned history produces no receipt; cumulative war totals cannot invent a battle. */
export interface CasualtyReceipt {
  readonly id: string;
  readonly warId: string;
  readonly eventId: string;
  readonly month: number;
  readonly side: 0 | 1;
  readonly slot: number;
  readonly position: Vec2;
  readonly yaw: number;
  readonly impactAt: number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

export function casualtyReceipts(war: War, history: readonly HistoricalEvent[], month: number,
  styles: readonly [MilitaryVisualStyle, MilitaryVisualStyle]): CasualtyReceipt[] {
  const receipts: CasualtyReceipt[] = [];
  // History is chronological; traverse backwards, retaining only a bounded recent window.
  const seen = new Set<string>();
  for (let index = history.length - 1; index >= 0 && receipts.length < MAX_BATTLE_BODIES && seen.size < 16; index--) {
    const event = history[index]!;
    if (event.type !== 'battle' || !event.actors.includes(war.id) || !event.location || event.month > month
      || month - event.month >= AFTERMATH_MONTHS || seen.has(event.id)) continue;
    seen.add(event.id);
    const progress = Number(event.context['progress']);
    const front = 0.76 + (Number.isFinite(progress) ? Math.max(-1, Math.min(1, progress)) : 0) * 0.08;
    const before = campaignPoint(war.campaign.route, front - 0.006, event.location);
    const after = campaignPoint(war.campaign.route, front + 0.006, event.location);
    const yaw = Math.atan2(after.x - before.x, after.z - before.z);
    const gap = engagementGap(styles, event.context['engagementMode']);
    for (const side of [0, 1] as const) {
      const losses = event.context[side === 0 ? 'casualtiesA' : 'casualtiesB'];
      if (typeof losses !== 'number' || !Number.isFinite(losses) || losses < 1) continue;
      const count = Math.min(3, Math.floor(losses));
      const offset = hash(`${war.id}:${event.id}:${side}`) % 3;
      for (let sample = 0; sample < count && receipts.length < MAX_BATTLE_BODIES; sample++) {
        const slot = (offset + sample) % 3;
        receipts.push({ id: `${war.id}:${event.id}:${side}:${slot}`, warId: war.id, eventId: event.id,
          month: event.month, side, slot, position: figurePosition(event.location, yaw, gap, styles[side], side, slot),
          impactAt: impactMoment(styles[side === 0 ? 1 : 0], slot, side === 0 ? 1 : 0),
          yaw: yaw + side * Math.PI });
      }
    }
  }
  return receipts;
}

export class BattleAftermath {
  readonly group = new THREE.Group();
  private receipts: CasualtyReceipt[] = [];
  private readonly started = new Map<string, number>();
  private readonly root = new THREE.Object3D();
  private readonly local = new THREE.Object3D();
  private readonly matrix = new THREE.Matrix4();
  private readonly bodies = this.pool('Recorded fallen soldiers', createCosmicBodyGeometry(), '#655258', MAX_BATTLE_BODIES);
  private readonly heads = this.pool('Fallen heads', createCosmicHeadGeometry(), '#877875', MAX_BATTLE_BODIES);
  private readonly limbs = this.pool('Fallen limbs', new THREE.BoxGeometry(0.035, 0.095, 0.035), '#554b48', MAX_BATTLE_BODIES * 4);
  private readonly kit = this.pool('Abandoned battlefield equipment', new THREE.BoxGeometry(0.03, 0.025, 0.22), '#62584a', MAX_BATTLE_BODIES);
  private readonly groundMarks = this.pool('Battlefield disturbed ground', new THREE.CircleGeometry(0.23, 7), '#776550', MAX_BATTLE_BODIES);
  private readonly stains = this.pool('Recorded blood traces', new THREE.CircleGeometry(0.115, 7), '#682c2b', MAX_BATTLE_BODIES);
  private readonly impacts = this.pool('Casualty contact bursts', new THREE.IcosahedronGeometry(0.025, 0), '#9b3c32', MAX_BATTLE_BODIES * 3);
  private disposed = false;

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Recorded battlefield aftermath';
  }

  get records(): readonly CasualtyReceipt[] { return this.receipts; }

  sync(war: War, history: readonly HistoricalEvent[], month: number, elapsed: number,
    styles: readonly [MilitaryVisualStyle, MilitaryVisualStyle]): void {
    const next = casualtyReceipts(war, history, month, styles);
    const ids = new Set(next.map(record => record.id));
    for (const id of this.started.keys()) if (!ids.has(id)) this.started.delete(id);
    for (const record of next) if (!this.started.has(record.id)) {
      // Historical/reloaded remains are already at rest; only a current event gets a fall.
      this.started.set(record.id, record.month === month && war.phase === 'battle' && war.resolvedMonth === undefined ? elapsed : -Infinity);
    }
    this.receipts = next;
  }

  suppress(eventId: string | undefined, side: number, slot: number, elapsed: number, reducedMotion: boolean): boolean {
    return this.receipts.some(record => record.eventId === eventId && record.side === side && record.slot === slot
      && (reducedMotion || elapsed - this.started.get(record.id)! >= record.impactAt));
  }

  /** Do not stand survivors inside old remains. This is visual culling, never navigation truth. */
  occupies(point: Vec2, currentEventId?: string, elapsed = Infinity, reducedMotion = false): boolean {
    return this.receipts.some(record => {
      if (record.eventId === currentEventId && !reducedMotion
        && elapsed - this.started.get(record.id)! < record.impactAt + 0.32) return false;
      const x = record.position.x - Math.sin(record.yaw) * 0.16;
      const z = record.position.z - Math.cos(record.yaw) * 0.16;
      return Math.hypot(point.x - x, point.z - z) < 0.16;
    });
  }

  update(month: number, elapsed: number, reducedMotion: boolean, clear: (a: Vec2, b: Vec2) => boolean): void {
    if (this.disposed) return;
    let count = 0;
    let particles = 0;
    for (let index = 0; index < this.receipts.length; index++) {
      const record = this.receipts[index]!;
      // Aggregate coincident historical samples instead of stacking opaque corpses. Newest wins.
      let coincident = false;
      for (let earlier = 0; earlier < index; earlier++) {
        const other = this.receipts[earlier]!;
        if ((reducedMotion || elapsed - this.started.get(other.id)! >= other.impactAt)
          && Math.hypot(other.position.x - record.position.x, other.position.z - record.position.z) < 0.14) { coincident = true; break; }
      }
      if (coincident) continue;
      const age = Math.max(0, month - record.month);
      const fade = Math.min(1, Math.max(0, (AFTERMATH_MONTHS - age) / 4));
      const life = reducedMotion ? 10 : elapsed - this.started.get(record.id)! - record.impactAt;
      if (life < 0) continue;
      const fall = Math.min(1, Math.max(0, (life - 0.32) / 0.9));
      const eased = fall * fall * (3 - 2 * fall);
      const p = record.position;
      // Fall backwards into the casualty's own half of the battlefield; protect the entire body.
      const end = { x: p.x - Math.sin(record.yaw) * 0.34, z: p.z - Math.cos(record.yaw) * 0.34 };
      if (!clear(p, end) || fade <= 0) continue;
      const ground = Math.max(this.elevationAt(p.x, p.z), this.elevationAt(end.x, end.z));
      this.root.position.set(p.x, ground + 0.025, p.z);
      this.root.rotation.set(-eased * Math.PI / 2, record.yaw, life < 0.32 ? Math.sin(life * 24) * 0.12 : 0, 'YXZ');
      this.root.scale.setScalar(fade);
      this.root.updateMatrix();
      const bodyScale = 0.28 * COSMIC_HEIGHT_MULTIPLIER;
      this.part(this.bodies, count, 0, 0.16, 0, bodyScale);
      this.part(this.heads, count, 0, 0.285, 0, bodyScale);
      this.part(this.limbs, count * 4, -0.03, 0.052, 0, 1);
      this.part(this.limbs, count * 4 + 1, 0.03, 0.052, 0, 1);
      this.part(this.limbs, count * 4 + 2, -0.055, 0.195, 0, 1);
      this.part(this.limbs, count * 4 + 3, 0.055, 0.195, 0, 1);
      this.local.position.set(p.x + Math.cos(record.yaw) * 0.09, ground + 0.02, p.z - Math.sin(record.yaw) * 0.09);
      this.local.rotation.set(0, record.yaw + 0.4, 0);
      this.local.scale.setScalar(fade * eased);
      this.local.updateMatrix();
      this.kit.setMatrixAt(count, this.local.matrix);
      this.local.position.set(p.x, ground + 0.009, p.z);
      this.local.rotation.set(-Math.PI / 2, 0, record.yaw);
      this.local.scale.set(fade, fade * (0.5 + eased * 0.4), fade);
      this.local.updateMatrix();
      this.stains.setMatrixAt(count, this.local.matrix);
      this.local.position.y = ground + 0.006;
      this.local.scale.set(fade, fade * 0.7, fade);
      this.local.updateMatrix();
      this.groundMarks.setMatrixAt(count, this.local.matrix);
      if (!reducedMotion && life < 0.32) for (let j = 0; j < 3; j++) {
        this.local.position.set(p.x + Math.cos(j * 2.4) * life * 0.3, ground + 0.19 + life * 0.18, p.z + Math.sin(j * 2.4) * life * 0.3);
        this.local.rotation.set(0, j, 0);
        this.local.scale.setScalar(1 - life / 0.32);
        this.local.updateMatrix();
        this.impacts.setMatrixAt(particles++, this.local.matrix);
      }
      count++;
    }
    this.bodies.count = this.heads.count = this.kit.count = this.stains.count = this.groundMarks.count = count;
    this.limbs.count = count * 4;
    this.impacts.count = particles;
    for (const mesh of [this.bodies, this.heads, this.limbs, this.kit, this.stains, this.groundMarks, this.impacts]) mesh.instanceMatrix.needsUpdate = true;
  }

  private part(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, scale: number): void {
    this.local.position.set(x, y, z);
    this.local.rotation.set(0, 0, 0);
    this.local.scale.setScalar(scale);
    this.local.updateMatrix();
    this.matrix.multiplyMatrices(this.root.matrix, this.local.matrix);
    mesh.setMatrixAt(index, this.matrix);
  }

  private pool(name: string, geometry: THREE.BufferGeometry, color: string, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }), capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.bodies, this.heads, this.limbs, this.kit, this.stains, this.groundMarks, this.impacts]) {
      mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    this.receipts = [];
    this.started.clear();
    this.group.clear();
  }
}
