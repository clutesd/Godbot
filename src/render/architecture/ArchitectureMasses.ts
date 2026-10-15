/** One normalized range plan, shared by production walls, facade publication and LOD. */
import type { BuildingGrammar } from '../assets/BuildingGrammar';

/** Secondary shell volumes; shared by their geometry and the openings they conceal. */
export function shellAnnexMasses(grammar: BuildingGrammar): { x: number; z: number; width: number; depth: number; height: number }[] {
  const w = grammar.width, d = grammar.depth, h = grammar.wallHeight * grammar.storeys;
  switch (grammar.massing) {
    case 'wing': return [{ x: w * .36, z: -d * .475, width: w * .44, depth: d * .6, height: h * .72 }];
    case 'twin': return [-1, 1].map(side => ({ x: side * w * .43, z: d * .25, width: w * .34, depth: d * .38, height: h * .84 }));
    case 'court': return [-1, 1].map(side => ({ x: side * w * .51, z: d * .55, width: w * .26, depth: d * .75, height: h * .6 }));
    default: return [];
  }
}
import type { Vec3 } from '../assets/GeometryBuilder';
export interface ArchitecturalMass {
    name: 'hall' | 'left-range' | 'right-range';
    grammar: Pick<BuildingGrammar, 'spec' | 'width' | 'depth' | 'wallHeight' | 'storeys' | 'bays' | 'eaveOverhang'>;
    x: number;
    z: number;
    yaw: number;
}
export function architecturalMasses(grammar: Pick<BuildingGrammar, 'spec' | 'width' | 'depth' | 'wallHeight'>): ArchitecturalMass[] {
    const spec = grammar.spec!;
    const scale = grammar.width / spec.width;
    const rear = grammar.depth * .34;
    const wing = grammar.width * .28;
    const length = grammar.depth - rear;
    const child = (width: number, depth: number, height: number, bays: number, attachedEnd?: 'left' | 'right', courtFrontWidth?: number): ArchitecturalMass['grammar'] => {
        const structuralBays = Math.max(bays, Math.ceil(width / Math.max(.1*scale, spec.baySpacing*scale)));
        const childSpec = { ...spec, width, depth, floors: 1, storeyHeight: height, bays: structuralBays, wallThickness:spec.wallThickness*scale, baySpacing:spec.baySpacing*scale,
            equipment: spec.archetype === 'stable' ? spec.equipment.filter(item => item === 'manger' || item === 'bedding') : !attachedEnd ? spec.equipment.filter(item => item === 'hearth' || item === 'chimney') : [], roof: { ...spec.roof, span: depth, overhang: Math.min(spec.roof.overhang*scale, depth * .08) },
            architecture: { ...spec.architecture!, composition: 'single' as const, roofAxis: 'x' as const, gableLight: false, entryPorch: false, loadingHoist: false, galleryDepth: spec.archetype === 'house' ? Math.min(wing * .35, spec.width * .12) : undefined, attachedEnd, courtFrontWidth, bays },
        };
        return { ...grammar, spec: childSpec, width, depth, wallHeight: height, storeys: 1, bays: structuralBays,
            eaveOverhang: childSpec.roof.overhang };
    };
    return [
        { name: 'hall', grammar: child(grammar.width, rear, grammar.wallHeight, spec.architecture!.bays, undefined, grammar.width - wing * 2), x: 0, z: -(grammar.depth - rear) / 2, yaw: 0 },
        { name: 'left-range', grammar: child(length, wing, grammar.wallHeight * .94, 2, 'right'), x: -(grammar.width - wing) / 2, z: rear / 2, yaw: Math.PI / 2 },
        { name: 'right-range', grammar: child(length, wing, grammar.wallHeight * .94, 2, 'left'), x: (grammar.width - wing) / 2, z: rear / 2, yaw: -Math.PI / 2 },
    ];
}
export function massPoint(mass: Pick<ArchitecturalMass, 'x' | 'z' | 'yaw'>, p: Vec3): Vec3 {
    const c = Math.cos(mass.yaw), s = Math.sin(mass.yaw);
    return { x: mass.x + p.x * c + p.z * s, y: p.y, z: mass.z - p.x * s + p.z * c };
}
/** Permanent room partitions, shared by physical emission and indoor movement. */
export function interiorPartitions(grammar: Pick<BuildingGrammar, 'spec' | 'width' | 'depth' | 'wallHeight' | 'storeys'>): {
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    rotationY: number;
}[] {
    if (grammar.spec?.architecture?.composition && grammar.spec.architecture.composition !== 'single')
        return architecturalMasses(grammar).flatMap(m => interiorPartitions(m.grammar).map(w => ({ ...w, ...massPoint(m, { x: w.x, y: 0, z: w.z }), rotationY: w.rotationY + m.yaw })));
    if (grammar.spec?.architecture?.plan !== 'rooms')
        return [];
    return [{ x: grammar.width * .05, z: -grammar.depth * .225, width: grammar.spec.wallThickness * grammar.width / grammar.spec.width, depth: grammar.depth * .4, height: grammar.wallHeight * grammar.storeys * .9, rotationY: 0 }];
}
