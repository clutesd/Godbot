import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { GeometryBuilder, type AssemblyPiece, type Vec3 } from '../src/render/assets/GeometryBuilder';
import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, StructureForm, StructureMaterial } from '../src/sim/development/types';

const style: CultureStyle = { primary: '#b15d45', secondary: '#35405c', accent: '#d8ad4f', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ka'] };

/** Surface area of every triangle in the geometry. */
function area(geometry: THREE.BufferGeometry): number {
  const p = geometry.getAttribute('position');
  const index = geometry.index!;
  let total = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 2));
    total += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return total;
}

/** Signed enclosed volume (divergence theorem); cut sections cancel exactly, so this is cut-invariant. */
function volume(geometry: THREE.BufferGeometry): number {
  const p = geometry.getAttribute('position');
  const index = geometry.index!;
  let total = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 2));
    total += a.dot(b.clone().cross(c)) / 6;
  }
  return total;
}

function pieceExtent(piece: AssemblyPiece): number {
  return Math.max(piece.max.x - piece.min.x, piece.max.y - piece.min.y, piece.max.z - piece.min.z);
}

function partitions(geometry: THREE.BufferGeometry): boolean {
  const pieces = geometry.userData['assemblyPieces'] as AssemblyPiece[];
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.start !== cursor) return false;
    cursor += piece.count;
  }
  return cursor === geometry.index!.count;
}

describe('construction sections keep the finished surface and stay buildable', () => {
  it('cuts a long box into sections without changing its volume or bounds', () => {
    const builder = new GeometryBuilder();
    builder.setSectioning(1);
    builder.addBox(0, 0, 0, 3, 0.5, 1);
    const geometry = builder.build();
    const pieces = geometry.userData['assemblyPieces'] as AssemblyPiece[];
    expect(pieces.length).toBeGreaterThan(1);
    expect(Math.max(...pieces.map(pieceExtent))).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(volume(geometry)).toBeCloseTo(1.5, 5);
    expect(partitions(geometry)).toBe(true);
  });

  it('leaves a short box exactly as one piece', () => {
    const builder = new GeometryBuilder();
    builder.setSectioning(1);
    builder.addBox(0, 0, 0, 0.2, 0.1, 0.2);
    const geometry = builder.build();
    expect((geometry.userData['assemblyPieces'] as AssemblyPiece[]).length).toBe(1);
  });

  it('keeps the area of a large non-planar face exactly', () => {
    const a: Vec3 = { x: 0, y: 0, z: 0 }, b: Vec3 = { x: 2.4, y: 0.1, z: 0 }, c: Vec3 = { x: 2.2, y: 0.9, z: 1.3 }, d: Vec3 = { x: 0.1, y: 0.7, z: 1.1 };
    const builder = new GeometryBuilder();
    builder.setSectioning(1);
    builder.addQuad(a, b, c, d);
    const geometry = builder.build();
    const expected = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2
      + new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, a)).length() / 2;
    expect(area(geometry)).toBeCloseTo(expected, 5);
    expect(partitions(geometry)).toBe(true);
    expect((geometry.userData['assemblyPieces'] as AssemblyPiece[]).length).toBeGreaterThan(1);
  });

  it('keeps the area of a loft and a fan exactly while cutting them into courses', () => {
    const ring = (y: number, radius: number) => Array.from({ length: 12 }, (_, i) => {
      const t = (i / 12) * Math.PI * 2;
      return { x: Math.cos(t) * radius, y, z: Math.sin(t) * radius };
    });
    const lower = ring(0, 1.2), upper = ring(0.9, 0.5);
    const loft = new GeometryBuilder();
    loft.setSectioning(1);
    loft.addLoft(lower, upper);
    const loftGeometry = loft.build();
    let loftExpected = 0;
    for (let i = 0; i < 12; i++) {
      const n = (i + 1) % 12;
      for (const [p, q, r] of [[lower[i]!, upper[i]!, upper[n]!], [lower[i]!, upper[n]!, lower[n]!]] as const) {
        loftExpected += new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p)).length() / 2;
      }
    }
    expect(area(loftGeometry)).toBeCloseTo(loftExpected, 5);
    expect(partitions(loftGeometry)).toBe(true);

    const fan = new GeometryBuilder();
    fan.setSectioning(1);
    const apex = { x: 0, y: 1.5, z: 0 };
    fan.addFanUp(apex, lower);
    const fanGeometry = fan.build();
    let fanExpected = 0;
    for (let i = 0; i < 12; i++) {
      const a = lower[i]!, b = lower[(i + 1) % 12]!;
      fanExpected += new THREE.Vector3().subVectors(a, apex).cross(new THREE.Vector3().subVectors(b, apex)).length() / 2;
    }
    expect(area(fanGeometry)).toBeCloseTo(fanExpected, 5);
    expect(partitions(fanGeometry)).toBe(true);
  });

  it('is deterministic: the same input gives the same positions and pieces', () => {
    const build = () => {
      const builder = new GeometryBuilder();
      builder.setSectioning(1.1);
      builder.addBox(0.2, 0.3, 0.1, 2.4, 0.2, 0.9, 0.4);
      builder.addBeam({ x: 0, y: 0, z: 0 }, { x: 0.3, y: 1.2, z: 1.9 }, 1.1, 0.1);
      builder.addQuad({ x: 0, y: 0, z: 0 }, { x: 1.9, y: 0.1, z: 0 }, { x: 1.8, y: 0.8, z: 1.0 }, { x: 0.1, y: 0.6, z: 1.0 });
      return builder.build();
    };
    const first = build(), second = build();
    expect(Array.from(first.getAttribute('position').array)).toEqual(Array.from(second.getAttribute('position').array));
    expect(first.userData['assemblyPieces']).toEqual(second.userData['assemblyPieces']);
  });
});

describe('finished buildings have no building-sized construction piece', () => {
  const samples: [StructureForm, StructureMaterial, 'primitive' | 'early' | 'village' | 'industrial'][] = [
    ['dwelling', 'timber', 'primitive'], ['sanctuary', 'earth', 'primitive'], ['sanctuary', 'metal', 'early'],
    ['tower', 'earth', 'industrial'], ['hall', 'timber', 'industrial'], ['workshop', 'masonry', 'village'],
  ];
  it.each(samples)('%s %s %s: every piece stays under 0.6 of the building span', (form, material, era) => {
    const response: DevelopmentResponse = { need: 'housing', form, name: 'section test', level: 2, material, cultureId: 'test', style,
      services: { housing: 2 }, reasons: [], capabilities: [], cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 }, labor: 4 };
    const builder = new AssetBuilder('sections');
    const source = builder.getAsset('building', { seed: `section-${form}`, culture: style, era, variant: `${form}#${BUILD_STAGE.FINISH}`, development: response }).mesh;
    const full = source instanceof THREE.LOD ? source.levels[0]!.object : source;
    const span = Math.max(Number(full.userData['bodyWidth'] ?? 1), Number(full.userData['bodyDepth'] ?? 1));
    let worst = 0;
    full.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      expect(partitions(object.geometry)).toBe(true);
      for (const piece of object.geometry.userData['assemblyPieces'] as AssemblyPiece[]) worst = Math.max(worst, pieceExtent(piece) / span);
    });
    expect(worst).toBeLessThan(0.6);
    builder.dispose();
  });
});
