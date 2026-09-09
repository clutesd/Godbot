import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioDirector } from '../src/audio/AudioDirector';
import type { AudioManifest } from '../src/audio/audio.manifest';
import { configWith } from '../src/config';

class FakeAudio {
  static readonly instances: FakeAudio[] = [];
  loop = false;
  preload = '';
  volume = 1;
  paused = true;
  ended = false;

  constructor(readonly src: string) { FakeAudio.instances.push(this); }
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
}

const manifest: AudioManifest = {
  version: 2,
  ambience: {
    'ambient-wilderness': [], settlement: [{ file: 'settlement.ogg' }], 'ritual-culture': [], discovery: [], conflict: [{ file: 'conflict.ogg' }], tragedy: [], industry: [], historian: [], 'major-threshold': [], ending: [],
  },
  music: { settlement: [], urban: [], recorded: [], industrial: [], atomic: [], machine: [], interplanetary: [] },
  events: {},
  voiceAssets: { witness: 'voice/witness.ogg' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.instances.length = 0;
});

describe('AudioDirector', () => {
  it('crossfades local categories and fades cleanly to silence', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const director = new AudioDirector(configWith({ audio: { basePath: '/owned-audio', crossfadeSeconds: 2, masterVolume: 0.5, ambienceVolume: 1 } }), manifest);
    director.transitionTo('settlement');
    director.update(2);
    const settlement = FakeAudio.instances[0];
    expect(settlement?.src).toBe('/owned-audio/settlement.ogg');
    expect(settlement?.volume).toBe(0.5);

    director.transitionTo('conflict');
    director.update(1);
    const conflict = FakeAudio.instances[1];
    expect(settlement?.volume).toBe(0.25);
    expect(conflict?.volume).toBe(0.25);
    director.update(1);
    expect(settlement?.paused).toBe(true);
    expect(conflict?.volume).toBe(0.5);

    director.transitionTo('ending');
    director.update(2);
    expect(conflict?.paused).toBe(true);
  });

  it('supports optional local voice assets and silent categories', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const director = new AudioDirector(configWith(), manifest);
    director.transitionTo('ambient-wilderness', 'witness');
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0]?.src).toBe('/audio/voice/witness.ogg');
    expect(FakeAudio.instances[0]?.paused).toBe(false);
  });

  it('does nothing when browser audio is unavailable', () => {
    vi.stubGlobal('Audio', undefined);
    expect(() => new AudioDirector(configWith(), manifest).transitionTo('settlement')).not.toThrow();
  });

  it('mutes without constructing tracks and resumes the current era music on demand', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const layered: AudioManifest = {
      ...manifest,
      music: { ...manifest.music, settlement: [{ file: 'music/moonlit.ogg', volume: 0.4 }] },
    };
    const director = new AudioDirector(configWith({ audio: { masterVolume: 1, musicVolume: 1, crossfadeSeconds: 1 } }), layered);
    director.setMuted(true);
    director.transitionTo('settlement', undefined, 'settlement');
    expect(FakeAudio.instances).toHaveLength(0);

    director.setMuted(false);
    director.update(1);
    const music = FakeAudio.instances.find((audio) => audio.src === '/audio/music/moonlit.ogg');
    expect(music?.volume).toBe(0.4);
    expect(music?.paused).toBe(false);

    director.setMuted(true);
    expect(music?.paused).toBe(true);
    director.resume();
    expect(music?.paused).toBe(true);
    director.setMuted(false);
    expect(music?.paused).toBe(false);
  });

  it('layers ambience and era music, plays an event, and ducks beds under voice', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const layered: AudioManifest = {
      ...manifest,
      music: { ...manifest.music, atomic: [{ file: 'music/atomic.ogg' }] },
      events: { settlement: [{ file: 'events/bell.ogg', volume: 0.5 }] },
    };
    const director = new AudioDirector(configWith({ audio: { masterVolume: 1, ambienceVolume: 1, musicVolume: 1, eventVolume: 1, voiceVolume: 1, ducking: 0.25, crossfadeSeconds: 1 } }), layered);
    director.transitionTo('settlement', 'witness', 'atomic');
    director.update(1);
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(['/audio/voice/witness.ogg', '/audio/settlement.ogg', '/audio/events/bell.ogg', '/audio/music/atomic.ogg']);
    expect(FakeAudio.instances[1]?.volume).toBe(0.25);
    expect(FakeAudio.instances[2]?.loop).toBe(false);
    expect(FakeAudio.instances[2]?.volume).toBe(0.5);
    expect(FakeAudio.instances[3]?.volume).toBe(0.25);
  });
});
