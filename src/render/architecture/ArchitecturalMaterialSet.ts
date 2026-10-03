/**
 * ArchitecturalMaterialSet.ts
 *
 * The shared Three.js materials for one culture-and-era scope.
 *
 * Performance is the whole design here. A settlement may contain hundreds of buildings drawing on
 * thirty-odd construction materials, and none of them may own a material of its own:
 *
 *   - one `MeshStandardMaterial` per architectural material, created lazily and shared by every
 *     building in the scope, so a building costs one draw call per *material it actually uses*
 *     (typically five to eight) rather than one per part;
 *   - procedural patterns keyed by pattern identity, not material identity, so the thirty-six
 *     materials compile down to a couple of dozen GPU programs at most, bucketed by refinement;
 *   - no textures at all, so adding materials costs no VRAM and no upload;
 *   - the night factor applied in place on the shared materials, never by cloning.
 *
 * Culture tinting is deliberately restrained. A material is a physical substance: fired brick is
 * fired brick in every civilisation. The culture shifts it a few percent so settlements read as
 * related without pretending that culture changes what clay does when you bake it.
 */

import * as THREE from 'three';
import type { ArchitecturalMaterialId } from './MaterialLibrary';
import { architecturalMaterial } from './MaterialLibrary';
import { installProceduralSurface } from '../materials/SurfaceDetail';
import { proceduralProgramFor, refinementBucket, surfaceProgramCacheKey } from './SurfaceProgramLibrary';

export interface ArchitecturalMaterialSetOptions {
  /** Culture accent blended lightly into every material. */
  tint: THREE.Color;
  /** 0..1 process refinement, from the era or period. Tightens joints and calms oxidation. */
  refinement: number;
  /**
   * 0..1 how strongly culture colour shows. Kept low by default: a material is a substance
   * before it is a style.
   */
  tintStrength?: number;
}

export interface ArchitecturalMaterialSetStats {
  /** Distinct Three materials created so far. */
  materials: number;
  /** Distinct GPU program identities those materials ask for. */
  programs: number;
}

export class ArchitecturalMaterialSet {
  private readonly materials = new Map<ArchitecturalMaterialId, THREE.MeshStandardMaterial>();
  private readonly programKeys = new Set<string>();
  private readonly tint: THREE.Color;
  private readonly refinement: number;
  private readonly tintStrength: number;
  private nightFactor = 0;

  constructor(options: ArchitecturalMaterialSetOptions) {
    this.tint = options.tint.clone();
    this.refinement = Math.max(0, Math.min(1, options.refinement));
    this.tintStrength = Math.max(0, Math.min(0.4, options.tintStrength ?? 0.12));
  }

  /**
   * The shared material for one construction material.
   *
   * Created on first use and reused for every building afterwards. Callers must never mutate
   * the result: it belongs to every structure in the scope.
   */
  get(id: ArchitecturalMaterialId): THREE.MeshStandardMaterial {
    const existing = this.materials.get(id);
    if (existing) return existing;

    const definition = architecturalMaterial(id);
    const appearance = definition.appearance;

    const color = new THREE.Color(appearance.color).lerp(this.tint, this.tintStrength);
    // Later processes produce flatter, more even surfaces; earlier ones stay rough.
    const roughness = Math.max(0.04, Math.min(1, appearance.roughness * (1 - this.refinement * 0.08)));

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: appearance.metalness,
      side: THREE.FrontSide,
    });

    if (appearance.transparency > 0) {
      material.transparent = true;
      material.opacity = 1 - appearance.transparency;
      // Glazing should not punch holes in the depth buffer for everything behind it.
      material.depthWrite = false;
    }

    const program = proceduralProgramFor(appearance.program, this.refinement);
    const cacheKey = surfaceProgramCacheKey(appearance.program, this.refinement);
    installProceduralSurface(material, program, cacheKey);
    this.programKeys.add(cacheKey);

    material.userData['shared'] = true;
    material.userData['architecturalMaterial'] = id;
    material.userData['surfaceProgram'] = appearance.program;
    material.name = `arch:${id}`;

    this.materials.set(id, material);
    this.applyNightTo(material, id);
    return material;
  }

  /** True once this material has been created, without creating it. */
  has(id: ArchitecturalMaterialId): boolean {
    return this.materials.has(id);
  }

  /**
   * 0 at midday, 1 at deep night. Glazing lights up from within so settlements stay legible —
   * and look inhabited — after dark. Applied in place on the shared materials.
   */
  setNightFactor(factor: number): void {
    const clamped = Math.max(0, Math.min(1, factor));
    if (Math.abs(clamped - this.nightFactor) < 0.01) return;
    this.nightFactor = clamped;
    for (const [id, material] of this.materials) this.applyNightTo(material, id);
  }

  private applyNightTo(material: THREE.MeshStandardMaterial, id: ArchitecturalMaterialId): void {
    const definition = architecturalMaterial(id);
    if (definition.family !== 'glass') return;
    if (material.emissive.getHex() === 0x000000) material.emissive = new THREE.Color(0xffd9a0).lerp(this.tint, 0.2);
    // Curtain glass glows more evenly than a small divided window.
    const strength = id === 'curtain-glass' ? 0.9 : 0.6;
    material.emissiveIntensity = this.nightFactor * strength;
  }

  get stats(): ArchitecturalMaterialSetStats {
    return { materials: this.materials.size, programs: this.programKeys.size };
  }

  /** The refinement bucket this set compiles its programs at. */
  get refinementStep(): number {
    return refinementBucket(this.refinement);
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.programKeys.clear();
  }
}
