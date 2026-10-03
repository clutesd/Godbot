import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  ARCHITECTURAL_MATERIALS,
  SURFACE_PROGRAMS,
  architecturalMaterial,
  type SurfaceProgram,
} from '../src/render/architecture/MaterialLibrary';
import {
  proceduralProgramFor,
  refinementBucket,
  surfaceProgramCacheKey,
} from '../src/render/architecture/SurfaceProgramLibrary';
import { ArchitecturalMaterialSet } from '../src/render/architecture/ArchitecturalMaterialSet';
import {
  injectSurfaceFragmentStage,
  injectSurfaceVertexStage,
} from '../src/render/materials/SurfaceDetail';
import { MaterialPalette, type Era } from '../src/render/materials/MaterialPalette';
import type { CultureStyle } from '../src/sim/types';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

const ERAS: Era[] = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'];

/** The GLSL variables every pattern body is required to drive. */
const REQUIRED_OUTPUTS = ['gbTone', 'gbRough', 'gbHeight'];

/** Helpers and frame variables a body is allowed to read. Anything else is a typo. */
const ALLOWED_IDENTIFIERS = new Set([
  // frame
  'gbN', 'gbAbsN', 'gbUpFace', 'gbGrain', 'gbProj', 'gbProjLen', 'gbEndGrain', 'gbTan', 'gbBit',
  'gbUV', 'gbRadius', 'gbArc', 'gbWear',
  // helpers
  'gbHash', 'gbValue', 'gbFbm', 'gbSeam', 'gbPerturbNormal',
  // outputs
  'gbTone', 'gbRough', 'gbHeight', 'gbSoot',
  // varyings
  'vGbLocal', 'vGbNormalLocal', 'vGbDetail', 'vViewPosition',
]);

function balanced(source: string, open: string, close: string): boolean {
  let depth = 0;
  for (const character of source) {
    if (character === open) depth += 1;
    else if (character === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe('Procedural surface programs', () => {
  it('provides a program for every pattern the material library names', () => {
    for (const program of SURFACE_PROGRAMS) {
      const resolved = proceduralProgramFor(program, 0.5);
      expect(resolved, program).toBeDefined();
      expect(resolved.body.length, program).toBeGreaterThan(40);
    }
  });

  it('drives every output channel in every pattern', () => {
    for (const program of SURFACE_PROGRAMS) {
      const body = proceduralProgramFor(program, 0.5).body;
      for (const output of REQUIRED_OUTPUTS) {
        expect(body, `${program} never assigns ${output}`).toContain(output);
      }
    }
  });

  it('keeps relief and wear inside the amplitudes the shared shader expects', () => {
    for (const program of SURFACE_PROGRAMS) {
      const resolved = proceduralProgramFor(program, 0.5);
      // Relief is in canonical building units; anything above a few centimetres would read as
      // geometry rather than surface, and would swim against the real silhouette.
      expect(resolved.relief, program).toBeGreaterThan(0);
      expect(resolved.relief, program).toBeLessThan(0.03);
      expect(resolved.wear, program).toBeGreaterThanOrEqual(0);
      expect(resolved.wear, program).toBeLessThanOrEqual(1);
    }
  });

  it('only reads frame variables and helpers the shared shader actually declares', () => {
    for (const program of SURFACE_PROGRAMS) {
      const body = proceduralProgramFor(program, 0.5).body;
      // Locals the body declares itself are fine; anything else beginning gb/vGb must be known.
      const declared = new Set<string>();
      for (const match of body.matchAll(/\b(?:float|vec2|vec3|vec4)\s+(\w+)/g)) declared.add(match[1]!);
      for (const match of body.matchAll(/\b(gb\w+|vGb\w+)\b/g)) {
        const identifier = match[1]!;
        if (declared.has(identifier)) continue;
        expect(ALLOWED_IDENTIFIERS.has(identifier), `${program} reads unknown ${identifier}`).toBe(true);
      }
    }
  });

  it('produces balanced, well-formed GLSL when injected into the standard shader', () => {
    for (const program of SURFACE_PROGRAMS) {
      const resolved = proceduralProgramFor(program, 0.5);
      const vertexShader = injectSurfaceVertexStage(THREE.ShaderLib.standard.vertexShader);
      const fragmentShader = injectSurfaceFragmentStage(resolved, THREE.ShaderLib.standard.fragmentShader);

      expect(balanced(fragmentShader, '{', '}'), `${program} braces`).toBe(true);
      expect(balanced(fragmentShader, '(', ')'), `${program} parens`).toBe(true);
      expect(fragmentShader).toContain('gbPerturbNormal');
      expect(vertexShader).toContain('aSurfaceDetail');
      // No unresolved template interpolation leaked into the shader source.
      expect(fragmentShader, `${program} has unresolved template`).not.toContain('${');
      expect(fragmentShader, `${program} emitted NaN literal`).not.toMatch(/\bNaN\b/);
      expect(fragmentShader, `${program} emitted undefined literal`).not.toMatch(/\bundefined\b/);
    }
  });

  it('shares one GPU program across the materials that share a pattern', () => {
    const keys = new Set<string>();
    for (const id of ARCHITECTURAL_MATERIALS) {
      keys.add(surfaceProgramCacheKey(architecturalMaterial(id).appearance.program, 0.5));
    }
    // 36 materials must not mean 36 shaders.
    expect(keys.size).toBeLessThanOrEqual(SURFACE_PROGRAMS.length);
    expect(keys.size).toBeLessThan(ARCHITECTURAL_MATERIALS.length);
  });

  it('buckets refinement so the world shares a handful of programs per pattern', () => {
    const buckets = new Set<number>();
    for (let step = 0; step <= 20; step += 1) buckets.add(refinementBucket(step / 20));
    expect(buckets.size).toBeLessThanOrEqual(4);
    expect(refinementBucket(-1)).toBe(0);
    expect(refinementBucket(2)).toBe(3);
  });

  it('gives visually distinct patterns to materials that must not be confused', () => {
    const programOf = (id: Parameters<typeof architecturalMaterial>[0]): SurfaceProgram =>
      architecturalMaterial(id).appearance.program;
    // The readable construction distinctions: rubble is not ashlar, brick is not stone, a log
    // wall is not a boarded one, corrugated iron is not standing seam.
    expect(programOf('fieldstone')).not.toBe(programOf('ashlar'));
    expect(programOf('fired-brick')).not.toBe(programOf('dressed-stone'));
    expect(programOf('logs')).not.toBe(programOf('sawn-lumber'));
    expect(programOf('corrugated-metal')).not.toBe(programOf('sheet-metal'));
    expect(programOf('thatch')).not.toBe(programOf('wood-shingle'));
    expect(programOf('slate')).not.toBe(programOf('clay-tile'));
    expect(programOf('concrete')).not.toBe(programOf('plaster'));
  });
});

describe('Architectural material set', () => {
  const set = () => new ArchitecturalMaterialSet({ tint: new THREE.Color(0xc36557), refinement: 0.5 });

  it('returns one shared instance per material, however often it is asked for', () => {
    const materials = set();
    const first = materials.get('fired-brick');
    const second = materials.get('fired-brick');
    expect(first).toBe(second);
    expect(first.userData['shared']).toBe(true);
    expect(first.userData['architecturalMaterial']).toBe('fired-brick');
    materials.dispose();
  });

  it('creates materials lazily so an unused material costs nothing', () => {
    const materials = set();
    expect(materials.stats.materials).toBe(0);
    expect(materials.has('ashlar')).toBe(false);
    materials.get('ashlar');
    expect(materials.stats.materials).toBe(1);
    expect(materials.has('ashlar')).toBe(true);
    materials.dispose();
  });

  it('keeps GPU programs far below material count even when every material is realised', () => {
    const materials = set();
    for (const id of ARCHITECTURAL_MATERIALS) materials.get(id);
    expect(materials.stats.materials).toBe(ARCHITECTURAL_MATERIALS.length);
    expect(materials.stats.programs).toBeLessThan(ARCHITECTURAL_MATERIALS.length);
    expect(materials.stats.programs).toBeLessThanOrEqual(SURFACE_PROGRAMS.length);
    materials.dispose();
  });

  it('carries each material real physical finish rather than a flat colour', () => {
    const materials = set();
    const brick = materials.get('fired-brick');
    const steel = materials.get('structural-steel');
    const glass = materials.get('curtain-glass');

    expect(brick.metalness).toBeLessThan(steel.metalness);
    expect(brick.roughness).toBeGreaterThan(steel.roughness);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(1);
    expect(brick.transparent).toBe(false);
    materials.dispose();
  });

  it('tints toward culture without pretending culture changes what a substance is', () => {
    const warm = new ArchitecturalMaterialSet({ tint: new THREE.Color(0xff0000), refinement: 0.5 });
    const cool = new ArchitecturalMaterialSet({ tint: new THREE.Color(0x0000ff), refinement: 0.5 });
    const base = new THREE.Color(architecturalMaterial('fired-brick').appearance.color);

    const warmColor = warm.get('fired-brick').color;
    const coolColor = cool.get('fired-brick').color;
    expect(warmColor.getHex()).not.toBe(coolColor.getHex());
    // Both must stay recognisably brick: a small fraction away from the substance's own colour.
    for (const color of [warmColor, coolColor]) {
      const distance = Math.abs(color.r - base.r) + Math.abs(color.g - base.g) + Math.abs(color.b - base.b);
      expect(distance).toBeLessThan(0.45);
    }
    warm.dispose();
    cool.dispose();
  });

  it('lights only glazing at night, and does so in place rather than by cloning', () => {
    const materials = set();
    const glass = materials.get('glass');
    const brick = materials.get('fired-brick');
    expect(glass.emissiveIntensity).toBe(0);

    materials.setNightFactor(1);
    expect(materials.get('glass')).toBe(glass);
    expect(glass.emissiveIntensity).toBeGreaterThan(0);
    // Opaque fabric must never glow. Three defaults emissiveIntensity to 1, so the property
    // that actually matters is the emissive colour staying black.
    expect(brick.emissive.getHex()).toBe(0x000000);
    expect(glass.emissive.getHex()).not.toBe(0x000000);

    materials.setNightFactor(0);
    expect(glass.emissiveIntensity).toBe(0);
    materials.dispose();
  });

  it('applies the night factor to materials created after the factor was set', () => {
    const materials = set();
    materials.setNightFactor(1);
    expect(materials.get('curtain-glass').emissiveIntensity).toBeGreaterThan(0);
    materials.dispose();
  });
});

describe('Material palette integration', () => {
  it('shares architectural materials across every building using one palette', () => {
    for (const era of ERAS) {
      const palette = new MaterialPalette({ culture: CULTURE, era });
      const first = palette.getArchitecturalMaterial('fieldstone');
      const second = palette.getArchitecturalMaterial('fieldstone');
      expect(first).toBe(second);
      expect(palette.architecturalStats().materials).toBe(1);
      palette.dispose();
    }
  });

  it('leaves the existing surface-key path untouched', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'village' });
    // Legacy callers must keep working exactly as before alongside the new path.
    expect(palette.getSurfaceMaterial('stone')).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(palette.getSurfaceMaterial('stone')).not.toBe(palette.getArchitecturalMaterial('fieldstone'));
    expect(palette.architecturalStats().materials).toBe(1);
    palette.dispose();
  });

  it('refines surfaces as the era processes improve', () => {
    const primitive = new MaterialPalette({ culture: CULTURE, era: 'primitive' });
    const advanced = new MaterialPalette({ culture: CULTURE, era: 'advanced' });
    // Same substance, better worked: a later era's fabric is marginally smoother.
    expect(advanced.getArchitecturalMaterial('fieldstone').roughness)
      .toBeLessThan(primitive.getArchitecturalMaterial('fieldstone').roughness);
    primitive.dispose();
    advanced.dispose();
  });

  it('propagates the palette night factor into architectural glazing', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'industrial' });
    const glass = palette.getArchitecturalMaterial('glass');
    palette.setNightFactor(1);
    expect(glass.emissiveIntensity).toBeGreaterThan(0);
    palette.dispose();
  });

  it('disposes architectural materials with the palette', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'village' });
    palette.getArchitecturalMaterial('thatch');
    expect(palette.architecturalStats().materials).toBe(1);
    palette.dispose();
    expect(palette.architecturalStats().materials).toBe(0);
  });
});
