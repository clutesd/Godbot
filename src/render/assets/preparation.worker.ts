import { composeBuilding, BUILD_STAGE } from './BuildingComposer';
import type { BuildingGrammar } from './BuildingGrammar';
import { MaterialPalette } from '../materials/MaterialPalette';
import type { CultureStyle } from '../../sim/types';
import type { StructureMaterial } from '../../sim/development/types';
import { deriveDetailTier, type TierOptions } from './DerivedLod';
import type { FacadePlan } from '../architecture/FacadePlan';
import { packGeometry } from './PreparedGeometry';
import { AssetBuilder, type AssetConfig } from './AssetBuilder';
import { packBuilding, buildingTransfers } from './PreparedBuilding';

type Request = { kind: 'lod'; grammar: BuildingGrammar; culture: CultureStyle; seed: string; coreMaterial?: StructureMaterial; tiers: readonly TierOptions[] }
  | { kind: 'building'; config: AssetConfig }
  | { kind: 'svg'; plan: FacadePlan; size: number };
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (message: unknown, transfer: Transferable[]) => void };
scope.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'building') {
      const builder = new AssetBuilder('worker', { backgroundPreparation: false });
      try {
        const building = packBuilding(builder.getAsset('building', data.config).mesh);
        scope.postMessage({ result: building }, [...new Set(buildingTransfers(building))]);
      } finally { builder.dispose(); }
    } else if (data.kind === 'lod') {
      const started = performance.now(), palette = new MaterialPalette({ culture: data.culture, era: data.grammar.era });
      try {
        const coarse = composeBuilding(data.grammar, palette, data.seed, BUILD_STAGE.DETAIL, data.coreMaterial, false);
        let source = coarse.group;
        const tiers = data.tiers.map(options => {
          source = deriveDetailTier(source, options);
          return packGeometry(source);
        });
        const transfer = tiers.flatMap(meshes => meshes.flatMap(m => [...m.attributes.map(a => a.array.buffer as ArrayBuffer), ...(m.index ? [m.index.buffer as ArrayBuffer] : [])]));
        scope.postMessage({ result: { tiers, ms: performance.now() - started } }, [...new Set(transfer)]);
      } finally { palette.dispose(); }
    } else {
      const { rasterArtwork } = await import('./RasterArtwork');
      const images = await rasterArtwork(data.plan, data.size);
      scope.postMessage({ result: images }, images);
    }
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }, []); }
};
