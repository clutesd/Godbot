import * as THREE from 'three';
import type { HistoricalEvent, SimulationState, War } from '../../sim/types';
import { campaignPoint } from '../../sim/war/Campaign';
import { deriveMilitaryProfile, militaryProfileForWar, type MilitaryCapabilityProfile } from '../../sim/war/MilitaryCapability';
import { WalkabilityLayer } from '../../sim/people/WalkabilityLayer';
import type { PedestrianFootprint } from '../../sim/people/StructureNavigation';
import { BattleAftermath } from './BattleAftermath';
import { combatPose, engagementGap, figurePosition } from './CombatChoreography';
import { BattleSpectacle, type StructuralBattleEvidence } from './BattleSpectacle';
import { militaryVisualStyle, type MilitaryVisualStyle, type PrimaryWeaponVisual } from './MilitaryVisualLanguage';
import { CosmicRoleAccents, COSMIC_HEIGHT_MULTIPLIER, cosmicRoleFor, createCosmicBodyGeometry, createCosmicHeadGeometry, createCosmicBodyMaterial, updateCosmicBodyMaterial } from '../people/CosmicPeople';

interface Standard {
  pole: THREE.Mesh;
  cloth: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  rest: Float32Array<ArrayBufferLike>;
}

interface SupportVisual {
  kind: 'artillery' | 'vehicle';
  group: THREE.Group;
  barrel?: THREE.Object3D;
  index: number;
}

interface Company {
  accents: CosmicRoleAccents;
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  legs: THREE.InstancedMesh;
  arms: THREE.InstancedMesh;
  shield: THREE.InstancedMesh;
  helmet: THREE.InstancedMesh;
  weapon: THREE.InstancedMesh;
  weaponGeometry: THREE.BufferGeometry;
  standard: Standard;
  camp: THREE.Group;
  support: SupportVisual[];
  profile: MilitaryCapabilityProfile;
  style: MilitaryVisualStyle;
  progress: number;
}

interface CampaignVisual {
  group: THREE.Group;
  war: War;
  companies: [Company, Company];
  profiles: [MilitaryCapabilityProfile, MilitaryCapabilityProfile];
  dust: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  spectacle: BattleSpectacle;
  aftermath: BattleAftermath;
  eventId?: string;
  eventMode?: unknown;
  event?: HistoricalEvent;
  evidenceMonth: number;
  lastBattleCount: number;
  battleTime: number;
  route: THREE.Line;
}

const MAX_CAMPAIGNS = 4;
const MAX_FIGURES = 20;
const COMPANY_BODY_SCALE = 0.28 * COSMIC_HEIGHT_MULTIPLIER;
const clamp = THREE.MathUtils.clamp;

/**
 * Persistent, bounded documentary formations. Step 3 makes the frozen military capability visible
 * without adding simulation side effects: formations, carried equipment, support weapons and battle
 * spectacle all read the mobilization snapshot that Step 2 already uses for physical consequences.
 */
export class WarRenderer {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, CampaignVisual>();
  private readonly walking: WalkabilityLayer;
  private readonly bodyGeometry = createCosmicBodyGeometry();
  private readonly headGeometry = createCosmicHeadGeometry();
  private readonly legGeometry = new THREE.BoxGeometry(0.035, 0.095, 0.035);
  private readonly shieldGeometry = new THREE.CylinderGeometry(0.065, 0.065, 0.018, 6);
  private readonly helmetGeometry = new THREE.SphereGeometry(0.052, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.58);
  private readonly poleGeometry = new THREE.CylinderGeometry(0.013, 0.018, 1.5, 5);
  private readonly tentGeometry = new THREE.ConeGeometry(0.48, 0.65, 4);
  private readonly dustGeometry = new THREE.IcosahedronGeometry(1, 0);
  private readonly wheelGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.045, 8);
  private readonly artilleryCarriageGeometry = new THREE.BoxGeometry(0.3, 0.1, 0.4);
  private readonly artilleryBarrelGeometry = new THREE.CylinderGeometry(0.025, 0.038, 0.58, 6);
  private readonly vehicleBodyGeometry = new THREE.BoxGeometry(0.44, 0.15, 0.64);
  private readonly vehicleCabGeometry = new THREE.BoxGeometry(0.3, 0.15, 0.26);
  private readonly matrix = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private lastMonth = -1;
  private lastFocus?: string;
  private disposed = false;

  constructor(private readonly state: SimulationState, private readonly elevationAt: (x: number, z: number) => number) {
    this.walking = new WalkabilityLayer(state.world);
    this.group.name = 'Witnessed campaigns';
  }

  get report(): { campaigns: number; figures: number; budget: number } {
    return { campaigns: this.visuals.size, figures: [...this.visuals.values()].reduce((n, v) => n + v.companies.reduce((sum, c) => sum + c.body.count, 0), 0), budget: MAX_CAMPAIGNS * MAX_FIGURES * 2 };
  }

  setStructures(structures: readonly PedestrianFootprint[]): void { this.walking.setStructures(structures); }

  /** Submit only identified structural facts; empty evidence clears repaired/extinguished sites. */
  setStructuralEvidence(warId: string, evidence: readonly StructuralBattleEvidence[]): void {
    this.visuals.get(warId)?.spectacle.setStructuralEvidence(evidence);
  }

  updateDaylight(daylight: number): void {
    for (const visual of this.visuals.values()) for (const company of visual.companies) {
      updateCosmicBodyMaterial(company.body.material as THREE.MeshStandardMaterial, daylight);
      company.accents.updateDaylight(daylight);
    }
  }

  update(delta: number, elapsed: number, focusId?: string, reducedMotion = false): void {
    if (this.disposed) return;
    if (this.lastMonth !== this.state.month || this.lastFocus !== focusId) {
      this.sync(elapsed, focusId);
      this.lastMonth = this.state.month;
      this.lastFocus = focusId;
    }
    const time = reducedMotion ? 0 : elapsed;
    for (const visual of this.visuals.values()) {
      const war = visual.war;
      const a = this.state.settlements.find(s => s.id === war.attacker);
      const b = this.state.settlements.find(s => s.id === war.defender);
      if (!a || !b) continue;
      const resolved = war.resolvedMonth !== undefined;
      const fade = resolved ? clamp(1 - (this.state.month - war.resolvedMonth!) / 12, 0, 1) : 1;
      if (visual.evidenceMonth !== this.state.month || visual.lastBattleCount !== war.campaign.battleCount) {
        let event: HistoricalEvent | undefined;
        for (let i = this.state.history.length - 1; i >= 0; i--) {
          const candidate = this.state.history[i]!;
          if (candidate.type === 'battle' && candidate.actors.includes(war.id) && candidate.month <= this.state.month) { event = candidate; break; }
        }
        visual.event = event;
        visual.eventId = event?.id;
        visual.eventMode = event?.context['engagementMode'];
        visual.aftermath.sync(war, this.state.history, this.state.month, elapsed, [visual.companies[0].style, visual.companies[1].style]);
        visual.evidenceMonth = this.state.month;
      }
      visual.spectacle.beginWeapons();
      const gap = engagementGap([visual.companies[0].style, visual.companies[1].style], visual.eventMode);
      const front = 0.76 + clamp(war.progress, -1, 1) * 0.08;
      const frontPoint = war.phase === 'battle' && visual.event?.location ? visual.event.location : campaignPoint(war.campaign.route, front, b.position);
      const frontBefore = campaignPoint(war.campaign.route, front - 0.006, a.position);
      const frontAfter = campaignPoint(war.campaign.route, front + 0.006, b.position);
      const frontYaw = Math.atan2(frontAfter.x - frontBefore.x, frontAfter.z - frontBefore.z);
      const separation = gap / (2 * Math.max(1, war.campaign.distance));
      const retreat = resolved ? clamp((this.state.month - war.resolvedMonth!) / 4, 0, 1)
        : war.phase === 'retreat' || war.phase === 'negotiation' ? clamp((elapsed - visual.battleTime) / 8, 0, 1) : 0;
      const targets = [
        war.phase === 'mobilizing' ? 0.12 : war.phase === 'marching' ? 0.12 + war.marchProgress * 0.62 : war.phase === 'retreat' || war.phase === 'negotiation' ? THREE.MathUtils.lerp(front - separation, 0.12, retreat) : front - separation,
        war.phase === 'mobilizing' || war.phase === 'marching' ? 0.84 : war.phase === 'occupation' || war.phase === 'negotiation' ? THREE.MathUtils.lerp(front + separation, 0.95, retreat) : front + separation,
      ];
      if (war.campaign.battleCount !== visual.lastBattleCount) {
        visual.battleTime = elapsed;
        visual.lastBattleCount = war.campaign.battleCount;
      }
      const battlePulse = !resolved && visual.event?.month === this.state.month && war.phase === 'battle' && war.campaign.blockedMonths === 0
        ? clamp(1 - (elapsed - visual.battleTime) / 7, 0, 1)
        : 0;

      visual.companies.forEach((company, side) => {
        const target = targets[side]!;
        company.progress = reducedMotion || war.phase === 'battle' && Boolean(visual.event) ? target : THREE.MathUtils.lerp(company.progress, target, 1 - Math.exp(-Math.max(0, delta) * 1.5));
        const fallback = side === 0 ? a.position : b.position;
        const center = campaignPoint(war.campaign.route, company.progress, fallback);
        const forward = campaignPoint(war.campaign.route, clamp(company.progress + (side === 0 ? 0.006 : -0.006), 0, 1), fallback);
        const engaged = war.phase === 'battle' && war.campaign.blockedMonths === 0;
        const yaw = engaged ? frontYaw + side * Math.PI : Math.atan2(forward.x - center.x, forward.z - center.z);
        const approach = engaged && !visual.event ? Math.max(0, (side === 0 ? -1 : 1) * ((center.x - frontPoint.x) * Math.sin(frontYaw) + (center.z - frontPoint.z) * Math.cos(frontYaw)) - gap / 2) : 0;
        const strength = side === 0 ? war.strengthA : war.strengthB;
        const count = strength <= 0 ? 0 : Math.min(MAX_FIGURES, Math.max(3, Math.ceil(Math.sqrt(strength) * 3)));
        const moving = !reducedMotion && (Math.abs(target - company.progress) > 0.002 || war.phase === 'marching') && war.campaign.blockedMonths === 0;
        let visible = 0;
        for (let i = 0; i < count; i++) {
          if (engaged && visual.aftermath.suppress(visual.eventId, side, i, elapsed, reducedMotion)) continue;
          const rank = Math.floor(i / company.style.rankWidth);
          const slot = i % company.style.rankWidth;
          const centeredSlot = slot - (Math.min(company.style.rankWidth, count - rank * company.style.rankWidth) - 1) / 2;
          const formationJitter = Math.min(0.025, company.style.jitter) * Math.sin(i * 12.9898 + side * 31.17);
          const lateral = centeredSlot * Math.max(0.22, company.style.lateralSpacing) + formationJitter;
          const fraction = company.progress + (side === 0 ? -1 : 1) * rank * company.style.depthSpacing / Math.max(1, war.campaign.distance);
          const base = campaignPoint(war.campaign.route, fraction, fallback);
          const p = engaged ? figurePosition(frontPoint, frontYaw, gap + approach * 2, company.style, side, i) : {
            x: base.x + Math.cos(yaw) * lateral + Math.sin(i * 3.17) * company.style.jitter * 0.25,
            z: base.z - Math.sin(yaw) * lateral + Math.cos(i * 2.31) * company.style.jitter * 0.25,
          };
          // Never collapse blocked slots onto the centerline (which stacks whole ranks).
          if (!this.walking.isSegmentWalkable(engaged ? p : base, p)) continue;
          const pose = combatPose(company.style, i, side, Number.isFinite(visual.battleTime) ? elapsed - visual.battleTime : 0, engaged && approach < 0.08 && battlePulse > 0 && i < company.style.rankWidth && (gap <= 0.6 || ['bow', 'rifle', 'automatic'].includes(company.style.weapon)), reducedMotion, visual.companies[1 - side]!.style);
          const poseX = p.x + Math.sin(yaw) * pose.advance;
          const poseZ = p.z + Math.cos(yaw) * pose.advance;
          const weaponExtent = pose.reach + (company.style.weapon === 'spear' ? 0.25 : 0.16);
          const tip = { x: poseX + Math.sin(yaw) * weaponExtent, z: poseZ + Math.cos(yaw) * weaponExtent };
          if (!this.walking.isSegmentWalkable(p, tip)) continue;
          p.x = poseX; p.z = poseZ;
          if (!this.walking.isWalkable(p) || visual.aftermath.occupies(p, visual.eventId, elapsed, reducedMotion)) continue;
          const step = reducedMotion ? 0 : Math.sin(time * 8 + i * 1.9 + side) * (moving && !engaged ? 1 : pose.attack * 0.25);
          const ground = this.elevationAt(p.x, p.z);
          this.part(company.body, visible, p.x, ground + 0.16 + Math.abs(step) * 0.012, p.z, yaw, pose.lean, fade * COMPANY_BODY_SCALE);
          company.accents.set(visible, 'soldier', this.matrix.matrix, 1);
          this.part(company.head, visible, p.x + Math.sin(yaw) * pose.lean * 0.12, ground + 0.285 + Math.abs(step) * 0.012, p.z + Math.cos(yaw) * pose.lean * 0.12, yaw, pose.lean, fade * COMPANY_BODY_SCALE);
          for (let leg = 0; leg < 2; leg++) {
            const offset = (leg === 0 ? -1 : 1) * 0.03;
            this.part(company.legs, visible * 2 + leg, p.x + Math.cos(yaw) * offset, ground + 0.052, p.z - Math.sin(yaw) * offset, yaw, step * (leg === 0 ? 0.6 : -0.6), fade);
          }
          for (let arm = 0; arm < 2; arm++) {
            const lateralArm = arm === 0 ? -0.05 : 0.05;
            const armPitch = engaged ? (arm === 0 && company.style.shields ? 0.8 + pose.brace * 0.35 : 0.9 + pose.attack * 0.55) : -step * 0.4;
            this.part(company.arms, visible * 2 + arm, p.x + Math.cos(yaw) * lateralArm + Math.sin(yaw) * 0.025,
              ground + 0.195, p.z - Math.sin(yaw) * lateralArm + Math.cos(yaw) * 0.025, yaw, armPitch, fade);
          }
          const combatReady = engaged;
          if (company.style.shields) {
            const shieldForward = combatReady && (company.style.weapon === 'spear' || company.style.weapon === 'club' || company.style.weapon === 'bow') ? 0.08 : 0.045;
            this.part(company.shield, visible, p.x + Math.sin(yaw) * shieldForward, ground + 0.18, p.z + Math.cos(yaw) * shieldForward, yaw, Math.PI / 2 - pose.brace * 0.22, fade);
          }
          if (company.style.armour) this.part(company.helmet, visible, p.x, ground + 0.305 + Math.abs(step) * 0.012, p.z, yaw, 0, fade);
          const weaponForward = combatReady ? pose.reach - pose.recoil * 0.03 : 0.045;
          const weaponPitch = combatReady ? pose.pitch : this.weaponPitch(company.style.weapon, false, step);
          this.part(company.weapon, visible, p.x + Math.sin(yaw) * weaponForward, ground + 0.205, p.z + Math.cos(yaw) * weaponForward, yaw, weaponPitch, fade);
          if (engaged && pose.ranged) visual.spectacle.weaponAttack(p.x, ground + 0.205, p.z, yaw, gap, company.style.weapon, pose.flash, pose.flight, fade);
          visible++;
        }
        company.body.count = company.head.count = company.weapon.count = visible;
        company.accents.mesh.count = visible;
        company.accents.endFrame();
        company.legs.count = company.arms.count = visible * 2;
        company.shield.count = company.style.shields ? visible : 0;
        company.helmet.count = company.style.armour ? visible : 0;
        for (const mesh of [company.body, company.head, company.legs, company.arms, company.shield, company.helmet, company.weapon]) mesh.instanceMatrix.needsUpdate = true;

        const bannerPoint = campaignPoint(war.campaign.route, company.progress, fallback);
        bannerPoint.x += -Math.sin(yaw) * 0.8 + Math.cos(yaw) * 1.05;
        bannerPoint.z += -Math.cos(yaw) * 0.8 - Math.sin(yaw) * 1.05;
        const safeBanner = this.walking.isWalkable(bannerPoint) && visible > 0;
        company.standard.pole.visible = company.standard.cloth.visible = safeBanner;
        const bannerGround = this.elevationAt(bannerPoint.x, bannerPoint.z);
        company.standard.pole.position.set(bannerPoint.x, bannerGround + 0.75, bannerPoint.z);
        company.standard.cloth.position.set(bannerPoint.x, bannerGround + 1.27, bannerPoint.z);
        company.standard.cloth.rotation.y = yaw;
        company.standard.cloth.material.opacity = fade;
        const position = company.standard.cloth.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          const x = company.standard.rest[i * 3]!;
          position.setZ(i, Math.sin(x * 8 - time * 3 + side) * x * 0.18);
        }
        position.needsUpdate = true;
        company.standard.cloth.geometry.computeVertexNormals();
        company.camp.visible = !resolved && (war.phase === 'mobilizing' || war.phase === 'marching') && war.campaign.route.length > 1;
        this.updateSupport(company, center, yaw, visible, moving, reducedMotion ? 0 : battlePulse, time, fade);
      });

      visual.route.visible = focusId === war.id && war.campaign.route.length > 1;
      const dustCenter = campaignPoint(war.campaign.route, front, b.position);
      const dustBudget = Math.min(14, Math.round((visual.companies[0].style.dust + visual.companies[1].style.dust) * 0.5));
      visual.dust.count = !reducedMotion && battlePulse > 0 ? dustBudget : 0;
      visual.dust.material.opacity = battlePulse * 0.065;
      for (let i = 0; i < visual.dust.count; i++) {
        const life = ((elapsed - visual.battleTime) * 0.3 + i / Math.max(1, dustBudget)) % 1;
        const angle = i * 2.399;
        const p = { x: dustCenter.x + Math.cos(angle) * life * 1.5, z: dustCenter.z + Math.sin(angle) * life * 1.5 };
        const size = (0.08 + life * 0.25) * Math.sin(life * Math.PI);
        this.part(visual.dust, i, p.x, this.elevationAt(p.x, p.z) + life * 0.7 + 0.15, p.z, angle, life, size);
      }
      visual.dust.instanceMatrix.needsUpdate = true;
      visual.aftermath.update(this.state.month, elapsed, reducedMotion, (start, end) => this.walking.isSegmentWalkable(start, end));
      visual.spectacle.update(war, [a, b], visual.profiles, elapsed, battlePulse, fade, reducedMotion, visual.battleTime);
    }
  }

  private weaponPitch(weapon: PrimaryWeaponVisual, combatReady: boolean, step: number): number {
    if (weapon === 'rifle' || weapon === 'automatic') return combatReady ? 0 : -0.42 + step * 0.03;
    if (weapon === 'bow') return combatReady ? 0.2 : 0.05;
    if (weapon === 'spear') return combatReady ? 0.52 : 0.08 + step * 0.06;
    return combatReady ? 0.35 : 0.08 + step * 0.04;
  }

  private updateSupport(company: Company, center: { x: number; z: number }, yaw: number, visible: number, moving: boolean, battlePulse: number, time: number, fade: number): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const lateralX = Math.cos(yaw);
    const lateralZ = -Math.sin(yaw);
    company.support.forEach(support => {
      support.group.visible = visible > 0 && fade > 0.02;
      if (!support.group.visible) return;
      const lane = (support.index - 0.5) * 0.72;
      const behind = Math.ceil(MAX_FIGURES / company.style.rankWidth) * Math.max(0.28, company.style.depthSpacing) + (support.kind === 'vehicle' ? 0.5 : 0.65);
      const x = center.x - forwardX * behind + lateralX * lane;
      const z = center.z - forwardZ * behind + lateralZ * lane;
      if (!this.walking.isSegmentWalkable({ x: x - 0.35, z: z - 0.35 }, { x: x + 0.35, z: z + 0.35 })) { support.group.visible = false; return; }
      support.group.position.set(x, this.elevationAt(x, z) + (support.kind === 'vehicle' ? 0.12 : 0.1), z);
      support.group.rotation.y = yaw;
      const bob = moving ? Math.sin(time * 6 + support.index * 1.7) * 0.018 : 0;
      support.group.position.y += bob;
      if (support.barrel) {
        const recoil = battlePulse * Math.max(0, Math.sin(time * 8 + support.index * 2.4)) * 0.08;
        support.barrel.position.z = 0.23 - recoil;
      }
    });
  }

  private part(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, pitch: number, scale: number): void {
    this.matrix.position.set(x, y, z);
    this.matrix.rotation.set(pitch, yaw, 0, 'YXZ');
    this.matrix.scale.setScalar(scale);
    this.matrix.updateMatrix();
    mesh.setMatrixAt(i, this.matrix.matrix);
  }

  private sync(elapsed: number, focusId?: string): void {
    const wars = this.state.wars.filter(w => w.active || (w.resolvedMonth !== undefined && this.state.month - w.resolvedMonth < 12))
      .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || Number(b.resolvedMonth === undefined) - Number(a.resolvedMonth === undefined) || b.startMonth - a.startMonth)
      .slice(0, MAX_CAMPAIGNS);
    const ids = new Set(wars.map(w => w.id));
    for (const [id, visual] of this.visuals) {
      if (ids.has(id)) continue;
      this.release(visual);
      this.visuals.delete(id);
    }
    for (const war of wars) {
      const existing = this.visuals.get(war.id);
      if (existing && existing.war === war && this.state.month >= this.lastMonth) continue;
      if (existing) { this.release(existing); this.visuals.delete(war.id); }
      const attacker = this.state.settlements.find(s => s.id === war.attacker);
      const defender = this.state.settlements.find(s => s.id === war.defender);
      if (!attacker || !defender) continue;
      const profiles: [MilitaryCapabilityProfile, MilitaryCapabilityProfile] = [
        militaryProfileForWar(war, 'attacker') ?? deriveMilitaryProfile(attacker),
        militaryProfileForWar(war, 'defender') ?? deriveMilitaryProfile(defender),
      ];
      const group = new THREE.Group();
      group.name = war.id;
      const companies = [
        this.company(war, war.attacker, 0, group, profiles[0]),
        this.company(war, war.defender, 1, group, profiles[1]),
      ] as [Company, Company];
      const dust = new THREE.InstancedMesh(this.dustGeometry, new THREE.MeshBasicMaterial({ color: '#c6ad85', transparent: true, opacity: 0.15, depthWrite: false }), 14);
      dust.frustumCulled = false;
      const points = war.campaign.route.map(p => new THREE.Vector3(p.x, this.elevationAt(p.x, p.z) + 0.065, p.z));
      const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: '#e6c78b', transparent: true, opacity: 0.22, dashSize: 0.3, gapSize: 0.42, depthWrite: false }));
      route.computeLineDistances();
      const spectacle = new BattleSpectacle(this.elevationAt);
      const aftermath = new BattleAftermath(this.elevationAt);
      group.add(dust, route, spectacle.group, aftermath.group);
      this.group.add(group);
      this.visuals.set(war.id, { group, war, companies, profiles, dust, spectacle, aftermath, evidenceMonth: -1, route, lastBattleCount: war.campaign.battleCount, battleTime: war.campaign.lastBattleMonth === this.state.month ? elapsed : -Infinity });
    }
  }

  private company(war: War, settlementId: string, side: 0 | 1, group: THREE.Group, profile: MilitaryCapabilityProfile): Company {
    const settlement = this.state.settlements.find(s => s.id === settlementId)!;
    const cultureId = Object.entries(settlement.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0];
    const culture = this.state.cultures.find(c => c.id === cultureId);
    const primary = culture?.style.primary ?? (side === 0 ? '#b86750' : '#5c8a89');
    const accent = culture?.style.accent ?? '#ddba76';
    const style = militaryVisualStyle(profile);
    const material = new THREE.MeshStandardMaterial({ color: primary, roughness: style.doctrine === 'combined-arms' ? 0.72 : 0.9, metalness: style.armour ? 0.08 : 0 });
    const cosmic = createCosmicBodyMaterial(false);
    const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.75, metalness: style.armour ? 0.12 : 0 });
    const dark = new THREE.MeshStandardMaterial({ color: '#433b35', roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: '#5b5e5b', roughness: 0.66, metalness: 0.18 });
    const body = new THREE.InstancedMesh(this.bodyGeometry, cosmic, MAX_FIGURES);
    const head = new THREE.InstancedMesh(this.headGeometry, cosmic, MAX_FIGURES);
    const legs = new THREE.InstancedMesh(this.legGeometry, cosmic, MAX_FIGURES * 2);
    const arms = new THREE.InstancedMesh(this.legGeometry, cosmic, MAX_FIGURES * 2);
    const accents = new CosmicRoleAccents(MAX_FIGURES);
    this.color.set(cosmicRoleFor('soldier').color);
    for (const mesh of [body, head, legs, arms]) for (let i = 0; i < mesh.instanceMatrix.count; i++) mesh.setColorAt(i, this.color);
    const shield = new THREE.InstancedMesh(this.shieldGeometry, trim, MAX_FIGURES);
    const helmet = new THREE.InstancedMesh(this.helmetGeometry, metal, MAX_FIGURES);
    const weaponGeometry = this.makeWeaponGeometry(style.weapon);
    const weapon = new THREE.InstancedMesh(weaponGeometry, style.weapon === 'rifle' || style.weapon === 'automatic' ? metal : dark, MAX_FIGURES);
    for (const mesh of [body, head, legs, arms, shield, helmet, weapon]) {
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    const pole = new THREE.Mesh(this.poleGeometry, dark);
    const clothGeometry = new THREE.PlaneGeometry(0.58, 0.38, 8, 3).translate(0.29, 0, 0);
    const cloth = new THREE.Mesh(clothGeometry, new THREE.MeshStandardMaterial({ color: accent, side: THREE.DoubleSide, roughness: 0.85, transparent: true }));
    const pos = clothGeometry.getAttribute('position');
    const rest = new Float32Array(pos.array as ArrayLike<number>);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      this.color.set(Math.abs(pos.getY(i)) < 0.065 || pos.getX(i) > 0.47 ? primary : accent);
      this.color.toArray(colors, i * 3);
    }
    clothGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    cloth.material.color.set('white');
    cloth.material.vertexColors = true;

    const camp = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const base = campaignPoint(war.campaign.route, side === 0 ? 0.1 : 0.88, settlement.position);
      const p = { x: base.x + (i - 1) * 1.05, z: base.z + (side === 0 ? -1.6 : 1.6) };
      if (!this.walking.isSegmentWalkable(base, p)) continue;
      const tent = new THREE.Mesh(this.tentGeometry, material);
      tent.position.set(p.x, this.elevationAt(p.x, p.z) + 0.325, p.z);
      tent.rotation.y = Math.PI / 4;
      camp.add(tent);
    }

    const support: SupportVisual[] = [];
    for (let i = 0; i < style.artillery; i++) support.push(this.makeArtillery(i, material, dark, metal));
    for (let i = 0; i < style.vehicles; i++) support.push(this.makeVehicle(i, material, dark, metal));
    group.add(body, head, legs, arms, accents.mesh, shield, helmet, weapon, pole, cloth, camp, ...support.map(item => item.group));
    const initial = war.phase === 'mobilizing' ? (side === 0 ? 0.12 : 0.84)
      : war.phase === 'marching' ? (side === 0 ? 0.12 + war.marchProgress * 0.62 : 0.84)
        : 0.76 + clamp(war.progress, -1, 1) * 0.08 + (side === 0 ? -0.015 : 0.015);
    return { body, head, legs, arms, accents, shield, helmet, weapon, weaponGeometry, standard: { pole, cloth, rest }, camp, support, profile, style, progress: initial };
  }

  private makeWeaponGeometry(weapon: PrimaryWeaponVisual): THREE.BufferGeometry {
    if (weapon === 'spear') return new THREE.CylinderGeometry(0.009, 0.012, 0.5, 5);
    if (weapon === 'bow') return new THREE.TorusGeometry(0.11, 0.008, 4, 8, Math.PI);
    if (weapon === 'rifle') return new THREE.BoxGeometry(0.026, 0.03, 0.3);
    if (weapon === 'automatic') return new THREE.BoxGeometry(0.034, 0.036, 0.32);
    return new THREE.BoxGeometry(0.035, 0.24, 0.035);
  }

  private makeArtillery(index: number, material: THREE.Material, dark: THREE.Material, metal: THREE.Material): SupportVisual {
    const group = new THREE.Group();
    group.name = `artillery-${index}`;
    const carriage = new THREE.Mesh(this.artilleryCarriageGeometry, material);
    carriage.position.y = 0.08;
    const barrel = new THREE.Mesh(this.artilleryBarrelGeometry, metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.2, 0.23);
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(this.wheelGeometry, dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.18, 0.08, 0);
      group.add(wheel);
    }
    group.add(carriage, barrel);
    group.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    return { kind: 'artillery', group, barrel, index };
  }

  private makeVehicle(index: number, material: THREE.Material, dark: THREE.Material, metal: THREE.Material): SupportVisual {
    const group = new THREE.Group();
    group.name = `vehicle-${index}`;
    const body = new THREE.Mesh(this.vehicleBodyGeometry, material);
    body.position.y = 0.14;
    const cab = new THREE.Mesh(this.vehicleCabGeometry, metal);
    cab.position.set(0, 0.26, -0.08);
    for (const x of [-0.19, 0.19]) {
      for (const z of [-0.22, 0.22]) {
        const wheel = new THREE.Mesh(this.wheelGeometry, dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.08, z);
        group.add(wheel);
      }
    }
    group.add(body, cab);
    group.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    return { kind: 'vehicle', group, index };
  }

  private release(visual: CampaignVisual): void {
    // Child systems own their pools and resources. Detach before the shared-company traversal.
    visual.group.remove(visual.spectacle.group, visual.aftermath.group);
    visual.spectacle.dispose();
    visual.aftermath.dispose();
    const materials = new Set<THREE.Material>();
    visual.group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => materials.add(material));
      }
    });
    materials.forEach(material => material.dispose());
    visual.companies.forEach(company => {
      company.accents.mesh.geometry.dispose();
      company.standard.cloth.geometry.dispose();
      company.weaponGeometry.dispose();
    });
    visual.route.geometry.dispose();
    this.group.remove(visual.group);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const visual of this.visuals.values()) this.release(visual);
    this.visuals.clear();
    for (const geometry of [
      this.bodyGeometry, this.headGeometry, this.legGeometry, this.shieldGeometry, this.helmetGeometry,
      this.poleGeometry, this.tentGeometry, this.dustGeometry, this.wheelGeometry, this.artilleryCarriageGeometry,
      this.artilleryBarrelGeometry, this.vehicleBodyGeometry, this.vehicleCabGeometry,
    ]) geometry.dispose();
  }
}
