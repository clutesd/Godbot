/** Owner-scoped GPU cache. Adds no meshes, draw calls, or simulation state. */
import * as THREE from 'three';
import { facadeAtlasLayout, FACADE_ATLAS_SIZE, type FacadePlan } from './FacadePlan';
import { facadeArtwork, facadeTextureKey } from './FacadeSvg';
type FacadeLayer = 'albedo' | 'relief' | 'surface';
import { architecturalMaterial, isArchitecturalMaterial } from './MaterialLibrary';
import { BUILD_STAGE } from '../assets/BuildStages';

interface AtlasEntry {
  textures: Record<FacadeLayer, THREE.Texture>;
  materials: Map<string, THREE.MeshStandardMaterial>;
  state: 'pending' | 'ready' | 'failed';
}
const BYTES_PER_ENTRY = FACADE_ATLAS_SIZE ** 2 * 4 * 4 / 3 * 3;

/** A padded projection onto the actual exterior faces. Interior/cut faces stay unpainted. */
export function projectFacadeCoordinates(geometry: THREE.BufferGeometry, plan: FacadePlan, openingsOnly = false): void {
  const p = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const uv = new Float32Array(p.count * 3);
  const regions = new Int32Array(p.count);
  const { density, cells } = facadeAtlasLayout(plan);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    for (const [cell, face] of plan.elevations.entries()) {
      if (normals.getX(i) * face.normalX + normals.getZ(i) * face.normalZ < 0.98) continue;
      const u = (x - face.originX) * face.tangentX + (z - face.originZ) * face.tangentZ;
      const outward = (x - face.originX) * face.normalX + (z - face.originZ) * face.normalZ;
      if (Math.abs(u) > face.length / 2 + 1e-5 || y < plan.floor - 1e-5 || y > plan.wallTop + 1e-5
        || outward < -(openingsOnly ? Math.max(plan.revealDepth, plan.wallThickness * .75) : plan.revealDepth) - 0.003 || outward > Math.max(plan.postThickness * 2.5, 0.025)) continue;
      if (openingsOnly) {
        const opening = face.openings.findIndex(o => o.kind === 'window'
          && Math.abs(u - o.u) <= o.w / 2 + 1e-5
          && Math.abs(y - plan.floor - o.y) <= o.h / 2 + 1e-5);
        if (opening < 0) continue;
        regions[i] = cell * 10000 + opening + 1;
      }
      const atlas = cells[cell]!;
      uv[i * 3] = (atlas.x + (u + face.length / 2) * density) / FACADE_ATLAS_SIZE;
      uv[i * 3 + 1] = 1 - (atlas.y + (plan.wallTop - y) * density) / FACADE_ATLAS_SIZE;
      uv[i * 3 + 2] = 1;
      break;
    }
  }
  // A triangle must belong wholly to an elevation. Partial masks stretch an atlas edge
  // across cut faces, cap stones and projecting returns when interpolated by the GPU.
  const index = geometry.index;
  if (index) {
    const rejected = new Set<number>();
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (vertices.some(v => uv[v * 3 + 2] === 0) || (openingsOnly && vertices.some(v => regions[v] !== regions[vertices[0]!]))) vertices.forEach(v => rejected.add(v));
    }
    rejected.forEach(v => { uv[v * 3 + 2] = 0; });
  }
  // Only wall fabric and structural posts receive wall artwork. Nearby counters, crates,
  // shutters, foundations and roof joinery retain their production materials.
  if (index) for (const piece of geometry.userData['assemblyPieces'] ?? []) {
    const permitted = openingsOnly ? piece.stage === BUILD_STAGE.FITOUT
      : piece.stage === BUILD_STAGE.WALLS || piece.stage === BUILD_STAGE.FRAME;
    if (permitted) continue;
    for (let offset = piece.start; offset < piece.start + piece.count; offset++) {
      uv[index.getX(offset) * 3 + 2] = 0;
    }
  }
  geometry.setAttribute('aFacadeUv' , new THREE.Float32BufferAttribute(uv, 3));
}

export class FacadeTextureCache {
  private readonly entries = new Map<string, AtlasEntry>();
  private readonly queue: (() => Promise<void>)[] = [];
  private running = 0;
  private disposed = false;
  private readonly originalMaterials = new WeakMap<THREE.Material, THREE.Material>();
  private readonly geometryBindings = new WeakMap<THREE.BufferGeometry, Map<THREE.Material, { original: THREE.Material; decorated: THREE.Material }>>();
  private readonly bindings = new WeakMap<THREE.Mesh, { original: THREE.Material; decorated: THREE.Material }>();
  private readonly processed = new WeakSet<THREE.Object3D>();
  readonly strength = { value: 1 };
  /** Admission is bounded, rather than disposing textures still referenced by scene clones. */
  constructor(readonly maxEntries = 4, readonly rasterSize = FACADE_ATLAS_SIZE) {}

  setEnabled(enabled: boolean, root?: THREE.Object3D): void {
    this.strength.value = enabled ? 1 : 0;
    if (root) this.syncMaterials(root);
  }
  /** Restore the exact production material when disabled, including scene clones. */
  syncMaterials(root: THREE.Object3D): void {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      let binding = this.bindings.get(object) ?? this.geometryBindings.get(object.geometry)?.get(object.material);
      const original = this.originalMaterials.get(object.material);
      if (!binding && original) {
        binding = { original, decorated: object.material };
        this.bindings.set(object, binding);
      }
      if (binding) object.material = this.strength.value ? binding.decorated : binding.original;
    });
  }
  /** Benchmark against the unmodified production shader; restore even if drawing throws. */
  withProceduralMaterials<T>(root: THREE.Object3D, draw: () => T): T {
    const saved: { mesh: THREE.Mesh; material: THREE.Material }[] = [];
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const original = this.originalMaterials.get(object.material);
      if (original) { saved.push({ mesh: object, material: object.material }); object.material = original; }
    });
    try { return draw(); } finally { for (const entry of saved) entry.mesh.material = entry.material; }
  }
  stats(): { entries: number; ready: number; failed: number; pending: number; estimatedGpuBytes: number; materials: number } {
    const entries = [...this.entries.values()];
    return { entries: entries.length, ready: entries.filter(e => e.state === 'ready').length,
      failed: entries.filter(e => e.state === 'failed').length, pending: entries.filter(e => e.state === 'pending').length,
      estimatedGpuBytes: entries.length * BYTES_PER_ENTRY * (this.rasterSize / FACADE_ATLAS_SIZE) ** 2,
      materials: entries.reduce((sum, e) => sum + e.materials.size, 0) };
  }

  apply(root: THREE.Group): void {
    const plan = root.userData['facadePlan'] as FacadePlan | undefined;
    const wholeFacade = !!root.userData['facadeEligible'];
    const glazingOnly = !wholeFacade && !!root.userData['facadeGlazingEligible'];
    if (glazingOnly && plan && plan.spec.stage < BUILD_STAGE.FITOUT) return;
    if (!plan || !(wholeFacade || glazingOnly) || plan.spec.stage < BUILD_STAGE.WALLS || this.disposed || this.processed.has(root)) return;
    const key = facadeTextureKey(plan);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxEntries) { root.userData['facadeStatus'] = 'budget-fallback'; return; }
      // White placeholder preserves production shading while the asynchronous raster finishes.
      const placeholder = (): THREE.Texture => {
        if (typeof document !== 'undefined') {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          if (context) { context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1); }
          const t = new THREE.CanvasTexture(canvas); return t;
        }
        const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        t.needsUpdate = true; return t;
      };
      entry = { textures: { albedo: placeholder(), relief: placeholder(), surface: placeholder() }, materials: new Map(), state: 'pending' };
      // WebGL decodes colour before filtering; relief and roughness remain linear data.
      entry.textures.albedo.colorSpace = THREE.SRGBColorSpace;
      for (const layer of ['albedo', 'relief', 'surface'] as const) entry.textures[layer].name = `facade-${layer}`;
      this.entries.set(key, entry);
      const target = entry;
      // Headless geometry tests remain DOM-independent; the real browser owns rasterisation.
      if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
        this.queue.push(async () => {
          try {
            const artwork = facadeArtwork(plan);
            for (const layer of ['albedo', 'relief', 'surface'] as const) {
              if (this.disposed) return;
              const url = URL.createObjectURL(new Blob([artwork[layer]], { type: 'image/svg+xml' }));
              try {
                const image = new Image();
                image.src = url;
                await image.decode();
                if (this.disposed) return;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = this.rasterSize;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Facade raster context unavailable');
                context.drawImage(image, 0, 0);
                const texture = target.textures[layer];
                // Use a regular Texture for the canvas; DataTexture's upload path expects bytes.
                texture.image = canvas;
                texture.flipY = true;
                texture.generateMipmaps = true;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.anisotropy = 4;
                texture.needsUpdate = true;
              } finally { URL.revokeObjectURL(url); }
            }
            target.state = 'ready';
          } catch { target.state = 'failed'; }
        });
        this.pump();
      }
    }
    const atlas = entry;
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const id = object.name;
      const surface = object.userData['surface'] as string;
      if (['shadow', 'ground', 'garden', 'glow', 'forge', 'motif'].includes(surface)) return;
      const family = isArchitecturalMaterial(id) ? architecturalMaterial(id).family : undefined;
      if (glazingOnly && family !== 'glass') return;

      if (family === 'metal' || surface.startsWith('roof-')) return;
      projectFacadeCoordinates(object.geometry, plan, glazingOnly || family === 'glass');
      const coordinates = object.geometry.getAttribute('aFacadeUv');
      let painted = false;
      for (let i = 0; i < coordinates.count; i++) if (coordinates.getZ(i) > 0) { painted = true; break; }
      if (!painted) { object.geometry.deleteAttribute('aFacadeUv'); return; }
      const source = object.material;
      const materialKey = source.uuid;
      let material = atlas.materials.get(materialKey);
      if (!material) {
        material = source.clone();
        const oldCompile = source.onBeforeCompile.bind(source);
        const oldKey = source.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          oldCompile(shader, renderer);
          shader.uniforms['gbFacadeAtlas'] = { value: atlas.textures.albedo };
          shader.uniforms['gbFacadeRelief'] = { value: atlas.textures.relief };
          shader.uniforms['gbFacadeSurface'] = { value: atlas.textures.surface };
          shader.uniforms['gbFacadeStrength'] = this.strength;
          shader.uniforms['gbFacadeNight'] = { get value() { return source.emissiveIntensity; } };
          shader.uniforms['gbFacadeEmission'] = { get value() { return source.emissive; } };
          shader.uniforms['gbFacadeReady'] = { get value() { return atlas.state === 'ready' ? 1 : 0; } };
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aFacadeUv;\nvarying vec3 vFacadeUv;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacadeUv = aFacadeUv;');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
            uniform sampler2D gbFacadeAtlas;
            uniform sampler2D gbFacadeRelief;
            uniform sampler2D gbFacadeSurface;
            uniform float gbFacadeStrength;
            uniform float gbFacadeReady;
            uniform float gbFacadeNight;
            uniform vec3 gbFacadeEmission;
            varying vec3 vFacadeUv;
`)
            .replace('#include <color_fragment>', `#include <color_fragment>
              float gbFacadeMask = clamp(vFacadeUv.z, 0.0, 1.0) * gbFacadeStrength * gbFacadeReady * (gl_FrontFacing ? 1.0 : 0.0);
              vec3 facadeAlbedo = texture2D(gbFacadeAtlas, vFacadeUv.xy).rgb;
              diffuseColor.rgb = mix(diffuseColor.rgb, facadeAlbedo, gbFacadeMask);`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = mix(roughnessFactor, max(${family === 'glass' ? '0.055' : '0.18'}, texture2D(gbFacadeSurface, vFacadeUv.xy).r), gbFacadeMask);`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
              // Screen derivatives use the actual view-space surface: no UV tangent seams.
              float gbFacadeHeight = texture2D(gbFacadeRelief, vFacadeUv.xy).r;
              vec3 gbDx = dFdx(-vViewPosition), gbDy = dFdy(-vViewPosition);
              vec3 gbRx = cross(gbDy, normal), gbRy = cross(normal, gbDx);
              float gbDet = dot(gbDx, gbRx);
              float gbHx = texture2D(gbFacadeRelief, vFacadeUv.xy + dFdx(vFacadeUv.xy)).r - gbFacadeHeight;
              float gbHy = texture2D(gbFacadeRelief, vFacadeUv.xy + dFdy(vFacadeUv.xy)).r - gbFacadeHeight;
              // Match scene scaling while keeping shallow surface relief below structural geometry.
              float gbScale = length(dFdx(vViewPosition)) / max(length(dFdx(vFacadeUv.xy)), 0.000001) * 0.0008;
              vec3 gbGradient = sign(gbDet) * (gbHx * gbRx + gbHy * gbRy) * gbScale;
              vec3 gbReliefNormal = normalize(max(abs(gbDet), 0.0000001) * normal - gbGradient);
              normal = normalize(mix(normal, gbReliefNormal, gbFacadeMask));`)
            .replace('#include <aomap_fragment>', `#include <aomap_fragment>
              reflectedLight.indirectDiffuse *= mix(1.0, mix(0.82, 1.0, smoothstep(0.18, 0.48, gbFacadeHeight)), gbFacadeMask);`)
            .replace('normal = gbPerturbNormal(normal, gbHeight);', 'normal = gbPerturbNormal(normal, gbHeight * (1.0 - gbFacadeMask));')
            .replace('roughnessFactor * gbRough', 'roughnessFactor * mix(gbRough, 1.0, gbFacadeMask)');
          // Three pre-multiplies its emissive uniform by the clone intensity; use the live source colour.
          // Palette night updates affect the shared source; shader clones follow it live.
          if (family === 'glass') shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance = gbFacadeEmission * gbFacadeNight;
            float gbPaneLight = mix(0.35, 1.0, smoothstep(0.025, 0.18, dot(facadeAlbedo, vec3(0.2126, 0.7152, 0.0722))));
            totalEmissiveRadiance *= mix(1.0, gbPaneLight, gbFacadeMask);`);
        };
        material.customProgramCacheKey = () => `${oldKey}:godbox-facade-v6`;
        material.name = `${source.name}:svg-facade`;

        this.originalMaterials.set(material, source);
        atlas.materials.set(materialKey, material);
      }
      const binding = { original: source, decorated: material };
      this.bindings.set(object, binding);
      let geometryBindings = this.geometryBindings.get(object.geometry);
      if (!geometryBindings) { geometryBindings = new Map(); this.geometryBindings.set(object.geometry, geometryBindings); }
      geometryBindings.set(source, binding); geometryBindings.set(material, binding);
      object.material = this.strength.value ? material : source;
    });
    root.userData['facadeStatus'] = glazingOnly ? 'hybrid-glazing' : 'hybrid';
    this.processed.add(root);
  }

  private pump(): void {
    if (this.disposed || this.running >= 2) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running++;
    void job().finally(() => { this.running--; this.pump(); });
    this.pump();
  }

  dispose(): void {
    this.disposed = true; this.queue.length = 0;
    for (const entry of this.entries.values()) {
      Object.values(entry.textures).forEach(texture => texture.dispose());
      entry.materials.forEach(material => material.dispose());
    }
    this.entries.clear();
  }
}
