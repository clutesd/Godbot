export interface GodboxConfig {
  readonly engineVersion: string;
  readonly seed: string;
  readonly startingPopulation: number;
  readonly settlementCount: readonly [number, number];
  readonly simulation: {
    readonly maxTicksPerFrame: number;
    readonly populationSoftCap: number;
    readonly historyLimit: number;
  };
  readonly world: {
    readonly size: number;
    readonly cellSize: number;
    readonly seaLevel: number;
    readonly mountainLevel: number;
    readonly noiseScale: number;
    readonly resourceAbundance: number;
    readonly climateVariability: number;
  };
  readonly camera: {
    readonly shotSeconds: readonly [number, number];
    readonly transitionSeconds: number;
    readonly eventBias: number;
  };
  readonly presentation: {
    readonly quietMonthsPerSecond: number;
    readonly ordinaryMonthsPerSecond: number;
    readonly significantMonthsPerSecond: number;
    readonly momentousMonthsPerSecond: number;
    readonly personalMonthsPerSecond: number;
    readonly transitionSeconds: number;
    readonly quietRampSeconds: number;
    readonly eventMemoryMonths: number;
    /** Quiet, structurally simple worlds advance through deep time up to this much faster. */
    readonly deepTimeAcceleration: number;
  };
  readonly experiment: {
    readonly runYears: number;
    readonly autoNextRun: boolean;
    readonly intermissionSeconds: number;
    readonly resumeOngoing: boolean;
  };
  readonly society: {
    readonly contactRate: number;
    readonly tradeConnectivity: number;
    readonly conflictRate: number;
    readonly politicalIntegration: number;
    readonly politicalFragmentation: number;
  };
  readonly historicalPace: {
    readonly generationYears: number;
    readonly minimumRegimeYears: number;
    readonly polityConsolidationYears: number;
    readonly polityMaturityYears: number;
    readonly settlementDeclineYears: number;
    readonly smallConstructionMonths: number;
    readonly infrastructureStep: number;
    readonly adoptionTheory: number;
    readonly adoptionPractice: number;
    readonly transformationPractice: number;
    readonly industrialStageYears: number;
  };
  readonly render: {
    readonly maxPixelRatio: number;
    readonly visualDensity: number;
    readonly structuralUpdatesPerSecond: number;
  };
  readonly audio: {
    readonly enabled: boolean;
    readonly basePath: string;
    readonly crossfadeSeconds: number;
    readonly masterVolume: number;
    readonly ambienceVolume: number;
    readonly musicVolume: number;
    readonly eventVolume: number;
    readonly voiceVolume: number;
    readonly ducking: number;
  };
  readonly knowledge: {
    readonly discoveryRate: number;
    readonly lossRate: number;
    readonly diffusionRate: number;
    readonly industrializationDifficulty: number;
  };
  readonly advanced: {
    readonly developmentRate: number;
    readonly riskRate: number;
    readonly statisticalPopulationCap: number;
    readonly planetaryStabilityYears: number;
    readonly collapseSustainYears: number;
  };
  readonly autoRun: boolean;
}

export type GodboxConfigInput = Omit<Partial<GodboxConfig>, 'simulation' | 'world' | 'camera' | 'presentation' | 'experiment' | 'society' | 'historicalPace' | 'render' | 'audio' | 'knowledge' | 'advanced'> & {
  readonly simulation?: Partial<GodboxConfig['simulation']>;
  readonly world?: Partial<GodboxConfig['world']>;
  readonly camera?: Partial<GodboxConfig['camera']>;
  readonly presentation?: Partial<GodboxConfig['presentation']>;
  readonly experiment?: Partial<GodboxConfig['experiment']>;
  readonly society?: Partial<GodboxConfig['society']>;
  readonly historicalPace?: Partial<GodboxConfig['historicalPace']>;
  readonly render?: Partial<GodboxConfig['render']>;
  readonly audio?: Partial<GodboxConfig['audio']>;
  readonly knowledge?: Partial<GodboxConfig['knowledge']>;
  readonly advanced?: Partial<GodboxConfig['advanced']>;
};

export const DEFAULT_CONFIG: GodboxConfig = {
  engineVersion: 'godbox-sim-0.9.0',
  seed: 'witness-the-saffron-river',
  startingPopulation: 360,
  settlementCount: [5, 7],
  simulation: {
    maxTicksPerFrame: 12,
    populationSoftCap: 2600,
    historyLimit: 50_000,
  },
  world: {
    size: 52,
    cellSize: 2.25,
    seaLevel: 0.34,
    mountainLevel: 0.72,
    noiseScale: 0.075,
    resourceAbundance: 1,
    climateVariability: 0.82,
  },
  camera: {
    shotSeconds: [14, 24],
    transitionSeconds: 6.5,
    eventBias: 0.72,
  },
  presentation: {
    quietMonthsPerSecond: 6,
    ordinaryMonthsPerSecond: 2,
    significantMonthsPerSecond: 0.6,
    momentousMonthsPerSecond: 0.3,
    personalMonthsPerSecond: 0.8,
    transitionSeconds: 5,
    quietRampSeconds: 45,
    eventMemoryMonths: 18,
    deepTimeAcceleration: 6,
  },
  experiment: {
    runYears: 300_000,
    autoNextRun: true,
    intermissionSeconds: 8,
    resumeOngoing: true,
  },
  society: {
    contactRate: 1,
    tradeConnectivity: 1,
    conflictRate: 1,
    politicalIntegration: 1,
    politicalFragmentation: 1,
  },
  historicalPace: {
    generationYears: 27,
    minimumRegimeYears: 30,
    polityConsolidationYears: 45,
    polityMaturityYears: 90,
    settlementDeclineYears: 12,
    smallConstructionMonths: 18,
    // Physical capital (roads, workshops, archives, rail) accumulates over generations.
    infrastructureStep: 0.014,
    adoptionTheory: 0.5,
    adoptionPractice: 0.42,
    transformationPractice: 0.68,
    industrialStageYears: 12,
  },
  render: {
    maxPixelRatio: 1.5,
    visualDensity: 1,
    structuralUpdatesPerSecond: 4,
  },
  audio: {
    enabled: true,
    basePath: '/audio/',
    crossfadeSeconds: 3.5,
    masterVolume: 0.55,
    ambienceVolume: 0.72,
    musicVolume: 0.58,
    eventVolume: 0.76,
    voiceVolume: 0.9,
    ducking: 0.38,
  },
  knowledge: {
    discoveryRate: 1,
    lossRate: 1,
    diffusionRate: 1,
    industrializationDifficulty: 1,
  },
  advanced: {
    developmentRate: 1,
    riskRate: 1,
    statisticalPopulationCap: 12_000_000_000,
    planetaryStabilityYears: 300,
    collapseSustainYears: 60,
  },
  autoRun: true,
};

export function configWith(overrides: GodboxConfigInput = {}): GodboxConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    simulation: { ...DEFAULT_CONFIG.simulation, ...overrides.simulation },
    world: { ...DEFAULT_CONFIG.world, ...overrides.world },
    camera: { ...DEFAULT_CONFIG.camera, ...overrides.camera },
    presentation: { ...DEFAULT_CONFIG.presentation, ...overrides.presentation },
    experiment: { ...DEFAULT_CONFIG.experiment, ...overrides.experiment },
    society: { ...DEFAULT_CONFIG.society, ...overrides.society },
    historicalPace: { ...DEFAULT_CONFIG.historicalPace, ...overrides.historicalPace },
    render: { ...DEFAULT_CONFIG.render, ...overrides.render },
    audio: { ...DEFAULT_CONFIG.audio, ...overrides.audio },
    knowledge: { ...DEFAULT_CONFIG.knowledge, ...overrides.knowledge },
    advanced: { ...DEFAULT_CONFIG.advanced, ...overrides.advanced },
  };
}
