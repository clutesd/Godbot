import '../settlement/SettlementStreetPresentation';
import * as THREE from 'three';
import type { TransportSegment } from '../../sim/transport/types';

export interface HarbourFootprint {
  /** Authoritative bank -> navigation-anchor distance. Kept for diagnostics only. */
  logicalLength: number;
  /** Distance occupied by visible built harbour geometry. */
  visibleLength: number;
  /** True when the offshore navigation anchor lies beyond the visible pier footprint. */
  capped: boolean;
  /** Local-space endpoint supplied to the harbour structure renderer. */
  visibleWater: THREE.Vector3;
}

/**
 * Shipping topology and visible architecture are different things. A port may connect to an
 * offshore navigation node several world units away, but the built pier should stay a compact
 * shoreline object. This clamps only presentation; the authoritative stop/path is untouched.
 */
export function resolveHarbourFootprint(
  bank: THREE.Vector3,
  navigationWater: THREE.Vector3,
  eraRank: number,
): HarbourFootprint {
  const dx = navigationWater.x - bank.x;
  const dz = navigationWater.z - bank.z;
  const logicalLength = Math.hypot(dx, dz);
  if (logicalLength < 0.001) {
    return {
      logicalLength,
      visibleLength: logicalLength,
      capped: false,
      visibleWater: navigationWater.clone(),
    };
  }

  // Roughly one building footprint early, growing modestly with engineering capability.
  // Even advanced ports remain local shoreline objects rather than visualised shipping lanes.
  const maxVisibleLength = eraRank <= 1 ? 1.85 : eraRank <= 3 ? 2.2 : eraRank === 4 ? 2.55 : 2.8;
  const visibleLength = Math.min(logicalLength, maxVisibleLength);
  const t = visibleLength / logicalLength;
  return {
    logicalLength,
    visibleLength,
    capped: visibleLength + 0.001 < logicalLength,
    visibleWater: new THREE.Vector3(
      THREE.MathUtils.lerp(bank.x, navigationWater.x, t),
      navigationWater.y,
      THREE.MathUtils.lerp(bank.z, navigationWater.z, t),
    ),
  };
}

/**
 * World routes should read as paths, not house-width slabs. Bridge decks remain slightly broader
 * than ordinary roads, while rail keeps enough width for two readable rails and sleepers.
 */
export function transportPresentationWidth(segment: TransportSegment): number {
  if (segment.mode === 'rail') return segment.kind === 'bridge' ? 0.58 : 0.46;
  if (segment.kind === 'bridge') return 0.46;
  return 0.34;
}
