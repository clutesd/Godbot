// Exercise the installed Watcher/founding layers, not only the bare Historian class.
import '../godbox.config';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { CameraDirector } from '../src/render/CameraDirector';

describe('production watcher across live months', () => {
  it('keeps moving its attention and updating grounded text as real history evolves', () => {
    const config = { seed: 'production-watcher-live', startMode: 'established' as const, startingPopulation: 24,
      settlementCount: [2, 2] as const, world: { size: 20 } };
    const watched = new Simulation(config), control = new Simulation(config);
    const historian = new Historian(watched.config);
    const director = new CameraDirector(new PerspectiveCamera(38, 1.6, 0.01, 200), watched.config, historian);
    const windows = Array.from({ length: 3 }, () => new Set<string>());
    const texts = new Set<string>();
    let revision = -1;
    for (let frame = 0; frame < 180 * 10; frame++) {
      const t = frame / 10;
      if (frame % 40 === 0) { watched.step(); control.step(); }
      director.update(0.1, t, watched.state, () => 0);
      if (director.observation.statement) expect(historian.validateStatement(director.observation.statement, watched.state)).toBe(true);
      if (director.observation.revision !== revision && director.observation.sceneId) {
        revision = director.observation.revision;
        windows[Math.floor(t / 60)]!.add(director.current()!.subjectId);
        if (director.observation.narrationVisible) texts.add(director.observation.detail);
      }
    }
    expect(windows.every(w => w.size >= 2)).toBe(true);
    expect(texts.size).toBeGreaterThan(2);
    expect(watched.state).toEqual(control.state);
  });
});
