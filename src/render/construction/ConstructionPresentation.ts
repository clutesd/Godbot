import type { PhysicalWorkScene } from '../people/PhysicalWorkScene';
import type { ConstructionAssembly } from './ConstructionAssembly';

/** Called after the human mover/render pass, using only this frame's visible workface evidence. */
export function advanceConstructionPresentation(
  assembly: ConstructionAssembly, scene: PhysicalWorkScene, plotId: string, paid: number, delta: number,
): void {
  const presentation = scene.installationPresentation(plotId, assembly.plan);
  assembly.update(paid, delta, presentation.contact, 'contact-led', presentation.valid);
}
