import type { Person, Settlement } from '../../sim/types';
import type { AnimationPose } from './AnimationController';

/** Shared additive physical layer: work, locomotion and social clips keep ownership of their action. */
export function physicalCondition(person: Person, settlement: Settlement | undefined, month: number, omniscient = false, statistical = false) {
  let infection = person.infection;
  if (statistical && !infection && person.alive) {
    let hash = 2166136261;
    for (const char of person.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const sample = (hash >>> 0) / 4294967296;
    let cumulative = 0;
    const disease = settlement?.survival?.disease;
    for (const pathogen of ['enteric', 'respiratory', 'zoonotic'] as const) {
      cumulative += disease?.compartments[pathogen].infectious ?? 0;
      if (sample < cumulative) {
        infection = { pathogen, acquiredMonth: month, infectiousMonth: month, recoveryMonth: month + 1, severity: disease?.severity ?? 0 };
        break;
      }
    }
  }
  const perceived = omniscient || (settlement?.survival?.observations.disease?.perceived ?? 0) > 0.05;
  const symptomatic = person.alive && perceived && infection && month >= infection.infectiousMonth
    && month < infection.recoveryMonth;
  const illness = symptomatic ? Math.max(0, Math.min(1, infection?.severity ?? 0)) : 0;
  return { weakness: Math.max(illness, person.alive ? Math.max(0, 0.3 - person.energy) : 0),
    respiratory: illness > 0.2 && infection?.pathogen === 'respiratory', illness };
}

export function applyPhysicalCondition(pose: AnimationPose | null, condition: ReturnType<typeof physicalCondition>, seconds: number): void {
  if (!pose) return;
  const cough = condition.respiratory ? Math.max(0, Math.sin(seconds * 0.7)) ** 32 : 0;
  pose.spineRotation += condition.weakness * 0.16 + cough * 0.09;
  pose.headPitch = (pose.headPitch ?? 0) + condition.weakness * 0.1;
  pose.rightElbowRotation += cough * 0.9;
  pose.rightShoulderRotation += cough * 0.55;
}

