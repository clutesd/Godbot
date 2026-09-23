import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CultureStyle, Settlement } from '../../sim/types';
import type { DevelopmentResponse } from '../../sim/development/types';
import { practical } from '../../sim/knowledge/KnowledgeSystem';
import { CultureStyleProfileFactory } from '../style/CultureStyleProfile';
import type { BannerIdentity } from '../style/BannerIdentity';

export type Vessel = 'bowl' | 'cooking-pot' | 'storage-jar' | 'jug' | 'ritual';
export type PotteryFinish = 'greenware' | 'fired' | 'prestige';
export const MAX_POTTERY = 24;
export interface PotteryAnchor {
  key: string; localX: number; localZ: number; width: number; depth: number;
  rotationY: number; role: string; development?: DevelopmentResponse;
}
export interface PotteryPlacement { vessel: Vessel; x: number; z: number; rotation: number; finish?: PotteryFinish }
/** Quantized visual refinement, never an era unlock or a material transaction. */
export function potteryTier(settlement: Settlement): 0 | 1 | 2 | 3 {
  const practice = practical(settlement, 'pottery-firing');
  return !settlement.alive || practice <= 0 ? 0 : practice < 0.45 ? 1 : practice < 0.7 ? 2 : 3;
}
export function potteryStyle(cultureId: string, style: CultureStyle, identity: Pick<BannerIdentity, 'primary' | 'secondary' | 'accent' | 'lineageKey' | 'lineageMarks'>) {
  const profile = CultureStyleProfileFactory.createFromCulture(cultureId, style);
  let hash = 2166136261;
  for (const char of `${cultureId}:${identity.lineageKey}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { primary: identity.primary, secondary: identity.secondary, accent: identity.accent,
    motif: profile.motifFamily, pattern: profile.patternStyle, variant: (hash >>> 0) % 4,
    marks: identity.lineageMarks };
}
export type PotteryStyle = ReturnType<typeof potteryStyle>;

/** Only completed, usable plots are passed by the renderer. Side-of-building clusters keep entrances clear. */
export function planPottery(settlement: Settlement, anchors: readonly PotteryAnchor[], blockers: readonly PotteryAnchor[] = anchors): PotteryPlacement[] {
  const tier = potteryTier(settlement);
  if (!tier) return [];
  const result: PotteryPlacement[] = [];
  let prestige = false;
  const activeCraft = settlement.knownRecipes.includes('pottery-vessels') || (settlement.localMaterials.pottery ?? 0) > 0;
  // Stable plot order survives changes to input iteration order; cap work/output for large cities.
  for (const anchor of [...anchors].sort((a, b) => a.key.localeCompare(b.key))) {
    const form = anchor.development?.form;
    const role = anchor.role;
    const home = form ? form === 'dwelling' : ['hut', 'house', 'compound', 'shelter', 'lean-to'].includes(role);
    const store = form ? form === 'store' : ['granary', 'warehouse', 'store-pit'].includes(role);
    const workshop = form ? form === 'workshop' : role === 'workshop';
    const market = form ? anchor.development?.need === 'trade' && ['gathering', 'hall'].includes(form) : role === 'market';
    if (!home && !store && !workshop && !market) continue;
    const vessels: Vessel[] = home ? ['bowl', 'cooking-pot'] : store ? ['storage-jar', 'storage-jar'] : ['jug', 'bowl', 'storage-jar'];
    if (tier === 3 && (workshop || market) && !prestige) { vessels.push('ritual'); prestige = true; }
    for (let i = 0; i < vessels.length && result.length < MAX_POTTERY; i++) {
      const dx = anchor.width / 2 + 0.4;
      const dz = (i - (vessels.length - 1) / 2) * 0.6;
      const vessel = vessels[i]!;
      const finish: PotteryFinish = vessel === 'ritual' ? 'prestige'
        : workshop && activeCraft && (tier === 1 || i < 2) ? 'greenware' : 'fired';
      const placement: PotteryPlacement = { vessel, x: anchor.localX + Math.cos(anchor.rotationY) * dx + Math.sin(anchor.rotationY) * dz,
        z: anchor.localZ - Math.sin(anchor.rotationY) * dx + Math.cos(anchor.rotationY) * dz, rotation: anchor.rotationY, finish };
      const obstructed = blockers.some(building => {
        const dx = placement.x - building.localX, dz = placement.z - building.localZ;
        const x = Math.cos(building.rotationY) * dx - Math.sin(building.rotationY) * dz;
        const z = Math.sin(building.rotationY) * dx + Math.cos(building.rotationY) * dz;
        return Math.abs(x) < building.width / 2 + 0.3 && Math.abs(z) < building.depth / 2 + 0.3;
      });
      if (!obstructed && !result.some(p => Math.hypot(p.x - placement.x, p.z - placement.z) < 0.55)) result.push(placement);
    }
    if (result.length >= MAX_POTTERY) break;
  }
  return result;
}

const PROFILES: Record<Vessel, readonly (readonly [number, number])[]> = {
  bowl: [[0.07, 0], [0.12, 0.04], [0.21, 0.17], [0.22, 0.2]],
  'cooking-pot': [[0.11, 0], [0.2, 0.1], [0.21, 0.24], [0.15, 0.31]],
  'storage-jar': [[0.12, 0], [0.23, 0.15], [0.24, 0.36], [0.14, 0.48], [0.15, 0.52]],
  jug: [[0.09, 0], [0.18, 0.12], [0.17, 0.3], [0.075, 0.4], [0.085, 0.5]],
  ritual: [[0.15, 0], [0.09, 0.1], [0.11, 0.2], [0.24, 0.37], [0.25, 0.49], [0.2, 0.6]],
};
/** One vertex-coloured mesh per settlement, with shared vessel templates during assembly.
 * No textures, per-frame updates, lights, or unbounded global geometry caches. */
export function createPottery(placements: readonly PotteryPlacement[], style: PotteryStyle, tier: number,
  ground: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cultural-pottery';
  if (!tier || !placements.length) return group;
  const templates = new Map<string, THREE.BufferGeometry>();
  const pieces: THREE.BufferGeometry[] = [];
  for (const placement of placements.slice(0, MAX_POTTERY)) {
    const finish = placement.finish ?? 'fired';
    const templateKey = `${placement.vessel}:${finish}`;
    let template = templates.get(templateKey);
    if (!template) { template = vesselGeometry(placement.vessel, style, tier, finish); templates.set(templateKey, template); }
    const geometry = template.clone();
    geometry.rotateY(placement.rotation);
    geometry.translate(placement.x, ground(placement.x, placement.z) + 0.025, placement.z);
    pieces.push(geometry);
  }
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach(piece => piece.dispose());
  templates.forEach(template => template.dispose());
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: tier === 3 ? 0.62 : 0.95 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData['vesselCount'] = Math.min(MAX_POTTERY, placements.length);
  mesh.userData['greenwareCount'] = placements.slice(0, MAX_POTTERY).filter(p => p.finish === 'greenware').length;
  mesh.userData['finishedCount'] = placements.slice(0, MAX_POTTERY).filter(p => (p.finish ?? 'fired') !== 'greenware').length;
  group.add(mesh);
  return group;
}

function vesselGeometry(vessel: Vessel, style: PotteryStyle, tier: number, finish: PotteryFinish): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const greenware = finish === 'greenware';
  const prestige = finish === 'prestige';
  const clay = new THREE.Color(greenware ? '#bc8767' : '#b77b53')
    .lerp(new THREE.Color(style.primary), greenware ? 0.04 : prestige ? 0.36 : tier === 1 ? 0.1 : 0.28);
  const add = (geometry: THREE.BufferGeometry, colour: THREE.ColorRepresentation) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.deleteAttribute('uv');
    const color = new THREE.Color(colour);
    const values = new Float32Array(flat.getAttribute('position').count * 3);
    for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
    flat.setAttribute('color', new THREE.BufferAttribute(values, 3));
    pieces.push(flat);
  };
  const width = 0.92 + style.variant * 0.065;
  const mature = (tier - 1) / 2;
  const shapeWidth = style.motif === 'woven-moon' ? 1 + mature * 0.12 : style.motif === 'mountain-knot' ? 1 - mature * 0.1 : 1;
  const shapeHeight = style.motif === 'river-eye' ? 1 + mature * 0.15 : style.motif === 'sun-step' ? 1 - mature * 0.08 : 1;
  const profile = PROFILES[vessel].map(([r, y]) => new THREE.Vector2(r * width * shapeWidth, y * shapeHeight));
  const lip = profile[profile.length - 1]!;
  // Return down the inner wall to a closed floor: mouths read as real hollow vessels.
  const shell = [new THREE.Vector2(0, 0), ...profile, new THREE.Vector2(lip.x - 0.026, lip.y),
    ...profile.slice(0, -1).reverse().map(p => new THREE.Vector2(Math.max(0.025, p.x - 0.026), Math.max(0.035, p.y))), new THREE.Vector2(0, 0.035)];
  const body = new THREE.LatheGeometry(shell, tier === 1 ? 7 : 12);
  if (tier === 1) {
    const position = body.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i), y = position.getY(i);
      const wobble = 1 + Math.sin(Math.atan2(z, x) * 3 + style.variant) * 0.055;
      position.setXYZ(i, x * wobble, y * (1 + Math.sin(Math.atan2(z, x) * 2) * 0.025), z * wobble);
    }
    body.computeVertexNormals();
  }
  add(body, clay);
  const ring = (r: number, y: number, tube: number, colour: string) => {
    const g = new THREE.TorusGeometry(r, tube, 4, tier === 1 ? 7 : 12);
    g.rotateX(Math.PI / 2); g.translate(0, y, 0); add(g, colour);
  };
  ring(lip.x - 0.01, lip.y, tier === 3 ? 0.022 : 0.016,
    greenware ? '#916249' : tier === 1 ? '#77523e' : style.accent);
  const shoulder = profile[profile.length - (vessel === 'bowl' ? 1 : 2)]!;
  const radiusAt = (y: number): number => {
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1]!, b = profile[i]!;
      if (y <= b.y) return THREE.MathUtils.lerp(a.x, b.x, THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1));
    }
    return lip.x;
  };
  const band = (y: number, height: number, colour: string) => {
    const points = Array.from({ length: 5 }, (_, i) => {
      const py = y - height / 2 + height * i / 4;
      return new THREE.Vector2(radiusAt(py) + 0.004, py);
    });
    add(new THREE.LatheGeometry(points, 12), colour);
  };
  if (tier >= 2 && !greenware) {
    band(lip.y * 0.78, 0.045, style.primary);
    if (tier === 3) band(lip.y * 0.78 - 0.04, 0.016, style.accent);
    if (vessel === 'cooking-pot') band(0.055, 0.04, '#57443a');
  }
  if (!greenware && vessel === 'storage-jar' && tier >= 2) {
    const lid = new THREE.CylinderGeometry(lip.x * 0.78, lip.x * 0.9, 0.028, tier === 3 ? 12 : 9);
    lid.translate(0, lip.y + 0.016, 0);
    add(lid, clay.clone().multiplyScalar(0.86));
  }
  // Project thick runic strokes onto the vessel wall, so they cannot disappear inside its belly.
  const stroke = (x1: number, y1: number, x2: number, y2: number, angle: number, colour: string) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const dx = -(y2 - y1) / length * 0.009, dy = (x2 - x1) / length * 0.009;
    const corners = [[x1 + dx, y1 + dy], [x1 - dx, y1 - dy], [x2 - dx, y2 - dy], [x2 + dx, y2 + dy]];
    const positions: number[] = [];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y] = corners[i]!;
      const r = radiusAt(y!) + 0.008;
      const theta = angle + x! / r;
      positions.push(Math.sin(theta) * r, y!, Math.cos(theta) * r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
    add(g, colour);
  };
  const patterns: Record<PotteryStyle['pattern'], number[][]> = {
    chevron: [[-0.04, 0.02, 0, -0.02], [0, -0.02, 0.04, 0.02]],
    diamond: [[-0.035, 0, 0, 0.035], [0, 0.035, 0.035, 0], [0.035, 0, 0, -0.035], [0, -0.035, -0.035, 0]],
    terrace: [[-0.04, -0.02, 0, -0.02], [0, -0.02, 0, 0.02], [0, 0.02, 0.04, 0.02]],
    crossweave: [[-0.035, -0.03, 0.035, 0.03], [-0.035, 0.03, 0.035, -0.03]],
    wave: [[-0.04, -0.015, -0.01, 0.02], [-0.01, 0.02, 0.04, -0.015]],
  };
  const strokes = greenware ? 0 : tier === 1 ? 3 : prestige ? 8 : 6;
  const markY = lip.y * 0.53;
  for (let i = 0; i < strokes; i++) {
    const angle = i / strokes * Math.PI * 2;
    const marks = tier === 1 ? [[-0.018, -0.015, 0.018, 0.015]] : patterns[style.pattern];
    for (const [x1, y1, x2, y2] of marks) stroke(x1!, markY + y1!, x2!, markY + y2!, angle, tier === 1 ? '#634536' : style.secondary);
  }
  if (vessel === 'jug' || vessel === 'cooking-pot' || vessel === 'ritual') {
    const handles = vessel === 'jug' ? [1] : [-1, 1];
    for (const side of handles) {
      const g = new THREE.TorusGeometry(vessel === 'jug' ? 0.105 : 0.075, 0.024, 4, 8);
      g.scale(0.72, vessel === 'jug' ? 1.35 : 0.8, 1);
      g.translate(side * (vessel === 'jug' ? Math.max(...profile.map(p => p.x)) : shoulder.x), lip.y * 0.62, 0);
      add(g, !greenware && tier === 3 ? style.primary : clay);
    }
  }
  if (tier === 3 && !greenware) {
    // Culture's architectural symbol becomes a bold maker's seal on both visible faces.
    const shapes: Record<PotteryStyle['motif'], number[]> = {
      'sun-step': [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4],
      'river-eye': [0.65, -0.65, Math.PI / 2], 'woven-moon': [-0.6, 0, 0.6],
      'mountain-knot': [-0.65, 0.65], 'seed-spiral': [0, Math.PI / 2, -0.65],
    };
    for (const face of [Math.PI / 2, -Math.PI / 2]) for (const [index, angle] of shapes[style.motif].entries()) {
      const x = (index % 2 ? 1 : -1) * 0.022;
      const dx = Math.sin(angle) * 0.048, dy = Math.cos(angle) * 0.048;
      stroke(x - dx, markY - dy, x + dx, markY + dy, face, style.accent);
    }
    for (let i = 0; i < style.marks; i++) ring(profile[0]!.x + 0.008, 0.025 + i * 0.022, 0.008, style.secondary);
    if (vessel === 'ritual') {
      const foot = new THREE.CylinderGeometry(profile[0]!.x * 0.82, profile[0]!.x, 0.04, 12);
      foot.translate(0, 0.02, 0);
      add(foot, style.secondary);
    }
  }
  const merged = mergeGeometries(pieces)!;
  pieces.forEach(piece => piece.dispose());
  return merged;
}
