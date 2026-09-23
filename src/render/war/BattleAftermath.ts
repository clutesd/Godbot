import * as THREE from 'three';
import type { HistoricalEvent, Vec2, War } from '../../sim/types';
import { campaignPoint } from '../../sim/war/Campaign';
import type { MilitaryVisualStyle } from './MilitaryVisualLanguage';
import { engagementGap } from './CombatChoreography';
import { createCombatExchanges, exchangeFigurePose, exchangeImpactAt, formationCount, presentationHash, type CombatFigurePose } from './CombatExchanges';

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
  readonly figure: CombatFigurePose;
}

/** Shared by the original company meshes from the instant of impact through permanent rest. */
export function casualtyLifecycle(life: number, reducedMotion: boolean) {
  const t = reducedMotion ? Infinity : Math.max(0, life);
  const fall = Math.min(1, Math.max(0, (t - 0.38) / 0.95));
  const eased = fall * fall * (3 - 2 * fall);
  const stagger = Math.min(1, t / 0.38);
  return {
    phase: t < 0.12 ? 'hit' : t < 0.38 ? 'stagger' : t < 1.33 ? 'fall' : 'corpse',
    fall: eased, pitch: -eased * Math.PI / 2,
    retreat: stagger * 0.035,
    reaction: Math.sin(Math.min(1, t / 0.38) * Math.PI) * 0.18,
    settle: Math.min(1, t / 0.6),
  } as const;
}
export interface CasualtyFrame {
  record: CasualtyReceipt;
  life: number;
  fade: number;
  ground: number;
  motion: ReturnType<typeof casualtyLifecycle>;
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
    // Frozen mobilization counts also define the event's visible formation. Current strengths
    // are deliberately excluded: later attrition/reinforcement must not reshuffle old remains.
    const counts = [formationCount(war.campaign.initialStrengthA), formationCount(war.campaign.initialStrengthB)] as const;
    const plan = createCombatExchanges(event.id, event.location, yaw, gap, styles, counts);
    const selected = ([0, 1] as const).map(side => {
      const losses = event.context[side === 0 ? 'casualtiesA' : 'casualtiesB'];
      if (typeof losses !== 'number' || !Number.isFinite(losses) || losses < 1) return [];
      const count = Math.min(counts[side], 8, Math.floor(losses), 1 + Math.floor(Math.log2(losses)));
      // Hash-ranked sampling without replacement across every visible rank/lateral slot.
      return Array.from({ length: counts[side] }, (_, slot) => slot)
        .sort((a, b) => presentationHash(`${war.id}:${event.id}:${side}:${a}`) - presentationHash(`${war.id}:${event.id}:${side}:${b}`) || a - b)
        .slice(0, count);
    });
    // Interleave sides so a nearly-full global pool cannot systematically erase one side.
    for (let sample = 0; sample < Math.max(selected[0]!.length, selected[1]!.length); sample++) for (const side of [0, 1] as const) {
      const slot = selected[side]![sample];
      if (slot === undefined || receipts.length >= MAX_BATTLE_BODIES) continue;
      const exchange = plan.exchanges.find(item => item.slots[side] === slot);
      // Rear-rank aggregate losses do not invent a melee attacker reaching through other soldiers.
      const impactAt = exchange ? exchangeImpactAt(plan, exchange, side) : 0.6 + presentationHash(`${event.id}:${side}:${slot}:impact`) % 2000 / 1000;
      const opposite = (1 - side) as 0 | 1;
      const partnerFell = exchange && selected[opposite]!.includes(exchange.slots[opposite])
        && exchangeImpactAt(plan, exchange, opposite) < impactAt;
      const figure = exchangeFigurePose(plan, side, slot, impactAt, !partnerFell, false);
      receipts.push({ id: `${war.id}:${event.id}:${side}:${slot}`, warId: war.id, eventId: event.id,
        month: event.month, side, slot, position: figure.position, impactAt, yaw: figure.yaw, figure });
    }
  }
  return receipts;
}

export class BattleAftermath {
  readonly group = new THREE.Group();
  private receipts: CasualtyReceipt[] = [];
  private readonly started = new Map<string, number>();
  private readonly local = new THREE.Object3D();
  private frames: CasualtyFrame[] = [];
  private readonly kit = this.pool('Abandoned battlefield equipment', new THREE.BoxGeometry(0.03, 0.025, 0.22), '#62584a', MAX_BATTLE_BODIES);
  private readonly groundMarks = this.pool('Battlefield disturbed ground', new THREE.CircleGeometry(0.23, 7), '#776550', MAX_BATTLE_BODIES);
  private readonly stains = this.pool('Recorded blood traces', new THREE.CircleGeometry(0.115, 7), '#682c2b', MAX_BATTLE_BODIES);
  private readonly impacts = this.pool('Casualty contact bursts', new THREE.IcosahedronGeometry(0.025, 0), '#9b3c32', MAX_BATTLE_BODIES * 3);
  private disposed = false;

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Recorded battlefield aftermath';
  }

  get records(): readonly CasualtyReceipt[] { return this.receipts; }
  get visibleCasualties(): readonly CasualtyFrame[] { return this.frames; }

  impactTime(eventId: string, side: number, slot: number): number | undefined {
    return this.receipts.find(record => record.eventId === eventId && record.side === side && record.slot === slot)?.impactAt;
  }

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
    return this.frames.some(({ record }) => record.eventId === eventId && record.side === side && record.slot === slot
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
    this.frames.length = 0;
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
      const motion = casualtyLifecycle(life, reducedMotion);
      const eased = motion.fall;
      const p = record.position;
      // Fall backwards into the casualty's own half of the battlefield; protect the entire body.
      const end = { x: p.x - Math.sin(record.yaw) * 0.52, z: p.z - Math.cos(record.yaw) * 0.52 };
      if (!clear(p, end) || fade <= 0) continue;
      const ground = Math.max(this.elevationAt(p.x, p.z), this.elevationAt(end.x, end.z));
      this.frames.push({ record, life, fade, ground: this.elevationAt(p.x, p.z) + (ground - this.elevationAt(p.x, p.z)) * motion.fall, motion });
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
    this.kit.count = this.stains.count = this.groundMarks.count = count;
    this.impacts.count = particles;
    for (const mesh of [this.kit, this.stains, this.groundMarks, this.impacts]) mesh.instanceMatrix.needsUpdate = true;
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
    for (const mesh of [this.kit, this.stains, this.groundMarks, this.impacts]) {
      mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    this.receipts = [];
    this.frames = [];
    this.started.clear();
    this.group.clear();
  }
}
