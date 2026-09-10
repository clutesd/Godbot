import type { Settlement, Vec2, War, WarCampaign, WorldState } from '../types';
import type { WalkabilityLayer } from '../people/WalkabilityLayer';
import { cellAt } from '../world';
import { deriveMilitaryProfile, type MilitaryCampaignSnapshot, type MilitaryCapabilityProfile } from './MilitaryCapability';
import { militaryMarchMultiplier, militaryOperationalSupply } from './MilitaryCombat';
import { installMilitaryCombatRuntime } from './MilitaryCombatRuntime';

export const TRUCE_MONTHS = 60;
const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));

export function campaignDistance(route: readonly Vec2[]): number {
  return route.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point.x - route[i - 1]!.x, point.z - route[i - 1]!.z), 0);
}

/** Distance-based sampling never smooths a safe route across a river or ridge. */
export function campaignPoint(route: readonly Vec2[], progress: number, fallback: Vec2): Vec2 {
  let remaining = campaignDistance(route) * clamp(progress);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= length;
  }
  return { ...(route.at(-1) ?? fallback) };
}

export function campaignFront(war: War, fallback: Vec2): Vec2 {
  return campaignPoint(war.campaign.route, 0.76 + clamp(war.progress, -1, 1) * 0.08, fallback);
}

export function campaignFocus(war: War, origin: Vec2, destination: Vec2): Vec2 {
  if (war.campaign.route.length < 2) return { ...origin };
  if (war.phase === 'mobilizing' || war.campaign.blockedMonths > 0) return campaignPoint(war.campaign.route, 0.12 + war.marchProgress * 0.62, origin);
  if (war.phase === 'marching') return campaignPoint(war.campaign.route, 0.12 + war.marchProgress * 0.62, origin);
  return campaignFront(war, destination);
}

export function createCampaign(world: WorldState, walking: WalkabilityLayer, attacker: Settlement, defender: Settlement, month: number, strengthA: number, strengthB: number): WarCampaign & MilitaryCampaignSnapshot {
  // The integration is installed lazily here, after Simulation's circular module graph has fully
  // initialized but before the first campaign can ever advance a month.
  installMilitaryCombatRuntime();
  const start = walking.nearestWalkable(attacker.position);
  const end = walking.nearestWalkable(defender.position);
  const waypoints = walking.route(start, end);
  const reachesDestination = waypoints.length > 0 && Math.hypot(waypoints.at(-1)!.x - end.x, waypoints.at(-1)!.z - end.z) < 0.1;
  const route = reachesDestination && walking.routeIsValid([start, ...waypoints]) ? [start, ...waypoints] : [];
  const distance = campaignDistance(route);
  const militaryA = deriveMilitaryProfile(attacker);
  const militaryB = deriveMilitaryProfile(defender);
  let difficulty = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const cell = cellAt(world, (a.x + b.x) / 2, (a.z + b.z) / 2);
    difficulty += length * (1 + (cell?.slope ?? 0) * 2 + Math.max(0, (cell?.movementCost ?? 1) - 1) * 0.2);
  }
  const mobility = militaryMarchMultiplier(militaryA);
  return {
    route, distance, marchMonths: Math.max(3, Math.min(18, Math.ceil(difficulty / (world.cellSize * 3 * mobility)))),
    phaseSinceMonth: month, battleCount: 0, supplyA: campaignSupply(attacker, 0, 1, militaryA), supplyB: campaignSupply(defender, 0, 1, militaryB), exhaustionA: 0, exhaustionB: 0,
    blockedMonths: 0, initialStrengthA: strengthA, initialStrengthB: strengthB, dispatches: [], advantage: 0,
    // Freeze the equipment basis at mobilization. Later knowledge can change future wars without
    // silently rewriting the historical capabilities of a campaign already under way.
    militaryA,
    militaryB,
  };
}

/**
 * Long corridors and simultaneous commitments strain the same home economy. Sophisticated
 * equipment also depends on the settlement's current ability to power, repair and replace its
 * force. Existing callers that predate Step 2 receive the same capability-aware supply behavior.
 */
export function campaignSupply(settlement: Settlement, distance: number, commitments: number, mobilized?: MilitaryCapabilityProfile): number {
  const legacy = clamp((settlement.foodSecurity * 0.65 + settlement.prosperity * 0.2 + Math.min(1, settlement.resources.food / 30) * 0.15)
    / (1 + distance / 160 + Math.max(0, commitments - 1) * 0.22), 0.06, 1);
  return militaryOperationalSupply(settlement, mobilized ?? deriveMilitaryProfile(settlement), legacy);
}
