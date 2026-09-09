import type { GodboxConfig } from '../config';
import type { AudioCategory } from '../historian/types';
import { AUDIO_MANIFEST, type AudioEra, type AudioManifest, type AudioTrackDefinition } from './audio.manifest';

interface PlayingTrack {
  audio: HTMLAudioElement;
  definition: AudioTrackDefinition;
  gain: number;
}

interface LayerState {
  current?: PlayingTrack;
  incoming?: PlayingTrack;
  fadingToSilence: boolean;
}

export class AudioDirector {
  failureReason?: string;
  private currentCategory?: AudioCategory;
  private currentEra?: AudioEra;
  private muted = false;
  private readonly ambience: LayerState = { fadingToSilence: false };
  private readonly music: LayerState = { fadingToSilence: false };
  private event?: HTMLAudioElement;
  private voice?: HTMLAudioElement;
  private selectionSequence = 0;

  constructor(private readonly config: GodboxConfig, private readonly manifest: AudioManifest = AUDIO_MANIFEST) {}

  get isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted) {
      this.pauseLayer(this.ambience);
      this.pauseLayer(this.music);
      this.event?.pause();
      this.voice?.pause();
      return;
    }
    if (!this.resumeLayer(this.ambience) && this.currentCategory) this.transitionLayer(this.ambience, this.manifest.ambience[this.currentCategory]);
    if (!this.resumeLayer(this.music) && this.currentEra) this.transitionLayer(this.music, this.manifest.music[this.currentEra]);
  }

  resume(): void {
    if (this.muted) return;
    this.resumeLayer(this.ambience);
    this.resumeLayer(this.music);
  }

  transitionTo(category: AudioCategory, voiceAssetId?: string, era: AudioEra = 'settlement'): void {
    if (!this.config.audio.enabled || typeof Audio === 'undefined') return;
    const categoryChanged = category !== this.currentCategory;
    const eraChanged = era !== this.currentEra;
    this.currentCategory = category;
    this.currentEra = era;
    if (this.muted) {
      if (categoryChanged) this.clearLayer(this.ambience);
      if (eraChanged) this.clearLayer(this.music);
      return;
    }
    if (voiceAssetId) this.playVoice(voiceAssetId);
    if (categoryChanged) {
      this.transitionLayer(this.ambience, this.manifest.ambience[category]);
      this.playEvent(category);
    }
    if (eraChanged) this.transitionLayer(this.music, this.manifest.music[era]);
  }

  update(deltaSeconds: number): void {
    const voiceActive = Boolean(this.voice && !this.voice.paused && !this.voice.ended);
    const bedScale = voiceActive ? this.config.audio.ducking : 1;
    this.updateLayer(this.ambience, deltaSeconds, this.config.audio.ambienceVolume * bedScale);
    this.updateLayer(this.music, deltaSeconds, this.config.audio.musicVolume * bedScale);
  }

  stop(): void {
    for (const layer of [this.ambience, this.music]) {
      layer.current?.audio.pause();
      layer.incoming?.audio.pause();
      layer.current = undefined;
      layer.incoming = undefined;
      layer.fadingToSilence = false;
    }
    this.event?.pause();
    this.voice?.pause();
    this.event = undefined;
    this.voice = undefined;
  }

  private pauseLayer(layer: LayerState): void {
    layer.current?.audio.pause();
    layer.incoming?.audio.pause();
  }

  private resumeLayer(layer: LayerState): boolean {
    let resumed = false;
    for (const track of [layer.current, layer.incoming]) {
      if (track) {
        if (track.audio.paused) this.play(track.audio);
        resumed = true;
      }
    }
    return resumed;
  }

  private clearLayer(layer: LayerState): void {
    layer.current?.audio.pause();
    layer.incoming?.audio.pause();
    layer.current = undefined;
    layer.incoming = undefined;
    layer.fadingToSilence = false;
  }

  private transitionLayer(layer: LayerState, choices: readonly AudioTrackDefinition[]): void {
    if (choices.length === 0) {
      layer.incoming?.audio.pause();
      layer.incoming = undefined;
      layer.fadingToSilence = Boolean(layer.current);
      return;
    }
    const definition = choices[this.selectionSequence++ % choices.length];
    if (!definition) return;
    const audio = new Audio(this.resolve(definition.file));
    audio.loop = definition.loop ?? true;
    audio.preload = 'auto';
    audio.volume = 0;
    layer.incoming?.audio.pause();
    layer.fadingToSilence = false;
    layer.incoming = { audio, definition, gain: 0 };
    this.play(audio);
  }

  private updateLayer(layer: LayerState, deltaSeconds: number, layerVolume: number): void {
    const step = deltaSeconds / Math.max(0.1, this.config.audio.crossfadeSeconds);
    if (layer.incoming) {
      layer.incoming.gain = Math.min(1, layer.incoming.gain + step);
      layer.incoming.audio.volume = this.volume(layer.incoming, layerVolume);
    }
    if (layer.current && (layer.incoming || layer.fadingToSilence)) {
      layer.current.gain = Math.max(0, layer.current.gain - step);
      layer.current.audio.volume = this.volume(layer.current, layerVolume);
      if (layer.current.gain === 0) layer.current.audio.pause();
    } else if (layer.current) {
      layer.current.audio.volume = this.volume(layer.current, layerVolume);
    }
    if (layer.incoming?.gain === 1) {
      layer.current?.audio.pause();
      layer.current = layer.incoming;
      layer.incoming = undefined;
    }
    if (layer.fadingToSilence && layer.current?.gain === 0) {
      layer.current.audio.pause();
      layer.current = undefined;
      layer.fadingToSilence = false;
    }
  }

  private playVoice(assetId: string): void {
    const file = this.manifest.voiceAssets[assetId];
    if (!file || typeof Audio === 'undefined') return;
    this.voice?.pause();
    this.voice = new Audio(this.resolve(file));
    this.voice.preload = 'auto';
    this.voice.volume = Math.min(1, this.config.audio.masterVolume * this.config.audio.voiceVolume);
    this.play(this.voice);
  }

  private playEvent(category: AudioCategory): void {
    const choices = this.manifest.events[category] ?? [];
    const definition = choices[this.selectionSequence++ % Math.max(1, choices.length)];
    if (!definition) return;
    this.event?.pause();
    this.event = new Audio(this.resolve(definition.file));
    this.event.loop = false;
    this.event.preload = 'auto';
    this.event.volume = Math.min(1, this.config.audio.masterVolume * this.config.audio.eventVolume * (definition.volume ?? 1));
    this.play(this.event);
  }

  private play(audio: HTMLAudioElement): void {
    if (this.muted) return;
    void audio.play().catch((error: unknown) => {
      this.failureReason = error instanceof Error ? error.message : String(error);
    });
  }

  private volume(track: PlayingTrack, layerVolume: number): number {
    if (this.muted) return 0;
    return Math.min(1, track.gain * this.config.audio.masterVolume * layerVolume * (track.definition.volume ?? 1));
  }

  private resolve(file: string): string {
    if (/^(?:https?:|data:|blob:|\/)/.test(file)) return file;
    return `${this.config.audio.basePath.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
  }
}
