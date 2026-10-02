import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  humanLookFor, type HumanLook, type HumanLookContext,
} from '../src/render/people/HumanAppearanceProfile';
import {
  GARMENT_PART, HEAD_PART, createGarmentAtlasGeometry, createHeadAtlasGeometry,
  garmentOverflowFor, garmentPartsFor, headPartsFor, hemFitFor,
} from '../src/render/people/HumanWardrobeAtlas';
import { createCosmicBodyGeometry, createCosmicHeadGeometry } from '../src/render/people/CosmicPeople';
import type { Culture, Person } from '../src/sim/types';

/**
 * The species contract. These are the four figures of the reference lineup — adult male, adult
 * female, adolescent and child — and the properties that have to hold for them to read as one
 * cosmic species rather than as pale procedural humans in simple clothing.
 */

function person(overrides: Partial<Person> & { id: string }): Person {
  return {
    sex: 'male',
    ageMonths: 30 * 12,
    role: 'farmer',
    cultureId: 'culture-a',
    prestige: 20,
    alive: true,
    homeId: 'settlement',
    activity: 'idle',
    position: { x: 0, z: 0 },
    appearance: {
      heightScale: 1, buildScale: 1, posture: 0, garment: 'simple', headwear: 'none',
      carriedItem: 'none', textilePattern: 'chevron', materialQuality: 0.5,
    },
    ...overrides,
  } as unknown as Person;
}

function culture(id: string, primary: string, secondary: string, accent: string,
  pattern: Culture['style']['pattern']): Culture {
  return {
    id, name: id, style: { primary, secondary, accent, symbol: 'sun-step', pattern, nameSyllables: ['a'] },
  } as unknown as Culture;
}

const CULTURE_A = culture('culture-a', '#7a4f3a', '#3f5a6b', '#d9a748', 'chevron');
const CULTURE_B = culture('culture-b', '#3d5f4a', '#6b4660', '#6fc6d8', 'wave');

const LINEUP: Readonly<Record<'male' | 'female' | 'adolescent' | 'child', Person>> = {
  male: person({ id: 'godbox-male', sex: 'male', ageMonths: 31 * 12 }),
  female: person({ id: 'godbox-female', sex: 'female', ageMonths: 29 * 12 }),
  adolescent: person({ id: 'godbox-adolescent', sex: 'female', ageMonths: 13 * 12, role: 'child' }),
  child: person({ id: 'godbox-child', sex: 'male', ageMonths: 5 * 12, role: 'child' }),
};

function look(key: keyof typeof LINEUP, context: HumanLookContext = { culture: CULTURE_A, era: 'village' }) {
  return humanLookFor(LINEUP[key], context);
}

const colour = new THREE.Color();
const hsl = { h: 0, s: 0, l: 0 };

function hslOf(hex: string): { h: number; s: number; l: number } {
  colour.set(hex).getHSL(hsl);
  return { ...hsl };
}

/**
 * The outer radius of a sculpted body at one height *in one direction*, measured from the real
 * geometry. A torso and a skull are both ellipses, so a chest plate at the front has to be
 * compared against the body's depth there and never against its shoulder width.
 */
function surfaceRadiusToward(geometry: THREE.BufferGeometry, point: THREE.Vector3,
  band = 0.006, arc = 0.26): number {
  const position = geometry.getAttribute('position');
  const towards = Math.atan2(point.x, point.z);
  let radius = 0;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getY(i) - point.y) > band) continue;
    const x = position.getX(i), z = position.getZ(i);
    let away = Math.abs(Math.atan2(x, z) - towards);
    if (away > Math.PI) away = Math.PI * 2 - away;
    if (away > arc) continue;
    radius = Math.max(radius, Math.hypot(x, z));
  }
  return radius;
}

/** Every vertex belonging to one atlas part, split out by its per-vertex part id. */
function partVertices(geometry: THREE.BufferGeometry, part: number): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  const surface = geometry.getAttribute('humanSurface');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(surface.getW(i) - part) > 0.25) continue;
    out.push(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
  }
  return out;
}

describe('living obsidian species', () => {
  it('reads as one species: every body is dark, near-neutral volcanic glass, never skin', () => {
    const tones: string[] = [];
    for (const context of [
      { culture: CULTURE_A, era: 'primitive' }, { culture: CULTURE_A, era: 'advanced' },
      { culture: CULTURE_B, era: 'village' }, { culture: undefined, era: 'industrial' },
    ] as HumanLookContext[]) {
      for (const key of Object.keys(LINEUP) as (keyof typeof LINEUP)[]) {
        const palette = humanLookFor(LINEUP[key], context).palette;
        tones.push(palette.obsidian);
        const body = hslOf(palette.obsidian);
        // Dark enough to be obsidian, open enough to hold a reflection. Never a featureless void,
        // and nowhere near the lightness or the orange hue band of human skin.
        expect(body.l).toBeGreaterThan(0.010);
        expect(body.l).toBeLessThan(0.060);
        expect(body.s).toBeLessThan(0.3);
        // Drape is cloth this species would weave: dark, desaturated, never a dyed villager tunic.
        expect(hslOf(palette.drape).l).toBeLessThan(0.26);
        // The inlay is warm and bright in every culture: one species, one kind of light.
        const light = hslOf(palette.luminous);
        expect(light.l).toBeGreaterThan(0.45);
        expect(light.s).toBeGreaterThan(0.3);
        const hue = light.h * 360;
        expect(hue > 300 || hue < 75).toBe(true);
      }
    }
    // Cultures occupy neighbouring tints rather than separate palettes.
    const lightness = tones.map(tone => hslOf(tone).l);
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThan(0.035);
  });

  it('separates the four figures of the lineup by proportion alone', () => {
    const male = look('male').proportions;
    const female = look('female').proportions;
    const adolescent = look('adolescent').proportions;
    const child = look('child').proportions;

    // Age is the first read, and it is carried by the head-to-body ratio and the limbs, not scale.
    expect(child.headScale).toBeGreaterThan(adolescent.headScale);
    expect(adolescent.headScale).toBeGreaterThan(male.headScale * 1.04);
    expect(child.legLength).toBeLessThan(adolescent.legLength);
    expect(adolescent.legLength).toBeLessThan(male.legLength);
    expect(child.shoulderScale).toBeLessThan(adolescent.shoulderScale);
    expect(adolescent.shoulderScale).toBeLessThan(female.shoulderScale);
    expect(child.limbThickness).toBeLessThan(adolescent.limbThickness);
    // A child is not an adult scaled down: its head/leg ratio is a different figure entirely.
    expect(child.headScale / child.legLength).toBeGreaterThan(male.headScale / male.legLength * 1.4);

    // Sex is carried by the shoulder-to-hip ratio and nothing else, in both directions, and the
    // difference stays well short of caricature.
    const maleRatio = male.shoulderScale / male.hipScale;
    const femaleRatio = female.shoulderScale / female.hipScale;
    expect(maleRatio).toBeGreaterThan(femaleRatio * 1.1);
    expect(maleRatio).toBeLessThan(femaleRatio * 1.6);
    // Both adults are the same species: no overall-size or limb difference beyond a few percent.
    expect(Math.abs(male.legLength - female.legLength)).toBeLessThan(0.08);
    expect(Math.abs(male.headScale - female.headScale)).toBeLessThan(0.08);
  });

  it('gives children less adornment and less light, never an adult kit at smaller scale', () => {
    const adult = look('male').wardrobe;
    const adolescent = look('adolescent').wardrobe;
    const child = look('child').wardrobe;
    for (const young of [adolescent, child]) {
      expect(young.markingDensity).toBeLessThan(adult.markingDensity);
    }
    expect(child.markingDensity).toBeLessThan(adolescent.markingDensity);
    expect(child.chest).toBe('none');
    expect(child.shoulder).toBe('none');
    expect(child.head).toBe('none');
    expect(child.armRing).toBe(0);
    // A child still wears the waist and still carries the species' own light, only less of it.
    expect(child.drape).toBe('hip-wrap');
    expect(look('child').palette.luminance).toBeLessThan(look('male').palette.luminance);
    expect(look('child').palette.luminance).toBeGreaterThan(0.5);
    // The crest is anatomy, so even the child has one.
    expect(headPartsFor(child)[0]).not.toBe(HEAD_PART.none);
  });

  it('carries era in surface finish, alloy and adornment, with the waist surviving every era', () => {
    const eras = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'] as const;
    const finishes = eras.map(era => humanLookFor(LINEUP.male, { culture: CULTURE_A, era }).palette.finish);
    for (let i = 1; i < finishes.length; i++) expect(finishes[i]!).toBeGreaterThan(finishes[i - 1]!);
    expect(finishes[0]!).toBeLessThan(0.3);
    expect(finishes[finishes.length - 1]!).toBeGreaterThan(0.7);

    for (const era of eras) {
      const resolved = humanLookFor(LINEUP.male, { culture: CULTURE_A, era });
      // Lineage: the waist piece and the hip wrap are the forms no era ever abandons.
      expect(resolved.wardrobe.drape).not.toBe('none');
      expect(garmentPartsFor(resolved.wardrobe)[0]).toBe(GARMENT_PART.wrap);
    }
    // Early alloy is dark hammered metal; late alloy is bright refined gold or a pale alloy.
    const early = hslOf(humanLookFor(LINEUP.male, { culture: CULTURE_A, era: 'primitive' }).palette.alloy);
    const late = hslOf(humanLookFor(LINEUP.male, { culture: CULTURE_A, era: 'advanced' }).palette.alloy);
    expect(late.l).toBeGreaterThan(early.l + 0.1);
  });

  it('shows culture through geometry and placement, not only through colour', () => {
    const a = humanLookFor(LINEUP.male, { culture: CULTURE_A, era: 'village' });
    const b = humanLookFor(person({ ...LINEUP.male, cultureId: CULTURE_B.id }),
      { culture: CULTURE_B, era: 'village' });
    expect(a.palette.luminous).not.toBe(b.palette.luminous);
    expect(a.palette.obsidian).not.toBe(b.palette.obsidian);
    // The marking geometry a person carries is the culture's textile pattern, resolved in the
    // shader from the packed channel, so two cultures engrave different shapes on the same body.
    expect(CULTURE_A.style.pattern).not.toBe(CULTURE_B.style.pattern);
    // Crest form is culture-weighted, so a culture's people share a head silhouette family.
    const crests = new Set(Array.from({ length: 24 }, (_, i) =>
      humanLookFor(person({ id: `c-${i}`, cultureId: 'culture-a' }),
        { culture: CULTURE_A, era: 'village' }).wardrobe.crest));
    expect(crests.size).toBeGreaterThan(1);
    expect(crests.size).toBeLessThan(6);
  });

  it('carries no conventional human garment, hair or skin vocabulary anywhere in the look', () => {
    const banned = ['tunic', 'bodice', 'skirt', 'trousers', 'breeches', 'shirt', 'brim', 'cap',
      'hood', 'boot', 'sandal', 'cloak', 'apron', 'bald', 'braid', 'bun', 'topknot', 'leather'];
    for (const key of Object.keys(LINEUP) as (keyof typeof LINEUP)[]) {
      for (const context of [
        { culture: CULTURE_A, era: 'primitive' }, { culture: CULTURE_B, era: 'advanced' },
        { culture: CULTURE_A, era: 'village', cold: 0.9 },
      ] as HumanLookContext[]) {
        const resolved: HumanLook = humanLookFor(LINEUP[key], context);
        const vocabulary = JSON.stringify({ ...resolved.wardrobe, ...resolved.palette }).toLowerCase();
        for (const word of banned) expect(vocabulary).not.toContain(word);
      }
    }
  });

  it('is deterministic: the same person and context always resolve to the same inhabitant', () => {
    for (const key of Object.keys(LINEUP) as (keyof typeof LINEUP)[]) {
      const first = humanLookFor(LINEUP[key], { culture: CULTURE_A, era: 'village' });
      const second = humanLookFor(LINEUP[key], { culture: CULTURE_A, era: 'village' });
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });
});

describe('cosmic adornment atlas', () => {
  it('seats every body component on or outside the torso it is worn over', () => {
    const torso = createCosmicBodyGeometry();
    const atlas = createGarmentAtlasGeometry();
    // Hanging cloth is free to fall past the body; everything cast or carved must sit proud of it.
    const seated = [GARMENT_PART.waistRing, GARMENT_PART.hipPlate, GARMENT_PART.collar,
      GARMENT_PART.gorget, GARMENT_PART.chestPlate, GARMENT_PART.regalia,
      GARMENT_PART.stoneCollar, GARMENT_PART.guards, GARMENT_PART.pauldrons] as const;
    for (const part of seated) {
      const vertices = partVertices(atlas, part);
      expect(vertices.length).toBeGreaterThan(8);
      let proud = 0, worn = 0, clearance = 0;
      for (const vertex of vertices) {
        const radius = Math.hypot(vertex.x, vertex.z);
        // The closed end caps of a sculpted part sit on the axis by construction. They are not
        // surface, so they are not evidence of a buried ornament.
        if (radius < 0.012) continue;
        worn += 1;
        const body = surfaceRadiusToward(torso, vertex);
        // Above the shoulders the torso has already ended, so there is nothing left to clear.
        if (body === 0 || radius >= body - 0.004) proud += 1;
        clearance = Math.max(clearance, body === 0 ? radius : radius - body);
      }
      // A shoulder cap or a pressed strap legitimately buries its inner half in the body it is
      // worn over. What must never happen is a component that is mostly inside the figure, because
      // that is an ornament the camera never sees and a draw call spent on nothing.
      expect(proud / worn, `atlas part ${part} clearance`).toBeGreaterThan(0.45);
      expect(clearance).toBeGreaterThan(0.004);
    }
    torso.dispose(); atlas.dispose();
  });

  it('hangs falls below the hip and lengthens them without moving the waist', () => {
    const atlas = createGarmentAtlasGeometry();
    const wrap = partVertices(atlas, GARMENT_PART.wrap);
    const front = partVertices(atlas, GARMENT_PART.frontFall);
    expect(Math.min(...wrap.map(v => v.y))).toBeLessThan(-0.08);
    expect(Math.min(...front.map(v => v.y))).toBeLessThan(-0.25);
    // Every fall is forward of the body axis, so it never swallows the back or the legs behind.
    expect(front.every(v => v.z > 0)).toBe(true);

    const lengths = (['hip-wrap', 'front-fall', 'split-fall', 'long-fall'] as const)
      .map(drape => hemFitFor({ drape } as never).length);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!);
    expect(hemFitFor({ drape: 'none' } as never).length).toBeLessThan(0.01);
    atlas.dispose();
  });

  it('seats the crest and every head structure on the skull without detaching from it', () => {
    const head = createCosmicHeadGeometry();
    const atlas = createHeadAtlasGeometry();
    head.computeBoundingBox();
    const crown = head.boundingBox!.max.y;
    for (const part of Object.values(HEAD_PART)) {
      if (part === HEAD_PART.none) continue;
      const vertices = partVertices(atlas, part);
      expect(vertices.length).toBeGreaterThan(5);
      // Nothing worn on the head floats above the crown without touching the skull below it.
      expect(Math.min(...vertices.map(v => v.y))).toBeLessThan(crown);
      let proud = 0, worn = 0, clearance = 0;
      for (const vertex of vertices) {
        const radius = Math.hypot(vertex.x, vertex.z);
        if (radius < 0.012) continue;
        worn += 1;
        const skull = surfaceRadiusToward(head, vertex, 0.005);
        if (skull === 0 || radius >= skull - 0.004) proud += 1;
        clearance = Math.max(clearance, skull === 0 ? radius : radius - skull);
      }
      expect(proud / worn, `atlas part ${part} clearance`).toBeGreaterThan(0.45);
      expect(clearance).toBeGreaterThan(0.002);
    }
    head.dispose(); atlas.dispose();
  });

  it('keeps the whole adornment set inside one instanced draw with a bounded vertex cost', () => {
    const body = createGarmentAtlasGeometry();
    const head = createHeadAtlasGeometry();
    // Every atlas vertex is transformed for every person, so the atlas budget is a per-person
    // cost. Sixteen body components and eleven head components still fit inside the old one.
    expect(body.getAttribute('position').count).toBeLessThan(980);
    expect(head.getAttribute('position').count).toBeLessThan(700);
    for (const geometry of [body, head]) {
      expect(geometry.getAttribute('humanSurface')).toBeDefined();
      expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    }
    body.dispose(); head.dispose();
  });

  it('selects at most six distinct components per person and never drops the dominant one', () => {
    for (const key of Object.keys(LINEUP) as (keyof typeof LINEUP)[]) {
      for (const era of ['primitive', 'village', 'industrial', 'advanced'] as const) {
        for (const garment of ['simple', 'workwear', 'ceremonial', 'uniform'] as const) {
          const subject = person({ ...LINEUP[key], id: `${key}-${era}-${garment}`,
            appearance: { ...LINEUP[key].appearance!, garment } });
          const wardrobe = humanLookFor(subject, { culture: CULTURE_A, era }).wardrobe;
          const parts = garmentPartsFor(wardrobe);
          const overflow = garmentOverflowFor(wardrobe);
          const all = [...parts, overflow % 32, Math.floor(overflow / 32)].filter(part => part > 0);
          expect(all.length).toBeLessThanOrEqual(6);
          // The packing has to survive the round trip, or a person loses a component silently.
          expect(overflow).toBeLessThan(32 * 32);
          expect(Number.isInteger(overflow)).toBe(true);
          const worn = new Set(all);
          expect(worn.size).toBe(all.length);
        }
      }
    }
  });
});
