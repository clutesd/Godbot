import type * as THREE from 'three';

/** Keep a failed full-screen effect from leaving a healthy scene behind a black canvas. */
export class SceneRenderGuard {
  private compositeFailed = false;
  private validateComposite = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  render(scene: THREE.Scene, camera: THREE.Camera, composite?: () => void): void {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) throw new Error('Graphics connection lost.');

    if (composite && !this.compositeFailed) {
      try {
        this.checkedRender(composite, this.validateComposite);
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
    this.checkedRender(() => this.renderer.render(scene, camera), this.validateComposite);
    this.validateComposite = false;
  }

  private checkedRender(draw: () => void, validate: boolean): void {
    const gl = this.renderer.getContext();
    const previous = this.renderer.debug.onShaderError;
    let shaderError: Error | undefined;
    this.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      shaderError = new Error('The graphics device could not draw the world.');
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
