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
  private readonly anchors: number[] = [];
  private readonly anchor = new THREE.Vector3();
  private foliage = false;

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /** A tapered tube between two points; the workhorse for trunks and branches. */
  tube(from: THREE.Vector3, to: THREE.Vector3, radiusFrom: number, radiusTo: number, sides: number, colour: THREE.Color, curved = false): void {
    const axis = new THREE.Vector3().subVectors(to, from);
    const length = axis.length();
    if (length < 1e-5) return;
    axis.divideScalar(length);
    const reference = Math.abs(axis.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const forward = new THREE.Vector3().crossVectors(axis, right).normalize();
    const base = this.positions.length / 3;
    const rings = curved ? 3 : 2;
    const shade = new THREE.Color();
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const normal = new THREE.Vector3().addScaledVector(right, cos).addScaledVector(forward, sin);
      // Longitudinal ridges and a modest root flare replace the perfectly round, uniform rods.
      const ridge = 1 + Math.sin(angle * 3 + from.y * 4) * 0.065;
      shade.copy(colour).multiplyScalar(0.88 + 0.18 * (0.5 + 0.5 * Math.cos(angle * 3 + from.y * 4)));
      for (let ring = 0; ring < rings; ring += 1) {
        const t = ring / (rings - 1);
        const radius = THREE.MathUtils.lerp(radiusFrom, radiusTo, t) * ridge
          * (from.y === 0 ? 1 + 0.24 * (1 - t) ** 4 : 1);
        const centre = from.clone().lerp(to, t);
        if (curved) centre.addScaledVector(forward, Math.sin(t * Math.PI) * length * 0.045);
        const surfaceNormal = normal.clone().addScaledVector(axis, (radiusFrom - radiusTo) / length).normalize();
        this.push(centre.x + normal.x * radius, centre.y + normal.y * radius, centre.z + normal.z * radius, surfaceNormal, shade);
      }
    }
    for (let index = 0; index < sides; index += 1) {
      for (let ring = 0; ring < rings - 1; ring += 1) {
        const a = base + index * rings + ring;
        const b = base + ((index + 1) % sides) * rings + ring;
        this.indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }

  /**
   * A compact crown mass. These are now reserved mostly for the deep canopy core; outer foliage
   * uses branch-aligned sprays; middle masses connect these into a continuous living crown.
   */
  clump(centre: THREE.Vector3, radius: number, squash: number, random: SeededRandom, colour: THREE.Color): void {
    this.anchor.copy(centre);
    this.foliage = true;
    const source = new THREE.IcosahedronGeometry(radius, 0);
    const position = source.getAttribute('position');
    const jitterByCorner = new Map<string, number>();
    const normal = new THREE.Vector3();
    const stretchX = random.range(0.84, 1.18);
    const stretchZ = random.range(0.84, 1.18);
    const rotation = random.range(0, Math.PI * 2);
    const cosRotation = Math.cos(rotation);
    const sinRotation = Math.sin(rotation);
    const base = this.positions.length / 3;
    for (let index = 0; index < position.count; index += 1) {
      const px = position.getX(index);
      const py = position.getY(index);
      const pz = position.getZ(index);
      const key = `${px.toFixed(4)},${py.toFixed(4)},${pz.toFixed(4)}`;
      let jitter = jitterByCorner.get(key);
      if (jitter === undefined) {
        jitter = 1 + random.range(-0.14, 0.14);
        jitterByCorner.set(key, jitter);
      }
      const localX = px * jitter * stretchX;
      const localZ = pz * jitter * stretchZ;
      const x = localX * cosRotation - localZ * sinRotation;
      const z = localX * sinRotation + localZ * cosRotation;
      const y = py * jitter * squash;
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

  /**
   * Ten-triangle elongated leaf bundle. Two of these replace one outer icosahedral clump, keeping
   * the old 20-triangle/site ceiling while giving the near canopy a finer, leafy silhouette.
   */
  spray(centre: THREE.Vector3, radius: number, squash: number, random: SeededRandom, colour: THREE.Color, direction?: THREE.Vector3): void {
    this.anchor.copy(centre);
    this.foliage = true;
    const azimuth = random.range(0, Math.PI * 2);
    const axis = new THREE.Vector3(Math.cos(azimuth), random.range(-0.22, 0.3), Math.sin(azimuth));
    if (direction) axis.multiplyScalar(0.18).add(direction);
    axis.normalize();
    const reference = Math.abs(axis.y) > 0.88 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const up = new THREE.Vector3().crossVectors(right, axis).normalize();
    const lengthFront = radius * random.range(1.02, 1.28);
    const lengthBack = radius * random.range(0.7, 0.94);
    const width = radius * random.range(0.62, 0.78);
    const vertical = width * Math.max(0.45, Math.min(1.3, squash)) * random.range(0.82, 1.08);
    const front = centre.clone().addScaledVector(axis, lengthFront);
    const back = centre.clone().addScaledVector(axis, -lengthBack);
    const ring: THREE.Vector3[] = [];
    const twist = random.range(0, Math.PI * 2);
    for (let index = 0; index < 5; index += 1) {
      const angle = twist + index / 5 * Math.PI * 2;
      ring.push(centre.clone()
        .addScaledVector(right, Math.cos(angle) * width)
        .addScaledVector(up, Math.sin(angle) * vertical)
        .addScaledVector(axis, random.range(-0.08, 0.08) * radius));
    }
    const base = this.positions.length / 3;
    const logical = [front, back, ...ring];
    for (const vertex of logical) {
      const normal = vertex.clone().sub(centre).normalize();
      this.push(vertex.x, vertex.y, vertex.z, normal, colour);
    }
    for (let index = 0; index < 5; index += 1) {
      const current = base + 2 + index;
      const next = base + 2 + ((index + 1) % 5);
      this.indices.push(base, current, next);
      this.indices.push(base + 1, next, current);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.foliage) geometry.setAttribute('canopyAnchor', new THREE.Float32BufferAttribute(this.anchors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private push(x: number, y: number, z: number, normal: THREE.Vector3, colour: THREE.Color): void {
    this.positions.push(x, y, z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(colour.r, colour.g, colour.b);
    this.anchors.push(this.anchor.x, this.anchor.y, this.anchor.z);
  }
}

interface BranchState {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  radius: number;
  depth: number;
  leader: boolean;
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
    clumpRadius: 0.22, clumpSquash: 1.35, clumpsPerTip: 3, lean: 0.3, bark: '#4f4231', foliage: '#63864a', crownLift: -0.05, crownSpread: 1.3,
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

type CanopyTier = 'core' | 'middle' | 'edge';
type ScaleRange = readonly [number, number];

interface CanopyGrammar {
  coreShare: number;
  edgeShare: number;
  coreScale: ScaleRange;
  middleScale: ScaleRange;
  edgeScale: ScaleRange;
  coreAnchor: number;
  middleAnchor: number;
  edgeAnchor: number;
  coreDrift: number;
  middleDrift: number;
  edgeDrift: number;
  coreSpacing: number;
  middleSpacing: number;
  edgeSpacing: number;
  verticalScatter: number;
  edgeDrop: number;
  /** Angular width of a persistent opening through the crown. */
  gapWidth: number;
  gapCount: number;
}

/**
 * Crown grammar balances overlapping core/middle masses with fine peripheral sprays.
 * Persistent openings, subordinate tips and a shared LOD site list keep the crown legible.
 */
const CANOPY: Record<'cherry' | 'broadleaf' | 'dry' | 'riverbank' | 'ancient', CanopyGrammar> = {
  cherry: {
    coreShare: 0.14, edgeShare: 0.54, coreScale: [0.5, 0.66], middleScale: [0.33, 0.47], edgeScale: [0.17, 0.3],
    coreAnchor: 0.72, middleAnchor: 0.96, edgeAnchor: 1.08, coreDrift: 0.2, middleDrift: 0.44, edgeDrift: 0.68,
    coreSpacing: 0.36, middleSpacing: 0.46, edgeSpacing: 0.43,
    verticalScatter: 0.46, edgeDrop: 0.025, gapWidth: 0.38, gapCount: 2,
  },
  broadleaf: {
    coreShare: 0.16, edgeShare: 0.5, coreScale: [0.54, 0.7], middleScale: [0.34, 0.5], edgeScale: [0.18, 0.32],
    coreAnchor: 0.7, middleAnchor: 0.94, edgeAnchor: 1.06, coreDrift: 0.16, middleDrift: 0.36, edgeDrift: 0.54,
    coreSpacing: 0.38, middleSpacing: 0.48, edgeSpacing: 0.45,
    verticalScatter: 0.42, edgeDrop: 0.015, gapWidth: 0.34, gapCount: 2,
  },
  dry: {
    coreShare: 0.1, edgeShare: 0.58, coreScale: [0.46, 0.6], middleScale: [0.3, 0.42], edgeScale: [0.15, 0.28],
    coreAnchor: 0.74, middleAnchor: 1, edgeAnchor: 1.1, coreDrift: 0.22, middleDrift: 0.52, edgeDrift: 0.82,
    coreSpacing: 0.32, middleSpacing: 0.44, edgeSpacing: 0.42,
    verticalScatter: 0.26, edgeDrop: 0, gapWidth: 0.52, gapCount: 2,
  },
  riverbank: {
    coreShare: 0.12, edgeShare: 0.56, coreScale: [0.46, 0.6], middleScale: [0.28, 0.42], edgeScale: [0.14, 0.26],
    coreAnchor: 0.74, middleAnchor: 0.98, edgeAnchor: 1.08, coreDrift: 0.16, middleDrift: 0.36, edgeDrift: 0.54,
    coreSpacing: 0.34, middleSpacing: 0.44, edgeSpacing: 0.4,
    verticalScatter: 0.66, edgeDrop: 0.09, gapWidth: 0.4, gapCount: 2,
  },
  ancient: {
    coreShare: 0.12, edgeShare: 0.56, coreScale: [0.5, 0.68], middleScale: [0.32, 0.48], edgeScale: [0.16, 0.3],
    coreAnchor: 0.7, middleAnchor: 0.96, edgeAnchor: 1.1, coreDrift: 0.18, middleDrift: 0.44, edgeDrift: 0.74,
    coreSpacing: 0.32, middleSpacing: 0.44, edgeSpacing: 0.42,
    verticalScatter: 0.54, edgeDrop: 0.035, gapWidth: 0.54, gapCount: 2,
  },
};

interface CanopySite {
  centre: THREE.Vector3;
  direction: THREE.Vector3;
  size: number;
  squash: number;
  shade: number;
  tier: CanopyTier;
  seed: string;
}

function angularDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(difference, Math.PI * 2 - difference);
}

function canopyTierTargets(total: number, grammar: CanopyGrammar): Record<CanopyTier, number> {
  if (total <= 0) return { core: 0, middle: 0, edge: 0 };
  if (total === 1) return { core: 1, middle: 0, edge: 0 };
  const core = Math.max(1, Math.floor(total * grammar.coreShare));
  const edge = Math.max(1, Math.floor(total * grammar.edgeShare));
  return { core, middle: Math.max(0, total - core - edge), edge };
}

function tierScale(grammar: CanopyGrammar, tier: CanopyTier): ScaleRange {
  if (tier === 'core') return grammar.coreScale;
  if (tier === 'middle') return grammar.middleScale;
  return grammar.edgeScale;
}

function tierAnchor(grammar: CanopyGrammar, tier: CanopyTier): number {
  if (tier === 'core') return grammar.coreAnchor;
  if (tier === 'middle') return grammar.middleAnchor;
  return grammar.edgeAnchor;
}

function tierDrift(grammar: CanopyGrammar, tier: CanopyTier): number {
  if (tier === 'core') return grammar.coreDrift;
  if (tier === 'middle') return grammar.middleDrift;
  return grammar.edgeDrift;
}

function tierSpacing(grammar: CanopyGrammar, tier: CanopyTier): number {
  if (tier === 'core') return grammar.coreSpacing;
  if (tier === 'middle') return grammar.middleSpacing;
  return grammar.edgeSpacing;
}

function createCanopySites(tips: readonly BranchState[], species: Species, grammar: CanopyGrammar,
  height: number, total: number, random: SeededRandom): CanopySite[] {
  if (tips.length === 0 || total <= 0) return [];
  const referenceRadius = species.clumpRadius * height;
  const targets = canopyTierTargets(total, grammar);
  const gapRandom = random.fork('canopy-gaps');
  const gapAngles = Array.from({ length: grammar.gapCount }, (_, index) =>
    (gapRandom.range(0, Math.PI * 2) + index * Math.PI * 2 / Math.max(1, grammar.gapCount)) % (Math.PI * 2));
  const sites: CanopySite[] = [];
  const orderedTips: BranchState[] = [];
  const remaining = [...tips].sort((a, b) => b.origin.y - a.origin.y);
  while (remaining.length) {
    let best = 0;
    let separation = -1;
    if (orderedTips.length) {
      for (let index = 0; index < remaining.length; index += 1) {
        const distance = Math.min(...orderedTips.map(tip => tip.origin.distanceToSquared(remaining[index]!.origin)));
        if (distance > separation) { best = index; separation = distance; }
      }
    }
    orderedTips.push(remaining.splice(best, 1)[0]!);
  }

  const buildTier = (tier: CanopyTier, target: number): void => {
    let accepted = 0;
    const maxAttempts = Math.max(target * 12, 12);
    for (let attempt = 0; attempt < maxAttempts && accepted < target; attempt += 1) {
      const siteRandom = random.fork(`canopy:${tier}:${attempt}`);
      // Visit the apex and separated scaffold tips before revisiting one: small crowns must
      // not spend their entire foliage budget on the same leader. Both LODs share this order.
      const tip = orderedTips[attempt % orderedTips.length];
      if (!tip) continue;
      const anchor = tierAnchor(grammar, tier);
      const centre = tip.origin.clone();
      centre.x *= anchor;
      centre.z *= anchor;
      centre.addScaledVector(tip.direction, -referenceRadius * (tier === 'core' ? 0.55 : 0.15));
      const drift = referenceRadius * species.crownSpread * tierDrift(grammar, tier) * 0.4;
      centre.x += siteRandom.range(-drift, drift);
      centre.z += siteRandom.range(-drift, drift);
      centre.y += siteRandom.range(-referenceRadius * grammar.verticalScatter, referenceRadius * grammar.verticalScatter) * 0.45
        + species.crownLift * height;
      if (tier === 'edge') centre.y -= grammar.edgeDrop * height * siteRandom.range(0.7, 1.15);

      if (tier === 'edge' && Math.hypot(centre.x, centre.z) > referenceRadius * 0.3) {
        const angle = Math.atan2(centre.z, centre.x);
        const gapScale = tier === 'edge' ? 1 : 0.72;
        const inGap = gapAngles.some(gap => angularDistance(angle, gap) < grammar.gapWidth * gapScale * 0.65);
        if (inGap) continue;
      }

      const scale = tierScale(grammar, tier);
      const size = Math.min(height * 0.21,
        referenceRadius * siteRandom.range(scale[0], scale[1]) * (tier === 'core' ? 1.22 : tier === 'middle' ? 2.1 : 2.4));
      const spacing = tierSpacing(grammar, tier);
      const tooClose = sites.some(existing => {
        const sharedSpacing = Math.min(spacing, tierSpacing(grammar, existing.tier));
        return centre.distanceTo(existing.centre) < (size + existing.size) * sharedSpacing * 0.65;
      });
      if (tooClose) continue;

      const tierSquash = tier === 'core' ? 1 : tier === 'middle' ? 0.86 : 0.7;
      const shade = tier === 'core'
        ? siteRandom.range(0.76, 0.88)
        : tier === 'middle' ? siteRandom.range(0.84, 0.98) : siteRandom.range(0.93, 1.06);
      sites.push({
        centre,
        direction: new THREE.Vector3(tip.direction.x, species.droop > 0.4 ? -0.85 : tip.direction.y * 0.25,
          tip.direction.z).normalize(),
        size,
        squash: species.clumpSquash * tierSquash * siteRandom.range(0.9, 1.08),
        shade,
        tier,
        seed: `canopy:${tier}:${attempt}`,
      });
      accepted += 1;
    }
  };

  buildTier('core', targets.core);
  buildTier('middle', targets.middle);
  buildTier('edge', targets.edge);
  return sites;
}

function evenlySelect(indices: readonly number[], count: number, selected: Set<number>): void {
  if (count <= 0 || indices.length === 0) return;
  const picks = Math.min(count, indices.length);
  for (let index = 0; index < picks; index += 1) {
    const position = Math.min(indices.length - 1, Math.floor((index + 0.5) * indices.length / picks));
    selected.add(indices[position]!);
  }
}

/** Preserve structural crown masses at far LOD, with a few fine edge sites for the silhouette. */
function selectCanopySites(sites: readonly CanopySite[], visibleCount: number): Set<number> {
  if (visibleCount >= sites.length) return new Set(sites.map((_, index) => index));
  const selected = new Set<number>();
  const core: number[] = [];
  const middle: number[] = [];
  const edge: number[] = [];
  for (let index = 0; index < sites.length; index += 1) {
    const tier = sites[index]!.tier;
    if (tier === 'core') core.push(index);
    else if (tier === 'middle') middle.push(index);
    else edge.push(index);
  }
  const coreQuota = Math.min(core.length, Math.max(1, Math.round(visibleCount * 0.18)));
  const edgeQuota = Math.min(edge.length, Math.max(1, Math.round(visibleCount * 0.2)));
  evenlySelect(core, coreQuota, selected);
  evenlySelect(edge, edgeQuota, selected);
  evenlySelect(middle, visibleCount - selected.size, selected);
  if (selected.size < visibleCount) {
    for (let index = 0; index < sites.length && selected.size < visibleCount; index += 1) selected.add(index);
  }
  return selected;
}

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
  random: SeededRandom, phase: number): THREE.Vector3 {
  const angle = phase + (index / Math.max(1, forks)) * Math.PI * 2 + random.range(-0.3, 0.3);
  if (index === 0) {
    const deflection = random.range(0.12, 0.3) + Math.min(0.08, branch.depth * 0.02);
    const continuation = new THREE.Vector3(
      Math.cos(angle) * Math.sin(deflection),
      Math.cos(deflection) - species.droop * random.range(0.08, 0.24),
      Math.sin(angle) * Math.sin(deflection),
    );
    return continuation.addScaledVector(branch.direction, species.continuationBias).normalize();
  }
  const spread = random.range(species.spread[0], species.spread[1]) * (branch.depth === 0 ? 1.12 : 1);
  const lateral = new THREE.Vector3(
    Math.cos(angle) * Math.sin(spread),
    Math.cos(spread) - species.droop * random.range(0.4, 1.05) * (branch.depth === 0 ? 0.15 : 1),
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
  const grammar = CANOPY[family];
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
  const wood: { branch: BranchState; end: THREE.Vector3; radiusTo: number }[] = [];
  let segments = 0;
  let architectureRadius = 0;
  let architectureTop = 0;

  const trunkDirection = new THREE.Vector3(random.range(-1, 1) * species.lean, 1, random.range(-1, 1) * species.lean).normalize();
  const queue: BranchState[] = [{
    origin: new THREE.Vector3(0, 0, 0),
    direction: trunkDirection,
    length: height * species.clearTrunk,
    radius: height * 0.044 * (family === 'ancient' ? 1.9 : 1),
    depth: 0,
    leader: true,
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
      || segments + queue.length + 1 >= TREE_LOD_NEAR.maxSegments
      || nominalLength < height * 0.045
      || branch.radius < height * 0.0032;
    const end = new THREE.Vector3().copy(branch.origin).addScaledVector(branch.direction, nominalLength);
    const depthTaper = 1 - Math.min(0.24, branch.depth * 0.055);
    const inheritedRadius = branch.radius * species.taper * depthTaper;
    const radiusTo = terminal
      ? Math.min(inheritedRadius, Math.max(height * 0.0008, branch.radius * species.twigTaper))
      : inheritedRadius;
    wood.push({ branch, end, radiusTo });
    segments += 1;
    architectureRadius = Math.max(architectureRadius, Math.hypot(end.x, end.z) + branch.radius);
    architectureTop = Math.max(architectureTop, end.y + branch.radius);
    if (terminal) {
      tips.push({ ...branch, origin: end, length: nominalLength, radius: radiusTo });
      continue;
    }

    const requestedForks = branch.depth === 0 ? 4 : random.int(species.forks[0], species.forks[1] + 1);
    const forks = Math.min(requestedForks, TREE_LOD_NEAR.maxSegments - segments - queue.length);
    const forkPhase = random.range(0, Math.PI * 2);
    for (let index = 0; index < forks; index += 1) {
      const continuation = index === 0;
      const childOrigin = continuation
        ? end.clone()
        : new THREE.Vector3().lerpVectors(branch.origin, end,
          branch.depth === 0 ? random.range(0.78, 0.98) : random.range(0.74, 0.96));
      const direction = childDirection(branch, species, index, forks, random, forkPhase);
      const depthShortening = 1 - Math.min(0.2, branch.depth * 0.05);
      const growthLength = branch.depth === 0 ? height * (family === 'dry' ? 0.7 : 0.66) : nominalLength;
      const primaryLeader = family === 'broadleaf' ? 0.92 : family === 'dry' || family === 'ancient' ? 0.64 : 0.78;
      const lengthHierarchy = branch.depth === 0
        ? (continuation ? primaryLeader : random.range(0.96, 1.12))
        : (continuation ? random.range(0.9, 1.04) : random.range(species.lateralLength[0], species.lateralLength[1]));
      const childLength = growthLength * species.lengthDecay * depthShortening * lengthHierarchy;
      const attachmentRadius = THREE.MathUtils.lerp(branch.radius, radiusTo,
        childOrigin.distanceTo(branch.origin) / Math.max(1e-5, nominalLength));
      const childRadius = attachmentRadius * (continuation
        ? random.range(0.9, 0.98)
        : random.range(species.lateralRadius[0], species.lateralRadius[1]));
      queue.push({
        origin: childOrigin,
        direction,
        length: childLength,
        radius: childRadius,
        depth: branch.depth + 1,
        leader: continuation && branch.leader,
      });
    }
  }

  // Keep the complete leader and primary scaffold at distance, then spend the remaining
  // budget on laterals. The former BFS prefix chopped the top off healthy winter trees.
  const priority = (branch: BranchState): number => branch.depth <= 1 ? branch.depth : branch.leader ? 2 : branch.depth + 2;
  const visibleWood = [...wood].sort((a, b) => priority(a.branch) - priority(b.branch)).slice(0, lod.maxSegments);
  for (const { branch, end, radiusTo } of visibleWood) {
    const continues = visibleWood.some(next => next.branch.origin.distanceToSquared(end) < 1e-10);
    const tipRadius = continues ? radiusTo : Math.min(radiusTo, Math.max(height * 0.0008, branch.radius * species.twigTaper));
    bark.tube(branch.origin, end, branch.radius, tipRadius,
      Math.max(3, lod.sides - Math.min(2, branch.depth)), barkColour,
      lod.sides > 3 && branch.depth <= 1);
  }

  // Fund the fuller winter scaffold by retiring four peripheral foliage sites. Hard LOD
  // budgets stay unchanged, and the coherent middle crown does more work than extra sprays.
  const requestedClumps = Math.min(TREE_LOD_NEAR.maxClumps, 22, tips.length * species.clumpsPerTip);
  const sites = createCanopySites(tips, species, grammar, height, requestedClumps, random);
  const visibleClumps = Math.min(sites.length, lod.maxClumps);
  const selected = selectCanopySites(sites, visibleClumps);
  let radius = Math.max(0.1, architectureRadius);
  let crown = Math.max(height, architectureTop);
  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index]!;
    if (selected.has(index)) {
      foliageColour.setScalar(site.shade);
      if (site.tier === 'edge' || (family === 'riverbank' && site.tier === 'middle')) {
        const pairRandom = random.fork(`${site.seed}:pair`);
        const offset = new THREE.Vector3(-site.direction.z, pairRandom.range(-0.12, 0.12), site.direction.x)
          .normalize().multiplyScalar(site.size * 0.3);
        const pendant = family === 'riverbank' && site.tier === 'middle';
        foliage.spray(site.centre.clone().add(offset), site.size * (pendant ? 0.95 : 0.72) * lod.clusterScale,
          site.squash, random.fork(`${site.seed}:spray:a`), foliageColour, site.direction);
        foliage.spray(site.centre.clone().addScaledVector(offset, -0.7), site.size * (pendant ? 0.82 : 0.56) * lod.clusterScale,
          site.squash * 0.9, random.fork(`${site.seed}:spray:b`), foliageColour, site.direction);
      } else {
        const massScale = site.tier === 'core' ? 1 : 0.86;
        foliage.clump(site.centre, site.size * massScale * lod.clusterScale, site.squash * (family === 'riverbank' ? 0.65 : 1),
          random.fork(site.seed), foliageColour);
      }
    }
    // Conservative envelope: paired sprays remain inside ~1.4 site radii including their offset.
    radius = Math.max(radius, Math.hypot(site.centre.x, site.centre.z) + site.size * 1.45);
    crown = Math.max(crown, site.centre.y + site.size * Math.max(0.65, site.squash) * 1.45);
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
  const phase = random.range(0, Math.PI * 2);
  for (let layer = 0; layer < layers; layer++) {
    const fraction = layer / layers;
    const base = lean.clone().multiplyScalar(height * (0.25 + fraction * 0.74));
    const radius = width * (1 - fraction * 0.9) * random.range(0.9, 1.08);
    color.setScalar(0.78 + fraction * 0.19);
    const branchCount = 3;
    const twist = phase + layer * 2.39996 + random.range(-0.2, 0.2);
    for (let branch = 0; branch < branchCount; branch += 1) {
      const angle = twist + branch / branchCount * Math.PI * 2;
      const exposure = family === 'alpine' ? 0.76 + 0.3 * Math.cos(angle - phase) : 1;
      const direction = new THREE.Vector3(Math.cos(angle), family === 'alpine' ? 0.06 : -0.18, Math.sin(angle)).normalize();
      const end = base.clone().addScaledVector(direction, radius * exposure);
      if (segments++ < lod.maxSegments - 1) {
        const branchRadius = height * 0.012 * (1 - fraction * 0.45);
        bark.tube(base, end, branchRadius, Math.max(0.0015, branchRadius * 0.18), 3, barkColour);
      }
      const centre = base.clone().lerp(end, 0.56);
      // Overlapping boughs, alternating windows and lifted tips replace the solid cone stack.
      // Every tier and azimuth survives in far LOD; only subordinate sprays disappear.
      foliage.spray(centre, radius * 0.68, family === 'alpine' ? 0.9 : 1.1,
        random.fork(`bough:${layer}:${branch}`), color, direction);
      if (lod.maxClumps >= 15) {
        foliage.spray(end.clone().addScaledVector(lean, height * 0.025), radius * 0.42, 0.9,
          random.fork(`spray:${layer}:${branch}`), color, direction.clone().setY(0.32));
      }
    }
  }

  color.setScalar(1.02);
  foliage.spray(lean.clone().multiplyScalar(height * 0.94), height * 0.075, 0.72,
    random.fork('leader-foliage'), color, lean);
  bark.tube(new THREE.Vector3(), lean.clone().multiplyScalar(height), height * 0.035, 0.0012,
    lod.sides, barkColour, lod.sides > 3);
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
