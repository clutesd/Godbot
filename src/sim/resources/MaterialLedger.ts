import type { Settlement } from '../types';
import { addMaterial, materialEconomy, storageRoom, takeMaterial } from './Inventory';

/**
 * The one shape every recipe executor draws inputs from and pushes outputs to. The settlement
 * store and a processing facility's yards both implement it, so transformation rules (yields,
 * failure, research, quality) exist exactly once and only the *place* the material sits changes.
 */
export interface MaterialLedger {
  amount(id: string): number;
  /** Removes up to `requested` and returns what was actually removed. */
  take(id: string, requested: number): number;
  /** Adds up to `requested` subject to space and returns what was actually accepted. */
  add(id: string, requested: number, quality?: number): number;
  quality(id: string): number;
  /** Free space available for new output. */
  room(): number;
}

export function settlementLedger(s: Settlement): MaterialLedger {
  return {
    amount: id => Math.max(0, s.localMaterials[id] ?? 0),
    take: (id, requested) => takeMaterial(s, id, requested),
    add: (id, requested, quality) => addMaterial(s, id, requested, quality),
    quality: id => materialEconomy(s).quality[id] ?? 0.5,
    room: () => storageRoom(s),
  };
}
