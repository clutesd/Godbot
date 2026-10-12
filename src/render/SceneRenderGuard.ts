import type * as THREE from 'three';

const MAX_QUARANTINE_RETRIES = 8;

class ShaderFailure extends Error {}

type ProgramProperties = { currentProgram?: { diagnostics?: { runnable: boolean } } };

/** Keep a failed full-screen effect, or one broken scene object, from leaving the world undrawn. */
export class SceneRenderGuard {
  private compositeFailed = false;
  private validateComposite = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** False once the full-screen composite has failed and the world is drawn straight to the canvas. */
  get compositeHealthy(): boolean { return !this.compositeFailed; }

  render(scene: THREE.Scene, camera: THREE.Camera, composite?: () => void): void {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) throw new Error('Graphics connection lost.');

    if (composite && !this.compositeFailed) {
      try {
        this.recoveringRender(scene, composite, this.validateComposite);
        this.validateComposite = false;
        return;
      } catch (error) {
        this.compositeFailed = true;
        this.validateComposite = true;
        // Attribute the retry only to its own errors, not a failed effects framebuffer.
        for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i += 1) { /* drain */ }
        console.warn('GODBOX cinematic effects unavailable; rendering the world directly.', error);
      }
    }

    // A composer failure can leave an offscreen framebuffer bound. Always restore the canvas.
    this.renderer.setRenderTarget(null);
    this.recoveringRender(scene, () => this.renderer.render(scene, camera), this.validateComposite);
    this.validateComposite = false;
  }

  /** A shader failure in an ordinary scene object hides that object and redraws, so one bad
   * decoration degrades the picture instead of the whole world. Failures with no scene culprit
   * (a full-screen pass, a lost device) still propagate to the caller's fallback. */
  private recoveringRender(scene: THREE.Scene, draw: () => void, validate: boolean): void {
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.checkedRender(draw, validate);
        return;
      } catch (error) {
        if (!(error instanceof ShaderFailure) || attempt >= MAX_QUARANTINE_RETRIES || this.quarantine(scene) === 0) throw error;
        // The failed program's draw can leave GL errors queued; don't charge them to the retry.
        const gl = this.renderer.getContext();
        for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i += 1) { /* drain */ }
      }
    }
  }

  private quarantine(scene: THREE.Scene): number {
    let hidden = 0;
    scene.traverseVisible((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      const broken = materials.some((m) =>
        (this.renderer.properties.get(m) as ProgramProperties).currentProgram?.diagnostics?.runnable === false);
      if (!broken) return;
      object.visible = false;
      hidden += 1;
      console.error(`GODBOX hid "${object.name || object.type}" (material: ${materials.map((m) => m.name || m.type).join(', ')}) because its shader failed to compile; the rest of the world is still drawn.`);
    });
    return hidden;
  }

  private checkedRender(draw: () => void, validate: boolean): void {
    const gl = this.renderer.getContext();
    const previous = this.renderer.debug.onShaderError;
    let shaderError: Error | undefined;
    this.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      shaderError = new ShaderFailure('The graphics device could not draw the world.');
      console.error(shaderError.message, context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment));
      previous?.(context, program, vertex, fragment);
    };
    try {
      draw();
      if (shaderError) throw shaderError;
      // Validate the first real frame, including framebuffer errors that WebGL reports without
      // throwing. Avoid GPU error queries on the normal animation hot path.
      if (validate) {
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`Graphics frame failed (WebGL ${error}).`);
      }
    } finally {
      this.renderer.debug.onShaderError = previous;
    }
  }
}
