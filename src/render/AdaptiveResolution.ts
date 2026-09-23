/** Conservative resolution relief for sustained load, with slow recovery to avoid visible pumping. */
export class AdaptiveResolution {
  scale = 1;
  private seconds = 0;
  private frames = 0;
  private cooldown = 3;
  private healthySeconds = 0;

  sample(deltaSeconds: number): boolean {
    // Loading, tab suspension and breakpoints must not lower image quality.
    if (!(deltaSeconds > 0 && deltaSeconds < 0.1)) return false;
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    this.seconds += deltaSeconds;
    this.frames++;
    if (this.seconds < 2) return false;
    const average = this.seconds / this.frames;
    this.healthySeconds = average < 0.0175 ? this.healthySeconds + this.seconds : 0;
    this.seconds = 0;
    this.frames = 0;
    if (this.cooldown > 0) return false;
    const next = average > 0.021
      ? Math.max(0.75, this.scale - 0.05)
      : this.healthySeconds >= 8 ? Math.min(1, this.scale + 0.05) : this.scale;
    if (Math.abs(next - this.scale) < 0.001) return false;
    this.scale = next;
    this.cooldown = 5;
    this.healthySeconds = 0;
    return true;
  }
}
