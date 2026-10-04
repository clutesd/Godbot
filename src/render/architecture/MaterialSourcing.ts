/**
 * MaterialSourcing.ts
 *
 * Turns what a settlement actually spent into evidence about what its buildings are made of.
 *
 * This is the module that keeps the architecture honest. The simulation already records the
 * physical bill of materials for every construction project — `DevelopmentProject.materialSpent`
 * is the exact quantity of each material kind consumed, and `DevelopmentResponse.materialCost`
 * is the processed-material bill that was paid. Reading those is how a brick wall comes to mean
 * "this settlement fired and laid brick", not "this building rolled a 4 on the wall table".
 *
 * Evidence is graded rather than binary, because the records are graded:
 *
 *   - `spent`    the project's own consumption. Strongest: it is what went into this building.
 *   - `billed`   the response's material cost. Strong: it is what this building was priced at.
 *   - `stocked`  material the settlement holds. Weak: it could have been used.
 *   - `class`    the coarse StructureMaterial. Weakest, but always present, so there is always
 *                a defensible answer even for legacy fabric and founding-era archives.
 *
 * Nothing here consumes, reserves or mutates simulation state. It only reads and normalises.
 */

import type { DevelopmentProject, DevelopmentResponse, StructureMaterial } from '../../sim/development/types';
import type { MaterialKind } from '../../sim/resources/MaterialEconomy';
import type { ArchitecturalMaterialId } from './MaterialLibrary';
import { MATERIAL_LIBRARY, materialsFromKind } from './MaterialLibrary';

/** How directly a material kind is attested for this structure. */
export type EvidenceGrade = 'spent' | 'billed' | 'stocked' | 'class' | 'none';

const GRADE_WEIGHT: Record<EvidenceGrade, number> = {
  spent: 1,
  billed: 0.85,
  stocked: 0.45,
  class: 0.3,
  none: 0,
};

export function evidenceWeight(grade: EvidenceGrade): number {
  return GRADE_WEIGHT[grade];
}

/**
 * The coarse simulation material class each architectural material reads as. A structure whose
 * only surviving record is `material: 'masonry'` still supports every masonry material, which is
 * what lets old archives resolve without inventing a bill of materials they never had.
 */
const CLASS_MATERIALS: Record<StructureMaterial, readonly ArchitecturalMaterialId[]> = {
  earth: ['mud-brick', 'adobe', 'wattle-and-daub', 'thatch', 'plaster'],
  timber: ['logs', 'rough-hewn-timber', 'heavy-timber', 'sawn-lumber', 'finished-wood', 'wood-shingle'],
  masonry: ['fieldstone', 'rubble-masonry', 'dressed-stone', 'ashlar', 'limestone', 'sandstone', 'granite', 'slate', 'concrete', 'reinforced-concrete'],
  ceramic: ['fired-brick', 'buff-brick', 'clay-tile', 'terracotta', 'glass'],
  metal: ['wrought-iron', 'cast-iron', 'steel', 'structural-steel', 'corrugated-metal', 'sheet-metal', 'copper', 'aluminium', 'curtain-glass', 'asphalt-membrane'],
};

export function materialsForStructureClass(material: StructureMaterial): readonly ArchitecturalMaterialId[] {
  return CLASS_MATERIALS[material];
}

export interface MaterialEvidence {
  /** The best grade of record available for this structure overall. */
  bestGrade: EvidenceGrade;
  /**
   * 0..1 attested share per architectural material, already combined across grades. A material
   * with share 0 was not attested at all; the resolver may still fall back to it if the role
   * would otherwise go unfilled, but it will always prefer an attested peer.
   */
  shares: ReadonlyMap<ArchitecturalMaterialId, number>;
  /** The coarse class, which is also the last-resort answer. */
  structureMaterial: StructureMaterial;
}

export interface MaterialSourcingInput {
  response: DevelopmentResponse;
  /** The live project, when one exists. Carries the exact consumption record. */
  project?: DevelopmentProject;
  /** Settlement stock on hand, as a weak signal about what was reachable. */
  stock?: Partial<Record<MaterialKind, number>>;
}

function accumulate(
  target: Map<ArchitecturalMaterialId, number>,
  amounts: Partial<Record<MaterialKind, number>> | undefined,
  grade: EvidenceGrade,
): boolean {
  if (!amounts) return false;
  let total = 0;
  for (const value of Object.values(amounts)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += value;
  }
  if (total <= 0) return false;

  const weight = GRADE_WEIGHT[grade];
  for (const [kind, value] of Object.entries(amounts) as Array<[MaterialKind, number | undefined]>) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const candidates = materialsFromKind(kind);
    if (candidates.length === 0) continue;
    // A kind's share is spread across every material it could become. Clay attests both mud
    // brick and roof tile; which of those is actually used is the resolver's decision, made
    // against period, capability and role — not something quantity alone can settle.
    const share = (value / total) * weight;
    for (const candidate of candidates) {
      target.set(candidate, (target.get(candidate) ?? 0) + share / candidates.length);
    }
  }
  return true;
}

/**
 * Reduce a structure's authoritative material records into graded visual evidence.
 *
 * Deterministic: no randomness, no iteration-order dependence beyond the stable library order.
 */
export function deriveMaterialEvidence(input: MaterialSourcingInput): MaterialEvidence {
  const shares = new Map<ArchitecturalMaterialId, number>();
  let bestGrade: EvidenceGrade = 'none';

  // The project's own consumption, where the simulation recorded it.
  const spent = (input.project as (DevelopmentProject & { materialSpent?: Partial<Record<MaterialKind, number>> }) | undefined)?.materialSpent;
  if (accumulate(shares, spent, 'spent')) bestGrade = 'spent';

  // The response's processed-material bill. `materialCost` is keyed loosely, so only keys that
  // are real material kinds contribute; anything else is a component id this module cannot read.
  const billed = input.response.materialCost;
  if (billed) {
    const recognised: Partial<Record<MaterialKind, number>> = {};
    let any = false;
    for (const [key, value] of Object.entries(billed)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      if (materialsFromKind(key as MaterialKind).length === 0) continue;
      recognised[key as MaterialKind] = value;
      any = true;
    }
    if (any && accumulate(shares, recognised, 'billed') && bestGrade === 'none') bestGrade = 'billed';
  }

  if (accumulate(shares, input.stock, 'stocked') && bestGrade === 'none') bestGrade = 'stocked';

  // The coarse class is always available and always contributes, so every material consistent
  // with the authoritative class keeps a floor of support even when a bill of materials exists.
  const structureMaterial = input.response.material;
  const classWeight = GRADE_WEIGHT.class;
  const classMaterials = CLASS_MATERIALS[structureMaterial];
  for (const candidate of classMaterials) {
    shares.set(candidate, (shares.get(candidate) ?? 0) + classWeight / classMaterials.length);
  }
  if (bestGrade === 'none') bestGrade = 'class';

  // Normalise to 0..1 so the resolver's scoring is scale-free.
  let peak = 0;
  for (const value of shares.values()) peak = Math.max(peak, value);
  if (peak > 0) {
    for (const [id, value] of shares) shares.set(id, value / peak);
  }

  return { bestGrade, shares, structureMaterial };
}

/** Evidence with no records at all: every material consistent with one class, nothing stronger. */
export function classOnlyEvidence(material: StructureMaterial): MaterialEvidence {
  const shares = new Map<ArchitecturalMaterialId, number>();
  for (const candidate of CLASS_MATERIALS[material]) shares.set(candidate, 1);
  return { bestGrade: 'class', shares, structureMaterial: material };
}

/** 0..1 attested support for one material. */
export function evidenceFor(evidence: MaterialEvidence, id: ArchitecturalMaterialId): number {
  return evidence.shares.get(id) ?? 0;
}

/**
 * True when a material is consistent with the structure's authoritative coarse class.
 *
 * The resolver uses this as a hard filter for the wall and frame of a structure whose only
 * record is its class: a building the simulation calls timber must not resolve to a brick wall
 * however well brick scores on climate and culture.
 */
export function consistentWithClass(evidence: MaterialEvidence, id: ArchitecturalMaterialId): boolean {
  return CLASS_MATERIALS[evidence.structureMaterial].includes(id);
}

/** The coarse class a material reads as, for cross-checking against simulation records. */
export function structureClassOf(id: ArchitecturalMaterialId): StructureMaterial {
  return MATERIAL_LIBRARY[id].structureMaterial;
}

/**
 * Compact deterministic signature of a project's bill of materials, for the asset cache.
 *
 * Raw quantities would churn the cache on every month of construction, so only each material's
 * *proportion* of the bill contributes, bucketed into quarters. Proportions settle early in a
 * project and then stay put, which is what makes this stable enough to key a cached mesh on
 * while still distinguishing a mostly-brick building from a mostly-timber one.
 */
export function materialBillSignature(project: DevelopmentProject | undefined, response?: DevelopmentResponse): string {
  const spent = (project as (DevelopmentProject & { materialSpent?: Partial<Record<MaterialKind, number>> }) | undefined)?.materialSpent;
  const bill = spent ?? response?.materialCost ?? project?.response.materialCost;
  if (!bill) return '';

  const entries: [string, number][] = [];
  let total = 0;
  for (const [kind, value] of Object.entries(bill)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    entries.push([kind, value]);
    total += value;
  }
  if (total <= 0) return '';

  return entries
    .map(([kind, value]) => `${kind}${Math.round((value / total) * 4)}`)
    .sort()
    .join('-');
}
