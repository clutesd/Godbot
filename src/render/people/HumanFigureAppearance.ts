import * as THREE from 'three';
import type { HumanLook } from './HumanAppearanceProfile';
import { bindHumanSurface, markHumanSurfaceUpdated, packPatternSeed, type HumanSurfaceAttributes } from './HumanSurfaceMaterial';
import { garmentPartsFor, headPartsFor, hemFitFor } from './HumanWardrobeAtlas';

/**
 * HumanFigureAppearance.ts
 *
 * Writes one resolved person into the instanced appearance channels of every mesh that makes up a
 * body. This is the only place that decides which colour lands on which part, so skin, sleeves,
 * trousers, boots, belts, hair and headwear can never drift out of agreement with each other.
 *
 * It allocates nothing per frame: colours are parsed into reused scratch instances and written
 * straight into the existing typed arrays.
 */

export interface HumanFigureMeshes {
  torso: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  upperArms: THREE.InstancedMesh;
  forearms: THREE.InstancedMesh;
  thighs: THREE.InstancedMesh;
  shins: THREE.InstancedMesh;
  garments: THREE.InstancedMesh;
  headgear: THREE.InstancedMesh;
  mantles: THREE.InstancedMesh;
}

/** Sleeves stop at the wrist, which sits this far along the shoulder-to-fingertip axis. */
const WRIST_AXIS = 0.8;
/** Trousers stop near the ankle, which sits this far along the hip-to-sole axis. */
const ANKLE_AXIS = 0.93;

export class HumanFigureAppearance {
  private readonly channels: Record<keyof HumanFigureMeshes, HumanSurfaceAttributes>;
  private readonly meshes: HumanFigureMeshes;
  private readonly skin = new THREE.Color();
  private readonly cloth = new THREE.Color();
  private readonly trim = new THREE.Color();
  private readonly parts: number[] = [0, 0, 0, 0];

  constructor(meshes: HumanFigureMeshes) {
    this.meshes = meshes;
    this.channels = {
      torso: bindHumanSurface(meshes.torso),
      head: bindHumanSurface(meshes.head),
      upperArms: bindHumanSurface(meshes.upperArms),
      forearms: bindHumanSurface(meshes.forearms),
      thighs: bindHumanSurface(meshes.thighs),
      shins: bindHumanSurface(meshes.shins),
      garments: bindHumanSurface(meshes.garments),
      headgear: bindHumanSurface(meshes.headgear),
      mantles: bindHumanSurface(meshes.mantles),
    };
  }

  /**
   * Torso, head and all four limb slots for one person. `index` is the person's body slot; limbs
   * occupy index*2 and index*2+1 exactly as the renderer's existing batches do.
   */
  apply(index: number, look: HumanLook, textilePattern: string | undefined): void {
    const { palette, wardrobe, proportions } = look;
    const pattern = packPatternSeed(textilePattern, look.seed);
    this.skin.set(palette.skin);
    this.trim.set(palette.leather);

    // Torso: the garment body, with the neckline sliding down the chest.
    const neckline = 0.30 + wardrobe.necklineCoverage * 0.68;
    const torso = this.channels.torso;
    this.writeTone(torso, index, palette.skinShade);
    torso.trim.setXYZW(index, this.trim.r, this.trim.g, this.trim.b, neckline);
    torso.fit.setXYZW(index, 0, 0.045, pattern, 0);
    torso.shape.setXYZW(index, proportions.shoulderScale, proportions.hipScale, proportions.bellyScale, 1);
    this.cloth.set(palette.garment);
    this.meshes.torso.setColorAt(index, this.cloth);

    // Head: trim carries the hair colour, which the face shader reuses for brows and irises.
    const head = this.channels.head;
    this.trim.set(palette.hair);
    this.writeTone(head, index, palette.skinShade);
    head.trim.setXYZW(index, this.trim.r, this.trim.g, this.trim.b, 0);
    head.fit.setXYZW(index, 0, 0, pattern, 0);
    head.shape.setXYZW(index, proportions.headScale, 1, 1, 1);
    this.meshes.head.setColorAt(index, this.cloth);

    // Sleeves: a robe or a suit sleeves in the body colour, everything else in the second layer.
    const oneLayer = wardrobe.top === 'robe' || wardrobe.top === 'suit' || wardrobe.top === 'coat-shirt';
    this.cloth.set(oneLayer ? palette.garment : palette.garmentSecondary);
    const sleeve = wardrobe.sleeveCoverage * WRIST_AXIS;
    for (const [key, thickness] of [['upperArms', 1], ['forearms', 0.98]] as const) {
      const channel = this.channels[key];
      const mesh = this.meshes[key];
      this.trim.set(palette.leather);
      for (let side = 0; side < 2; side++) {
        const slot = index * 2 + side;
        this.writeTone(channel, slot, palette.skinShade);
        channel.trim.setXYZW(slot, this.trim.r, this.trim.g, this.trim.b, 0);
        channel.fit.setXYZW(slot, sleeve, 0.13, pattern, 1);
        channel.shape.setXYZW(slot, proportions.armLength, 1, 1, proportions.limbThickness * thickness);
        mesh.setColorAt(slot, this.cloth);
      }
    }

    // Legs: trousers from the hip, footwear from the sole. The two meet wherever the boot ends.
    this.cloth.set(palette.trousers);
    this.trim.set(palette.footwear);
    const legs = wardrobe.legCoverage * ANKLE_AXIS;
    for (const [key, boot] of [['thighs', 0], ['shins', wardrobe.bootCoverage]] as const) {
      const channel = this.channels[key];
      const mesh = this.meshes[key];
      for (let side = 0; side < 2; side++) {
        const slot = index * 2 + side;
        this.writeTone(channel, slot, palette.skinShade);
        channel.trim.setXYZW(slot, this.trim.r, this.trim.g, this.trim.b, boot);
        channel.fit.setXYZW(slot, legs, key === 'shins' ? 0.2 : 0.14, pattern, 1);
        channel.shape.setXYZW(slot, proportions.legLength, 1, 1, proportions.limbThickness);
        mesh.setColorAt(slot, this.cloth);
      }
    }
  }

  /** One torso-clothing slot. Returns false when the person is wearing nothing selectable. */
  applyGarment(slot: number, look: HumanLook, textilePattern: string | undefined): boolean {
    const { palette, wardrobe, proportions } = look;
    garmentPartsFor(wardrobe, this.parts);
    if (!this.parts.some(part => part > 0)) return false;
    const hem = hemFitFor(wardrobe);
    const channel = this.channels.garments;
    this.trim.set(palette.leather);
    this.writeTone(channel, slot, palette.skinShade);
    channel.trim.setXYZW(slot, this.trim.r, this.trim.g, this.trim.b, 0);
    channel.fit.setXYZW(slot, 0, 0, packPatternSeed(textilePattern, look.seed), 1);
    channel.shape.setXYZW(slot, proportions.shoulderScale, proportions.hipScale, proportions.bellyScale, 1);
    channel.parts.setXYZW(slot, this.parts[0]!, this.parts[1]!, this.parts[2]!, this.parts[3]!);
    channel.garment.setXYZW(slot, hem.length, hem.flare, 1, 0);
    this.cloth.set(palette.garment);
    this.meshes.garments.setColorAt(slot, this.cloth);
    return true;
  }

  /** One head-attachment slot: hair plus whatever is worn over it. */
  applyHeadgear(slot: number, look: HumanLook): boolean {
    const { palette, wardrobe, proportions } = look;
    headPartsFor(wardrobe, this.parts);
    if (!this.parts.some(part => part > 0)) return false;
    const channel = this.channels.headgear;
    this.trim.set(palette.hair);
    this.writeTone(channel, slot, palette.skinShade);
    channel.trim.setXYZW(slot, this.trim.r, this.trim.g, this.trim.b, 0);
    channel.fit.setXYZW(slot, 0, 0, 0, 0);
    channel.shape.setXYZW(slot, proportions.headScale, 1, 1, 1);
    channel.parts.setXYZW(slot, this.parts[0]!, this.parts[1]!, this.parts[2]!, this.parts[3]!);
    this.cloth.set(wardrobe.head === 'headdress' ? palette.accent
      : wardrobe.head === 'helmet' ? palette.leather
        : wardrobe.head === 'brim' || wardrobe.head === 'wrap' ? palette.garmentSecondary
          : palette.garment);
    this.meshes.headgear.setColorAt(slot, this.cloth);
    return true;
  }

  /** A notable life's extra outer layer, kept in agreement with the rest of the wardrobe. */
  applyMantle(slot: number, look: HumanLook, colour: THREE.Color): void {
    const channel = this.channels.mantles;
    this.writeTone(channel, slot, look.palette.skinShade);
    this.trim.set(look.palette.leather);
    channel.trim.setXYZW(slot, this.trim.r, this.trim.g, this.trim.b, 0);
    channel.fit.setXYZW(slot, 0, 0, 0, 0);
    channel.shape.setXYZW(slot, 1, 1, 1, 1);
    this.meshes.mantles.setColorAt(slot, colour);
  }

  private writeTone(channel: HumanSurfaceAttributes, slot: number, shade: number): void {
    channel.tone.setXYZW(slot, this.skin.r, this.skin.g, this.skin.b, shade);
  }

  endFrame(): void {
    for (const key of Object.keys(this.channels) as (keyof HumanFigureMeshes)[]) {
      markHumanSurfaceUpdated(this.channels[key]);
      const mesh = this.meshes[key];
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
