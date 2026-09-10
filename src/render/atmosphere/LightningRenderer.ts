import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';

/** Presentation clock only. Ignition is resolved independently by authoritative strike events. */
export class LightningRenderer {
  readonly light = new THREE.DirectionalLight('#d7e5ff', 0);
  private readonly random: SeededRandom;
  private next = 0;
  private started = -100;
  private strength = 0;
  private secondPulse = 0.14;
  private enabled = false;
  constructor(seed: string) { this.random = new SeededRandom(`${seed}:lightning-visual`); this.light.position.set(-30, 65, 15); }
  update(elapsed: number, storm: number, reducedMotion = false): number {
    if (storm < 0.55 || reducedMotion) { this.light.intensity = 0; this.enabled = false; return 0; }
    if (!this.enabled) { this.enabled = true; this.next = elapsed + this.random.range(12, 28); }
    if (elapsed >= this.next) {
      this.started = elapsed; this.strength = this.random.range(0.8, 1.7) * storm;
      this.secondPulse = this.random.range(0.09, 0.19);
      this.next = elapsed + this.random.range(28, 65);
      this.light.position.set(this.random.range(-60, 60), 65, this.random.range(-40, 40));
    }
    const age = elapsed - this.started;
    const pulse = Math.exp(-age * 65) + (age >= this.secondPulse ? 0.5 * Math.exp(-(age - this.secondPulse) * 42) : 0);
    this.light.intensity = age < 0.4 ? pulse * this.strength : 0;
    return this.light.intensity;
  }
}
