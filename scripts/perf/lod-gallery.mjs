/** Adds the architectural fidelity pass (LOD tiers, in-game LOD, structure fixes) to the top of the
 * SVG art review gallery at output/svg-art-review/index.html. Idempotent: replaces its own section.
 *
 *   node scripts/perf/lod-gallery.mjs */
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';

const root='output/svg-art-review',page=`${root}/index.html`;
const START='<!--fidelity-pass-->',END='<!--/fidelity-pass-->';
const list=dir=>existsSync(`${root}/${dir}`)?readdirSync(`${root}/${dir}`).filter(f=>f.endsWith('.jpg')).sort():[];
const img=(src,caption)=>existsSync(`${root}/${src}`)?`<div>${caption??src}</div><img loading=lazy src="${src}">`:'';
const pairs=(title,note,items)=>`<h3>${title}</h3>${note?`<p>${note}</p>`:''}${items.map(([b,a,c])=>img(b,`before · ${c}`)+img(a,`after · ${c}`)).join('')}`;

let html=`${START}<h1>Architectural fidelity pass (2026-10-15)</h1>
<p>Distance tiers are now the building itself with sub-pixel parts removed, in the same SVG-decorated materials, plus a skyline tier.
LOD sheets show every tier side by side from one camera; "near" magnifies a tier so its construction is legible, "settlement" is the range it is used at.</p>`;
html+='<h2>In the running game: every building full detail | automatic tiers</h2>'+list('lod-game').map(f=>img(`lod-game/${f}`)).join('');
const cases=[...new Set(list('lod-after').map(f=>f.replace(/-(near|settlement|roof)\.jpg$/,'').replace(/-(street|settlement)\.jpg$/,'')))];
html+='<h2>LOD tiers: before (old massing boxes) | after (derived tiers)</h2>';
for(const c of cases)for(const v of ['near','settlement','street']){
  const after=`lod-after/${c}-${v}.jpg`,before=`lod-before/${c}-${v}.jpg`;
  if(existsSync(`${root}/${after}`))html+=(existsSync(`${root}/${before}`)?img(before,`before · ${c} ${v}`):'')+img(after,`after · ${c} ${v}`);
}
html+='<h2>LOD tiers under other light</h2>'+['lod-raking','lod-night'].flatMap(d=>list(d).map(f=>img(`${d}/${f}`))).join('');
html+=pairs('Structure fixes','Same case, seed and camera as the matrix capture before this pass.',[
  ['matrix/bridge-earlyModern-stone-overview.jpg','pass2/bridge-earlyModern-stone-overview.jpg','masonry bridge: real segmental arches, voussoirs, cutwaters, string course, coping'],
  ['matrix/bridge-neolithic-auto-overview.jpg','pass2/bridge-neolithic-auto-overview.jpg','timber bridge (unchanged geometry, parapet scale)'],
  ['matrix/factory-modern-stone-face.jpg','pass2/factory-modern-stone-face.jpg','industrial culture band: black strip replaced by a moulded masonry frieze'],
  ['matrix/factory-industrial-brick-face.jpg','pass2/factory-industrial-brick-face.jpg','industrial brick'],
  ['matrix/boundary_wall-earlyModern-stone-face.jpg','pass2/boundary_wall-earlyModern-stone-face.jpg','long rubble wall: each levelled lift shifted, no recurring stones'],
  ['matrix/boundary_wall-earlyModern-stone-overview.jpg','pass2/boundary_wall-earlyModern-stone-overview.jpg','rubble wall overview'],
]);
html+=END;
const current=readFileSync(page,'utf8');
const stripped=current.includes(START)?current.slice(0,current.indexOf(START))+current.slice(current.indexOf(END)+END.length):current;
const at=stripped.indexOf('<h1>');
writeFileSync(page,stripped.slice(0,at)+html+stripped.slice(at));
console.log('gallery updated',html.length);
