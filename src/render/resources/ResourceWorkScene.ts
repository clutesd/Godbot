import type { Person, Vec2, WorldState } from '../../sim/types';
import { WalkabilityLayer } from '../../sim/people/WalkabilityLayer';
import { resourceWorkDestinationId } from '../../sim/people/ResourceWorkRouting';
import { resourceWorkAssignmentsForWorld, type ResourceWorkAssignment } from '../../sim/resources/ResourceWorkAssignments';
import { resourceWorkProfile, resourceWorkStations, resourceWorkerVariation, type ResourceWorkProfile, type ResourceWorkStation, type ResourceWorkerVariation } from '../../sim/resources/ResourceWorkPresentation';

export const MAX_ACTIVE_WORK_SITES = 64;
export interface ResourceWorkTreeTarget extends Vec2 { radius: number; renderId: number }

export interface ResourceWorkSite {
  assignment: ResourceWorkAssignment;
  profile: ResourceWorkProfile;
  origin: Vec2;
  stations: readonly ResourceWorkStation[];
  standingTree: boolean;
  tree?: ResourceWorkTreeTarget;
  developed: boolean;
  signature: string;
}

export interface ResourceWorkerVisual {
  site: ResourceWorkSite;
  station: ResourceWorkStation;
  variation: ResourceWorkerVariation;
  blend: number;
}

/** Shared, bounded scene plan. Rebuilt at ledger updates, never from animation time. */
export class ResourceWorkScene {
  readonly sites = new Map<string, ResourceWorkSite>();
  readonly workers = new Map<string, ResourceWorkerVisual>();
  readonly walking: WalkabilityLayer;
  revision = 0;
  constructor(
    private readonly world: WorldState,
    readonly seed = 'resource-work',
    private readonly standable: (x: number, z: number) => boolean = () => true,
    private readonly treeAt?: (assignment: ResourceWorkAssignment) => ResourceWorkTreeTarget | undefined,
    private readonly developedAt: (settlementId: string) => boolean = () => false,
  ) { this.walking = new WalkabilityLayer(world); }

  update(): void {
    const previous = new Map(this.sites);
    this.sites.clear();
    const assignments = [...resourceWorkAssignmentsForWorld(this.world)]
      .filter(a => a.amountExtracted > 0 && a.labourUsed > 0 && Object.values(a.labourByOccupation).some(n => (n ?? 0) > 0))
      .sort((a, b) => b.labourUsed - a.labourUsed || b.amountExtracted - a.amountExtracted || a.siteId.localeCompare(b.siteId))
      .slice(0, MAX_ACTIVE_WORK_SITES);
    let changed = false;
    for (const assignment of assignments) {
      const key = resourceWorkSiteKey(assignment);
      if (this.sites.has(key)) continue;
      let profile = resourceWorkProfile(assignment);
      const developed = this.developedAt(assignment.settlementId);
      const tree = profile.kind === 'timber' ? this.treeAt?.(assignment) : undefined;
      const source = tree ?? assignment.worldPosition;
      const origin = this.safeOrigin(source, assignment.siteId);
      if (!origin) continue;
      const standingTree = Boolean(tree && Math.hypot(origin.x - tree.x, origin.z - tree.z) < 0.02);
      if (standingTree && tree) profile = { ...profile, workRadius: Math.max(0.08, tree.radius) + 0.13 };
      const stations = resourceWorkStations(origin, profile, this.seed, assignment.siteId, (a, b) => this.safeSegment(a, b));
      if (!stations.length) continue;
      const signature = JSON.stringify([assignment.settlementId, assignment.resourceId, assignment.worldPosition, profile,
        origin, stations, standingTree, tree?.renderId, developed]);
      const old = previous.get(key);
      if (old?.signature === signature) {
        old.assignment = assignment;
        this.sites.set(key, old);
      } else {
        changed = true;
        this.sites.set(key, { assignment, profile, origin, stations, standingTree, tree: standingTree ? tree : undefined, developed, signature });
      }
    }
    if (changed || this.sites.size !== previous.size) this.revision++;
    // Old worker bindings must never outlive the authoritative ledger.
    for (const [id, worker] of this.workers) {
      if (this.sites.get(resourceWorkSiteKey(worker.site.assignment)) !== worker.site) this.workers.delete(id);
    }
  }

  /** Only already-routed real people with contributing occupations may occupy presentation slots. */
  bindWorkers(people: readonly Person[]): void {
    const previous = new Map(this.workers);
    this.workers.clear();
    const occupied = new Map<string, number>();
    for (const person of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
      const destinationId = person.navigation?.destinationId ?? '';
      const site = this.sites.get(`${person.homeId}\u0000${destinationId}`);
      if (!site || !resourceWorkerCanPresent(person, site.assignment)) continue;
      // Shared physical sites have one occupancy budget even when two settlements extract there.
      const mask = occupied.get(destinationId) ?? 0;
      for (let slot = 0; slot < site.stations.length; slot++) {
        if (mask & (1 << slot)) continue;
        const station = site.stations[slot]!;
        if (!this.safeSegment(person.position, station.anchor)) continue;
        const old = previous.get(person.id);
        this.workers.set(person.id, old?.site === site && old.station === station ? old : {
          site, station, variation: resourceWorkerVariation(this.seed, person.id, site.assignment.siteId), blend: 0,
        });
        occupied.set(destinationId, mask | (1 << slot));
        break;
      }
    }
  }

  safeSegment(a: Vec2, b: Vec2): boolean {
    if (!this.walking.isSegmentWalkable(a, b)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.08));
    for (let i = 0; i <= steps; i++) {
      if (!this.standable(a.x + (b.x - a.x) * i / steps, a.z + (b.z - a.z) * i / steps)) return false;
    }
    return true;
  }

  private safeOrigin(source: Vec2, siteId: string): Vec2 | undefined {
    const point = this.walking.nearestWalkable(source, `resource-site:${siteId}`);
    // A distant fallback is not the same worksite. Never draw work across the world.
    if (Math.hypot(point.x - source.x, point.z - source.z) > this.world.cellSize * 1.5) return undefined;
    if (this.standable(point.x, point.z)) return point;
    for (let ring = 1; ring <= 8; ring++) for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const candidate = { x: point.x + Math.cos(angle) * ring * 0.15, z: point.z + Math.sin(angle) * ring * 0.15 };
      if (this.walking.isWalkable(candidate) && this.standable(candidate.x, candidate.z)) return candidate;
    }
    return undefined;
  }
}

export function resourceWorkerCanPresent(person: Person, assignment: ResourceWorkAssignment): boolean {
  return person.homeId === assignment.settlementId
    && person.navigation?.destinationId === resourceWorkDestinationId(assignment)
    && person.alive && person.activity === 'gather' && !person.navigation?.traveling
    && person.navigation?.schedulePhase !== 'emergency' && person.displacedSinceMonth === undefined
    && person.health > 0.2 && person.role !== 'soldier' && person.role !== 'guard'
    && assignment.gatherOccupations.includes(person.occupation)
    && (assignment.labourByOccupation[person.occupation] ?? 0) > 0;
}

export function resourceWorkSiteKey(assignment: ResourceWorkAssignment): string {
  return `${assignment.settlementId}\u0000${resourceWorkDestinationId(assignment)}`;
}
