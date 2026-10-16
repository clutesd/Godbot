/**
 * Distance tiers derived from the full-detail composition itself.
 *
 * A distant tier keeps the building's own walls, openings, roof, chimneys, towers and porches, in
 * the same decorated materials, and drops only the pieces too small to cover a pixel at the tier's
 * range (pegs, latches, glazing bars, shutter boards, fittings). Because geometry, artwork and
 * material are shared with full detail, a tier swap changes only sub-pixel content: no colour jump,
 * no stand-in roof, no beige box. Pieces sharing a material are merged so a tier costs at most one
 * draw call per material.
 */
import * as THREE from 'three';

export interface DerivedTierStats {
  sourceTriangles: number;
  triangles: number;
  sourceMeshes: number;
  meshes: number;
}

/** Edge length of the quantisation grid that joins the separate faces of one solid. */
const WELD = 1e-4;

/**
 * Connected solids in one geometry. Faces of a box are separate vertices (flat normals), so
 * vertices are joined by quantised position as well as by shared triangles.
 */
function components(geometry: THREE.BufferGeometry): { triangles: number[][] } {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const vertexAt = (t: number, k: number): number => index ? index.getX(t * 3 + k) : t * 3 + k;
  const parent = new Int32Array(position.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (v: number): number => { while (parent[v] !== v) { parent[v] = parent[parent[v]!]!; v = parent[v]!; } return v; };
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const welded = new Map<string, number>();
  for (let v = 0; v < position.count; v++) {
    const key = `${Math.round(position.getX(v) / WELD)},${Math.round(position.getY(v) / WELD)},${Math.round(position.getZ(v) / WELD)}`;
    const other = welded.get(key);
    if (other === undefined) welded.set(key, v); else union(v, other);
  }
  for (let t = 0; t < triangleCount; t++) { union(vertexAt(t, 0), vertexAt(t, 1)); union(vertexAt(t, 0), vertexAt(t, 2)); }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    const root = find(vertexAt(t, 0));
    let list = groups.get(root);
    if (!list) { list = []; groups.set(root, list); }
    list.push(t);
  }
  return { triangles: [...groups.values()] };
}

/** Largest and second-largest extent of a solid in the tier's frame: its length and the width it shows from any side. */
function extents(geometry: THREE.BufferGeometry, triangles: readonly number[], matrix: THREE.Matrix4, box: THREE.Box3): [number, number] {
  const position = geometry.getAttribute('position'), index = geometry.index, point = new THREE.Vector3();
  box.makeEmpty();
  for (const t of triangles) for (let k = 0; k < 3; k++) {
    const v = index ? index.getX(t * 3 + k) : t * 3 + k;
    box.expandByPoint(point.fromBufferAttribute(position, v).applyMatrix4(matrix));
  }
  const size = box.getSize(point);
  const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
  return [dims[0]!, dims[1]!];
}

type ArrayKind = 'f32' | 'i8' | 'u8' | 'i16' | 'u16';

/** Copies the kept triangles of `source`, transformed into the tier frame, into a merge bucket. */
interface Bucket {
  material: THREE.Material;
  template: THREE.Mesh;
  attributes: Map<string, { itemSize: number; normalized: boolean; array: ArrayKind; values: number[] }>;
  index: number[];
  vertices: number;
}

const arrayKind = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): ArrayKind => {
  const array = attribute.array;
  return array instanceof Int8Array ? 'i8' : array instanceof Uint8Array ? 'u8' : array instanceof Int16Array ? 'i16' : array instanceof Uint16Array ? 'u16' : 'f32';
};

function signature(geometry: THREE.BufferGeometry): string {
  return Object.keys(geometry.attributes).sort().map(name => {
    const a = geometry.getAttribute(name);
    return `${name}:${a.itemSize}:${arrayKind(a)}:${a.normalized ? 1 : 0}`;
  }).join('|');
}

function append(bucket: Bucket, geometry: THREE.BufferGeometry, triangles: readonly number[], matrix: THREE.Matrix4): void {
  const index = geometry.index, remap = new Map<number, number>();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix), vector = new THREE.Vector3();
  const names = Object.keys(geometry.attributes);
  for (const name of names) if (!bucket.attributes.has(name)) {
    const a = geometry.getAttribute(name);
    bucket.attributes.set(name, { itemSize: a.itemSize, normalized: a.normalized, array: arrayKind(a), values: [] });
  }
  for (const t of triangles) for (let k = 0; k < 3; k++) {
    const v = index ? index.getX(t * 3 + k) : t * 3 + k;
    let mapped = remap.get(v);
    if (mapped === undefined) {
      mapped = bucket.vertices++;
      remap.set(v, mapped);
      for (const name of names) {
        const source = geometry.getAttribute(name), target = bucket.attributes.get(name)!.values;
        if (name === 'position') { vector.fromBufferAttribute(source, v).applyMatrix4(matrix); target.push(vector.x, vector.y, vector.z); }
        else if (name === 'normal') { vector.fromBufferAttribute(source, v).applyMatrix3(normalMatrix).normalize(); target.push(vector.x, vector.y, vector.z); }
        else for (let c = 0; c < source.itemSize; c++) target.push(source.getComponent(v, c));
      }
    }
    bucket.index.push(mapped);
  }
}


/**
 * Re-triangulates every plane of a tier from its outline. Abutting units (wall blocks, courses,
 * deck boards) and build-step face cuts collapse into one polygon per flat region, holes and all,
 * reusing only original boundary vertices, so attributes stay exact. A plane whose rebuilt area
 * does not match the original keeps its own triangles.
 */
function mergeCoplanar(positions: readonly number[], index: readonly number[], options: TierOptions, facade?: readonly number[]): number[] {
  const QUANT = 1e-5;
  const weldOf = new Map<string, number>(), weld: number[] = [];
  const vertexCount = positions.length / 3;
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(positions[v * 3]! / QUANT)},${Math.round(positions[v * 3 + 1]! / QUANT)},${Math.round(positions[v * 3 + 2]! / QUANT)}`;
    let id = weldOf.get(key);
    if (id === undefined) { id = weldOf.size; weldOf.set(key, id); }
    weld.push(id);
  }
  const P = (v: number): THREE.Vector3 => new THREE.Vector3(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
  const planes = new Map<string, Plane>();
  const output: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const a = P(index[t]!), b = P(index[t + 1]!), c = P(index[t + 2]!);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const doubled = n.length();
    if (doubled < 1e-12) continue;
    n.divideScalar(doubled);
    // Preserve artwork boundaries when neighbouring coplanar pieces use different
    // elevation masks. Retriangulation must not interpolate across that seam.
    const key = `${Math.round(n.x * 2000)},${Math.round(n.y * 2000)},${Math.round(n.z * 2000)},${Math.round(n.dot(a) / 2e-4)},${facade?.[index[t]! * 3 + 2] ?? 0}`;
    let plane = planes.get(key);
    if (!plane) { plane = { normal: n.clone(), triangles: [], area: 0 }; planes.set(key, plane); }
    plane.triangles.push(t);
    plane.area += doubled / 2;
  }
  for (const plane of planes.values()) {
    // Undersides (soffits, footings, deck bottoms) are edge-on or hidden from any raised view at skyline range.
    if (options.fillOpenings && plane.normal.y < -0.7) continue;
    const merged = plane.triangles.length > 2 || options.fillOpenings ? retriangulatePlane(plane, index, weld, P, options) : undefined;
    if (merged) output.push(...merged);
    else for (const t of plane.triangles) output.push(index[t]!, index[t + 1]!, index[t + 2]!);
  }
  return output;
}

interface Plane { normal: THREE.Vector3; triangles: number[]; area: number }

function retriangulatePlane(plane: Plane, index: readonly number[], weld: readonly number[], P: (v: number) => THREE.Vector3,
  options: TierOptions): number[] | undefined {
  // One representative original vertex per welded corner; coplanar copies carry equal attributes.
  const representative = new Map<number, number>();
  for (const t of plane.triangles) for (let k = 0; k < 3; k++) {
    const v = index[t + k]!;
    if (!representative.has(weld[v]!)) representative.set(weld[v]!, v);
  }
  const normal = plane.normal;
  const u = (Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).cross(normal).normalize();
  const w = new THREE.Vector3().crossVectors(normal, u);
  const flat = new Map<number, THREE.Vector2>();
  for (const [id, v] of representative) { const p = P(v); flat.set(id, new THREE.Vector2(p.dot(u), p.dot(w))); }
  // Directed edges, split wherever another corner of the plane lies on them (T-junctions);
  // an edge met in both directions is interior and cancels.
  // Corners sorted along u, so each edge only tests the corners inside its own u range.
  const ids = [...flat.keys()].sort((x, y) => flat.get(x)!.x - flat.get(y)!.x);
  const us = ids.map(id => flat.get(id)!.x);
  const lowerBound = (value: number): number => { let lo = 0, hi = us.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (us[mid]! < value) lo = mid + 1; else hi = mid; } return lo; };
  const edges = new Map<string, number>();
  const addEdge = (a: number, b: number): void => {
    const reverse = `${b},${a}`, count = edges.get(reverse);
    if (count) { if (count === 1) edges.delete(reverse); else edges.set(reverse, count - 1); return; }
    edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
  };
  for (const t of plane.triangles) for (let k = 0; k < 3; k++) {
    const a = weld[index[t + k]!]!, b = weld[index[t + (k + 1) % 3]!]!;
    const pa = flat.get(a)!, pb = flat.get(b)!;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, length2 = dx * dx + dy * dy;
    const between: [number, number][] = [];
    const uMax = Math.max(pa.x, pb.x) + 1e-7;
    for (let i = lowerBound(Math.min(pa.x, pb.x) - 1e-7); i < ids.length && us[i]! <= uMax; i++) {
      const id = ids[i]!;
      if (id === a || id === b) continue;
      const q = flat.get(id)!, s = ((q.x - pa.x) * dx + (q.y - pa.y) * dy) / length2;
      if (s <= 1e-6 || s >= 1 - 1e-6) continue;
      const cross = (q.x - pa.x) * dy - (q.y - pa.y) * dx;
      if (cross * cross / length2 < 1e-12) between.push([s, id]);
    }
    between.sort((x, y) => x[0] - y[0]);
    let from = a;
    for (const [, id] of between) { addEdge(from, id); from = id; }
    addEdge(from, b);
  }
  // Chain the surviving boundary edges into closed loops.
  const outgoing = new Map<number, number[]>();
  for (const [key, count] of edges) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    let list = outgoing.get(a);
    if (!list) { list = []; outgoing.set(a, list); }
    for (let i = 0; i < count; i++) list.push(b);
  }
  const loops: number[][] = [];
  for (const start of [...outgoing.keys()]) {
    while (outgoing.get(start)?.length) {
      const loop = [start];
      let current = outgoing.get(start)!.pop()!;
      for (let guard = 0; current !== start; guard++) {
        if (guard > 100000) return undefined;
        loop.push(current);
        const next = outgoing.get(current);
        if (!next?.length) return undefined;
        current = next.pop()!;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  const signedArea = (loop: readonly number[]): number => THREE.ShapeUtils.area(loop.map(id => flat.get(id)!));
  const outers = loops.filter(l => signedArea(l) > 0), holes = loops.filter(l => signedArea(l) < 0);
  const inside = (point: THREE.Vector2, loop: readonly number[]): boolean => {
    let hit = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = flat.get(loop[i]!)!, b = flat.get(loop[j]!)!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const owned = outers.map(() => [] as number[][]);
  for (const hole of holes) {
    const probe = flat.get(hole[0]!)!.clone().lerp(flat.get(hole[1]!)!, 0.5);
    let best = -1, bestArea = Infinity;
    outers.forEach((outer, i) => { const area = signedArea(outer); if (area < bestArea && inside(probe, outer)) { best = i; bestArea = area; } });
    if (best < 0) return undefined;
    owned[best]!.push(hole);
  }
  // A skyline tier closes window and door voids, which are sub-pixel at its range.
  let expected = plane.area;
  if (options.fillOpenings) {
    for (const hole of holes) expected += Math.abs(signedArea(hole));
    for (const list of owned) list.length = 0;
  }
  const result: number[] = [];
  let area = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const [i, outer] of outers.entries()) {
    const holeLoops = owned[i]!, all = [outer, ...holeLoops].flat();
    const faces = THREE.ShapeUtils.triangulateShape(outer.map(id => flat.get(id)!), holeLoops.map(h => h.map(id => flat.get(id)!)));
    for (const face of faces) {
      // A sliver outside the outline (from a self-touching loop) has almost no area but reads as a
      // stray line at range; any triangle whose centroid leaves the outline rejects the plane.
      const centroid = new THREE.Vector2();
      for (const k of face) centroid.add(flat.get(all[k]!)!);
      centroid.divideScalar(3);
      if (!inside(centroid, outer)) return undefined;
      const [a, b, c] = face.map(k => representative.get(all[k]!)!) as [number, number, number];
      const A = P(a), n = e1.subVectors(P(b), A).cross(e2.subVectors(P(c), A));
      area += n.length() / 2;
      if (n.dot(normal) >= 0) result.push(a, b, c); else result.push(a, c, b);
    }
  }
  if (Math.abs(area - expected) > expected * 0.01 + 1e-9) return undefined;
  if (!options.fillOpenings && result.length / 3 >= plane.triangles.length) return undefined;
  return result;
}

/**
 * Drops vertices no triangle references and welds identical corners. Tier sources are triangle
 * soup, and a tier should cost what it draws. Corners are bucketed by position and normal, then
 * merged only when every attribute matches exactly.
 */
function compact(bucket: Bucket): void {
  const attributes = [...bucket.attributes.values()];
  const position = bucket.attributes.get('position')!.values, normal = bucket.attributes.get('normal')?.values;
  const remap = new Map<number, number>(), firstOf: number[] = [], candidates = new Map<string, number[]>();
  const same = (a: number, b: number): boolean => attributes.every(({ itemSize, values }) => {
    for (let c = 0; c < itemSize; c++) if (values[a * itemSize + c] !== values[b * itemSize + c]) return false;
    return true;
  });
  for (const v of bucket.index) {
    if (remap.has(v)) continue;
    const key = `${position[v * 3]},${position[v * 3 + 1]},${position[v * 3 + 2]}${normal ? `,${normal[v * 3]},${normal[v * 3 + 1]},${normal[v * 3 + 2]}` : ''}`;
    const list = candidates.get(key);
    const match = list?.find(target => same(firstOf[target]!, v));
    if (match !== undefined) { remap.set(v, match); continue; }
    const id = firstOf.length;
    firstOf.push(v); remap.set(v, id);
    if (list) list.push(id); else candidates.set(key, [id]);
  }
  for (const attribute of attributes) {
    const size = attribute.itemSize, values = new Array<number>(firstOf.length * size);
    firstOf.forEach((from, to) => { for (let c = 0; c < size; c++) values[to * size + c] = attribute.values[from * size + c]!; });
    attribute.values = values;
  }
  bucket.index = bucket.index.map(v => remap.get(v)!);
  bucket.vertices = firstOf.length;
}

function buildBucket(bucket: Bucket, options: TierOptions): THREE.Mesh {
  if (options.merge !== false || options.fillOpenings) bucket.index = mergeCoplanar(bucket.attributes.get('position')!.values, bucket.index, options, bucket.attributes.get('aFacadeUv')?.values);
  compact(bucket);
  const geometry = new THREE.BufferGeometry();
  for (const [name, a] of bucket.attributes) {
    const values = a.values;
    // Normalised integer attributes hold the 0..1 / -1..1 value read by getComponent; requantise.
    const scale = (max: number): number[] => values.map(v => Math.round(v * max));
    const array = a.array === 'f32' ? new Float32Array(values)
      : a.array === 'i8' ? new Int8Array(a.normalized ? scale(127) : values) : a.array === 'u8' ? new Uint8Array(a.normalized ? scale(255) : values)
        : a.array === 'i16' ? new Int16Array(a.normalized ? scale(32767) : values) : new Uint16Array(a.normalized ? scale(65535) : values);
    geometry.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize, a.normalized));
  }
  geometry.setIndex(bucket.index);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  // A distance tier is only shown once a structure is complete, so it has no build steps.
  geometry.userData['assemblyPieces'] = [];
  geometry.userData['derivedLod'] = true;
  const mesh = new THREE.Mesh(geometry, bucket.material);
  const template = bucket.template;
  mesh.name = template.name;
  mesh.userData = { ...template.userData, derivedLod: true };
  mesh.castShadow = template.castShadow;
  mesh.receiveShadow = template.receiveShadow;
  mesh.renderOrder = template.renderOrder;
  return mesh;
}

/** Derive one distance tier from a full-detail composition. */
export interface TierOptions {
  /** Narrowest solid, in the composition's own units, that still covers a pixel at the tier's range. */
  minFeature: number;
  /** Close window and door voids and drop downward-facing planes (skyline range). */
  fillOpenings?: boolean;
  /** False when the source is an already merged tier, whose planes cannot merge further. */
  merge?: boolean;
}

export function deriveDetailTier(full: THREE.Object3D, options: TierOptions, stats?: DerivedTierStats,
  adopt?: (derived: THREE.Mesh, source: THREE.Mesh) => void): THREE.Group {
  const tier = new THREE.Group(), minFeature = options.minFeature;
  full.updateMatrixWorld(true);
  const inverse = full.matrixWorld.clone().invert();
  const buckets = new Map<string, Bucket>();
  const box = new THREE.Box3(), matrix = new THREE.Matrix4();
  full.traverse(object => {
    if (!object.visible && object !== full) return;
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    if (!geometry.getAttribute('position')) return;
    matrix.multiplyMatrices(inverse, object.matrixWorld);
    const total = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
    if (stats) { stats.sourceTriangles += total; stats.sourceMeshes++; }
    const kept: number[] = [];
    for (const solid of components(geometry).triangles) {
      const [length, width] = extents(geometry, solid, matrix, box);
      // Long members (posts, rails, braces, eaves boards) read as lines well below a pixel's width:
      // they carry a timber frame's or a gallery's identity, so they survive at a narrower width.
      if (width >= minFeature || width >= minFeature * 0.25 && length >= minFeature * 8) kept.push(...solid);
    }
    if (!kept.length) return;
    kept.sort((a, b) => a - b);
    const key = [object.material.uuid, signature(geometry), object.name, String(object.userData['surface'] ?? ''), object.castShadow, object.receiveShadow, object.renderOrder].join('#');
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { material: object.material, template: object, attributes: new Map(), index: [], vertices: 0 }; buckets.set(key, bucket); }
    append(bucket, geometry, kept, matrix);
  });
  for (const bucket of buckets.values()) {
    const mesh = buildBucket(bucket, options);
    if (!bucket.index.length) continue;
    adopt?.(mesh, bucket.template);
    tier.add(mesh);
    if (stats) { stats.triangles += bucket.index.length / 3; stats.meshes++; }
  }
  return tier;
}
