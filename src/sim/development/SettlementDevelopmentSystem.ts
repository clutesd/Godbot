import type { Culture, Institution, InstitutionKind, Person, ResourceStock, Settlement, SimulationState, StructurePlot, TradeRoute } from '../types';
import { practical, type KnowledgeEventDraft } from '../knowledge/KnowledgeSystem';
import { materialAmount } from '../resources/MaterialEconomy';
import {
  advanceSettlementMaterialUse,
  consumeConstructionMaterials,
  hasMaterialAuthority,
  materialRequirementCoverage,
  maxMaterialProgressIncrement,
  structureMaterialRequirements,
  type FlexibleMaterialRequirement,
} from '../resources/MaterialUse';
import { advanceSettlementResourceExtraction } from '../resources/SettlementResourceExtraction';
import { reserveStructurePlot } from '../../shared/StructurePlots';
import { districtForResponse } from '../../shared/SettlementLayoutPlan';
import { PlacementContract } from '../../shared/placement/PlacementContract';
import { advanceSettlementWater } from './WaterCivilization';
import { SETTLEMENT_NEEDS, type DevelopmentResponse, type ServiceSupply, type SettlementNeed, type StructureDevelopment, type StructureForm, type StructureHistoryEntry, type StructureMaterial } from './types';

const clamp = (n: number, max = 1): number => Math.max(0, Math.min(max, n));
const stock = (): ResourceStock => ({ food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 });
const STOCK_KEYS = ['food', 'wood', 'minerals', 'goods', 'wealth'] as const;
const SHARED_NEEDS: SettlementNeed[] = ['trade', 'knowledge', 'healthcare', 'manufacturing'];

function connected(state: SimulationState, route: TradeRoute): boolean {
  const path = route.transport?.path;
  return Boolean(route.active && !route.weatherBlocked && path && path.segmentIds.length > 0
    && path.segmentIds.every(id => state.transportation.segments[id]?.status === 'complete'));
}

export interface DevelopmentContext {
  settlement: Settlement;
  culture: Culture;
  institutions: Institution[];
  population: number;
  farmers: number;
  artisans: number;
  keepers: number;
  builders: number;
  health: number;
  routes: number;
  capitalReach: number;
  fertile: boolean;
  water: boolean;
  localWood: number;
  localMinerals: number;
  movement: number;
  memory: number;
}

export function developmentContext(state: SimulationState, settlement: Settlement, residents = state.people.filter(p => p.alive && p.homeId === settlement.id)): DevelopmentContext {
  const culture = [...state.cultures].sort((a, b) => (settlement.cultureShares[b.id] ?? 0) - (settlement.cultureShares[a.id] ?? 0) || a.id.localeCompare(b.id))[0]!;
  const cell = state.world.cells[settlement.cellIndex]!;
  const city = state.advanced.scale === 'modern-statistical' ? state.advanced.cities.find(c => c.settlementId === settlement.id) : undefined;
  const count = (occupation: Person['occupation']) => residents.filter(p => p.occupation === occupation).length;
  const polity = state.polities.find(p => p.id === settlement.polityId);
  const waterState = settlement.development?.water;
  return { settlement, culture, institutions: state.institutions.filter(i => settlement.institutionIds.includes(i.id) && i.support >= 0.2),
    population: city?.population ?? residents.length, farmers: count('farmer'), artisans: count('artisan'), keepers: count('keeper'), builders: count('builder'),
    health: city?.health ?? residents.reduce((n, p) => n + p.health, 0) / Math.max(1, residents.length),
    routes: state.tradeRoutes.filter(r => (r.a === settlement.id || r.b === settlement.id) && connected(state, r)).length,
    capitalReach: polity?.capitalId === settlement.id ? polity.settlementIds.length - 1 : 0,
    fertile: cell.fertility > 0.35,
    water: waterState ? waterState.availability > 0.3 || waterState.reliability > 0.38 : cell.river || cell.coast || cell.moisture > 0.45,
    localWood: cell.wood, localMinerals: cell.minerals, movement: cell.movementCost,
    memory: Math.min(2, culture.memory.frontierViolence + culture.memory.collectiveSuccess * 0.05 + (settlement.weatherRecoverySince === undefined ? 0 : 0.5)) };
}

function institution(c: DevelopmentContext, kind: InstitutionKind): Institution | undefined {
  return c.institutions.filter(i => i.kind === kind).sort((a, b) => b.support - a.support || a.id.localeCompare(b.id))[0];
}

export function serviceSupply(settlement: Settlement): ServiceSupply {
  const supply: ServiceSupply = {};
  for (const plot of settlement.structurePlots ?? []) {
    const structure = plot.development;
    if (!structure || structure.status !== 'active' || plot.accessRestricted) continue;
    for (const need of SETTLEMENT_NEEDS) supply[need] = (supply[need] ?? 0) + (structure.services[need] ?? 0) * plot.condition;
  }
  return supply;
}

/** Population affects load, while institutions, livelihoods and experience create demand. */
export function evaluatePressures(c: DevelopmentContext): { pressures: ServiceSupply; informal: ServiceSupply } {
  const s = c.settlement;
  const d = c.culture.dimensions;
  const waterState = s.development?.water;
  const scale = Math.min(4, Math.sqrt(c.population / 65));
  const backing = (kind: InstitutionKind) => { const i = institution(c, kind); return i ? i.support * 1.5 + Math.min(1, i.members / 24) : 0; };
  const pressures: ServiceSupply = {
    housing: c.population / 17,
    food: c.farmers > 0 ? scale * (0.7 + (1 - s.foodSecurity) * 1.3 + (c.fertile ? 0.25 : 0) + (s.specialization === 'agriculture' ? 0.6 : 0)) : scale * 0.3,
    trade: c.routes > 0 ? scale * (0.5 + d.tradeOrientation + c.routes * 0.35) + backing('merchant-association') : 0,
    government: scale * (0.15 + d.hierarchy * 0.35) + backing('council') + c.capitalReach * 0.6,
    security: scale * (s.conflictPressure * 3 + d.militarism * 0.4 + clamp(c.culture.memory.frontierViolence) * 0.5) + backing('military-order'),
    religion: scale * Math.max(0, d.religiousTendency - 0.4) * 1.8 + backing('temple'),
    knowledge: scale * Math.max(0, d.curiosity - 0.5) + backing('knowledge-keepers') + s.knowledge.literacy * scale * 0.6,
    healthcare: scale * ((1 - c.health) * 2 + s.pollution * 0.5 + d.cooperation * 0.2 + (waterState ? (1 - waterState.quality) * 0.8 : 0)),
    manufacturing: scale * (Math.min(1, c.artisans / 8) * 0.6 + s.industry.intensity * 2) + backing('craft-circle'),
    transport: c.routes ? scale * (0.3 + c.routes * 0.35 + clamp(c.movement / 5) * 0.3) : 0,
    energy: scale * (s.industry.intensity * 2 + s.infrastructure.workshops * 0.7 + s.infrastructure.power),
    water: scale * (s.urbanization * 1.3 + s.pollution + (c.water ? 0.1 : 0.55) + s.climateStress * 0.5
      + (waterState ? waterState.droughtStress * 1.8 + (1 - waterState.quality) * 0.8 + waterState.floodContamination * 0.7 : 0)),
    memory: c.memory > 0.3 ? scale * Math.min(1.8, c.memory) * d.longTermOrientation : 0,
  };
  // Household care, elders, rituals and mutual watch do not imply dedicated buildings.
  const decentralized = d.hierarchy < 0.42 && s.politicalPower.kinship >= s.politicalPower.institutional;
  const informalWater = waterState
    ? scale * (0.08 + waterState.surfaceAccess * 0.38 + waterState.reliability * 0.2) * (0.6 + waterState.quality * 0.4)
    : scale * (c.water ? 0.45 : 0.15);
  const informal: ServiceSupply = { government: decentralized ? scale * 0.85 : scale * 0.2,
    security: scale * (decentralized ? 0.8 : 0.3) * (1 - s.conflictPressure),
    religion: scale * 0.25, healthcare: scale * 0.5, knowledge: scale * 0.2, water: informalWater,
    manufacturing: scale * 0.3, food: scale * 0.2, energy: scale * 0.35, transport: scale * 0.25, memory: scale * 0.2 };
  return { pressures, informal };
}

function materialFor(c: DevelopmentContext, level: number): StructureMaterial {
  const s = c.settlement;
  const typed = hasMaterialAuthority(s);
  const timberAvailable = !typed || materialAmount(s, 'timber') + materialAmount(s, 'lumber') > 1;
  const masonryAvailable = !typed || materialAmount(s, 'stone') + materialAmount(s, 'brick') > 2;
  const ceramicAvailable = !typed || materialAmount(s, 'brick') > 2;
  const metalAvailable = !typed || materialAmount(s, 'steel') + materialAmount(s, 'iron') + materialAmount(s, 'bronze') > 1.5;
  if (level === 3 && metalAvailable && practical(s, 'iron-working') > 0.45 && practical(s, 'precision-tools') > 0.35 && s.resources.minerals > 32 && s.resources.wood > 12) return 'metal';
  if (masonryAvailable && practical(s, 'leverage') > 0.25 && practical(s, 'stone-composites') > 0.3 && s.resources.minerals > 12 && (c.localMinerals > c.localWood || c.culture.dimensions.longTermOrientation > 0.7)) return 'masonry';
  if (ceramicAvailable && practical(s, 'pottery-firing') > 0.3 && practical(s, 'fire-control') > 0.2 && s.resources.minerals > 8 && s.resources.wood > 6 && c.localWood < 0.5) return 'ceramic';
  return timberAvailable && (c.localWood > 0.25 || c.routes > 0) && s.resources.wood > 8 ? 'timber' : 'earth';
}

/** Capability requirements attach to a response, never to a world-era counter. */
export function responseForNeed(c: DevelopmentContext, need: SettlementNeed, requestedLevel = 1): DevelopmentResponse | undefined {
  const s = c.settlement;
  const d = c.culture.dimensions;
  let form: StructureForm = 'hall';
  let sponsor: Institution | undefined;
  let names: string[];
  let maxLevel = 1;
  const requirements: string[] = [];
  const knows = (id: string, minimum = 0.3) => {
    if (practical(s, id) < minimum) return false;
    requirements.push(id); return true;
  };
  const engineered = practical(s, 'leverage') >= 0.25 && (practical(s, 'stone-composites') >= 0.3 || practical(s, 'pottery-firing') >= 0.3);
  switch (need) {
    case 'housing': form = 'dwelling'; names = ['household shelter', 'household compound', 'dense housing court']; maxLevel = engineered ? 2 : 1; break;
    case 'food':
      if (c.farmers > 2 && c.fertile && knows('crop-selection', 0.15)) {
        form = 'field'; names = ['farmstead', 'agricultural estate', 'mechanized agricultural site'];
        if (knows('agrarian-surplus')) maxLevel = 2;
        if (maxLevel === 2 && knows('mechanical-power', 0.45) && c.artisans >= 5 && s.resources.wood > 12) maxLevel = 3;
      } else { form = 'store'; names = ['food store', 'granary', 'storage and processing court']; if (knows('pottery-firing', 0.2)) maxLevel = 2; }
      break;
    case 'trade':
      if (c.routes === 0) return undefined;
      sponsor = institution(c, 'merchant-association');
      form = d.tradeOrientation > 0.55 ? 'gathering' : 'store';
      names = form === 'gathering' ? ['market stalls', 'market hall', 'commercial court'] : ['exchange store', 'trade warehouse', 'distribution court'];
      if (sponsor && knows('counting-measure', 0.25)) maxLevel = 2;
      if (maxLevel === 2 && c.routes >= 2 && knows('civic-administration') && knows('improved-roads')) maxLevel = 3;
      break;
    case 'government':
      sponsor = institution(c, 'council');
      form = d.hierarchy < 0.45 || s.politicalPower.kinship > s.politicalPower.institutional ? 'gathering' : 'hall';
      names = form === 'gathering' ? ['elders meeting ground', 'assembly hall', 'federated meeting court'] : ['council hall', 'council building', 'government complex'];
      if (!sponsor && c.capitalReach === 0) return undefined;
      if (knows('durable-records')) maxLevel = 2;
      if (maxLevel === 2 && c.capitalReach > 0 && knows('civic-administration', 0.45)) maxLevel = 3;
      if (d.hierarchy < 0.35) maxLevel = 1;
      break;
    case 'security':
      sponsor = institution(c, 'military-order') ?? institution(c, 'council');
      if (d.religiousTendency > 0.7 && institution(c, 'temple') && s.conflictPressure < 0.4) {
        sponsor = institution(c, 'temple'); form = 'sanctuary'; names = ['temple watch', 'temple authority court', 'sacred refuge'];
      } else if (d.militarism > 0.65 || s.conflictPressure > 0.45) {
        form = 'tower'; names = ['frontier watch post', 'warrior barracks', 'fortified garrison'];
      } else if (d.hierarchy < 0.4) {
        form = 'gathering'; names = ['mutual watch ground', 'watch meeting hall', 'watch court'];
      } else { form = 'hall'; names = ['civic guard house', 'civic guard court', 'central police office']; }
      if (sponsor && knows('leverage', 0.25)) maxLevel = 2;
      if (maxLevel === 2 && knows('civic-administration', 0.45) && knows('durable-records', 0.4)) maxLevel = 3;
      break;
    case 'religion':
      sponsor = institution(c, 'temple');
      if (!sponsor && d.religiousTendency < 0.65) return undefined;
      form = sponsor ? 'sanctuary' : 'marker'; names = ['shrine', 'temple', 'pilgrimage complex'];
      if (sponsor && engineered) maxLevel = 2;
      if (maxLevel === 2 && sponsor!.reach > 0.5 && c.routes > 0 && knows('improved-roads') && knows('durable-records')) maxLevel = 3;
      break;
    case 'knowledge':
      sponsor = institution(c, 'knowledge-keepers');
      if (!sponsor || c.keepers < 2) return undefined;
      form = d.religiousTendency > 0.7 ? 'sanctuary' : 'hall'; names = ['teaching house', 'archive and school', 'academy'];
      if (knows('durable-records')) maxLevel = 2;
      if (maxLevel === 2 && knows('scientific-method', 0.45) && c.keepers >= 6) maxLevel = 3;
      break;
    case 'healthcare':
      if (c.keepers < 2 || !knows('anatomical-observation', 0.2)) return undefined;
      sponsor = institution(c, 'temple') ?? institution(c, 'knowledge-keepers') ?? institution(c, 'council');
      form = sponsor?.kind === 'temple' ? 'sanctuary' : 'hall'; names = ['healing house', 'community infirmary', 'clinical hospital'];
      if (sponsor && knows('contagion-patterns')) maxLevel = 2;
      if (maxLevel === 2 && knows('modern-medicine', 0.45) && c.keepers >= 6) maxLevel = 3;
      break;
    case 'manufacturing':
      if (c.artisans < 2 || !(knows('pottery-firing', 0.2) || knows('metal-smelting', 0.2))) return undefined;
      sponsor = institution(c, 'craft-circle'); form = 'workshop'; names = ['craft workshop', 'specialist workshop', 'powered manufactory'];
      if (sponsor && knows('precision-tools')) maxLevel = 2;
      if (maxLevel === 2 && knows('mechanical-power', 0.45) && knows('precision-manufacturing', 0.4) && c.artisans >= 8 && s.resources.wood > 12 && Math.max(s.infrastructure.roads, s.infrastructure.ports) > 0.2) maxLevel = 3;
      break;
    case 'transport':
      // Route building, bridges, ports and rail remain TransportationSystem's authority.
      if (c.routes === 0 || !knows('wheel-axle', 0.2)) return undefined;
      form = 'store'; names = ['carrier shelter', 'freight depot', 'logistics court'];
      sponsor = institution(c, 'merchant-association'); if (sponsor && knows('improved-roads')) maxLevel = 2;
      if (maxLevel === 2 && knows('rail-transport', 0.4) && s.infrastructure.rail > 0.2) maxLevel = 3;
      break;
    case 'energy':
      if (c.artisans < 3) return undefined;
      form = 'workshop'; names = ['fuel yard', 'power workshop', 'generation station'];
      if (!knows('fire-control', 0.2) || s.resources.wood <= 12) return undefined;
      if (knows('mechanical-power', 0.4)) maxLevel = 2;
      if (knows('electrical-generation', 0.45) && knows('precision-tools', 0.4) && c.artisans >= 6) maxLevel = 3;
      break;
    case 'water':
      form = 'store'; names = ['water store', 'cistern and wash court', 'sanitation works'];
      if (knows('irrigation', 0.25) && engineered) maxLevel = 2;
      if (maxLevel === 2 && knows('contagion-patterns', 0.4) && knows('civic-administration', 0.4)) maxLevel = 3;
      break;
    case 'memory':
      if (c.memory < 0.3) return undefined;
      form = 'marker'; names = ['memory marker', 'memorial', 'commemorative precinct'];
      if (engineered && d.longTermOrientation > 0.6) maxLevel = 2;
      if (maxLevel === 2 && knows('durable-records', 0.4) && c.memory > 1 && c.capitalReach > 0) maxLevel = 3;
      break;
  }
  // Specialist labor, sustained surplus and engineering must support larger structures.
  if (!engineered || c.builders < 3 || s.foodSecurity < 0.5) maxLevel = 1;
  if (c.builders < 5 || c.artisans + c.keepers < 8 || s.prosperity < 0.5) maxLevel = Math.min(maxLevel, 2);
  const level = Math.min(requestedLevel, maxLevel);
  if (level > 1) requirements.push('leverage', practical(s, 'stone-composites') >= 0.3 ? 'stone-composites' : 'pottery-firing');
  if (level === 3 && ['manufacturing', 'energy', 'water'].includes(need)) form = 'works';
  const material = materialFor(c, level);
  const cost = stock();
  const open = form === 'gathering' && level === 1 || form === 'marker';
  const units = level * (open ? 0.45 : 1);
  cost.wood = units * (material === 'timber' ? 8 : material === 'ceramic' || material === 'metal' ? 5 : 3);
  cost.minerals = units * (material === 'metal' ? 16 : material === 'masonry' ? 10 : material === 'ceramic' ? 6 : 1);
  cost.goods = (level - 1) * 4;
  cost.wealth = (level - 1) * 3;
  const services: ServiceSupply = { [need]: level === 1 ? 1 : level === 2 ? 2 : 3.5 };
  if (need === 'housing') services.housing = level === 1 ? 1 : 1.8;
  if (need === 'religion' && sponsor) { services.healthcare = level * 0.35; services.security = level * (d.religiousTendency > 0.7 ? 0.7 : 0.1); }
  if (need === 'government') services.security = level * (d.militarism < 0.5 ? 0.5 : 0.2);
  if (need === 'trade') services.food = level * 0.25;
  const reasons = [need + '-pressure', ...(sponsor ? [sponsor.kind, sponsor.id] : ['household-cooperation']),
    ...(need === 'security' ? [s.conflictPressure > 0.3 ? 'frontier-conflict' : 'local-order'] : []),
    ...(need === 'food' ? [s.monthlyBalance.food > 0 ? 'agricultural-surplus' : 'food-resilience'] : []),
    ...(need === 'water' && s.development?.water ? [s.development.water.droughtStress > 0.4 ? 'drought-resilience' : s.development.water.quality < 0.55 ? 'clean-water' : 'water-security'] : []),
    ...(c.routes > 0 && ['trade', 'transport', 'religion'].includes(need) ? ['connected-exchange'] : [])];
  return { need, form, name: names[level - 1]!, level, material, cultureId: c.culture.id, style: { ...c.culture.style }, institutionId: sponsor?.id,
    services, reasons, capabilities: [...new Set(requirements)], cost, labor: level * (open ? 0.5 : 1) };
}

function entry(response: DevelopmentResponse, month: number, action: StructureHistoryEntry['action']): StructureHistoryEntry {
  return { month, action, name: response.name, need: response.need, form: response.form, level: response.level, material: response.material,
    cultureId: response.cultureId, institutionId: response.institutionId, reasons: [...response.reasons] };
}

function remember(structure: StructureDevelopment, record: StructureHistoryEntry): void {
  structure.history.push(record);
  if (structure.history.length > 12) structure.history.shift();
  structure.transitionCount++;
}

export function initializeSettlementDevelopment(state: SimulationState, settlement: Settlement, residents?: Person[]): void {
  if (settlement.development) return;
  const c = developmentContext(state, settlement, residents);
  settlement.development = { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: -12, nextAttemptMonth: state.month, revision: 0 };
  for (const plot of settlement.structurePlots ?? []) {
    if (plot.development) continue;
    const response = responseForNeed(c, 'housing')!;
    const origin = entry(response, plot.foundedMonth, 'founded');
    plot.development = { ...response, status: 'active', origin, history: [], transitionCount: 0, lastUsedMonth: state.month };
  }
  settlement.buildings = (settlement.structurePlots ?? []).filter(p => p.development?.status === 'active').length;
  settlement.targetBuildings = settlement.buildings;
}

function validPlot(state: SimulationState, plot: StructurePlot): boolean {
  return new PlacementContract(state.world).validate({ type: plot.width > 3 ? 'major-building' : 'small-building', worldX: plot.worldX, worldZ: plot.worldZ, footprintRadius: plot.radius }).valid;
}

function historyEvent(settlement: Settlement, plot: StructurePlot, record: StructureHistoryEntry): KnowledgeEventDraft {
  return { type: 'infrastructure-built', location: { x: plot.worldX, z: plot.worldZ }, locationId: settlement.id,
    actors: [settlement.id, plot.id, record.cultureId, ...(record.institutionId ? [record.institutionId] : [])],
    causes: record.reasons, context: { structureId: plot.id, need: record.need, action: record.action, foundedMonth: plot.foundedMonth },
    outcome: `${record.name} ${record.action} at a persistent site.`, significance: record.need === 'housing' ? 0.22 : 0.52,
    tags: ['settlement-development', record.need, record.action], summary: `${settlement.name}: ${record.name} ${record.action}.` };
}

function scaleRequirements(requirements: FlexibleMaterialRequirement[], factor: number): FlexibleMaterialRequirement[] {
  return requirements.map(requirement => ({ ...requirement, amount: requirement.amount * factor }));
}

/** One evaluation per year, one funded project at a time, no random draws. */
export function advanceSettlementDevelopment(state: SimulationState, settlement: Settlement, residents: Person[], workRate: number): KnowledgeEventDraft[] {
  initializeSettlementDevelopment(state, settlement, residents);
  const dev = settlement.development!;
  const events: KnowledgeEventDraft[] = [];
  if (settlement.alive) {
    advanceSettlementResourceExtraction(state, settlement, residents);
    advanceSettlementMaterialUse(state, settlement, residents);
  }
  events.push(...advanceSettlementWater(state, settlement, residents));
  if (dev.project && !settlement.alive) abandonProject();
  function abandonProject(): void {
    const project = dev.project!;
    const plot = settlement.structurePlots?.find(p => p.id === project.plotId);
    if (plot && !plot.development) {
      const response = { ...project.response, name: `unfinished ${project.response.name}` };
      plot.development = { ...response, status: 'abandoned', origin: entry(response, project.startedMonth, 'founded'), history: [], transitionCount: 0, lastUsedMonth: project.startedMonth };
      plot.condition = Math.max(0.2, project.progress);
      const record = entry(response, state.month, 'abandoned'); record.reasons = ['construction-interrupted'];
      remember(plot.development, record); events.push(historyEvent(settlement, plot, record));
    }
    dev.project = undefined; dev.revision++;
  }
  if (state.month - dev.evaluatedMonth >= 12) {
    const c = developmentContext(state, settlement, residents);
    const { pressures, informal } = evaluatePressures(c);
    dev.pressures = pressures; dev.informal = informal; dev.providers = {}; dev.evaluatedMonth = state.month;
    const supplied = serviceSupply(settlement);
    // Read last completed annual demand to keep connected centers useful without duplicating every service.
    for (const need of SHARED_NEEDS) {
      let best = 0;
      for (const route of state.tradeRoutes) {
        if (route.a !== settlement.id && route.b !== settlement.id || !connected(state, route)) continue;
        const other = state.settlements.find(s => s.id === (route.a === settlement.id ? route.b : route.a) && s.alive);
        if (!other || Math.hypot(other.position.x - settlement.position.x, other.position.z - settlement.position.z) > 65) continue;
        const service = serviceSupply(other)[need] ?? 0;
        const surplus = Math.max(0, service - (other.development?.pressures[need] ?? service));
        const share = Math.min((pressures[need] ?? 0) * 0.6, surplus * 0.6, route.volume);
        if (share > best) { best = share; dev.providers[need] = other.id; }
      }
      supplied[need] = (supplied[need] ?? 0) + best;
    }
    dev.unmet = Object.fromEntries(SETTLEMENT_NEEDS.map(need => [need, Math.max(0, (pressures[need] ?? 0) - (informal[need] ?? 0) - (supplied[need] ?? 0))]));
    for (const plot of settlement.structurePlots ?? []) {
      const building = plot.development;
      if (!building || dev.project?.plotId === plot.id) continue;
      const demand = (pressures[building.need] ?? 0) - (informal[building.need] ?? 0);
      const surplus = (supplied[building.need] ?? 0) - demand;
      const patronGone = building.institutionId && !c.institutions.some(i => i.id === building.institutionId);
      const supported = responseForNeed(c, building.need, building.level);
      const lostCapability = building.level === 3 && (!supported || supported.level < 3);
      if (building.status === 'active') {
        if (!settlement.alive || demand < 0.3 || patronGone && demand < 1 || lostCapability || surplus > (building.services[building.need] ?? 0) + 0.5) building.underusedSince ??= state.month;
        else { building.underusedSince = undefined; building.lastUsedMonth = state.month; }
        if (building.underusedSince !== undefined && (!settlement.alive || state.month - building.underusedSince >= 120)) {
          building.status = 'abandoned';
          const record = entry(building, state.month, 'abandoned'); record.reasons = [settlement.alive ? 'sustained-loss-of-use' : 'settlement-abandonment'];
          remember(building, record); events.push(historyEvent(settlement, plot, record)); dev.revision++;
          supplied[building.need] = Math.max(0, (supplied[building.need] ?? 0) - (building.services[building.need] ?? 0));
        }
      } else if (building.status === 'abandoned') {
        plot.condition = Math.max(0, plot.condition - (building.material === 'earth' || building.material === 'timber' ? 0.035 : 0.018));
        if (plot.condition <= 0.15) {
          plot.condition = 0; building.status = 'ruin';
          const record = entry(building, state.month, 'ruined'); record.reasons = ['unmaintained-fabric']; remember(building, record);
          events.push(historyEvent(settlement, plot, record)); dev.revision++;
        }
      }
    }
    if (!dev.project && settlement.alive && state.month >= dev.nextAttemptMonth) {
      const needs = SETTLEMENT_NEEDS.filter(need => (dev.unmet[need] ?? 0) > 0.65)
        .sort((a, b) => (dev.unmet[b] ?? 0) * (b === 'housing' ? 1.2 : 1) - (dev.unmet[a] ?? 0) * (a === 'housing' ? 1.2 : 1));
      for (const need of needs) {
        const plots = (settlement.structurePlots ?? []).filter(p => !p.fire);
        const ancestor = plots.find(p => p.development?.status === 'active' && p.development.need === need && p.development.level < 3);
        const desiredLevel = ancestor ? ancestor.development!.level + 1 : 1;
        let response = responseForNeed(c, need, desiredLevel);
        if (!response) continue;
        let plot = ancestor && response.level > ancestor.development!.level ? ancestor : undefined;
        let action: StructureHistoryEntry['action'] = plot ? (response.form === plot.development!.form ? 'expanded' : 'upgraded') : 'founded';
        let materialScale = 1;
        if (!plot) {
          response = responseForNeed(c, need)!;
          // Adapt a dormant building or a redundant communal hall before claiming new ground.
          plot = plots.find(p => p.development && (p.development.status !== 'active' ||
            ['gathering', 'hall'].includes(p.development.form) && (dev.pressures[p.development.need] ?? 0) < 0.5) && validPlot(state, p));
          if (plot) action = plot.development!.status === 'active' ? 'repurposed' : 'reused';
        }
        if (plot) {
          materialScale = 0.5 + (1 - plot.condition) * 0.5;
          const cost = { ...response.cost };
          for (const key of STOCK_KEYS) cost[key] *= materialScale;
          response = { ...response, cost };
        }
        const fuelReserve = response.need === 'energy' || response.level === 3 && ['food', 'manufacturing'].includes(response.need) ? 12 : 0;
        if (!STOCK_KEYS.every(key => settlement.resources[key] >= response.cost[key] + (key === 'wood' ? fuelReserve : 0)) || c.builders === 0) continue;
        const materialRequirements = scaleRequirements(structureMaterialRequirements(response), materialScale);
        if (hasMaterialAuthority(settlement) && materialRequirementCoverage(settlement, materialRequirements) < 0.08) continue;
        if (plot && !validPlot(state, plot)) continue;
        plot ??= reserveStructurePlot(state, settlement, districtForResponse(response));
        if (!plot) continue;
        dev.project = { plotId: plot.id, response, action, startedMonth: state.month, progress: 0, spent: stock(), materialRequirements, materialSpent: {} };
        dev.revision++; break;
      }
      dev.nextAttemptMonth = state.month + 12;
    }
  }
  const project = dev.project;
  if (project && settlement.alive) {
    const plot = settlement.structurePlots?.find(p => p.id === project.plotId);
    const c = developmentContext(state, settlement, residents);
    const supported = responseForNeed(c, project.response.need, project.response.level);
    // Lost sponsors/capabilities pause work; after ten years the site can be reclaimed.
    const patronLost = project.response.institutionId && !c.institutions.some(i => i.id === project.response.institutionId);
    const materialLost = project.response.material === 'metal' && practical(settlement, 'iron-working') < 0.45
      || project.response.material === 'ceramic' && practical(settlement, 'pottery-firing') < 0.3
      || project.response.material === 'masonry' && practical(settlement, 'leverage') < 0.25;
    if (!plot || plot.fire || !supported || supported.level < project.response.level || patronLost || materialLost || (plot.floodDepth ?? 0) > 0.06) {
      if (state.month - project.startedMonth > 120) abandonProject();
    } else if (workRate > 0) {
      const physicalLimit = project.materialRequirements ? maxMaterialProgressIncrement(settlement, project.materialRequirements) : 1;
      const progress = Math.max(0, Math.min(1 - project.progress, workRate / project.response.labor, physicalLimit,
        ...STOCK_KEYS.filter(key => project.response.cost[key] > 0).map(key => settlement.resources[key] / project.response.cost[key])));
      if (project.progress + progress >= 1 - 1e-8 && !validPlot(state, plot)) return events;
      consumeConstructionMaterials(settlement, project, progress, state.month);
      for (const key of STOCK_KEYS) {
        const payment = progress * project.response.cost[key];
        settlement.resources[key] = Math.max(0, settlement.resources[key] - payment); project.spent[key] += payment;
      }
      project.progress = Math.min(1, project.progress + progress);
      if (project.progress >= 1 - 1e-8) {
        const record = entry(project.response, state.month, project.action);
        const prior = plot.development;
        plot.development = { ...project.response, status: 'active', origin: prior?.origin ?? record, history: prior?.history ?? [],
          transitionCount: prior?.transitionCount ?? 0, lastUsedMonth: state.month };
        if (prior) remember(plot.development, record);
        plot.condition = 1; plot.accessRestricted = false;
        plot.char = 0;
        events.push(historyEvent(settlement, plot, record)); dev.project = undefined; dev.revision++;
      }
    }
  }
  settlement.buildings = (settlement.structurePlots ?? []).filter(p => p.development?.status === 'active').length;
  settlement.targetBuildings = settlement.buildings + (dev.project ? 1 : 0);
  settlement.constructionProgress = dev.project?.progress ?? 0;
  return events;
}
