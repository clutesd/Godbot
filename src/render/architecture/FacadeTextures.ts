/** Owner-scoped GPU cache. Adds no meshes, draw calls, or simulation state. */
import * as THREE from 'three';
import { facadeAtlasLayout, FACADE_ATLAS_SIZE, type FacadePlan } from './FacadePlan';
import { facadeArtwork, facadeTextureKey } from './FacadeSvg';
import { ARTWORK_WIDTH, ORNAMENT_REFERENCE, STRUCTURE_ART, surfaceArtLayout, surfaceTileRect, type SurfaceArtCell } from './SurfaceArtPrograms';
import { SeededRandom } from '../../sim/prng';
/** Albedo, and one packed data texture: R roughness, G composition mask, B opening contents, A relief. */
type FacadeLayer = 'albedo' | 'surface';
import { architecturalMaterial, isArchitecturalMaterial, type ArchitecturalMaterialId } from './MaterialLibrary';
import { BUILD_STAGE } from '../assets/BuildStages';
import { PreparationWorker } from '../assets/PreparationWorker';

interface AtlasEntry {
  textures: Record<FacadeLayer, THREE.Texture>;
  materials: Map<string, THREE.MeshStandardMaterial>;
  state: 'idle' | 'pending' | 'ready' | 'failed';
  plan: FacadePlan;
  resolution: number;
  revision: number;
  distance: number;
  /** Atlas height (px) at which the finest material tile maps one texel to one screen pixel. */
  demand: number;
  /** Finest tile density at the full 1024 atlas, in texels per canonical unit. */
  texelDensity: number;
  loading: boolean;
}
const bytesAt = (size: number): number => size * size * 2 * 4 * 4 / 3 * 2;

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
      uv[i * 3] = (atlas.x + (u + face.length / 2) * density) / ARTWORK_WIDTH;
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

/**
 * Physical surface coordinates for the seamless material tile, in canonical building units.
 *
 * Every vertex gets the plane frame of its own (flat-shaded) face: walls course horizontally with
 * y up, roof slopes course along the eaves with v running up the slope, and timber turns its tile
 * so grain follows each member's long axis. Coordinates follow nested moving parts in object
 * space, so machinery animates with its painted surface. `z` carries height above the ground for
 * splash, damp and contact weathering in the shader.
 */
export function projectSurfaceCoordinates(geometry: THREE.BufferGeometry, plan: FacadePlan, id: string, transform = new THREE.Matrix4(), special?: 'ornament' | 'textile'): void {
  const ornament = !!special;
  if (!isArchitecturalMaterial(id)) return;
  const material = architecturalMaterial(id), program = material.appearance.program;
  const grainAware = !ornament && material.family === 'timber' && ['hewn-timber', 'sawn-board', 'log-stack'].includes(program);
  const verticalBoards = !ornament && material.family === 'timber' && id === plan.materials.wall && STRUCTURE_ART[plan.spec.archetype].boards === 'vertical';
  const cell = surfaceArtLayout(plan).find(c => c.material === id && (special === 'ornament' ? !!c.ornament : special === 'textile' ? !!c.textile : !c.ornament && !c.textile));
  const phaseRandom = new SeededRandom(`${plan.spec.seed}:${id}:tile-phase`);
  const tile = cell?.tile ?? 1, curtain = program === 'curtain-wall';
  const pu = curtain ? 0 : phaseRandom.range(0, tile), pv = curtain ? -plan.floor : phaseRandom.range(0, tile);
  const bottom = plan.surfaceDomain?.bottom ?? 0;
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const detail = geometry.getAttribute('aSurfaceDetail') as THREE.BufferAttribute | undefined;
  // w = 0 marks real coordinates; geometry without the attribute reads WebGL's default w = 1.
  const data = new Float32Array(positions.count * 4);
  const position = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3(), axis = new THREE.Vector3();
  const normalTransform = new THREE.Matrix3().getNormalMatrix(transform), rotation = new THREE.Matrix3().setFromMatrix4(transform);
  for (let i = 0; i < positions.count; i++) {
    position.fromBufferAttribute(positions, i).applyMatrix4(transform);
    normal.fromBufferAttribute(normals, i).applyMatrix3(normalTransform).normalize();
    const horizontal = Math.hypot(normal.x, normal.z);
    if (horizontal > 0.05) tangent.set(normal.z / horizontal, 0, -normal.x / horizontal); else tangent.set(1, 0, 0);
    bitangent.crossVectors(normal, tangent);
    let u = position.dot(tangent), v = position.dot(bitangent);
    let turn = verticalBoards && horizontal > 0.7;
    if (grainAware && detail) {
      const g = detail.getZ(i);
      axis.set(g < 0.25 ? 1 : 0, g >= 0.25 && g < 0.75 ? 1 : 0, g >= 0.75 ? 1 : 0).applyMatrix3(rotation);
      turn = Math.abs(axis.dot(bitangent)) > Math.abs(axis.dot(tangent));
    }
    if (turn) [u, v] = [v, -u];
    data[i * 4] = u + pu;
    data[i * 4 + 1] = v + pv;
    data[i * 4 + 2] = position.y - bottom;
  }
  geometry.setAttribute('aFacadeTile', new THREE.Float32BufferAttribute(data, 4));
  geometry.userData['surfaceArtClampedVertices'] = 0;
}

/** Tile programs whose units sit on a straight bed at the tile edge (see `rubble`). */
const LIFT_PROGRAMS = new Set<string>(['rubble', 'coursed-stone', 'ashlar']);

/** sRGB hex as the linear colour the shader compares against. */
function linearColor(hex: number): THREE.Color { return new THREE.Color(hex); }

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
  private readonly materialEntries = new WeakMap<THREE.Material, AtlasEntry>();
  private lastQualityUpdate = -Infinity;
  private budgetFallbacks = 0;
  private readonly rasterTimes: number[] = [];
  private readonly artWorkers: PreparationWorker[] = [];
  private readonly idleArtWorkers: PreparationWorker[] = [];
  /** Stable texture handles survive resizing and scene clones. Budget includes all three mip chains. */
  constructor(readonly maxEntries = 512, readonly rasterSize = FACADE_ATLAS_SIZE,
    readonly maxGpuBytes = 96 * 1024 * 1024, backgroundPreparation = true) {
    if (backgroundPreparation && PreparationWorker.available() && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
      // Match the bounded two-job pump; independent atlases can rasterize concurrently.
      this.artWorkers.push(new PreparationWorker(), new PreparationWorker());
      this.idleArtWorkers.push(...this.artWorkers);
    }
  }

  /** Rebalance twice per second using the nearest visible clone of each atlas. */
  updateQuality(root: THREE.Object3D, camera: THREE.Camera, now = performance.now()): void {
    if (now - this.lastQualityUpdate < 500 || this.disposed) return;
    this.lastQualityUpdate = now;
    for (const entry of this.entries.values()) { entry.distance = Infinity; entry.demand = 0; }
    // Screen-space demand: how many pixels one canonical unit of each building covers right now.
    const viewport = typeof window !== 'undefined' ? window.innerHeight * (window.devicePixelRatio || 1) : 1000;
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
    const focal = viewport / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    const point = new THREE.Vector3(), eye = camera.getWorldPosition(new THREE.Vector3()), sphere = new THREE.Sphere();
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const binding = this.geometryBindings.get(object.geometry)?.get(object.material);
      const entry = this.materialEntries.get(binding?.decorated ?? object.material);
      if (!entry) return;
      if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
      sphere.copy(object.geometry.boundingSphere!).applyMatrix4(object.matrixWorld);
      const distance = Math.max(0.05, sphere.center.distanceTo(eye) - sphere.radius);
      entry.distance = Math.min(entry.distance, object.getWorldPosition(point).distanceTo(eye));
      entry.demand = Math.max(entry.demand, FACADE_ATLAS_SIZE * focal * object.matrixWorld.getMaxScaleOnAxis() / distance / entry.texelDensity);
    });
    for (const entry of this.entries.values()) if (!entry.demand && entry.loading && entry.state !== 'ready') {
      entry.revision++; entry.loading = false; entry.state = 'idle';
    }
    this.rebalance();
    for (const entry of this.entries.values()) if (entry.state === 'idle' && entry.demand > 0) this.raster(entry);
  }

  private rebalance(): void {
    // Highest screen demand first: memory goes where texels are actually seen.
    const entries = [...this.entries.values()].sort((a,b) => b.demand-a.demand);
    const floor = Math.min(64, this.rasterSize);
    const sizes = new Map(entries.map(e => [e, floor]));
    let bytes = entries.length * bytesAt(floor);
    for (let size = floor*2; size <= this.rasterSize; size*=2) for (const entry of entries) {
      // One texel per pixel of the finest tile, rounded up to a power of two.
      const desired = Math.min(this.rasterSize, 2 ** Math.ceil(Math.log2(Math.max(floor, entry.demand))));
      const previous = sizes.get(entry)!;
      if (size > desired || previous !== size/2 || bytes+bytesAt(size)-bytesAt(previous)>this.maxGpuBytes) continue;
      sizes.set(entry,size); bytes+=bytesAt(size)-bytesAt(previous);
    }
    // Release large allocations before requesting any larger replacements.
    for (const entry of entries) if (sizes.get(entry)! < entry.resolution) this.resize(entry,sizes.get(entry)!);
    for (const entry of entries) if (sizes.get(entry)! > entry.resolution) this.resize(entry,sizes.get(entry)!);
  }

  private resize(entry: AtlasEntry, size: number): void {
    entry.resolution = size;
    entry.revision++;
    if (entry.state === 'idle' && !entry.demand) return;
    if (entry.state === 'ready' && typeof document !== 'undefined' && (entry.textures.albedo.image as HTMLCanvasElement).width >= size*2) {
      entry.loading = false;
      for (const texture of Object.values(entry.textures)) {
        const canvas = document.createElement('canvas'); canvas.width = size*2; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) { entry.state = 'failed'; console.error('SVG cache resize context unavailable'); return; }
        context.drawImage(texture.image as HTMLCanvasElement,0,0,canvas.width,canvas.height);
        texture.dispose(); this.closeImage(texture); texture.image = canvas; texture.needsUpdate = true;
      }
    } else this.raster(entry);
  }

  private raster(target: AtlasEntry): void {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return;
    if (target.state !== 'ready') target.state = 'pending';
    target.loading = true;
    const revision = target.revision, size = target.resolution;
    const current = (): boolean => !this.disposed && target.revision === revision;
    this.queue.push(async () => {
      if (!current()) return;
      const started = performance.now();
      try {
        if (this.artWorkers.length) {
          const images = await this.rasterInWorker(target.plan, size, current);
          if (!images) return;
          if (!current()) { images.forEach(image => image.close()); return; }
          (['albedo', 'surface'] as const).forEach((layer, i) => {
            const texture = target.textures[layer];
            texture.dispose(); this.closeImage(texture); texture.image = images[i]!;
            // ImageBitmap ignores UNPACK_FLIP_Y_WEBGL. The worker already flips its pixels.
            texture.flipY = false; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter; texture.anisotropy = 8; texture.needsUpdate = true;
          });
        } else {
        const artwork = facadeArtwork(target.plan);
        const layers = ['albedo','surface'] as const;
        const canvases: HTMLCanvasElement[] = [];
        for (const layer of ['albedo', 'surface', 'relief', 'mask', 'openings'] as const) {
          // Decode at the resident size; a low-quality atlas must not retain a full-size SVG image.
          const svg=artwork[layer].replace(`width="${ARTWORK_WIDTH}" height="${FACADE_ATLAS_SIZE}"`,`width="${size*2}" height="${size}"`);
          const url = URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
          const image = new Image();
          try {
            image.src = url; await image.decode();
            if(image.naturalWidth!==size*2||image.naturalHeight!==size)throw new Error('SVG decoder resolution mismatch');
            if (!current()) return;
            const canvas = document.createElement('canvas'); canvas.width = size*2; canvas.height = size;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('SVG raster context unavailable');
            context.drawImage(image,0,0,canvas.width,canvas.height); canvases.push(canvas);
          } finally { image.removeAttribute('src'); URL.revokeObjectURL(url); }
        }
        if (!current()) return;
        // One data texture: roughness in red, composition mask in green, opening contents in blue,
        // relief in alpha. Alpha stays in 128..255 so premultiplied canvas storage keeps the colour channels.
        const surfaceContext = canvases[1]!.getContext('2d', { willReadFrequently: true })!;
        const surfacePixels = surfaceContext.getImageData(0, 0, size * 2, size);
        const read = (canvas: HTMLCanvasElement): Uint8ClampedArray => canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size * 2, size).data;
        const reliefPixels = read(canvases[2]!), maskPixels = read(canvases[3]!), openingPixels = read(canvases[4]!);
        for (let i = 0; i < surfacePixels.data.length; i += 4) {
          surfacePixels.data[i + 1] = maskPixels[i + 1]!;
          surfacePixels.data[i + 2] = openingPixels[i]!;
          surfacePixels.data[i + 3] = 128 + (reliefPixels[i]! >> 1);
        }
        surfaceContext.putImageData(surfacePixels, 0, 0);
        for (const spent of canvases.slice(2)) spent.width = spent.height = 0;
        layers.forEach((layer,i) => {
          const texture = target.textures[layer];
          texture.dispose(); texture.image = canvases[i]!; texture.flipY = true;
          texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter; texture.anisotropy = 8; texture.needsUpdate = true;
        });
        }
        target.state = 'ready';
        target.loading = false;
        this.rasterTimes.push(performance.now() - started);
        if (this.rasterTimes.length > 256) this.rasterTimes.shift();
      } catch (error) {
        if (current()) { target.state = 'failed'; target.loading = false; console.error('SVG artwork raster failed',target.plan.spec.archetype,target.plan.spec.period,error); }
      }
    });
    this.pump();
  }

  private closeImage(texture: THREE.Texture): void {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  }

  private async rasterInWorker(plan: FacadePlan, size: number, current: () => boolean): Promise<ImageBitmap[] | undefined> {
    const worker = this.idleArtWorkers.pop()!;
    try {
      const images = await worker.run<ImageBitmap[]>({ kind: 'svg', plan, size }, [], current);
      if (!current()) { images.forEach(image => image.close()); return; }
      return images;
    } finally { this.idleArtWorkers.push(worker); }
  }

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
  /** A derived LOD mesh shares its source's material, so it also shares the artwork toggle. */
  inherit(derived: THREE.Mesh, source: THREE.Mesh): void {
    const binding = this.bindings.get(source) ?? (Array.isArray(source.material) ? undefined : this.geometryBindings.get(source.geometry)?.get(source.material));
    if (!binding) return;
    this.bindings.set(derived, binding);
    // Geometry-level bindings let scene clones of the tier (new meshes, shared geometry) toggle too.
    this.geometryBindings.set(derived.geometry, new Map([[binding.original, binding], [binding.decorated, binding]]));
  }

  /** Worker-built geometry is projected once on adoption, using the live owner's atlas/materials. */
  applyPrepared(root: THREE.Group, source: THREE.Object3D, coordinatesPrepared = false): void {
    root.userData = { ...source.userData };
    root.traverse(object => {
      if (object instanceof THREE.Mesh && !Array.isArray(object.material))
        object.material = this.originalMaterials.get(object.material) ?? object.material;
    });
    this.apply(root, coordinatesPrepared);
  }
  stats() {
    const entries = [...this.entries.values()];
    return { entries: entries.length, ready: entries.filter(e => e.state === 'ready').length,
      failed: entries.filter(e => e.state === 'failed').length, pending: entries.filter(e => e.state === 'pending' || e.loading).length,
      idle: entries.filter(e => e.state === 'idle').length,
      estimatedGpuBytes: entries.reduce((sum,e) => sum+bytesAt(e.resolution),0),
      budgetBytes: this.maxGpuBytes, budgetFallbacks: this.budgetFallbacks,
      rasterMs: { count: this.rasterTimes.length, median: [...this.rasterTimes].sort((a, b) => a - b)[this.rasterTimes.length >> 1] ?? 0, max: Math.max(0, ...this.rasterTimes) },
      resolutions: entries.reduce((counts,e) => { counts[e.resolution] = (counts[e.resolution] ?? 0)+1; return counts; },{} as Record<number,number>),
      backgroundPreparation: this.artWorkers.length > 0,
      materials: entries.reduce((sum, e) => sum + e.materials.size, 0) };
  }

  /** Explicit preload for diagnostic/offscreen consumers; live scenes request only visible atlases. */
  warmArtwork(): void {
    for (const entry of this.entries.values()) if (entry.state === 'idle') entry.demand = 256;
    this.rebalance();
    for (const entry of this.entries.values()) if (entry.state === 'idle') this.raster(entry);
  }

  apply(root: THREE.Group, coordinatesPrepared = false): void {
    const plan = root.userData['facadePlan'] as FacadePlan | undefined;
    const wholeFacade = !!root.userData['elevationArtworkEligible'] || !!root.userData['facadeEligible'];
    const wholeStructure = !!root.userData['surfaceArtworkEligible'];
    const glazingOnly = !wholeFacade && !!root.userData['facadeGlazingEligible'];
    if (!wholeStructure && glazingOnly && plan && plan.spec.stage < BUILD_STAGE.FITOUT) return;
    if (!plan || !(wholeStructure || wholeFacade || glazingOnly) || plan.spec.stage < BUILD_STAGE.FOUNDATION || this.disposed || this.processed.has(root)) return;
    const key = facadeTextureKey(plan);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxEntries || bytesAt(Math.min(64,this.rasterSize))*(this.entries.size+1)>this.maxGpuBytes) {
        root.userData['facadeStatus'] = 'budget-fallback'; this.budgetFallbacks++;
        console.warn('SVG artwork admission exhausted',plan.spec.archetype,plan.spec.period,this.stats()); return;
      }
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
      entry = { textures: { albedo: placeholder(), surface: placeholder() }, materials: new Map(), state: this.artWorkers.length ? 'idle' : 'pending', plan, resolution: Math.min(64,this.rasterSize), revision: 0, distance: 0,
        // Until a camera has seen it, a new building asks for a modest atlas rather than the maximum.
        demand: this.artWorkers.length ? 0 : 256, texelDensity: Math.min(...surfaceArtLayout(plan).map(c => c.width / c.tile), facadeAtlasLayout(plan).density * 2), loading: false };
      // WebGL decodes colour before filtering; relief and roughness remain linear data.
      entry.textures.albedo.colorSpace = THREE.SRGBColorSpace;
      for (const layer of ['albedo', 'surface'] as const) entry.textures[layer].name = `facade-${layer}`;
      this.entries.set(key, entry);
      this.rebalance();
      // Rebalance schedules changed sizes; a minimum-resolution entry still needs its first job.
      if (entry.revision === 0 && !this.artWorkers.length) this.raster(entry);
    }
    const atlas = entry;
    root.updateWorldMatrix(true,true);
    const inverseRoot=root.matrixWorld.clone().invert();
    const layout = surfaceArtLayout(plan);
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const id = object.name;
      const surface = String(object.userData['surface'] ?? '');
      if (['shadow', 'ground', 'garden', 'glow', 'forge'].includes(surface)) return;
      // Culture ornament geometry carries the carved and painted ornament tile on its host material.
      const ornament = surface === 'motif' || id === 'motif';
      const fabric = ['canvas', 'cloth'].includes(surface) || ['canvas', 'cloth'].includes(id);
      const ornamentCell = wholeStructure ? (ornament ? layout.find(c => c.ornament) : fabric ? layout.find(c => c.textile) : undefined) : undefined;
      if ((ornament || fabric) && !ornamentCell) return;
      const family = ornamentCell ? 'ornament' : isArchitecturalMaterial(id) ? architecturalMaterial(id).family : undefined;
      if (!wholeStructure && glazingOnly && family !== 'glass') return;
      if (!family) return;
      // The opening-aligned elevation composes surrounds, joinery and weathering over the wall;
      // every non-glass surface, including roofs, returns and machinery, carries its own tile.
      const elevation = !ornamentCell && !surface.startsWith('roof-') && (family === 'glass' || wholeFacade && (id === plan.materials.wall ||
        ['stone','ceramic'].includes(family) && (id === plan.materials.frame || id === plan.materials.trim)));
      if (elevation && !coordinatesPrepared) projectFacadeCoordinates(object.geometry, plan, family === 'glass');
      let composed = false;
      const elevationUv = object.geometry.getAttribute('aFacadeUv');
      if (elevation && elevationUv) for (let i = 0; i < elevationUv.count; i++) if (elevationUv.getZ(i) > 0) { composed = true; break; }
      if (!composed && elevationUv) object.geometry.deleteAttribute('aFacadeUv');
      const cell: SurfaceArtCell | undefined = ornamentCell ?? (wholeStructure ? layout.find(c => c.material === id && !c.ornament && !c.textile) : undefined);
      if (!composed && !cell) { object.geometry.deleteAttribute('aFacadeTile'); return; }
      if (!coordinatesPrepared) projectSurfaceCoordinates(object.geometry, plan, cell?.material ?? id, inverseRoot.clone().multiply(object.matrixWorld), ornamentCell ? (ornamentCell.textile ? 'textile' : 'ornament') : undefined);
      const source = object.material;
      const materialKey = source.uuid;
      let material = atlas.materials.get(materialKey);
      if (!material) {
        material = source.clone();
        const oldCompile = source.onBeforeCompile.bind(source);
        const oldKey = source.customProgramCacheKey();
        const reference = linearColor(ornamentCell ? ORNAMENT_REFERENCE : architecturalMaterial(id as ArchitecturalMaterialId).appearance.color);
        const zone = plan.spec.climate.zone;
        const moisture = zone === 'wet' ? .85 : zone === 'tropical' ? .8 : zone === 'snowy' ? .6 : zone === 'cold' ? .45 : zone === 'arid' ? .08 : .4;
        const rect = cell ? surfaceTileRect(cell) : [0, 0, 0, 0] as const;
        material.onBeforeCompile = (shader, renderer) => {
          oldCompile(shader, renderer);
          shader.uniforms['gbFacadeAtlas'] = { value: atlas.textures.albedo };
          shader.uniforms['gbFacadeSurface'] = { value: atlas.textures.surface };
          shader.uniforms['gbFacadeStrength'] = this.strength;
          shader.uniforms['gbFacadeNight'] = { get value() { return source.emissiveIntensity; } };
          shader.uniforms['gbFacadeEmission'] = { get value() { return source.emissive; } };
          shader.uniforms['gbFacadeReady'] = { get value() { return atlas.state === 'ready' ? 1 : 0; } };
          shader.uniforms['gbTileRect'] = { value: new THREE.Vector4(rect[0], rect[1], rect[2], rect[3]) };
          shader.uniforms['gbTileOn'] = { value: cell ? 1 : 0 };
          shader.uniforms['gbTileScale'] = { value: cell ? 1 / cell.tile : 1 };
          // Programs laid in level lifts (rubble, coursed stone, ashlar) start every tile on a
          // straight bed, so each lift of tiles can slide sideways by its own hashed amount.
          shader.uniforms['gbTileLift'] = { value: cell && !ornamentCell && LIFT_PROGRAMS.has(cell.program) ? 1 : 0 };
          shader.uniforms['gbTileDepth'] = { value: cell?.depth ?? 0 };
          shader.uniforms['gbGlass'] = { value: family === 'glass' ? 1 : 0 };
          // Continuous finishes have no unit grid, so two offset samples can be blended freely.
          shader.uniforms['gbTileBlend'] = { value: !ornamentCell && ['plaster', 'daub-panel', 'adobe-render'].includes(architecturalMaterial(id as ArchitecturalMaterialId).appearance.program) ? 1 : 0 };
          shader.uniforms['gbRefColor'] = { value: reference };
          shader.uniforms['gbArtWear'] = { value: plan.spec.age.wear * (1 - plan.spec.age.maintenance * .3) };
          shader.uniforms['gbArtMoisture'] = { value: moisture };
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aFacadeUv;\nattribute vec4 aFacadeTile;\nvarying vec3 vFacadeUv;\nvarying vec3 vFacadeTile;\nvarying float vFacadeUp;\nvarying float vFacadeHas;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacadeUv = aFacadeUv;\nvFacadeTile = aFacadeTile.xyz;\nvFacadeHas = 1.0 - aFacadeTile.w;\nvFacadeUp = objectNormal.y;');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
            uniform sampler2D gbFacadeAtlas;
            uniform sampler2D gbFacadeSurface;
            uniform float gbFacadeStrength;
            uniform float gbFacadeReady;
            uniform float gbFacadeNight;
            uniform vec3 gbFacadeEmission;
            uniform vec4 gbTileRect;
            uniform float gbTileOn;
            uniform float gbTileScale;
            uniform float gbTileLift;
            uniform float gbTileDepth;
            uniform float gbTileBlend;
            uniform float gbGlass;
            uniform vec3 gbRefColor;
            uniform float gbArtWear;
            uniform float gbArtMoisture;
            varying vec3 vFacadeUv;
            varying vec3 vFacadeTile;
            varying float vFacadeUp;
            varying float vFacadeHas;
            // Relief is packed into the data texture's alpha as 0.5..1.
            float gbRelief(vec4 s) { return clamp((s.a - 0.5) * 2.0, 0.0, 1.0); }
            float gbArtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float gbArtNoise(vec2 p) {
              vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
              return mix(mix(gbArtHash(i), gbArtHash(i + vec2(1.0, 0.0)), u.x), mix(gbArtHash(i + vec2(0.0, 1.0)), gbArtHash(i + vec2(1.0, 1.0)), u.x), u.y);
            }
            // A seamless tile repeated at physical scale. Gradients come from the continuous
            // coordinate, so the wrap never shows a mip seam.
            // Wall fabric shows its own tile through painted opening contents; only glass shows them.
            float gbOpenField(vec4 surface, float tileOn) { return max(surface.g, surface.b * tileOn * (1.0 - gbGlass)); }
            float gbTileMix = 0.0;
            vec4 gbTileTex(sampler2D s, vec2 p, vec2 gx, vec2 gy) {
              vec4 a = textureGrad(s, gbTileRect.xy + fract(p) * gbTileRect.zw, gx * gbTileRect.zw, gy * gbTileRect.zw);
              if (gbTileMix <= 0.0) return a;
              vec4 b = textureGrad(s, gbTileRect.xy + fract(p * vec2(-1.0, 1.0) + vec2(0.37, 0.61)) * gbTileRect.zw, gx * vec2(-1.0, 1.0) * gbTileRect.zw, gy * vec2(-1.0, 1.0) * gbTileRect.zw);
              return mix(a, b, gbTileMix);
            }
`)
            .replace('void main() {', `void main() {
              float gbFacadeElev = step(0.5, vFacadeUv.z);
              // Geometry that shares a decorated material without tile coordinates (debris, props)
              // keeps the production shading rather than sampling one constant texel.
              float gbTileHere = gbTileOn * step(0.5, vFacadeHas);
              float gbFacadeMask = max(gbFacadeElev, gbTileHere) * gbFacadeStrength * gbFacadeReady * (gl_FrontFacing ? 1.0 : 0.0);
              vec3 gbArtAlbedo = vec3(1.0);
              float gbArtRough = 1.0, gbArtCavity = 1.0, gbArtHx = 0.0, gbArtHy = 0.0;`)
            .replace('diffuseColor.rgb *= clamp(gbTone, 0.5, 1.35);', 'diffuseColor.rgb *= mix(clamp(gbTone, 0.5, 1.35), 1.0, gbFacadeMask);')
            .replace('#include <color_fragment>', `#include <color_fragment>
              if (gbFacadeMask > 0.0) {
                vec2 gbP = vFacadeTile.xy * gbTileScale, gbE = vFacadeUv.xy;
                gbTileMix = gbTileBlend * smoothstep(0.3, 0.7, gbArtNoise(gbP * 1.3 + 5.0));
                vec2 gbPx = dFdx(gbP), gbPy = dFdy(gbP), gbEx = dFdx(gbE), gbEy = dFdy(gbE);
                // Slide each lift of tiles by its own amount; gradients come from the unshifted
                // coordinate, so the shift never selects a different mip at the bed joint.
                gbP.x += gbTileLift * gbArtHash(vec2(floor(gbP.y), gbTileRect.x * 97.0 + gbTileRect.y * 13.0));
                // Far away a tile collapses to its own average rather than aliasing or bleeding.
                vec2 gbAtlasSize = vec2(textureSize(gbFacadeAtlas, 0));
                float gbCellPx = max(gbTileRect.z * gbAtlasSize.x, 1.0);
                float gbFoot = max(length(gbPx), length(gbPy)) * gbCellPx;
                // Mips stay inside the wrapped bleed up to ~5 levels; only then fade to the mean.
                float gbFar = smoothstep(20.0, 40.0, gbFoot) * gbTileHere;
                float gbMeanLod = log2(gbCellPx) - 1.5;
                vec2 gbCentre = gbTileRect.xy + gbTileRect.zw * 0.5;
                vec3 gbTileA = mix(gbTileTex(gbFacadeAtlas, gbP, gbPx, gbPy).rgb, textureLod(gbFacadeAtlas, gbCentre, gbMeanLod).rgb, gbFar);
                float gbTileS = mix(gbTileTex(gbFacadeSurface, gbP, gbPx, gbPy).r, textureLod(gbFacadeSurface, gbCentre, gbMeanLod).r, gbFar);
                float gbTileR = gbRelief(gbTileTex(gbFacadeSurface, gbP, gbPx, gbPy));
                float gbTileRx = gbRelief(gbTileTex(gbFacadeSurface, gbP + gbPx, gbPx, gbPy));
                float gbTileRy = gbRelief(gbTileTex(gbFacadeSurface, gbP + gbPy, gbPx, gbPy));
                vec3 gbElevA = texture2D(gbFacadeAtlas, gbE).rgb;
                vec3 gbElevSurface = texture2D(gbFacadeSurface, gbE).rgb;
                vec2 gbElevS = vec2(gbElevSurface.r, gbOpenField(vec4(gbElevSurface, 1.0), gbTileHere));
                float gbElevR = gbRelief(texture2D(gbFacadeSurface, gbE));
                float gbElevRx = gbRelief(texture2D(gbFacadeSurface, gbE + gbEx));
                float gbElevRy = gbRelief(texture2D(gbFacadeSurface, gbE + gbEy));
                float gbField = gbTileHere * (gbFacadeElev > 0.5 ? gbElevS.g : 1.0);
                float gbFieldX = gbTileHere * (gbFacadeElev > 0.5 ? gbOpenField(texture2D(gbFacadeSurface, gbE + gbEx), gbTileHere) : 1.0);
                float gbFieldY = gbTileHere * (gbFacadeElev > 0.5 ? gbOpenField(texture2D(gbFacadeSurface, gbE + gbEy), gbTileHere) : 1.0);
                // Heights in canonical units: tile faces sit near 0.78, the composition plane at 0.5.
                float gbH0 = mix((gbElevR - 0.5) * 0.008, (gbTileR - 0.78) * gbTileDepth, gbField);
                float gbH1 = mix((gbElevRx - 0.5) * 0.008, (gbTileRx - 0.78) * gbTileDepth, gbFieldX);
                float gbH2 = mix((gbElevRy - 0.5) * 0.008, (gbTileRy - 0.78) * gbTileDepth, gbFieldY);
                float gbFlatten = 1.0 - gbFar;
                gbArtHx = (gbH1 - gbH0) * gbFlatten;
                gbArtHy = (gbH2 - gbH0) * gbFlatten;
                gbArtCavity = mix(smoothstep(0.18, 0.5, gbElevR), smoothstep(0.1, 0.62, gbTileR), gbField);
                gbArtCavity = mix(gbArtCavity, 1.0, gbFar * 0.6);
                vec3 gbAlbedo = gbFacadeElev > 0.5 ? mix(gbElevA, gbTileA * gbElevA, gbField) : gbTileA;
                gbArtRough = gbFacadeElev > 0.5 ? mix(gbElevS.r, gbTileS, gbField) : gbTileS;
                // Weathering no single tile can carry: broad tonal drift that breaks the repeat,
                // splash and rising damp at the foot, and moss on surfaces that hold water.
                vec2 gbW = vFacadeTile.xy;
                float gbDrift = gbArtNoise(gbW * 1.7) * 0.55 + gbArtNoise(gbW * 6.3 + 4.1) * 0.3 + gbArtNoise(gbW * 19.0 + 7.7) * 0.15;
                float gbHue = gbArtNoise(gbW * 3.1 + 17.0) - 0.5;
                gbAlbedo *= mix(vec3(1.0), (0.84 + gbDrift * 0.3) * vec3(1.0 + gbHue * 0.08, 1.0, 1.0 - gbHue * 0.08), gbTileHere);
                // Run-off: faint vertical tracks of dirt washed down walls and roof slopes.
                float gbStreak = smoothstep(0.52, 0.95, gbArtNoise(vec2(gbW.x * 16.0, gbW.y * 1.1) + 3.0)) * (0.3 + gbArtWear);
                gbAlbedo *= 1.0 - gbStreak * 0.2 * gbTileHere * (1.0 - gbFacadeElev * 0.6);
                float gbDamp = (1.0 - smoothstep(0.0, 0.035 + gbArtMoisture * 0.05, vFacadeTile.z)) * (0.35 + gbArtMoisture * 0.5) * (1.0 - gbFacadeElev);
                gbAlbedo *= 1.0 - gbDamp * 0.32;
                gbArtRough = mix(gbArtRough, gbArtRough * 0.82, gbDamp);
                float gbMoss = smoothstep(0.3, 0.85, vFacadeUp) * smoothstep(0.45, 0.8, gbArtNoise(gbW * 5.0 + 9.0)) * gbArtWear * (0.3 + gbArtMoisture) * gbTileHere;
                gbAlbedo = mix(gbAlbedo, vec3(0.13, 0.15, 0.07) + gbAlbedo * 0.35, clamp(gbMoss * 0.55, 0.0, 0.45));
                gbAlbedo *= mix(0.8, 1.0, gbArtCavity);
                gbArtAlbedo = gbAlbedo;
                // The production colour, culture tint and baked occlusion still govern the result.
                vec3 gbTint = clamp(diffuseColor.rgb / max(gbRefColor, vec3(0.004)), vec3(0.05), vec3(4.0));
                diffuseColor.rgb = mix(diffuseColor.rgb, gbAlbedo * gbTint, gbFacadeMask);
                // Curtain-wall framing and spandrels are opaque even though the glazing is not.
                diffuseColor.a = mix(diffuseColor.a, 1.0, gbFacadeMask * gbGlass * gbField * smoothstep(0.7, 0.76, gbTileR));
              }`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = mix(roughnessFactor, max(${family === 'glass' ? '0.055' : '0.18'}, gbArtRough), gbFacadeMask);`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
              if (gbFacadeMask > 0.0) {
                // Height steps measured along the real surface: no UV tangent seams at corners.
                vec3 gbDx = dFdx(-vViewPosition), gbDy = dFdy(-vViewPosition);
                vec3 gbRx = cross(gbDy, normal), gbRy = cross(normal, gbDx);
                float gbDet = dot(gbDx, gbRx);
                float gbUnits = length(gbDx) / max(length(dFdx(vFacadeTile.xy)), 1e-6);
                vec3 gbGradient = sign(gbDet) * (gbArtHx * gbRx + gbArtHy * gbRy) * gbUnits;
                vec3 gbReliefNormal = normalize(max(abs(gbDet), 1e-7) * normal - gbGradient);
                normal = normalize(mix(normal, gbReliefNormal, gbFacadeMask));
              }`)
            .replace('#include <aomap_fragment>', `#include <aomap_fragment>
              reflectedLight.indirectDiffuse *= mix(1.0, mix(0.55, 1.0, gbArtCavity), gbFacadeMask);`)
            .replace('normal = gbPerturbNormal(normal, gbHeight);', 'normal = gbPerturbNormal(normal, gbHeight * (1.0 - gbFacadeMask));')
            .replace('roughnessFactor * gbRough', 'roughnessFactor * mix(gbRough, 1.0, gbFacadeMask)');
          // Three pre-multiplies its emissive uniform by the clone intensity; use the live source colour.
          // Palette night updates affect the shared source; shader clones follow it live.
          if (family === 'glass') shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance = gbFacadeEmission * gbFacadeNight;
            float gbPaneLight = mix(0.35, 1.0, smoothstep(0.025, 0.18, dot(gbArtAlbedo, vec3(0.2126, 0.7152, 0.0722))));
            totalEmissiveRadiance *= mix(1.0, gbPaneLight, gbFacadeMask);`);
        };
        material.customProgramCacheKey = () => `${oldKey}:godbox-facade-v10`;
        material.name = `${source.name}:svg-facade`;

        this.originalMaterials.set(material, source);
        this.materialEntries.set(material, atlas);
        atlas.materials.set(materialKey, material);
      }
      const binding = { original: source, decorated: material };
      this.bindings.set(object, binding);
      let geometryBindings = this.geometryBindings.get(object.geometry);
      if (!geometryBindings) { geometryBindings = new Map(); this.geometryBindings.set(object.geometry, geometryBindings); }
      geometryBindings.set(source, binding); geometryBindings.set(material, binding);
      object.material = this.strength.value ? material : source;
    });
    root.userData['facadeStatus'] = !wholeStructure && glazingOnly ? 'hybrid-glazing' : 'hybrid';
    root.userData['surfaceArtPrograms'] = surfaceArtLayout(plan).map(c => c.program);
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
    this.artWorkers.forEach(worker => worker.dispose());
    for (const entry of this.entries.values()) {
      Object.values(entry.textures).forEach(texture => { texture.dispose(); this.closeImage(texture); });
      entry.materials.forEach(material => material.dispose());
    }
    this.entries.clear();
  }
}
