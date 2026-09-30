import * as THREE from 'three';

/**
 * Read-only, presentation-side description of the substantial geometry the documentary lens must
 * respect. The renderer owns what is actually drawn (footprints, roof overhangs, scaffolds,
 * infrastructure, vessels, work props); the CameraDirector only queries this field. Nothing here
 * touches simulation state or randomness.
 */
export type CameraObstacleKind = 'building' | 'scaffold' | 'infrastructure' | 'landmark' | 'vessel' | 'prop';

export interface CameraObstacleBox {
  readonly id: string;
  readonly kind: CameraObstacleKind;
  readonly worldX: number;
  readonly worldZ: number;
  /** Wall-body half extents in the box's local frame; +Z is the entrance side. */
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly rotationY: number;
  readonly baseY: number;
  /** Top of the walls. Above this the (wider) roof cap applies. */
  readonly eaveY: number;
  readonly topY: number;
  /** Roof extends this far beyond the walls on every side. */
  readonly overhang: number;
  /** 0..1: visible construction / work happening here. */
  readonly activity?: number;
  readonly major?: boolean;
  /** Industrial/large roofline worth framing (chimney, stack, vent). */
  readonly stack?: boolean;
  /** Buildings and landmarks have an entrance on local +Z unless stated otherwise. */
  readonly entrance?: boolean;
}

const GRID_CELL = 4;
const GRID_OFFSET = 4096;
const GRID_STRIDE = 8192;

const cellKey = (cx: number, cz: number): number => (cx + GRID_OFFSET) * GRID_STRIDE + (cz + GRID_OFFSET);
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function hashUnit(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(31, hash) + id.charCodeAt(index) | 0;
  return (hash >>> 0) / 4_294_967_296;
}

/** World → box-local (x right, z entrance) using the same convention as Object3D.rotation.y. */
function toLocal(box: CameraObstacleBox, x: number, z: number, out: { x: number; z: number }): void {
  const dx = x - box.worldX;
  const dz = z - box.worldZ;
  const cos = Math.cos(box.rotationY);
  const sin = Math.sin(box.rotationY);
  out.x = dx * cos - dz * sin;
  out.z = dx * sin + dz * cos;
}

const scratch = { x: 0, z: 0 };
const scratchDir = { x: 0, z: 0 };

function slab(origin: number, direction: number, min: number, max: number, range: { near: number; far: number }): boolean {
  if (Math.abs(direction) < 1e-9) return origin >= min && origin <= max;
  let near = (min - origin) / direction;
  let far = (max - origin) / direction;
  if (near > far) { const swap = near; near = far; far = swap; }
  range.near = Math.max(range.near, near);
  range.far = Math.min(range.far, far);
  return range.near <= range.far;
}

export class CameraObstacleField {
  private boxes: readonly CameraObstacleBox[] = [];
  private readonly grid = new Map<number, number[]>();
  revision = 0;

  get size(): number { return this.boxes.length; }
  all(): readonly CameraObstacleBox[] { return this.boxes; }

  set(boxes: readonly CameraObstacleBox[]): void {
    this.boxes = boxes;
    this.grid.clear();
    boxes.forEach((box, index) => {
      // Registered with a generous margin so padded point queries need only one cell lookup.
      const reach = Math.hypot(box.halfWidth + box.overhang, box.halfDepth + box.overhang) + 1.5;
      const x0 = Math.floor((box.worldX - reach) / GRID_CELL), x1 = Math.floor((box.worldX + reach) / GRID_CELL);
      const z0 = Math.floor((box.worldZ - reach) / GRID_CELL), z1 = Math.floor((box.worldZ + reach) / GRID_CELL);
      for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) {
        const key = cellKey(cx, cz);
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(index); else this.grid.set(key, [index]);
      }
    });
    this.revision += 1;
  }

  clear(): void { this.set([]); }

  /** Boxes whose centre is within `radius` of the point (deduplicated, stable order). */
  nearby(x: number, z: number, radius: number): CameraObstacleBox[] {
    const seen = new Set<number>();
    const result: CameraObstacleBox[] = [];
    const x0 = Math.floor((x - radius) / GRID_CELL), x1 = Math.floor((x + radius) / GRID_CELL);
    const z0 = Math.floor((z - radius) / GRID_CELL), z1 = Math.floor((z + radius) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) {
      for (const index of this.grid.get(cellKey(cx, cz)) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const box = this.boxes[index]!;
        if (Math.hypot(box.worldX - x, box.worldZ - z) <= radius) result.push(box);
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Hard lens occupancy: is a point (with padding) inside walls or under the roof cap? */
  probe = (position: THREE.Vector3, padding: number): number => {
    let obstruction = 0;
    for (const index of this.grid.get(cellKey(Math.floor(position.x / GRID_CELL), Math.floor(position.z / GRID_CELL))) ?? []) {
      const box = this.boxes[index]!;
      toLocal(box, position.x, position.z, scratch);
      const inBody = Math.abs(scratch.x) < box.halfWidth + padding && Math.abs(scratch.z) < box.halfDepth + padding
        && position.y > box.baseY - 0.2 && position.y < box.eaveY + padding;
      const inRoof = Math.abs(scratch.x) < box.halfWidth + box.overhang + padding
        && Math.abs(scratch.z) < box.halfDepth + box.overhang + padding
        && position.y >= box.eaveY - 0.02 && position.y < box.topY + padding;
      if (!inBody && !inRoof) continue;
      const nx = 1 - clamp01(Math.abs(scratch.x) / (box.halfWidth + box.overhang + padding));
      const nz = 1 - clamp01(Math.abs(scratch.z) / (box.halfDepth + box.overhang + padding));
      obstruction = Math.max(obstruction, 2.4 + Math.min(nx, nz) * 2.4);
    }
    return obstruction;
  };

  boxContaining(position: THREE.Vector3, padding: number): CameraObstacleBox | undefined {
    for (const index of this.grid.get(cellKey(Math.floor(position.x / GRID_CELL), Math.floor(position.z / GRID_CELL))) ?? []) {
      const box = this.boxes[index]!;
      toLocal(box, position.x, position.z, scratch);
      const inBody = Math.abs(scratch.x) < box.halfWidth + padding && Math.abs(scratch.z) < box.halfDepth + padding
        && position.y > box.baseY - 0.2 && position.y < box.eaveY + padding;
      const inRoof = Math.abs(scratch.x) < box.halfWidth + box.overhang + padding
        && Math.abs(scratch.z) < box.halfDepth + box.overhang + padding
        && position.y >= box.eaveY - 0.02 && position.y < box.topY + padding;
      if (inBody || inRoof) return box;
    }
    return undefined;
  }

  /** True when the point sits beneath a roof cap (an eave or overhang) — a poor place for a lens. */
  coveredAbove(position: THREE.Vector3, padding = 0.1): boolean {
    for (const index of this.grid.get(cellKey(Math.floor(position.x / GRID_CELL), Math.floor(position.z / GRID_CELL))) ?? []) {
      const box = this.boxes[index]!;
      toLocal(box, position.x, position.z, scratch);
      if (Math.abs(scratch.x) < box.halfWidth + box.overhang + padding
        && Math.abs(scratch.z) < box.halfDepth + box.overhang + padding
        && position.y < box.eaveY + 0.05 && position.y > box.baseY - 0.2) return true;
    }
    return false;
  }

  /** Nearest hit distance along a normalised ray, or undefined. Walls and roof cap are separate slabs. */
  rayHit(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): number | undefined {
    const endX = origin.x + direction.x * maxDistance;
    const endZ = origin.z + direction.z * maxDistance;
    const x0 = Math.floor((Math.min(origin.x, endX) - 1) / GRID_CELL), x1 = Math.floor((Math.max(origin.x, endX) + 1) / GRID_CELL);
    const z0 = Math.floor((Math.min(origin.z, endZ) - 1) / GRID_CELL), z1 = Math.floor((Math.max(origin.z, endZ) + 1) / GRID_CELL);
    let best: number | undefined;
    const seen = new Set<number>();
    const range = { near: 0, far: 0 };
    for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) {
      for (const index of this.grid.get(cellKey(cx, cz)) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const box = this.boxes[index]!;
        toLocal(box, origin.x, origin.z, scratch);
        const cos = Math.cos(box.rotationY), sin = Math.sin(box.rotationY);
        scratchDir.x = direction.x * cos - direction.z * sin;
        scratchDir.z = direction.x * sin + direction.z * cos;
        const parts: ReadonlyArray<readonly [number, number, number, number]> = [
          [box.halfWidth, box.halfDepth, box.baseY - 0.2, box.eaveY],
          [box.halfWidth + box.overhang, box.halfDepth + box.overhang, box.eaveY, box.topY],
        ];
        for (const [hw, hd, y0, y1] of parts) {
          range.near = 0; range.far = maxDistance;
          if (!slab(scratch.x, scratchDir.x, -hw, hw, range)) continue;
          if (!slab(scratch.z, scratchDir.z, -hd, hd, range)) continue;
          if (!slab(origin.y, direction.y, y0, y1, range)) continue;
          if (best === undefined || range.near < best) best = range.near;
        }
      }
    }
    return best;
  }

  /** Is the straight segment blocked before its last `ignoreEnd` units (so a façade target is not its own occluder)? */
  segmentBlocked(from: THREE.Vector3, to: THREE.Vector3, ignoreEnd = 0.25): boolean {
    const length = from.distanceTo(to);
    if (length <= ignoreEnd + 0.01) return false;
    const direction = to.clone().sub(from).multiplyScalar(1 / length);
    return this.rayHit(from, direction, length - ignoreEnd) !== undefined;
  }
}

/** Combines hard lens probes; the strongest obstruction wins. */
export function combineCameraProbes(
  ...probes: ReadonlyArray<((position: THREE.Vector3, padding: number) => number) | undefined>
): ((position: THREE.Vector3, padding: number) => number) | undefined {
  const active = probes.filter((probe): probe is (position: THREE.Vector3, padding: number) => number => Boolean(probe));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return (position, padding) => {
    let obstruction = 0;
    for (const probe of active) obstruction = Math.max(obstruction, probe(position, padding));
    return obstruction;
  };
}

// ---------------------------------------------------------------------------------------------
// Readable exterior anchors
// ---------------------------------------------------------------------------------------------

export type CameraAnchorFeature = 'entrance' | 'facade' | 'work-yard' | 'machinery' | 'roofline';

export interface CameraAnchor {
  readonly boxId: string;
  readonly feature: CameraAnchorFeature;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Direction (atan2(z, x)) from the anchor to where the lens should stand. */
  readonly azimuth: number;
  /** Smallest comfortable camera distance so the wall/roof cannot fill the frame. */
  readonly minStandoff: number;
  readonly score: number;
}

export interface CameraAnchorRequest {
  readonly focusX: number;
  readonly focusZ: number;
  readonly viewerX: number;
  readonly viewerZ: number;
  readonly searchRadius: number;
  readonly seed: string;
  readonly kind: 'settlement-approach' | 'institution-exterior' | 'infrastructure-scene';
  readonly avoid?: ReadonlySet<string>;
}

const FEATURE_WEIGHT: Record<CameraAnchorRequest['kind'], Record<CameraAnchorFeature, number>> = {
  'institution-exterior': { entrance: 0.45, facade: 0.2, 'work-yard': 0.18, machinery: 0.1, roofline: 0.05 },
  'settlement-approach': { entrance: 0.26, facade: 0.18, 'work-yard': 0.3, machinery: 0.12, roofline: 0.08 },
  'infrastructure-scene': { entrance: 0.05, facade: 0.08, 'work-yard': 0.32, machinery: 0.46, roofline: 0.2 },
};

/** All candidate anchors of one obstacle, each already oriented toward the viewer where that matters. */
export function anchorsForObstacle(box: CameraObstacleBox, viewerX: number, viewerZ: number): CameraAnchor[] {
  const cos = Math.cos(box.rotationY), sin = Math.sin(box.rotationY);
  const ex = { x: cos, z: -sin };
  const ez = { x: sin, z: cos };
  const height = Math.max(0.4, box.eaveY - box.baseY);
  const reach = Math.hypot(box.halfWidth + box.overhang, box.halfDepth + box.overhang);
  const minStandoff = reach + 1.4;
  const anchors: CameraAnchor[] = [];
  const push = (feature: CameraAnchorFeature, x: number, y: number, z: number, nx: number, nz: number): void => {
    anchors.push({ boxId: box.id, feature, x, y, z, azimuth: Math.atan2(nz, nx), minStandoff, score: 0 });
  };
  const out = 0.25 + box.overhang;

  if (box.kind === 'building' || box.kind === 'landmark' || box.kind === 'scaffold') {
    const faces = [
      { n: ez, half: box.halfDepth },
      { n: { x: -ez.x, z: -ez.z }, half: box.halfDepth },
      { n: ex, half: box.halfWidth },
      { n: { x: -ex.x, z: -ex.z }, half: box.halfWidth },
    ];
    faces.forEach((face, index) => {
      const distance = face.half + out;
      const x = box.worldX + face.n.x * distance;
      const z = box.worldZ + face.n.z * distance;
      if (index === 0 && box.entrance !== false && box.kind !== 'scaffold') {
        push('entrance', x, box.baseY + THREE.MathUtils.clamp(height * 0.4, 0.65, 1.1), z, face.n.x, face.n.z);
      } else {
        push('facade', x, box.baseY + THREE.MathUtils.clamp(height * 0.55, 0.7, 1.6), z, face.n.x, face.n.z);
      }
    });
    if ((box.activity ?? 0) > 0.05 || box.kind === 'scaffold') {
      const yard = box.halfDepth + box.overhang + 1;
      push('work-yard', box.worldX + ez.x * yard, box.baseY + 0.7, box.worldZ + ez.z * yard, ez.x, ez.z);
    }
    if (box.stack) {
      push('roofline', box.worldX - ez.x * box.halfDepth * 0.4, box.topY, box.worldZ - ez.z * box.halfDepth * 0.4,
        ez.x * 0.6 + ex.x * 0.4, ez.z * 0.6 + ex.z * 0.4);
    }
  } else if (box.kind === 'infrastructure') {
    const toViewer = Math.atan2(viewerZ - box.worldZ, viewerX - box.worldX) + 0.5;
    push('machinery', box.worldX, box.baseY + (box.topY - box.baseY) * 0.55, box.worldZ, Math.cos(toViewer), Math.sin(toViewer));
    const yardAngle = toViewer - 1.1;
    push('work-yard', box.worldX + Math.cos(yardAngle) * (reach + 0.9), box.baseY + 0.7, box.worldZ + Math.sin(yardAngle) * (reach + 0.9),
      Math.cos(yardAngle), Math.sin(yardAngle));
  }
  return anchors;
}

/**
 * Deterministically picks a readable exterior subject near a focus: an entrance, façade, work yard,
 * machine or roofline that faces the approaching lens, not the geometric centre of a plot.
 */
export function chooseExteriorAnchor(field: CameraObstacleField, request: CameraAnchorRequest): CameraAnchor | undefined {
  const weights = FEATURE_WEIGHT[request.kind];
  let best: CameraAnchor | undefined;
  for (const box of field.nearby(request.focusX, request.focusZ, request.searchRadius)) {
    if (box.kind === 'prop' || box.kind === 'vessel') continue;
    const distance = Math.hypot(box.worldX - request.focusX, box.worldZ - request.focusZ);
    const proximity = (1 - clamp01(distance / Math.max(1, request.searchRadius))) * 0.9;
    const size = Math.min(0.2, (box.halfWidth * box.halfDepth * 4) / 8);
    const boxScore = proximity + (box.activity ?? 0) * 0.55 + (box.major ? 0.18 : 0) + size
      - (request.avoid?.has(box.id) ? 0.5 : 0);
    for (const anchor of anchorsForObstacle(box, request.viewerX, request.viewerZ)) {
      const toViewerX = request.viewerX - anchor.x, toViewerZ = request.viewerZ - anchor.z;
      const toViewerLength = Math.hypot(toViewerX, toViewerZ);
      const facing = toViewerLength > 0.01
        ? (Math.cos(anchor.azimuth) * toViewerX + Math.sin(anchor.azimuth) * toViewerZ) / toViewerLength
        : 0;
      const score = boxScore + facing * 0.4 + weights[anchor.feature]
        + hashUnit(`${request.seed}:${box.id}:${anchor.feature}`) * 0.03;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && anchor.boxId.localeCompare(best.boxId) < 0)) {
        best = { ...anchor, score };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Frame assessment
// ---------------------------------------------------------------------------------------------

export interface FrameAssessmentOptions {
  readonly fovDegrees?: number;
  readonly aspect?: number;
  readonly subjects?: readonly THREE.Vector3[];
  /** Soft geometry (foliage): counted toward frame dominance but never a hard collision. */
  readonly softProbe?: (position: THREE.Vector3, padding: number) => number;
}

export interface FrameAssessment {
  /** 0 (unusable) .. 1 (clean). */
  readonly quality: number;
  /** Weighted fraction of the frame occupied by foreground geometry. */
  readonly dominance: number;
  readonly nearestSurface: number;
  /** Fraction of subject points with no clear line from the lens. */
  readonly subjectBlocked: number;
  readonly covered: boolean;
  readonly obstructed: boolean;
  readonly dominated: boolean;
}

const FAN_U = [-1, -0.5, 0, 0.5, 1] as const;
const FAN_V = [-1, 0, 1] as const;
const upAxis = new THREE.Vector3(0, 1, 0);

export function assessFrame(
  field: CameraObstacleField,
  position: THREE.Vector3,
  target: THREE.Vector3,
  options: FrameAssessmentOptions = {},
): FrameAssessment {
  const forward = target.clone().sub(position);
  const distance = forward.length();
  if (distance < 0.05) {
    return { quality: 1, dominance: 0, nearestSurface: Infinity, subjectBlocked: 0, covered: false, obstructed: false, dominated: false };
  }
  forward.multiplyScalar(1 / distance);
  const right = new THREE.Vector3().crossVectors(forward, upAxis);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const vHalf = THREE.MathUtils.degToRad((options.fovDegrees ?? 38) / 2);
  const aspect = options.aspect ?? 16 / 9;
  const tanV = Math.tan(vHalf) * 0.85;
  const tanH = Math.tan(vHalf) * aspect * 0.85;
  const nearLimit = THREE.MathUtils.clamp(distance * 0.4, 1, 3.4);
  const range = Math.max(nearLimit + 2, 6);

  const direction = new THREE.Vector3();
  const probePoint = new THREE.Vector3();
  let weightTotal = 0, blockedWeight = 0, nearest = Infinity;
  for (const v of FAN_V) for (const u of FAN_U) {
    direction.copy(forward).addScaledVector(right, tanH * u).addScaledVector(up, tanV * v).normalize();
    const weight = u === 0 ? 1.5 : Math.abs(u) === 0.5 ? 1.2 : 1;
    weightTotal += weight;
    const hit = field.rayHit(position, direction, range);
    if (hit !== undefined) {
      nearest = Math.min(nearest, hit);
      // Closer blockers own more of the frame than ones at the edge of the near zone.
      if (hit < nearLimit) { blockedWeight += weight * (0.7 + 0.6 * (1 - hit / nearLimit)); continue; }
    }
    // Foliage is sampled on the horizontal centre row only, and that row stands in for its whole
    // column (three rows, softened): full-frame canopy dominance without probing every ray.
    if (options.softProbe && v === 0) {
      for (let step = 0.35; step < nearLimit; step += 0.35) {
        probePoint.copy(position).addScaledVector(direction, step);
        if (options.softProbe(probePoint, 0.1) > 0.001) { blockedWeight += weight * 1.8; break; }
      }
    }
  }
  const dominance = weightTotal > 0 ? Math.min(1, blockedWeight / weightTotal) : 0;

  const subjects = options.subjects?.length ? options.subjects : [target];
  let blockedSubjects = 0;
  for (const subject of subjects) if (field.segmentBlocked(position, subject, 0.3)) blockedSubjects += 1;
  const subjectBlocked = blockedSubjects / subjects.length;
  const covered = field.coveredAbove(position);

  const quality = clamp01(1 - dominance * 1.2 - subjectBlocked * 0.55 - (covered ? 0.12 : 0) - (nearest < 0.7 ? 0.1 : 0));
  const obstructed = subjectBlocked >= 0.66;
  const dominated = dominance >= 0.3 || (nearest < 0.55 && dominance >= 0.2) || (covered && dominance >= 0.22);
  return { quality, dominance, nearestSurface: nearest, subjectBlocked, covered, obstructed, dominated };
}

// ---------------------------------------------------------------------------------------------
// Bad-frame watchdog
// ---------------------------------------------------------------------------------------------

export type FrameVerdict = 'ok' | 'reframe' | 'retire';

export interface FrameSample {
  readonly quality: number;
  readonly obstructed: boolean;
  readonly dominated: boolean;
  /** Lens speed over the sampled interval, world units per second. */
  readonly speed: number;
  /** Safety code moved/held the lens during most of the interval. */
  readonly corrected: boolean;
}

export interface FrameWatchdogTuning {
  readonly graceSeconds: number;
  readonly badSeconds: number;
  readonly stallSeconds: number;
  readonly reframeGraceSeconds: number;
  readonly tinySpeed: number;
  readonly goodQuality: number;
  readonly improvement: number;
}

export const DEFAULT_FRAME_WATCHDOG: FrameWatchdogTuning = {
  graceSeconds: 1,
  badSeconds: 1.6,
  stallSeconds: 3,
  reframeGraceSeconds: 1.8,
  tinySpeed: 0.35,
  goodQuality: 0.78,
  improvement: 0.12,
};

/**
 * Judges whether a held composition has failed. Strong frames are left alone (their breathing is
 * never counted). A frame is bad when it stays obstructed/dominated, or when safety corrections keep
 * nudging the lens by tiny amounts while composition quality does not meaningfully improve. The first
 * failure asks for one nearby reframe; a second failure retires the shot.
 */
export class CameraFrameWatchdog {
  private age = 0;
  private badSeconds = 0;
  private stallSeconds = 0;
  private baselineQuality = 1;
  private graceUntil: number;
  private reframes = 0;
  goodSeconds = 0;
  lastQuality = 1;

  constructor(private readonly tuning: FrameWatchdogTuning = DEFAULT_FRAME_WATCHDOG) {
    this.graceUntil = tuning.graceSeconds;
  }

  get reframeAttempts(): number { return this.reframes; }

  reset(): void {
    this.age = 0;
    this.badSeconds = 0;
    this.stallSeconds = 0;
    this.baselineQuality = 1;
    this.reframes = 0;
    this.goodSeconds = 0;
    this.lastQuality = 1;
    this.graceUntil = this.tuning.graceSeconds;
  }

  update(deltaSeconds: number, sample: FrameSample): FrameVerdict {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.age += dt;
    this.lastQuality = sample.quality;
    const good = sample.quality >= this.tuning.goodQuality && !sample.obstructed && !sample.dominated;
    this.goodSeconds = good ? this.goodSeconds + dt : 0;
    if (this.age < this.graceUntil) {
      this.baselineQuality = sample.quality;
      return 'ok';
    }

    const bad = sample.obstructed || sample.dominated;
    this.badSeconds = bad ? this.badSeconds + dt : Math.max(0, this.badSeconds - dt * 2);

    const tinyCorrection = sample.corrected && sample.speed < this.tuning.tinySpeed && sample.quality < this.tuning.goodQuality;
    if (sample.quality > this.baselineQuality + this.tuning.improvement) {
      this.baselineQuality = sample.quality;
      this.stallSeconds = 0;
    } else if (tinyCorrection) {
      this.stallSeconds += dt;
    } else {
      this.stallSeconds = Math.max(0, this.stallSeconds - dt * 1.5);
      if (!sample.corrected) this.baselineQuality = Math.max(this.baselineQuality * 0.98, sample.quality);
    }

    if (this.badSeconds < this.tuning.badSeconds && this.stallSeconds < this.tuning.stallSeconds) return 'ok';
    if (this.reframes >= 1) return 'retire';
    this.reframes += 1;
    this.badSeconds = 0;
    this.stallSeconds = 0;
    this.baselineQuality = sample.quality;
    this.graceUntil = this.age + this.tuning.reframeGraceSeconds;
    return 'reframe';
  }
}

// ---------------------------------------------------------------------------------------------
// Flight routing and escape
// ---------------------------------------------------------------------------------------------

/** The first obstacle whose padded volume (padding up to ~1.4) contains the point, if any. */
export function obstacleAt(field: CameraObstacleField, position: THREE.Vector3, padding: number): CameraObstacleBox | undefined {
  return field.boxContaining(position, padding);
}

/** Would a straight flight leg pass within `clearance` of an obstacle (ignoring a start already inside one)? */
export function flightLineBlocked(field: CameraObstacleField, from: THREE.Vector3, to: THREE.Vector3, clearance = 0.6): boolean {
  const skip = field.boxContaining(from, clearance) ? 1 : 0;
  return segmentHitsField(field, from, to, clearance, skip) !== undefined;
}

function segmentHitsField(field: CameraObstacleField, from: THREE.Vector3, to: THREE.Vector3, clearance: number, skip: number): CameraObstacleBox | undefined {
  const length = from.distanceTo(to);
  const steps = Math.max(1, Math.ceil(length / 0.35));
  const point = new THREE.Vector3();
  for (let index = 0; index <= steps; index += 1) {
    if ((index / steps) * length < skip) continue;
    point.lerpVectors(from, to, index / steps);
    const box = obstacleAt(field, point, clearance);
    if (box) return box;
  }
  return undefined;
}

/**
 * Bends a flight route around buildings, scaffolds and infrastructure it would otherwise cut through.
 * Each blocked leg is re-routed via the padded corner of the blocking footprint that gives the
 * shortest clear detour; if no corner is clear the route goes over the top instead. Terrain routing
 * stays authoritative for altitude: detour waypoints never sit below the leg they replace.
 */
export function detourRouteAroundObstacles(
  field: CameraObstacleField,
  route: readonly THREE.Vector3[],
  elevationAt: (x: number, z: number) => number,
  options: { clearance?: number; margin?: number } = {},
): THREE.Vector3[] {
  if (field.size === 0 || route.length < 2) return route.map(point => point.clone());
  const clearance = options.clearance ?? 0.6;
  const margin = options.margin ?? 1;
  const result: THREE.Vector3[] = [route[0]!.clone()];
  for (let index = 1; index < route.length; index += 1) {
    const to = route[index]!;
    // Terrain routing knows nothing of buildings: a waypoint that lands inside one is not a place to go.
    if (index < route.length - 1 && field.boxContaining(to, clearance)) continue;
    let from = result[result.length - 1]!;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const skip = obstacleAt(field, from, clearance) ? 1 : 0;
      const box = segmentHitsField(field, from, to, clearance, skip);
      if (!box) break;
      const cos = Math.cos(box.rotationY), sin = Math.sin(box.rotationY);
      const hw = box.halfWidth + box.overhang + margin, hd = box.halfDepth + box.overhang + margin;
      const y = Math.max(from.y, to.y);
      let best: THREE.Vector3 | undefined;
      let bestLength = Infinity;
      for (const [lx, lz] of [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]] as const) {
        const x = box.worldX + lx * cos + lz * sin;
        const z = box.worldZ - lx * sin + lz * cos;
        const corner = new THREE.Vector3(x, Math.max(y, elevationAt(x, z) + 1.2), z);
        if (obstacleAt(field, corner, clearance)) continue;
        if (skip === 0 && segmentHitsField(field, from, corner, clearance, 0)) continue;
        const length = from.distanceTo(corner) + corner.distanceTo(to);
        if (length < bestLength) { bestLength = length; best = corner; }
      }
      if (!best) best = new THREE.Vector3(box.worldX, Math.max(y, box.topY + clearance + 0.8), box.worldZ);
      if (from.distanceTo(best) < 0.4) break;
      result.push(best);
      from = best;
    }
    if (result[result.length - 1]!.distanceTo(to) >= 0.4 || index === route.length - 1) result.push(to.clone());
  }
  return result;
}

/**
 * A short, clear, uncovered hop out of a pocket the lens has wedged into (a corner, an eave, a gap
 * between props). Prefers openness and progress toward the goal; the caller validates the sweep.
 */
export function findEscapeWaypoint(
  field: CameraObstacleField | undefined,
  from: THREE.Vector3,
  goal: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  isSweepSafe: (to: THREE.Vector3) => boolean,
  clearance = 0.9,
): THREE.Vector3 | undefined {
  let best: THREE.Vector3 | undefined;
  let bestScore = Infinity;
  const direction = new THREE.Vector3();
  for (const distance of [2.5, 4, 6]) for (const lift of [0, 1.2, 2.6]) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      const x = from.x + Math.cos(angle) * distance, z = from.z + Math.sin(angle) * distance;
      const point = new THREE.Vector3(x, Math.max(from.y + lift, elevationAt(x, z) + clearance), z);
      if (field && (field.probe(point, 0.4) > 0 || field.coveredAbove(point, 0.4))) continue;
      let openness = 3;
      if (field) {
        for (let ray = 0; ray < 8; ray += 1) {
          const a = (ray / 8) * Math.PI * 2;
          direction.set(Math.cos(a), 0, Math.sin(a));
          openness = Math.min(openness, field.rayHit(point, direction, 3) ?? 3);
        }
      }
      if (openness < 1.2) continue;
      if (!isSweepSafe(point)) continue;
      const score = point.distanceTo(goal) - openness * 0.6 + lift * 0.5 + distance * 0.15;
      if (score < bestScore - 1e-9) { bestScore = score; best = point; }
    }
  }
  return best;
}
