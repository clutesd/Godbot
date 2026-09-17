import type { Person, Settlement, Vec2 } from '../sim/types';
import { resourceVisualUnit } from '../sim/resources/ResourceWorkPresentation';

export interface FarmGeometry {
  id: string;
  center: Vec2;
  width: number;
  depth: number;
}

/** A representative cultivated bed, attached to an actual field or to aggregate farmer labour.
 * Shared by navigation and rendering: no independent random field radius in either consumer. */
export function farmGeometry(settlement: Settlement): FarmGeometry | undefined {
  if (!settlement.alive) return undefined;
  const fields = settlement.structurePlots?.filter(p => p.development?.form === 'field');
  const plot = fields?.find(p => p.development?.status === 'active' && !p.accessRestricted && p.condition >= 0.65 && !p.fire);
  if (plot) return { id: plot.id, center: { x: plot.worldX, z: plot.worldZ }, width: Math.max(0.8, plot.width * 0.75), depth: Math.max(0.7, plot.depth * 0.65) };
  if (fields?.length || !(settlement.agriculture && settlement.agriculture.labour > 0)) return undefined;
  const angle = resourceVisualUnit(`${settlement.id}:cultivated-field`) * Math.PI * 2;
  return { id: `${settlement.id}:field`, center: { x: settlement.position.x + Math.cos(angle) * 4, z: settlement.position.z + Math.sin(angle) * 4 }, width: 1.8, depth: 1.3 };
}

export function farmAnchor(field: FarmGeometry, personId: string, step = 0): { anchor: Vec2; target: Vec2 } {
  const row = Math.floor(resourceVisualUnit(`${personId}:row`) * 4);
  const column = (Math.floor(resourceVisualUnit(`${personId}:column`) * 6) + step) % 6;
  const x = field.center.x + (column / 5 - 0.5) * field.width * 0.8;
  const z = field.center.z + (row - 1.5) * field.depth / 4;
  return { anchor: { x, z: z - 0.13 }, target: { x, z } };
}

export function farmDestinationMatches(person: Person, field: FarmGeometry): boolean {
  return person.navigation?.destinationKind === 'field'
    && (person.navigation.destinationId === field.id || person.navigation.destinationId === `${person.homeId}:field`);
}
