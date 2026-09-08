function hashString(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

export class SeededRandom {
  readonly seed: string;
  private state: number;

  constructor(seed: string, state?: number) {
    this.seed = seed;
    this.state = state ?? hashString(seed);
  }

  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  int(min: number, maxExclusive: number): number {
    if (maxExclusive <= min) return min;
    return Math.floor(this.range(min, maxExclusive));
  }

  chance(probability: number): boolean {
    return this.float() < Math.max(0, Math.min(1, probability));
  }

  pick<T>(values: readonly T[]): T {
    const value = values[this.int(0, values.length)];
    if (value === undefined) throw new Error('Cannot pick from an empty collection');
    return value;
  }

  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    if (total <= 0) return this.int(0, weights.length);
    let cursor = this.range(0, total);
    for (let index = 0; index < weights.length; index += 1) {
      cursor -= Math.max(0, weights[index] ?? 0);
      if (cursor <= 0) return index;
    }
    return Math.max(0, weights.length - 1);
  }

  gaussian(mean = 0, deviation = 1): number {
    const first = Math.max(Number.EPSILON, this.float());
    const second = this.float();
    return mean + Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second) * deviation;
  }

  fork(label: string): SeededRandom {
    return new SeededRandom(`${this.seed}::${label}`);
  }

  getState(): number {
    return this.state;
  }
}

export function seedHash(seed: string): number {
  return hashString(seed);
}

/** Lattice hash for a pre-hashed seed. Hot noise loops use this to skip re-hashing the seed string. */
export function hashedLattice(seed: number, x: number, z: number): number {
  let value = seed;
  value ^= Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul(z + 0x7f4a7c15, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function stableHash(seed: string, x: number, z: number): number {
  return hashedLattice(hashString(seed), x, z);
}
