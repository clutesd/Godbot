import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';

export type TreeFamily = 'cherry' | 'broadleaf' | 'conifer' | 'dry' | 'riverbank' | 'alpine' | 'ancient';

export interface TreeVariant {
  family: TreeFamily;
  /** Bark and branch geometry, unit-scaled so instances can vary height freely. */
  bark: THREE.BufferGeometry;
  /** Foliage geometry, kept separate so season and species can tint it per instance. */
  foliage: THREE.BufferGeometry;
  height: number;
  radius: number;
}

export interface TreeLod {
  /** Branch subdivision; the far tier keeps the silhouette and drops the detail. */
  sides: number;
  clusterScale: number;
  /** Hard caps, because instanced forests live or die on the triangle count of one tree. */
  maxSegments: number;
  maxClumps: number;
}

export const TREE_LOD_NEAR: TreeLod = { sides: 5, clusterScale: 1, maxSegments: 44, maxClumps: 26 };
export const TREE_LOD_FAR: TreeLod = { sides: 3, clusterScale: 1.1, maxSegments: 14, maxClumps: 10 };

/** Triangle accumulator with smooth-ish normals, sized for organic geometry rather than boxes. */
class MeshAccumulator {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /** A tapered tube between two points; the workhorse for trunks and branches. */
  tube(from: THREE.Vector3, to: THREE.Vector3, radiusFrom: number, radiusTo: number, sides: number, colour: THREE.Color): void {
    const axis = new THREE.Vector3().subVectors(to, from);
    const length = axis.length();
    if (length < 1e-5) return;
    axis.divideScalar(length);
    const reference = Math.abs(axis.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const forward = new THREE.Vector3().crossVectors(axis, right).normalize();
    const base = this.positions.length / 3;
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const normal = new THREE.Vector3().addScaledVector(right, cos).addScaledVector(forward, sin);
      this.push(from.x + normal.x * radiusFrom, from.y + normal.y * radiusFrom, from.z + normal.z * radiusFrom, normal, colour);
      this.push(to.x + normal.x * radiusTo, to.y + normal.y * radiusTo, to.z + normal.z * radiusTo, normal, colour);
    }
    for (let index = 0; index < sides; index += 1) {
      const a = base + index * 2;
      const b = base + ((index + 1) % sides) * 2;
      this.indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  /**
   * An irregular foliage clump. Crowns are assembled from many of these rather than one sphere,
   * which is what breaks the sphere-on-a-stick silhouette. Jitter is keyed by vertex position so
   * shared corners move together and the shell stays closed.
   */
  clump(centre: THREE.Vector3, radius: number, squash: number, random: SeededRandom, colour: THREE.Color): void {
    const source = new THREE.IcosahedronGeometry(radius, 0);
    const position = source.getAttribute('position');
    const jitterByCorner = new Map<string, number>();
    const normal = new THREE.Vector3();
    const base = this.positions.length / 3;
    for (let index = 0; index < position.count; index += 1) {
      const px = position.getX(index);
      const py = position.getY(index);
      const pz = position.getZ(index);
      const key = `${px.toFixed(4)},${py.toFixed(4)},${pz.toFixed(4)}`;
      let jitter = jitterByCorner.get(key);
      if (jitter === undefined) {
        jitter = 1 + random.range(-0.3, 0.3);
        jitterByCorner.set(key, jitter);
      }
      const x = px * jitter;
      const y = py * jitter * squash;
      const z = pz * jitter;
      normal.set(x, y, z).normalize();
      this.push(centre.x + x, centre.y + y, centre.z + z, normal, colour);
    }
    const index = source.getIndex();
    if (index) {
      for (let cursor = 0; cursor < index.count; cursor += 1) this.indices.push(base + (index.getX(cursor) ?? 0));
    } else {
      for (let cursor = 0; cursor < position.count; cursor += 1) this.indices.push(base + cursor);
    }
    source.dispose();
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private push(x: number, y: number, z: number, normal: THREE.Vector3, colour: THREE.Color): void {
    this.positions.push(x, y, z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(colour.r, colour.g, colour.b);
  }
}

interface BranchState {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  radius: number;
  depth: number;
}

interface Species {
  /** Height of the trunk before the first fork, as a fraction of total height. */
  clearTrunk: number;
  taper: number;
  forks: readonly [number, number];
  spread: readonly [number, number];
  droop: number;
  depth: number;
  lengthDecay: number;
  /** Weight given to the inherited branch direction for the dominant continuation child. */
  continuationBias: number;
  /** Lateral children are deliberately subordinate to the dominant continuation. */
  lateralLength: readonly [number, number];
  lateralRadius: readonly [number, number];
  /** Maximum woody reach and height relative to nominal tree height. */
  branchReach: number;
  branchHeight: number;
  /** Terminal twigs finish sharply instead of ending as blunt, equally thick rods. */
  twigTaper: number;
  clumpRadius: number;
  clumpSquash: number;
  clumpsPerTip: number;
  lean: number;
  bark: string;
  foliage: string;
  crownLift: number;
  /** How far the foliage drifts out from the branch tips; wide values give spreading canopies. */
  crownSpread: number;
}

const SPECIES: Record<TreeFamily, Species> = {
  cherry: {
    clearTrunk: 0.3, taper: 0.6, forks: [2, 3], spread: [0.7, 1.22], droop: 0.16, depth: 4, lengthDecay: 0.72,
    continuationBias: 1.75, lateralLength: [0.62, 0.84], lateralRadius: [0.44, 0.62], branchReach: 0.62, branchHeight: 1.08, twigTaper: 0.2,
    clumpRadius: 0.2, clumpSquash: 0.55, clumpsPerTip: 3, lean: 0.16, bark: '#4d3a35', foliage: '#648348', crownLift: 0, crownSpread: 1.5,
  },
  broadleaf: {
    clearTrunk: 0.36, taper: 0.64, forks: [2, 3], spread: [0.55, 0.98], droop: 0.06, depth: 4, lengthDecay: 0.7,
    continuationBias: 2.1, lateralLength: [0.58, 0.8], lateralRadius: [0.46, 0.64], branchReach: 0.58, branchHeight: 1.12, twigTaper: 0.18,
    clumpRadius: 0.22, clumpSquash: 0.82, clumpsPerTip: 3, lean: 0.08, bark: '#5c4436', foliage: '#4d7340', crownLift: 0.05, crownSpread: 1.15,
  },
  conifer: {
    clearTrunk: 0.18, taper: 0.52, forks: [3, 4], spread: [1.05, 1.35], droop: 0.5, depth: 3, lengthDecay: 0.66,
    continuationBias: 2.6, lateralLength: [0.55, 0.74], lateralRadius: [0.4, 0.56], branchReach: 0.42, branchHeight: 1.08, twigTaper: 0.16,
    clumpRadius: 0.19, clumpSquash: 0.45, clumpsPerTip: 2, lean: 0.03, bark: '#4a3a2c', foliage: '#2f5540', crownLift: -0.08, crownSpread: 0.85,
  },
  dry: {
    clearTrunk: 0.48, taper: 0.68, forks: [2, 3], spread: [0.92, 1.26], droop: -0.22, depth: 4, lengthDecay: 0.7,
    continuationBias: 1.35, lateralLength: [0.64, 0.88], lateralRadius: [0.42, 0.6], branchReach: 0.72, branchHeight: 1.04, twigTaper: 0.18,
    clumpRadius: 0.2, clumpSquash: 0.3, clumpsPerTip: 2, lean: 0.2, bark: '#6b5540', foliage: '#7f8a4a', crownLift: 0.08, crownSpread: 1.7,
  },
  riverbank: {
    clearTrunk: 0.26, taper: 0.6, forks: [2, 3], spread: [0.78, 1.16], droop: 0.62, depth: 4, lengthDecay: 0.72,
    continuationBias: 1.45, lateralLength: [0.62, 0.86], lateralRadius: [0.42, 0.62], branchReach: 0.64, branchHeight: 1.08, twigTaper: 0.18,
    clumpRadius: 0.17, clumpSquash: 1.35, clumpsPerTip: 3, lean: 0.3, bark: '#4f4231', foliage: '#63864a', crownLift: -0.05, crownSpread: 1.3,
  },
  alpine: {
    clearTrunk: 0.34, taper: 0.56, forks: [2, 2], spread: [0.7, 1.25], droop: 0.24, depth: 3, lengthDecay: 0.66,
    continuationBias: 2.2, lateralLength: [0.52, 0.72], lateralRadius: [0.4, 0.56], branchReach: 0.44, branchHeight: 1.06, twigTaper: 0.16,
    clumpRadius: 0.15, clumpSquash: 0.65, clumpsPerTip: 2, lean: 0.42, bark: '#54473c', foliage: '#42604a', crownLift: 0, crownSpread: 1,
  },
  ancient: {
    clearTrunk: 0.22, taper: 0.76, forks: [2, 3], spread: [0.78, 1.25], droop: 0.14, depth: 5, lengthDecay: 0.74,
    continuationBias: 1.7, lateralLength: [0.62, 0.86], lateralRadius: [0.5, 0.68], branchReach: 0.76, branchHeight: 1.16, twigTaper: 0.2,
    clumpRadius: 0.24, clumpSquash: 0.68, clumpsPerTip: 4, lean: 0.12, bark: '#4a3b30', foliage: '#3f6238', crownLift: 0.02, crownSpread: 1.75,
  },
};

function constrainBranchLength(origin: THREE.Vector3, direction: THREE.Vector3, desired: number,
  maxReach: number, maxHeight: number): number {
  let length = desired;
  const horizontalSq = direction.x * direction.x + direction.z * direction.z;
  if (horizontalSq > 1e-6) {
    const b = 2 * (origin.x * direction.x + origin.z * direction.z);
    const c = origin.x * origin.x + origin.z * origin.z - maxReach * maxReach;
    const discriminant = b * b - 4 * horizontalSq * c;
    if (discriminant >= 0) {
      const exit = (-b + Math.sqrt(discriminant)) / (2 * horizontalSq);
      if (exit >= 0) length = Math.min(length, exit * 0.97);
    }
  }
  if (direction.y > 1e-5) {
    const vertical = (maxHeight - origin.y) / direction.y;
    if (vertical >= 0) length = Math.min(length, vertical * 0.985);
  }
  return Math.max(0, length);
}

function childDirection(branch: BranchState, species: Species, index: number, forks: number,
  random: SeededRandom): THREE.Vector3 {
  const angle = (index / Math.max(1, forks)) * Math.PI * 2 + random.range(-0.48, 0.48);
  if (index === 0) {
    const deflection = random.range(0.12, 0.3) + Math.min(0.08, branch.depth * 0.02);
    const continuation = new THREE.Vector3(
      Math.cos(angle) * Math.sin(deflection),
      Math.cos(deflection) - species.droop * random.range(0.08, 0.24),
      Math.sin(angle) * Math.sin(deflection),
    );
    return continuation.addScaledVector(branch.direction, species.continuationBias).normalize();
  }
  const spread = random.range(species.spread[0], species.spread[1]) * (branch.depth === 0 ? 0.74 : 1);
  const lateral = new THREE.Vector3(
    Math.cos(angle) * Math.sin(spread),
    Math.cos(spread) - species.droop * random.range(0.4, 1.05),
    Math.sin(angle) * Math.sin(spread),
  );
  return lateral.addScaledVector(branch.direction, 0.36).normalize();
}

/**
 * Grows one tree. The woody skeleton follows a leader/lateral hierarchy: each fork keeps one
 * dominant continuation while lateral children become shorter and thinner with depth. The whole
 * skeleton is constrained to a family-specific crown envelope so leafless trees still read as
 * believable organisms rather than radiating antennae.
 */
function growTree(family: TreeFamily, random: SeededRandom, lod: TreeLod): TreeVariant {
  if (family === 'conifer' || family === 'alpine') return growEvergreen(family, random, lod);
  const species = SPECIES[family];
  const bark = new MeshAccumulator();
  const foliage = new MeshAccumulator();
  const barkColour = new THREE.Color(species.bark);
  const foliageColour = new THREE.Color('#ffffff');
  const height = random.range(0.86, 1.18);
  // Both tiers grow the same skeleton. LOD changes tessellation, never the tree's identity.
  const maxDepth = Math.max(1, species.depth);
  const maxReach = height * species.branchReach;
  const maxHeight = height * species.branchHeight;
  const tips: BranchState[] = [];
  let segments = 0;
  let architectureRadius = 0;
  let architectureTop = 0;

  const trunkDirection = new THREE.Vector3(random.range(-1, 1) * species.lean, 1, random.range(-1, 1) * species.lean).normalize();
  const queue: BranchState[] = [{
    origin: new THREE.Vector3(0, 0, 0),
    direction: trunkDirection,
    length: height * (0.42 + species.clearTrunk * 0.6),
    radius: height * 0.062 * (family === 'ancient' ? 1.9 : 1),
    depth: 0,
  }];

  // Breadth-first means the segment budget preserves the whole silhouette rather than over-growing
  // one limb. Terminal decisions use the near budget so both LOD tiers retain the same skeleton.
  while (queue.length > 0) {
    const branch = queue.shift();
    if (!branch) break;
    const nominalLength = branch.depth === 0
      ? branch.length
      : constrainBranchLength(branch.origin, branch.direction, branch.length, maxReach, maxHeight);
    if (nominalLength < height * 0.012) {
      tips.push({ ...branch, length: nominalLength });
      continue;
    }
    const terminal = branch.depth >= maxDepth
      || segments + queue.length >= TREE_LOD_NEAR.maxSegments
      || nominalLength < height * 0.045
      || branch.radius < height * 0.0032;
    const end = new THREE.Vector3().copy(branch.origin).addScaledVector(branch.direction, nominalLength);
    const depthTaper = 1 - Math.min(0.24, branch.depth * 0.055);
    const inheritedRadius = branch.radius * species.taper * depthTaper;
    const radiusTo = terminal
      ? Math.min(inheritedRadius, Math.max(height * 0.0008, branch.radius * species.twigTaper))
      : inheritedRadius;
    if (segments < lod.maxSegments) {
      bark.tube(branch.origin, end, branch.radius, radiusTo,
        Math.max(3, lod.sides - Math.min(2, branch.depth)), barkColour);
    }
    segments += 1;
    architectureRadius = Math.max(architectureRadius, Math.hypot(end.x, end.z) + branch.radius);
    architectureTop = Math.max(architectureTop, end.y + branch.radius);
    if (terminal) {
      tips.push({ ...branch, origin: end, length: nominalLength, radius: radiusTo });
      continue;
    }

    const forks = random.int(species.forks[0], species.forks[1] + 1);
    for (let index = 0; index < forks; index += 1) {
      const continuation = index === 0;
      const childOrigin = continuation
        ? end.clone()
        : new THREE.Vector3().lerpVectors(branch.origin, end,
          branch.depth === 0 ? random.range(0.68, 0.94) : random.range(0.82, 0.98));
      const direction = childDirection(branch, species, index, forks, random);
      const depthShortening = 1 - Math.min(0.2, branch.depth * 0.05);
      const childLength = nominalLength * species.lengthDecay * depthShortening * (continuation
        ? random.range(0.9, 1.04)
        : random.range(species.lateralLength[0], species.lateralLength[1]));
      const childRadius = radiusTo * (continuation
        ? random.range(0.72, 0.86)
        : random.range(species.lateralRadius[0], species.lateralRadius[1]));
      queue.push({
        origin: childOrigin,
        direction,
        length: childLength,
        radius: childRadius,
        depth: branch.depth + 1,
      });
    }
  }

  const clumpRadius = species.clumpRadius * height;
  const clumpCount = Math.min(TREE_LOD_NEAR.maxClumps, tips.length * species.clumpsPerTip);
  const visibleClumps = Math.min(clumpCount, lod.maxClumps);
  const selected = new Set(Array.from({ length: visibleClumps }, (_, index) =>
    Math.floor(index * clumpCount / Math.max(1, visibleClumps))));
  let radius = Math.max(0.1, architectureRadius);
  let crown = Math.max(height, architectureTop);
  for (let index = 0; index < clumpCount; index += 1) {
    const tip = tips[Math.floor(index * tips.length / Math.max(1, clumpCount))];
    if (!tip) continue;
    const centre = new THREE.Vector3().copy(tip.origin).addScaledVector(tip.direction, clumpRadius * random.range(0.12, 0.72));
    const drift = clumpRadius * species.crownSpread;
    centre.x += random.range(-drift, drift);
    centre.z += random.range(-drift, drift);
    centre.y += random.range(-clumpRadius * 0.45, clumpRadius * 0.62) + species.crownLift * height;
    const size = clumpRadius * random.range(0.72, 1.22);
    if (selected.has(index)) {
      foliageColour.setScalar(random.fork(`shade:${index}`).range(0.78, 1));
      foliage.clump(centre, size * lod.clusterScale, species.clumpSquash, random.fork(`clump:${index}`), foliageColour);
    }
    radius = Math.max(radius, Math.hypot(centre.x, centre.z) + size * 1.3);
    crown = Math.max(crown, centre.y + size * species.clumpSquash * 1.3);
  }

  return { family, bark: bark.build(), foliage: foliage.build(), height: crown, radius };
}

/** A persistent leader and tapering branch whorls give needle trees their upright silhouette. */
function growEvergreen(family: 'conifer' | 'alpine', random: SeededRandom, lod: TreeLod): TreeVariant {
  const bark = new MeshAccumulator();
  const foliage = new MeshAccumulator();
  const height = random.range(1.35, 1.75) * (family === 'alpine' ? 0.8 : 1);
  const width = height * random.range(0.25, 0.32);
  const lean = new THREE.Vector3(random.range(-0.08, 0.08), 1, random.range(-0.08, 0.08));
  if (family === 'alpine') lean.x += 0.14;
  const barkColour = new THREE.Color(SPECIES[family].bark);
  const color = new THREE.Color();
  const layers = 5;
  let segments = 0;
  for (let layer = 0; layer < layers; layer++) {
    const fraction = layer / layers;
    const base = lean.clone().multiplyScalar(height * (0.2 + fraction * 0.68));
    const tip = lean.clone().multiplyScalar(height * (0.55 + fraction * 0.57));
    const radius = width * (1 - fraction * 0.9) * random.range(0.9, 1.08);
    color.setScalar(0.78 + fraction * 0.19);
    foliage.tube(base, tip, radius, 0.002, lod.sides + 2, color);
    const branchCount = 3;
    const twist = random.range(0, Math.PI * 2);
    for (let branch = 0; branch < branchCount; branch++) {
      const angle = twist + branch / branchCount * Math.PI * 2;
      const end = new THREE.Vector3(base.x + Math.cos(angle) * radius * 0.86, base.y - height * 0.035,
        base.z + Math.sin(angle) * radius * 0.86);
      if (segments++ < lod.maxSegments - 1) {
        const branchRadius = height * 0.012 * (1 - fraction * 0.45);
        bark.tube(base, end, branchRadius, Math.max(0.0015, branchRadius * 0.18), 3, barkColour);
      }
      if (lod.maxClumps >= 15 || branch === 0) {
        foliage.clump(end, radius * 0.29, 0.52, random.fork(`spray:${layer}:${branch}`), color);
      }
    }
  }
  bark.tube(new THREE.Vector3(), lean.clone().multiplyScalar(height), height * 0.045, 0.004, lod.sides, barkColour);
  return { family, bark: bark.build(), foliage: foliage.build(), height: height * 1.08,
    radius: width * 1.25 + height * Math.hypot(lean.x, lean.z) };
}

/**
 * A small library of excellent trees rather than a large one of mediocre ones: a handful of
 * deterministic variants per family, reused through instancing.
 */
export function buildTreeLibrary(seed: string, variantsPerFamily: number, lod: TreeLod): Map<TreeFamily, TreeVariant[]> {
  const library = new Map<TreeFamily, TreeVariant[]>();
  for (const family of Object.keys(SPECIES) as TreeFamily[]) {
    const variants: TreeVariant[] = [];
    const count = Math.max(1, Math.floor(variantsPerFamily));
    for (let index = 0; index < count; index += 1) {
      variants.push(growTree(family, new SeededRandom(`${seed}:tree:${family}:${index}`), lod));
    }
    library.set(family, variants);
  }
  return library;
}

export function speciesFoliageColour(family: TreeFamily): THREE.Color {
  return new THREE.Color(SPECIES[family].foliage);
}
