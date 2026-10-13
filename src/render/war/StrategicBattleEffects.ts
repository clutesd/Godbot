import * as THREE from 'three';
import type { HistoricalEvent, SimulationState, Vec2 } from '../../sim/types';
import { militaryProfileForWar } from '../../sim/war/MilitaryCapability';
import { campaignFocus } from '../../sim/war/Campaign';
import { battleAtmosphereMaterial } from './BattleAtmosphere';
import { ResolvedImpactEffects } from './ResolvedImpactEffects';
import { nuclearExposure } from '../../sim/war/BattleCasualties';
import { stableHash } from '../../sim/prng';

const clamp = THREE.MathUtils.clamp;

/** An authored cinematic scale, never a physical blast/yield or biological spread model. */
export function strategicCloudFrame(age: number, hydrogen: boolean) {
  const t = Math.max(0, age);
  const scale = hydrogen ? 1.65 : 1;
  const rise = (1 - Math.exp(-t * 0.2)) * 3.3 * scale;
  return { rise, capRadius: (0.25 + (1 - Math.exp(-t * 0.35)) * 1.5) * scale,
    flash: t < 0.8 ? Math.sin(Math.PI * t / 0.8) ** 2 : 0,
    opacity: clamp(1 - Math.max(0, t - 18) / 24, 0, 1), scale };
}

interface Site {
  fireball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  scorch: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
}

/** Nuclear effects require a recorded nuclear-use/exchange. Biological presentation is an
 * abstract warning and humanitarian response: no agents, dispersal or transmission mechanics. */
export class StrategicBattleEffects {
  readonly group = new THREE.Group();
  private readonly matrix = new THREE.Object3D();
  private readonly cloudGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly opacity = new THREE.InstancedBufferAttribute(new Float32Array(192), 1).setUsage(THREE.DynamicDrawUsage);
  private readonly cloud: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly sites: Site[] = [];
  private readonly arsenals: THREE.Group[] = [];
  private readonly medical: THREE.Group[] = [];
  private readonly warnings = new THREE.Group();
  private readonly impacts: ResolvedImpactEffects;
  private lastHistoryLength = -1;
  private lastMonth = -1;
  private lastEventId?: string;
  private event?: HistoricalEvent;
  private eventStarted = 0;
  private disposed = false;

  /** Cull documentary formations only after a recorded blast reaches their position. */
  casualtyAt(position: Vec2, elapsed: number, reducedMotion: boolean, identity = 'formation', notBeforeMonth = 0): boolean {
    const event = this.event;
    if (!event || event.month < notBeforeMonth) return false;
    const sites = event.blastSites ?? (event.location ? [event.location] : []);
    const age = elapsed - this.eventStarted + Math.max(0, this.lastMonth - event.month) * 45;
    const arrived = sites.filter((site, index) => {
      const distance = Math.hypot(position.x - site.x, position.z - site.z);
      return reducedMotion || age >= index * 2.4 + 0.15 + distance * 0.06;
    });
    return stableHash(`${event.id}:${identity}:formation`) < nuclearExposure(position, arrived, event.context.nuclearWeapon === 'hydrogen');
  }

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Late-era strategic warfare';
    this.impacts = new ResolvedImpactEffects(elevationAt); this.group.add(this.impacts.group);
    this.cloudGeometry.setAttribute('effectOpacity', this.opacity);
    this.cloud = new THREE.InstancedMesh(this.cloudGeometry, battleAtmosphereMaterial('#8c8170', 0.48, true), 192);
    this.cloud.name = 'Nuclear mushroom cloud'; this.cloud.count = 0; this.cloud.frustumCulled = false;
    this.cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(this.cloud);
    for (let side = 0; side < 2; side++) {
      const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({
        color: '#ffd5a1', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      fireball.name = `Nuclear fireball ${side}`;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.91, 1, 96), new THREE.MeshBasicMaterial({
        color: '#d7c7a5', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2; ring.name = `Nuclear shock front ${side}`;
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({
        color: '#332d27', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
      }));
      scorch.rotation.x = -Math.PI / 2; scorch.name = `Recorded nuclear ground scar ${side}`;
      fireball.visible = ring.visible = scorch.visible = false;
      this.sites.push({ fireball, ring, scorch }); this.group.add(fireball, ring, scorch);
      const arsenal = this.makeArsenal(side), medical = this.makeMedical(side);
      this.arsenals.push(arsenal); this.medical.push(medical); this.group.add(arsenal, medical);
    }
    this.warnings.name = 'Abstract biological crisis markers';
    const triangle = new THREE.Shape(); triangle.moveTo(0, 0.1); triangle.lineTo(-0.09, -0.07); triangle.lineTo(0.09, -0.07); triangle.closePath();
    const geometry = new THREE.ShapeGeometry(triangle);
    const signMaterial = new THREE.MeshStandardMaterial({ color: '#e5be69', roughness: 0.8, side: THREE.DoubleSide });
    const ink = new THREE.MeshBasicMaterial({ color: '#252b2a', side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const sign = new THREE.Group();
      const board = new THREE.Mesh(geometry, signMaterial);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.23, 0.01), signMaterial); stem.position.y = -0.14;
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.055, 0.002), ink); mark.position.set(0, -0.004, 0.003);
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.002), ink); dot.position.set(0, -0.043, 0.003);
      sign.add(board, stem, mark, dot); this.warnings.add(sign);
    }
    this.warnings.visible = false; this.group.add(this.warnings);
  }

  update(state: SimulationState, elapsed: number, reducedMotion: boolean, focusId?: string): void {
    if (this.disposed) return;
    const lastEventId = state.history.at(-1)?.id;
    if (this.lastHistoryLength !== state.history.length || this.lastMonth !== state.month || this.lastEventId !== lastEventId) {
      let event: HistoricalEvent | undefined;
      for (let i = state.history.length - 1; i >= 0; i--) {
        const candidate = state.history[i]!;
        if (state.month - candidate.month > 36) break;
        if (candidate.month <= state.month && candidate.location && (candidate.type === 'nuclear-use' || candidate.type === 'nuclear-exchange')) { event = candidate; break; }
      }
      if (event?.id !== this.event?.id) this.eventStarted = elapsed;
      this.event = event; this.lastHistoryLength = state.history.length; this.lastMonth = state.month;
      this.lastEventId = lastEventId;
    }
    this.cloud.count = 0;
    const event = this.event;
    const age = event ? Math.max(0, elapsed - this.eventStarted) + Math.max(0, state.month - event.month) * 45 : Infinity;
    this.impacts.update(event?.impacts ?? [], age, reducedMotion);
    const exchange = event?.type === 'nuclear-exchange';
    const hydrogen = event?.context.nuclearWeapon === 'hydrogen';
    this.sites.forEach((site, side) => {
      const active = Boolean(event && (side === 0 || exchange));
      const localAge = age - side * 2.4;
      site.fireball.visible = site.ring.visible = site.scorch.visible = active && localAge >= 0;
      if (!active || localAge < 0) return;
      const p = event!.blastSites?.[side] ?? event!.location!;
      const explicit = Boolean(event!.blastSites?.[side]);
      const x = p.x + (!explicit && exchange ? (side ? 1 : -1) * 2.2 : 0), z = p.z + (!explicit && exchange ? (side ? 1 : -1) * 0.8 : 0);
      const ground = this.elevationAt(x, z);
      const t = reducedMotion ? Math.max(10, localAge) : localAge;
      const frame = strategicCloudFrame(t, hydrogen);
      site.fireball.visible = !reducedMotion && t < 1.4;
      site.fireball.position.set(x, ground + 0.35 * frame.scale, z);
      site.fireball.scale.setScalar((0.12 + Math.min(1.4, t) * 0.85) * frame.scale);
      site.fireball.material.opacity = frame.flash * 0.65;
      site.ring.visible = !reducedMotion && t < 3.6;
      site.ring.position.set(x, ground + 0.026, z); site.ring.scale.setScalar((0.18 + t * 1.5) * frame.scale);
      site.ring.material.opacity = 0.3 * Math.max(0, 1 - t / 3.6);
      site.scorch.position.set(x, ground + 0.018, z); site.scorch.scale.setScalar(1.3 * frame.scale);
      site.scorch.material.opacity = 0.36 * Math.max(0, 1 - Math.max(0, state.month - event!.month) / 36);
      if (frame.opacity <= 0) return;
      const growth = Math.min(1, t / 2);
      // Rising stem, rolling mushroom cap and an expanding dusty foot are separate layers.
      for (let i = 0; i < 20; i++) {
        const fraction = (i + 0.5) / 20;
        const wobble = Math.sin(i * 2.399 + (reducedMotion ? 0 : t * 0.12)) * 0.09 * frame.scale;
        this.puff(x + wobble + t * 0.015, ground + fraction * frame.rise + 0.12, z + Math.cos(i * 2.399) * 0.07,
          (0.14 + fraction * 0.18) * frame.scale * growth, frame.opacity * 0.5 * growth);
      }
      for (let i = 0; i < 44; i++) {
        const angle = i * 2.399 + (reducedMotion ? 0 : t * 0.025);
        const radius = Math.sqrt((i + 0.5) / 44) * frame.capRadius;
        const dome = Math.sqrt(Math.max(0, 1 - (radius / frame.capRadius) ** 2));
        this.puff(x + Math.cos(angle) * radius + t * 0.015,
          ground + frame.rise + dome * 0.45 * frame.scale, z + Math.sin(angle) * radius,
          (0.28 + dome * 0.2) * frame.scale * growth, frame.opacity * 0.62 * growth);
      }
      if (t < 12) for (let i = 0; i < 24; i++) {
        const angle = i * 2.399, radius = Math.sqrt(t) * 0.55 * frame.scale;
        this.puff(x + Math.cos(angle) * radius, ground + 0.14, z + Math.sin(angle) * radius,
          (0.12 + t * 0.035) * frame.scale, (1 - t / 12) * 0.5 * growth);
      }
    });
    this.cloud.instanceMatrix.needsUpdate = this.opacity.needsUpdate = true;
    const war = state.wars.find(candidate => candidate.id === focusId) ?? state.wars.find(candidate => candidate.active);
    const a = state.settlements.find(settlement => settlement.id === war?.attacker);
    const b = state.settlements.find(settlement => settlement.id === war?.defender);
    const front: Vec2 = war && a && b ? campaignFocus(war, a.position, b.position) : { x: 0, z: 0 };
    const yaw = a && b ? Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z) : 0;
    let biological = false;
    for (const side of [0, 1] as const) {
      const profile = war ? militaryProfileForWar(war, side ? 'defender' : 'attacker') : undefined;
      const equipment = profile?.equipment ?? [];
      const armed = equipment.includes('atomic-weapons') || equipment.includes('hydrogen-weapons');
      const bio = equipment.includes('biological-warfare'); biological ||= bio;
      const depth = (side ? 1 : -1) * 4.4;
      const x = front.x + Math.sin(yaw) * depth, z = front.z + Math.cos(yaw) * depth;
      this.arsenals[side]!.visible = Boolean(armed && war?.active);
      this.arsenals[side]!.position.set(x, this.elevationAt(x, z), z);
      this.arsenals[side]!.rotation.y = yaw + side * Math.PI;
      const medicalX = x + Math.cos(yaw) * 0.65, medicalZ = z - Math.sin(yaw) * 0.65;
      this.medical[side]!.visible = Boolean(bio && war?.active);
      this.medical[side]!.position.set(medicalX, this.elevationAt(medicalX, medicalZ), medicalZ);
      this.medical[side]!.rotation.y = yaw;
    }
    this.warnings.visible = Boolean(biological && war?.active && war.phase === 'battle');
    this.warnings.children.forEach((sign, index) => {
      const x = front.x + Math.cos(index * Math.PI / 3) * 1.65, z = front.z + Math.sin(index * Math.PI / 3) * 1.65;
      sign.position.set(x, this.elevationAt(x, z) + 0.28, z); sign.rotation.y = yaw - Math.PI / 2;
    });
    this.group.visible = Boolean(event || this.warnings.visible || this.medical.some(group => group.visible) || this.arsenals.some(group => group.visible));
  }

  private puff(x: number, y: number, z: number, size: number, opacity: number): void {
    if (this.cloud.count >= this.opacity.count || size <= 0 || opacity <= 0) return;
    this.matrix.position.set(x, y, z); this.matrix.rotation.set(0, 0, 0); this.matrix.scale.setScalar(size); this.matrix.updateMatrix();
    this.cloud.setMatrixAt(this.cloud.count, this.matrix.matrix); this.opacity.setX(this.cloud.count++, opacity);
  }

  private makeArsenal(side: number): THREE.Group {
    const group = new THREE.Group(); group.name = `Strategic arsenal ${side}`;
    const concrete = new THREE.MeshStandardMaterial({ color: '#626660', roughness: 0.98 });
    const metal = new THREE.MeshStandardMaterial({ color: '#3d4741', roughness: 0.65, metalness: 0.2 });
    const bunker = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), concrete);
    bunker.scale.set(1.6, 0.7, 1); bunker.position.y = 0.01;
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.035, 24), metal); hatch.position.set(0, 0.027, 0.48);
    const access = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.025), metal); access.position.set(0, 0.06, 0.32);
    group.add(bunker, hatch, access); group.visible = false;
    return group;
  }

  private makeMedical(side: number): THREE.Group {
    const group = new THREE.Group(); group.name = `Biological crisis medical response ${side}`;
    const canvas = new THREE.MeshStandardMaterial({ color: '#adb4a0', roughness: 1 });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.36, 4), canvas); tent.rotation.y = Math.PI / 4; tent.scale.z = 1.35; tent.position.y = 0.18;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.005), new THREE.MeshStandardMaterial({ color: '#eee8d6', roughness: 1 })); panel.position.set(0, 0.17, 0.28);
    const aid = new THREE.MeshStandardMaterial({ color: '#527a70', roughness: 0.9 });
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.082, 0.008), aid), horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.022, 0.008), aid);
    vertical.position.set(0, 0.17, 0.285); horizontal.position.copy(vertical.position);
    group.add(tent, panel, vertical, horizontal); group.visible = false;
    return group;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.remove(this.impacts.group); this.impacts.dispose();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); this.group.clear();
  }
}
