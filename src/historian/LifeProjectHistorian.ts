import type { SimulationState } from '../sim/types';
import { describeLifeProject, lifeProjectForPerson } from '../sim/people/LifeProjectSystem';
import { Historian } from './Historian';
import type { ObservationCandidate } from './types';

let installed = false;

/** Adds grounded biographical purpose to person-focused scenes without replacing the Watcher voice. */
export function installLifeProjectHistorian(): void {
  if (installed) return;
  installed = true;
  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function lifeProjectScene(state: SimulationState, focusEventId?: string): ObservationCandidate {
    const scene = chooseScene.call(this, state, focusEventId);
    const person = state.people.find((candidate) => candidate.alive && candidate.id === scene.subjectId);
    if (!person) return scene;
    const project = lifeProjectForPerson(person);
    const description = project ? describeLifeProject(person, state) : undefined;
    if (!project || !description) return scene;

    const originalText = scene.statement.text;
    const originalEntities = [...scene.statement.sourceEntityIds];
    const originalSources = [...scene.statement.sourceEventIds];
    const originalInterest = scene.interest;

    scene.statement.text = `${description} ${scene.statement.text}`.trim();
    scene.statement.sourceEntityIds = [...new Set([...scene.statement.sourceEntityIds, person.id, project.settlementId])];
    scene.statement.sourceEventIds = [...new Set([...scene.statement.sourceEventIds, ...project.relatedEventIds])];
    const longevity = Math.min(0.12, Math.max(0, state.month - project.startedMonth) / (40 * 12) * 0.12);
    const projectInterest = project.status === 'completed' ? 0.88
      : project.status === 'stalled' ? 0.7
        : 0.62 + project.effort * 0.18 + longevity;
    scene.interest = Math.max(scene.interest, projectInterest);

    if (!this.validateStatement(scene.statement, state)) {
      scene.statement.text = originalText;
      scene.statement.sourceEntityIds = originalEntities;
      scene.statement.sourceEventIds = originalSources;
      scene.interest = originalInterest;
    }
    return scene;
  };
}
