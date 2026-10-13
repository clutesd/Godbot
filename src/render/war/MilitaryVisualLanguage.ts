import type { MilitaryCapabilityProfile, MilitaryEquipment } from '../../sim/war/MilitaryCapability';

export type FormationDoctrine = 'warband' | 'ranked' | 'line' | 'industrial' | 'combined-arms';
export type PrimaryWeaponVisual = 'club' | 'spear' | 'sword' | 'bow' | 'musket' | 'rifle' | 'automatic';
export const isFirearmWeapon = (weapon: PrimaryWeaponVisual): boolean => ['musket', 'rifle', 'automatic'].includes(weapon);
export const isRangedWeapon = (weapon: PrimaryWeaponVisual): boolean => weapon === 'bow' || isFirearmWeapon(weapon);

export interface MilitaryVisualStyle {
  doctrine: FormationDoctrine;
  rankWidth: number;
  lateralSpacing: number;
  depthSpacing: number;
  jitter: number;
  weapon: PrimaryWeaponVisual;
  shields: boolean;
  armour: boolean;
  artillery: number;
  vehicles: number;
  aircraft: number;
  missiles: number;
  drones: number;
  biological: boolean;
  nuclear: 'none' | 'atomic' | 'hydrogen';
  smoke: number;
  flash: number;
  tracer: number;
  dust: number;
}

const has = (profile: MilitaryCapabilityProfile, equipment: MilitaryEquipment): boolean => profile.equipment.includes(equipment);

/**
 * A bounded documentary visual language. It intentionally reads the frozen mobilization profile,
 * never the calendar, so the world only shows military objects that the society could actually field.
 */
export function militaryVisualStyle(profile: MilitaryCapabilityProfile): MilitaryVisualStyle {
  const automatic = has(profile, 'automatic-weapons');
  const rifle = automatic || has(profile, 'rifles');
  const musket = !rifle && has(profile, 'gunpowder-weapons');
  const firearmsCarried = rifle || musket;
  const bow = !rifle && has(profile, 'bows');
  const spear = !rifle && !bow && has(profile, 'stone-spears');
  const weapon: PrimaryWeaponVisual = automatic ? 'automatic' : rifle ? 'rifle' : musket ? 'musket'
    : bow ? 'bow' : has(profile, 'metal-weapons') ? 'sword' : spear ? 'spear' : 'club';

  const doctrine: FormationDoctrine = profile.regime === 'modern' ? 'combined-arms'
    : profile.regime === 'industrial' ? 'industrial'
      : profile.regime === 'gunpowder' ? 'line'
        : profile.regime === 'siege' || profile.regime === 'organized-melee' ? 'ranked'
          : 'warband';

  const formation = doctrine === 'combined-arms' ? { rankWidth: 5, lateralSpacing: 0.28, depthSpacing: 0.34, jitter: 0.11 }
    : doctrine === 'industrial' ? { rankWidth: 5, lateralSpacing: 0.25, depthSpacing: 0.31, jitter: 0.07 }
      : doctrine === 'line' ? { rankWidth: 6, lateralSpacing: 0.2, depthSpacing: 0.25, jitter: 0.025 }
        : doctrine === 'ranked' ? { rankWidth: 5, lateralSpacing: 0.18, depthSpacing: 0.22, jitter: 0.015 }
          : { rankWidth: 4, lateralSpacing: 0.24, depthSpacing: 0.27, jitter: 0.13 };

  const artillery = has(profile, 'artillery') ? 2 : has(profile, 'cannon') || has(profile, 'siege-engines') ? 1 : 0;
  const vehicles = has(profile, 'motor-transport') ? Math.max(1, profile.mobility > 0.72 ? 2 : 1) : 0;
  const aircraft = has(profile, 'aircraft') ? Math.max(1, profile.airPower > 0.68 ? 2 : 1) : 0;
  const missiles = has(profile, 'guided-missiles') ? Math.max(1, profile.missile > 0.72 ? 2 : 1) : 0;
  const drones = has(profile, 'drone-swarms') ? (profile.dronePower ?? 0.5) > 0.72 ? 8 : 5 : 0;
  const firearms = firearmsCarried || has(profile, 'cannon') || has(profile, 'artillery');

  return {
    doctrine,
    ...formation,
    weapon,
    shields: !firearmsCarried && !bow && (has(profile, 'shields') || has(profile, 'metal-armour')),
    armour: has(profile, 'metal-armour') || profile.protection > 0.5,
    artillery,
    vehicles,
    aircraft,
    missiles,
    drones,
    biological: has(profile, 'biological-warfare'),
    nuclear: has(profile, 'hydrogen-weapons') ? 'hydrogen' : has(profile, 'atomic-weapons') ? 'atomic' : 'none',
    smoke: firearms ? (profile.regime === 'modern' ? 18 : profile.regime === 'industrial' ? 22 : 14) : 0,
    flash: firearms ? 14 : 0,
    tracer: automatic || profile.regime === 'modern' ? 12 : firearmsCarried ? 7 : 0,
    dust: profile.regime === 'improvised' || profile.regime === 'organized-melee' || profile.regime === 'siege' ? 6 : 7,
  };
}

export function militarySignature(profile: MilitaryCapabilityProfile): MilitaryEquipment {
  const priority: MilitaryEquipment[] = [
    'hydrogen-weapons', 'atomic-weapons', 'biological-warfare', 'guided-missiles', 'drone-swarms', 'aircraft', 'automatic-weapons', 'artillery', 'rifles', 'cannon',
    'gunpowder-weapons', 'siege-engines', 'metal-armour', 'metal-weapons', 'bows', 'stone-spears', 'clubs',
  ];
  return priority.find(equipment => profile.equipment.includes(equipment)) ?? 'clubs';
}
