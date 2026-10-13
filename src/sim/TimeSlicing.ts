/**
 * Resumable simulation work. Each `yield` marks a quiescent point where an interactive driver may
 * pause to draw a frame; the operations and random draws are identical whether or not it pauses.
 */
export type Slices<T = void> = Generator<void, T, void>;

/** Runs resumable work to completion without pausing. */
export function drain<T>(job: Slices<T>): T {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}
