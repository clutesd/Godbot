/** Contact sheet of the seamless material tiles one production building actually uses, each shown
 * 2×2 so repeats and seams are visible. Writes HTML; screenshot it with any Chromium.
 *
 *   npx tsx scripts/perf/svg-tile-sheet.ts <out.html> <archetype> <period> [scenario] [seed] [layer] */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { BROWSER_CATALOGUE } from '../../src/dev/architectureBrowserModel';
import { constructionArtConfig } from '../../src/dev/constructionArtCases';
import { surfaceArtLayout, surfacePanel } from '../../src/render/architecture/SurfaceArtPrograms';
import type { FacadePlan } from '../../src/render/architecture/FacadePlan';
import type { ArchitecturalPeriod } from '../../src/render/architecture/ArchitecturalPeriod';

const [out = 'output/svg-art-review/tiles.html', archetype = 'house', period = 'medieval', scenario = 'auto', seed, layer = 'albedo'] = process.argv.slice(2);
const entry = BROWSER_CATALOGUE.find(e => e.id === archetype);
if (!entry) throw new Error(`Unknown archetype ${archetype}`);
const builder = new AssetBuilder('tile-sheet');
const config = constructionArtConfig(entry, period as ArchitecturalPeriod, scenario);
if (seed) config.seed = seed;
const root = builder.getAsset('building', config).mesh;
const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
const plan = full.userData['facadePlan'] as FacadePlan;
const cells = surfaceArtLayout(plan);
const figures = cells.map(cell => {
  const panel = surfacePanel(plan, { ...cell, x: 0, y: 0 }, layer as 'albedo' | 'relief' | 'surface')
    .replace(/^<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"/, `<svg width="${cell.width + cell.pad * 2}" height="${cell.height + cell.pad * 2}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.width * 2}" height="${cell.height * 2}">${[0, 1].flatMap(i => [0, 1].map(j =>
    `<svg x="${i * cell.width - cell.pad}" y="${j * cell.height - cell.pad}" overflow="hidden" width="${cell.width + cell.pad * 2}" height="${cell.height + cell.pad * 2}">${panel}</svg>`)).join('')}</svg>`;
  return `<figure><img width="440" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><figcaption>${cell.material} · ${cell.tile}u</figcaption></figure>`;
});
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222;color:#ddd;font:13px sans-serif;display:flex;flex-wrap:wrap;gap:6px}figure{margin:4px}</style>${figures.join('')}`);
console.log(cells.map(c => `${c.material} ${c.width}px`).join(', '));
builder.dispose();
