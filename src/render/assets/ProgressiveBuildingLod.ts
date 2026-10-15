import * as THREE from 'three';

interface Family { members: WeakRef<ProgressiveBuildingLod>[]; }
/** Clones made before preparation finishes receive the same shared geometry when it is ready. */
export class ProgressiveBuildingLod extends THREE.LOD {
  private family: Family = { members: [new WeakRef(this)] };
  override copy(source: this, recursive = true): this {
    super.copy(source, recursive);
    this.family = source.family;
    this.family.members.push(new WeakRef(this));
    return this;
  }
  install(tiers: readonly THREE.Object3D[], distances: readonly number[], hysteresis: number): void {
    this.family.members = this.family.members.filter(reference => {
      const member = reference.deref();
      if (!member) return false;
      tiers.forEach((tier, i) => {
        const object = member === this ? tier : tier.clone(true);
        object.visible = false;
        member.addLevel(object, distances[i]!, hysteresis);
      });
      member.userData['lodPreparation'] = 'ready';
      return true;
    });
  }
}
