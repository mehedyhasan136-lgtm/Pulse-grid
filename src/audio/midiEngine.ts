import * as Tone from 'tone';
import { GesturePianoPreset, InstrumentConfig, MidiNote, TrackModel } from '../types/daw';
import { midiToNoteName } from '../data/presets';
import { createPianoSamplerBank, PianoSamplerBank } from './pianoSampleBank';
import {
  BUILTIN_BANK_ID,
  decodeBuiltinPresetZones,
  findBuiltinDefinition,
} from './builtinSoundBank';
import { decodeSf2PresetZones } from './soundfontParser';
import { InstrumentSampleZone, ResolvedInstrumentZones } from './soundfontTypes';

export const MAX_PIANO_POLYPHONY = 16;
export const MAX_SOUNDFONT_POLYPHONY = 20;
export const MAX_SAFE_MIDI_VELOCITY = 127;

export interface MidiExpressionOptions {
  channel?: number;
  pitchSlide?: MidiNote['pitchSlide'];
  mpe?: MidiNote['mpe'];
  beatDurationSec?: number;
}

interface DrumKitNodes {
  kick: Tone.MembraneSynth[];
  snareNoise: Tone.NoiseSynth[];
  snareBody: Tone.MembraneSynth[];
  clapNoise: Tone.NoiseSynth[];
  hatClosed: Tone.NoiseSynth[];
  hatOpen: Tone.NoiseSynth[];
  rimSynth: Tone.Synth[];
  filter: Tone.Filter;
  voiceIndex: Record<string, number>;
  lastHitTimes: Map<string, number>;
}

interface ActiveVoiceEntry {
  pitch: number;
  held: boolean;
  sustained: boolean;
  startedAt: number;
}

interface SoundfontActiveVoice {
  id: number;
  pitch: number;
  rawPitch: number;
  channel: number;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  pannerNode: StereoPannerNode;
  baseDetuneCents: number;
  scaleTuning: number;
  held: boolean;
  sustained: boolean;
  releaseSec: number;
  exclusiveClass: number;
  loop: boolean;
  isOneShotDrum: boolean;
  startedAt: number;
  cleanupTimer?: number;
}

interface TrackInstrumentHolder {
  type: InstrumentConfig['type'];
  filter: Tone.Filter;
  chorusNode?: Tone.Chorus;
  oscGain: Tone.Gain;
  pitchSemitones: number;
  pitchBendSemitones: number;
  pitchBendRange: number;
  midiChannel: number;
  attackOverride: number;
  decayOverride: number;
  sustainOverride: number;
  releaseOverride: number;
  pitchMap: Map<number, number>;
  polyGain?: Tone.Gain;
  polySynth?: Tone.PolySynth;
  pianoBank?: PianoSamplerBank;
  bassSynth?: Tone.MonoSynth;
  drumKit?: DrumKitNodes;
  samplerPlayer?: Tone.Player;
  samplerBufferId?: string;
  pianoPreset?: GesturePianoPreset;
  synthWaveform?: InstrumentConfig['params']['waveform'];
  loadedZones?: ResolvedInstrumentZones;
  soundfontKey?: string;
  soundfontLoadSeq?: number;
  sfVoices?: SoundfontActiveVoice[];
  maxPolyphony: number;
}

export function normalizePianoPreset(preset?: string): GesturePianoPreset {
  if (preset === 'electricPiano') return 'electricPiano';
  if (preset === 'synthPiano') return 'synthPiano';
  if (preset === 'softPiano') return 'softPiano';
  return 'acousticPiano';
}

/**
 * Peak-normalized harmonic spectra for Synth Piano / Soft Piano fallback
 * engineered to avoid upper-harmonic harshness.
 */
export function getPianoPartials(preset?: string): number[] {
  switch (normalizePianoPreset(preset)) {
    case 'electricPiano':
      return [0.58, 0.14, 0.18, 0.03, 0.02];
    case 'synthPiano':
      return [0.55, 0.24, 0.11, 0.04, 0.015];
    case 'softPiano':
      return [0.62, 0.16, 0.04, 0.01];
    case 'acousticPiano':
    default:
      return [0.55, 0.24, 0.11, 0.045, 0.018, 0.006];
  }
}

/**
 * Musical MIDI velocity (1..127 -> 1/127..1.0) to gain mapping.
 * Keeps pianissimo notes delicate and fortissimo strikes punchy without overloading voices.
 */
export function mapVelocityToNaturalGain(velocityNorm: number): number {
  const minNorm = 1 / 127;
  const clamped = Math.max(minNorm, Math.min(1.0, velocityNorm));
  return Math.round((0.14 + 0.86 * Math.pow(clamped, 1.35)) * 1000) / 1000;
}

/**
 * Gentle polyphony gain trim so 16-voice chords preserve clear headroom
 * without pumping or forcing the master limiter into saturation.
 */
export function computePolyphonyTrimGain(voiceCount: number): number {
  if (voiceCount <= 2) return 1.0;
  return Math.max(0.55, Math.min(1.0, 1 / Math.sqrt(1 + 0.12 * (voiceCount - 2))));
}

/**
 * Constant-power acoustic velocity layer split (soft felt layer vs forte concert layer).
 */
export function computeAcousticLayerWeights(
  velocityNorm: number,
  naturalGain: number
): { softGain: number; forteGain: number } {
  const clamped = Math.max(1 / 127, Math.min(1.0, velocityNorm));
  // Smooth blend starting at 0.28 and reaching full forte prominence by 0.88
  const blend = Math.max(0, Math.min(1, (clamped - 0.28) / 0.6));
  const angle = blend * (Math.PI * 0.5);
  const softWeight = Math.cos(angle);
  const forteWeight = Math.sin(angle);
  return {
    softGain: Math.round(naturalGain * softWeight * 1000) / 1000,
    forteGain: Math.round(naturalGain * forteWeight * 1000) / 1000,
  };
}

export class MidiEngine {
  private instruments = new Map<string, TrackInstrumentHolder>();
  private decodedAssets = new Map<string, AudioBuffer>();
  private trackVoices = new Map<string, ActiveVoiceEntry[]>();
  private sustainPedalState = new Map<string, boolean>();
  private outputNodes = new Map<string, Tone.ToneAudioNode>();
  private soundBankLoader?: (bankId: string) => Promise<boolean>;
  private nextSfVoiceId = 1;

  public setSoundBankLoader(loader: (bankId: string) => Promise<boolean>): void {
    this.soundBankLoader = loader;
  }

  public registerDecodedAsset(assetId: string, buffer: AudioBuffer): void {
    this.decodedAssets.set(assetId, buffer);
  }

  public getDecodedAssets(): Map<string, AudioBuffer> {
    return this.decodedAssets;
  }

  public syncTrackInstrument(track: TrackModel, outputNode: Tone.ToneAudioNode): void {
    const existing = this.instruments.get(track.id);
    const prevOut = this.outputNodes.get(track.id);

    if (existing && existing.type === track.instrument.type) {
      if (prevOut !== outputNode) {
        existing.oscGain.disconnect();
        existing.oscGain.connect(outputNode);
        this.outputNodes.set(track.id, outputNode);
      }
      this.updateInstrumentParams(track.id, existing, track.instrument);
      return;
    }

    if (existing) {
      this.releaseTrackVoices(track.id);
      this.disposeHolder(existing);
      this.instruments.delete(track.id);
    }

    const holder = this.createInstrumentHolder(track.id, track.instrument, outputNode);
    this.instruments.set(track.id, holder);
    this.outputNodes.set(track.id, outputNode);
  }

  public async ensureTrackSoundfontLoaded(
    track: TrackModel,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ResolvedInstrumentZones | null> {
    if (track.instrument.type !== 'soundfont') return null;
    const holder = this.instruments.get(track.id);
    if (!holder) return null;
    return this.loadSoundfontPresetForHolder(track.id, holder, track.instrument, onProgress);
  }

  public getTrackLoadedPresetInfo(trackId: string): { presetKey: string; zoneCount: number } | null {
    const holder = this.instruments.get(trackId);
    if (!holder?.loadedZones) return null;
    return {
      presetKey: holder.loadedZones.presetKey,
      zoneCount: holder.loadedZones.zones.length,
    };
  }

  private getSoundfontKey(config: InstrumentConfig): string {
    const p = config.params;
    return `${p.soundBankId ?? BUILTIN_BANK_ID}:${p.instrumentId ?? ''}:${p.bankNumber ?? 0}:${p.programNumber ?? 0}`;
  }

  private async loadSoundfontPresetForHolder(
    trackId: string,
    holder: TrackInstrumentHolder,
    config: InstrumentConfig,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ResolvedInstrumentZones | null> {
    const p = config.params;
    const key = this.getSoundfontKey(config);
    if (holder.soundfontKey === key && holder.loadedZones) {
      return holder.loadedZones;
    }

    const seq = (holder.soundfontLoadSeq ?? 0) + 1;
    holder.soundfontLoadSeq = seq;
    holder.soundfontKey = key;

    const rawCtx = Tone.getContext().rawContext as AudioContext;
    const bankId = p.soundBankId ?? BUILTIN_BANK_ID;
    const bank = p.bankNumber ?? 0;
    const program = p.programNumber ?? 0;

    let resolved: ResolvedInstrumentZones | null = null;
    if (bankId !== BUILTIN_BANK_ID) {
      resolved = await decodeSf2PresetZones(bankId, bank, program, rawCtx, undefined, undefined, onProgress);
      if (!resolved && this.soundBankLoader) {
        const ok = await this.soundBankLoader(bankId);
        if (ok) {
          resolved = await decodeSf2PresetZones(bankId, bank, program, rawCtx, undefined, undefined, onProgress);
        }
      }
    }

    if (!resolved) {
      const def = findBuiltinDefinition({
        instrumentId: p.instrumentId,
        bankNumber: bank,
        programNumber: program,
        midiChannel: p.midiChannel,
      });
      resolved = await decodeBuiltinPresetZones(def.id, rawCtx, onProgress);
    }

    if (holder.soundfontLoadSeq !== seq || this.instruments.get(trackId) !== holder) {
      return null;
    }

    holder.loadedZones = resolved;
    return resolved;
  }

  private createInstrumentHolder(
    trackId: string,
    config: InstrumentConfig,
    outputNode: Tone.ToneAudioNode
  ): TrackInstrumentHolder {
    const p = config.params;
    const isPiano = config.type === 'gesturePiano';
    const oscVolDb = Math.max(-24, Math.min(6, p.oscVolume ?? 0));
    const pitchSemitones = Math.max(-24, Math.min(24, p.pitchSemitones ?? 0));
    const pitchBendSemitones = Math.max(-12, Math.min(12, p.pitchBendSemitones ?? 0));
    const pitchBendRange = Math.max(1, Math.min(12, p.pitchBendRange ?? 2));
    const midiChannel = Math.max(1, Math.min(16, p.midiChannel ?? 1));
    const oscGain = new Tone.Gain(Tone.dbToGain(oscVolDb)).connect(outputNode);

    if (config.type === 'soundfont') {
      const chorusNode = new Tone.Chorus({
        frequency: 1.5,
        delayTime: 3.2,
        depth: 0.45,
        wet: Math.max(0, Math.min(1, p.chorus ?? 0)),
      }).connect(oscGain);
      try {
        chorusNode.start();
      } catch {
        // ignore if context is offline/unstarted
      }

      const filter = new Tone.Filter({
        frequency: Math.max(120, Math.min(16000, p.cutoff)),
        Q: Math.max(0.5, Math.min(12, p.resonance)),
        type: 'lowpass',
      }).connect(chorusNode);

      const polyGain = new Tone.Gain(1).connect(filter);
      const holder: TrackInstrumentHolder = {
        type: 'soundfont',
        filter,
        chorusNode,
        oscGain,
        polyGain,
        pitchSemitones,
        pitchBendSemitones,
        pitchBendRange,
        midiChannel,
        attackOverride: Math.max(0.001, p.attack),
        decayOverride: Math.max(0.05, p.decay),
        sustainOverride: Math.max(0, Math.min(1, p.sustain)),
        releaseOverride: Math.max(0.015, p.release),
        pitchMap: new Map(),
        sfVoices: [],
        maxPolyphony: MAX_SOUNDFONT_POLYPHONY,
      };
      void this.loadSoundfontPresetForHolder(trackId, holder, config);
      return holder;
    }

    const filter = new Tone.Filter({
      frequency: Math.max(120, Math.min(isPiano ? 9500 : 16000, p.cutoff)),
      Q: isPiano ? Math.max(0.5, Math.min(1.1, p.resonance)) : Math.max(0.5, Math.min(6, p.resonance)),
      type: 'lowpass',
    }).connect(oscGain);

    if (config.type === 'drumSynth') {
      const kick = [
        new Tone.MembraneSynth({
          pitchDecay: 0.045,
          octaves: 5.5,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: Math.max(0.1, p.decay), sustain: 0.01, release: 0.18 },
        }).connect(filter),
        new Tone.MembraneSynth({
          pitchDecay: 0.045,
          octaves: 5.5,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: Math.max(0.1, p.decay), sustain: 0.01, release: 0.18 },
        }).connect(filter),
      ];
      kick[0].volume.value = -5;
      kick[1].volume.value = -5;

      const snareFilter = new Tone.Filter(1900, 'bandpass').connect(filter);
      const snareNoise = [
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.04 },
        }).connect(snareFilter),
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.04 },
        }).connect(snareFilter),
      ];
      snareNoise[0].volume.value = -9;
      snareNoise[1].volume.value = -9;

      const snareBody = [
        new Tone.MembraneSynth({
          pitchDecay: 0.025,
          octaves: 2.2,
          envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.04 },
        }).connect(filter),
        new Tone.MembraneSynth({
          pitchDecay: 0.025,
          octaves: 2.2,
          envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.04 },
        }).connect(filter),
      ];
      snareBody[0].volume.value = -10;
      snareBody[1].volume.value = -10;

      const clapFilter = new Tone.Filter(1500, 'bandpass').connect(filter);
      const clapNoise = [
        new Tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: { attack: 0.003, decay: 0.17, sustain: 0, release: 0.05 },
        }).connect(clapFilter),
        new Tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: { attack: 0.003, decay: 0.17, sustain: 0, release: 0.05 },
        }).connect(clapFilter),
      ];
      clapNoise[0].volume.value = -8;
      clapNoise[1].volume.value = -8;

      const hatFilter = new Tone.Filter(7400, 'highpass').connect(filter);
      const hatClosed = [
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.042, sustain: 0, release: 0.01 },
        }).connect(hatFilter),
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.042, sustain: 0, release: 0.01 },
        }).connect(hatFilter),
      ];
      hatClosed[0].volume.value = -13;
      hatClosed[1].volume.value = -13;

      const openHatFilter = new Tone.Filter(6400, 'highpass').connect(filter);
      const hatOpen = [
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.06 },
        }).connect(openHatFilter),
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.06 },
        }).connect(openHatFilter),
      ];
      hatOpen[0].volume.value = -12;
      hatOpen[1].volume.value = -12;

      const rimSynth = [
        new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.002, decay: 0.045, sustain: 0, release: 0.02 },
        }).connect(filter),
        new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.002, decay: 0.045, sustain: 0, release: 0.02 },
        }).connect(filter),
      ];
      rimSynth[0].volume.value = -11;
      rimSynth[1].volume.value = -11;

      return {
        type: 'drumSynth',
        filter,
        oscGain,
        pitchSemitones,
        pitchBendSemitones,
        pitchBendRange,
        midiChannel,
        attackOverride: p.attack,
        decayOverride: p.decay,
        sustainOverride: p.sustain,
        releaseOverride: p.release,
        pitchMap: new Map(),
        drumKit: {
          kick,
          snareNoise,
          snareBody,
          clapNoise,
          hatClosed,
          hatOpen,
          rimSynth,
          filter,
          voiceIndex: {},
          lastHitTimes: new Map(),
        },
        maxPolyphony: 6,
      };
    }

    if (config.type === 'bassSynth') {
      const bassSynth = new Tone.MonoSynth({
        oscillator: { type: p.waveform },
        filter: { Q: Math.min(5, p.resonance), type: 'lowpass', rolloff: -24 },
        envelope: {
          attack: Math.max(0.004, p.attack),
          decay: p.decay,
          sustain: p.sustain,
          release: Math.max(0.05, p.release),
        },
        filterEnvelope: {
          attack: 0.008,
          decay: 0.18,
          sustain: 0.25,
          release: 0.14,
          baseFrequency: Math.max(60, p.cutoff * 0.22),
          octaves: 2.2,
        },
      }).connect(filter);
      bassSynth.volume.value = -8;

      return {
        type: 'bassSynth',
        filter,
        oscGain,
        pitchSemitones,
        pitchBendSemitones,
        pitchBendRange,
        midiChannel,
        attackOverride: p.attack,
        decayOverride: p.decay,
        sustainOverride: p.sustain,
        releaseOverride: p.release,
        pitchMap: new Map(),
        bassSynth,
        maxPolyphony: 1,
      };
    }

    if (config.type === 'sampler') {
      const polyGain = new Tone.Gain(1).connect(filter);
      const samplerPlayer = new Tone.Player().connect(polyGain);
      samplerPlayer.volume.value = -8;
      if (p.sampleAssetId && this.decodedAssets.has(p.sampleAssetId)) {
        samplerPlayer.buffer = new Tone.ToneAudioBuffer(this.decodedAssets.get(p.sampleAssetId)!);
      }
      const polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: {
          attack: Math.max(0.006, p.attack),
          decay: p.decay,
          sustain: p.sustain,
          release: Math.max(0.12, p.release),
        },
      }).connect(polyGain);
      polySynth.volume.value = -12;
      polySynth.maxPolyphony = 18;

      return {
        type: 'sampler',
        filter,
        oscGain,
        pitchSemitones,
        pitchBendSemitones,
        pitchBendRange,
        midiChannel,
        attackOverride: p.attack,
        decayOverride: p.decay,
        sustainOverride: p.sustain,
        releaseOverride: p.release,
        pitchMap: new Map(),
        polyGain,
        samplerPlayer,
        samplerBufferId: p.sampleAssetId,
        polySynth,
        maxPolyphony: 10,
      };
    }

    if (config.type === 'gesturePiano') {
      const preset = normalizePianoPreset(p.pianoPreset);
      const polyGain = new Tone.Gain(1).connect(filter);

      // Build multi-zone Tone.Sampler banks for Acoustic Piano (soft+forte) and Electric Piano
      const pianoBank = createPianoSamplerBank(polyGain);
      const safeRelease = Math.max(0.18, p.release);
      pianoBank.softSampler.release = safeRelease;
      pianoBank.forteSampler.release = safeRelease + 0.04;
      pianoBank.electricSampler.release = Math.max(0.16, safeRelease * 0.85);

      // Synth Piano engine: adjustable oscillator + ADSR with generous internal voice pool headroom (28)
      // so releasing tails never collide with new attacks inside Tone.PolySynth
      const safeAttack = Math.max(0.008, p.attack);
      const polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator:
          preset === 'synthPiano' && p.waveform !== 'triangle'
            ? { type: p.waveform }
            : { type: 'custom', partials: getPianoPartials(preset) },
        envelope: {
          attack: safeAttack,
          attackCurve: 'exponential',
          decay: Math.max(0.18, p.decay),
          sustain: Math.max(0.05, Math.min(0.85, p.sustain)),
          release: safeRelease,
          releaseCurve: 'exponential',
        },
      }).connect(polyGain);
      polySynth.volume.value = -12;
      polySynth.maxPolyphony = 28;

      return {
        type: 'gesturePiano',
        filter,
        oscGain,
        pitchSemitones,
        pitchBendSemitones,
        pitchBendRange,
        midiChannel,
        attackOverride: p.attack,
        decayOverride: p.decay,
        sustainOverride: p.sustain,
        releaseOverride: p.release,
        pitchMap: new Map(),
        polyGain,
        pianoBank,
        polySynth,
        pianoPreset: preset,
        synthWaveform: p.waveform,
        maxPolyphony: MAX_PIANO_POLYPHONY,
      };
    }

    const polyGain = new Tone.Gain(1).connect(filter);
    const polySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: p.waveform },
      envelope: {
        attack: Math.max(0.006, p.attack),
        decay: p.decay,
        sustain: p.sustain,
        release: Math.max(0.1, p.release),
      },
    }).connect(polyGain);
    polySynth.volume.value = -11;
    polySynth.maxPolyphony = 20;

    return {
      type: 'synth',
      filter,
      oscGain,
      pitchSemitones,
      pitchBendSemitones,
      pitchBendRange,
      midiChannel,
      attackOverride: p.attack,
      decayOverride: p.decay,
      sustainOverride: p.sustain,
      releaseOverride: p.release,
      pitchMap: new Map(),
      polyGain,
      polySynth,
      maxPolyphony: 12,
    };
  }

  private updateInstrumentParams(trackId: string, holder: TrackInstrumentHolder, config: InstrumentConfig): void {
    const p = config.params;
    const isPiano = holder.type === 'gesturePiano';

    const oscVolDb = Math.max(-24, Math.min(6, p.oscVolume ?? 0));
    holder.oscGain.gain.rampTo(Tone.dbToGain(oscVolDb), 0.025);
    holder.pitchSemitones = Math.max(-24, Math.min(24, p.pitchSemitones ?? 0));
    holder.pitchBendRange = Math.max(1, Math.min(12, p.pitchBendRange ?? 2));
    holder.midiChannel = Math.max(1, Math.min(16, p.midiChannel ?? 1));
    holder.attackOverride = Math.max(0.001, p.attack);
    holder.decayOverride = Math.max(0.05, p.decay);
    holder.sustainOverride = Math.max(0, Math.min(1, p.sustain));
    holder.releaseOverride = Math.max(0.015, p.release);

    const nextBend = Math.max(-12, Math.min(12, p.pitchBendSemitones ?? 0));
    if (Math.abs(nextBend - holder.pitchBendSemitones) > 0.001) {
      this.setPitchBend(trackId, nextBend);
    }

    if (holder.chorusNode) {
      holder.chorusNode.wet.rampTo(Math.max(0, Math.min(1, p.chorus ?? 0)), 0.03);
    }

    holder.filter.frequency.rampTo(
      Math.max(120, Math.min(isPiano ? 9500 : 16000, p.cutoff)),
      0.03
    );
    holder.filter.Q.rampTo(
      isPiano ? Math.max(0.5, Math.min(1.1, p.resonance)) : Math.max(0.5, Math.min(12, p.resonance)),
      0.03
    );

    if (holder.type === 'soundfont') {
      const nextKey = this.getSoundfontKey(config);
      if (nextKey !== holder.soundfontKey) {
        this.releaseTrackVoices(trackId);
        void this.loadSoundfontPresetForHolder(trackId, holder, config);
      }
      return;
    }

    if (holder.type === 'gesturePiano' && holder.polySynth) {
      const preset = normalizePianoPreset(p.pianoPreset);
      const safeAttack = Math.max(0.008, p.attack);
      const safeRelease = Math.max(0.18, p.release);

      if (holder.pianoBank) {
        holder.pianoBank.softSampler.release = safeRelease;
        holder.pianoBank.forteSampler.release = safeRelease + 0.04;
        holder.pianoBank.electricSampler.release = Math.max(0.16, safeRelease * 0.85);
      }

      const presetChanged = holder.pianoPreset !== preset;
      const waveformChanged = holder.synthWaveform !== p.waveform;

      if (presetChanged || waveformChanged) {
        holder.polySynth.set({
          oscillator:
            preset === 'synthPiano' && p.waveform !== 'triangle'
              ? { type: p.waveform }
              : { type: 'custom', partials: getPianoPartials(preset) },
          envelope: {
            attack: safeAttack,
            decay: Math.max(0.18, p.decay),
            sustain: Math.max(0.05, Math.min(0.85, p.sustain)),
            release: safeRelease,
          },
        });
        holder.pianoPreset = preset;
        holder.synthWaveform = p.waveform;
      } else {
        holder.polySynth.set({
          envelope: {
            attack: safeAttack,
            decay: Math.max(0.18, p.decay),
            sustain: Math.max(0.05, Math.min(0.85, p.sustain)),
            release: safeRelease,
          },
        });
      }
      return;
    }

    if (holder.polySynth) {
      holder.polySynth.set({
        oscillator: { type: p.waveform },
        envelope: {
          attack: Math.max(0.006, p.attack),
          decay: p.decay,
          sustain: p.sustain,
          release: Math.max(0.1, p.release),
        },
      });
    }
    if (holder.bassSynth) {
      holder.bassSynth.set({
        oscillator: { type: p.waveform },
        filter: { Q: Math.min(5, p.resonance) },
        envelope: {
          attack: Math.max(0.004, p.attack),
          decay: p.decay,
          sustain: p.sustain,
          release: Math.max(0.05, p.release),
        },
      });
    }
    if (holder.drumKit) {
      holder.drumKit.kick.forEach((k) => {
        k.envelope.decay = Math.max(0.1, p.decay);
      });
    }
    if (holder.samplerPlayer && p.sampleAssetId !== holder.samplerBufferId) {
      holder.samplerBufferId = p.sampleAssetId;
      if (p.sampleAssetId && this.decodedAssets.has(p.sampleAssetId)) {
        holder.samplerPlayer.buffer = new Tone.ToneAudioBuffer(this.decodedAssets.get(p.sampleAssetId)!);
      }
    }
  }

  private getOrCreateVoices(trackId: string): ActiveVoiceEntry[] {
    let list = this.trackVoices.get(trackId);
    if (!list) {
      list = [];
      this.trackVoices.set(trackId, list);
    }
    return list;
  }

  private updatePolyphonyTrim(trackId: string, holder: TrackInstrumentHolder): void {
    if (!holder.polyGain) return;
    const count =
      holder.type === 'soundfont'
        ? holder.sfVoices?.length ?? 0
        : this.trackVoices.get(trackId)?.length ?? 0;
    const target = computePolyphonyTrimGain(count);
    holder.polyGain.gain.rampTo(target, 0.025);
  }

  public setPitchBend(trackId: string, semitones: number): void {
    const holder = this.instruments.get(trackId);
    if (!holder) return;
    const clamped = Math.max(-12, Math.min(12, semitones));
    holder.pitchBendSemitones = clamped;
    const now = Tone.now();
    if (holder.sfVoices) {
      for (const v of holder.sfVoices) {
        if (v.scaleTuning > 0 || !v.isOneShotDrum) {
          try {
            const targetCents = v.baseDetuneCents + clamped * 100;
            const targetRate = Math.max(0.05, Math.min(16, Math.pow(2, targetCents / 1200)));
            v.source.playbackRate?.setTargetAtTime(targetRate, now, 0.01);
          } catch {
            // ignore
          }
        }
      }
    }
    if (holder.polySynth) {
      try {
        holder.polySynth.set({ detune: clamped * 100 });
      } catch {
        // ignore
      }
    }
    if (holder.bassSynth) {
      try {
        holder.bassSynth.detune.setTargetAtTime(clamped * 100, now, 0.01);
      } catch {
        // ignore
      }
    }
  }

  private selectMatchingSoundfontZones(
    zones: InstrumentSampleZone[],
    pitch: number,
    velMidi: number
  ): InstrumentSampleZone[] {
    let matches = zones.filter(
      (z) => pitch >= z.keyLow && pitch <= z.keyHigh && velMidi >= z.velLow && velMidi <= z.velHigh
    );
    if (matches.length === 0) {
      matches = zones.filter((z) => pitch >= z.keyLow && pitch <= z.keyHigh);
    }
    if (matches.length === 0 && zones.length > 0) {
      let best = zones[0];
      let bestDist = Infinity;
      for (const z of zones) {
        const mid = (z.keyLow + z.keyHigh) * 0.5;
        const d = Math.abs(mid - pitch);
        if (d < bestDist) {
          bestDist = d;
          best = z;
        }
      }
      matches = [best];
    }
    return matches.slice(0, 3);
  }

  private releaseSoundfontVoice(
    holder: TrackInstrumentHolder,
    voice: SoundfontActiveVoice,
    time: number,
    choke = false
  ): void {
    if (voice.cleanupTimer !== undefined) {
      window.clearTimeout(voice.cleanupTimer);
      voice.cleanupTimer = undefined;
    }
    const list = holder.sfVoices;
    if (list) {
      const idx = list.indexOf(voice);
      if (idx !== -1) list.splice(idx, 1);
    }
    const rel = choke ? 0.015 : Math.max(0.015, voice.releaseSec);
    try {
      voice.gainNode.gain.cancelScheduledValues(time);
      voice.gainNode.gain.setTargetAtTime(0, time, Math.max(0.004, rel / 3.5));
      voice.source.stop(time + rel + 0.04);
    } catch {
      // ignore if already stopped
    }
    voice.cleanupTimer = window.setTimeout(() => {
      try {
        voice.source.disconnect();
        voice.filterNode.disconnect();
        voice.pannerNode.disconnect();
        voice.gainNode.disconnect();
      } catch {
        // ignore
      }
    }, Math.ceil((rel + 0.12) * 1000));
  }

  private spawnSoundfontVoices(
    trackId: string,
    holder: TrackInstrumentHolder,
    rawPitch: number,
    velocityNorm: number,
    time: number,
    durationSec?: number,
    expr?: MidiExpressionOptions
  ): void {
    if (!holder.loadedZones || !holder.polyGain) {
      return;
    }

    const isDrum =
      holder.loadedZones.isDrumKit ||
      holder.midiChannel === 10 ||
      expr?.channel === 10;

    const targetPitch = isDrum
      ? Math.max(0, Math.min(127, Math.round(rawPitch)))
      : Math.max(12, Math.min(120, Math.round(rawPitch + holder.pitchSemitones)));

    const velMidi = Math.max(1, Math.min(127, Math.round(velocityNorm * 127)));
    const zones = this.selectMatchingSoundfontZones(holder.loadedZones.zones, targetPitch, velMidi);
    if (zones.length === 0) return;

    const sfVoices = holder.sfVoices ?? (holder.sfVoices = []);
    const ctx = Tone.getContext();
    const naturalGain = mapVelocityToNaturalGain(velocityNorm);
    const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();

    for (const zone of zones) {
      if (zone.exclusiveClass > 0) {
        for (let i = sfVoices.length - 1; i >= 0; i--) {
          if (sfVoices[i].exclusiveClass === zone.exclusiveClass) {
            this.releaseSoundfontVoice(holder, sfVoices[i], time, true);
          }
        }
      }

      while (sfVoices.length >= holder.maxPolyphony) {
        let stealIdx = sfVoices.findIndex((v) => !v.held);
        if (stealIdx === -1) stealIdx = 0;
        this.releaseSoundfontVoice(holder, sfVoices[stealIdx], time, true);
      }

      const source = ctx.createBufferSource();
      const filterNode = ctx.createBiquadFilter();
      const pannerNode = ctx.createStereoPanner();
      const gainNode = ctx.createGain();
      if (
        !source?.playbackRate ||
        !filterNode?.frequency ||
        !pannerNode?.pan ||
        !gainNode?.gain
      ) {
        return;
      }

      source.buffer = zone.buffer;
      source.loop = zone.loop;
      if (zone.loop && zone.loopEndSec > zone.loopStartSec + 0.005) {
        source.loopStart = zone.loopStartSec;
        source.loopEnd = zone.loopEndSec;
      }

      const baseDetuneCents =
        (targetPitch - zone.rootMidi) * zone.scaleTuning +
        zone.coarseTune * 100 +
        zone.fineTune;

      const initialRate = Math.max(
        0.05,
        Math.min(16, Math.pow(2, (baseDetuneCents + holder.pitchBendSemitones * 100) / 1200))
      );
      source.playbackRate.setValueAtTime(initialRate, time);

      if (expr?.pitchSlide && expr.pitchSlide.length > 0 && !isDrum) {
        const secPerBeat = expr.beatDurationSec ?? 0.5;
        const sortedSlides = [...expr.pitchSlide].sort((a, b) => a.beatOffset - b.beatOffset);
        for (const pt of sortedSlides) {
          const tPoint = time + Math.max(0.004, pt.beatOffset * secPerBeat);
          const slideRate = Math.max(
            0.05,
            Math.min(
              16,
              Math.pow(2, (baseDetuneCents + (holder.pitchBendSemitones + pt.semitones) * 100) / 1200)
            )
          );
          source.playbackRate.exponentialRampToValueAtTime(slideRate, tPoint);
        }
      }

      filterNode.type = 'lowpass';
      const baseCutoff = Math.max(
        180,
        Math.min(18000, Math.min(zone.filterCutoffHz, Number(holder.filter.frequency.value) || 14000))
      );
      filterNode.frequency.setValueAtTime(baseCutoff, time);
      filterNode.Q.setValueAtTime(Math.max(0.5, Math.min(8, zone.filterQ)), time);

      if (expr?.mpe?.timbre && expr.mpe.timbre.length > 0) {
        const secPerBeat = expr.beatDurationSec ?? 0.5;
        const sortedTimbre = [...expr.mpe.timbre].sort((a, b) => a.beatOffset - b.beatOffset);
        for (const pt of sortedTimbre) {
          const norm = Math.max(0, Math.min(1, pt.value / 127));
          const hz = 320 * Math.pow(16000 / 320, norm);
          filterNode.frequency.linearRampToValueAtTime(
            hz,
            time + Math.max(0.004, pt.beatOffset * secPerBeat)
          );
        }
      }

      pannerNode.pan.setValueAtTime(Math.max(-1, Math.min(1, zone.pan)), time);
      const peakGain = Math.max(0.01, (naturalGain * zone.gain * 0.9) / Math.sqrt(zones.length));
      const isOneShotDrum = isDrum && !zone.loop;
      const attack = isOneShotDrum ? 0.001 : Math.max(0.001, holder.attackOverride);
      const decay = isOneShotDrum ? Math.max(0.15, zone.decaySec) : Math.max(0.04, holder.decayOverride);
      const sustain = isOneShotDrum ? 1.0 : Math.max(0.02, Math.min(1.0, holder.sustainOverride));
      const release = isOneShotDrum ? 0.16 : Math.max(0.015, holder.releaseOverride);
      const sustainLevel = Math.max(0.0001, peakGain * sustain);

      gainNode.gain.setValueAtTime(0.0001, time);
      gainNode.gain.linearRampToValueAtTime(peakGain, time + attack);
      if (!isOneShotDrum) {
        gainNode.gain.linearRampToValueAtTime(sustainLevel, time + attack + decay);
      }

      if (expr?.mpe?.pressure && expr.mpe.pressure.length > 0 && !isOneShotDrum) {
        const secPerBeat = expr.beatDurationSec ?? 0.5;
        const sortedPress = [...expr.mpe.pressure].sort((a, b) => a.beatOffset - b.beatOffset);
        for (const pt of sortedPress) {
          const pressScale = 0.4 + 0.95 * Math.max(0, Math.min(1, pt.value / 127));
          gainNode.gain.linearRampToValueAtTime(
            Math.max(0.0001, Math.min(1.0, sustainLevel * pressScale)),
            time + Math.max(0.006, pt.beatOffset * secPerBeat)
          );
        }
      }

      source.connect(filterNode);
      filterNode.connect(pannerNode);
      pannerNode.connect(gainNode);
      Tone.connect(gainNode, holder.polyGain);

      const voice: SoundfontActiveVoice = {
        id: this.nextSfVoiceId++,
        pitch: targetPitch,
        rawPitch,
        channel: expr?.channel ?? holder.midiChannel,
        source,
        gainNode,
        filterNode,
        pannerNode,
        baseDetuneCents,
        scaleTuning: zone.scaleTuning,
        held: durationSec === undefined,
        sustained: false,
        releaseSec: release,
        exclusiveClass: zone.exclusiveClass,
        loop: zone.loop,
        isOneShotDrum,
        startedAt: nowPerf,
      };
      sfVoices.push(voice);

      source.start(time);

      if (durationSec !== undefined) {
        const holdDur = isOneShotDrum
          ? Math.max(durationSec, Math.min(zone.buffer.duration, 1.8))
          : Math.max(0.04, durationSec);
        const offTime = time + holdDur;
        const totalStopDelayMs = Math.ceil((Math.max(0, offTime - ctx.now()) + release + 0.14) * 1000);
        if (!isOneShotDrum) {
          gainNode.gain.setTargetAtTime(0, offTime, Math.max(0.006, release / 3.5));
          source.stop(offTime + release + 0.05);
        } else {
          source.stop(time + Math.min(zone.buffer.duration, holdDur + 0.08));
        }
        voice.cleanupTimer = window.setTimeout(() => {
          const idx = sfVoices.indexOf(voice);
          if (idx !== -1) sfVoices.splice(idx, 1);
          try {
            source.disconnect();
            filterNode.disconnect();
            pannerNode.disconnect();
            gainNode.disconnect();
          } catch {
            // ignore
          }
          this.updatePolyphonyTrim(trackId, holder);
        }, Math.max(120, totalStopDelayMs));
      } else if (!zone.loop) {
        const autoEndMs = Math.ceil((zone.buffer.duration + 0.15) * 1000);
        voice.cleanupTimer = window.setTimeout(() => {
          const idx = sfVoices.indexOf(voice);
          if (idx !== -1) sfVoices.splice(idx, 1);
          try {
            source.disconnect();
            filterNode.disconnect();
            pannerNode.disconnect();
            gainNode.disconnect();
          } catch {
            // ignore
          }
          this.updatePolyphonyTrim(trackId, holder);
        }, autoEndMs);
      }
    }

    this.updatePolyphonyTrim(trackId, holder);
  }

  private triggerPitchOnHolder(
    holder: TrackInstrumentHolder,
    noteName: string,
    time: number,
    velNorm: number
  ): void {
    const naturalGain = mapVelocityToNaturalGain(velNorm);

    if (holder.type === 'gesturePiano' && holder.pianoBank) {
      const preset = holder.pianoPreset ?? 'acousticPiano';
      if (preset === 'acousticPiano') {
        const { softGain, forteGain } = computeAcousticLayerWeights(velNorm, naturalGain);
        if (softGain > 0.01) {
          holder.pianoBank.softSampler.triggerAttack(noteName, time, softGain);
        }
        if (forteGain > 0.01) {
          holder.pianoBank.forteSampler.triggerAttack(noteName, time, forteGain);
        }
        return;
      }
      if (preset === 'electricPiano') {
        holder.pianoBank.electricSampler.triggerAttack(noteName, time, naturalGain);
        return;
      }
    }

    holder.polySynth?.triggerAttack(noteName, time, naturalGain);
  }

  private releasePitchOnHolder(
    holder: TrackInstrumentHolder,
    pitch: number,
    time: number
  ): void {
    const noteName = midiToNoteName(pitch);
    if (holder.type === 'gesturePiano' && holder.pianoBank) {
      holder.pianoBank.softSampler.triggerRelease(noteName, time);
      holder.pianoBank.forteSampler.triggerRelease(noteName, time);
      holder.pianoBank.electricSampler.triggerRelease(noteName, time);
    }
    holder.polySynth?.triggerRelease(noteName, time);
  }

  public applyFilterCutoff(trackId: string, cutoffHz: number): void {
    const holder = this.instruments.get(trackId);
    if (!holder) return;
    holder.filter.frequency.rampTo(Math.max(120, Math.min(16000, cutoffHz)), 0.04);
  }

  public triggerMidiNote(
    trackId: string,
    pitch: number,
    durationSec: number,
    time: number,
    velocityNorm: number,
    expression?: MidiExpressionOptions
  ): void {
    const holder = this.instruments.get(trackId);
    if (!holder) return;
    const naturalGain = mapVelocityToNaturalGain(velocityNorm);
    const safeDur = Math.max(0.05, durationSec);
    const safeTime = Math.max(Tone.now(), time);

    if (holder.type === 'soundfont') {
      this.spawnSoundfontVoices(trackId, holder, pitch, velocityNorm, safeTime, safeDur, expression);
      return;
    }

    if (holder.type === 'drumSynth' && holder.drumKit) {
      this.triggerDrumHit(holder.drumKit, pitch, safeTime, naturalGain);
      return;
    }

    const shiftedPitch = Math.max(21, Math.min(108, Math.round(pitch + holder.pitchSemitones)));

    if (holder.type === 'sampler' && holder.samplerPlayer && holder.samplerPlayer.loaded) {
      const semitones = shiftedPitch - 60;
      holder.samplerPlayer.playbackRate = Math.pow(2, semitones / 12);
      holder.samplerPlayer.start(
        safeTime,
        0,
        Math.min(safeDur + 0.25, holder.samplerPlayer.buffer.duration)
      );
      return;
    }

    const noteName = midiToNoteName(shiftedPitch);
    if (holder.bassSynth) {
      holder.bassSynth.triggerAttackRelease(noteName, safeDur, safeTime, naturalGain);
    } else if (holder.type === 'gesturePiano' && holder.pianoBank) {
      const preset = holder.pianoPreset ?? 'acousticPiano';
      if (preset === 'acousticPiano') {
        const { softGain, forteGain } = computeAcousticLayerWeights(velocityNorm, naturalGain);
        if (softGain > 0.01) {
          holder.pianoBank.softSampler.triggerAttackRelease(noteName, safeDur, safeTime, softGain);
        }
        if (forteGain > 0.01) {
          holder.pianoBank.forteSampler.triggerAttackRelease(noteName, safeDur, safeTime, forteGain);
        }
      } else if (preset === 'electricPiano') {
        holder.pianoBank.electricSampler.triggerAttackRelease(noteName, safeDur, safeTime, naturalGain);
      } else {
        holder.polySynth?.triggerAttackRelease(noteName, safeDur, safeTime, naturalGain);
      }
    } else if (holder.polySynth) {
      holder.polySynth.triggerAttackRelease(noteName, safeDur, safeTime, naturalGain);
    }
  }

  public noteOn(
    trackId: string,
    pitch: number,
    velocityNorm: number,
    time: number = Tone.immediate(),
    expression?: MidiExpressionOptions
  ): void {
    const holder = this.instruments.get(trackId);
    if (!holder) return;

    const rawPitch = Math.max(21, Math.min(108, Math.round(pitch)));
    const safePitch = Math.max(21, Math.min(108, Math.round(rawPitch + holder.pitchSemitones)));
    holder.pitchMap.set(rawPitch, safePitch);
    const safeTime = Math.max(Tone.now(), time);

    if (holder.type === 'soundfont') {
      const sfVoices = holder.sfVoices ?? [];
      for (let i = sfVoices.length - 1; i >= 0; i--) {
        const v = sfVoices[i];
        if (v.rawPitch === rawPitch) {
          if (v.held) return;
          this.releaseSoundfontVoice(holder, v, safeTime, true);
        }
      }
      this.spawnSoundfontVoices(
        trackId,
        holder,
        rawPitch,
        velocityNorm,
        safeTime,
        undefined,
        expression
      );
      return;
    }

    if (holder.type === 'drumSynth' && holder.drumKit) {
      this.triggerDrumHit(holder.drumKit, rawPitch, safeTime, mapVelocityToNaturalGain(velocityNorm));
      return;
    }

    if (holder.type === 'sampler' && holder.samplerPlayer && holder.samplerPlayer.loaded) {
      const semitones = safePitch - 60;
      holder.samplerPlayer.playbackRate = Math.pow(2, semitones / 12);
      holder.samplerPlayer.start(safeTime, 0, holder.samplerPlayer.buffer.duration);
      return;
    }

    const voices = this.getOrCreateVoices(trackId);
    const noteName = midiToNoteName(safePitch);

    if (holder.polySynth || holder.pianoBank) {
      const existingIdx = voices.findIndex((v) => v.pitch === safePitch);
      if (existingIdx !== -1) {
        const existing = voices[existingIdx];
        if (existing.held) {
          return;
        }
        voices.splice(existingIdx, 1);
        this.releasePitchOnHolder(holder, safePitch, safeTime);
      }

      let stolen = false;
      while (voices.length >= holder.maxPolyphony) {
        let stealIdx = voices.findIndex((v) => !v.held);
        if (stealIdx === -1) stealIdx = 0;
        const [removed] = voices.splice(stealIdx, 1);
        this.releasePitchOnHolder(holder, removed.pitch, safeTime);
        stolen = true;
      }

      const attackTime = existingIdx !== -1 || stolen ? safeTime + 0.004 : safeTime;
      voices.push({
        pitch: safePitch,
        held: true,
        sustained: false,
        startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      });

      this.updatePolyphonyTrim(trackId, holder);
      this.triggerPitchOnHolder(holder, noteName, attackTime, velocityNorm);
      return;
    }

    if (holder.bassSynth) {
      const existingIdx = voices.findIndex((v) => v.pitch === safePitch);
      if (existingIdx === -1) {
        voices.length = 0;
        voices.push({
          pitch: safePitch,
          held: true,
          sustained: false,
          startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        });
      }
      holder.bassSynth.triggerAttack(noteName, safeTime, mapVelocityToNaturalGain(velocityNorm));
    }
  }

  public noteOff(trackId: string, pitch: number, time: number = Tone.immediate()): void {
    const holder = this.instruments.get(trackId);
    if (!holder) return;

    const rawPitch = Math.max(21, Math.min(108, Math.round(pitch)));
    const safePitch = holder.pitchMap.get(rawPitch) ?? Math.max(21, Math.min(108, Math.round(rawPitch + holder.pitchSemitones)));
    holder.pitchMap.delete(rawPitch);
    const safeTime = Math.max(Tone.now(), time);

    if (holder.type === 'soundfont') {
      const sfVoices = holder.sfVoices;
      if (!sfVoices || sfVoices.length === 0) return;
      const sustainOn = Boolean(this.sustainPedalState.get(trackId));
      for (let i = sfVoices.length - 1; i >= 0; i--) {
        const v = sfVoices[i];
        if (v.rawPitch !== rawPitch) continue;
        if (v.isOneShotDrum) {
          v.held = false;
          continue;
        }
        if (sustainOn) {
          v.held = false;
          v.sustained = true;
        } else {
          this.releaseSoundfontVoice(holder, v, safeTime);
        }
      }
      this.updatePolyphonyTrim(trackId, holder);
      return;
    }

    const voices = this.trackVoices.get(trackId);
    if (!voices || voices.length === 0) return;

    const idx = voices.findIndex((v) => v.pitch === safePitch);
    if (idx === -1) return;

    if (this.sustainPedalState.get(trackId)) {
      voices[idx].held = false;
      voices[idx].sustained = true;
      return;
    }

    voices.splice(idx, 1);

    if (holder.polySynth || holder.pianoBank) {
      this.releasePitchOnHolder(holder, safePitch, safeTime);
      this.updatePolyphonyTrim(trackId, holder);
    } else if (holder.bassSynth && voices.length === 0) {
      holder.bassSynth.triggerRelease(safeTime);
    }
  }

  public setSustain(trackId: string, active: boolean): void {
    this.sustainPedalState.set(trackId, active);
    if (active) return;

    const holder = this.instruments.get(trackId);
    if (!holder) return;
    const now = Tone.now() + 0.002;

    if (holder.type === 'soundfont' && holder.sfVoices) {
      for (let i = holder.sfVoices.length - 1; i >= 0; i--) {
        const v = holder.sfVoices[i];
        if (!v.held && v.sustained) {
          this.releaseSoundfontVoice(holder, v, now);
        }
      }
      this.updatePolyphonyTrim(trackId, holder);
      return;
    }

    const voices = this.trackVoices.get(trackId);
    if (!voices) return;

    const keep: ActiveVoiceEntry[] = [];
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (!v.held && v.sustained) {
        this.releasePitchOnHolder(holder, v.pitch, now);
      } else {
        keep.push(v);
      }
    }
    this.trackVoices.set(trackId, keep);
    this.updatePolyphonyTrim(trackId, holder);
  }

  public getActiveVoiceCount(): number {
    let total = 0;
    for (const voices of this.trackVoices.values()) {
      total += voices.length;
    }
    for (const holder of this.instruments.values()) {
      total += holder.sfVoices?.length ?? 0;
    }
    return total;
  }

  public getTrackActiveVoiceCount(trackId: string): number {
    const holder = this.instruments.get(trackId);
    if (holder?.type === 'soundfont') {
      return holder.sfVoices?.length ?? 0;
    }
    return this.trackVoices.get(trackId)?.length ?? 0;
  }

  private triggerDrumHit(kit: DrumKitNodes, pitch: number, time: number, vel: number): void {
    const triggerWithVoice = <T>(
      synths: T[],
      key: string,
      fn: (synth: T, safeTime: number) => void
    ) => {
      const idx = ((kit.voiceIndex[key] ?? 0) + 1) % synths.length;
      kit.voiceIndex[key] = idx;
      const voiceKey = `${key}:${idx}`;
      const last = kit.lastHitTimes.get(voiceKey) ?? 0;
      const safeTime = Math.max(time, last + 0.003);
      kit.lastHitTimes.set(voiceKey, safeTime);
      try {
        fn(synths[idx], safeTime);
      } catch {
        // Guard against any internal audio scheduler collisions
      }
    };

    if (pitch === 36) {
      triggerWithVoice(kit.kick, 'kick', (node, t) => {
        node.triggerAttackRelease('C1', '8n', t, vel);
      });
    } else if (pitch === 38) {
      triggerWithVoice(kit.snareNoise, 'snareNoise', (node, t) => {
        node.triggerAttackRelease('16n', t, vel);
      });
      triggerWithVoice(kit.snareBody, 'snareBody', (node, t) => {
        node.triggerAttackRelease('D3', '16n', t, vel * 0.85);
      });
    } else if (pitch === 39) {
      triggerWithVoice(kit.clapNoise, 'clap', (node, t) => {
        node.triggerAttackRelease('16n', t, vel);
      });
    } else if (pitch === 37) {
      triggerWithVoice(kit.rimSynth, 'rim', (node, t) => {
        node.triggerAttackRelease('G4', '32n', t, vel * 0.8);
      });
    } else if (pitch === 46) {
      triggerWithVoice(kit.hatOpen, 'hatOpen', (node, t) => {
        node.triggerAttackRelease('8n', t, vel * 0.78);
      });
    } else {
      triggerWithVoice(kit.hatClosed, 'hatClosed', (node, t) => {
        node.triggerAttackRelease('32n', t, vel * 0.7);
      });
    }
  }

  public releaseTrackVoices(trackId: string): void {
    const holder = this.instruments.get(trackId);
    this.trackVoices.set(trackId, []);
    if (!holder) return;
    if (holder.sfVoices) {
      const now = Tone.now();
      for (const v of [...holder.sfVoices]) {
        this.releaseSoundfontVoice(holder, v, now, true);
      }
    }
    holder.pianoBank?.softSampler.releaseAll();
    holder.pianoBank?.forteSampler.releaseAll();
    holder.pianoBank?.electricSampler.releaseAll();
    holder.polySynth?.releaseAll();
    this.updatePolyphonyTrim(trackId, holder);
    try {
      holder.bassSynth?.triggerRelease();
    } catch {
      // ignore
    }
  }

  public releaseAllVoices(): void {
    this.trackVoices.clear();
    const now = Tone.now();
    for (const holder of this.instruments.values()) {
      if (holder.sfVoices) {
        for (const v of [...holder.sfVoices]) {
          this.releaseSoundfontVoice(holder, v, now, true);
        }
      }
      holder.pianoBank?.softSampler.releaseAll();
      holder.pianoBank?.forteSampler.releaseAll();
      holder.pianoBank?.electricSampler.releaseAll();
      holder.polySynth?.releaseAll();
      holder.polyGain?.gain.rampTo(1.0, 0.02);
      try {
        holder.bassSynth?.triggerRelease();
      } catch {
        // ignore
      }
    }
  }

  public removeTrack(trackId: string): void {
    this.releaseTrackVoices(trackId);
    this.trackVoices.delete(trackId);
    this.sustainPedalState.delete(trackId);
    this.outputNodes.delete(trackId);
    const holder = this.instruments.get(trackId);
    if (!holder) return;
    this.disposeHolder(holder);
    this.instruments.delete(trackId);
  }

  private disposeHolder(holder: TrackInstrumentHolder): void {
    if (holder.sfVoices) {
      const now = Tone.now();
      for (const v of [...holder.sfVoices]) {
        this.releaseSoundfontVoice(holder, v, now, true);
      }
    }
    holder.pianoBank?.softSampler.dispose();
    holder.pianoBank?.forteSampler.dispose();
    holder.pianoBank?.electricSampler.dispose();
    holder.polySynth?.dispose();
    holder.polyGain?.dispose();
    holder.bassSynth?.dispose();
    holder.samplerPlayer?.dispose();
    if (holder.drumKit) {
      holder.drumKit.kick.forEach((k) => k.dispose());
      holder.drumKit.snareNoise.forEach((s) => s.dispose());
      holder.drumKit.snareBody.forEach((s) => s.dispose());
      holder.drumKit.clapNoise.forEach((c) => c.dispose());
      holder.drumKit.hatClosed.forEach((h) => h.dispose());
      holder.drumKit.hatOpen.forEach((h) => h.dispose());
      holder.drumKit.rimSynth.forEach((r) => r.dispose());
    }
    holder.chorusNode?.dispose();
    holder.filter.dispose();
    holder.oscGain.dispose();
  }
}
