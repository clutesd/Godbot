import type { Person, Vec2 } from '../../sim/types';

/**
 * Who stands behind a market table and who stands in front of it.
 *
 * The stalls are the ones the settlement renderer actually placed, with their real table rotation,
 * so a vendor is behind their own counter and customers are at its frontage. Attendance, roles and
 * the goods on the table are all simulation facts; this layer only decides which of the people
 * already at the market occupy which side of which table.
 */

export interface MarketStall {
  id: string;
  worldX: number;
  worldZ: number;
  /** Table rotation as placed by the renderer; +z of the unrotated stall is its customer side. */
  rotationY: number;
  width: number;
  depth: number;
}

export type MarketStallRole = 'vendor' | 'customer';

export interface MarketStallAssignment {
  stall: MarketStall;
  role: MarketStallRole;
  /** Where the person stands. */
  socket: Vec2;
  /** The table itself: what they face and work over. */
  table: Vec2;
  facing: number;
  /** Deterministic socket identity, used as the local-activity re-anchor key. */
  key: string;
}

const VENDOR_ROLES = new Set(['trader', 'merchant']);
/** Vendor standing depth behind the table, and customer depth in front of it. */
const VENDOR_SETBACK = 0.52;
const CUSTOMER_SETBACK = 0.62;
const CUSTOMER_SLOTS = [-0.26, 0.26, 0] as const;
/** A stall is only a plausible post for someone already standing this close to the market. */
const MAX_STALL_DISTANCE = 5.5;

export function isMarketVendor(person: Person): boolean {
  return VENDOR_ROLES.has(person.role ?? '') && person.activity === 'trade';
}

function stallSocket(stall: MarketStall, role: MarketStallRole, lateral: number): { socket: Vec2; table: Vec2; facing: number } {
  // The settlement renderer rotates each stall so its +z side points radially away from the market
  // anchor. Vendors therefore stand on that outward side, behind their table, and shoppers stand
  // on the -z side, in the open middle of the market where people actually circulate.
  const cos = Math.cos(stall.rotationY);
  const sin = Math.sin(stall.rotationY);
  const toWorld = (x: number, z: number): Vec2 => ({
    x: stall.worldX + x * cos + z * sin,
    z: stall.worldZ - x * sin + z * cos,
  });
  const depth = role === 'vendor' ? VENDOR_SETBACK : -CUSTOMER_SETBACK;
  const socket = toWorld(lateral, depth);
  const table = toWorld(lateral * 0.5, 0);
  return { socket, table, facing: Math.atan2(table.x - socket.x, table.z - socket.z) };
}

/**
 * Assigns vendors to counters and shoppers to frontages. Deterministic: stalls and people are
 * both visited in stable id order, nearest plausible stall first. People who get no socket are
 * left to the ordinary conversational market grammar.
 */
export function assignMarketStalls(
  people: readonly Person[],
  stalls: readonly MarketStall[],
  options: { standable?: (point: Vec2) => boolean; maxCustomersPerStall?: number } = {},
): Map<string, MarketStallAssignment> {
  const result = new Map<string, MarketStallAssignment>();
  if (stalls.length === 0) return result;
  const standable = options.standable ?? (() => true);
  const maxCustomers = Math.max(0, Math.min(CUSTOMER_SLOTS.length, options.maxCustomersPerStall ?? 2));
  const ordered = [...stalls].sort((a, b) => a.id.localeCompare(b.id));
  const vendorTaken = new Set<string>();
  const customerTaken = new Map<string, number>();

  const nearest = (person: Person, filter: (stall: MarketStall) => boolean): MarketStall | undefined => {
    let best: MarketStall | undefined;
    let bestDistance = MAX_STALL_DISTANCE;
    for (const stall of ordered) {
      if (!filter(stall)) continue;
      const distance = Math.hypot(stall.worldX - person.position.x, stall.worldZ - person.position.z);
      if (distance < bestDistance) { best = stall; bestDistance = distance; }
    }
    return best;
  };

  const claim = (person: Person, stall: MarketStall, role: MarketStallRole, lateral: number): boolean => {
    const placed = stallSocket(stall, role, lateral);
    if (!standable(placed.socket)) return false;
    result.set(person.id, {
      stall, role, socket: placed.socket, table: placed.table, facing: placed.facing,
      key: `${stall.id}:${role}:${lateral.toFixed(2)}`,
    });
    return true;
  };

  // Vendors first: a counter with nobody behind it is what makes a market look abandoned.
  for (const person of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isMarketVendor(person)) continue;
    const stall = nearest(person, candidate => !vendorTaken.has(candidate.id));
    if (!stall) continue;
    if (claim(person, stall, 'vendor', 0)) vendorTaken.add(stall.id);
  }

  if (maxCustomers === 0) return result;
  for (const person of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
    if (result.has(person.id) || isMarketVendor(person)) continue;
    if (person.activity !== 'socialize' && person.activity !== 'trade') continue;
    const stall = nearest(person, candidate => (customerTaken.get(candidate.id) ?? 0) < maxCustomers
      // Shoppers gather at served tables before unattended ones.
      && (vendorTaken.has(candidate.id) || vendorTaken.size === 0));
    if (!stall) continue;
    const slot = customerTaken.get(stall.id) ?? 0;
    if (claim(person, stall, 'customer', CUSTOMER_SLOTS[slot]!)) customerTaken.set(stall.id, slot + 1);
  }
  return result;
}

/** Stable signature so local choreography re-anchors only when the stall plan really changed. */
export function marketStallSignature(stalls: readonly MarketStall[]): string {
  return stalls.map(stall => `${stall.id}:${stall.worldX.toFixed(2)}:${stall.worldZ.toFixed(2)}:${stall.rotationY.toFixed(2)}`).join('|');
}
