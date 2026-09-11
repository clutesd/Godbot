import type {
  DevelopmentResponse,
  SettlementNeed,
  StructureDevelopment,
  StructureForm,
  StructureHistoryEntry,
  StructureMaterial,
} from '../../sim/development/types';
import type { BuildingGrammar, WallLayer } from './BuildingGrammar';

export interface StructureHeritage {
  originNeed: SettlementNeed;
  originForm: StructureForm;
  originLevel: number;
  originMaterial: StructureMaterial;
  originCultureId: string;
  legacyNeed: SettlementNeed;
  legacyForm: StructureForm;
  legacyMaterial: StructureMaterial;
  transitionCount: number;
  upgradeCount: number;
  repurposed: boolean;
  reused: boolean;
  survivedRuin: boolean;
  cultureShift: boolean;
  materialShift: boolean;
  needShift: boolean;
  ceremonialMemory: boolean;
  industrialMemory: boolean;
  preservation: number;
  fingerprint: string;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function isStructureDevelopment(response: DevelopmentResponse): response is StructureDevelopment {
  const candidate = response as Partial<StructureDevelopment>;
  return !!candidate.origin && Array.isArray(candidate.history) && typeof candidate.transitionCount === 'number';
}

function phaseForm(entry: StructureHistoryEntry, fallback: StructureForm): StructureForm {
  return entry.form ?? fallback;
}

function phaseLevel(entry: StructureHistoryEntry, fallback: number): number {
  return entry.level ?? fallback;
}

function phaseMaterial(entry: StructureHistoryEntry, fallback: StructureMaterial): StructureMaterial {
  return entry.material ?? fallback;
}

/**
 * Compact deterministic lineage signature used by the asset cache. Two structures that look
 * identical today but reached that state through different material/cultural histories must
 * not silently share one historical mesh.
 */
export function heritageFingerprint(response: DevelopmentResponse | undefined): string {
  if (!response || !isStructureDevelopment(response)) return 'fresh';
  const entries = [response.origin, ...response.history].slice(-13);
  return [
    response.transitionCount,
    ...entries.map(entry => [
      entry.month,
      entry.action,
      entry.need,
      entry.form ?? '-',
      entry.level ?? '-',
      entry.material ?? '-',
      entry.cultureId,
    ].join('.')),
  ].join('|');
}

/**
 * Reduce authoritative structure history into presentation facts. No history is invented here:
 * every flag is derived from the permanent origin plus retained transition records.
 */
export function deriveStructureHeritage(response: DevelopmentResponse): StructureHeritage | undefined {
  if (!isStructureDevelopment(response)) return undefined;
  if (response.transitionCount <= 0 && response.history.length === 0) return undefined;

  const origin = response.origin;
  const phases = [origin, ...response.history]
    .filter(entry => entry.action !== 'abandoned' && entry.action !== 'ruined');
  const fallbackForm = response.form;
  const fallbackMaterial = response.material;
  // A level-only upgrade is the same architectural generation. Legacy means a phase whose
  // social use, physical form, material or culture is actually different from the present.
  const prior = [...phases].reverse().find(entry =>
    entry.need !== response.need
    || phaseForm(entry, fallbackForm) !== response.form
    || phaseMaterial(entry, fallbackMaterial) !== response.material
    || entry.cultureId !== response.cultureId,
  ) ?? origin;

  const upgradeCount = response.history.filter(entry => entry.action === 'expanded' || entry.action === 'upgraded').length;
  const repurposed = response.history.some(entry => entry.action === 'repurposed');
  const reused = response.history.some(entry => entry.action === 'reused');
  const survivedRuin = reused && response.history.some(entry => entry.action === 'ruined');
  const cultureShift = [origin, ...response.history].some(entry => entry.cultureId !== response.cultureId);
  const materialShift = [origin, ...response.history].some(entry => entry.material !== undefined && entry.material !== response.material);
  const needShift = [origin, ...response.history].some(entry => entry.need !== response.need);
  const ceremonialMemory = [origin, ...response.history].some(entry =>
    entry.need === 'religion' || entry.need === 'government' || entry.need === 'memory'
    || entry.form === 'sanctuary' || entry.form === 'marker',
  );
  const industrialMemory = [origin, ...response.history].some(entry =>
    entry.need === 'manufacturing' || entry.need === 'energy' || entry.form === 'works' || entry.form === 'workshop',
  );

  const continuity = origin.need === response.need ? 0.12 : 0;
  const durableMemory = ceremonialMemory ? 0.08 : 0;
  const accumulatedFabric = Math.min(0.12, response.transitionCount * 0.024);
  const materialEvidence = materialShift ? 0.05 : 0;
  const disruptiveReuse = repurposed ? -0.035 : 0;
  const ruinLoss = survivedRuin ? -0.055 : 0;
  const preservation = clamp(0.2 + continuity + durableMemory + accumulatedFabric + materialEvidence + disruptiveReuse + ruinLoss, 0.16, 0.52);

  return {
    originNeed: origin.need,
    originForm: phaseForm(origin, response.form),
    originLevel: phaseLevel(origin, response.level),
    originMaterial: phaseMaterial(origin, response.material),
    originCultureId: origin.cultureId,
    legacyNeed: prior.need,
    legacyForm: phaseForm(prior, response.form),
    legacyMaterial: phaseMaterial(prior, response.material),
    transitionCount: response.transitionCount,
    upgradeCount,
    repurposed,
    reused,
    survivedRuin,
    cultureShift,
    materialShift,
    needShift,
    ceremonialMemory,
    industrialMemory,
    preservation,
    fingerprint: heritageFingerprint(response),
  };
}

function wallLayerForMaterial(material: StructureMaterial): WallLayer {
  switch (material) {
    case 'earth': return 'daub';
    case 'timber': return 'daub';
    case 'masonry': return 'stone';
    case 'ceramic': return 'brick';
    case 'metal': return 'panel';
  }
}

function preserveLegacyForm(grammar: BuildingGrammar, heritage: StructureHeritage): void {
  const strong = heritage.preservation >= 0.3;
  switch (heritage.legacyForm) {
    case 'sanctuary':
      grammar.roofTiers = Math.max(grammar.roofTiers, Math.max(2, heritage.originLevel));
      grammar.ridgeFinials = true;
      grammar.forecourt = grammar.forecourt || strong;
      grammar.eaveOverhang *= 1.04;
      break;
    case 'tower':
      grammar.wallHeight *= 1.04;
      grammar.gateway = grammar.gateway || strong;
      if (grammar.enclosure === 'none') grammar.enclosure = strong ? 'yard' : 'stakes';
      break;
    case 'hall':
      grammar.stairs = true;
      grammar.plinthHeight *= 1.08;
      grammar.forecourt = grammar.forecourt || (strong && heritage.ceremonialMemory);
      break;
    case 'workshop':
    case 'works':
      grammar.chimneys = Math.max(grammar.chimneys, heritage.industrialMemory ? 1 : 0);
      grammar.vents = Math.max(grammar.vents, heritage.legacyForm === 'works' ? 1 : 0);
      break;
    case 'store':
    case 'gathering':
      if (grammar.veranda === 'none' && strong) grammar.veranda = 'front';
      break;
    case 'marker':
      grammar.plinthHeight *= 1.12;
      grammar.ridgeFinials = true;
      grammar.forecourt = grammar.forecourt || strong;
      break;
    case 'dwelling':
      if (grammar.veranda === 'none' && strong) grammar.veranda = 'front';
      break;
    case 'field':
      break;
  }
}

/**
 * Step 3 structure identity: turn an upgraded/repurposed site into an architectural palimpsest.
 * The current institution still controls the building, but durable pieces of the old shell,
 * precinct and working infrastructure survive when the authoritative history says they should.
 */
export function applyHistoricalInheritance(grammar: BuildingGrammar, response: DevelopmentResponse): void {
  const heritage = deriveStructureHeritage(response);
  if (!heritage) return;

  preserveLegacyForm(grammar, heritage);

  // Repeated upgrades read as accumulated annexes instead of a pristine single-generation block.
  if (heritage.upgradeCount > 0) {
    const accretion = Math.min(0.1, heritage.upgradeCount * 0.022);
    grammar.width *= 1 + accretion;
    grammar.depth *= 1 + accretion * 0.7;
    grammar.bays += Math.min(2, heritage.upgradeCount);
    if (grammar.massing === 'single' && response.level > 1) grammar.massing = 'wing';
  }

  // Repurposing keeps the inherited shell but expresses a visibly additive conversion.
  if (heritage.repurposed || heritage.reused) {
    grammar.width *= heritage.reused ? 1.035 : 1.06;
    grammar.depth *= heritage.reused ? 1.025 : 1.04;
    grammar.bays += 1;
    if (grammar.massing === 'single' && response.form !== 'tower' && response.form !== 'marker') grammar.massing = 'wing';
  }

  // Keep old structural fabric visible through a new frame/opening system when materials change.
  // A stone shell with steel framing, or daub walls braced by masonry, immediately reads as layered history.
  if (heritage.materialShift && heritage.preservation >= 0.24) {
    grammar.wallLayer = wallLayerForMaterial(heritage.legacyMaterial);
    grammar.plinthHeight *= heritage.legacyMaterial === 'masonry' || heritage.legacyMaterial === 'ceramic' ? 1.08 : 1;
  }

  // A site rebuilt after abandonment/ruin should retain heavier foundations and a trace of its old boundary.
  if (heritage.survivedRuin) {
    grammar.plinthHeight *= 1.12;
    grammar.stairs = true;
    if (grammar.enclosure === 'none' && heritage.preservation > 0.2) grammar.enclosure = 'yard';
  }

  // Cultural succession should not erase every older ceremonial cue in a single generation.
  if (heritage.cultureShift) {
    grammar.patternBands = Math.max(grammar.patternBands, heritage.ceremonialMemory ? 2 : 1);
    grammar.ridgeFinials = grammar.ridgeFinials || heritage.ceremonialMemory;
    grammar.ornament = Math.max(grammar.ornament, heritage.ceremonialMemory ? 0.42 : 0.24);
  }

  grammar.bays = Math.max(1, Math.min(10, Math.round(grammar.bays)));
  grammar.width = Math.max(0.42, grammar.width);
  grammar.depth = Math.max(0.42, grammar.depth);
  grammar.wallHeight = Math.max(0.18, grammar.wallHeight);
}
