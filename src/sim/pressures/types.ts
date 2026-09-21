import type { Occupation, Vec2 } from '../types';

/** New pressure families can use the same observation contract without owning decisions. */
export interface PressureObservation {
  kind: string;
  intensity: number;
  perceived: number;
  confidence: number;
  affectedPopulation: number;
  location: Vec2;
  observedMonth: number;
  duration: number;
  trend: number;
  urgency: number;
  expectedSeverity: number;
  causes: string[];
  consequences: string[];
  responses: string[];
  evidence: Record<string, number>;
  eventId?: string;
}

export type FoodResponse = 'forage' | 'cultivate' | 'ration' | 'wait';
export interface ResponseExperience {
  attempts: number;
  successes: number;
  preference: number;
  eventId?: string;
}
export interface SurvivalState {
  establishment?: {
    month: number; strength: number; preparedness: number; coldRisk: number;
    coverage: number; permanentCoverage: number; foodUrgency: number; shelterUrgency: number;
    fuelTarget: number; feasibility: number; migration: number;
    choice: 'shelter' | 'finish' | 'fuel' | 'food' | 'migrate' | 'tolerate';
    materialDemand: Record<string, number>;
    constructionLabour: number; gatheringLabour: number; heatingLabour: number;
    constructionByOccupation: Partial<Record<Occupation, number>>;
    heatingByOccupation: Partial<Record<Occupation, number>>;
    winterMemory: number; lastWinterEvent?: number; deficitEvent?: string;
  };
  observations: Partial<Record<'food' | 'cold', PressureObservation>>;
  food?: {
    month: number;
    population: number;
    need: number;
    target: number;
    production: number;
    consumed: number;
    spoiled: number;
    /** Provisional surplus beyond capacity; recomputed when water revises the harvest. */
    overflow: number;
    extraProduction: number;
  };
  /** Accumulated fractional months of missed full nutrition; recovery takes time. */
  deprivation: number;
  exposureDose: number;
  /** Immutable founding milestone. Optional for archives created before first-fire tracking existed. */
  firstFire?: { month: number; eventId: string; plannedMonth?: number; readiness?: number };
  /**
   * Routine communal hearth fuel, distinct from additional cold-weather heating fuel.
   * The ignition plan is fixed when first evaluated so changing weather cannot rewrite history.
   */
  hearth?: {
    fuelNeed: number;
    fuelUsed: number;
    plannedIgnitionMonth?: number;
    ignitionReadiness?: number;
    ignitionRank?: number;
  };
  cold: { severity: number; shelterCoverage: number; fuelNeed: number; fuelUsed: number; exposure: number };
  response?: {
    kind: FoodResponse;
    startedMonth: number;
    untilMonth: number;
    pressureEventId: string;
    eventId: string;
    baselinePressure: number;
    extraProduction: number;
    foodSaved: number;
    labourSpent: number;
  };
  experience: Partial<Record<FoodResponse, ResponseExperience>>;
  nextDecisionMonth: number;
  lastConsequenceMonth: number;
  lastSpecializationMonth: number;
  /** Documentary allocation, also available to presentation/debug consumers. */
  reassignedLabour: number;
  lastResolvedMonth: number;
}
