import type { Person, Settlement, SimulationState, Vec2 } from '../../sim/types';
import { usableStructure } from '../../sim/development/Shelter';

export type FoundingStandardPhase =
  | 'prepare-base'
  | 'carry-pole'
  | 'attach-cloth'
  | 'raise'
  | 'secure'
  | 'unfurl'
  | 'acknowledge'
  | 'complete';

export type FoundingStandardParticipantRole = 'base-worker' | 'raiser' | 'binder';

export interface FoundingStandardVisualSample {
  readonly active: boolean;
  readonly established: boolean;
  readonly phase: FoundingStandardPhase;
  readonly phaseProgress: number;
  /** 0 at the landed supply cache, 1 at the permanent base. */
  readonly transferProgress: number;
  /** Mast rotation around its planted foot: -PI/2 is horizontal, 0 is upright. */
  readonly polePitch: number;
  /** Folded cloth exists only after a person has visibly attached it to the grounded mast. */
  readonly bundleVisible: boolean;
  /** 0..1 downward unfurl from the top attachment. */
  readonly clothUnfurl: number;
}

export interface FoundingStandardTarget extends Vec2 {
  readonly ceremonyId: string;
  readonly role: FoundingStandardParticipantRole;
  readonly animation: 'gather' | 'build' | 'carry' | 'converse-quiet';
  readonly restFacing: number;
  readonly phase: FoundingStandardPhase;
  readonly phaseProgress: number;
  readonly interactionTarget?: Readonly<Vec2>;
  readonly interactionHeight?: number;
  readonly contactStrength?: number;
}

interface Participant {
  readonly personId: string;
  readonly role: FoundingStandardParticipantRole;
  readonly slot: number;
}

interface ActiveStandard {
  readonly settlementId: string;
  readonly ceremonyId: string;
  readonly startedAt: number;
  readonly participants: readonly Participant[];
}

const PREPARE_END = 2.1;
const CARRY_END = 6.2;
const ATTACH_END = 8.3;
const RAISE_END = 13.2;
const SECURE_END = 15.3;
const UNFURL_END = 18.4;
export const FOUNDING_STANDARD_DURATION_SECONDS = 21.2;

/**
 * Presentation-only founding-standard ceremony.
 *
 * Readiness is derived entirely from authoritative survival/building state. The ceremony does not
 * create a building, consume labour, mint culture, or record history. It only makes the already-earned
 * civic symbol enter the world through human effort instead of popping into existence.
 */
export class FoundingStandardPresentation {
  private readonly established = new Set<string>();
  private readonly active = new Map<string, ActiveStandard>();
  private nowSeconds = 0;
  private nextAvailableStartSeconds = 0;

  constructor(state: Pick<SimulationState, 'settlements'>) {
    // A renderer created after the milestone must not replay a ceremony that happened off-screen.
    for (const settlement of state.settlements) {
      if (foundingStandardEligible(settlement)) this.established.add(settlement.id);
    }
  }

  update(
    state: Pick<SimulationState, 'settlements' | 'people'>,
    elapsedSeconds: number,
    blockedSettlementIds: ReadonlySet<string> = new Set(),
  ): boolean {
    this.nowSeconds = Math.max(0, elapsedSeconds);
    let changed = false;
    const newlyReady = state.settlements
      .filter(settlement => foundingStandardEligible(settlement)
        && !blockedSettlementIds.has(settlement.id)
        && !this.established.has(settlement.id)
        && !this.active.has(settlement.id))
      .sort((a, b) => a.foundedMonth - b.foundedMonth || stableUnit(a.id) - stableUnit(b.id));

    for (const settlement of newlyReady) {
      const ceremonyId = `founding-standard:${settlement.id}:${settlement.survival?.firstFire?.eventId ?? settlement.foundedMonth}`;
      const delay = 0.45 + stableUnit(`${ceremonyId}:delay`) * 0.75;
      const startedAt = Math.max(this.nowSeconds + delay, this.nextAvailableStartSeconds);
      this.nextAvailableStartSeconds = startedAt + 4.5;
      this.active.set(settlement.id, {
        settlementId: settlement.id,
        ceremonyId,
        startedAt,
        participants: selectParticipants(state.people, settlement),
      });
      changed = true;
    }

    for (const [settlementId, ceremony] of this.active) {
      if (this.nowSeconds - ceremony.startedAt < FOUNDING_STANDARD_DURATION_SECONDS) continue;
      this.active.delete(settlementId);
      this.established.add(settlementId);
      changed = true;
    }
    return changed;
  }

  stateFor(settlementId: string): 'hidden' | 'raising' | 'established' {
    if (this.active.has(settlementId)) return 'raising';
    return this.established.has(settlementId) ? 'established' : 'hidden';
  }

  shouldRender(settlement: Settlement): boolean {
    if (!settlement.foundingPodId) return settlement.alive;
    return this.active.has(settlement.id) || this.established.has(settlement.id);
  }

  sample(settlementId: string, reducedMotion = false): FoundingStandardVisualSample {
    const ceremony = this.active.get(settlementId);
    if (!ceremony) {
      const established = this.established.has(settlementId);
      return established ? settledSample() : hiddenSample();
    }
    const age = this.nowSeconds - ceremony.startedAt;
    if (age < 0) return hiddenSample();

    if (age < PREPARE_END) {
      return activeSample('prepare-base', ease(age / PREPARE_END), 0, -Math.PI / 2, false, 0);
    }
    if (age < CARRY_END) {
      const p = ease((age - PREPARE_END) / (CARRY_END - PREPARE_END));
      return activeSample('carry-pole', p, p, -Math.PI / 2, false, 0);
    }
    if (age < ATTACH_END) {
      const p = ease((age - CARRY_END) / (ATTACH_END - CARRY_END));
      return activeSample('attach-cloth', p, 1, -Math.PI / 2, p > 0.38, 0);
    }
    if (age < RAISE_END) {
      const p = ease((age - ATTACH_END) / (RAISE_END - ATTACH_END));
      const polePitch = reducedMotion
        ? THREE_HALF_PI_TO_UPRIGHT(p)
        : -Math.PI / 2 * (1 - smoother(p));
      return activeSample('raise', p, 1, polePitch, true, 0);
    }
    if (age < SECURE_END) {
      const p = ease((age - RAISE_END) / (SECURE_END - RAISE_END));
      return activeSample('secure', p, 1, 0, true, 0);
    }
    if (age < UNFURL_END) {
      const p = ease((age - SECURE_END) / (UNFURL_END - SECURE_END));
      return activeSample('unfurl', p, 1, 0, p < 0.82, smoother(p));
    }
    const p = ease((age - UNFURL_END) / (FOUNDING_STANDARD_DURATION_SECONDS - UNFURL_END));
    return activeSample('acknowledge', p, 1, 0, false, 1);
  }

  targetFor(
    personId: string,
    settlementId: string,
    base: Readonly<Vec2>,
    supply: Readonly<Vec2>,
    poleHeight: number,
  ): FoundingStandardTarget | undefined {
    const ceremony = this.active.get(settlementId);
    if (!ceremony) return;
    const participant = ceremony.participants.find(candidate => candidate.personId === personId);
    if (!participant) return;
    const sample = this.sample(settlementId);
    if (!sample.active) return;

    const route = normalizedDirection(supply, base, ceremony.ceremonyId);
    const side = { x: -route.z, z: route.x };
    const mastOrigin = {
      x: lerp(supply.x, base.x, sample.transferProgress),
      z: lerp(supply.z, base.z, sample.transferProgress),
    };

    if (sample.phase === 'prepare-base') {
      if (participant.role !== 'base-worker') return;
      const stance = offset(base, side, 0.34);
      return target(ceremony, participant, stance, base, 'gather', sample, 0.04, 0.75);
    }

    if (sample.phase === 'carry-pole') {
      if (participant.role === 'binder') return;
      const longitudinal = participant.slot === 0 ? 0.45 : participant.slot === 1 ? 1.35 : 2.15;
      const grip = offset(mastOrigin, route, longitudinal);
      const stance = offset(grip, side, participant.slot % 2 === 0 ? 0.2 : -0.2);
      return target(ceremony, participant, stance, grip, 'carry', sample, 0.56, 0.72);
    }

    if (sample.phase === 'attach-cloth') {
      if (participant.role !== 'binder') {
        if (participant.role !== 'raiser') return;
        const grip = offset(base, route, participant.slot === 1 ? 0.72 : 1.45);
        const stance = offset(grip, side, participant.slot === 1 ? 0.22 : -0.22);
        return target(ceremony, participant, stance, grip, 'carry', sample, 0.42, 0.35);
      }
      const mastTop = offset(base, route, Math.max(1.2, poleHeight - 0.45));
      const stance = offset(mastTop, side, 0.28);
      return target(ceremony, participant, stance, mastTop, 'build', sample, 0.08, 0.82);
    }

    if (sample.phase === 'raise') {
      if (participant.role === 'binder') {
        const stance = offset(base, side, -0.82);
        return target(ceremony, participant, stance, base, 'build', sample, 0.08, 0.16);
      }
      const gripDistance = participant.slot === 0 ? 0.52 : participant.slot === 1 ? 0.95 : 1.28;
      const grip = polePoint(base, route, gripDistance, sample.polePitch);
      const stance = offset(base, side, participant.slot === 0 ? 0.38 : participant.slot === 1 ? -0.44 : 0.62);
      const shifted = offset(stance, route, participant.slot === 0 ? 0.15 : -0.08);
      return target(ceremony, participant, shifted, grip.point, 'build', sample, grip.height, 0.78);
    }

    if (sample.phase === 'secure') {
      if (participant.role === 'base-worker') {
        const stance = offset(base, side, 0.34);
        return target(ceremony, participant, stance, base, 'gather', sample, 0.06, 0.85);
      }
      if (participant.role === 'raiser') {
        const stance = offset(base, side, participant.slot === 1 ? -0.48 : 0.52);
        const grip = { x: base.x, z: base.z };
        return target(ceremony, participant, stance, grip, 'build', sample, 0.9, 0.38);
      }
      return;
    }

    if (sample.phase === 'unfurl') {
      if (participant.role !== 'binder') return;
      const stance = offset(base, side, -0.58);
      const cord = offset(base, side, -0.08);
      return target(ceremony, participant, stance, cord, 'build', sample, 0.78, 0.64);
    }

    const angle = stableUnit(`${ceremony.ceremonyId}:${personId}:ack`) * Math.PI * 2;
    const radius = 0.9 + participant.slot * 0.12;
    const stance = { x: base.x + Math.cos(angle) * radius, z: base.z + Math.sin(angle) * radius };
    return {
      x: stance.x,
      z: stance.z,
      ceremonyId: ceremony.ceremonyId,
      role: participant.role,
      animation: 'converse-quiet',
      restFacing: Math.atan2(base.x - stance.x, base.z - stance.z),
      phase: sample.phase,
      phaseProgress: sample.phaseProgress,
    };
  }

  participantIds(settlementId?: string): ReadonlySet<string> {
    const ids = new Set<string>();
    if (settlementId) {
      for (const participant of this.active.get(settlementId)?.participants ?? []) ids.add(participant.personId);
      return ids;
    }
    for (const ceremony of this.active.values()) {
      for (const participant of ceremony.participants) ids.add(participant.personId);
    }
    return ids;
  }

  isPerforming(settlementId: string): boolean {
    return this.active.has(settlementId);
  }
}

export function foundingStandardEligible(
  settlement: Pick<Settlement, 'alive' | 'foundingPodId' | 'survival' | 'development' | 'structurePlots'>,
): boolean {
  if (!settlement.alive || !settlement.foundingPodId || !settlement.survival?.firstFire?.eventId) return false;
  // Wait for a completed physical shelter, not merely an economically authorized project
  // percentage. That keeps the ceremony downstream of the contact-led construction presentation.
  const completedShelter = (settlement.structurePlots ?? []).some(plot =>
    usableStructure(plot)
    && (plot.development?.services.housing ?? 0) > 0,
  );
  return completedShelter;
}

function selectParticipants(people: readonly Person[], settlement: Settlement): Participant[] {
  const candidates = people
    .filter(person => person.alive && person.homeId === settlement.id && person.health > 0.3 && person.ageMonths >= 168)
    .sort((a, b) => {
      const occupationA = foundingWorkRank(a);
      const occupationB = foundingWorkRank(b);
      if (occupationA !== occupationB) return occupationA - occupationB;
      const distanceA = Math.hypot(a.position.x - settlement.position.x, a.position.z - settlement.position.z);
      const distanceB = Math.hypot(b.position.x - settlement.position.x, b.position.z - settlement.position.z);
      if (Math.abs(distanceA - distanceB) > 0.01) return distanceA - distanceB;
      return stableUnit(a.id) - stableUnit(b.id);
    })
    .slice(0, 4);

  return candidates.map((person, index) => ({
    personId: person.id,
    role: index === 0 ? 'base-worker' : index === candidates.length - 1 && candidates.length >= 4 ? 'binder' : 'raiser',
    slot: index,
  }));
}

function foundingWorkRank(person: Person): number {
  if (['builder', 'carrier'].includes(person.occupation)) return 0;
  if (['artisan', 'keeper'].includes(person.occupation)) return 1;
  if (person.occupation === 'forager' || person.occupation === 'farmer') return 2;
  return 3;
}

function activeSample(
  phase: FoundingStandardPhase,
  phaseProgress: number,
  transferProgress: number,
  polePitch: number,
  bundleVisible: boolean,
  clothUnfurl: number,
): FoundingStandardVisualSample {
  return {
    active: true,
    established: false,
    phase,
    phaseProgress,
    transferProgress,
    polePitch,
    bundleVisible,
    clothUnfurl,
  };
}

function hiddenSample(): FoundingStandardVisualSample {
  return {
    active: false,
    established: false,
    phase: 'complete',
    phaseProgress: 0,
    transferProgress: 0,
    polePitch: -Math.PI / 2,
    bundleVisible: false,
    clothUnfurl: 0,
  };
}

function settledSample(): FoundingStandardVisualSample {
  return {
    active: false,
    established: true,
    phase: 'complete',
    phaseProgress: 1,
    transferProgress: 1,
    polePitch: 0,
    bundleVisible: false,
    clothUnfurl: 1,
  };
}

function target(
  ceremony: ActiveStandard,
  participant: Participant,
  stance: Readonly<Vec2>,
  interaction: Readonly<Vec2>,
  animation: FoundingStandardTarget['animation'],
  sample: FoundingStandardVisualSample,
  interactionHeight: number,
  contactStrength: number,
): FoundingStandardTarget {
  return {
    x: stance.x,
    z: stance.z,
    ceremonyId: ceremony.ceremonyId,
    role: participant.role,
    animation,
    restFacing: Math.atan2(interaction.x - stance.x, interaction.z - stance.z),
    phase: sample.phase,
    phaseProgress: sample.phaseProgress,
    interactionTarget: { x: interaction.x, z: interaction.z },
    interactionHeight,
    contactStrength,
  };
}

function polePoint(
  base: Readonly<Vec2>,
  horizontal: Readonly<Vec2>,
  distance: number,
  pitch: number,
): { point: Vec2; height: number } {
  const horizontalScale = Math.cos(pitch);
  return {
    point: {
      x: base.x + horizontal.x * distance * horizontalScale,
      z: base.z + horizontal.z * distance * horizontalScale,
    },
    height: Math.max(0.08, distance * Math.sin(pitch + Math.PI / 2)),
  };
}

function normalizedDirection(from: Readonly<Vec2>, to: Readonly<Vec2>, key: string): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length > 0.05) return { x: dx / length, z: dz / length };
  const angle = stableUnit(`${key}:direction`) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function offset(origin: Readonly<Vec2>, direction: Readonly<Vec2>, amount: number): Vec2 {
  return { x: origin.x + direction.x * amount, z: origin.z + direction.z * amount };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function smoother(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Reduced-motion still shows the physical cause/effect, but without a fast acceleration curve.
function THREE_HALF_PI_TO_UPRIGHT(progress: number): number {
  return -Math.PI / 2 * (1 - progress);
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
