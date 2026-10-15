/**
 * Before/after evidence for the architecture lifecycle repair, from production AssetBuilder meshes.
 *
 *   npx tsx scripts/architecture-lifecycle-preview.ts && python scripts/render-architecture-lifecycle-preview.py
 *
 * Every row shares one camera scale, so panel sizes are directly comparable. "Before" panels
 * reproduce the removed behaviour exactly: the old condition squash/tilt, the old level-only
 * presentation era, routing without the recorded fact, and no upgrade envelope or fit floor.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { AssetBuilder, type AssetConfig } from '../src/render/assets/AssetBuilder';
import { developmentBuildingRole, developmentPresentationEra, priorFabricGeneration } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { peakStructureLevel, structureFit, upgradeFit } from '../src/render/assets/StructureFit';
import { applyStructuralDeterioration, conditionBand } from '../src/render/architecture/StructuralDeterioration';
import type { BuildingArchetype } from '../src/render/architecture/BuildingArchetype';
import type { Era } from '../src/render/materials/MaterialPalette';
import type { DevelopmentResponse, SettlementNeed, StructureForm } from '../src/sim/development/types';
import type { CultureStyle } from '../src/sim/types';

const CULTURE: CultureStyle = { primary: '#a8553a', secondary: '#2d3a5c', accent: '#d8a943', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ka', 'ru'] };
const builder = new AssetBuilder('lifecycle-preview');

function response(o: Partial<DevelopmentResponse>): DevelopmentResponse {
  return { need: 'housing', form: 'dwelling', name: 'preview', level: 1, material: 'timber', cultureId: 'c', style: CULTURE, services: {}, reasons: [],
    capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1, ...o };
}
/** The level-only era the renderer used before construction technique was recorded. */
const levelEra = (d: DevelopmentResponse): Era => d.form === 'works' ? 'industrial' : d.level === 3 ? 'preIndustrial' : d.level === 2 ? 'village' : 'early';

interface Placed { object: THREE.Object3D; label: string }

function asset(config: Partial<AssetConfig> & { development: DevelopmentResponse }): THREE.Object3D {
  const role = developmentBuildingRole(config.development);
  return builder.getAsset('building', { seed: 'preview', culture: CULTURE, era: developmentPresentationEra(config.development),
    variant: `${role}#${BUILD_STAGE.DETAIL}`, ...config }).mesh;
}
function place(mesh: THREE.Object3D, fit: number, label: string): Placed {
  const object = mesh.clone(true);
  object.scale.setScalar(fit);
  return { object, label };
}
const mass = (mesh: THREE.Object3D) => ({ width: Number(mesh.userData['massWidth'] ?? 1), depth: Number(mesh.userData['massDepth'] ?? 1), height: Number(mesh.userData['buildingHeight'] ?? 1) });
function fitOn(mesh: THREE.Object3D, plot: number, level?: number): number {
  const m = mass(mesh);
  return structureFit({ plotWidth: plot, plotDepth: plot * 0.82, massWidth: m.width, massDepth: m.depth, level });
}

const rows: { title: string; panels: Placed[] }[] = [];

// 1. Deterioration.
{
  const hall = response({ need: 'government', form: 'hall', level: 2, material: 'masonry', technology: ['leverage', 'stone-composites'] });
  const plot = 4;
  const conditions = [1, 0.75, 0.5, 0.25, 0];
  const pristine = asset({ development: hall });
  const fit = fitOn(pristine, plot, 2);
  rows.push({ title: 'Condition - before (vertical squash and tilt)', panels: conditions.map(c => {
    const p = place(pristine, fit, `condition ${c}`);
    p.object.scale.y *= 0.12 + c * 0.88; p.object.rotation.z += (1 - c) * 0.12;
    return p;
  }) });
  rows.push({ title: 'Condition - after (weathering, lost components, debris; size kept)', panels: conditions.map(c => {
    const band = conditionBand(c);
    const p = place(asset({ development: hall, condition: band }), fit, `condition ${c}`);
    applyStructuralDeterioration(p.object, band, 'preview-hall');
    return p;
  }) });
}

// 2. Upgrade ladders on an unchanged small plot.
for (const [need, forms, technology, plot] of [
  ['housing', ['dwelling', 'dwelling', 'dwelling'], ['leverage', 'stone-composites'], 2.2],
  ['manufacturing', ['workshop', 'workshop', 'works'], ['precision-tools', 'mechanical-power'], 1.4],
] as const) {
  const before: Placed[] = [], after: Placed[] = [];
  const history: NonNullable<DevelopmentResponse & { history: unknown[] }>['history'] = [];
  const origin = { month: 0, action: 'founded', name: 'x', need, cultureId: 'c', reasons: [], level: 1, form: forms[0], material: 'timber', technology: [...technology] };
  for (const level of [1, 2, 3]) {
    const material = level === 3 ? 'masonry' : 'timber';
    const plain = response({ need: need as SettlementNeed, form: forms[level - 1] as StructureForm, level, material, technology: [...technology] });
    const old = asset({ development: plain, era: levelEra(plain) });
    before.push(place(old, fitOn(old, plot, level), `level ${level}`));
    const lived = { ...plain, origin, history: [...history], status: 'active', transitionCount: history.length, lastUsedMonth: 0 } as unknown as DevelopmentResponse;
    const now = asset({ development: lived });
    const extents = (d: DevelopmentResponse): { width: number; depth: number; height: number } => {
      const m = asset({ development: d }); const prior = priorFabricGeneration(d);
      const f = upgradeFit(fitOn(m, plot, peakStructureLevel(d)), mass(m), prior ? extents(prior) : undefined);
      const mm = mass(m); return { width: mm.width * f, depth: mm.depth * f, height: mm.height * f };
    };
    const prior = priorFabricGeneration(lived);
    after.push(place(now, upgradeFit(fitOn(now, plot, peakStructureLevel(lived)), mass(now), prior ? extents(prior) : undefined), `level ${level}`));
    if (level < 3) history.push({ month: (level + 1) * 12, action: forms[level] === forms[level - 1] ? 'expanded' : 'upgraded', name: 'x', need, cultureId: 'c',
      reasons: [], level: level + 1, form: forms[level], material: level + 1 === 3 ? 'masonry' : 'timber', technology: [...technology] } as never);
  }
  rows.push({ title: `${need} upgrades on one plot - before`, panels: before });
  rows.push({ title: `${need} upgrades on one plot - after (built out from the old envelope)`, panels: after });
}

// 3. The same simulation responses, before and after the routing/era repair.
const pathways: { label: string; development: DevelopmentResponse; energyKind?: 'windmill'; before: BuildingArchetype | undefined; seed?: string }[] = [
  { label: 'L1 house, industrial builders', development: response({ technology: ['standardized-parts', 'thermodynamics'] }), before: undefined },
  { label: 'L3 court, automation builders', development: response({ level: 3, material: 'metal', technology: ['automation', 'computation'] }), before: undefined },
  { label: 'L3 store, industrial builders', development: response({ need: 'food', form: 'store', level: 3, material: 'masonry', technology: ['standardized-parts', 'mechanical-power'] }), before: undefined },
  { label: 'powered sawmill body', development: response({ need: 'manufacturing', form: 'works', level: 2, facilityFamily: 'wood', facilityTier: 2, technology: ['rotary-machinery'] } as never), before: 'factory' },
  { label: 'hand-milled grain store', development: response({ need: 'food', form: 'store', reasons: ['hand-milled-grain'] }), before: 'granary', seed: 'preview:6' },
  { label: 'perimeter defence', development: response({ need: 'security', form: 'tower', level: 2, material: 'masonry', reasons: ['perimeter-defence'], technology: ['leverage', 'stone-composites'] }), before: 'gatehouse' },
  { label: 'windmill, timber grain store', development: response({ need: 'food', form: 'store', level: 3, material: 'timber', technology: ['mechanical-power'] }), energyKind: 'windmill', before: 'windmill' },
  { label: 'windmill at water works', development: response({ need: 'water', form: 'store', level: 2, material: 'timber', technology: ['mechanical-power'] }), energyKind: 'windmill', before: 'windmill' },
];
{
  const before: Placed[] = [], after: Placed[] = [];
  for (const path of pathways) {
    const plain = { ...path.development, technology: undefined };
    const seed = path.seed ?? 'preview';
    const old = asset({ seed, development: plain, era: levelEra(plain), ...(path.energyKind ? { archetype: 'factory', variant: 'energy#7' } : {}),
      // Before the repair a windmill was a windmill wherever it stood; route it explicitly as such.
      ...(path.before ? { archetype: path.before } : {}) });
    const now = asset({ seed, development: path.development, ...(path.energyKind ? { energyKind: path.energyKind, archetype: 'factory', variant: 'energy#7' } : {}) });
    const label = (mesh: THREE.Object3D) => `${path.label}: ${(mesh.userData['buildingSpec'] as { archetype: string; period: string } | undefined)?.archetype}/${(mesh.userData['buildingSpec'] as { period: string } | undefined)?.period}`;
    before.push(place(old, fitOn(old, 4), label(old)));
    after.push(place(now, fitOn(now, 4), label(now)));
  }
  rows.push({ title: 'Same responses - before (level-only era, unrouted subtypes)', panels: before });
  rows.push({ title: 'Same responses - after (recorded technique and facts)', panels: after });
}

// Project every row with one shared orthographic camera.
const out = rows.map(row => {
  const box = new THREE.Box3();
  for (const p of row.panels) { p.object.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(p.object, true)); }
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) * 1.25;
  return { title: row.title, panels: row.panels.map(p => {
    const root = p.object instanceof THREE.LOD ? p.object.levels[0]!.object : p.object;
    const own = new THREE.Box3().setFromObject(p.object, true);
    const centre = new THREE.Vector3((own.min.x + own.max.x) / 2, box.min.y + size.y / 2, (own.min.z + own.max.z) / 2);
    const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, -100, 100);
    camera.position.copy(centre).add(new THREE.Vector3(4, 2.6, 5).normalize().multiplyScalar(20));
    camera.lookAt(centre); camera.updateMatrixWorld();
    const shapes: { xy: number[]; depths: number[]; z: number; color: string }[] = [];
    const visit = (o: THREE.Object3D) => {
      if (o instanceof THREE.LOD) { visit(o.levels[0]!.object); return; }
      if (o instanceof THREE.Mesh && o.userData['surface'] !== 'shadow') {
        const position = o.geometry.getAttribute('position'), index = o.geometry.index;
        const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
        const base = material?.color ?? new THREE.Color('#bbbbbb');
        for (let i = 0; i < (index?.count ?? position.count); i += 3) {
          const pts = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(o.matrixWorld));
          const n = pts[1]!.clone().sub(pts[0]!).cross(pts[2]!.clone().sub(pts[0]!)).normalize();
          const light = 0.45 + 0.55 * Math.max(0, n.dot(new THREE.Vector3(-0.4, 1, 0.6).normalize()));
          const pr = pts.map(v => v.project(camera));
          const c = base.clone().multiplyScalar(light);
          shapes.push({ xy: pr.flatMap(v => [(v.x + 1) * 140, (1 - v.y) * 140]), depths: pr.map(v => v.z), z: 0,
            color: `rgb(${Math.round(Math.min(1, c.r) * 255)},${Math.round(Math.min(1, c.g) * 255)},${Math.round(Math.min(1, c.b) * 255)})` });
        }
      }
      for (const child of o.children) visit(child);
    };
    p.object.updateMatrixWorld(true);
    visit(root === p.object ? p.object : p.object);
    const extent = own.getSize(new THREE.Vector3());
    return { label: p.label, shapes, extent: extent.toArray().map(v => Number(v.toFixed(3))) };
  }) };
});
mkdirSync('docs/architecture-lifecycle', { recursive: true });
writeFileSync('output/architecture-lifecycle-preview.json', JSON.stringify(out));
writeFileSync('docs/architecture-lifecycle/preview-extents.json', JSON.stringify(out.map(r => ({ title: r.title, panels: r.panels.map(p => ({ label: p.label, extent: p.extent })) })), null, 2));
builder.dispose();
