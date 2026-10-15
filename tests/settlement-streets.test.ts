import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { movementStreetGeometry, recordedStreetEdges, type StreetEnd, type WornStreetEdge } from '../src/render/settlement/MovementStreetGeometry';
import { settlementStreetFixture } from '../src/dev/settlementStreetFixture';
import { reserveStructurePlot } from '../src/shared/StructurePlots';
import { settlementMovementFrontage, streetFacing } from '../src/shared/MovementFrontage';
const end = (x: number, z: number): StreetEnd => ({ x, z, halfWidth: .2, stage: 'footpath' });
const bend: WornStreetEdge[] = [{ from: end(-2, 0), to: end(0, 0) }, { from: end(0, 0), to: end(0, 2) }];
const hits = (geometry: THREE.BufferGeometry, x: number, z: number) => {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
  return new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length;
};
describe('production settlement streets', () => {
  it('joins a right-angle lane with shared edge positions and no outside-corner hole', () => {
    const geometry = movementStreetGeometry(bend, () => 0);
    expect(hits(geometry, .1, -.1)).toBeGreaterThan(0);
    expect(hits(geometry, .5, -.5)).toBe(0);
    const p = geometry.getAttribute('position'), endpoint: number[][] = [];
    for (let i = 0; i < p.count; i++) if (Math.abs(Math.abs(p.getX(i)) - .2) < 1e-5 && Math.abs(Math.abs(p.getZ(i)) - .2) < 1e-5) endpoint.push([p.getX(i), p.getZ(i)]);
    expect(endpoint.filter(v => v[0]! > 0 && v[1]! < 0)).toHaveLength(2);
    geometry.dispose();
  });
  it('fills branch junctions, bounds acute joins, and follows terrain at every vertex', () => {
    const edges = [...bend, { from: end(0, 0), to: end(2, 0) }];
    const geometry = movementStreetGeometry(edges, (x, z) => x * .12 + z * .03);
    expect(geometry.userData['streetJunctions']).toBe(1);
    expect(hits(geometry, .08, .08)).toBeGreaterThan(0);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(p.getX(i) * .12 + p.getZ(i) * .03 + .018, 5);
    const acute = movementStreetGeometry([{ from: end(0, 0), to: end(2, 0) }, { from: end(0, 0), to: end(2, .1) }], () => 0);
    acute.computeBoundingBox(); expect(acute.boundingBox!.min.x).toBeGreaterThan(-.4);
    acute.dispose(); geometry.dispose();
  });
  it('shares paving stations at bends and does not promote surface stage', () => {
    const geometry = movementStreetGeometry(bend, () => 0), p = geometry.getAttribute('position'), uv = geometry.getAttribute('roadUV');
    const station: number[] = [];
    for (let i = 0; i < p.count; i++) { expect(uv.getZ(i)).toBe(2); if (Math.hypot(p.getX(i), p.getZ(i)) < 1e-5) station.push(uv.getY(i)); }
    expect(station).toHaveLength(2); expect(station[0]).toBe(station[1]); geometry.dispose();
  });
  it('surveys only recorded dry movement and does not alter land or commission roads', () => {
    const { state } = settlementStreetFixture('street-authority');
    const before = structuredClone(state.world.cells.map(c => c.modifications));
    const edges = recordedStreetEdges(state.world); expect(edges.length).toBeGreaterThan(0);
    expect(edges.every(e => e.from.stage === 'footpath' && e.to.stage === 'footpath')).toBe(true);
    expect(state.world.cells.map(c => c.modifications)).toEqual(before);
    expect(Object.values(state.transportation.projects)).toEqual([]);
    for (const cell of state.weather.cells) cell.floodDepth = .3;
    expect(recordedStreetEdges(state.world)).toEqual([]);
  });
  it('connects an equal-wear lane and branch without adding a grid or touching unmarked cells', () => {
    const { state } = settlementStreetFixture('street-connectivity');
    const edges = recordedStreetEdges(state.world), seen = new Set<string>();
    const id = (p: {x:number;z:number}) => `${p.x}:${p.z}`;
    const queue = [id(edges[0]!.from)]; seen.add(queue[0]!);
    for (let i = 0; i < queue.length; i++) for (const edge of edges) {
      const a = id(edge.from), b = id(edge.to), next = queue[i] === a ? b : queue[i] === b ? a : undefined;
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
    expect(seen.size).toBe(10); expect(edges.length).toBe(9);
    const survey = settlementMovementFrontage(state.world, { ...state.settlements[0]!, buildings: 96 });
    expect(new Set(survey.map(e => [id(e.from),id(e.to)].sort().join('|')))).toEqual(new Set(edges.map(e => [id(e.from),id(e.to)].sort().join('|'))));
  });
  it('reserves deterministic persistent frontages aimed at the actual lane', () => {
    const a = settlementStreetFixture('street-frontages'), b = settlementStreetFixture('street-frontages');
    for (let i = 0; i < 10; i++) {
      const plot = reserveStructurePlot(a.state, a.settlement, 'residential');
      const replay = reserveStructurePlot(b.state, b.settlement, 'residential');
      expect(plot).toEqual(replay); expect(plot?.accessPoint).toBeDefined();
      if (plot?.accessPoint) {
        const dx = plot.accessPoint.x - plot.worldX, dz = plot.accessPoint.z - plot.worldZ;
        expect(Math.sin(plot.rotationY!) * dx + Math.cos(plot.rotationY!) * dz).toBeCloseTo(Math.hypot(dx, dz));
      }
    }
  });
  it('rejects inaccessible frontages and keeps quiet founding ground free of invented circulation', () => {
    const { state, settlement } = settlementStreetFixture('street-access');
    const edges = settlementMovementFrontage(state.world, settlement);
    const point = { x: edges[0]!.from.x, z: edges[0]!.from.z + 2 };
    expect(streetFacing(edges, point, .5, () => false)).toBeUndefined();
    for (const cell of state.world.cells) cell.modifications = undefined;
    expect(recordedStreetEdges(state.world)).toEqual([]);
    const plot = reserveStructurePlot(state, settlement, 'residential'); expect(plot?.rotationY).toBeUndefined();
  });
});
