import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SceneRenderGuard } from '../src/render/SceneRenderGuard';

function harness() {
  const gl = { isContextLost: vi.fn(() => false), getError: vi.fn(() => 0), NO_ERROR: 0,
    getProgramInfoLog: () => 'link failed', getShaderInfoLog: () => 'shader diagnostic' };
  const renderer = { getContext: () => gl, debug: { onShaderError: null as THREE.WebGLRenderer['debug']['onShaderError'] },
    setRenderTarget: vi.fn(), render: vi.fn() };
  const guard = new SceneRenderGuard(renderer as unknown as THREE.WebGLRenderer);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  return { gl, renderer, draw: (composite?: () => void) => guard.render(scene, camera, composite) };
}

describe('scene rendering recovery', () => {
  it('keeps working cinematic effects and validates only the first frame', () => {
    const { draw, renderer, gl } = harness();
    const composite = vi.fn();
    draw(composite); draw(composite);
    expect(composite).toHaveBeenCalledTimes(2);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(gl.getError).toHaveBeenCalledTimes(1);
  });

  it('recovers a non-throwing framebuffer failure and permanently bypasses effects', () => {
    const { draw, renderer, gl } = harness();
    const composite = vi.fn();
    gl.getError.mockReturnValueOnce(1286);
    draw(composite); draw(composite);
    expect(composite).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
  });

  it('recovers shader failures that Three reports through callbacks instead of exceptions', () => {
    const { draw, renderer, gl } = harness();
    const previous = vi.fn();
    renderer.debug.onShaderError = previous;
    draw(() => renderer.debug.onShaderError!(gl as unknown as WebGLRenderingContext,
      {} as Parameters<NonNullable<THREE.WebGLRenderer['debug']['onShaderError']>>[1], {} as WebGLShader, {} as WebGLShader));
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(renderer.debug.onShaderError).toBe(previous);
  });

  it('hides a single object whose shader fails and keeps drawing the world with effects', () => {
    const gl = { isContextLost: () => false, getError: vi.fn(() => 0), NO_ERROR: 0,
      getProgramInfoLog: () => 'link failed', getShaderInfoLog: () => 'instanceColor undeclared' };
    const broken = new THREE.MeshBasicMaterial(), healthy = new THREE.MeshBasicMaterial();
    const programs = new Map<THREE.Material, object>([
      [broken, { currentProgram: { diagnostics: { runnable: false } } }], [healthy, { currentProgram: { diagnostics: { runnable: true } } }]]);
    const renderer = { getContext: () => gl, debug: { onShaderError: null as THREE.WebGLRenderer['debug']['onShaderError'] },
      properties: { get: (m: THREE.Material) => programs.get(m) ?? {} }, setRenderTarget: vi.fn(), render: vi.fn() };
    const guard = new SceneRenderGuard(renderer as unknown as THREE.WebGLRenderer);
    const scene = new THREE.Scene();
    const bad = new THREE.Mesh(new THREE.BufferGeometry(), broken), good = new THREE.Mesh(new THREE.BufferGeometry(), healthy);
    scene.add(bad, good);
    const composite = vi.fn(() => {
      if (bad.visible) renderer.debug.onShaderError!(gl as unknown as WebGLRenderingContext,
        {} as Parameters<NonNullable<THREE.WebGLRenderer['debug']['onShaderError']>>[1], {} as WebGLShader, {} as WebGLShader);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    guard.render(scene, new THREE.PerspectiveCamera(), composite);
    guard.render(scene, new THREE.PerspectiveCamera(), composite);
    expect(bad.visible).toBe(false);
    expect(good.visible).toBe(true);
    expect(composite).toHaveBeenCalledTimes(3);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('surfaces direct-render failures so narration cannot continue over a broken world', () => {
    const { draw, renderer } = harness();
    renderer.render.mockImplementation(() => { throw new Error('Scene unavailable'); });
    expect(() => draw(() => { throw new Error('Effects unavailable'); })).toThrow('Scene unavailable');
  });

  it('stops presentation when the graphics context is lost', () => {
    const { draw, gl, renderer } = harness();
    gl.isContextLost.mockReturnValue(true);
    expect(() => draw()).toThrow('Graphics connection lost');
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
