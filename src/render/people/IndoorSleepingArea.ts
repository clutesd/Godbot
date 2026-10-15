import type { Vec2 } from '../../sim/types';
import type { RestSpotPresentation, RestSupportFootprint } from './RestPresentation';

export interface IndoorSleepingArea extends RestSupportFootprint {
  floorY: number;
  doorWidth: number;
  plotWidth: number;
  plotDepth: number;
  roofedRanges?: readonly {x:number;z:number;width:number;depth:number;rotationY:number;inset?:number}[];
  physicalWalls?: readonly RestSupportFootprint[];
  passages?: readonly Vec2[];
}

export function sleepAreaPoint(area: RestSupportFootprint, x: number, z: number): Vec2 {
  const c = Math.cos(area.rotationY), s = Math.sin(area.rotationY);
  return { x: area.worldX + x * c + z * s, z: area.worldZ - x * s + z * c };
}

export function sleepAreaLocal(area: RestSupportFootprint, point: Vec2): Vec2 {
  const c = Math.cos(area.rotationY), s = Math.sin(area.rotationY);
  return { x: (point.x - area.worldX) * c - (point.z - area.worldZ) * s,
    z: (point.x - area.worldX) * s + (point.z - area.worldZ) * c };
}

/** Two rows of mats flank a clear central aisle. Dimensions are in rendered world units. */
export function indoorSleepingSpots(area: IndoorSleepingArea): RestSpotPresentation[] {
  if (area.width < .4 || area.depth < .6 || area.doorWidth < .18) return [];
  const spots:RestSpotPresentation[]=[];
  const add=(x:number,z:number,facing:number,key:string)=>{
    const destination=sleepAreaPoint(area,x,z);
    if(area.physicalWalls?.some(wall=>{const at=sleepAreaLocal(wall,destination),angle=facing-wall.rotationY;const ex=Math.abs(Math.cos(angle))*.11+Math.abs(Math.sin(angle))*.2,ez=Math.abs(Math.sin(angle))*.11+Math.abs(Math.cos(angle))*.2;return Math.abs(at.x)<wall.width/2+ex+.01&&Math.abs(at.z)<wall.depth/2+ez+.01;}))return;
    spots.push({key,supportKey:area.key,destination,facing,posture:'sleep',support:'bed',indoor:area});
  };
  if(area.roofedRanges){
    area.roofedRanges.forEach((range,index)=>{
      const inset=range.inset??.025;
      const width=range.width-inset*2,depth=range.depth-inset*2;
      if(width<.4||depth<.6)return;
      const rows=Math.min(4,Math.floor((depth-.14+1e-9)/.46)),sides=width<.72?[0]:[-1,1];
      for(let row=0;row<(sides.length===1?Math.min(1,rows):rows);row++)for(const side of sides){
        const x=side*(width/2-.16),z=-depth/2+.3+row*.46,c=Math.cos(range.rotationY),sn=Math.sin(range.rotationY);
        add(range.x+x*c+z*sn,range.z-x*sn+z*c,area.rotationY+range.rotationY,`${area.key}:bed:${index}:${row}:${side}`);
      }
    });
    return spots;
  }
  const rows=Math.min(4,Math.floor((area.depth-.14+1e-9)/.46)),sides=area.width<.72?[0]:[-1,1];
  for(let row=0;row<(sides.length===1?Math.min(1,rows):rows);row++)for(const side of sides)add(side*(area.width/2-.16),-area.depth/2+.3+row*.46,area.rotationY,`${area.key}:bed:${row}:${side}`);
  return spots;
}

export function sleepAreaFloor(area: IndoorSleepingArea, point: Vec2, terrain: number): number {
  const local = sleepAreaLocal(area, point);
  if (Math.abs(local.x) > area.width / 2 + 0.08 || local.z < -area.depth / 2 - 0.08) return terrain;
  if(area.roofedRanges && !area.roofedRanges.some(r=>{const c=Math.cos(r.rotationY),s=Math.sin(r.rotationY),x=local.x-r.x,z=local.z-r.z;return Math.abs(x*c-z*s)<=r.width/2 && Math.abs(x*s+z*c)<=r.depth/2;}))return terrain;
  const ramp = Math.max(0, Math.min(1, (area.depth / 2 + 0.25 - local.z) / 0.25));
  return terrain + (Math.max(terrain, area.floorY) - terrain) * ramp;
}
