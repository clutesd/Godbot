import type { EpistemicStatus } from './types';

export type NarrativeBeatCategory =
  | 'mission'
  | 'life-project'
  | 'thread'
  | 'threshold'
  | 'causal'
  | 'watcher-memory'
  | 'deep-memory'
  | 'legacy'
  | 'genealogy'
  | 'institution'
  | 'movement'
  | 'theme'
  | 'question-resolution'
  | 'archive-context';

export interface NarrativeBeat {
  key: string;
  category: NarrativeBeatCategory;
  text: string;
  priority: number;
  sourceEventIds?: string[];
  sourceEntityIds?: string[];
  sourceMemoryIds?: string[];
  epistemicStatus?: EpistemicStatus;
  generic?: boolean;
}

export interface NarrativeSelection {
  beats: NarrativeBeat[];
  text: string;
}

const CONTEXT_GROUP = new Set<NarrativeBeatCategory>(['thread', 'deep-memory', 'genealogy', 'institution', 'movement', 'theme']);
const IMMEDIATE_GROUP = new Set<NarrativeBeatCategory>(['mission', 'life-project', 'threshold', 'causal']);

/**
 * Presentation policy for the Watcher. It deliberately throws information away.
 * Rich memory should increase selectivity, not turn every scene into a lecture.
 */
export class NarrativeEpisodeDirector {
  private readonly recentKeys: Array<{ key: string; sequence: number }> = [];

  select(beats: readonly NarrativeBeat[], sequence: number, baseText: string): NarrativeSelection {
    const unique = this.dedupe(beats)
      .filter((beat) => this.allowedNow(beat, sequence))
      .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));

    const chosen: NarrativeBeat[] = [];
    let additionsLength = 0;
    for (const beat of unique) {
      if (chosen.length >= 2) break;
      if (this.conflicts(beat, chosen)) continue;
      const projected = additionsLength + beat.text.length + (chosen.length > 0 ? 1 : 0);
      if (projected > 360 && chosen.length > 0) continue;
      chosen.push(beat);
      additionsLength = projected;
    }

    for (const beat of chosen) this.mark(beat.key, sequence);
    const addition = chosen.map((beat) => beat.text.trim()).filter(Boolean).join(' ');
    return { beats: chosen, text: addition ? `${addition} ${baseText}`.trim() : baseText };
  }

  private dedupe(beats: readonly NarrativeBeat[]): NarrativeBeat[] {
    const seenKeys = new Set<string>();
    const seenText = new Set<string>();
    const result: NarrativeBeat[] = [];
    for (const beat of beats) {
      const text = beat.text.replace(/\s+/g, ' ').trim();
      if (!text || seenKeys.has(beat.key) || seenText.has(text.toLowerCase())) continue;
      seenKeys.add(beat.key);
      seenText.add(text.toLowerCase());
      result.push({ ...beat, text });
    }
    return result;
  }

  private allowedNow(beat: NarrativeBeat, sequence: number): boolean {
    const last = [...this.recentKeys].reverse().find((item) => item.key === beat.key);
    if (last && sequence - last.sequence < 18) return false;
    if (!beat.generic) return true;
    // Generic observations are the first thing silence removes.
    return sequence % 7 === 0;
  }

  private conflicts(beat: NarrativeBeat, chosen: readonly NarrativeBeat[]): boolean {
    if (chosen.some((item) => item.category === beat.category)) return true;
    if (CONTEXT_GROUP.has(beat.category) && chosen.some((item) => CONTEXT_GROUP.has(item.category))) return true;
    if (IMMEDIATE_GROUP.has(beat.category) && chosen.some((item) => IMMEDIATE_GROUP.has(item.category))) return true;
    return false;
  }

  private mark(key: string, sequence: number): void {
    this.recentKeys.push({ key, sequence });
    if (this.recentKeys.length > 96) this.recentKeys.splice(0, this.recentKeys.length - 96);
  }
}
