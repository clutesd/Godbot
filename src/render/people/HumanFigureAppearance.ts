import * as THREE from 'three';
import type { HumanLook } from './HumanAppearanceProfile';
import { bindHumanSurface, markHumanSurfaceUpdated, packPatternSeed, type HumanSurfaceAttributes } from './HumanSurfaceMaterial';
import { garmentOverflowFor, garmentPartsFor, headPartsFor, hemFitFor } from './HumanWardrobeAtlas';

/**
 * HumanFigureAppearance.ts
 *
 * Writes one resolved person into the instanced appearance channels of every mesh that makes up a
 * body. This is the only place that decides which material lands on which part, so the obsidian,
 * the alloy, the drape and the luminous inlay can never drift out of agreement with each other.
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

export class HumanFigureAppearance {
  private readonly channels: Record<keyof HumanFigureMeshes, HumanSurfaceAttributes>;
  private readonly meshes: HumanFigureMeshes;
  private readonly obsidian = new THREE.Color();
  private readonly alloy = new THREE.Color();
  private readonly drape = new THREE.Color();
  private readonly luminous = new THREE.Color();
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
  apply(index: number, look: HumanLook, markingPattern: string | undefined, focal = false): void {
    const { palette, wardrobe, proportions } = look;
    const pattern = packPatternSeed(markingPattern, look.seed);
    this.obsidian.set(palette.obsidian);
    this.alloy.set(palette.alloy);
    this.drape.set(palette.drape);
    this.luminous.set(palette.luminous);

    // Torso: the body markings live here — sternum, clavicle channels, spine, cultural glyph.
    const torso = this.channels.torso;
    this.writeMaterials(torso, index, palette.finish, palette.luminance);
    torso.trim.setW(index, 0);
    torso.parts.setXYZW(index, look.cultureGrammar.symmetry, look.standing, focal ? 1 : 0, 0);
    torso.fit.setXYZW(index, 0, 0, pattern, wardrobe.markingDensity);
    torso.shape.setXYZW(index, proportions.shoulderScale, proportions.hipScale, proportions.bellyScale, proportions.ribcageScale);
    this.meshes.torso.setColorAt(index, this.luminous);

    // Head: the face is selected by the mesh's mode, not by a zone, so it only needs proportions.
    const head = this.channels.head;
    this.writeMaterials(head, index, palette.finish, palette.luminance);
    head.trim.setW(index, 0);
    head.fit.setXYZW(index, 0, 0, pattern, wardrobe.markingDensity);
    head.shape.setXYZW(index, proportions.headScale, look.head.jaw, look.head.cranium, look.head.cheek);
    head.parts.setXYZW(index, look.head.brow, look.head.temple, look.head.recess, look.head.neck);
    head.garment.setZ(index, focal ? 1 : 0);
    this.meshes.head.setColorAt(index, this.luminous);

    // Limbs. A cast ring is a position on the limb axis, so a whole population wears different
    // rings at different heights out of one geometry and one draw call per segment.
    const limbs = [
      ['upperArms', wardrobe.armRing, proportions.armLength, 1] as const,
      ['forearms', wardrobe.wristBand, proportions.armLength, 0.98] as const,
      ['thighs', wardrobe.thighBand, proportions.legLength, 1] as const,
      ['shins', wardrobe.anklet, proportions.legLength, 0.98] as const,
    ];
    for (const [key, band, length, thickness] of limbs) {
      const channel = this.channels[key];
      const mesh = this.meshes[key];
      for (let side = 0; side < 2; side++) {
        const slot = index * 2 + side;
        this.writeMaterials(channel, slot, palette.finish, palette.luminance);
        channel.trim.setW(slot, 0);
        channel.fit.setXYZW(slot, band, wardrobe.bandSwell, packPatternSeed(markingPattern, (look.seed + side * 0.371) % 1), wardrobe.markingDensity * (side ? 0.68 + look.seed * 0.25 : 1));
        channel.garment.setXYZW(slot, 0, 0, 0, 1);
        channel.parts.setXYZW(slot, 0, key === 'forearms' ? 1 : key === 'shins' ? 2 : 0, look.seed, 0);
        channel.shape.setXYZW(slot, length, 1, 1, proportions.limbThickness * thickness);
        mesh.setColorAt(slot, this.luminous);
      }
    }
  }

  setTorsoMotion(index: number, twist: number): void {
    this.channels.torso.fit.setX(index, twist);
  }

  setDrapeMotion(index: number, weight: number, twist = 0): void {
    this.channels.garments.fit.setX(index, twist);
    this.channels.garments.fit.setY(index, weight * 0.014);
  }

  setFootOrientation(index: number, side: number, rotation: THREE.Quaternion): void {
    this.channels.shins.garment.setXYZW(index * 2 + side, rotation.x, rotation.y, rotation.z, rotation.w);
  }

  /** One body-adornment slot. Returns false when the person is wearing nothing selectable. */
  applyGarment(slot: number, look: HumanLook, markingPattern: string | undefined): boolean {
    const { palette, wardrobe, proportions } = look;
    garmentPartsFor(wardrobe, this.parts);
    const overflow = garmentOverflowFor(wardrobe);
    if (!this.parts.some(part => part > 0) && overflow === 0) return false;
    const hem = hemFitFor(wardrobe);
    const channel = this.channels.garments;
    this.obsidian.set(palette.obsidian);
    this.alloy.set(palette.alloy);
    this.drape.set(palette.drape);
    this.luminous.set(palette.luminous);
    this.writeMaterials(channel, slot, palette.finish, palette.luminance);
    channel.trim.setW(slot, 0);
    channel.fit.setXYZW(slot, 0, 0, packPatternSeed(markingPattern, look.seed), wardrobe.markingDensity);
    channel.shape.setXYZW(slot, proportions.shoulderScale, proportions.hipScale, proportions.bellyScale, proportions.ribcageScale);
    channel.parts.setXYZW(slot, this.parts[0]!, this.parts[1]!, this.parts[2]!, this.parts[3]!);
    channel.garment.setXYZW(slot, hem.length, hem.flare, 1, overflow);
    this.meshes.garments.setColorAt(slot, this.luminous);
    return true;
  }

  /** One head-attachment slot: the obsidian crest plus whatever structure is worn over it. */
  applyHeadgear(slot: number, look: HumanLook, focal = false): boolean {
    const { palette, wardrobe, proportions } = look;
    headPartsFor(wardrobe, this.parts);
    if (focal && this.parts[2] === 0) this.parts[2] = 6;
    if (!this.parts.some(part => part > 0)) return false;
    const channel = this.channels.headgear;
    this.obsidian.set(palette.obsidian);
    this.alloy.set(palette.alloy);
    this.drape.set(palette.drape);
    this.luminous.set(palette.luminous);
    this.writeMaterials(channel, slot, palette.finish, palette.luminance);
    channel.trim.setW(slot, 0);
    channel.fit.setXYZW(slot, 0, 0, packPatternSeed(look.cultureGrammar.pattern, look.seed), wardrobe.markingDensity);
    channel.shape.setXYZW(slot, proportions.headScale, 1 + (look.head.cheek - 1) * 0.5 + look.head.temple * 10, look.head.cranium, 1);
    channel.parts.setXYZW(slot, this.parts[0]!, this.parts[1]!, this.parts[2]!, this.parts[3]!);
    channel.garment.setXYZW(slot, 1, 1, 1, focal ? 11 : 0);
    this.meshes.headgear.setColorAt(slot, this.luminous);
    return true;
  }

  /** A notable life's extra outer drape, kept in agreement with the rest of the adornment. */
  applyMantle(slot: number, look: HumanLook, colour: THREE.Color): void {
    const { palette } = look;
    const channel = this.channels.mantles;
    this.obsidian.set(palette.obsidian);
    this.alloy.set(palette.alloy);
    this.drape.set(colour);
    this.luminous.set(palette.luminous);
    this.writeMaterials(channel, slot, palette.finish, palette.luminance);
    channel.trim.setW(slot, 0);
    channel.fit.setXYZW(slot, 0, 0, 0, look.wardrobe.markingDensity);
    channel.shape.setXYZW(slot, 1, 1, 1, 1);
    channel.garment.setXYZW(slot, 1, 1, 1, 0);
    this.meshes.mantles.setColorAt(slot, this.luminous);
  }

  /**
   * The four material channels every surface of a person resolves from: the glass it is made of,
   * how worked that glass is, the alloy it wears and the cloth it hangs, with its luminous gain.
   */
  private writeMaterials(channel: HumanSurfaceAttributes, slot: number,
    finish: number, luminance: number): void {
    channel.tone.setXYZW(slot, this.obsidian.r, this.obsidian.g, this.obsidian.b, finish);
    channel.trim.setXYZ(slot, this.alloy.r, this.alloy.g, this.alloy.b);
    channel.drape.setXYZW(slot, this.drape.r, this.drape.g, this.drape.b, luminance);
  }

  endFrame(): void {
    for (const key of Object.keys(this.channels) as (keyof HumanFigureMeshes)[]) {
      markHumanSurfaceUpdated(this.channels[key]);
      const mesh = this.meshes[key];
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
