import type { FacilityDuty } from '../../sim/people/FacilityWorkRouting';
import type { FacilityFamilyId } from '../../sim/processing/types';
import type { Vec2 } from '../../sim/types';
import type { AnimationState } from '../animation/AnimationController';
import type { FacilityVisual } from './FacilityPresentation';

/**
 * Where a works can actually be worked.
 *
 * Every station below stands beside a machine IndustryRenderer draws for that family and tier, in
 * the same facility-local frame (+z toward the works' frontage, +x across it). A station is only
 * offered when the condition it depends on is true in simulation state: a furnace mouth is only
 * tended while the furnace is hot, a crane cab only while power is delivered, a loading bay only
 * while freight actually moved, a maintenance panel only while machinery is worn.
 *
 * Nothing here is authority. Stations are chosen from the facility's own state, and occupied only
 * by people the simulation already routed to this works.
 */

export type FacilityStationKind =
  | 'saw-pit' | 'saw-carriage' | 'log-deck' | 'conveyor' | 'gantry-control' | 'kiln-door' | 'lumber-shed'
  | 'charcoal-clamp' | 'furnace-tending' | 'bellows' | 'anvil' | 'casting-bed' | 'trip-hammer'
  | 'converter-control' | 'rolling-mill' | 'crane-control'
  | 'machine-bench' | 'lathe' | 'assembly-floor' | 'engine-test'
  | 'inspection' | 'maintenance-panel' | 'loading-bay' | 'stock-yard';

/** State a station depends on, checked against the facility's visual projection. */
type StationRequirement = 'heat' | 'power' | 'hauling' | 'wear' | 'stock';

interface StationSpec {
  kind: FacilityStationKind;
  /** Standing position in facility-local metres. */
  stand: Vec2;
  /** The machine, bed, mouth or table being worked, in the same local frame. */
  machine: Vec2;
  duty: FacilityDuty;
  requires?: StationRequirement;
  action: string;
  animation: AnimationState;
}

export interface FacilityStation {
  key: string;
  kind: FacilityStationKind;
  facilityId: string;
  duty: FacilityDuty;
  /** World position the person stands at. */
  anchor: Vec2;
  /** World position they face and work toward. */
  machine: Vec2;
  facing: number;
  action: string;
  animation: AnimationState;
}

const station = (
  kind: FacilityStationKind, stand: Vec2, machine: Vec2, duty: FacilityDuty, action: string,
  animation: AnimationState = 'work', requires?: StationRequirement,
): StationSpec => ({ kind, stand, machine, duty, action, animation, ...(requires ? { requires } : {}) });

/** Yard and dock stations are the same for every family; only the yards' size differs. */
function sharedStations(hw: number, hd: number): StationSpec[] {
  return [
    station('loading-bay', { x: hw + 0.9, z: hd + 1.45 }, { x: hw + 0.9, z: hd + 0.9 }, 'haul', 'load-freight', 'carry', 'hauling'),
    station('stock-yard', { x: -hw - 1.6, z: 0.35 }, { x: -hw - 0.95, z: 0.1 }, 'haul', 'move-stock', 'carry', 'stock'),
    station('maintenance-panel', { x: hw + 0.75, z: -hd - 0.5 }, { x: hw + 0.25, z: -hd - 0.12 }, 'maintenance', 'service-machinery', 'build', 'wear'),
    station('inspection', { x: hw + 1.45, z: 0.75 }, { x: hw + 0.95, z: 0.4 }, 'process', 'inspect-output', 'gather'),
  ];
}

function woodStations(tier: number, hw: number, hd: number): StationSpec[] {
  const front = hd + 1.05;
  if (tier === 1) {
    return [
      station('saw-pit', { x: 0.62, z: front }, { x: 0, z: front }, 'process', 'work-the-pit-saw'),
      station('saw-pit', { x: -0.62, z: front }, { x: 0, z: front }, 'process', 'steady-the-log'),
      station('charcoal-clamp', { x: hw + 0.9, z: -hd - 1.45 }, { x: hw + 0.9, z: -hd - 0.8 }, 'process', 'tend-the-clamp', 'work', 'heat'),
    ];
  }
  if (tier === 2) {
    return [
      station('saw-carriage', { x: 0.78, z: front + 0.2 }, { x: 0, z: front + 0.2 }, 'process', 'ride-the-saw-carriage'),
      station('log-deck', { x: -hw - 0.35, z: front + 1.15 }, { x: -hw - 0.35, z: front + 0.6 }, 'haul', 'roll-logs-onto-the-deck', 'carry'),
      station('saw-carriage', { x: -0.62, z: front + 0.75 }, { x: 0, z: front + 0.2 }, 'process', 'clear-the-cut'),
    ];
  }
  return [
    station('conveyor', { x: 0.52, z: front + 0.4 }, { x: -0.2, z: front + 0.4 }, 'process', 'feed-the-conveyor'),
    station('gantry-control', { x: -hw - 1.6, z: front - 0.2 }, { x: -hw - 0.95, z: front - 0.2 }, 'process', 'work-the-gantry', 'work', 'power'),
    station('kiln-door', { x: hw * 0.3, z: -hd - 1.15 }, { x: hw * 0.3, z: -hd - 0.5 }, 'process', 'draw-the-drying-kiln', 'work', 'power'),
    station('lumber-shed', { x: hw + 1.0, z: 0.85 }, { x: hw + 1.0, z: 0 }, 'haul', 'stack-finished-lumber', 'carry'),
  ];
}

function metallurgyStations(tier: number, hw: number, hd: number): StationSpec[] {
  const front = hd + 0.95;
  if (tier === 1) {
    return [
      station('furnace-tending', { x: 0, z: front + 0.75 }, { x: 0, z: front }, 'process', 'charge-the-bloomery', 'work', 'heat'),
      station('bellows', { x: -0.62, z: front + 0.75 }, { x: -0.62, z: front + 0.1 }, 'process', 'work-the-bellows'),
      station('anvil', { x: 0.75, z: front + 0.72 }, { x: 0.75, z: front + 0.15 }, 'process', 'forge-at-the-anvil'),
    ];
  }
  if (tier === 2) {
    return [
      station('furnace-tending', { x: 0, z: front + 0.68 }, { x: 0, z: front }, 'process', 'tap-the-furnace', 'work', 'heat'),
      station('casting-bed', { x: 0.85, z: front + 1.35 }, { x: 0, z: front + 0.85 }, 'process', 'pour-the-casting-bed', 'work', 'heat'),
      station('trip-hammer', { x: -hw * 0.6 - 0.6, z: front + 0.75 }, { x: -hw * 0.6, z: front + 0.75 }, 'process', 'control-the-trip-hammer'),
    ];
  }
  return [
    station('furnace-tending', { x: -hw * 0.3 - 1.0, z: -hd - 0.85 }, { x: -hw * 0.3, z: -hd - 0.85 }, 'process', 'watch-the-blast-furnace', 'work', 'heat'),
    station('converter-control', { x: hw * 0.5 + 0.95, z: -hd - 0.7 }, { x: hw * 0.5, z: -hd - 0.7 }, 'process', 'blow-the-converter', 'work', 'heat'),
    station('rolling-mill', { x: 0.55, z: front + 0.95 }, { x: 0, z: front + 0.2 }, 'process', 'work-the-rolling-mill'),
    station('crane-control', { x: -1.45, z: front + 0.95 }, { x: 0, z: front + 0.75 }, 'process', 'drive-the-overhead-crane', 'work', 'power'),
  ];
}

function machineryStations(tier: number, hd: number): StationSpec[] {
  const front = hd + 0.95;
  if (tier === 1) {
    return [
      station('machine-bench', { x: 0.55, z: front + 0.6 }, { x: 0.55, z: front }, 'process', 'fit-parts-at-the-bench'),
      station('furnace-tending', { x: -0.72, z: front + 0.6 }, { x: -0.72, z: front }, 'process', 'heat-stock-at-the-forge', 'work', 'heat'),
      station('lathe', { x: -0.05, z: front + 1.1 }, { x: -0.05, z: front + 0.5 }, 'process', 'turn-a-shaft'),
    ];
  }
  if (tier === 2) {
    return [
      station('lathe', { x: 0.68, z: front + 0.7 }, { x: 0.68, z: front }, 'process', 'turn-a-shaft'),
      station('machine-bench', { x: -0.68, z: front + 0.7 }, { x: -0.68, z: front }, 'process', 'cut-gear-teeth'),
      station('furnace-tending', { x: 0, z: front + 1.2 }, { x: 0, z: front + 0.55 }, 'process', 'draw-stock-from-the-forge', 'work', 'heat'),
    ];
  }
  return [
    station('assembly-floor', { x: 0.85, z: front + 0.85 }, { x: 0.2, z: front + 0.35 }, 'process', 'assemble-an-engine'),
    station('engine-test', { x: -0.95, z: front + 0.85 }, { x: -0.35, z: front + 0.35 }, 'process', 'run-the-test-bed', 'work', 'power'),
    station('crane-control', { x: -1.5, z: front + 1.3 }, { x: -0.6, z: front + 0.8 }, 'process', 'set-a-casting-with-the-crane', 'work', 'power'),
    station('lathe', { x: 0.1, z: front + 1.35 }, { x: 0.1, z: front + 0.7 }, 'process', 'finish-a-bearing'),
  ];
}

function familyStations(family: FacilityFamilyId, tier: number, hw: number, hd: number): StationSpec[] {
  if (family === 'wood') return woodStations(tier, hw, hd);
  if (family === 'metallurgy') return metallurgyStations(tier, hw, hd);
  if (family === 'machinery') return machineryStations(tier, hd);
  // A family whose geometry is still the plain works gets a bench in front of it and nothing invented.
  return [station('machine-bench', { x: 0, z: hd + 1.45 }, { x: 0, z: hd + 0.8 }, 'process', 'station-task')];
}

function requirementMet(requires: StationRequirement | undefined, v: FacilityVisual): boolean {
  if (!requires) return true;
  if (requires === 'heat') return v.heat > 0.2;
  if (requires === 'power') return v.carrier === 'electric' ? v.energised : v.powerCoverage > 0.2;
  if (requires === 'hauling') return v.hauling.inbound || v.hauling.outbound;
  if (requires === 'wear') return v.damage > 0.005;
  return v.inputs.length > 0 || v.outputs.length > 0;
}

/**
 * The stations a works currently offers, in world space, strongest first. `standable` rejects a
 * socket whose ground the pedestrian layer will not accept, so no one is ever placed inside the
 * building, in water, or on a slope they cannot stand on.
 */
export function facilityStations(
  v: FacilityVisual,
  standable: (point: Vec2) => boolean = () => true,
): readonly FacilityStation[] {
  if (v.stage !== 'operating') return [];
  const hw = v.width / 2;
  const hd = v.depth / 2;
  const specs = [...familyStations(v.family, v.tier, hw, hd), ...sharedStations(hw, hd)];
  const cos = Math.cos(v.yaw);
  const sin = Math.sin(v.yaw);
  const toWorld = (local: Vec2): Vec2 => ({
    x: v.position.x + local.x * cos + local.z * sin,
    z: v.position.z - local.x * sin + local.z * cos,
  });
  const stations: FacilityStation[] = [];
  for (const spec of specs) {
    if (!requirementMet(spec.requires, v)) continue;
    const anchor = toWorld(spec.stand);
    if (!standable(anchor)) continue;
    const machine = toWorld(spec.machine);
    stations.push({
      key: `${v.id}:${spec.kind}:${stations.length}`,
      kind: spec.kind,
      facilityId: v.id,
      duty: spec.duty,
      anchor,
      machine,
      facing: Math.atan2(machine.x - anchor.x, machine.z - anchor.z),
      action: spec.action,
      animation: spec.animation,
    });
  }
  return stations;
}

/** A duty may fall back to process work rather than leave a represented crew member stranded. */
export function stationForDuty(
  stations: readonly FacilityStation[], duty: FacilityDuty, taken: ReadonlySet<string>,
): FacilityStation | undefined {
  return stations.find(candidate => candidate.duty === duty && !taken.has(candidate.key))
    ?? stations.find(candidate => !taken.has(candidate.key));
}
