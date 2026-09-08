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
  branchDepth: number;
}

export const TREE_LOD_NEAR: TreeLod = { sides: 5, clusterScale: 1, maxSegments: 44, maxClumps: 26, branchDepth: 0 };
export const TREE_LOD_FAR: TreeLod = { sides: 3, clusterScale: 1.1, maxSegments: 14, maxClumps: 10, branchDepth: -1 };

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
    clearTrunk: 0.3, taper: 0.6, forks: [2, 3], spread: [0.7, 1.25], droop: 0.16, depth: 4, lengthDecay: 0.8,
    clumpRadius: 0.2, clumpSquash: 0.55, clumpsPerTip: 3, lean: 0.16, bark: '#4d3a35', foliage: '#eba7bb', crownLift: 0, crownSpread: 1.5,
  },
  broadleaf: {
    clearTrunk: 0.36, taper: 0.64, forks: [2, 3], spread: [0.55, 1], droop: 0.06, depth: 4, lengthDecay: 0.78,
    clumpRadius: 0.22, clumpSquash: 0.82, clumpsPerTip: 3, lean: 0.08, bark: '#5c4436', foliage: '#4d7340', crownLift: 0.05, crownSpread: 1.15,
  },
  conifer: {
    clearTrunk: 0.18, taper: 0.52, forks: [3, 4], spread: [1.05, 1.35], droop: 0.5, depth: 3, lengthDecay: 0.66,
    clumpRadius: 0.19, clumpSquash: 0.45, clumpsPerTip: 2, lean: 0.03, bark: '#4a3a2c', foliage: '#2f5540', crownLift: -0.08, crownSpread: 0.85,
  },
  dry: {
    clearTrunk: 0.48, taper: 0.68, forks: [2, 3], spread: [0.95, 1.3], droop: -0.22, depth: 4, lengthDecay: 0.74,
    clumpRadius: 0.2, clumpSquash: 0.3, clumpsPerTip: 2, lean: 0.2, bark: '#6b5540', foliage: '#7f8a4a', crownLift: 0.08, crownSpread: 1.7,
  },
  riverbank: {
    clearTrunk: 0.26, taper: 0.6, forks: [2, 3], spread: [0.8, 1.2], droop: 0.62, depth: 4, lengthDecay: 0.78,
    clumpRadius: 0.17, clumpSquash: 1.35, clumpsPerTip: 3, lean: 0.3, bark: '#4f4231', foliage: '#63864a', crownLift: -0.05, crownSpread: 1.3,
  },
  alpine: {
    clearTrunk: 0.34, taper: 0.56, forks: [2, 2], spread: [0.7, 1.25], droop: 0.24, depth: 3, lengthDecay: 0.66,
    clumpRadius: 0.15, clumpSquash: 0.65, clumpsPerTip: 2, lean: 0.42, bark: '#54473c', foliage: '#42604a', crownLift: 0, crownSpread: 1,
  },
  ancient: {
    clearTrunk: 0.22, taper: 0.76, forks: [2, 3], spread: [0.8, 1.3], droop: 0.14, depth: 5, lengthDecay: 0.82,
    clumpRadius: 0.24, clumpSquash: 0.68, clumpsPerTip: 4, lean: 0.12, bark: '#4a3b30', foliage: '#3f6238', crownLift: 0.02, crownSpread: 1.75,
  },
};

/**
 * Grows one tree. Branch angle, length and radius all inherit with noise, so no two trees share a
 * silhouette even when they share a species and a seed lineage.
 */
function growTree(family: TreeFamily, random: SeededRandom, lod: TreeLod): TreeVariant {
  const species = SPECIES[family];
  const bark = new MeshAccumulator();
  const foliage = new MeshAccumulator();
  const barkColour = new THREE.Color(species.bark);
  const foliageColour = new THREE.Color(species.foliage);
  const height = random.range(0.86, 1.18);
  const maxDepth = Math.max(1, species.depth + lod.branchDepth);
  const tips: BranchState[] = [];
  let segments = 0;

  const trunkDirection = new THREE.Vector3(random.range(-1, 1) * species.lean, 1, random.range(-1, 1) * species.lean).normalize();
  const queue: BranchState[] = [{
    origin: new THREE.Vector3(0, 0, 0),
    direction: trunkDirection,
    length: height * (0.42 + species.clearTrunk * 0.6),
    radius: height * 0.062 * (family === 'ancient' ? 1.9 : 1),
    depth: 0,
  }];

  // Breadth-first, so when the segment budget runs out the tree still has a complete silhouette
  // rather than one over-grown limb.
  while (queue.length > 0) {
    const branch = queue.shift();
    if (!branch) break;
    const end = new THREE.Vector3().copy(branch.origin).addScaledVector(branch.direction, branch.length);
    const radiusTo = branch.radius * species.taper;
    bark.tube(branch.origin, end, branch.radius, radiusTo, Math.max(3, lod.sides - Math.min(2, branch.depth)), barkColour);
    segments += 1;
    if (branch.depth >= maxDepth || segments + queue.length >= lod.maxSegments) {
      tips.push({ ...branch, origin: end });
      continue;
    }
    const forks = random.int(species.forks[0], species.forks[1] + 1);
    for (let index = 0; index < forks; index += 1) {
      const angle = (index / forks) * Math.PI * 2 + random.range(-0.5, 0.5);
      const spread = random.range(species.spread[0], species.spread[1]) * (branch.depth === 0 ? 0.72 : 1);
      const direction = new THREE.Vector3(
        Math.cos(angle) * Math.sin(spread),
        Math.cos(spread) - species.droop * random.range(0.4, 1.1),
        Math.sin(angle) * Math.sin(spread),
      );
      direction.addScaledVector(branch.direction, 0.55).normalize();
      queue.push({
        origin: end,
        direction,
        length: branch.length * species.lengthDecay * random.range(0.82, 1.14),
        radius: radiusTo * random.range(0.56, 0.78),
        depth: branch.depth + 1,
      });
    }
  }
  for (const remaining of queue) tips.push({ ...remaining, origin: new THREE.Vector3().copy(remaining.origin) });

  const clumpRadius = species.clumpRadius * height * lod.clusterScale;
  const budget = Math.max(1, Math.round(lod.maxClumps / Math.max(1, tips.length)) || 1);
  let placed = 0;
  let radius = 0.1;
  let crown = 0;
  for (const tip of tips) {
    const perTip = Math.min(species.clumpsPerTip, budget);
    for (let index = 0; index < perTip && placed < lod.maxClumps; index += 1) {
      const centre = new THREE.Vector3().copy(tip.origin).addScaledVector(tip.direction, clumpRadius * random.range(0.2, 1.1));
      const drift = clumpRadius * species.crownSpread;
      centre.x += random.range(-drift, drift);
      centre.z += random.range(-drift, drift);
      centre.y += random.range(-clumpRadius * 0.5, clumpRadius * 0.7) + species.crownLift * height;
      foliage.clump(centre, clumpRadius * random.range(0.7, 1.25), species.clumpSquash, random, foliageColour);
      radius = Math.max(radius, Math.hypot(centre.x, centre.z) + clumpRadius);
      crown = Math.max(crown, centre.y + clumpRadius);
      placed += 1;
    }
  }

  return { family, bark: bark.build(), foliage: foliage.build(), height: Math.max(crown, height), radius };
}

/**
 * A small library of excellent trees rather than a large one of mediocre ones: a handful of
 * deterministic variants per family, reused through instancing.
 */
export function buildTreeLibrary(seed: string, variantsPerFamily: number, lod: TreeLod): Map<TreeFamily, TreeVariant[]> {
  const library = new Map<TreeFamily, TreeVariant[]>();
  for (const family of Object.keys(SPECIES) as TreeFamily[]) {
    const variants: TreeVariant[] = [];
    const count = family === 'ancient' ? Math.max(2, Math.round(variantsPerFamily * 0.6)) : variantsPerFamily;
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
