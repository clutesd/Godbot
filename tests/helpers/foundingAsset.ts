import type { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../../src/render/assets/BuildStages';
import type { DevelopmentResponse } from '../../src/sim/development/types';

/** Tests and previews use the same completed target as the live construction assembly. */
export function foundingAsset(builder: AssetBuilder, response: DevelopmentResponse) {
  return builder.getAsset('building', {
    seed: 'founding-canonical-target', culture: response.style, era: 'primitive',
    variant: `house#${BUILD_STAGE.DETAIL}`, development: response,
  }).mesh;
}
