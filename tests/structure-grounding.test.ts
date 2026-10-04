import { describe, expect, it } from 'vitest';
import {
  GROUNDING_SINK,
  groundStructure,
  isInsideReservedGround,
  surveyFootprintGround,
} from '../src/shared/StructureGrounding';

const flat = () => 2;
// Rises 0.5 per unit of world X: a plane tilted across the plot.
const ramp = (x: number) => 0.5 * x;

describe('structure grounding: footprint-wide, not centre-sampled', () => {
  it('flat ground grounds the structure at its height with no skirt', () => {
    const grounding = groundStructure(surveyFootprintGround(flat, 0, 0, 4, 4));
    expect(grounding.baseY).toBeCloseTo(2, 6);
    expect(grounding.relief).toBeCloseTo(0, 6);
    expect(grounding.skirt).toBe(false);
  });

  it('on a slope the base sits on the uphill corner, so no corner is buried', () => {
    // A centre-only sample would read 0 here and bury the uphill corner by 1 unit.
    const grounding = groundStructure(surveyFootprintGround((x) => ramp(x), 0, 0, 4, 4));
    expect(grounding.baseY).toBeCloseTo(1, 6);
    expect(grounding.relief).toBeCloseTo(2, 6);
    expect(grounding.skirt).toBe(true);
  });

  it('the base never falls below any ground sample under the footprint', () => {
    const bumpy = (x: number, z: number) => Math.sin(x * 1.7) * 0.8 + Math.cos(z * 2.3) * 0.6 + x * 0.2;
    for (let i = 0; i < 40; i += 1) {
      const cx = Math.sin(i * 12.9898) * 20, cz = Math.cos(i * 78.233) * 20;
      const rotation = i * 0.37;
      const grounding = groundStructure(surveyFootprintGround(bumpy, cx, cz, 3 + (i % 5), 2 + (i % 3), rotation));
      for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) {
        const w = 1.5 + (i % 5) / 2, d = 1 + (i % 3) / 2;
        const x = cx + u * w * Math.cos(rotation) + v * d * Math.sin(rotation);
        const z = cz - u * w * Math.sin(rotation) + v * d * Math.cos(rotation);
        expect(bumpy(x, z)).toBeLessThanOrEqual(grounding.baseY + 1e-9);
      }
    }
  });

  it('respects the renderer rotation convention: a quarter turn swaps the slope axes', () => {
    // Plot is 2 wide (local X) and 4 deep (local Z). Unrotated, the ramp spans the 2 units of width.
    const unrotated = surveyFootprintGround((x) => ramp(x), 0, 0, 2, 4, 0);
    expect(unrotated.max - unrotated.min).toBeCloseTo(1, 6);
    // Rotated a quarter turn, local Z lies along world X, so the ramp now spans the full 4 units.
    const quarterTurn = surveyFootprintGround((x) => ramp(x), 0, 0, 2, 4, Math.PI / 2);
    expect(quarterTurn.max - quarterTurn.min).toBeCloseTo(2, 6);
  });

  it('a hilltop plot is grounded on its crown and the skirt reaches the lowest ground', () => {
    const mound = (x: number, z: number) => Math.max(0, 2 - Math.hypot(x, z));
    const grounding = groundStructure(surveyFootprintGround(mound, 0, 0, 4, 4));
    expect(grounding.baseY).toBeCloseTo(mound(0, 0), 6);
    expect(grounding.skirtBottomY).toBeLessThan(mound(2, 2));
    expect(grounding.skirtBottomY).toBeCloseTo(0 - GROUNDING_SINK, 6);
  });

  it('a small relief is treated as level, so no skirt clutters near-flat ground', () => {
    const gentle = (x: number) => 0.005 * x;
    expect(groundStructure(surveyFootprintGround(gentle, 0, 0, 4, 4)).skirt).toBe(false);
  });
});

describe('construction-stage grounding uses the same plot authority as the finished structure', () => {
  it('an early worksite sized smaller than the plot is grounded no lower than the plot base', () => {
    const plotBase = groundStructure(surveyFootprintGround((x) => ramp(x), 0, 0, 4, 4)).baseY;
    // An early frame occupies only the middle of the plot. Its own centre-line ground is lower.
    const stage = groundStructure(surveyFootprintGround((x) => ramp(x), 0, 0, 2.4, 2.4));
    expect(stage.baseY).toBeLessThanOrEqual(plotBase + 1e-9);
    expect(stage.baseY).toBeGreaterThanOrEqual(ramp(0));
  });

  it('the same plot yields the same grounding however many stages draw against it', () => {
    const plot = surveyFootprintGround((x) => ramp(x), 3, -2, 4, 4, 0.8);
    expect(groundStructure(plot)).toEqual(groundStructure(plot));
  });
});

describe('waterfront structures: water contact keeps the land side grounded and the sea side open', () => {
  it('water under the plot suppresses the skirt while the base stays on the highest land', () => {
    const shore = (x: number) => 0.5 * x;
    const water = (x: number) => x < 0;
    const grounding = groundStructure(surveyFootprintGround(shore, 0, 0, 4, 4, 0, water));
    expect(grounding.baseY).toBeCloseTo(1, 6);
    expect(grounding.skirt).toBe(false);
  });

  it('a dock standing on the water edge is not sealed down to the sea bed', () => {
    const seabed = (x: number) => -1 + Math.max(0, x) * 0.2;
    const isWater = (x: number) => x < 0.5;
    const grounding = groundStructure(surveyFootprintGround(seabed, 0, 0, 2, 4, 0, isWater));
    expect(grounding.skirt).toBe(false);
  });

  it('inland structures with the same slope still receive a skirt', () => {
    const grounding = groundStructure(surveyFootprintGround((x) => 2 + 0.5 * x, 0, 0, 4, 4, 0, () => false));
    expect(grounding.skirt).toBe(true);
  });
});

describe('footprint clearance: decor stays outside reserved structure and worksite ground', () => {
  const zones = [{ x: 10, z: 10, radius: 3 }];

  it('a point inside a reserved zone is rejected', () => {
    expect(isInsideReservedGround(10.5, 10.5, 0.25, zones)).toBe(true);
  });

  it('a point clear of the zone, allowing for its own radius, is accepted', () => {
    expect(isInsideReservedGround(14, 10, 0.25, zones)).toBe(false);
  });

  it('the clearance radius of the object is counted, so a near-edge prop is still excluded', () => {
    // 2.9 is outside the zone radius, but a 0.25 prop reaches into it.
    expect(isInsideReservedGround(12.9, 10, 0.25, zones)).toBe(true);
    expect(isInsideReservedGround(13.4, 10, 0.25, zones)).toBe(false);
  });

  it('an empty reservation leaves every point clear', () => {
    expect(isInsideReservedGround(0, 0, 1, [])).toBe(false);
  });
});
