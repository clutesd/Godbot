import * as THREE from 'three';
import type { SimulationState, War } from '../../sim/types';
import { campaignPoint } from '../../sim/war/Campaign';
import { WalkabilityLayer } from '../../sim/people/WalkabilityLayer';

interface Standard {
  pole: THREE.Mesh;
  cloth: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  rest: Float32Array;
}

interface Company {
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  legs: THREE.InstancedMesh;
  shield: THREE.InstancedMesh;
  standard: Standard;
  camp: THREE.Group;
  progress: number;
}

interface CampaignVisual {
  group: THREE.Group;
  war: War;
  companies: [Company, Company];
  dust: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  lastBattleCount: number;
  battleTime: number;
  route: THREE.Line;
}

const MAX_CAMPAIGNS = 4;
const MAX_FIGURES = 20;
const clamp = THREE.MathUtils.clamp;

/** Persistent, bounded documentary formations. Animation has no simulation side effects. */
export class WarRenderer {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, CampaignVisual>();
  private readonly walking: WalkabilityLayer;
  private readonly bodyGeometry = new THREE.ConeGeometry(0.075, 0.17, 5);
  private readonly headGeometry = new THREE.IcosahedronGeometry(0.044, 0);
  private readonly legGeometry = new THREE.BoxGeometry(0.035, 0.095, 0.035);
  private readonly shieldGeometry = new THREE.CylinderGeometry(0.065, 0.065, 0.018, 6);
  private readonly poleGeometry = new THREE.CylinderGeometry(0.013, 0.018, 1.5, 5);
  private readonly tentGeometry = new THREE.ConeGeometry(0.48, 0.65, 4);
  private readonly dustGeometry = new THREE.IcosahedronGeometry(1, 0);
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
      const front = 0.76 + clamp(war.progress, -1, 1) * 0.08;
      const retreat = resolved ? clamp((this.state.month - war.resolvedMonth!) / 4, 0, 1) : 0;
      const targets = [war.phase === 'mobilizing' ? 0.12 : war.phase === 'marching' ? 0.12 + war.marchProgress * 0.62 : war.phase === 'retreat' || war.phase === 'negotiation' ? THREE.MathUtils.lerp(front - 0.015, 0.12, retreat) : front - 0.015,
        war.phase === 'mobilizing' || war.phase === 'marching' ? 0.84 : war.phase === 'occupation' ? THREE.MathUtils.lerp(front + 0.015, 0.95, retreat) : front + 0.015];
      if (war.campaign.battleCount !== visual.lastBattleCount) {
        visual.battleTime = elapsed;
        visual.lastBattleCount = war.campaign.battleCount;
      }
      const battlePulse = !reducedMotion && !resolved && war.phase === 'battle' && war.campaign.blockedMonths === 0 ? clamp(1 - (elapsed - visual.battleTime) / 7, 0, 1) : 0;
      visual.companies.forEach((company, side) => {
        const target = targets[side]!;
        // Smooth the distance along the surveyed path, never a chord through unsafe ground.
        company.progress = reducedMotion ? target : THREE.MathUtils.lerp(company.progress, target, 1 - Math.exp(-Math.max(0, delta) * 1.5));
        const fallback = side === 0 ? a.position : b.position;
        const center = campaignPoint(war.campaign.route, company.progress, fallback);
        const forward = campaignPoint(war.campaign.route, clamp(company.progress + 0.005, 0, 1), fallback);
        const yaw = Math.atan2(forward.x - center.x, forward.z - center.z) + (side === 1 ? Math.PI : 0);
        const strength = side === 0 ? war.strengthA : war.strengthB;
        const count = strength <= 0 ? 0 : Math.min(MAX_FIGURES, Math.max(3, Math.ceil(Math.sqrt(strength) * 3)));
        const moving = !reducedMotion && (Math.abs(target - company.progress) > 0.002 || war.phase === 'marching') && war.campaign.blockedMonths === 0;
        let visible = 0;
        for (let i = 0; i < count; i++) {
          const rank = Math.floor(i / 4);
          const lateral = (i % 4 - 1.5) * (war.phase === 'marching' ? 0.16 : 0.24);
          const fraction = company.progress + (side === 0 ? -1 : 1) * rank * 0.3 / Math.max(1, war.campaign.distance);
          const base = campaignPoint(war.campaign.route, fraction, fallback);
          const p = { x: base.x + Math.cos(yaw) * lateral, z: base.z - Math.sin(yaw) * lateral };
          if (!this.walking.isSegmentWalkable(base, p)) { p.x = base.x; p.z = base.z; }
          if (!this.walking.isWalkable(p)) continue;
          const step = Math.sin(time * 8 + i * 1.9 + side) * (moving ? 1 : battlePulse * 0.3);
          const ground = this.elevationAt(p.x, p.z);
          this.part(company.body, visible, p.x, ground + 0.16 + Math.abs(step) * 0.012, p.z, yaw, 0, fade);
          this.part(company.head, visible, p.x, ground + 0.285 + Math.abs(step) * 0.012, p.z, yaw, 0, fade);
          for (let leg = 0; leg < 2; leg++) {
            const offset = (leg === 0 ? -1 : 1) * 0.03;
            this.part(company.legs, visible * 2 + leg, p.x + Math.cos(yaw) * offset, ground + 0.052, p.z - Math.sin(yaw) * offset, yaw, step * (leg === 0 ? 0.6 : -0.6), fade);
          }
          this.part(company.shield, visible, p.x + Math.sin(yaw) * 0.065, ground + 0.18, p.z + Math.cos(yaw) * 0.065, yaw, Math.PI / 2 - battlePulse * 0.15, fade);
          visible++;
        }
        company.body.count = company.head.count = company.shield.count = visible;
        company.legs.count = visible * 2;
        for (const mesh of [company.body, company.head, company.legs, company.shield]) mesh.instanceMatrix.needsUpdate = true;
        const bannerPoint = campaignPoint(war.campaign.route, company.progress, fallback);
        const safeBanner = this.walking.isWalkable(bannerPoint) && visible > 0;
        company.standard.pole.visible = company.standard.cloth.visible = safeBanner;
        const ground = this.elevationAt(bannerPoint.x, bannerPoint.z);
        company.standard.pole.position.set(bannerPoint.x, ground + 0.75, bannerPoint.z);
        company.standard.cloth.position.set(bannerPoint.x, ground + 1.27, bannerPoint.z);
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
      });
      visual.route.visible = focusId === war.id && war.campaign.route.length > 1;
      const dustCenter = campaignPoint(war.campaign.route, front, b.position);
      visual.dust.count = battlePulse > 0 ? 14 : 0;
      visual.dust.material.opacity = battlePulse * 0.17;
      for (let i = 0; i < visual.dust.count; i++) {
        const life = ((elapsed - visual.battleTime) * 0.3 + i / 14) % 1;
        const angle = i * 2.399;
        const p = { x: dustCenter.x + Math.cos(angle) * life * 1.5, z: dustCenter.z + Math.sin(angle) * life * 1.5 };
        const size = (0.14 + life * 0.45) * Math.sin(life * Math.PI);
        this.part(visual.dust, i, p.x, this.elevationAt(p.x, p.z) + life * 0.7 + 0.15, p.z, angle, life, size);
      }
      visual.dust.instanceMatrix.needsUpdate = true;
    }
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
      .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || Number(b.resolvedMonth === undefined) - Number(a.resolvedMonth === undefined) || b.startMonth - a.startMonth).slice(0, MAX_CAMPAIGNS);
    const ids = new Set(wars.map(w => w.id));
    for (const [id, visual] of this.visuals) {
      if (ids.has(id)) continue;
      this.release(visual);
      this.visuals.delete(id);
    }
    for (const war of wars) {
      if (this.visuals.has(war.id)) continue;
      const group = new THREE.Group();
      group.name = war.id;
      const companies = [war.attacker, war.defender].map((id, side) => this.company(war, id, side, group)) as [Company, Company];
      const dust = new THREE.InstancedMesh(this.dustGeometry, new THREE.MeshBasicMaterial({ color: '#c6ad85', transparent: true, opacity: 0.15, depthWrite: false }), 14);
      dust.frustumCulled = false;
      const points = war.campaign.route.map(p => new THREE.Vector3(p.x, this.elevationAt(p.x, p.z) + 0.065, p.z));
      const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: '#e6c78b', transparent: true, opacity: 0.22, dashSize: 0.3, gapSize: 0.42, depthWrite: false }));
      route.computeLineDistances();
      group.add(dust, route);
      this.group.add(group);
      this.visuals.set(war.id, { group, war, companies, dust, route, lastBattleCount: war.campaign.battleCount, battleTime: war.campaign.lastBattleMonth === this.state.month ? elapsed : -Infinity });
    }
  }

  private company(war: War, settlementId: string, side: number, group: THREE.Group): Company {
    const settlement = this.state.settlements.find(s => s.id === settlementId)!;
    const cultureId = Object.entries(settlement.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0];
    const culture = this.state.cultures.find(c => c.id === cultureId);
    const primary = culture?.style.primary ?? (side === 0 ? '#b86750' : '#5c8a89');
    const accent = culture?.style.accent ?? '#ddba76';
    const material = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: '#c1a17c', roughness: 1 });
    const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: '#433b35', roughness: 1 });
    const body = new THREE.InstancedMesh(this.bodyGeometry, material, MAX_FIGURES);
    const head = new THREE.InstancedMesh(this.headGeometry, skin, MAX_FIGURES);
    const legs = new THREE.InstancedMesh(this.legGeometry, dark, MAX_FIGURES * 2);
    const shield = new THREE.InstancedMesh(this.shieldGeometry, trim, MAX_FIGURES);
    for (const mesh of [body, head, legs, shield]) { mesh.frustumCulled = false; mesh.castShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    const pole = new THREE.Mesh(this.poleGeometry, dark);
    const clothGeometry = new THREE.PlaneGeometry(0.58, 0.38, 8, 3).translate(0.29, 0, 0);
    const cloth = new THREE.Mesh(clothGeometry, new THREE.MeshStandardMaterial({ color: accent, side: THREE.DoubleSide, roughness: 0.85, transparent: true }));
    const pos = clothGeometry.getAttribute('position');
    const rest = new Float32Array(pos.array);
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
    group.add(body, head, legs, shield, pole, cloth, camp);
    const initial = war.phase === 'mobilizing' ? (side === 0 ? 0.12 : 0.84) : war.phase === 'marching' ? (side === 0 ? 0.12 + war.marchProgress * 0.62 : 0.84) : 0.76 + clamp(war.progress, -1, 1) * 0.08 + (side === 0 ? -0.015 : 0.015);
    return { body, head, legs, shield, standard: { pole, cloth, rest }, camp, progress: initial };
  }

  private release(visual: CampaignVisual): void {
    const materials = new Set<THREE.Material>();
    visual.group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => materials.add(material));
      }
    });
    materials.forEach(material => material.dispose());
    visual.companies.forEach(c => c.standard.cloth.geometry.dispose());
    visual.route.geometry.dispose();
    this.group.remove(visual.group);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const visual of this.visuals.values()) this.release(visual);
    this.visuals.clear();
    for (const geometry of [this.bodyGeometry, this.headGeometry, this.legGeometry, this.shieldGeometry, this.poleGeometry, this.tentGeometry, this.dustGeometry]) geometry.dispose();
  }
}
