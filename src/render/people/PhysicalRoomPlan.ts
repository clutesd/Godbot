/** Convert the published physical elevations to room access, without inventing a second plan. */
import type { FacadePlan } from '../architecture/FacadePlan';
import { sleepAreaPoint, type IndoorSleepingArea } from './IndoorSleepingArea';
export function installPhysicalRoomPlan(area: IndoorSleepingArea, plan: FacadePlan, fit: number, ranges: readonly {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotationY: number;
}[], partitions: readonly {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotationY: number;
}[] = []): void {
    area.roofedRanges = ranges.map(r => ({ ...r, x: r.x * fit, z: r.z * fit, width: r.width * fit, depth: r.depth * fit, inset: plan.wallThickness * fit }));
    const walls: NonNullable<IndoorSleepingArea['physicalWalls']>[number][] = [], passages: NonNullable<IndoorSleepingArea['passages']>[number][] = [];
    for (const face of plan.elevations) {
        const doors = face.openings.filter(o => o.kind === 'door' && o.y - o.h / 2 < .01).sort((a, b) => a.u - b.u);
        let start = -face.length / 2;
        const segment = (from: number, to: number) => {
            if (to - from < .001)
                return;
            const u = (from + to) / 2;
            const at = sleepAreaPoint(area, (face.originX + face.tangentX * u) * fit, (face.originZ + face.tangentZ * u) * fit);
            walls.push({ key: area.key, worldX: at.x, worldZ: at.z, width: (to - from) * fit, depth: plan.wallThickness * fit, rotationY: area.rotationY + Math.atan2(-face.tangentZ, face.tangentX) });
        };
        for (const door of doors) {
            segment(start, door.u - door.w / 2);
            start = door.u + door.w / 2;
            for (const side of [-1, 1])
                passages.push(sleepAreaPoint(area, (face.originX + face.tangentX * door.u + face.normalX * side * (plan.wallThickness + .16 / fit)) * fit, (face.originZ + face.tangentZ * door.u + face.normalZ * side * (plan.wallThickness + .16 / fit)) * fit));
        }
        segment(start, face.length / 2);
    }
    for (const partition of partitions) {
        const at = sleepAreaPoint(area, partition.x * fit, partition.z * fit);
        const wall = { key: area.key, worldX: at.x, worldZ: at.z, width: partition.width * fit, depth: partition.depth * fit, rotationY: area.rotationY + partition.rotationY };
        walls.push(wall);
        for (const x of [-1, 1])
            for (const z of [-1, 1])
                passages.push(sleepAreaPoint(wall, x * (wall.width / 2 + .15), z * (wall.depth / 2 + .15)));
    }
    area.physicalWalls = walls;
    area.passages = passages;
}
