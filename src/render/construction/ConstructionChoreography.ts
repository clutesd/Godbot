import type { StructureMaterial } from '../../sim/development/types';
import { BUILD_STAGE, BUILD_STAGE_ORDER, type BuildStage } from '../assets/BuildingComposer';
import { constructionStagePresentation } from './ConstructionVisualGrammar';

export type ConstructionAssemblyMotion = 'fasten' | 'place' | 'pack' | 'fit';
export type ConstructionPrepMotion = 'cut' | 'dress' | 'sort' | 'shape';

export interface ConstructionChoreographyProfile {
  material: StructureMaterial;
  stage: BuildStage;
  stageName: string;
  finishing: boolean;
  assemblerVerb: string;
  prepVerb: string;
  assemblerTool: 'hammer' | 'none';
  prepTool: 'axe' | 'hammer' | 'none';
  assemblyMotion: ConstructionAssemblyMotion;
  prepMotion: ConstructionPrepMotion;
}

/**
 * Pure presentation vocabulary for Step 2B. The authoritative project progress still comes from
 * SettlementDevelopmentSystem; this only tells articulated workers how that paid stage should read.
 */
export function constructionChoreography(
  material: StructureMaterial,
  progress: number,
): ConstructionChoreographyProfile {
  const presentation = constructionStagePresentation(progress);
  const stage = presentation.stage;
  const stageName = BUILD_STAGE_ORDER[stage] ?? 'complete';
  const phase = stage === BUILD_STAGE.FOUNDATION ? 'foundation'
    : stage === BUILD_STAGE.FRAME ? 'frame'
      : stage === BUILD_STAGE.WALLS ? 'walls'
        : stage === BUILD_STAGE.ROOF ? 'roof'
          : 'detail';

  if (material === 'timber') return {
    material, stage, stageName, finishing: presentation.finishing,
    assemblerVerb: presentation.finishing ? 'finish-joinery'
      : phase === 'foundation' ? 'set-sill'
        : phase === 'frame' ? 'fasten-frame'
          : phase === 'walls' ? 'fasten-boards'
            : phase === 'roof' ? 'fix-rafters' : 'finish-joinery',
    prepVerb: presentation.finishing ? 'trim-finish'
      : phase === 'foundation' ? 'cut-sill'
        : phase === 'frame' ? 'cut-frame'
          : phase === 'walls' ? 'trim-boards'
            : phase === 'roof' ? 'cut-rafter' : 'trim-finish',
    assemblerTool: 'hammer', prepTool: 'axe', assemblyMotion: 'fasten', prepMotion: 'cut',
  };

  if (material === 'masonry') return {
    material, stage, stageName, finishing: presentation.finishing,
    assemblerVerb: presentation.finishing ? 'finish-stone'
      : phase === 'foundation' ? 'bed-foundation-stone'
        : phase === 'frame' ? 'seat-lintel'
          : phase === 'walls' ? 'lay-stone-course'
            : phase === 'roof' ? 'seat-roof-stone' : 'finish-stone',
    prepVerb: presentation.finishing ? 'dress-finish-stone' : 'dress-stone',
    assemblerTool: 'hammer', prepTool: 'hammer', assemblyMotion: 'place', prepMotion: 'dress',
  };

  if (material === 'ceramic') return {
    material, stage, stageName, finishing: presentation.finishing,
    assemblerVerb: presentation.finishing ? 'finish-brickwork'
      : phase === 'foundation' ? 'bed-brick'
        : phase === 'frame' ? 'set-brick-opening'
          : phase === 'walls' ? 'lay-brick-course'
            : phase === 'roof' ? 'seat-roof-tile' : 'finish-brickwork',
    prepVerb: presentation.finishing ? 'sort-finish-units' : 'sort-brick',
    assemblerTool: 'none', prepTool: 'none', assemblyMotion: 'place', prepMotion: 'sort',
  };

  if (material === 'metal') return {
    material, stage, stageName, finishing: presentation.finishing,
    assemblerVerb: presentation.finishing ? 'final-fit-metal'
      : phase === 'foundation' ? 'seat-baseplate'
        : phase === 'frame' ? 'fit-frame-metal'
          : phase === 'walls' ? 'fasten-metal-panel'
            : phase === 'roof' ? 'fix-metal-roof' : 'final-fit-metal',
    prepVerb: presentation.finishing ? 'align-finish-metal' : 'prepare-metal',
    assemblerTool: 'hammer', prepTool: 'hammer', assemblyMotion: 'fit', prepMotion: 'dress',
  };

  return {
    material, stage, stageName, finishing: presentation.finishing,
    assemblerVerb: presentation.finishing ? 'smooth-earth-finish'
      : phase === 'foundation' ? 'pack-foundation-earth'
        : phase === 'frame' ? 'shape-earth-support'
          : phase === 'walls' ? 'ram-earth-wall'
            : phase === 'roof' ? 'seal-earth-roof' : 'smooth-earth-finish',
    prepVerb: presentation.finishing ? 'mix-finish-earth' : 'prepare-earth',
    assemblerTool: 'none', prepTool: 'none', assemblyMotion: 'pack', prepMotion: 'shape',
  };
}

export function constructionMaterialColour(material: StructureMaterial | undefined): string {
  return material === 'earth' ? '#8b6d4d'
    : material === 'timber' ? '#987149'
      : material === 'masonry' ? '#898576'
        : material === 'ceramic' ? '#a7654d'
          : material === 'metal' ? '#6f7882' : '#898576';
}
