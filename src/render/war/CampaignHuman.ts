import * as THREE from 'three';
import type { Culture, Person } from '../../sim/types';
import { COSMIC_HEIGHT_MULTIPLIER } from '../people/CosmicPeople';
import { HUMAN_WORLD_SCALE } from '../people/HumanScale';
import { createHumanTorsoGeometry, createHumanHeadGeometry, createHumanUpperArmGeometry, createHumanForearmGeometry, createHumanThighGeometry, createHumanShinGeometry } from '../people/HumanAnatomy';
import { createGarmentAtlasGeometry, createHeadAtlasGeometry, createHumanMantleGeometry } from '../people/HumanWardrobeAtlas';
import { HumanFigureAppearance, type HumanFigureMeshes } from '../people/HumanFigureAppearance';
import { HUMAN_SURFACE_MODE, createHumanSurfaceMaterial, updateHumanSurfaceMaterial } from '../people/HumanSurfaceMaterial';
import { humanLookFor, type HumanLook } from '../people/HumanAppearanceProfile';
import { HumanJointRig } from '../people/HumanJointRig';
import { isFirearmWeapon, type MilitaryVisualStyle } from './MilitaryVisualLanguage';
import type { WeaponPose } from './CombatExchanges';

/** The settlement anatomy and appearance contract, also used for living and fallen combatants.
 * Stable formation slots own identity; the packed draw index may change after a casualty. */
export class CampaignHuman {
  readonly meshes: HumanFigureMeshes;
  readonly appearance: HumanFigureAppearance;
  readonly looks: HumanLook[];
  private readonly root = new THREE.Object3D();
  private readonly torso = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly result = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly rig = new HumanJointRig();
  private readonly target = new THREE.Vector3();
  private readonly weaponFrame = new THREE.Matrix4();
  private readonly shieldFrame = new THREE.Matrix4();

  constructor(capacity: number, people: readonly Person[], culture: Culture | undefined, style: MilitaryVisualStyle, side: number,
    private readonly elevationAt: (x: number, z: number) => number) {
    const torso = createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.torso);
    const head = createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.head);
    const limb = createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.limb);
    const garment = createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.garment);
    const headgear = createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.headgear);
    this.meshes = {
      torso: new THREE.InstancedMesh(createHumanTorsoGeometry(), torso, capacity),
      head: new THREE.InstancedMesh(createHumanHeadGeometry(), head, capacity),
      upperArms: new THREE.InstancedMesh(createHumanUpperArmGeometry(), limb, capacity * 2),
      forearms: new THREE.InstancedMesh(createHumanForearmGeometry(), limb, capacity * 2),
      thighs: new THREE.InstancedMesh(createHumanThighGeometry(), limb, capacity * 2),
      shins: new THREE.InstancedMesh(createHumanShinGeometry(), limb, capacity * 2),
      garments: new THREE.InstancedMesh(createGarmentAtlasGeometry(), garment, capacity),
      headgear: new THREE.InstancedMesh(createHeadAtlasGeometry(), headgear, capacity),
      mantles: new THREE.InstancedMesh(createHumanMantleGeometry(), garment, capacity),
    };
    for (const [part, mesh] of Object.entries(this.meshes)) {
      mesh.name = `Campaign ${part} ${side}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.meshes.torso.name = `Campaign soldiers ${side}`;
    this.appearance = new HumanFigureAppearance(this.meshes);
    this.looks = people.map(person => {
      const look = humanLookFor({ ...person, role: 'soldier' }, { culture });
      // Military protection follows the frozen equipment snapshot, rather than civilian dress.
      if (!style.armour) look.wardrobe.chest = 'none';
      look.wardrobe.drape = 'none';
      look.wardrobe.head = 'none';
      return look;
    });
  }

  draw(index: number, slot: number, x: number, ground: number, z: number, yaw: number,
    pose: WeaponPose, step: number, fade: number, style: MilitaryVisualStyle, weapon: THREE.Matrix4,
    shield: THREE.Matrix4, fall?: THREE.Matrix4, settle = 0): void {
    const look = this.looks[slot % this.looks.length];
    if (!look) return;
    const scale = HUMAN_WORLD_SCALE * COSMIC_HEIGHT_MULTIPLIER * fade;
    const crouch = (pose.ranged ? 0.018 : 0.009) + pose.brace * 0.012;
    this.root.position.set(x, ground + 0.45 * scale * look.proportions.legLength - crouch * (1 - settle), z);
    this.root.rotation.set(0, yaw, 0);
    this.root.scale.setScalar(scale);
    this.root.updateMatrix();
    this.local.makeTranslation(0, -0.01, 0);
    this.torso.multiplyMatrices(this.root.matrix, this.local);
    this.local.makeRotationX(pose.lean);
    this.torso.multiply(this.local);
    this.write(this.meshes.torso, index, this.torso, fall);
    this.appearance.apply(index, look, look.cultureGrammar.pattern);
    this.local.makeTranslation(0, 0.425, 0);
    this.result.multiplyMatrices(this.torso, this.local);
    this.write(this.meshes.head, index, this.result, fall);
    this.write(this.meshes.garments, index, this.torso, fall);
    this.appearance.applyGarment(index, look, look.cultureGrammar.pattern);
    this.write(this.meshes.headgear, index, this.result, fall);
    this.appearance.applyHeadgear(index, look);
    this.weaponFrame.copy(weapon);
    this.shieldFrame.copy(shield);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const stride = step * sign * 0.028;
      const stagger = pose.ranged ? sign * 0.018 : sign * 0.012;
      const lateral = sign * (0.023 + pose.brace * 0.008);
      const forward = stride + stagger;
      const footX = x + Math.cos(yaw) * lateral + Math.sin(yaw) * forward;
      const footZ = z - Math.sin(yaw) * lateral + Math.cos(yaw) * forward;
      this.target.set(footX, this.elevationAt(footX, footZ) + Math.max(0, step * sign) * 0.012, footZ);
      this.rig.reach(this.root.matrix, sign * 0.05, 0, this.target,
        0.225 * look.proportions.legLength, 0.225 * look.proportions.legLength, sign, true);
      this.write(this.meshes.thighs, index * 2 + side, this.rig.upper, fall);
      this.write(this.meshes.shins, index * 2 + side, this.rig.lower, fall);
      this.appearance.setFootOrientation(index, side, this.rig.footOrientation(yaw, 0));
      // Aim hands at actual weapon grips. Elbows follow the reach solver, never independent rods.
      if (side === 0 && style.shields) this.target.set(-0.018, 0, -0.014).applyMatrix4(this.shieldFrame);
      else if (side === 0 && (style.weapon === 'club' || style.weapon === 'sword')) this.target.set(-0.09, 0.1, 0.13).applyMatrix4(this.torso);
      else if (isFirearmWeapon(style.weapon)) {
        this.target.set(side === 0 ? -0.012 : 0.012, -0.015, side === 0 ? 0.045 : -0.075).applyMatrix4(this.weaponFrame);
      } else if (style.weapon === 'bow' && side === 1) {
        this.target.set(0.035, 0.085, 0.06 - pose.attack * 0.055);
        this.local.makeRotationY(yaw);
        this.target.applyMatrix4(this.local).add(this.root.position);
      } else this.target.set(side === 0 ? -0.012 : 0.012, side === 0 ? 0.055 : -0.055, -0.01).applyMatrix4(this.weaponFrame);
      this.rig.reach(this.torso, sign * 0.12, 0.27, this.target,
        0.19 * look.proportions.armLength, 0.21 * look.proportions.armLength, sign);
      this.write(this.meshes.upperArms, index * 2 + side, this.rig.upper, fall);
      this.write(this.meshes.forearms, index * 2 + side, this.rig.lower, fall);
    }
  }

  private write(mesh: THREE.InstancedMesh, index: number, matrix: THREE.Matrix4, fall?: THREE.Matrix4): void {
    if (fall) { this.world.multiplyMatrices(fall, matrix); mesh.setMatrixAt(index, this.world); }
    else mesh.setMatrixAt(index, matrix);
  }

  endFrame(count: number): void {
    for (const [part, mesh] of Object.entries(this.meshes)) {
      mesh.count = part === 'mantles' ? 0 : ['upperArms', 'forearms', 'thighs', 'shins'].includes(part) ? count * 2 : count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.appearance.endFrame();
  }

  daylight(value: number): void {
    for (const mesh of Object.values(this.meshes)) updateHumanSurfaceMaterial(mesh.material as THREE.MeshStandardMaterial, value);
  }

  dispose(): void {
    for (const mesh of Object.values(this.meshes)) { mesh.geometry.dispose(); mesh.customDepthMaterial?.dispose(); }
  }
}
