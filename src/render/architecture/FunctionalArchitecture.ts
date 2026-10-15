import type { BuildingSpec } from './BuildingSpec';
import { architecturalMaterial } from './MaterialLibrary';
import { structuralFamily } from './StructuralFamily';
import { periodRank } from './ArchitecturalPeriod';
/** Function fixes the section and circulation; materials still come from BuildingSpec. */
export interface FunctionalArchitecture {
    plan: 'rooms' | 'threshing-aisle' | 'feeding-passage' | 'stall-range' | 'grain-floors' | 'work-hall';
    section: 'pitched' | 'aisled' | 'lean-to' | 'hipped' | 'flat';
    bays: number;
    raisedFloor: boolean;
    /** Composed ranges stay within the resolved plot envelope. */
    composition?: 'single' | 'courtyard' | 'stable-yard';
    roofAxis?: 'x' | 'z';
    gableLight?: boolean;
    entryPorch?: boolean;
    loadingHoist?: boolean;
    /** Derived child-range joints; outer specs resolve these through composition. */
    attachedEnd?: 'left' | 'right';
    courtFrontWidth?: number;
    galleryDepth?: number;
}
export function resolveFunctionalArchitecture(spec: BuildingSpec): void {
    if (spec.adaptation || spec.dwellingVariant || spec.temporary)
        return;
    if (spec.archetype === 'house' && spec.purpose && spec.purpose !== 'housing')
        return;
    const rank = periodRank(spec.period);
    const bayCount = Math.max(2, Math.min(6, spec.bays));
    switch (spec.archetype) {
        case 'house':
            spec.architecture = { plan: 'rooms', section: ['flat', 'flat-parapet'].includes(spec.roof.archetype) ? 'flat' : spec.roof.archetype === 'hipped' ? 'hipped' : 'pitched', bays: bayCount, raisedFloor: false };
            break;
        case 'barn':
            // A loft is storage within a high framed volume, never two stacked dwelling facades.
            if (spec.floors > 1) {
                spec.storeyHeight *= 1.35;
                spec.floors = 1;
            }
            spec.architecture = { plan: 'threshing-aisle', section: rank < 6 ? 'aisled' : 'pitched', bays: bayCount, raisedFloor: false };
            break;
        case 'byre':
            spec.floors = 1;
            spec.architecture = { plan: 'feeding-passage', section: 'lean-to', bays: bayCount, raisedFloor: false };
            spec.roof.archetype = 'shed';
            break;
        case 'stable':
            spec.floors = 1;
            spec.architecture = { plan: 'stall-range', section: rank >= 2 ? 'hipped' : 'pitched', bays: Math.max(3, bayCount), raisedFloor: false };
            if (spec.architecture.section === 'hipped')
                spec.roof.archetype = 'hipped';
            break;
        case 'workshop':
            // A craft hall meets the lane with a working doorway and well-lit benches.
            // Open early sheds and later industrial roof systems keep their dedicated paths.
            if (rank < 2 || rank > 5 || spec.openness >= .35) return;
            if (rank <= 3) { spec.floors = 1; spec.storeyHeight *= 1.15; }
            spec.architecture = { plan: 'work-hall', section: 'pitched', bays: bayCount, raisedFloor: false };
            break;
        case 'granary':
            spec.architecture = { plan: 'grain-floors', section: rank >= 6 ? 'flat' : 'pitched', bays: bayCount, raisedFloor: rank === 1 };
            if (rank === 1)
                spec.foundation = 'stone-footing';
            if (rank === 1)
                spec.plinthHeight = Math.max(spec.plinthHeight, spec.storeyHeight * .42);
            break;
        default: return;
    }
    // Keep the roof contract consistent with the section the composer actually builds.
    if (spec.architecture.section === 'flat') {
        spec.roof.archetype = 'flat';
        spec.roof.pitch = 0;
    }
    else if (spec.architecture.section === 'pitched' || spec.architecture.section === 'aisled')
        spec.roof.archetype = 'gable';
    const architecture = spec.architecture;
    architecture.composition = 'single';
    architecture.roofAxis = 'x';
    const shelteredCourt = spec.archetype === 'house' && rank >= 2 && rank <= 4
        && (spec.climate.courtyard || rank === 2 && !['cold', 'snowy', 'wet'].includes(spec.climate.zone));
    if (shelteredCourt) {
        architecture.composition = 'courtyard';
        spec.width = Math.max(spec.width * 1.35, (spec.wallThickness * 2 + spec.storeyHeight * .85) / .28);
        spec.depth = Math.max(spec.depth * 1.5, (spec.wallThickness * 2 + spec.storeyHeight * .85) / .34);
        spec.floors = 1;
        architecture.section = spec.climate.zone === 'arid' && spec.materials.roofCovering === 'adobe' ? 'flat' : 'pitched';
        spec.roof.archetype = architecture.section === 'flat' ? 'flat' : 'gable';
        if (architecture.section === 'flat') {
            spec.roof.pitch = 0;
            spec.parapet = true;
        }
        spec.roof.span = Math.max(spec.depth * .34, spec.width * .28);
    }
    if (spec.archetype === 'stable' && rank >= 3 && rank <= 4) {
        architecture.composition = 'stable-yard';
        spec.width *= 1.3;
        spec.depth *= 1.65;
        architecture.bays = 2;
        spec.roof.span = Math.max(spec.depth * .34, spec.width * .28);
    }
    if (spec.archetype === 'house' && architecture.composition === 'single' && rank >= 3 && rank <= 5 && architecture.section === 'pitched') {
        architecture.roofAxis = 'z';
        spec.roof.span = spec.width;
        architecture.gableLight = spec.roof.pitch > .35;
    }
    architecture.entryPorch = spec.archetype === 'barn' && rank >= 2 && rank < 6;
    architecture.loadingHoist = spec.archetype === 'granary' && rank >= 3 && rank <= 5 && spec.floors > 1;
    spec.bays = Math.max(1, Math.ceil(spec.width / spec.baySpacing));
    const family = structuralFamily(spec.family);
    const maxSpan = family.maxRoofSpan * (.6 + architecturalMaterial(spec.materials.roofStructure).structure.span * .8);
    if (spec.roof.span > maxSpan && !spec.roof.intermediateSupport) {
        spec.roof.intermediateSupport = true;
        spec.supportDensity = Math.min(1, spec.supportDensity + .2);
    }
    spec.roof.tiers = 1;
    spec.roof.pitch = Math.min(spec.roof.pitch, spec.archetype === 'byre' ? .4 : spec.archetype === 'barn' ? .85 : .8);
    spec.roof.overhang = Math.min(spec.roof.overhang, spec.depth * .075 * Math.min(1.5, spec.climate.eaveOverhang));
    spec.culture.ornament = Math.min(spec.culture.ornament, spec.archetype === 'house' ? .35 : .12);
}
