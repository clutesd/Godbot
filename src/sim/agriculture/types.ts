export type CropArchetype = 'cereal' | 'root' | 'legume' | 'dryland';
export type GrowthStage = 'fallow' | 'prepared' | 'sown' | 'emerging' | 'vegetative' | 'flowering' | 'filling' | 'mature' | 'stubble';
export type FieldAction = 'prepare' | 'sow' | 'tend' | 'irrigate' | 'harvest' | 'recover';
/** Bounded, serializable state per physical plot. Soil fertility is a read-through snapshot of
 * WorldCell.fertility; soil depth/erosion/land-use are owned by the environmental systems. */
export interface AgriculturalField {
  id: string;
  cellIndex: number;
  crop: CropArchetype;
  stage: GrowthStage;
  action: FieldAction;
  evaluatedMonth: number;
  plantedMonth?: number;
  matureMonth?: number;
  harvestedMonth?: number;
  fallowSince?: number;
  fallowMonths: number;
  totalFallowMonths: number;
  lastFallowMonths: number;
  cultivationMonths: number;
  cycles: number;
  previousCrop?: CropArchetype;
  thermalTime: number;
  previousTemperature?: number;
  biomass: number;
  yieldPotential: number;
  health: number;
  soilMoisture: number;
  fertility: number;
  droughtStress: number;
  waterlogging: number;
  frostDamage: number;
  heatDamage: number;
  stormDamage: number;
  irrigationDemand: number;
  irrigationReceived: number;
  harvestRemaining: number;
  production: number;
  labour: number;
}
