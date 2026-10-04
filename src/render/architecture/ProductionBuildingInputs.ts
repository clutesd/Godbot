import type { SettlementNeed, StructureForm } from '../../sim/development/types';

/** Inspectable program combinations emitted by responseForNeed, including sponsor variants. */
export const DEVELOPMENT_PROGRAM_INPUTS: readonly { need: SettlementNeed; form: StructureForm }[] = [
  { need: 'housing', form: 'dwelling' },
  { need: 'food', form: 'field' }, { need: 'food', form: 'store' },
  { need: 'trade', form: 'gathering' }, { need: 'trade', form: 'store' },
  { need: 'government', form: 'gathering' }, { need: 'government', form: 'hall' },
  { need: 'security', form: 'sanctuary' }, { need: 'security', form: 'tower' },
  { need: 'security', form: 'gathering' }, { need: 'security', form: 'hall' },
  { need: 'religion', form: 'sanctuary' }, { need: 'religion', form: 'marker' },
  { need: 'knowledge', form: 'sanctuary' }, { need: 'knowledge', form: 'hall' },
  { need: 'healthcare', form: 'sanctuary' }, { need: 'healthcare', form: 'hall' },
  { need: 'manufacturing', form: 'workshop' }, { need: 'manufacturing', form: 'works' },
  { need: 'transport', form: 'store' },
  { need: 'energy', form: 'workshop' }, { need: 'energy', form: 'works' },
  { need: 'water', form: 'store' }, { need: 'water', form: 'works' },
  { need: 'memory', form: 'marker' },
];
