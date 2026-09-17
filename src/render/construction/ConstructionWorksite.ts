import * as THREE from 'three';
import type { DevelopmentResponse, StructureMaterial } from '../../sim/development/types';
import type { MaterialPalette } from '../materials/MaterialPalette';

export interface ConstructionWorksiteSpec {
  width: number;
  depth: number;
  progress: number;
  response?: DevelopmentResponse;
  seedKey: string;
}

/**
 * Presentation-only dressing for an active construction plot.
 *
 * The simulation remains authoritative for whether a project exists, what it is made from,
 * and how far it has progressed. This module only makes those facts visually legible: a cleared
 * work pad, staged materials, and simple site furniture around the footprint. Nothing here
 * creates inventory, labour, or construction progress.
 */
export function createConstructionWorksite(
  spec: ConstructionWorksiteSpec,
  palette: MaterialPalette,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `construction-worksite:${spec.seedKey}`;
  group.userData['constructionWorksite'] = true;

  const width = Math.max(0.9, spec.width);
  const depth = Math.max(0.8, spec.depth);
  const progress = clamp01(spec.progress);
  const material = spec.response?.material ?? 'timber';

  addWorkPad(group, width, depth, palette);
  addMaterialStaging(group, width, depth, material, progress, palette, spec.seedKey);
  addSawhorses(group, width, depth, palette);
  addBoundaryMarkers(group, width, depth, palette);

  return group;
}

function addWorkPad(group: THREE.Group, width: number, depth: number, palette: MaterialPalette): void {
  // A visibly larger disturbed-earth rectangle makes the site readable from a documentary camera
  // before the viewer can resolve individual scaffold poles or workers.
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.42, 0.018, depth * 1.48),
    palette.getSurfaceMaterial('ground'),
  );
  pad.position.y = 0.009;
  pad.receiveShadow = true;
  pad.userData['constructionCue'] = 'work-pad';
  group.add(pad);

  // A narrow perimeter strip separates an intentional worksite from an ordinary dirt clearing.
  const stripMaterial = palette.getSurfaceMaterial('timber');
  const railThickness = 0.035;
  const railHeight = 0.025;
  const longRail = new THREE.BoxGeometry(width * 1.48, railHeight, railThickness);
  const shortRail = new THREE.BoxGeometry(railThickness, railHeight, depth * 1.54);
  for (const z of [-depth * 0.77, depth * 0.77]) {
    const rail = new THREE.Mesh(longRail, stripMaterial);
    rail.position.set(0, railHeight * 0.5 + 0.012, z);
    rail.castShadow = true;
    group.add(rail);
  }
  for (const x of [-width * 0.74, width * 0.74]) {
    const rail = new THREE.Mesh(shortRail, stripMaterial);
    rail.position.set(x, railHeight * 0.5 + 0.012, 0);
    rail.castShadow = true;
    group.add(rail);
  }
}

function addMaterialStaging(
  group: THREE.Group,
  width: number,
  depth: number,
  material: StructureMaterial,
  progress: number,
  palette: MaterialPalette,
  seedKey: string,
): void {
  // Keep the staging area consistently to one side of the footprint so Action 1B can later use
  // the same place as a real pickup anchor. Slight deterministic variation prevents every site
  // from looking stamped out without changing the semantic location.
  const side = stableUnit(`${seedKey}:staging-side`) > 0.5 ? 1 : -1;
  const stagingX = side * width * 0.92;
  const stagingZ = -depth * 0.26;
  const remaining = Math.max(0.28, 1 - progress * 0.62);

  if (material === 'timber' || material === 'earth') {
    const timber = palette.getSurfaceMaterial(material === 'earth' ? 'timber' : 'timber');
    const beamLength = Math.max(0.5, depth * 0.54);
    const beamGeometry = new THREE.BoxGeometry(0.075, 0.075, beamLength);
    const count = 4 + Math.round(remaining * 4);
    for (let index = 0; index < count; index += 1) {
      const beam = new THREE.Mesh(beamGeometry, timber);
      const layer = Math.floor(index / 4);
      const across = index % 4;
      beam.position.set(stagingX + (across - 1.5) * 0.095, 0.055 + layer * 0.082, stagingZ + layer * 0.045);
      beam.rotation.y = (stableUnit(`${seedKey}:beam:${index}`) - 0.5) * 0.08;
      beam.castShadow = true;
      beam.userData['constructionCue'] = 'staged-material';
      group.add(beam);
    }
    if (material === 'earth') addEarthBasket(group, stagingX, stagingZ + depth * 0.42, palette);
    return;
  }

  const surface = material === 'metal'
    ? palette.getSurfaceMaterial('metal')
    : material === 'ceramic'
      ? palette.getSurfaceMaterial('brick')
      : palette.getSurfaceMaterial('stone');
  const blockSize = Math.max(0.11, Math.min(0.18, width * 0.09));
  const blockGeometry = new THREE.BoxGeometry(blockSize * 1.35, blockSize, blockSize);
  const count = 6 + Math.round(remaining * 7);
  for (let index = 0; index < count; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3) % 2;
    const layer = Math.floor(index / 6);
    const block = new THREE.Mesh(blockGeometry, surface);
    block.position.set(
      stagingX + (column - 1) * blockSize * 1.42,
      blockSize * 0.5 + layer * blockSize,
      stagingZ + row * blockSize * 1.15,
    );
    block.rotation.y = (stableUnit(`${seedKey}:block:${index}`) - 0.5) * 0.12;
    block.castShadow = true;
    block.userData['constructionCue'] = 'staged-material';
    group.add(block);
  }
}

function addEarthBasket(group: THREE.Group, x: number, z: number, palette: MaterialPalette): void {
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.1, 0.18, 8, 1, true),
    palette.getSurfaceMaterial('thatch'),
  );
  basket.position.set(x, 0.09, z);
  basket.castShadow = true;
  basket.userData['constructionCue'] = 'staged-material';
  group.add(basket);
}

function addSawhorses(group: THREE.Group, width: number, depth: number, palette: MaterialPalette): void {
  const timber = palette.getSurfaceMaterial('timber');
  const beamGeometry = new THREE.BoxGeometry(Math.max(0.48, width * 0.34), 0.045, 0.06);
  const legGeometry = new THREE.BoxGeometry(0.035, 0.3, 0.035);
  for (const z of [depth * 0.72, depth * 0.96]) {
    const bench = new THREE.Group();
    const top = new THREE.Mesh(beamGeometry, timber);
    top.position.y = 0.3;
    top.castShadow = true;
    bench.add(top);
    for (const x of [-0.18, 0.18]) {
      const left = new THREE.Mesh(legGeometry, timber);
      left.position.set(x, 0.15, -0.08);
      left.rotation.z = x < 0 ? -0.14 : 0.14;
      left.castShadow = true;
      const right = left.clone();
      right.position.z = 0.08;
      bench.add(left, right);
    }
    bench.position.set(-width * 0.28, 0, z);
    bench.userData['constructionCue'] = 'site-furniture';
    group.add(bench);
  }
}

function addBoundaryMarkers(group: THREE.Group, width: number, depth: number, palette: MaterialPalette): void {
  const timber = palette.getSurfaceMaterial('timber');
  const cloth = palette.getSurfaceMaterial('cloth');
  const stakeGeometry = new THREE.CylinderGeometry(0.018, 0.024, 0.44, 6);
  for (const [x, z] of [
    [-width * 0.8, -depth * 0.82],
    [width * 0.8, -depth * 0.82],
    [-width * 0.8, depth * 0.82],
    [width * 0.8, depth * 0.82],
  ] as const) {
    const stake = new THREE.Mesh(stakeGeometry, timber);
    stake.position.set(x, 0.22, z);
    stake.castShadow = true;
    group.add(stake);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.08), cloth);
    flag.position.set(x + 0.065, 0.36, z);
    flag.rotation.y = Math.PI / 2;
    flag.userData['constructionCue'] = 'survey-marker';
    group.add(flag);
  }
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
