import { RESOURCE_BY_ID } from './catalog';
import type { ResourceWorkAssignment } from './ResourceWorkAssignments';

export type ResourceWorkVisualKind = 'timber' | 'mineral' | 'plant' | 'generic';

/**
 * One presentation classification for workers and work sites. It is derived only from the
 * authoritative resource id; it never changes extraction, labour, routing, or inventory state.
 */
export function resourceWorkVisualKind(
  assignment: Pick<ResourceWorkAssignment, 'resourceId'>,
): ResourceWorkVisualKind {
  const definition = RESOURCE_BY_ID.get(assignment.resourceId);
  if (definition?.category === 'timber' || assignment.resourceId === 'timber') return 'timber';
  if (definition?.category === 'plant'
    || assignment.resourceId === 'medicinal-flora'
    || assignment.resourceId === 'plant-fiber') return 'plant';
  if (definition?.category === 'mineral'
    || assignment.resourceId.includes('ore')
    || ['stone', 'clay', 'coal'].includes(assignment.resourceId)) return 'mineral';
  return 'generic';
}
