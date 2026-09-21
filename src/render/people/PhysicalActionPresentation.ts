import type { Activity, Person, Vec2, WeatherCellState } from '../../sim/types';

export type PhysicalContactEffectKind =
  | 'timber-chip'
  | 'mineral-dust'
  | 'earth-crumb'
  | 'metal-fragment'
  | 'metal-spark';

/** Common documentary vocabulary; each action owns its workflow and articulation. */
export interface PhysicalActionPresentation {
  readonly personId: string;
  readonly actionKind: string;
  readonly authoritativeActivity: Activity;
  readonly sourceAuthority: string;
  readonly targetId: string;
  readonly targetKind: string;
  readonly interactionAnchor: Readonly<Vec2>;
  readonly locomotionTarget: Readonly<Vec2>;
  readonly phase: string;
  readonly phaseProgress: number;
  readonly activeTool: string;
  readonly carriedObject?: string;
  readonly contactStrength: number;
  /** Ephemeral evidence drawn only at real presentation contact; never simulation state. */
  readonly contactEffect?: PhysicalContactEffectKind;
  /** Site-relative surface/platform heights for construction articulation. */
  readonly contactHeight?: number;
  readonly platformHeight?: number;
  readonly blockedReason?: string;
}

/** Same safety precedence as PeopleSystem, also valid between simulation updates. */
export function workInterruption(person: Person, weather?: WeatherCellState, speed = 0): string | undefined {
  if (!person.alive || person.health <= 0.2) return 'inactive';
  if (person.activity === 'flee' || person.activity === 'shelter' || person.navigation?.schedulePhase === 'emergency') return 'emergency';
  if (person.displacedSinceMonth !== undefined) return 'displaced';
  if (person.activity === 'migrate') return 'migration';
  if (weather && (weather.wind > 0.72 || weather.floodDepth > 0.035 || weather.blizzard > 0.5
    || weather.kind === 'heavy-snow' && weather.intensity > 0.65)) return 'unsafe-weather';
  if (person.navigation?.traveling || person.navigation?.schedulePhase === 'commute' || speed >= 0.05) return 'travel';
  return undefined;
}

export function facingTarget(from: Readonly<Vec2>, target: Readonly<Vec2>): number {
  return Math.atan2(target.x - from.x, target.z - from.z);
}

/** No animation phase can establish contact while approaching or turning. */
export function atInteraction(position: Readonly<Vec2>, anchor: Readonly<Vec2>, facing: number, desired: number, speed: number): boolean {
  return speed < 0.05 && Math.hypot(position.x - anchor.x, position.z - anchor.z) < 0.035 && Math.cos(facing - desired) > 0.94;
}
