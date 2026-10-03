/**
 * SpecGrammarBridge.ts
 *
 * Connects the architectural spec to the renderer's existing building grammar.
 *
 * The migration strategy is deliberate. `BuildingGrammar` is what the composer, the LOD builder,
 * the component manifest, the construction presenter and a long tail of tests already speak, and
 * rewriting all of that at once would be reckless. So the spec does not replace the grammar: it
 * *drives* it. Everything the grammar already had a knob for — footprint, bays, storeys, pitch,
 * overhang, plinth — is now set from the spec, and the genuinely new decisions (wall thickness,
 * frame exposure, support density, real construction materials per surface) arrive as additional
 * optional fields that the composer reads where they matter.
 *
 * The result is that a spec-driven building differs from its predecessor in geometry and in
 * material, while every system downstream of the grammar keeps working unchanged.
 */

import type { ArchitecturalMaterialId } from './MaterialLibrary';
import { architecturalMaterial } from './MaterialLibrary';
import type { BuildingSpec } from './BuildingSpec';
import { periodRank } from './ArchitecturalPeriod';
import type {
  BuildingGrammar,
  FrontageStyle,
  OpeningStyle,
  PostStyle,
  RoofFamily,
  WallLayer,
  YardProps,
} from '../assets/BuildingGrammar';
import type { FunctionalEquipment } from './BuildingArchetype';
import type { SurfaceKey } from '../materials/MaterialPalette';

/**
 * The legacy wall layer a construction material presents as.
 *
 * Only used for the grammar's own branching (vernacular fabric, stack and crown material
 * choices). What the wall actually *looks* like comes from the architectural material, so this
 * mapping needs to be structurally honest rather than visually precise.
 */
export function wallLayerFor(id: ArchitecturalMaterialId): WallLayer {
  switch (id) {
    case 'fieldstone':
    case 'rubble-masonry':
    case 'dressed-stone':
    case 'ashlar':
    case 'limestone':
    case 'sandstone':
    case 'granite':
    case 'slate':
    case 'concrete':
      return 'stone';
    case 'fired-brick':
    case 'buff-brick':
    case 'clay-tile':
    case 'terracotta':
      return 'brick';
    case 'plaster':
      return 'plaster';
    case 'thatch':
      return 'thatch';
    case 'corrugated-metal':
    case 'sheet-metal':
    case 'copper':
    case 'aluminium':
    case 'steel':
    case 'structural-steel':
    case 'cast-iron':
    case 'wrought-iron':
    case 'curtain-glass':
    case 'glass':
    case 'reinforced-concrete':
    case 'asphalt-membrane':
      return 'panel';
    // Earth and timber both read as the framed-and-infilled vernacular the grammar calls 'daub',
    // which is what keeps exposed bracing and lashing switched on for them.
    case 'mud-brick':
    case 'adobe':
    case 'wattle-and-daub':
    case 'logs':
    case 'rough-hewn-timber':
    case 'heavy-timber':
    case 'sawn-lumber':
    case 'finished-wood':
    case 'wood-shingle':
      return 'daub';
  }
}

/** The legacy post style a frame material presents as. */
export function postStyleFor(id: ArchitecturalMaterialId, primitive: boolean): PostStyle {
  if (primitive) return 'poles';
  switch (architecturalMaterial(id).family) {
    case 'timber':
      return 'timber';
    case 'stone':
    case 'ceramic':
      return 'stone';
    case 'metal':
      return 'steel';
    case 'binder':
      return id === 'reinforced-concrete' ? 'composite' : 'stone';
    default:
      return 'timber';
  }
}

/** The opening style implied by what the building can glaze with. */
export function openingStyleFor(spec: BuildingSpec): OpeningStyle {
  if (spec.openings.density <= 0.03) return 'flap';
  const glazing = spec.materials.glazing;
  if (!glazing) return periodRank(spec.period) <= 1 ? 'flap' : 'shutter';
  switch (glazing) {
    case 'curtain-glass':
      return 'panel';
    case 'glass':
      return 'glazed';
    case 'steel':
    case 'wrought-iron':
    case 'aluminium':
      return 'glazed';
    case 'finished-wood':
      return spec.openings.density > 0.2 ? 'lattice' : 'shutter';
    default:
      return 'shutter';
  }
}

/**
 * The legacy roof family a spec's roof archetype presents as.
 *
 * The grammar's roof families are a smaller vocabulary than the archetypes', so several
 * archetypes collapse onto one family. Pitch, tiers and overhang carry the difference, and those
 * are set from the spec directly.
 */
export function roofFamilyFor(spec: BuildingSpec): RoofFamily {
  switch (spec.roof.archetype) {
    case 'conical':
      return 'hide-cone';
    case 'shed':
      return 'lean-slope';
    case 'sawtooth':
      return 'saw-tooth';
    case 'monitor':
    case 'train-shed':
    case 'open-span':
      return 'canopy-shell';
    case 'dome':
    case 'vault':
      return 'shell-dome';
    case 'stepped':
      return 'stepped-terrace';
    case 'layered':
      return 'tile-layered';
    case 'flat':
    case 'flat-parapet':
      // A flat roof has no gable to read, so the hipped family's low shell is the closest
      // existing form; the parapet flag and a near-zero pitch do the rest.
      return 'tile-hip';
    case 'hipped':
    case 'pediment':
      return 'tile-hip';
    case 'gable':
    case 'steep-gable':
    case 'low-gable':
      return spec.materials.roofCovering === 'thatch' ? 'thatch-hip' : 'tile-gable';
  }
}

/**
 * The street frontage a piece of functional equipment implies.
 *
 * Only the equipment that genuinely changes how a building meets the street appears here; a
 * manger or a water trough says nothing about the frontage.
 */
const EQUIPMENT_FRONTAGE: Partial<Record<FunctionalEquipment, FrontageStyle>> = {
  'market-stall': 'market-stalls',
  counter: 'market-stalls',
  arcade: 'colonnade',
  'loading-platform': 'loading-dock',
  'quay-bollard': 'loading-dock',
  'side-ramp': 'loading-dock',
  'wagon-apron': 'work-yard',
  'machine-tool': 'work-yard',
  'gantry-crane': 'work-yard',
  conveyor: 'work-yard',
  'gate-leaf': 'guard-screen',
  portcullis: 'guard-screen',
};

/**
 * The yard dressing a piece of equipment implies, in increasing specificity.
 *
 * Later entries win, so a building that has both a workbench and a furnace reads as a foundry.
 */
const EQUIPMENT_PROPS: Partial<Record<FunctionalEquipment, YardProps>> = {
  hearth: 'domestic',
  bedding: 'domestic',
  'water-trough': 'storage',
  manger: 'storage',
  'stall-divider': 'storage',
  'hay-loft': 'storage',
  'grain-bin': 'storage',
  'threshing-floor': 'storage',
  'silo-chute': 'storage',
  'crate-stack': 'storage',
  'market-stall': 'market',
  counter: 'market',
  'cart-stand': 'market',
  workbench: 'workshop',
  'line-shaft': 'workshop',
  'machine-tool': 'workshop',
  conveyor: 'workshop',
  'gantry-crane': 'workshop',
  transformer: 'utility',
  pipework: 'utility',
  forge: 'foundry',
  kiln: 'foundry',
  battlement: 'defensive',
  'watch-platform': 'defensive',
};

const PROPS_SPECIFICITY: readonly YardProps[] = [
  'none', 'domestic', 'storage', 'market', 'workshop', 'utility', 'foundry', 'defensive',
  'herb-garden', 'altar', 'civic',
];

/**
 * Let the archetype's functional equipment show on the building.
 *
 * Equipment only ever *strengthens* what the development response already decided: a frontage or
 * yard the response left as 'none' can be filled in, and counts of flues and vents can be raised,
 * but nothing the simulation's own social reading established is overwritten. That keeps this an
 * additive presentation layer rather than a competing authority.
 */
function applyEquipmentToGrammar(grammar: BuildingGrammar, equipment: readonly FunctionalEquipment[]): void {
  if (equipment.length === 0) return;

  let chimneys = 0;
  let vents = 0;
  let heat = 0;
  let props = grammar.props;
  let propsRank = PROPS_SPECIFICITY.indexOf(props);

  for (const item of equipment) {
    if (item === 'chimney') chimneys += 1;
    if (item === 'ridge-vent' || item === 'louver-vent') vents += 1;
    if (item === 'forge' || item === 'kiln') { heat = Math.max(heat, 0.7); chimneys += 1; }
    if (item === 'transformer') heat = Math.max(heat, 0.4);

    if (grammar.frontage === 'none') {
      const frontage = EQUIPMENT_FRONTAGE[item];
      if (frontage) grammar.frontage = frontage;
    }

    const candidate = EQUIPMENT_PROPS[item];
    if (candidate) {
      const rank = PROPS_SPECIFICITY.indexOf(candidate);
      if (rank > propsRank) { props = candidate; propsRank = rank; }
    }
  }

  grammar.chimneys = Math.max(grammar.chimneys, Math.min(4, chimneys));
  grammar.vents = Math.max(grammar.vents, Math.min(4, vents));
  grammar.forgeGlow = Math.max(grammar.forgeGlow, heat);
  // Only replace a yard the response did not already characterise.
  if (grammar.props === 'none' || PROPS_SPECIFICITY.indexOf(grammar.props) < 2) grammar.props = props;
}

/**
 * Apply a resolved spec to a grammar in place.
 *
 * Every assignment here replaces a decision the grammar used to make from era and role alone
 * with one the spec made from the simulation's own state.
 */
export function applySpecToGrammar(grammar: BuildingGrammar, spec: BuildingSpec): void {
  const primitive = spec.family === 'primitive-shelter';

  grammar.spec = spec;

  // ----- massing and rhythm -----
  grammar.width = spec.width;
  grammar.depth = spec.depth;
  grammar.wallHeight = spec.storeyHeight;
  grammar.storeys = spec.floors;
  // Bay count now follows the frame material's span rather than the role's habit, which is what
  // opens a steel shed out and closes a rubble wall in.
  grammar.bays = spec.bays;
  grammar.plinthHeight = spec.plinthHeight;

  // ----- materials -----
  grammar.wallLayer = wallLayerFor(spec.materials.wall);
  grammar.postStyle = postStyleFor(spec.materials.frame, primitive);
  grammar.openings = openingStyleFor(spec);

  // Post size follows the frame material: a stone pier is not a steel stanchion. Load capacity
  // sets the section, so a weaker material needs a visibly fatter member to do the same work.
  const frame = architecturalMaterial(spec.materials.frame).structure;
  grammar.postThickness = Math.max(0.02, spec.wallThickness * (0.55 + (1 - Math.min(1, frame.load)) * 0.5));

  // ----- roof -----
  grammar.roofFamily = roofFamilyFor(spec);
  grammar.roofPitch = spec.roof.pitch;
  grammar.roofTiers = spec.roof.tiers;
  grammar.eaveOverhang = spec.roof.overhang;

  // ----- openings -----
  grammar.windowRows = spec.openings.perBay <= 0
    ? 1
    : Math.max(1, Math.min(3, Math.min(spec.floors, Math.round(spec.openings.density * 3) + 1)));

  // ----- new structural decisions the grammar had no vocabulary for -----
  grammar.wallThickness = spec.wallThickness;
  grammar.frameExposure = spec.frameExposure;
  grammar.supportDensity = spec.supportDensity;
  grammar.openingWidth = spec.openings.width;
  grammar.openingHeight = spec.openings.height;
  grammar.parapet = spec.parapet;

  // ----- age -----
  // Wear is now a consequence of what the building is made of and how long it has stood, not a
  // flat per-era guess.
  grammar.wear = spec.age.wear;

  // A diagonally braced bay is a property of the frame, not of a hard-coded material name.
  grammar.reinforced = spec.frameExposure > 0.45 && frame.span > 0.5;

  // ----- functional equipment -----
  applyEquipmentToGrammar(grammar, spec.equipment);
}

/**
 * The architectural material behind each render surface the composer is about to use.
 *
 * The composer keeps asking for semantic surfaces ('stone' for a wall, 'timber' for a post).
 * This map tells the canvas which real construction material each of those surfaces is made of,
 * so two surfaces resolving to the same material merge into a single draw call.
 *
 * Primary roles are assigned first and never overwritten; the remaining architectural surfaces
 * are filled with the nearest sensible role so incidental detail geometry still renders in a
 * material the building actually contains.
 */
export function specSurfaceMaterials(
  spec: BuildingSpec,
  primary: {
    wallSurface: SurfaceKey;
    roofSurface: SurfaceKey;
    postSurface: SurfaceKey;
    baseSurface?: SurfaceKey;
  },
): Map<SurfaceKey, ArchitecturalMaterialId> {
  const map = new Map<SurfaceKey, ArchitecturalMaterialId>();
  const claim = (surface: SurfaceKey | undefined, id: ArchitecturalMaterialId | undefined): void => {
    if (!surface || !id || map.has(surface)) return;
    map.set(surface, id);
  };

  const materials = spec.materials;
  claim(primary.wallSurface, materials.wall);
  claim(primary.roofSurface, materials.roofCovering);
  claim(primary.postSurface, materials.frame);
  claim(primary.baseSurface, materials.foundation);

  // Incidental surfaces the composer reaches for directly, mapped to the role they stand in for.
  claim('stone', materials.foundation);
  claim('brick', materials.wall);
  claim('panel', materials.finish ?? materials.wall);
  claim('plaster', materials.finish ?? materials.wall);
  claim('daub', materials.infill ?? materials.wall);
  claim('timber', materials.trim);
  claim('metal', materials.hardware ?? materials.frame);
  claim('thatch', materials.roofCovering);
  claim('hide', materials.wall);
  claim('roof-thatch', materials.roofCovering);
  claim('roof-tile', materials.roofCovering);
  claim('roof-metal', materials.roofCovering);

  return map;
}
