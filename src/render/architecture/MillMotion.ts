/**
 * MillMotion.ts
 *
 * Makes a mill work, and makes it work for a reason.
 *
 * The composer emits a mill's moving parts as named rotors: pivoted groups the structure's geometry
 * is built around, so moving one is a transform write and never a rebuild. Parts of one machine
 * share a drive train. The train integrates a single drive angle from its power source — the wind
 * in the mill's cell and the direction it blows, the flow of the river beside it, a person at the
 * handle, or a running engine — and every part derives its own pose from that angle:
 *
 * - `rotate`: a wheel, shaft, pulley or stone turns at the train's angle times its gear ratio.
 * - `reciprocate`: a saw sash or pump rod slides along its axis on a crank of the train's angle.
 * - `yaw`: a post-mill buck or a tower-mill cap turns to face the wind.
 *
 * Because every part reads one angle, power visibly travels: a waterwheel, its pit wheel, the
 * wallower and the stones above stay meshed whatever the frame rate.
 *
 * Everything is deterministic in the simulation state and the elapsed clock. Gust phases derive
 * from position, never from a random draw, so the same settlement looks the same on every run.
 */

import * as THREE from 'three';

/** Only the fields motion reads, so a preview can supply conditions without a whole simulation. */
export interface MillConditionWorld {
  size: number;
  cellSize: number;
  cells: readonly { flow: number; river: boolean }[];
}
export interface MillConditionWeather {
  wind: number;
  windX: number;
  windZ: number;
  cells: readonly { wind: number; windX: number; windZ: number }[];
}

/** What powers a train. Carried on each rotor so inspection and tests can read it. */
export type RotorDrive = 'wind-sails' | 'water-wheel' | 'manual' | 'engine';
/** How a part moves with its train. */
export type RotorMotion = 'rotate' | 'reciprocate' | 'yaw';

/** What the composer records on a rotor holder, and what the motion system reads back. */
export interface MillRotorInfo {
  axis: 'x' | 'y' | 'z';
  drive: RotorDrive;
  pivot: { x: number; y: number; z: number };
  motion?: RotorMotion;
  /** Turns of this part per turn of the train. A crown gear below a pit wheel is not 1. */
  ratio?: number;
  /** Half-travel of a reciprocating part, in structure units. */
  stroke?: number;
  /** Angular offset, so a pair of cranks can run out of phase. */
  phase?: number;
}

// ---------------------------------------------------------------------------- rate curves

/** Below this wind a sail cross does not turn: too little to overcome its own inertia. */
export const SAIL_CUT_IN = 0.1;
/** Above this the miller reefs: sails are governed to a steady speed rather than running away. */
export const SAIL_GOVERNOR = 0.5;
/** Above this the mill is furled and its sails are braked, turning slowly if at all. */
export const SAIL_FURL = 0.9;

const SAIL_MIN_RATE = 0.12;
const SAIL_MAX_RATE = 1.0;
const SAIL_FURLED_RATE = 0.25;

/** Below this flow a river will not turn a wheel. Matches the energy system's own threshold. */
export const WHEEL_MIN_FLOW = 0.08;
const WHEEL_MAX_RATE = 0.9;

/** A rotary quern is turned at roughly fifteen turns a minute by one person. */
export const MANUAL_RATE = 1.6;
/** A mill engine's crankshaft and flywheel at working speed. */
export const ENGINE_RATE = 2.4;

/**
 * Sail turn rate in radians per second for a 0..1 wind speed.
 *
 * Rises from cut-in to the governed speed, holds there, falls as the mill is furled, and stays
 * furled through a storm. Continuous past cut-in, so a gusting wind changes the turn smoothly.
 */
export function windSailRate(wind: number): number {
  const speed = clamp01(wind);
  if (speed < SAIL_CUT_IN) return 0;
  if (speed <= SAIL_GOVERNOR) {
    return lerp(SAIL_MIN_RATE, SAIL_MAX_RATE, (speed - SAIL_CUT_IN) / (SAIL_GOVERNOR - SAIL_CUT_IN));
  }
  if (speed < SAIL_FURL) {
    return lerp(SAIL_MAX_RATE, SAIL_FURLED_RATE, (speed - SAIL_GOVERNOR) / (SAIL_FURL - SAIL_GOVERNOR));
  }
  return SAIL_FURLED_RATE;
}

/**
 * How well the sails take the wind, from how squarely it meets the direction the shaft points.
 *
 * `facing` is the direction the sail shaft points. `windX`/`windZ` is the direction the air
 * travels, so a wind square on the sails runs against the facing and gives full drive. A mill whose
 * cap yaws turns itself to make this 1; a fixed cap takes what it is given.
 */
export function sailAlignment(facingX: number, facingZ: number, windX: number, windZ: number): number {
  const head = -(facingX * windX + facingZ * windZ);
  return 0.35 + 0.65 * clamp01(head);
}

/** Water-wheel turn rate in radians per second for a river's flow. Zero off the river. */
export function waterWheelRate(flow: number, river: boolean): number {
  if (!river || flow < WHEEL_MIN_FLOW) return 0;
  return Math.min(WHEEL_MAX_RATE, 0.2 + flow * 0.9);
}

// ---------------------------------------------------------------------------- controller

/** Rotors nearer than this (world units) move every frame. Matches the mill's full-detail LOD. */
export const MILL_FULL_MOTION_RANGE = 24;
/** Beyond full range a train advances this often, so it keeps time at a fraction of the cost. */
export const MILL_COARSE_INTERVAL = 1;
/** Conditions are re-read from the simulation this often. */
export const MILL_CONDITION_INTERVAL = 0.5;
/** Heavy wheels and sails gather speed slowly; a hand or an engine takes up the load quickly. */
const ACCELERATION: Record<RotorDrive, number> = { 'wind-sails': 0.4, 'water-wheel': 0.4, manual: 3, engine: 1.2 };
/** Relative size of the gusts a sail feels around its steady wind. */
const GUST_AMPLITUDE = 0.12;
/** A person pushes harder through half a turn than the other: a visible, uneven cadence. */
const MANUAL_CADENCE = 0.22;
/** How fast a buck or cap winds round to face the wind, radians per second. */
const YAW_RATE = 0.25;

interface MillPart {
  holder: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  motion: RotorMotion;
  ratio: number;
  stroke: number;
  phase: number;
  /** Rest position of a reciprocating part, local to its parent. */
  base: THREE.Vector3;
}

interface MillTrain {
  drive: RotorDrive;
  /** The part whose position and facing the train reads its conditions from. */
  source: THREE.Object3D;
  parts: MillPart[];
  yaws: MillPart[];
  /** Stable per train, derived from position, so gusts repeat identically between runs. */
  gustPhase: number;
  /** Unwrapped, so a part with a fractional gear ratio never jumps when the angle wraps. */
  angle: number;
  speed: number;
  target: number;
  /** The wind's heading in each yawing part's parent frame, refreshed with conditions. */
  yawTarget: number | undefined;
  conditionClock: number;
  coarseClock: number;
}

export interface MillMotionFrame {
  deltaSeconds: number;
  elapsedSeconds: number;
  /** Camera position in world space. */
  camera: THREE.Vector3;
  world: MillConditionWorld;
  weather: MillConditionWeather | undefined;
  /** 0..1 how much hand-worked machinery is being worked. People work querns by day. */
  manualWork?: number;
  /** 0..1 how hard engines are running. */
  engineLoad?: number;
}

/**
 * Drives every adopted mill's machinery from the simulation's conditions, at a cost that scales
 * with what the viewer can actually see.
 *
 * Three levels of cost, cheapest first. A train inside a hidden LOD level does nothing at all. A
 * train beyond the full-motion range advances once a second. Only a visible, nearby train moves
 * every frame, and even it re-reads the simulation only twice a second. Trains whose structure
 * has left the scene are dropped on a slow prune.
 */
export class MillMotionSystem {
  private trains: MillTrain[] = [];
  private readonly adopted = new WeakSet<THREE.Object3D>();
  private pruneClock = 0;
  private readonly position = new THREE.Vector3();
  private readonly facing = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly fullMotionRange: number;

  /** `fullMotionRange` defaults to the production LOD range; the browser passes `Infinity` to keep every preview moving. */
  constructor(private readonly scene: THREE.Object3D, options: { fullMotionRange?: number } = {}) {
    this.fullMotionRange = options.fullMotionRange ?? MILL_FULL_MOTION_RANGE;
  }

  /** Live moving parts under management. Exposed for inspection and tests. */
  get rotorCount(): number {
    return this.trains.reduce((count, train) => count + train.parts.length + train.yaws.length, 0);
  }

  /** Register every moving part in a freshly instanced structure. Idempotent per root. */
  adopt(root: THREE.Object3D): number {
    if (this.adopted.has(root)) return 0;
    this.adopted.add(root);
    const byKey = new Map<string, MillTrain>();
    const sourced = new Set<MillTrain>();
    const owners = new Map<THREE.Object3D, number>();
    let added = 0;
    root.traverse(object => {
      const info = object.userData['millRotor'] as MillRotorInfo | undefined;
      if (!info) return;
      // A train is one machine: every part under the same composed structure with the same power.
      // The nearest ancestor that is not itself a rotor is that structure — which also keeps a
      // full-detail level and its mid-distance clone on separate trains.
      let owner: THREE.Object3D = object;
      while (owner.parent && owner.parent !== root && owner.userData['millRotor']) owner = owner.parent;
      if (owner.userData['millRotor']) owner = root;
      if (!owners.has(owner)) owners.set(owner, owners.size);
      const key = `${owners.get(owner)}:${info.drive}`;
      let train = byKey.get(key);
      if (!train) {
        train = {
          drive: info.drive, source: object, parts: [], yaws: [],
          gustPhase: positivePhase(info.pivot.x * 12.9898 + info.pivot.z * 78.233),
          angle: 0, speed: 0, target: 0, yawTarget: undefined, conditionClock: 0, coarseClock: 0,
        };
        byKey.set(key, train);
        this.trains.push(train);
      }
      const part: MillPart = {
        holder: object,
        axis: info.axis,
        motion: info.motion ?? 'rotate',
        ratio: info.ratio ?? 1,
        stroke: info.stroke ?? 0,
        phase: info.phase ?? 0,
        base: object.position.clone(),
      };
      if (part.motion === 'yaw') train.yaws.push(part);
      else {
        train.parts.push(part);
        // The sails (ratio 1, rotating) are the source: their facing is what meets the wind.
        if (!sourced.has(train) && part.motion === 'rotate' && part.ratio === 1) { train.source = object; sourced.add(train); }
      }
      added += 1;
    });
    return added;
  }

  update(frame: MillMotionFrame): void {
    this.pruneClock += frame.deltaSeconds;
    if (this.pruneClock >= 1) {
      this.pruneClock = 0;
      this.prune();
    }
    for (const train of this.trains) this.advance(train, frame);
  }

  private advance(train: MillTrain, frame: MillMotionFrame): void {
    // Hidden LOD levels cost nothing: the machine is not drawn, so there is nothing to keep moving.
    if (!visibleFrom(train.source, this.scene)) {
      train.coarseClock = 0;
      return;
    }
    train.source.getWorldPosition(this.position);
    const distance = this.position.distanceTo(frame.camera);

    if (distance > this.fullMotionRange) {
      // Off camera the mill keeps time, but only at a coarse step.
      train.coarseClock += frame.deltaSeconds;
      if (train.coarseClock < MILL_COARSE_INTERVAL) return;
      const step = train.coarseClock;
      train.coarseClock = 0;
      // Conditions are still read, just at this coarse rate, or a distant mill would never leave rest.
      this.readConditions(train, frame);
      this.turn(train, step, frame.elapsedSeconds);
      return;
    }

    train.coarseClock = 0;
    train.conditionClock -= frame.deltaSeconds;
    if (train.conditionClock <= 0) {
      train.conditionClock = MILL_CONDITION_INTERVAL;
      this.readConditions(train, frame);
    }
    this.turn(train, frame.deltaSeconds, frame.elapsedSeconds);
  }

  /** The speed this train should run at, and where its cap should face. Reads `this.position`. */
  private readConditions(train: MillTrain, frame: MillMotionFrame): void {
    const index = cellIndexAt(frame.world, this.position.x, this.position.z);
    switch (train.drive) {
      case 'manual':
        train.target = MANUAL_RATE * clamp01(frame.manualWork ?? 1);
        return;
      case 'engine':
        train.target = ENGINE_RATE * clamp01(frame.engineLoad ?? 1);
        return;
      case 'water-wheel': {
        const cell = index >= 0 ? frame.world.cells[index] : undefined;
        train.target = waterWheelRate(cell?.flow ?? 0, cell?.river ?? false);
        return;
      }
      case 'wind-sails': {
        const weatherCell = index >= 0 ? frame.weather?.cells[index] : undefined;
        const wind = weatherCell?.wind ?? frame.weather?.wind ?? 0;
        const windX = weatherCell?.windX ?? frame.weather?.windX ?? 1;
        const windZ = weatherCell?.windZ ?? frame.weather?.windZ ?? 0;
        // A cap that yaws heads into the wind; record where that is in its parent's frame.
        const yaw = train.yaws[0];
        if (yaw?.holder.parent) {
          yaw.holder.parent.getWorldQuaternion(this.quaternion);
          this.facing.set(-windX, 0, -windZ).applyQuaternion(this.quaternion.invert());
          train.yawTarget = Math.atan2(this.facing.x, this.facing.z);
        }
        // The sails' own facing decides how much of the wind they take.
        const parent = train.source.parent;
        if (parent) parent.getWorldQuaternion(this.quaternion);
        else this.quaternion.identity();
        this.facing.set(0, 0, 1).applyQuaternion(this.quaternion);
        train.target = windSailRate(wind) * sailAlignment(this.facing.x, this.facing.z, windX, windZ);
        return;
      }
    }
  }

  private turn(train: MillTrain, deltaSeconds: number, elapsedSeconds: number): void {
    let goal = train.target;
    // Gusts are a slow deterministic wobble on the steady wind; a hand pushes harder through half a turn.
    if (train.drive === 'wind-sails') goal *= 1 + GUST_AMPLITUDE * Math.sin(elapsedSeconds * 0.9 + train.gustPhase);
    if (train.drive === 'manual') goal *= 1 + MANUAL_CADENCE * Math.sin(train.angle);
    const limit = ACCELERATION[train.drive] * deltaSeconds;
    train.speed += Math.max(-limit, Math.min(limit, goal - train.speed));
    train.angle += train.speed * deltaSeconds;

    for (const part of train.parts) {
      const crank = train.angle * part.ratio + part.phase;
      if (part.motion === 'reciprocate') {
        part.holder.position[part.axis] = part.base[part.axis] + part.stroke * Math.sin(crank);
      } else {
        part.holder.rotation[part.axis] = crank % (Math.PI * 2);
      }
      part.holder.userData['millSpeed'] = train.speed * part.ratio;
    }

    if (train.yawTarget !== undefined) {
      for (const part of train.yaws) {
        const current = part.holder.rotation.y;
        const delta = Math.atan2(Math.sin(train.yawTarget - current), Math.cos(train.yawTarget - current));
        const step = YAW_RATE * deltaSeconds;
        part.holder.rotation.y = current + Math.max(-step, Math.min(step, delta));
      }
    }
  }

  /** Drop trains whose structure is no longer in the scene. Runs on a slow tick, and on demand. */
  prune(): void {
    this.trains = this.trains.filter(train => attachedTo(train.source, this.scene));
  }
}

// ---------------------------------------------------------------------------- helpers

/** Matches `cellAt` in the simulation's world: the same grid index, without the object lookup. */
function cellIndexAt(world: MillConditionWorld, x: number, z: number): number {
  const gridX = Math.round(x / world.cellSize + world.size / 2);
  const gridZ = Math.round(z / world.cellSize + world.size / 2);
  if (gridX < 0 || gridX >= world.size || gridZ < 0 || gridZ >= world.size) return -1;
  return gridZ * world.size + gridX;
}

function attachedTo(object: THREE.Object3D, scene: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node === scene) return true;
  }
  return false;
}

function visibleFrom(object: THREE.Object3D, scene: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node && node !== scene; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function positivePhase(value: number): number {
  const turn = Math.PI * 2;
  return ((value % turn) + turn) % turn;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/** How an emitter declares a moving part to the composer. `parent` nests it on another part. */
export interface RotorSpec extends Omit<MillRotorInfo, 'pivot'> {
  /** Name of the part this one rides on: sails on a yawing cap, a crank pin on a wheel. */
  parent?: string;
}
