import type { SimulationState, Vec2 } from '../sim/types';
import type { ObservationCandidate, ObservationKind } from './types';

interface Snapshot {
  id: string; name: string; position: Vec2; kind: ObservationKind;
  values: Record<string, string | number | boolean>; activity?: string;
  sourceIds?: string[];
}
function changeText(snapshot: Snapshot, before: Snapshot, keys: string[], state: SimulationState): string {
  const personName = (id: string | number | boolean): string => state.people.find(p => p.id === id)?.name ?? String(id);
  const placeName = (id: string | number | boolean): string => state.settlements.find(s => s.id === id)?.name ?? String(id);
  return keys.map(key => {
    const from = before.values[key], to = snapshot.values[key];
    switch (key) {
      case 'alive': return to === false ? 'has died; the people around them carry on' : 'is now present in the living record';
      case 'partner': return to === 'none' ? 'no longer has a recorded partner' : `now has a recorded partnership with ${personName(to!)}`;
      case 'home': return `has moved from ${placeName(from!)} to ${placeName(to!)}`;
      case 'children': return `has ${to} recorded children, previously ${from}`;
      case 'occupation': return `now works as ${to}, previously ${from}`;
      case 'activity': return `is now ${String(to).replaceAll('-', ' ')}`;
      case 'buildings': return `has ${to} recorded buildings, previously ${from}`;
      case 'food security band (quarters)': return `food security has ${Number(to) > Number(from) ? 'improved' : 'deteriorated'} into the ${Math.min(100, Number(to) * 25)}–${Math.min(100, (Number(to) + 1) * 25)}% range`;
      case 'pollution band (fifths)': return `pollution has ${Number(to) > Number(from) ? 'risen' : 'fallen'} into the ${Math.min(100, Number(to) * 20)}–${Math.min(100, (Number(to) + 1) * 20)}% range`;
      case 'construction percent (rounded down)': return `construction advanced from ${from}% to ${to}% (rounded down)`;
      case 'blocked': return to === 'none' ? 'the recorded construction blockers have cleared' : `construction is blocked by ${String(to).replaceAll('-', ' ')}`;
      case 'stalled': return to ? 'no construction work has been recorded for at least twelve months' : 'construction is no longer recorded as stalled';
      default: return `${key} is now ${to}, previously ${from}`;
    }
  }).join('; ');
}

interface Thread {
  snapshot: Snapshot; text: string; month: number; importance: number;
  revision: number; shownRevision: number; lastShown: number; resolved: boolean;
}

/** Stores copied evidence, never live simulation objects. Sampling does not consume attention. */
export class DocumentaryMemory {
  private previous = new Map<string, Snapshot>();
  private readonly threads = new Map<string, Thread>();
  private readonly shownEvents = new Set<string>();
  private readonly spoken = new Set<string>();
  private readonly progressRates = new Map<string, number>();
  private month = -1;

  observe(state: SimulationState): void {
    if (state.month === this.month) return;
    if (state.month < this.month) { this.previous.clear(); this.threads.clear(); this.shownEvents.clear(); this.spoken.clear(); this.progressRates.clear(); }
    const snapshots: Snapshot[] = state.people.filter(p => p.alive || this.previous.has(p.id)).map(p => ({
      id: p.id, name: p.name, position: { ...p.position }, kind: p.alive ? 'worker-follow' : 'aftermath-pullback', activity: p.activity,
      values: { alive: p.alive, home: p.homeId, partner: p.partnerId ?? 'none', children: p.children.length, occupation: p.occupation, activity: p.activity },
    }));
    for (const s of state.settlements) {
      snapshots.push({ id: s.id, name: s.name, position: { ...s.position }, kind: 'settlement-approach', values: {
        alive: s.alive, buildings: s.buildings, 'food security band (quarters)': Math.floor(s.foodSecurity * 4), 'pollution band (fifths)': Math.floor(s.pollution * 5),
      } });
      const project = s.development?.project;
      if (project) snapshots.push({ id: project.plotId, name: project.response.name,
        position: { x: s.structurePlots?.find(p => p.id === project.plotId)?.worldX ?? s.position.x, z: s.structurePlots?.find(p => p.id === project.plotId)?.worldZ ?? s.position.z },
        kind: 'infrastructure-scene', activity: 'construct', sourceIds: [s.id], values: { 'construction percent (rounded down)': Math.floor(project.progress * 100), blocked: (project.blockedReasons ?? []).join(', ') || 'none', stalled: state.month - (project.lastWorkMonth ?? project.startedMonth) >= 12 },
      });
    }
    const next = new Map(snapshots.map(s => [s.id, s]));
    for (const snapshot of snapshots) {
      const before = this.previous.get(snapshot.id);
      const changes = before ? Object.keys(snapshot.values).filter(k => snapshot.values[k] !== before.values[k]) : [];
      const isProject = 'construction percent (rounded down)' in snapshot.values;
      if (!changes.length && !(isProject && !before)) continue;
      const important = changes.filter(k => k !== 'activity');
      const pending = this.threads.get(snapshot.id);
      if (!important.length && pending && pending.shownRevision < pending.revision && pending.importance >= 0.7) continue;
      let text = before
        ? `${snapshot.name}: since month ${this.month}, ${changeText(snapshot, before, changes, state)}.`
        : `${snapshot.name} is under construction; recorded progress is ${snapshot.values['construction percent (rounded down)']}% (rounded down).`;
      if (before && isProject) {
        const gain = Number(snapshot.values['construction percent (rounded down)']) - Number(before.values['construction percent (rounded down)']);
        const rate = gain / Math.max(1, state.month - this.month);
        const priorRate = this.progressRates.get(snapshot.id);
        if (gain >= 5 && priorRate !== undefined && priorRate > 0 && rate >= priorRate * 2) text += ' Observed construction progress is advancing at least twice as fast as in the preceding observation interval.';
        this.progressRates.set(snapshot.id, rate);
      }
      const old = this.threads.get(snapshot.id);
      this.threads.set(snapshot.id, { snapshot, text, month: state.month,
        importance: snapshot.values.alive === false ? 0.95 : important.length ? 0.78 : 0.42,
        revision: (old?.revision ?? 0) + 1, shownRevision: old?.shownRevision ?? 0, lastShown: old?.lastShown ?? -Infinity,
        resolved: snapshot.values.alive === false,
      });
    }
    for (const [id, before] of this.previous) {
      if (next.has(id) || !('construction percent (rounded down)' in before.values)) continue;
      const plot = state.settlements.flatMap(s => s.structurePlots ?? []).find(p => p.id === id);
      const old = this.threads.get(id);
      this.progressRates.delete(id);
      this.threads.set(id, { snapshot: before, text: `${before.name}: construction is no longer active.${plot?.development ? ' The structure remains in the settlement record.' : ' Its completion is not confirmed.'}`,
        month: state.month, importance: 0.85, revision: (old?.revision ?? 0) + 1, shownRevision: old?.shownRevision ?? 0, lastShown: old?.lastShown ?? -Infinity, resolved: true });
    }
    this.previous = next;
    this.month = state.month;
    // Bound inactive memory without dropping an ongoing project merely because years passed.
    for (const [id, thread] of this.threads) if (state.month - thread.month > 240 && (thread.resolved || !next.has(id))) this.threads.delete(id);
  }

  candidates(state: SimulationState): ObservationCandidate[] {
    return [...this.threads.values()].filter(t => (t.shownRevision < t.revision || !t.resolved && state.month - t.lastShown >= 12)
      && (state.month - t.month <= 24 || !t.resolved && this.previous.has(t.snapshot.id)))
      .map(t => {
        const s = this.previous.get(t.snapshot.id) ?? t.snapshot;
        const fresh = t.shownRevision < t.revision;
        const deceased = s.values.alive === false ? state.people.find(person => person.id === s.id) : undefined;
        const builder = s.activity === 'construct' && s.kind === 'infrastructure-scene'
          ? state.people.filter(person => person.alive && s.sourceIds?.includes(person.homeId) && person.activity === 'construct')
            .sort((a, b) => Math.hypot(a.position.x - s.position.x, a.position.z - s.position.z)
              - Math.hypot(b.position.x - s.position.x, b.position.z - s.position.z))[0] : undefined;
        const mourner = deceased ? state.people.find(person => person.alive && (person.partnerId === deceased.id || person.parents.includes(deceased.id)))
          ?? state.people.find(person => person.alive && person.homeId === deceased.homeId) : undefined;
        const person = builder ?? mourner;
        const kind: ObservationKind = builder ? 'worker-follow' : mourner ? 'street-observation' : s.kind;
        return { id: `development:${s.id}:${t.revision}`, subjectId: person?.id ?? s.id, kind, position: { ...(person?.position ?? s.position) }, title: s.name,
          score: fresh ? t.importance : 0.48, interest: fresh ? t.importance : 0.4, audioCategory: 'settlement',
          statement: { id: `development:${s.id}:${t.revision}:${state.month}`, month: state.month, text: fresh ? t.text : `Returning to ${s.name}: ${s.activity ? `currently ${s.activity.replaceAll('-', ' ')}` : 'the recorded condition remains unchanged'}; the last recorded change was in month ${t.month}.`,
            epistemicStatus: 'recorded-fact', sourceEntityIds: s.sourceIds ?? [s.id], sourceEventIds: [], sourceArchiveIds: [], claims: {} },
          breakdown: { novelty: fresh ? 1 : 0, magnitude: t.importance, populationAffected: 0, rarity: 0, technological: 0, political: 0, cultural: 0, consequence: t.importance, continuity: 1, repetitionPenalty: fresh ? 0 : 0.5 },
          editorial: { subjectId: s.id, importance: t.importance, threadId: `life:${s.id}`, why: t.text,
            activityMeaning: 0.8, preferredScale: person || s.kind === 'worker-follow' ? 'human' : 'medium',
            desiredActivity: s.activity, shotPurpose: fresh ? 'witness-change' : 'follow-up',
            narration: fresh && t.importance >= 0.7 ? 'required' : 'silent', completion: s.activity ? 'subject-action' : 'settled',
            completionCondition: s.activity ? `Observe ${s.activity} until the action finishes or changes` : 'Settle on the changed subject and show its present condition' },
        };
      });
  }

  score(candidate: ObservationCandidate, state: SimulationState): number {
    const event = candidate.event;
    if (event) {
      const first = !state.history.some(e => e.type === event.type && (e.month < event.month || e.month === event.month && e.id < event.id));
      return (this.shownEvents.has(event.id) ? -1.2 : event.significance * 0.65 + (first ? 0.22 : 0))
        + (event.causes.some(id => this.shownEvents.has(id)) ? 0.4 : 0);
    }
    if (candidate.id.startsWith('development:')) return 0.35;
    if (candidate.kind === 'worker-follow' || candidate.kind === 'traveler-follow') return 0.22;
    return -0.18;
  }

  decorate(candidate: ObservationCandidate, state: SimulationState): ObservationCandidate {
    const event = candidate.event;
    if (event && candidate.editorial && !candidate.statement.claims.warId) candidate.editorial.threadId = `cause:${event.id}`;
    const cause = event?.causes.map(id => state.history.find(e => e.id === id && e.month <= event.month)).find(Boolean);
    if (cause && candidate.editorial) {
      candidate.editorial.threadId = `cause:${cause.id}`;
      candidate.editorial.why = `${event?.summary} Recorded consequence of: ${cause.summary}`;
      candidate.statement.sourceEventIds = [...new Set([...candidate.statement.sourceEventIds, cause.id])];
    }
    if (this.spoken.has(candidate.statement.text) && candidate.editorial) candidate.editorial.narration = 'silent';
    return candidate;
  }

  remember(candidate: ObservationCandidate, month: number, narrated = candidate.editorial?.narration !== 'silent'): void {
    if (candidate.event) this.shownEvents.add(candidate.event.id);
    if (narrated) this.spoken.add(candidate.statement.text);
    if (this.spoken.size > 2048) this.spoken.delete(this.spoken.values().next().value!);
    const t = this.threads.get(candidate.editorial?.subjectId ?? candidate.subjectId);
    if (t && candidate.id.startsWith('development:')) { t.shownRevision = t.revision; t.lastShown = month; }
  }
}
