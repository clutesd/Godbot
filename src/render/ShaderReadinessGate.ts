import type * as THREE from 'three';

/** Reserved layer no camera renders; an object waits here while its shaders compile. */
const PENDING_LAYER = 31;
/**
 * A compile that never reports ready (lost device, driver fault) must not hide content forever. Large
 * shaders queued behind others can legitimately take several seconds in the background, and revealing
 * early just moves the stall onto the frame, so this is a generous safety net, not a pacing knob.
 */
const REVEAL_TIMEOUT_MS = 10_000;
/** Above this many new objects one scene-wide compile is cheaper than one call per object. */
const PER_OBJECT_COMPILE_LIMIT = 8;

type Drawable = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
type LinkedProgram = { isReady(): boolean };
type MaterialState = { programs?: Map<string, LinkedProgram> };
/** The fields of three's WebGLProgram this relies on (renderer.info.programs entries). */
type CachedProgram = { usedTimes: number };

/**
 * Keeps first-use shader linking off the frame.
 *
 * three.js links a program the first time an object draws with a program variant it has not seen,
 * and that draw blocks until the driver finishes (hundreds of milliseconds on ANGLE/D3D11). The
 * opening warmup covers the initial scene; content created later used to stall whichever frame
 * first showed it.
 *
 * Every newly visible object is compiled with `renderer.compile` against the frame's own render
 * target. That builds exactly the variant this object needs (instancing, skinning, shadows, tone
 * mapping and colour space all enter the key), or reuses it, without waiting: with
 * KHR_parallel_shader_compile the link proceeds in the background. If any of the object's programs
 * is still linking, the object moves to a layer no camera renders (main or shadow) and is restored
 * on the first frame its programs report ready. It appears a few frames later instead of freezing
 * the world. Without the extension there is no non-blocking readiness query, so only pinning runs.
 *
 * Linked programs are also pinned: three destroys a program when its last material is disposed, so
 * a settlement rebuild that disposes and recreates identical materials (or disposes a material other
 * meshes still share) used to relink the same shader from scratch, measured at 1.3-1.5 s per stall.
 * Pinned programs stay in three's cache by key, so the recreated material is a cache hit. The set of
 * distinct programs is bounded (a few hundred), so keeping them costs little GPU memory.
 *
 * An object is gated at most once in its lifetime, so a material that is rebuilt or swapped every
 * frame can never keep its object hidden; later changes fall back to ordinary first-use compiles.
 */
export class ShaderReadinessGate {
  private readonly pending = new Map<THREE.Object3D, { mask: number; deadline: number }>();
  /** Objects known drawable without a stall, with the material they were confirmed for. */
  private readonly settled = new WeakMap<THREE.Object3D, Drawable['material']>();
  private readonly gatedOnce = new WeakSet<THREE.Object3D>();
  private readonly enabled: boolean;
  private readonly fresh: THREE.Object3D[] = [];
  private readonly pinned = new WeakSet<object>();
  private pinnedCount = -1;
  private pinnedLast: unknown;
  /** Objects revealed by the safety timeout rather than by the driver reporting ready. */
  timedOut = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly now: () => number = () => performance.now()) {
    this.enabled = renderer.extensions.has('KHR_parallel_shader_compile');
  }

  get waiting(): number { return this.pending.size; }

  /**
   * Call once per frame, before rendering `scene` through `camera` into `target` (null = canvas).
   * The target matters: three keys programs on tone mapping and output colour space, which differ
   * between the canvas and an offscreen composer buffer, so compiling against the wrong one would
   * build a variant the frame never uses and leave the real link on the frame.
   */
  gate(scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null = null): void {
    this.pinPrograms();
    if (!this.enabled) return;
    this.revealReady();

    const fresh = this.fresh;
    fresh.length = 0;
    scene.traverseVisible((object) => {
      const material = (object as Drawable).material;
      if (!material || !isDrawable(object) || this.settled.get(object) === material || this.pending.has(object)) return;
      if (this.gatedOnce.has(object)) { this.settled.set(object, material); return; }
      fresh.push(object);
    });
    if (fresh.length === 0) return;

    const previousTarget = this.renderer.getRenderTarget();
    try {
      // Issues compiles/links without waiting for them (parallel shader compile).
      this.renderer.setRenderTarget(target);
      if (fresh.length > PER_OBJECT_COMPILE_LIMIT) this.renderer.compile(scene, camera);
      else for (const object of fresh) this.renderer.compile(object, camera, scene);
    } catch (error) {
      // A compile that throws is reported by the normal draw path (SceneRenderGuard); never hide it.
      for (const object of fresh) this.settled.set(object, (object as Drawable).material);
      fresh.length = 0;
      console.warn('GODBOX shader precompile failed; drawing directly.', error);
      return;
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }

    const deadline = this.now() + REVEAL_TIMEOUT_MS;
    for (const object of fresh) {
      if (this.programsReady(object)) {
        this.settled.set(object, (object as Drawable).material);
        continue;
      }
      this.gatedOnce.add(object);
      this.pending.set(object, { mask: object.layers.mask, deadline });
      object.layers.set(PENDING_LAYER);
    }
    fresh.length = 0;
  }

  /** Restores every waiting object immediately (teardown, or before a synchronous warm render). */
  releaseAll(): void {
    for (const [object, entry] of this.pending) object.layers.mask = entry.mask;
    this.pending.clear();
  }

  private revealReady(): void {
    if (this.pending.size === 0) return;
    const now = this.now();
    for (const [object, entry] of this.pending) {
      const expired = now >= entry.deadline;
      if (!expired && !this.programsReady(object)) continue;
      if (expired) this.timedOut += 1;
      object.layers.mask = entry.mask;
      this.pending.delete(object);
      this.settled.set(object, (object as Drawable).material);
    }
  }

  /** True when every program variant linked for the object's materials can be used without waiting. */
  private programsReady(object: THREE.Object3D): boolean {
    const material = (object as Drawable).material;
    if (!material) return true;
    for (const entry of Array.isArray(material) ? material : [material]) {
      const programs = (this.renderer.properties.get(entry) as MaterialState).programs;
      if (!programs) continue;
      for (const program of programs.values()) if (!program.isReady()) return false;
    }
    return true;
  }

  /** Holds one extra reference on every linked program so disposal never forces a relink. */
  private pinPrograms(): void {
    const programs = this.renderer.info?.programs as unknown as CachedProgram[] | null | undefined;
    if (!programs) return;
    const last = programs[programs.length - 1];
    if (programs.length === this.pinnedCount && last === this.pinnedLast) return;
    for (const program of programs) {
      if (this.pinned.has(program)) continue;
      this.pinned.add(program);
      program.usedTimes += 1;
    }
    this.pinnedCount = programs.length;
    this.pinnedLast = last;
  }
}

function isDrawable(object: THREE.Object3D): boolean {
  return Boolean((object as THREE.Mesh).isMesh || (object as THREE.Points).isPoints
    || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite);
}
