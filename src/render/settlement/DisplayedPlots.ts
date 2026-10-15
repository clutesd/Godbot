/**
 * DisplayedPlots.ts
 *
 * Which of a developed settlement's persistent plots the renderer draws as buildings.
 *
 * A long-lived town accumulates far more plots than a frame can afford to compose, so the
 * renderer draws a bounded sample. This module is that sample, on its own so the headless
 * architecture audit can measure exactly what a viewer would see rather than re-deriving it.
 *
 * The sample used to be the oldest plots first, ruins included. Past the budget that hid every
 * building a town raised in its later centuries behind the ruins of its first ones, so a settlement
 * that had industrialised still looked like its founding village. The sample is now chosen to show
 * what the town actually is and has been: every distinct working program at its newest, a spread of
 * housing generations, then standing fabric alternating newest and oldest, and only then the
 * abandoned and the ruined.
 */

import type { Settlement, StructurePlot } from '../../sim/types';

/** How many developed plots one settlement may draw at this visual density. */
export function displayedPlotBudget(settlement: Settlement, visualDensity: number): number {
  const developed = (settlement.structurePlots ?? []).filter(p => p.development).length;
  return Math.min(Math.max(12, Math.round(32 * visualDensity)), developed);
}

/** When this plot's present fabric was put up. */
function builtMonth(plot: StructurePlot): number {
  const development = plot.development!;
  return development.constructionWork?.startedMonth ?? development.history.at(-1)?.month ?? development.origin.month ?? plot.foundedMonth;
}

/** The working program a plot serves; two plots with the same key read as the same building. */
function programKey(plot: StructurePlot): string {
  const d = plot.development!;
  return `${d.need}/${d.form}/${d.level}/${d.facilityFamily ?? ''}${d.facilityTier ?? ''}/${d.reasons.includes('perimeter-defence') ? 'p' : ''}`;
}

const newestFirst = (a: StructurePlot, b: StructurePlot) => builtMonth(b) - builtMonth(a) || a.id.localeCompare(b.id);

/**
 * The developed plots drawn this frame, in draw order, plus the active project's plot.
 *
 * `budget` bounds the completed sample; the plot under construction is always appended when the
 * sample did not already include it, because a worksite is never culled. Below the budget every
 * developed plot is drawn, so small settlements are unaffected by the ordering.
 */
export function selectDisplayedPlots(settlement: Settlement, budget: number): StructurePlot[] {
  const all = settlement.structurePlots ?? [];
  const developed = all.filter(p => p.development);
  let chosen: StructurePlot[];
  if (developed.length <= budget) chosen = developed;
  else {
    const taken = new Set<string>();
    chosen = [];
    const take = (plot: StructurePlot | undefined) => {
      if (!plot || chosen.length >= budget || taken.has(plot.id)) return;
      taken.add(plot.id); chosen.push(plot);
    };
    const active = developed.filter(p => p.development!.status === 'active').sort(newestFirst);
    const working = active.filter(p => p.development!.need !== 'housing');
    const homes = active.filter(p => p.development!.need === 'housing');
    // Every distinct working program, at its newest.
    const programs = new Set<string>();
    for (const plot of working) {
      const key = programKey(plot);
      if (programs.has(key)) continue;
      programs.add(key); take(plot);
    }
    // Housing generations: the newest home at each level, and the oldest still standing.
    for (const level of [3, 2, 1]) take(homes.find(p => p.development!.level === level));
    take(homes.at(-1));
    // Standing fabric alternates newest and oldest, so both the town's growth and its roots show.
    const rest = active.filter(p => !taken.has(p.id));
    for (let low = 0, high = rest.length - 1; low <= high && chosen.length < budget; low++, high--) {
      take(rest[low]); take(rest[high]);
    }
    for (const status of ['abandoned', 'ruin'] as const) {
      for (const plot of developed.filter(p => p.development!.status === status).sort(newestFirst)) take(plot);
    }
  }
  // Draw order is unchanged from before the sample existed: working sites ahead of homes, then by
  // founding. Footprint registration follows this order, so it keeps its historical precedence.
  const selected = [...chosen].sort((a, b) =>
    Number(a.development?.need === 'housing') - Number(b.development?.need === 'housing') || a.foundedMonth - b.foundedMonth || a.id.localeCompare(b.id));
  const projectPlot = all.find(p => p.id === settlement.development?.project?.plotId);
  if (projectPlot && !selected.includes(projectPlot)) selected.push(projectPlot);
  return selected;
}
