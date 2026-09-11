import type {
  DevelopmentResponse,
  SettlementNeed,
  StructureDevelopment,
  StructureForm,
  StructureHistoryEntry,
  StructureMaterial,
} from '../../sim/development/types';

export type ArchitecturalGenerationKind =
  | 'origin'
  | 'expansion'
  | 'modernization'
  | 'conversion'
  | 'rebuild'
  | 'current';

export interface ArchitecturalGeneration {
  /** Stable within this derived building history and independent of event month. */
  id: string;
  ordinal: number;
  kind: ArchitecturalGenerationKind;
  action: StructureHistoryEntry['action'] | 'current';
  need: SettlementNeed;
  form: StructureForm;
  level: number;
  material: StructureMaterial;
  cultureId: string;
  institutionId?: string;
  /** Retained for documentary/history uses; deliberately excluded from visual signatures. */
  startedMonth?: number;
  /** 0..1 share of the reserved development envelope plausibly occupied after this generation. */
  envelopeShare: number;
  /** True when a ruin/abandonment discontinuity preceded this physical generation. */
  rebuiltAfterLoss: boolean;
}

export interface ArchitecturalGenerationModel {
  generations: ArchitecturalGeneration[];
  /** Ordinary transition records that rolled out of the 12-entry history window. */
  omittedTransitionCount: number;
  /** Number of transitions retained but intentionally ignored because they did not create fabric. */
  nonFabricTransitionCount: number;
  visualSignature: string;
}

const MAX_GENERATIONS = 5;

function isStructureDevelopment(response: DevelopmentResponse): response is StructureDevelopment {
  const candidate = response as Partial<StructureDevelopment>;
  return !!candidate.origin && Array.isArray(candidate.history) && typeof candidate.transitionCount === 'number';
}

function formOf(entry: StructureHistoryEntry, fallback: StructureForm): StructureForm {
  return entry.form ?? fallback;
}

function levelOf(entry: StructureHistoryEntry, fallback: number): number {
  return entry.level ?? fallback;
}

function materialOf(entry: StructureHistoryEntry, fallback: StructureMaterial): StructureMaterial {
  return entry.material ?? fallback;
}

interface PhysicalSnapshot {
  action: StructureHistoryEntry['action'] | 'current';
  month?: number;
  need: SettlementNeed;
  form: StructureForm;
  level: number;
  material: StructureMaterial;
  cultureId: string;
  institutionId?: string;
  rebuiltAfterLoss: boolean;
}

function sameFabric(a: PhysicalSnapshot, b: PhysicalSnapshot): boolean {
  return a.need === b.need
    && a.form === b.form
    && a.level === b.level
    && a.material === b.material
    && a.cultureId === b.cultureId
    && a.institutionId === b.institutionId;
}

function kindFor(snapshot: PhysicalSnapshot, previous: PhysicalSnapshot | undefined, isOrigin: boolean, isCurrent: boolean): ArchitecturalGenerationKind {
  if (isOrigin) return 'origin';
  if (snapshot.rebuiltAfterLoss || snapshot.action === 'reused') return 'rebuild';
  if (snapshot.action === 'repurposed' || previous && (snapshot.need !== previous.need || snapshot.form !== previous.form)) return 'conversion';
  if (previous && (snapshot.material !== previous.material || snapshot.cultureId !== previous.cultureId)) return 'modernization';
  if (snapshot.action === 'expanded' || snapshot.action === 'upgraded' || previous && snapshot.level > previous.level) return 'expansion';
  return isCurrent ? 'current' : 'modernization';
}

function importance(generation: ArchitecturalGeneration): number {
  switch (generation.kind) {
    case 'origin': return 100;
    case 'rebuild': return 90;
    case 'conversion': return 80;
    case 'modernization': return 70;
    case 'expansion': return 55;
    case 'current': return 60;
  }
}

function compressGenerations(generations: ArchitecturalGeneration[]): ArchitecturalGeneration[] {
  if (generations.length <= MAX_GENERATIONS) return generations;
  const first = generations[0]!;
  const last = generations[generations.length - 1]!;
  const middle = generations.slice(1, -1)
    .map((generation, index) => ({ generation, index, score: importance(generation) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, MAX_GENERATIONS - 2)
    .map(entry => entry.generation);
  const selected = [first, ...middle, last]
    .filter((generation, index, all) => all.findIndex(candidate => candidate === generation) === index)
    .sort((a, b) => a.ordinal - b.ordinal);
  return selected;
}

function reindex(generations: ArchitecturalGeneration[]): ArchitecturalGeneration[] {
  const count = generations.length;
  return generations.map((generation, ordinal) => ({
    ...generation,
    ordinal,
    id: `g${ordinal}-${generation.kind}`,
    envelopeShare: count <= 1 ? 1 : Math.min(1, 0.52 + (ordinal / Math.max(1, count - 1)) * 0.48),
  }));
}

function signature(generations: ArchitecturalGeneration[]): string {
  return generations.map(generation => [
    generation.id,
    generation.kind,
    generation.action,
    generation.need,
    generation.form,
    generation.level,
    generation.material,
    generation.cultureId,
    generation.rebuiltAfterLoss ? 1 : 0,
    generation.envelopeShare.toFixed(2),
  ].join('.')).join('|');
}

/**
 * Derive a compact architectural stratigraphy from authoritative structure history.
 *
 * The origin is permanent. Up to four later fabric generations are retained, prioritising
 * rebuilds, conversions and material/cultural modernisation over routine level changes. Exact
 * months, institution ids and narrative reasons never affect visual identity. For old saves
 * without structure history, a single current generation is returned.
 */
export function deriveArchitecturalGenerations(response: DevelopmentResponse): ArchitecturalGenerationModel {
  if (!isStructureDevelopment(response)) {
    const only: ArchitecturalGeneration = {
      id: 'g0-current', ordinal: 0, kind: 'current', action: 'current',
      need: response.need, form: response.form, level: response.level, material: response.material,
      cultureId: response.cultureId, institutionId: response.institutionId,
      envelopeShare: 1, rebuiltAfterLoss: false,
    };
    return { generations: [only], omittedTransitionCount: 0, nonFabricTransitionCount: 0, visualSignature: signature([only]) };
  }

  const origin: PhysicalSnapshot = {
    action: 'founded', month: response.origin.month, need: response.origin.need,
    form: formOf(response.origin, response.form), level: levelOf(response.origin, response.level),
    material: materialOf(response.origin, response.material), cultureId: response.origin.cultureId,
    institutionId: response.origin.institutionId, rebuiltAfterLoss: false,
  };
  const snapshots: PhysicalSnapshot[] = [origin];
  let previous = origin;
  let lossSinceFabric = false;
  let nonFabricTransitionCount = 0;

  for (const entry of response.history) {
    if (entry.action === 'abandoned' || entry.action === 'ruined') {
      lossSinceFabric = true;
      nonFabricTransitionCount++;
      continue;
    }
    const next: PhysicalSnapshot = {
      action: entry.action,
      month: entry.month,
      need: entry.need,
      form: formOf(entry, previous.form),
      level: levelOf(entry, previous.level),
      material: materialOf(entry, previous.material),
      cultureId: entry.cultureId,
      institutionId: entry.institutionId,
      rebuiltAfterLoss: lossSinceFabric || entry.action === 'reused',
    };
    const physicallyMeaningful = entry.action === 'repurposed'
      || entry.action === 'reused'
      || !sameFabric(previous, next);
    if (physicallyMeaningful) {
      snapshots.push(next);
      previous = next;
      lossSinceFabric = false;
    } else {
      nonFabricTransitionCount++;
    }
  }

  const current: PhysicalSnapshot = {
    action: 'current', need: response.need, form: response.form, level: response.level,
    material: response.material, cultureId: response.cultureId, institutionId: response.institutionId,
    rebuiltAfterLoss: lossSinceFabric,
  };
  if (!sameFabric(previous, current) || current.rebuiltAfterLoss) snapshots.push(current);

  let generations = snapshots.map((snapshot, ordinal, all): ArchitecturalGeneration => ({
    id: '',
    ordinal,
    kind: kindFor(snapshot, ordinal > 0 ? all[ordinal - 1] : undefined, ordinal === 0, ordinal === all.length - 1 && snapshot.action === 'current'),
    action: snapshot.action,
    need: snapshot.need,
    form: snapshot.form,
    level: snapshot.level,
    material: snapshot.material,
    cultureId: snapshot.cultureId,
    institutionId: snapshot.institutionId,
    startedMonth: snapshot.month,
    envelopeShare: 1,
    rebuiltAfterLoss: snapshot.rebuiltAfterLoss,
  }));
  generations = reindex(compressGenerations(generations));

  const omittedTransitionCount = Math.max(0, response.transitionCount - response.history.length);
  return {
    generations,
    omittedTransitionCount,
    nonFabricTransitionCount,
    visualSignature: signature(generations),
  };
}

export function generationForCurrentFabric(model: ArchitecturalGenerationModel): ArchitecturalGeneration {
  return model.generations[model.generations.length - 1]!;
}

export function generationForOriginFabric(model: ArchitecturalGenerationModel): ArchitecturalGeneration {
  return model.generations[0]!;
}

/**
 * Pick a later generation for an annex without relying on event month. Multiple annexes walk
 * backward through later generations, allowing a court to show an older west wing and newer east
 * wing while a one-generation building remains wholly current.
 */
export function generationForAnnex(model: ArchitecturalGenerationModel, annexIndex: number, annexCount: number): ArchitecturalGeneration {
  const later = model.generations.slice(1);
  if (later.length === 0) return generationForCurrentFabric(model);
  const start = Math.max(0, later.length - Math.max(1, annexCount));
  return later[Math.min(later.length - 1, start + annexIndex)]!;
}
