import { groundStructure, MIN_SKIRT_RELIEF, surveyFootprintGround, type HeightSampler, type StructureGrounding } from '../../shared/StructureGrounding';
import { BUILD_STAGE } from '../assets/BuildStages';
import type { ConstructionAssemblyPlan } from './ConstructionAssembly';

/** Survey the whole completed target, including asymmetric wings, rather than the current stage. */
export function constructionGrounding(plan: ConstructionAssemblyPlan, heightAt: HeightSampler,
  x: number, z: number, rotation: number, reserved: StructureGrounding,
  isWater?: (x: number, z: number) => boolean, sampleStep = 0.1,
  terrainGrid?: { originX: number; originZ: number; step: number }): StructureGrounding {
  if (!plan.pieces.length) return reserved;
  const minX = Math.min(...plan.pieces.map(piece => piece.min.x));
  const maxX = Math.max(...plan.pieces.map(piece => piece.max.x));
  const minZ = Math.min(...plan.pieces.map(piece => piece.min.z));
  const maxZ = Math.max(...plan.pieces.map(piece => piece.max.z));
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const survey = surveyFootprintGround(heightAt, x + cx * cos + cz * sin, z - cx * sin + cz * cos,
    maxX - minX, maxZ - minZ, rotation, isWater,
    Math.max(8, Math.ceil(Math.max(maxX - minX, maxZ - minZ) / sampleStep)));
  const target = groundStructure(survey);
  let baseY = Math.max(reserved.baseY, target.baseY);
  if (terrainGrid) {
    // The rendered terrain is triangulated. Include every vertex of cells intersecting the
    // footprint's world bounds: their maximum bounds all intervening triangle interiors,
    // including sharp ridges that a uniformly spaced footprint survey could miss.
    const halfX = Math.abs(cos) * (maxX - minX) / 2 + Math.abs(sin) * (maxZ - minZ) / 2;
    const halfZ = Math.abs(sin) * (maxX - minX) / 2 + Math.abs(cos) * (maxZ - minZ) / 2;
    const worldX = x + cx * cos + cz * sin, worldZ = z - cx * sin + cz * cos;
    const { originX, originZ, step } = terrainGrid;
    for (let i = Math.floor((worldX - halfX - originX) / step); i <= Math.ceil((worldX + halfX - originX) / step); i++) {
      for (let j = Math.floor((worldZ - halfZ - originZ) / step); j <= Math.ceil((worldZ + halfZ - originZ) / step); j++) {
        const height = heightAt(originX + i * step, originZ + j * step);
        if (Number.isFinite(height)) baseY = Math.max(baseY, height);
      }
    }
  }
  return { baseY, relief: Math.max(reserved.relief, baseY - survey.min),
    skirt: (reserved.skirt || baseY - survey.min > MIN_SKIRT_RELIEF) && !survey.waterContact,
    skirtBottomY: Math.min(reserved.skirtBottomY, target.skirtBottomY) };
}

export function constructionFoundationEstablished(plan: ConstructionAssemblyPlan): boolean {
  return plan.pieces.some(piece => piece.stage === BUILD_STAGE.FOUNDATION && piece.endProgress <= (plan.progress ?? 0));
}
