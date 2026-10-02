import { facilityTierSpec } from '../../sim/processing/FacilityCatalog';
import type { FacilityFamilyId, FacilityStatus, ProcessingFacility } from '../../sim/processing/types';
import type { Settlement, SimulationState, StructurePlot } from '../../sim/types';

export type FacilityStage = 'construction' | 'operating' | 'upgrading' | 'ruined';
export type PileKind = 'log' | 'lumber' | 'charcoal' | 'ore' | 'coal' | 'ingot' | 'slag' | 'generic';

export interface FacilityPile {
  material: string;
  kind: PileKind;
  /** 0..1 of the yard's capacity actually holding this material. */
  fill: number;
}

/**
 * Everything a renderer may know about a processing facility, derived from simulation state and
 * nothing else. It has no way to add stock, labour, power or output: geometry can only show what
 * the authority already did.
 */
export interface FacilityVisual {
  id: string;
  family: FacilityFamilyId;
  tier: number;
  kind: string;
  stage: FacilityStage;
  status: FacilityStatus;
  /** Progress of the erection (stage `construction`) or of the conversion (stage `upgrading`). */
  build: number;
  /** Fraction of nominal work delivered last month; drives machinery motion. */
  activity: number;
  /** Furnace temperature 0..1. */
  heat: number;
  /** Chimney smoke 0..1 from real fuel burned or a charcoal burn in progress. */
  smoke: number;
  /** Shaft or boiler steam 0..1. */
  steam: number;
  carrier: 'none' | 'mechanical' | 'electric';
  /** Delivered/requested power for powered tiers; 1 when the tier needs none. */
  powerCoverage: number;
  /** Electric supply is actually reaching the works. */
  energised: boolean;
  /** 0..1 lost to structural or machinery damage. */
  damage: number;
  scorch: number;
  inputs: FacilityPile[];
  outputs: FacilityPile[];
  /** Cargo moved in or out last month. */
  hauling: { inbound: boolean; outbound: boolean; vehicle: ProcessingFacility['access']['vehicle'] };
  /**
   * Worker-months the authority spent here, reduced to a legible head count. The crew itself is
   * represented people bound to stations (FacilityCrewScene); geometry draws no figures, so this
   * is deliberately not part of the geometry signature.
   */
  crew: number;
  /** Months since the last tier change; presentation marks fresh work for two years. */
  monthsSinceUpgrade: number | undefined;
  position: { x: number; z: number };
  yaw: number;
  width: number;
  depth: number;
  radius: number;
  yard: number;
}

export const pileKindOf = (material: string): PileKind =>
  material === 'timber' ? 'log'
    : material === 'lumber' || material === 'timber-frame' ? 'lumber'
      : material === 'charcoal' ? 'charcoal'
        : material === 'coal' ? 'coal'
          : /-ore$/.test(material) ? 'ore'
            : material === 'slag' || material === 'ash' ? 'slag'
              : /^(copper|tin|iron|steel|bronze|iron-tools|machine-parts|engine)$/.test(material) ? 'ingot' : 'generic';

function piles(stock: Record<string, number>, yard: number): FacilityPile[] {
  return Object.entries(stock)
    .filter(([, amount]) => amount > 0.05)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, 3)
    .map(([material, amount]) => ({ material, kind: pileKindOf(material), fill: Math.max(0.04, Math.min(1, amount / Math.max(1, yard))) }));
}

/** Pure projection. Returns undefined when there is no physical site to draw on. */
export function facilityVisual(state: SimulationState, settlement: Settlement, f: ProcessingFacility): FacilityVisual | undefined {
  const plot: StructurePlot | undefined = settlement.structurePlots?.find(p => p.id === f.plotId);
  const spec = facilityTierSpec(f.family, f.tier);
  if (!plot || !spec) return undefined;
  const upgrading = !!f.upgrade;
  const stage: FacilityStage = f.progress < 1 ? 'construction' : f.status === 'ruined' ? 'ruined' : upgrading ? 'upgrading' : 'operating';
  const working = f.status === 'active' || f.status === 'unpowered';
  const activity = working ? Math.min(1, f.throughput) : 0;
  const charcoalBurning = (f.processes['catalog:charcoal']?.batches ?? 0) > 0;
  const hot = stage === 'operating' && f.heat > 0.2;
  const smoke = stage !== 'operating' ? 0
    : Math.min(1, (working ? f.heat * 0.85 : f.heat * 0.35) + (charcoalBurning ? 0.45 : 0));
  const powered = spec.power.mode !== 'none';
  const steam = stage === 'operating' && working && powered && f.power.carrier === 'mechanical' && f.family !== 'metallurgy' ? activity * 0.6
    : stage === 'operating' && working && f.family === 'metallurgy' && f.tier >= 3 ? 0.5 * activity : 0;
  const dx = plot.worldX - settlement.position.x, dz = plot.worldZ - settlement.position.z;
  const integrity = Math.min(plot.condition, f.condition);
  return {
    id: f.id, family: f.family, tier: f.tier, kind: f.kind, stage, status: f.status,
    build: stage === 'construction' ? f.progress : (f.upgrade?.progress ?? 1),
    activity, heat: hot ? f.heat : Math.min(f.heat, 0.15), smoke, steam,
    carrier: f.power.carrier, powerCoverage: powered ? f.power.coverage : 1,
    energised: f.power.carrier === 'electric' && f.power.coverage >= spec.power.minimumCoverage && working,
    damage: Math.max(0, 1 - integrity), scorch: Math.max(plot.scorch ?? 0, plot.char ?? 0),
    inputs: piles(f.inputs, spec.yard), outputs: piles(f.outputs, spec.yard),
    hauling: { inbound: f.freight.inbound > 0.01, outbound: f.freight.outbound > 0.01, vehicle: f.access.vehicle },
    crew: working ? Math.max(1, Math.min(6, Math.round(f.labour.used + f.labour.haul * 0.5))) : 0,
    monthsSinceUpgrade: f.history.filter(h => h.action === 'upgraded').at(-1) ? state.month - f.history.filter(h => h.action === 'upgraded').at(-1)!.month : undefined,
    position: { x: plot.worldX, z: plot.worldZ },
    yaw: Math.atan2(-dx, -dz), width: plot.width, depth: plot.depth, radius: plot.radius, yard: spec.yard,
  };
}

/** Stable, coarse signature: rebuild geometry only when something a viewer could see has changed. */
export function facilityVisualSignature(v: FacilityVisual): string {
  const q = (n: number, steps = 10): number => Math.round(n * steps);
  return [v.id, v.tier, v.stage, v.status, q(v.build), q(v.activity, 5), q(v.heat, 4), q(v.smoke, 4), q(v.steam, 4), v.carrier, v.energised ? 1 : 0,
    q(v.damage, 6), q(v.scorch, 4), v.inputs.map(p => `${p.kind}${q(p.fill, 6)}`).join(','), v.outputs.map(p => `${p.kind}${q(p.fill, 6)}`).join(','),
    v.hauling.inbound ? 1 : 0, v.hauling.outbound ? 1 : 0, v.hauling.vehicle, v.monthsSinceUpgrade !== undefined && v.monthsSinceUpgrade < 24 ? 1 : 0,
    q(v.position.x, 100), q(v.position.z, 100), q(v.width, 20)].join('|');
}
