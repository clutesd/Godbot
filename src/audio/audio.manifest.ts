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

/**
 * Local-only and deliberately empty by default. Paths resolve below audio.basePath.
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
    settlement: [],
    urban: [],
    recorded: [],
    industrial: [],
    atomic: [],
    machine: [],
    interplanetary: [],
  },
  events: {},
  voiceAssets: {},
};
