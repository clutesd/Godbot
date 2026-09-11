export type RockFamily = 'sedimentary' | 'limestone' | 'volcanic' | 'granite' | 'metamorphic';
export interface Geology {
  family: RockFamily;
  exposure: number;
  sediment: number;
  /** Suitability, not an inventory. Future resources still require catalogue/recipe gates. */
  potential: Record<string, number>;
}
export interface Soil {
  depth: number;
  drainage: number;
  retention: number;
  erosionRisk: number;
  parentFertility: number;
  /** Derived once from the existing fine drainage graph; no second water simulation. */
  catchment: number;
  waterAccess: number;
}
export interface ForestCommunity {
  family: 'broadleaf' | 'conifer' | 'riverbank' | 'alpine' | 'dry';
  ageYears: number;
  disturbance: number;
  lastDisturbanceMonth: number;
}
export type ModificationKind = 'logging' | 'farmland' | 'quarry' | 'mine' | 'track' | 'industry' | 'ruin';
export interface LandModification {
  intensity: number;
  firstMonth: number;
  lastMonth: number;
  ownerId?: string;
  abandonedMonth?: number;
}
