import * as THREE from 'three';

export type MineralVisualKind = 'stone' | 'clay' | 'coal' | 'copper' | 'tin' | 'iron' | 'uranium' | 'generic';
export type MineralGeometryKind = 'rubble' | 'clod' | 'coal' | 'shard' | 'crystal';
export type MineralAerialPattern = 'scree' | 'terraces' | 'heap' | 'copper-bands' | 'tin-strips' | 'iron-fines' | 'crystal-cluster' | 'generic';

export interface MineralAerialSignature {
  readonly pattern: MineralAerialPattern;
  readonly footprint: readonly [number, number];
  readonly groundColour: string;
  readonly accentColour: string;
  readonly accentCount: number;
}

export interface MineralVisualProfile {
  readonly kind: MineralVisualKind;
  readonly baseColour: string;
  readonly accentColour: string;
  readonly secondaryColour: string;
  readonly geometry: MineralGeometryKind;
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
    kind: 'stone', baseColour: '#918b7d', accentColour: '#c2b9a5', secondaryColour: '#746f65', geometry: 'rubble', scale: [1.15, 0.72, 1],
    roughness: 0.98, metalness: 0.02, shard: false, accentStrength: 0, tilt: 0.18,
  };
  if (id === 'clay') return {
    kind: 'clay', baseColour: '#a97052', accentColour: '#d09a72', secondaryColour: '#8f5d45', geometry: 'clod', scale: [1.2, 0.58, 1.08],
    roughness: 1, metalness: 0, shard: false, accentStrength: 0, tilt: 0.08,
  };
  if (id === 'coal' || id === 'charcoal') return {
    kind: 'coal', baseColour: '#303231', accentColour: '#686963', secondaryColour: '#1f2222', geometry: 'coal', scale: [1.08, 0.55, 1.2],
    roughness: 0.82, metalness: 0.12, shard: true, accentStrength: 0.16, tilt: 0.38,
  };
  if (/copper|bronze/.test(id)) return {
    kind: 'copper', baseColour: '#865a44', accentColour: '#dc8d52', secondaryColour: '#5f4941', geometry: 'shard', scale: [0.95, 0.82, 1.12],
    roughness: 0.68, metalness: 0.28, shard: true, accentStrength: 0.62, tilt: 0.28,
  };
  if (/tin/.test(id)) return {
    kind: 'tin', baseColour: '#949fa4', accentColour: '#d1dadd', secondaryColour: '#727e84', geometry: 'shard', scale: [1.05, 0.7, 0.92],
    roughness: 0.6, metalness: 0.36, shard: true, accentStrength: 0.58, tilt: 0.22,
  };
  if (/iron|steel/.test(id)) return {
    kind: 'iron', baseColour: '#6d5148', accentColour: '#a95f43', secondaryColour: '#463f3d', geometry: 'shard', scale: [1, 0.9, 0.96],
    roughness: 0.72, metalness: 0.32, shard: true, accentStrength: 0.52, tilt: 0.3,
  };
  if (/uranium/.test(id)) return {
    kind: 'uranium', baseColour: '#7f8955', accentColour: '#c5d275', secondaryColour: '#56603d', geometry: 'crystal', scale: [0.72, 1.18, 0.72],
    roughness: 0.56, metalness: 0.2, shard: true, accentStrength: 0.9, tilt: 0.12,
  };
  return {
    kind: 'generic', baseColour: '#898276', accentColour: '#b8ae9c', secondaryColour: '#6f695f', geometry: 'rubble', scale: [1, 0.82, 1],
    roughness: 0.9, metalness: 0.06, shard: false, accentStrength: 0.1, tilt: 0.2,
  };
}

export function mineralAerialSignature(id: string): MineralAerialSignature {
  const profile = mineralVisualProfile(id);
  if (profile.kind === 'stone') return { pattern: 'scree', footprint: [1.45, 1.05], groundColour: '#777269', accentColour: '#aaa395', accentCount: 4 };
  if (profile.kind === 'clay') return { pattern: 'terraces', footprint: [1.5, 0.9], groundColour: '#8b5842', accentColour: '#c88760', accentCount: 3 };
  if (profile.kind === 'coal') return { pattern: 'heap', footprint: [1.35, 1.15], groundColour: '#202322', accentColour: '#555a57', accentCount: 4 };
  if (profile.kind === 'copper') return { pattern: 'copper-bands', footprint: [1.3, 0.95], groundColour: '#57443e', accentColour: profile.accentColour, accentCount: 3 };
  if (profile.kind === 'tin') return { pattern: 'tin-strips', footprint: [1.2, 1.0], groundColour: '#6e797e', accentColour: '#dbe2e1', accentCount: 3 };
  if (profile.kind === 'iron') return { pattern: 'iron-fines', footprint: [1.4, 1.02], groundColour: '#4b3e3a', accentColour: profile.accentColour, accentCount: 4 };
  if (profile.kind === 'uranium') return { pattern: 'crystal-cluster', footprint: [1.05, 0.95], groundColour: '#4f5739', accentColour: profile.accentColour, accentCount: 3 };
  return { pattern: 'generic', footprint: [1.1, 0.9], groundColour: profile.secondaryColour, accentColour: profile.accentColour, accentCount: 2 };
}

export function isMinedMaterial(id: string): boolean {
  return /ore|stone|coal|clay|uranium/.test(id);
}

/** Cargo can afford one material-specific geometry because each trip owns only one bounded mesh. */
export function mineralCargoGeometry(id: string): THREE.BufferGeometry {
  const profile = mineralVisualProfile(id);
  if (profile.geometry === 'clod') return new THREE.IcosahedronGeometry(0.1, 1);
  if (profile.geometry === 'rubble') return new THREE.DodecahedronGeometry(0.1, 0);
  if (profile.geometry === 'crystal') {
    const geometry = new THREE.ConeGeometry(0.075, 0.2, 5);
    geometry.rotateZ(0.08);
    return geometry;
  }
  return profile.kind === 'coal' ? new THREE.TetrahedronGeometry(0.115, 0) : new THREE.OctahedronGeometry(0.1, 0);
}
