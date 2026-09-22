import * as THREE from 'three';

export type MineralVisualKind = 'stone' | 'clay' | 'coal' | 'copper' | 'tin' | 'iron' | 'uranium' | 'generic';

export interface MineralVisualProfile {
  readonly kind: MineralVisualKind;
  readonly baseColour: string;
  readonly accentColour: string;
  readonly scale: readonly [number, number, number];
  readonly roughness: number;
  readonly metalness: number;
  readonly shard: boolean;
  readonly accentStrength: number;
  readonly tilt: number;
}

/**
 * One presentation language for mined material. These profiles describe only silhouette/material
 * treatment; they never imply grade, quantity, discovery, inventory or extraction authority.
 */
export function mineralVisualProfile(id: string): MineralVisualProfile {
  if (id === 'stone') return {
    kind: 'stone', baseColour: '#918b7d', accentColour: '#c2b9a5', scale: [1.15, 0.72, 1],
    roughness: 0.98, metalness: 0.02, shard: false, accentStrength: 0, tilt: 0.18,
  };
  if (id === 'clay') return {
    kind: 'clay', baseColour: '#a97052', accentColour: '#d09a72', scale: [1.2, 0.58, 1.08],
    roughness: 1, metalness: 0, shard: false, accentStrength: 0, tilt: 0.08,
  };
  if (id === 'coal' || id === 'charcoal') return {
    kind: 'coal', baseColour: '#303231', accentColour: '#686963', scale: [1.08, 0.55, 1.2],
    roughness: 0.82, metalness: 0.12, shard: true, accentStrength: 0.16, tilt: 0.38,
  };
  if (/copper|bronze/.test(id)) return {
    kind: 'copper', baseColour: '#8f654c', accentColour: '#d39a68', scale: [0.95, 0.82, 1.12],
    roughness: 0.68, metalness: 0.28, shard: true, accentStrength: 0.62, tilt: 0.28,
  };
  if (/tin/.test(id)) return {
    kind: 'tin', baseColour: '#949fa4', accentColour: '#d1dadd', scale: [1.05, 0.7, 0.92],
    roughness: 0.6, metalness: 0.36, shard: true, accentStrength: 0.58, tilt: 0.22,
  };
  if (/iron|steel/.test(id)) return {
    kind: 'iron', baseColour: '#735d54', accentColour: '#b58b76', scale: [1, 0.9, 0.96],
    roughness: 0.72, metalness: 0.32, shard: true, accentStrength: 0.52, tilt: 0.3,
  };
  if (/uranium/.test(id)) return {
    kind: 'uranium', baseColour: '#7f8955', accentColour: '#c5d275', scale: [0.72, 1.18, 0.72],
    roughness: 0.56, metalness: 0.2, shard: true, accentStrength: 0.9, tilt: 0.12,
  };
  return {
    kind: 'generic', baseColour: '#898276', accentColour: '#b8ae9c', scale: [1, 0.82, 1],
    roughness: 0.9, metalness: 0.06, shard: false, accentStrength: 0.1, tilt: 0.2,
  };
}

export function isMinedMaterial(id: string): boolean {
  return /ore|stone|coal|clay|uranium/.test(id);
}

/** Cargo can afford one material-specific geometry because each trip owns only one bounded mesh. */
export function mineralCargoGeometry(id: string): THREE.BufferGeometry {
  const profile = mineralVisualProfile(id);
  if (profile.kind === 'clay') return new THREE.IcosahedronGeometry(0.1, 1);
  if (profile.kind === 'coal') return new THREE.TetrahedronGeometry(0.115, 0);
  if (profile.kind === 'stone') return new THREE.DodecahedronGeometry(0.1, 0);
  if (profile.kind === 'uranium') return new THREE.OctahedronGeometry(0.105, 0);
  return new THREE.OctahedronGeometry(0.1, 0);
}
