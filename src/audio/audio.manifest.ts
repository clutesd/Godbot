import type { AudioCategory } from '../historian/types';

export type AudioEra = 'settlement' | 'urban' | 'recorded' | 'industrial' | 'atomic' | 'machine' | 'interplanetary';

export interface AudioTrackDefinition {
  file: string;
  volume?: number;
  loop?: boolean;
}

export interface AudioManifest {
  version: number;
  ambience: Record<AudioCategory, AudioTrackDefinition[]>;
  music: Record<AudioEra, AudioTrackDefinition[]>;
  events: Partial<Record<AudioCategory, AudioTrackDefinition[]>>;
  voiceAssets: Record<string, string>;
}

const MOONLIT_DRIFT: AudioTrackDefinition = { file: 'music/moonlit-drift.mp3', volume: 0.45, loop: true };

/**
 * Local-only assets. Paths resolve below audio.basePath.
 * Missing layers are silent; the documentary never depends on an audio asset.
 */
export const AUDIO_MANIFEST: AudioManifest = {
  version: 2,
  ambience: {
    'ambient-wilderness': [],
    settlement: [],
    'ritual-culture': [],
    discovery: [],
    conflict: [],
    tragedy: [],
    industry: [],
    historian: [],
    'major-threshold': [],
    ending: [],
  },
  music: {
    settlement: [MOONLIT_DRIFT],
    urban: [MOONLIT_DRIFT],
    recorded: [MOONLIT_DRIFT],
    industrial: [MOONLIT_DRIFT],
    atomic: [MOONLIT_DRIFT],
    machine: [MOONLIT_DRIFT],
    interplanetary: [MOONLIT_DRIFT],
  },
  events: {},
  voiceAssets: {},
};
