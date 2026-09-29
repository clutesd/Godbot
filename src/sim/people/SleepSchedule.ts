import type { Person } from '../types';
import { resourceVisualUnit } from '../resources/ResourceWorkPresentation';

/** Shared routine policy. The monthly simulation and visible solar clock sample it independently. */
export function sleepSchedule(person: Person, hour: number): { sleeping: boolean; returningHome: boolean; nightShift: boolean; bedtime: number; wakeTime: number } {
  const dutyRole = person.ageMonths >= 168 && ['guard', 'soldier', 'healer', 'medical-worker', 'energy-technician'].includes(person.role ?? '');
  const nightShift = dutyRole && resourceVisualUnit(`${person.id}:night-shift`) < 0.34;
  const offset = (resourceVisualUnit(`${person.id}:bedtime`) - 0.5) * 1.2;
  const child = person.ageMonths < 168;
  const bedtime = (nightShift ? 8 : child ? 20 : 22) + offset;
  const wakeTime = (nightShift ? 16 : child ? 7 : 6) + offset;
  const remainder = hour % 24;
  const clock = remainder < 0 ? remainder + 24 : remainder;
  const due = bedtime < wakeTime ? clock >= bedtime && clock < wakeTime : clock >= bedtime || clock < wakeTime;
  // Finish safety-critical travel and emergency care; ordinary jobs do not cancel bedtime.
  const required = ['flee', 'migrate', 'shelter'].includes(person.activity)
    || person.navigation?.schedulePhase === 'emergency'
    || (person.activity === 'transport' && Boolean(person.navigation?.traveling));
  const untilBed = (bedtime - clock + 24) % 24;
  return { sleeping: person.alive && due && !required,
    returningHome: person.alive && !required && (due || untilBed <= 2), nightShift, bedtime, wakeTime };
}
