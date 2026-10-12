import type { BattleImpact, SimulationState, War } from '../../sim/types';
import { campaignFocus, campaignPoint } from '../../sim/war/Campaign';
import { deriveMilitaryProfile, militaryProfileForWar } from '../../sim/war/MilitaryCapability';
import { militaryVisualStyle } from './MilitaryVisualLanguage';
import { engagementGap } from './CombatChoreography';
import { formationCount } from './CombatExchanges';

/** Terrain-relative battlefield composition. A flank view keeps both sides readable and never
 * crosses the battle axis. The lens watches the recorded front, rather than a nearby route node. */
export function warCameraFrame(state: SimulationState, war: War, azimuth: number, progress: number,
  aspect = 16 / 9, detail = false, medium = false) {
  const a = state.settlements.find(s => s.id === war.attacker);
  const b = state.settlements.find(s => s.id === war.defender);
  if (!a || !b) return undefined;
  const styles = [militaryVisualStyle(militaryProfileForWar(war, 'attacker') ?? deriveMilitaryProfile(a)),
    militaryVisualStyle(militaryProfileForWar(war, 'defender') ?? deriveMilitaryProfile(b))];
  let front = campaignFocus(war, a.position, b.position);
  let mode: unknown;
  let structuralHit: BattleImpact | undefined;
  if (war.phase === 'battle' || war.resolvedMonth !== undefined) {
    for (let i = state.history.length - 1; i >= 0; i--) {
      const event = state.history[i]!;
      if (event.type === 'battle' && event.actors.includes(war.id) && event.location && event.month <= state.month) {
        front = event.location; mode = event.context['engagementMode'];
        structuralHit = event.impacts?.find(hit => hit.targetKind === 'structure'); break;
      }
    }
  }
  const routeProgress = war.phase === 'marching' ? 0.12 + war.marchProgress * 0.62 : 0.76 + Math.max(-1, Math.min(1, war.progress)) * 0.08;
  const before = campaignPoint(war.campaign.route, routeProgress - 0.006, a.position);
  const after = campaignPoint(war.campaign.route, routeProgress + 0.006, b.position);
  const yaw = Math.atan2(after.x - before.x, after.z - before.z);
  const flank = Math.cos(azimuth) * Math.cos(yaw) - Math.sin(azimuth) * Math.sin(yaw) >= 0 ? 1 : -1;
  const aftermath = war.resolvedMonth !== undefined || war.phase === 'negotiation';
  const gap = engagementGap(styles, mode);
  const width = Math.max(...styles.map(s => s.rankWidth * Math.max(0.22, s.lateralSpacing)));
  const depth = Math.max(...styles.map((s, side) => Math.ceil(formationCount(side ? war.campaign.initialStrengthB : war.campaign.initialStrengthA) / s.rankWidth) * Math.max(0.28, s.depthSpacing)));
  const extent = Math.max(width, depth + gap * 0.5);
  const nuclear = styles.some(style => style.nuclear !== 'none');
  const destructionDetail = detail && !medium && Boolean(structuralHit) && !nuclear;
  const human = detail && !destructionDetail && !aftermath && war.phase === 'battle' && !nuclear;
  const aerial = !human && !aftermath && war.phase === 'battle' && styles.some(style => style.missiles > 0 || style.drones > 0);
  const radius = destructionDetail ? 5.5 * Math.max(1, 0.9 / Math.max(0.4, aspect))
    : human ? medium ? 1.9 : 1.25 : Math.max(nuclear ? 14 : structuralHit ? 7 : 2.8, extent * 1.85) * Math.max(1, 1.15 / Math.max(0.4, aspect));
  const distance = radius * (aftermath ? 1 + progress * 0.28 : 1 - progress * 0.08);
  const angle = -yaw + (flank < 0 ? Math.PI : 0) + flank * 0.24;
  const lateral = human ? flank * width * 0.28 : 0;
  // A ranged battle's midpoint is empty killing ground. Human shots must resolve to its front
  // rank; the wide shot carries the relationship between the two distant formations.
  const rankDepth = human && gap > 1 ? -gap / 2 : 0;
  const focusX = destructionDetail ? structuralHit!.position.x : front.x + Math.cos(yaw) * lateral + Math.sin(yaw) * rankDepth;
  const focusZ = destructionDetail ? structuralHit!.position.z : front.z - Math.sin(yaw) * lateral + Math.cos(yaw) * rankDepth;
  return { focusX, focusZ, x: focusX + Math.cos(angle) * distance,
    z: focusZ + Math.sin(angle) * distance, targetHeight: nuclear ? 2.2 : destructionDetail ? 0.45 : human ? 0.19 : aerial ? 0.5 : 0.16,
    height: nuclear ? 5.1 : destructionDetail ? 1.35 : human ? medium ? 0.55 : 0.42 : aftermath ? 1.35 + progress * 0.6 : aerial ? 1.65 : war.phase === 'marching' ? 0.9 : 0.85,
    fov: human ? medium ? 38 : 34 : 38, yaw, flank };
}
