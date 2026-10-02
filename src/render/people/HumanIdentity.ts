import type { Culture } from '../../sim/types';
import type { ChestPiece, CrestStyle, DrapeForm, ShoulderPiece, WaistPiece } from './HumanAppearanceProfile';

/** Authored related skulls. Values describe planes, not a uniform scale of one egg. */
export const GODBOX_HEADS = [
  { name: 'keel', jaw: 0.84, cranium: 1.16, cheek: 1.06, brow: 0.004, temple: -0.003, recess: 0.004, neck: 0.90 },
  { name: 'bastion', jaw: 1.23, cranium: 0.94, cheek: 1.10, brow: 0.008, temple: 0.002, recess: 0.006, neck: 1.13 },
  { name: 'lantern', jaw: 0.92, cranium: 1.10, cheek: 1.20, brow: 0.002, temple: -0.004, recess: 0.003, neck: 0.94 },
  { name: 'chisel', jaw: 1.10, cranium: 1.04, cheek: 0.94, brow: 0.006, temple: -0.005, recess: 0.007, neck: 1.04 },
  { name: 'arch', jaw: 0.95, cranium: 0.98, cheek: 1.04, brow: 0.009, temple: 0.003, recess: 0.005, neck: 0.96 },
  { name: 'cairn', jaw: 1.15, cranium: 1.07, cheek: 1.16, brow: 0.003, temple: 0.004, recess: 0.004, neck: 1.10 },
] as const;
export type GodboxHead = typeof GODBOX_HEADS[number];

export interface HumanCultureGrammar {
  crest: CrestStyle; alternateCrest: CrestStyle; collar: ChestPiece;
  shoulder: ShoulderPiece; waist: WaistPiece; drape: DrapeForm;
  symmetry: number; metal: number; pattern: string;
}
const GRAMMARS: readonly HumanCultureGrammar[] = [
  { crest: 'swept', alternateCrest: 'ridged', collar: 'yoke', shoulder: 'side-panels', waist: 'hip-plate', drape: 'split-fall', symmetry: 0.72, metal: 0.7, pattern: 'terrace' },
  { crest: 'coiled', alternateCrest: 'swept', collar: 'collar', shoulder: 'back-fall', waist: 'ring', drape: 'front-fall', symmetry: 0.18, metal: 0.5, pattern: 'wave' },
  { crest: 'fanned', alternateCrest: 'coiled', collar: 'gorget', shoulder: 'back-fall', waist: 'ceremonial-belt', drape: 'long-fall', symmetry: 0.36, metal: 0.8, pattern: 'crossweave' },
  { crest: 'plated', alternateCrest: 'fanned', collar: 'yoke', shoulder: 'guards', waist: 'hip-plate', drape: 'front-fall', symmetry: 0.86, metal: 1, pattern: 'chevron' },
];

/** Same source grammar as the settlement architecture; no culture-name special cases. */
export function humanCultureGrammar(culture?: Culture): HumanCultureGrammar {
  const style = culture?.style;
  const index = style?.symbol === 'mountain-knot' || style?.pattern === 'terrace' ? 0
    : style?.symbol === 'river-eye' || style?.pattern === 'wave' ? 1
      : style?.symbol === 'woven-moon' || style?.symbol === 'seed-spiral' || style?.pattern === 'crossweave' ? 2 : 3;
  return GRAMMARS[index]!;
}
