import { createSettlementLayoutPlan, type BuildingDistrict, type SettlementLayoutPlan } from '../../shared/SettlementLayoutPlan';
import type {
  Activity,
  DestinationKind,
  Person,
  PersonAppearance,
  PersonRole,
  SchedulePhase,
  Settlement,
  SimulationState,
  TradeRoute,
  Vec2,
  WorldState,
} from '../types';
import { WalkabilityLayer, type CrossingMode } from './WalkabilityLayer';
import { DANGEROUS_WATER_DEPTH, waterDepthAt } from '../terrain/SurfaceGeometry';

interface ScheduledDestination {
  kind: DestinationKind;
  phase: SchedulePhase;
  activity: Activity;
  reason: string;
}

const WORK_DESTINATION: Record<PersonRole, DestinationKind> = {
  child: 'plaza',
  elder: 'home',
  gatherer: 'field',
  hunter: 'field',
  farmer: 'field',
  fisher: 'dock',
  laborer: 'construction-site',
  builder: 'construction-site',
  'craft-worker': 'workshop',
  'ritual-specialist': 'shrine',
  trader: 'market',
  miner: 'industrial-site',
  soldier: 'patrol-route',
  guard: 'patrol-route',
  administrator: 'civic-building',
  scholar: 'knowledge-institution',
  healer: 'civic-building',
  priest: 'shrine',
  sailor: 'dock',
  transporter: 'warehouse',
  'factory-worker': 'industrial-site',
  engineer: 'industrial-site',
  machinist: 'industrial-site',
  'railway-worker': 'station',
  merchant: 'market',
  manager: 'civic-building',
  scientist: 'knowledge-institution',
  'dock-worker': 'dock',
  researcher: 'knowledge-institution',
  'energy-technician': 'industrial-site',
  'medical-worker': 'civic-building',
  'logistics-worker': 'warehouse',
  'machine-systems-specialist': 'industrial-site',
  'space-worker': 'industrial-site',
};

const DESTINATION_DISTRICT: Partial<Record<DestinationKind, BuildingDistrict>> = {
  home: 'residential',
  field: 'craft',
  workshop: 'craft',
  market: 'market',
  plaza: 'civic',
  shrine: 'sacred',
  'civic-building': 'civic',
  'construction-site': 'craft',
  warehouse: 'market',
  'industrial-site': 'industrial',
  'knowledge-institution': 'civic',
  'patrol-route': 'civic',
  'safe-area': 'residential',
};

/**
 * The documentary population layer. Persons remain full simulation entities, but their visible
 * presence is grounded in a home, era-valid role, daily phase, semantic destination, and an
 * explicit terrain-safe route rather than a cosmetic random target.
 */
export class PeopleSystem {
  readonly walkability: WalkabilityLayer;
  private readonly layoutCache = new Map<string, { signature: string; layout: SettlementLayoutPlan }>();

  constructor(private readonly world: WorldState, private readonly seed: string) {
    this.walkability = new WalkabilityLayer(world);
  }

  initializePerson(person: Person, settlement: Settlement, state: SimulationState): void {
    this.refreshIdentity(person, settlement, state);
    const home = this.destinationPoint(person, settlement, state, 'home');
    person.position = home;
    person.target = { ...home };
    person.activity = 'rest';
    person.navigation = {
      destinationKind: 'home',
      destinationId: `${person.householdId}:home`,
      reason: 'at home with their household',
      waypoints: [],
      waypointIndex: 0,
      schedulePhase: 'home',
      traveling: false,
      crossingMode: 'walk',
    };
  }

  refreshIdentity(person: Person, settlement: Settlement, state: SimulationState): void {
    const previousRole = person.role;
    const role = this.roleFor(person, settlement, state);
    person.role = role;
    person.workplaceId = `${settlement.id}:${WORK_DESTINATION[role]}`;
    const householdVariation = stableUnit(`${this.seed}:${person.householdId}:wealth`) - 0.5;
    const roleStatus = statusForRole(role);
    const householdWealth = clamp(settlement.prosperity * 0.68 + householdVariation * 0.34 + roleStatus * 0.16);
    person.socialPosition = {
      householdWealth,
      resourceAccess: clamp(householdWealth * 0.65 + settlement.foodSecurity * 0.35),
      occupationStatus: clamp(0.2 + roleStatus * 0.68),
      educationAccess: clamp(settlement.knowledge.literacy * 0.62 + (isKnowledgeRole(role) ? 0.3 : 0)),
      politicalInfluence: clamp(person.prestige * 0.45 + (isCivicRole(role) ? 0.36 : 0)),
      institutionalPosition: person.institutionId ? 0.72 : isCivicRole(role) ? 0.48 : 0.08,
    };
    person.appearance = this.appearanceFor(person, role, householdWealth);
    person.appearance.textilePattern = state.cultures.find((culture) => culture.id === person.cultureId)?.style.pattern ?? person.appearance.textilePattern;
    if (previousRole && previousRole !== role && ['commute', 'work'].includes(person.navigation?.schedulePhase ?? '')) {
      // An era/occupation transition invalidates the old commute. Replan below using the new
      // workplace rather than finishing a journey for a role the person no longer has.
      person.navigation!.traveling = false;
      person.navigation!.destinationId = `${person.id}:role-change-replan`;
    }
  }

  advancePerson(person: Person, settlement: Settlement, state: SimulationState): void {
    const cellX = Math.round(person.position.x / this.world.cellSize + this.world.size / 2);
    const cellZ = Math.round(person.position.z / this.world.cellSize + this.world.size / 2);
    const weather = state.weather.cells[cellZ * this.world.size + cellX];
    const waterTransport = ['boat', 'ferry'].includes(person.navigation?.crossingMode ?? 'walk');
    const flooded = waterDepthAt(this.world, person.position.x, person.position.z) >= DANGEROUS_WATER_DEPTH;
    const closedBuilding = (settlement.structurePlots ?? []).some((plot) => (plot.accessRestricted || plot.condition < 0.65)
      && Math.hypot(person.position.x - plot.worldX, person.position.z - plot.worldZ) < plot.radius + 0.2);
    if (!waterTransport && (flooded || closedBuilding)) {
      this.evacuate(person, settlement);
      return;
    }
    if (!waterTransport && !this.walkability.isWalkable(person.position)) {
      person.position = this.walkability.nearestWalkable(person.position, `${person.id}:weather-evacuation`);
      person.target = { ...person.position };
      person.navigation = undefined;
    }
    const danger = weather && (weather.wind > 0.72 || weather.floodDepth > 0.035 || (weather.kind === 'heavy-snow' && weather.intensity > 0.65));
    if (danger && !waterTransport) {
      if (person.navigation?.reason !== 'sheltering from severe weather') {
        this.assignDestination(person, settlement, state, {
          kind: 'home', phase: 'emergency', activity: 'shelter', reason: 'sheltering from severe weather',
        }, 'walk');
      }
      if (person.navigation?.traveling) this.advanceAlongRoute(person, 2, settlement, state);
      person.activity = 'shelter';
      return;
    }
    if (person.activity === 'migrate' && person.navigation?.destinationKind === 'home' && person.navigation.destinationId === settlement.id) {
      this.advanceAlongRoute(person, 2.6, settlement, state);
      return;
    }

    const navigation = person.navigation;
    if (navigation?.destinationKind === 'construction-site' && settlement.constructionProgress <= 0) {
      // A completed/cancelled project stops attracting workers immediately.
      navigation.traveling = false;
      navigation.destinationId = `${person.id}:construction-complete-replan`;
    }
    if (navigation?.traveling) {
      const speed = navigation.crossingMode === 'rail' ? 3.2 : 2 + person.traits.conscientiousness * 0.5;
      this.advanceAlongRoute(person, speed, settlement, state);
      return;
    }

    const schedule = this.scheduleFor(person, settlement, state);
    const destinationId = this.destinationId(person, settlement, schedule.kind);
    if (navigation && navigation.destinationId === destinationId && navigation.schedulePhase === schedule.phase) {
      person.activity = schedule.activity;
      if (schedule.activity === 'rest') person.energy = clamp(person.energy + 0.2);
      return;
    }
    this.assignDestination(person, settlement, state, schedule, 'walk');
  }

  private evacuate(person: Person, settlement: Settlement): void {
    // One monthly tick spans the evacuation. Never interpolate an ordinary commute through it.
    let safe = this.walkability.nearestWalkable(person.position, `${settlement.id}:flood-refuge`);
    for (const plot of settlement.structurePlots ?? []) {
      if (!plot.accessRestricted && plot.condition >= 0.65) continue;
      if (Math.hypot(safe.x - plot.worldX, safe.z - plot.worldZ) >= plot.radius + 0.3) continue;
      safe = this.walkability.nearestWalkable({ x: plot.worldX + plot.radius + 0.5, z: plot.worldZ }, `${settlement.id}:refuge:${plot.id}`);
    }
    person.position = safe;
    person.target = { ...safe };
    person.activity = 'shelter';
    person.navigation = { destinationKind: 'safe-area', destinationId: `${settlement.id}:flood-refuge`,
      reason: this.walkability.isWalkable(safe) ? 'evacuated from flooding or an unsafe building' : 'stranded by flooding; awaiting rescue',
      waypoints: [], waypointIndex: 0, schedulePhase: 'emergency', traveling: false, crossingMode: 'walk' };
    if (!this.walkability.isWalkable(safe)) person.health = Math.max(0, person.health - 0.2);
  }

  beginMigration(person: Person, target: Settlement, state: SimulationState, route?: TradeRoute): boolean {
    // Migration currently has pedestrian agents, not passenger tickets. Never infer a train
    // or boat from settlement capability; unsupported passenger legs remain unreachable.
    const mode: CrossingMode = 'walk';
    const destination = this.destinationPoint(person, target, state, 'home');
    const layout = this.layout(target, state);
    const portal = route ? layout.portals.find((candidate) => candidate.routeId === route.id) : undefined;
    const preferred = portal ? [{ x: portal.worldX, z: portal.worldZ }] : [];
    const waypoints = this.walkability.route(person.position, destination, preferred, mode);
    const last = waypoints[waypoints.length - 1];
    if (!last || Math.hypot(last.x - destination.x, last.z - destination.z) > 0.05) return false;
    person.activity = 'migrate';
    person.target = { ...waypoints[0]! };
    person.navigation = {
      destinationKind: 'home',
      destinationId: target.id,
      reason: `resettling with their household in ${target.name}`,
      waypoints,
      waypointIndex: 0,
      schedulePhase: 'emergency',
      traveling: true,
      crossingMode: mode,
    };
    return true;
  }

  isPersonPositionValid(person: Person): boolean {
    const crossing = person.navigation?.crossingMode;
    return this.walkability.isWalkable(person.position)
      || ((crossing === 'boat' || crossing === 'ferry') && person.navigation?.traveling === true);
  }

  isPersonRouteValid(person: Person): boolean {
    const navigation = person.navigation;
    if (!navigation) return false;
    const points = navigation.traveling
      ? [person.position, ...navigation.waypoints.slice(navigation.waypointIndex)]
      : navigation.waypoints;
    return this.walkability.routeIsValid(points, navigation.crossingMode ?? 'walk');
  }

  roleSupported(role: PersonRole, settlement: Settlement, state: SimulationState): boolean {
    const rank = settlementEraRank(settlement, state);
    if (['factory-worker', 'engineer', 'machinist', 'manager', 'energy-technician', 'medical-worker', 'logistics-worker'].includes(role)) return rank >= 4;
    if (['scientist', 'researcher', 'machine-systems-specialist', 'space-worker'].includes(role)) return rank >= 5;
    if (['administrator', 'scholar', 'railway-worker', 'merchant'].includes(role)) return rank >= 3;
    if (['guard', 'soldier'].includes(role)) return rank >= 1;
    return true;
  }

  private roleFor(person: Person, settlement: Settlement, state: SimulationState): PersonRole {
    const age = person.ageMonths / 12;
    if (age < 15) return 'child';
    if (age > 68) return 'elder';
    const rank = settlementEraRank(settlement, state);
    const draw = stableUnit(`${this.seed}:${person.id}:role:${rank}`);
    const military = state.institutions.some((institution) => institution.settlementId === settlement.id && institution.kind === 'military-order');
    const temple = state.institutions.some((institution) => institution.settlementId === settlement.id && institution.kind === 'temple');
    const archive = settlement.infrastructure.archives > 0.12 || state.institutions.some((institution) => institution.settlementId === settlement.id && institution.kind === 'knowledge-keepers');

    if (rank >= 1 && (military || settlement.conflictPressure > 0.16) && draw < 0.11) return draw < 0.045 ? 'soldier' : 'guard';
    switch (person.occupation) {
      case 'farmer':
        if ((this.world.cells[settlement.cellIndex]?.coast || settlement.infrastructure.ports > 0.08) && draw < 0.23) return 'fisher';
        return 'farmer';
      case 'forager':
        if (settlement.specialization === 'mining' && draw < 0.58) return 'miner';
        return draw < 0.32 ? 'hunter' : 'gatherer';
      case 'builder':
        if (rank >= 4 && draw < 0.2) return 'engineer';
        return draw < 0.42 ? 'laborer' : 'builder';
      case 'artisan':
        if (rank >= 5 && draw < 0.08) return 'machine-systems-specialist';
        if (rank >= 4 && draw < 0.3) return draw < 0.13 ? 'machinist' : 'factory-worker';
        return 'craft-worker';
      case 'carrier':
        if (rank >= 4 && settlement.infrastructure.rail > 0.16 && draw < 0.18) return 'railway-worker';
        if ((this.world.cells[settlement.cellIndex]?.coast || settlement.infrastructure.ports > 0.08) && draw < 0.38) return draw < 0.18 ? 'sailor' : 'dock-worker';
        if (rank >= 4 && draw < 0.56) return 'logistics-worker';
        return draw < 0.72 ? 'transporter' : rank >= 3 ? 'merchant' : 'trader';
      case 'keeper':
        if ((temple || state.cultures.find((culture) => culture.id === person.cultureId)?.dimensions.religiousTendency) && draw < 0.25) return rank >= 2 ? 'priest' : 'ritual-specialist';
        if (rank >= 5 && archive && draw < 0.52) return draw < 0.39 ? 'scientist' : 'researcher';
        if (rank >= 3 && archive && draw < 0.68) return 'scholar';
        if (rank >= 3 && draw < 0.84) return 'administrator';
        return draw < 0.46 ? 'healer' : 'ritual-specialist';
      case 'child': return 'child';
      case 'elder': return 'elder';
    }
  }

  private appearanceFor(person: Person, role: PersonRole, wealth: number): PersonAppearance {
    const variation = stableUnit(`${this.seed}:${person.id}:appearance`);
    const buildVariation = stableUnit(`${this.seed}:${person.id}:build`);
    const ceremonial = ['priest', 'ritual-specialist'].includes(role);
    const uniform = ['guard', 'soldier'].includes(role);
    const technical = ['engineer', 'machinist', 'factory-worker', 'scientist', 'researcher', 'energy-technician', 'machine-systems-specialist', 'space-worker'].includes(role);
    const workwear = ['farmer', 'fisher', 'laborer', 'builder', 'craft-worker', 'miner', 'dock-worker', 'transporter', 'logistics-worker'].includes(role);
    const garment: PersonAppearance['garment'] = ceremonial ? 'ceremonial' : uniform ? 'uniform' : technical ? 'technical' : wealth > 0.7 ? 'layered' : workwear ? 'workwear' : 'simple';
    const headwear: PersonAppearance['headwear'] = uniform ? 'helmet' : technical ? 'cap' : role === 'farmer' || role === 'fisher' ? 'brim' : ceremonial ? 'wrap' : variation > 0.72 ? 'wrap' : 'none';
    const itemByRole: Partial<Record<PersonRole, PersonAppearance['carriedItem']>> = {
      farmer: 'hoe', fisher: 'basket', gatherer: 'basket', hunter: 'bag', laborer: 'hammer', builder: 'hammer', 'craft-worker': 'toolkit', trader: 'bag', merchant: 'ledger', administrator: 'ledger', scholar: 'ledger', researcher: 'toolkit', engineer: 'toolkit', machinist: 'toolkit', transporter: 'bag', 'dock-worker': 'bag', 'factory-worker': 'toolkit', 'logistics-worker': 'bag', priest: 'staff', 'ritual-specialist': 'staff', guard: 'staff', soldier: 'staff',
    };
    return {
      // Deterministic adult variation only: ~0.85-1.15 of the canonical world humanoid height.
      heightScale: 0.85 + variation * 0.3,
      buildScale: 0.86 + buildVariation * 0.27,
      posture: person.ageMonths > 60 * 12 ? 0.1 + variation * 0.14 : (variation - 0.5) * 0.08,
      garment,
      headwear,
      carriedItem: itemByRole[role] ?? 'none',
      textilePattern: statePatternFallback(person),
      materialQuality: clamp(wealth * 0.72 + variation * 0.2),
    };
  }

  private scheduleFor(person: Person, settlement: Settlement, state: SimulationState): ScheduledDestination {
    const role = person.role ?? 'gatherer';
    const shiftedHour = (state.month * 3 + Math.floor(stableUnit(`${person.id}:schedule`) * 3)) % 24;
    const winter = state.month % 12 <= 1 || state.month % 12 >= 10;
    if (person.energy < 0.23 || shiftedHour < (winter ? 6 : 5) || shiftedHour >= 22) {
      return { kind: 'home', phase: 'home', activity: 'rest', reason: 'resting at home with their household' };
    }
    if (shiftedHour < 8) {
      const kind = this.workDestination(role, settlement);
      return { kind, phase: 'commute', activity: 'travel', reason: `taking the morning route to ${humanDestination(kind)}` };
    }
    if (shiftedHour < 16) {
      const kind = this.workDestination(role, settlement);
      return { kind, phase: 'work', activity: activityForRole(role, kind), reason: `working at ${humanDestination(kind)}` };
    }
    if (shiftedHour < 19) {
      const marketDay = state.month % 4 !== 0 || ['trader', 'merchant', 'transporter', 'dock-worker'].includes(role);
      const kind: DestinationKind = marketDay ? 'market' : 'plaza';
      return { kind, phase: 'meal', activity: role === 'trader' || role === 'merchant' ? 'trade' : 'socialize', reason: `joining activity at ${humanDestination(kind)}` };
    }
    if (['priest', 'ritual-specialist'].includes(role) || (state.month + Math.floor(stableUnit(person.id) * 4)) % 5 === 0) {
      return { kind: 'shrine', phase: 'ritual', activity: 'worship', reason: 'attending an evening gathering at the shrine' };
    }
    return { kind: 'home', phase: 'home', activity: 'rest', reason: 'returning home for the evening' };
  }

  private workDestination(role: PersonRole, settlement: Settlement): DestinationKind {
    if ((role === 'builder' || role === 'laborer') && settlement.constructionProgress > 0) return 'construction-site';
    if (role === 'laborer') return settlement.specialization === 'agriculture' ? 'field' : 'workshop';
    if (role === 'builder') return 'workshop';
    return WORK_DESTINATION[role];
  }

  private assignDestination(person: Person, settlement: Settlement, state: SimulationState, schedule: ScheduledDestination, mode: CrossingMode): void {
    const destination = this.destinationPoint(person, settlement, state, schedule.kind);
    const preferred = this.preferredRoadWaypoints(person, settlement, state, schedule.kind);
    const waypoints = this.walkability.route(person.position, destination, preferred, mode);
    if (waypoints.length === 0) {
      const safe = this.walkability.nearestWalkable(person.position, `${person.id}:stranded`);
      person.position = safe;
      person.target = { ...safe };
      person.activity = 'rest';
      person.navigation = {
        destinationKind: 'safe-area', destinationId: `${settlement.id}:safe-area`, reason: 'waiting on stable ground',
        waypoints: [], waypointIndex: 0, schedulePhase: 'emergency', traveling: false, crossingMode: 'walk',
      };
      return;
    }
    person.target = { ...waypoints[0]! };
    person.activity = 'travel';
    person.navigation = {
      destinationKind: schedule.kind,
      destinationId: this.destinationId(person, settlement, schedule.kind),
      reason: schedule.reason,
      waypoints,
      waypointIndex: 0,
      schedulePhase: schedule.phase,
      traveling: true,
      crossingMode: mode,
    };
  }

  private advanceAlongRoute(person: Person, step: number, settlement: Settlement, state: SimulationState): void {
    const navigation = person.navigation;
    if (!navigation?.traveling) return;
    let remainingStep = step;
    while (remainingStep > 0.001 && navigation.traveling) {
      const waypoint = navigation.waypoints[navigation.waypointIndex];
      if (!waypoint) {
        this.arrive(person, settlement, state);
        return;
      }
      const remaining = Math.hypot(waypoint.x - person.position.x, waypoint.z - person.position.z);
      const waterTransport = navigation.crossingMode === 'boat' || navigation.crossingMode === 'ferry';
      if (!waterTransport && !this.walkability.isSegmentWalkable(person.position, waypoint)) {
        const safe = this.walkability.nearestWalkable(person.position, `${person.id}:route-recovery`);
        const finalDestination = navigation.waypoints[navigation.waypoints.length - 1] ?? safe;
        navigation.waypoints = this.walkability.route(safe, finalDestination, [], navigation.crossingMode ?? 'walk');
        navigation.waypointIndex = 0;
        person.position = safe;
        person.target = { ...(navigation.waypoints[0] ?? safe) };
        if (navigation.waypoints.length === 0) this.arrive(person, settlement, state);
        return;
      }
      const multiplier = waterTransport ? 1 : this.walkability.travelMultiplier(waypoint);
      const availableStep = remainingStep / multiplier;
      if (remaining <= availableStep) {
        person.position = { ...waypoint };
        remainingStep -= remaining * multiplier;
        navigation.waypointIndex += 1;
        const next = navigation.waypoints[navigation.waypointIndex];
        if (!next) this.arrive(person, settlement, state);
        else person.target = { ...next };
        continue;
      }
      const candidate = {
        x: person.position.x + (waypoint.x - person.position.x) / remaining * availableStep,
        z: person.position.z + (waypoint.z - person.position.z) / remaining * availableStep,
      };
      if (!waterTransport && !this.walkability.isSegmentWalkable(person.position, candidate)) {
        const safe = this.walkability.nearestWalkable(person.position, `${person.id}:route-recovery`);
        const finalDestination = navigation.waypoints[navigation.waypoints.length - 1] ?? safe;
        const recovered = this.walkability.route(safe, finalDestination, [], navigation.crossingMode ?? 'walk');
        person.position = safe;
        navigation.waypoints = recovered;
        navigation.waypointIndex = 0;
        if (recovered[0]) person.target = { ...recovered[0] };
        else this.arrive(person, settlement, state);
        return;
      }
      person.position = candidate;
      person.target = { ...waypoint };
      remainingStep = 0;
    }
  }

  private arrive(person: Person, settlement: Settlement, state: SimulationState): void {
    const navigation = person.navigation;
    if (!navigation) return;
    navigation.traveling = false;
    navigation.waypointIndex = navigation.waypoints.length;
    person.target = { ...person.position };
    if (person.activity === 'migrate') {
      this.refreshIdentity(person, settlement, state);
      person.activity = 'rest';
      navigation.waypoints = [];
      navigation.waypointIndex = 0;
      navigation.destinationId = `${person.householdId}:home`;
      navigation.reason = 'arrived at their new household home';
      navigation.schedulePhase = 'home';
      navigation.crossingMode = 'walk';
      return;
    }
    person.activity = activityAtDestination(person.role ?? 'gatherer', navigation.destinationKind);
  }

  private destinationPoint(person: Person, settlement: Settlement, state: SimulationState, kind: DestinationKind): Vec2 {
    const layout = this.layout(settlement, state);
    if (kind === 'dock' || kind === 'station') {
      const portal = layout.portals.find((candidate) => candidate.kind === kind);
      if (portal) {
        const shoreward = kind === 'dock' ? -0.58 : -0.28;
        return this.walkability.nearestWalkable({ x: portal.worldX + Math.cos(portal.angle) * shoreward, z: portal.worldZ + Math.sin(portal.angle) * shoreward }, `${person.id}:${kind}`);
      }
    }
    const district = DESTINATION_DISTRICT[kind] ?? 'civic';
    const anchor = layout.anchors[district];
    const identity = kind === 'home' ? person.householdId : `${person.id}:${kind}`;
    const angle = stableUnit(`${this.seed}:${identity}:angle`) * Math.PI * 2;
    const spread = kind === 'field' ? layout.radius * 0.38 : kind === 'patrol-route' ? layout.radius * 0.46 : Math.max(0.42, anchor.radius * 0.58);
    const radius = spread * (0.58 + stableUnit(`${this.seed}:${identity}:radius`) * 0.42);
    const center = kind === 'field'
      ? { x: settlement.position.x + Math.cos(angle) * layout.radius * 0.78, z: settlement.position.z + Math.sin(angle) * layout.radius * 0.78 }
      : { x: anchor.worldX, z: anchor.worldZ };
    let destination = this.walkability.nearestWalkable({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius }, identity);
    // Homes and workplaces can remain unsafe after the surrounding ground dries.
    for (let pass = 0; pass < 4; pass++) {
      const closed = (settlement.structurePlots ?? []).find(plot => (plot.accessRestricted || plot.condition < 0.65)
        && Math.hypot(destination.x - plot.worldX, destination.z - plot.worldZ) < plot.radius + 0.3);
      if (!closed) break;
      destination = this.walkability.nearestWalkable({ x: closed.worldX + Math.cos(angle) * (closed.radius + 0.6 + pass),
        z: closed.worldZ + Math.sin(angle) * (closed.radius + 0.6 + pass) }, identity);
    }
    return destination;
  }

  private preferredRoadWaypoints(person: Person, settlement: Settlement, state: SimulationState, destination: DestinationKind): Vec2[] {
    const layout = this.layout(settlement, state);
    const district = DESTINATION_DISTRICT[destination] ?? 'civic';
    const points: Vec2[] = [];
    if (person.navigation?.destinationKind === 'home' || Math.hypot(person.position.x - layout.anchors.residential.worldX, person.position.z - layout.anchors.residential.worldZ) < layout.radius * 0.65) {
      points.push({ x: layout.anchors.residential.worldX, z: layout.anchors.residential.worldZ });
    }
    if (district !== 'residential') points.push({ x: layout.anchors.civic.worldX, z: layout.anchors.civic.worldZ });
    if (district !== 'civic') points.push({ x: layout.anchors[district].worldX, z: layout.anchors[district].worldZ });
    return points;
  }

  private destinationId(person: Person, settlement: Settlement, kind: DestinationKind): string {
    return kind === 'home' ? `${person.householdId}:home` : `${settlement.id}:${kind}`;
  }

  private layout(settlement: Settlement, state: SimulationState): SettlementLayoutPlan {
    const routeSignature = state.tradeRoutes
      .filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id))
      .map((route) => `${route.id}:${route.transport?.path?.mode ?? 'unconnected'}:${Math.floor(route.volume * 5)}`)
      .join('|');
    const signature = `${settlement.buildings}:${Math.floor(settlement.urbanization * 8)}:${settlementEraRank(settlement, state)}:${routeSignature}`;
    const cached = this.layoutCache.get(settlement.id);
    if (cached?.signature === signature) return cached.layout;
    const layout = createSettlementLayoutPlan({
      settlement,
      settlements: state.settlements,
      routes: state.tradeRoutes,
      transportation: state.transportation,
      eraRank: settlementEraRank(settlement, state),
      seed: this.seed,
    });
    this.layoutCache.set(settlement.id, { signature, layout });
    return layout;
  }
}

export function settlementEraRank(settlement: Settlement, state: SimulationState): number {
  if (state.advanced.scale === 'modern-statistical' || state.advanced.space.orbitalInfrastructure > 0.08 || state.advanced.machine.capability > 0.16) return 5;
  if (settlement.industry.active || settlement.infrastructure.factories > 0.12 || settlement.infrastructure.power > 0.18) return 4;
  if (settlement.infrastructure.archives > 0.2 || settlement.infrastructure.workshops > 0.28) return 3;
  if (settlement.urbanization > 0.2 || settlement.infrastructure.roads > 0.2) return 2;
  if (settlement.buildings > 8) return 1;
  return 0;
}

function activityForRole(role: PersonRole, destination: DestinationKind): Activity {
  if (destination === 'construction-site') return 'construct';
  if (['guard', 'soldier'].includes(role)) return 'patrol';
  if (['priest', 'ritual-specialist'].includes(role)) return 'worship';
  if (['trader', 'merchant'].includes(role)) return 'trade';
  if (isKnowledgeRole(role)) return 'study';
  if (['transporter', 'dock-worker', 'railway-worker', 'logistics-worker', 'sailor'].includes(role)) return 'transport';
  if (['farmer'].includes(role)) return 'farm';
  if (['gatherer', 'hunter', 'fisher', 'miner'].includes(role)) return 'gather';
  if (['child'].includes(role)) return 'socialize';
  if (['elder'].includes(role)) return 'rest';
  return 'craft';
}

function activityAtDestination(role: PersonRole, destination: DestinationKind): Activity {
  if (destination === 'home') return 'rest';
  if (destination === 'market') return role === 'trader' || role === 'merchant' ? 'trade' : 'socialize';
  if (destination === 'plaza') return 'socialize';
  if (destination === 'shrine') return 'worship';
  return activityForRole(role, destination);
}

function isKnowledgeRole(role: PersonRole): boolean {
  return ['scholar', 'scientist', 'researcher', 'machine-systems-specialist'].includes(role);
}

function isCivicRole(role: PersonRole): boolean {
  return ['administrator', 'manager', 'guard', 'soldier', 'priest'].includes(role);
}

function statusForRole(role: PersonRole): number {
  if (['administrator', 'manager', 'scientist', 'priest', 'merchant'].includes(role)) return 0.82;
  if (['scholar', 'engineer', 'healer', 'guard', 'researcher'].includes(role)) return 0.62;
  if (['child', 'elder'].includes(role)) return 0.32;
  return 0.44;
}

function humanDestination(kind: DestinationKind): string {
  return kind.replaceAll('-', ' ');
}

function statePatternFallback(person: Person): PersonAppearance['textilePattern'] {
  const patterns: readonly PersonAppearance['textilePattern'][] = ['chevron', 'diamond', 'terrace', 'crossweave', 'wave'];
  return patterns[Math.floor(stableUnit(`${person.cultureId}:pattern`) * patterns.length)] ?? 'chevron';
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
