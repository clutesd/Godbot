/** SVG artwork size and generation time per representative building. */
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { BROWSER_CATALOGUE } from '../../src/dev/architectureBrowserModel';
import { constructionArtConfig } from '../../src/dev/constructionArtCases';
import { facadeArtwork } from '../../src/render/architecture/FacadeSvg';
import type { FacadePlan } from '../../src/render/architecture/FacadePlan';
for (const [a, p, s] of [['house', 'medieval', 'timber'], ['house', 'neolithic', 'auto'], ['factory', 'industrial', 'brick'], ['civic-hall', 'classical', 'stone'], ['warehouse', 'industrial', 'metal'], ['windmill', 'earlyModern', 'auto']] as const) {
  const b = new AssetBuilder('size');
  const root = b.getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === a)!, p, s)).mesh;
  const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
  const plan = full.userData['facadePlan'] as FacadePlan;
  const t = performance.now(); const art = facadeArtwork(plan); const ms = performance.now() - t;
  console.log(a, p, s, Object.entries(art).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}:${((v as string).length / 1024).toFixed(0)}k`).join(' '), `${ms.toFixed(0)}ms`);
  b.dispose();
}
