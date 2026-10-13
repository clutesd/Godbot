import type { HistoricalEvent, SimulationState, War } from '../sim/types';
import { emitEvent } from '../sim/History';
import { campaignFocus } from '../sim/war/Campaign';
import { campaignPoint } from '../sim/war/Campaign';
import { resolveNuclearDestruction } from '../sim/war/BattleDestruction';
import { applyNuclearCasualties } from '../sim/war/BattleCasualties';
import { representedPopulation } from '../sim/Population';
import { militaryProfileForWar, type MilitaryCapabilityProfile, type MilitaryEquipment, type MilitaryRegime } from '../sim/war/MilitaryCapability';

export interface WarPreviewMethod {
  id: string;
  era: string;
  label: string;
  description: string;
  regime: MilitaryRegime;
  equipment: MilitaryEquipment[];
  capabilities?: Partial<MilitaryCapabilityProfile>;
  strategic?: 'biological' | 'atomic' | 'hydrogen' | 'mad';
}

/** Authored inspection kits for the development preview. Live campaigns continue to use their
 * actual knowledge, material supply and frozen mobilization snapshots. */
export const WAR_PREVIEW_METHODS: readonly WarPreviewMethod[] = [
  { id: 'club', era: 'Primitive', label: 'Clubs', description: 'Close combat with wooden clubs and loose warbands.', regime: 'improvised', equipment: ['clubs'] },
  { id: 'spear', era: 'Early', label: 'Spears & shields', description: 'Spear thrusts, shield bracing and protected front ranks.', regime: 'organized-melee', equipment: ['stone-spears', 'shields'], capabilities: { protection: 0.35 } },
  { id: 'bow', era: 'Early', label: 'Archers', description: 'Paired bow draws and visible arrows across open ground.', regime: 'organized-melee', equipment: ['bows'], capabilities: { ranged: 0.65 } },
  { id: 'sword', era: 'Village', label: 'Swords & armour', description: 'Metal blades, guarded strikes and armored ranks.', regime: 'organized-melee', equipment: ['metal-weapons', 'metal-armour', 'shields'], capabilities: { melee: 0.75, protection: 0.65 } },
  { id: 'siege', era: 'Preindustrial', label: 'Siege engines', description: 'Wooden throwing engines supporting armored infantry.', regime: 'siege', equipment: ['metal-weapons', 'metal-armour', 'siege-engines'], capabilities: { siege: 0.75, protection: 0.6 } },
  { id: 'musket', era: 'Preindustrial', label: 'Muskets', description: 'Long-barreled muskets and slower gunpowder volleys.', regime: 'gunpowder', equipment: ['gunpowder-weapons'], capabilities: { firearms: 0.6, ranged: 0.65 } },
  { id: 'cannon', era: 'Preindustrial', label: 'Cannon & muskets', description: 'Wheeled cannon behind organized musket lines.', regime: 'gunpowder', equipment: ['gunpowder-weapons', 'cannon'], capabilities: { firearms: 0.65, artillery: 0.55, siege: 0.7 } },
  { id: 'rifle', era: 'Industrial', label: 'Rifles', description: 'Rifle stocks, sights and faster aimed fire.', regime: 'industrial', equipment: ['rifles'], capabilities: { firearms: 0.8, ranged: 0.8 } },
  { id: 'artillery', era: 'Industrial', label: 'Field artillery', description: 'Rifle formations supported by field guns.', regime: 'industrial', equipment: ['rifles', 'artillery'], capabilities: { firearms: 0.8, ranged: 0.8, artillery: 0.8, siege: 0.75 } },
  { id: 'automatic', era: 'Modern', label: 'Automatic weapons', description: 'Magazine-fed weapons with short firing cycles.', regime: 'modern', equipment: ['automatic-weapons', 'metal-armour'], capabilities: { firearms: 0.9, ranged: 0.85, protection: 0.65 } },
  { id: 'modern', era: 'Modern', label: 'Combined arms', description: 'Automatic infantry, artillery and motor transport.', regime: 'modern', equipment: ['automatic-weapons', 'metal-armour', 'artillery', 'motor-transport'], capabilities: { firearms: 0.9, ranged: 0.85, protection: 0.65, artillery: 0.8, mobility: 0.85 } },
  { id: 'air', era: 'Advanced', label: 'Air support', description: 'Aircraft passes above mechanized infantry and artillery.', regime: 'modern', equipment: ['automatic-weapons', 'artillery', 'motor-transport', 'aircraft'], capabilities: { firearms: 0.9, ranged: 0.85, artillery: 0.8, mobility: 0.85, airPower: 0.85 } },
  { id: 'missile', era: 'Advanced', label: 'Guided missiles', description: 'Guided missile flights with aircraft and combined arms.', regime: 'modern', equipment: ['automatic-weapons', 'artillery', 'motor-transport', 'aircraft', 'guided-missiles'], capabilities: { firearms: 0.9, ranged: 0.85, artillery: 0.8, mobility: 0.85, airPower: 0.85, missile: 0.85, communications: 0.9 } },
  { id: 'drone', era: 'Advanced', label: 'Drone swarms', description: 'Observation drones orbit above staggered waves of diving attack drones.', regime: 'modern', equipment: ['automatic-weapons', 'motor-transport', 'drone-swarms'], capabilities: { firearms: 0.85, ranged: 0.8, mobility: 0.8, dronePower: 0.9, communications: 0.9 } },
  { id: 'advanced', era: 'Advanced', label: 'Missiles & drone swarms', description: 'Staggered missile launches and coordinated drone attack waves over combined arms.', regime: 'modern', equipment: ['automatic-weapons', 'artillery', 'motor-transport', 'aircraft', 'guided-missiles', 'drone-swarms'], capabilities: { firearms: 0.9, ranged: 0.85, artillery: 0.8, mobility: 0.85, airPower: 0.85, missile: 0.85, dronePower: 0.9, communications: 0.9 } },
  { id: 'biological', era: 'Late', label: 'Biological warfare', description: 'An abstract biological crisis with warning zones, medical response and campaign disruption.', regime: 'modern', equipment: ['automatic-weapons', 'motor-transport', 'biological-warfare'], capabilities: { firearms: 0.85, ranged: 0.8, communications: 0.9 }, strategic: 'biological' },
  { id: 'atomic', era: 'Final', label: 'Atomic weapons', description: 'Atomic arsenals, restrained use, a single detonation and a lingering aftermath.', regime: 'modern', equipment: ['automatic-weapons', 'motor-transport', 'atomic-weapons'], capabilities: { firearms: 0.85, ranged: 0.8, communications: 0.9 }, strategic: 'atomic' },
  { id: 'hydrogen', era: 'Final', label: 'Hydrogen weapons', description: 'The final escalation: a larger thermonuclear cloud, shock front and scorched ground.', regime: 'modern', equipment: ['automatic-weapons', 'motor-transport', 'hydrogen-weapons'], capabilities: { firearms: 0.85, ranged: 0.8, communications: 0.95 }, strategic: 'hydrogen' },
  { id: 'mad', era: 'Final', label: 'Mutual assured destruction', description: 'Opposing arsenals hold under deterrence; switch escalation to inspect limited use or a retaliatory exchange.', regime: 'modern', equipment: ['automatic-weapons', 'motor-transport', 'hydrogen-weapons'], capabilities: { firearms: 0.85, ranged: 0.8, communications: 0.95 }, strategic: 'mad' },
];

export function warPreviewMethod(id: string | null): WarPreviewMethod {
  return WAR_PREVIEW_METHODS.find(method => method.id === id) ?? WAR_PREVIEW_METHODS[0]!;
}

export type PreviewEscalation = 'deterrence' | 'limited' | 'exchange';
export type PreviewBattlefield = 'field' | 'settlement';

/** A small, isolated built-up approach for reviewing identified destruction. */
export function prepareWarPreviewBattlefield(state: SimulationState, war: War, method: WarPreviewMethod, battlefield: PreviewBattlefield): void {
  if (battlefield === 'field') return;
  const front = campaignPoint(war.campaign.route, 0.76, { x: 0, z: 0 });
  for (const side of [0, 1] as const) {
    const settlement = state.settlements.find(s => s.id === (side ? war.defender : war.attacker))!;
    const originals = settlement.structurePlots ?? [];
    for (let i = 0; i < Math.min(4, originals.length); i++) {
      const plot = originals[i]!;
      plot.worldX = front.x + (side ? 1 : -1) * (1.4 + Math.floor(i / 2) * 2.7);
      plot.worldZ = (i % 2 ? -1 : 1) * 2.7;
      plot.width = 1.6; plot.depth = 1.35; plot.radius = 1.05;
      plot.height = method.regime === 'modern' || method.regime === 'industrial' ? 1.5 : 0.85;
      if (plot.development) {
        plot.development.material = method.regime === 'modern' || method.regime === 'industrial' ? 'masonry' : 'timber';
        plot.development.level = method.regime === 'modern' ? 3 : method.regime === 'industrial' ? 2 : 1;
        plot.development.temporary = false;
      }
    }
  }
}
export function warPreviewEscalation(method: WarPreviewMethod, value: string | null): PreviewEscalation {
  return value === 'deterrence' || value === 'limited' || value === 'exchange' ? value : method.strategic === 'mad' ? 'deterrence' : 'limited';
}

/** Synthetic facts belong only to the isolated preview state. Live detonations remain the
 * responsibility of AdvancedCivilizationSystem; possession alone never authorizes an effect. */
export function prepareStrategicWarPreview(state: SimulationState, war: War, method: WarPreviewMethod, escalation: PreviewEscalation): HistoricalEvent | undefined {
  if (!method.strategic) return;
  if (method.strategic === 'biological') {
    const battle = [...state.history].reverse().find(event => event.type === 'battle' && event.actors.includes(war.id));
    if (battle) Object.assign(battle.context, { biologicalCrisis: true, previewScenario: true });
    return;
  }
  state.advanced.strategic.phase = escalation === 'deterrence' ? 'stable-deterrence' : 'crisis';
  if (escalation === 'deterrence') return;
  const a = state.settlements.find(settlement => settlement.id === war.attacker)!;
  const b = state.settlements.find(settlement => settlement.id === war.defender)!;
  const exchange = escalation === 'exchange';
  const front = campaignFocus(war, a.position, b.position);
  const sites = [{ x: front.x + 1.4, z: front.z + 2.7 }, ...(exchange ? [{ x: front.x - 1.4, z: front.z - 2.7 }] : [])];
  // Place the documentary army at the actual front and leave other residents in their settlements.
  // Every exposed person is then evaluated by the live casualty resolver, with no fixed victim quota.
  for (const side of [0, 1] as const) {
    const settlement = side ? b : a;
    const residents = state.people.filter(p => p.alive && p.homeId === settlement.id);
    const army = Math.min(residents.length, Math.ceil(side ? war.campaign.initialStrengthB : war.campaign.initialStrengthA));
    residents.forEach((person, index) => {
      const anchor = index < army ? front : settlement.position;
      const radius = index < army ? 0.35 + Math.floor(index / 8) * 0.24 : 1.5;
      person.position = { x: anchor.x + Math.sin(index * 2.399) * radius, z: anchor.z + Math.cos(index * 2.399) * radius };
    });
  }
  const populationBefore = representedPopulation(state);
  const existingBodies = new Set((state.bodies ?? []).map(body => body.id));
  const casualties = applyNuclearCasualties(state, 'preview-nuclear', sites, method.strategic !== 'atomic');
  const victims = new Set((state.bodies ?? []).filter(body => !existingBodies.has(body.id)).map(body => body.id));
  const impacts = resolveNuclearDestruction(state, 'preview-nuclear', sites, method.strategic !== 'atomic', victims);
  return emitEvent(state, { type: exchange ? 'nuclear-exchange' : 'nuclear-use',
    location: front, blastSites: sites, impacts, locationId: b.id, actors: [war.id, a.id, b.id],
    causes: ['preview-escalation'], context: { previewScenario: true, nuclearWeapon: method.strategic === 'atomic' ? 'atomic' : 'hydrogen', populationLossFraction: casualties.affectedPopulation / Math.max(1, populationBefore) },
    affectedPopulation: casualties.affectedPopulation, magnitude: exchange ? 1 : 0.8, significance: 1,
    tags: ['war', 'atomic', 'preview'], summary: exchange ? 'Preview: deterrence fails and opposing forces exchange nuclear strikes.' : 'Preview: a single nuclear detonation changes the battlefield.',
    outcome: 'The isolated preview records identified casualties, collapsed structures and incinerated footprints.' });
}

export function applyWarPreviewMethod(war: War, method: WarPreviewMethod): void {
  for (const side of ['attacker', 'defender'] as const) {
    const profile = militaryProfileForWar(war, side);
    if (!profile) continue;
    Object.assign(profile, { regime: method.regime,
      powerBase: method.regime === 'modern' ? 'advanced-grid' : method.regime === 'industrial' ? 'mechanical' : 'muscle-fire',
      equipment: [...method.equipment], melee: 0.45, ranged: 0, protection: 0, siege: 0,
      firearms: 0, artillery: 0, mobility: 0.35, communications: 0.2, airPower: 0, missile: 0, dronePower: 0,
      production: 0.8, energy: 0.8, sustainment: 0.85, institutionalSupport: 0.8, overall: 0.65,
      ...method.capabilities });
  }
}
