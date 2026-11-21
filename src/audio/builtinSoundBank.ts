import { InstrumentCatalogEntry, InstrumentCategory } from '../types/daw';
import { synthesizePianoZonePcm } from './pianoSampleBank';
import { InstrumentSampleZone, ResolvedInstrumentZones } from './soundfontTypes';

export const BUILTIN_BANK_ID = 'builtin';
export const BUILTIN_BANK_NAME = 'PulseGrid Studio Library';

interface BuiltinPresetDefinition {
  id: string;
  name: string;
  category: InstrumentCategory;
  description: string;
  bank: number;
  program: number;
  midiChannel: number;
  isDrumKit: boolean;
  defaultPitch: number;
  defaultAttack: number;
  defaultDecay: number;
  defaultSustain: number;
  defaultRelease: number;
  defaultCutoff: number;
  defaultResonance: number;
  defaultChorus: number;
  defaultReverb: number;
}

export const BUILTIN_INSTRUMENTS: BuiltinPresetDefinition[] = [
  // KEYBOARD
  {
    id: 'kb-acoustic-grand',
    name: 'Acoustic Grand Piano',
    category: 'Keyboard',
    description: 'Multi-sampled dual-velocity concert grand piano with natural hammer resonance',
    bank: 0,
    program: 0,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.004,
    defaultDecay: 0.8,
    defaultSustain: 0.25,
    defaultRelease: 0.55,
    defaultCutoff: 9500,
    defaultResonance: 0.7,
    defaultChorus: 0,
    defaultReverb: 0.14,
  },
  {
    id: 'kb-bright-piano',
    name: 'Bright Piano',
    category: 'Keyboard',
    description: 'Crisp studio bright grand with accentuated upper harmonics and fast attack',
    bank: 0,
    program: 1,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.002,
    defaultDecay: 0.7,
    defaultSustain: 0.22,
    defaultRelease: 0.48,
    defaultCutoff: 12000,
    defaultResonance: 0.8,
    defaultChorus: 0.08,
    defaultReverb: 0.12,
  },
  {
    id: 'kb-electric-piano',
    name: 'Electric Piano',
    category: 'Keyboard',
    description: 'Bell-tine FM electric piano with warm midrange body',
    bank: 0,
    program: 4,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.005,
    defaultDecay: 0.68,
    defaultSustain: 0.3,
    defaultRelease: 0.45,
    defaultCutoff: 7800,
    defaultResonance: 0.7,
    defaultChorus: 0.22,
    defaultReverb: 0.18,
  },
  {
    id: 'kb-rhodes-ep',
    name: 'Rhodes Electric Piano',
    category: 'Keyboard',
    description: 'Classic suitcase tine EP with gentle reed bark and stereo chorus shimmer',
    bank: 0,
    program: 5,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.006,
    defaultDecay: 0.75,
    defaultSustain: 0.36,
    defaultRelease: 0.5,
    defaultCutoff: 6400,
    defaultResonance: 0.75,
    defaultChorus: 0.28,
    defaultReverb: 0.2,
  },
  {
    id: 'kb-organ',
    name: 'Organ',
    category: 'Keyboard',
    description: 'Tonewheel drawbar organ with key-click transient and infinite looped sustain',
    bank: 0,
    program: 16,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.005,
    defaultDecay: 0.15,
    defaultSustain: 0.95,
    defaultRelease: 0.16,
    defaultCutoff: 8500,
    defaultResonance: 0.7,
    defaultChorus: 0.35,
    defaultReverb: 0.18,
  },

  // STRINGS
  {
    id: 'str-violin',
    name: 'Violin',
    category: 'Strings',
    description: 'Expressive solo bowed violin with vibrato warmth and looped sustain',
    bank: 0,
    program: 40,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 69,
    defaultAttack: 0.075,
    defaultDecay: 0.3,
    defaultSustain: 0.9,
    defaultRelease: 0.35,
    defaultCutoff: 9000,
    defaultResonance: 0.8,
    defaultChorus: 0.15,
    defaultReverb: 0.26,
  },
  {
    id: 'str-viola',
    name: 'Viola',
    category: 'Strings',
    description: 'Warm alto solo viola with rich wooden formant resonance',
    bank: 0,
    program: 41,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.085,
    defaultDecay: 0.32,
    defaultSustain: 0.9,
    defaultRelease: 0.38,
    defaultCutoff: 7400,
    defaultResonance: 0.8,
    defaultChorus: 0.15,
    defaultReverb: 0.26,
  },
  {
    id: 'str-cello',
    name: 'Cello',
    category: 'Strings',
    description: 'Deep lyrical cello with warm low-mid resonance and bow texture',
    bank: 0,
    program: 42,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 48,
    defaultAttack: 0.095,
    defaultDecay: 0.35,
    defaultSustain: 0.92,
    defaultRelease: 0.42,
    defaultCutoff: 6200,
    defaultResonance: 0.85,
    defaultChorus: 0.12,
    defaultReverb: 0.24,
  },
  {
    id: 'str-ensemble',
    name: 'Ensemble Strings',
    category: 'Strings',
    description: 'Lush symphonic string section with stereo detune and slow cinematic swell',
    bank: 0,
    program: 48,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.14,
    defaultDecay: 0.45,
    defaultSustain: 0.94,
    defaultRelease: 0.65,
    defaultCutoff: 8800,
    defaultResonance: 0.75,
    defaultChorus: 0.34,
    defaultReverb: 0.32,
  },

  // BASS
  {
    id: 'bas-electric',
    name: 'Electric Bass',
    category: 'Bass',
    description: 'Punchy fingered electric bass guitar with round low-end body',
    bank: 0,
    program: 33,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 40,
    defaultAttack: 0.004,
    defaultDecay: 0.42,
    defaultSustain: 0.45,
    defaultRelease: 0.18,
    defaultCutoff: 4200,
    defaultResonance: 1.1,
    defaultChorus: 0,
    defaultReverb: 0.04,
  },
  {
    id: 'bas-acoustic',
    name: 'Acoustic Bass',
    category: 'Bass',
    description: 'Plucked upright acoustic double bass with woody finger attack',
    bank: 0,
    program: 32,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 36,
    defaultAttack: 0.006,
    defaultDecay: 0.48,
    defaultSustain: 0.28,
    defaultRelease: 0.22,
    defaultCutoff: 3400,
    defaultResonance: 0.9,
    defaultChorus: 0,
    defaultReverb: 0.08,
  },
  {
    id: 'bas-synth',
    name: 'Synth Bass',
    category: 'Bass',
    description: 'Fat detuned analog saw + sub oscillator bass with resonant bite',
    bank: 0,
    program: 38,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 36,
    defaultAttack: 0.004,
    defaultDecay: 0.28,
    defaultSustain: 0.68,
    defaultRelease: 0.16,
    defaultCutoff: 3200,
    defaultResonance: 2.2,
    defaultChorus: 0.08,
    defaultReverb: 0.05,
  },

  // DRUMS
  {
    id: 'drm-standard',
    name: 'Standard Drum Kit',
    category: 'Drums',
    description: 'Acoustic studio drum kit mapped across GM notes (Kick, Snare, Toms, Hats, Cymbals)',
    bank: 128,
    program: 0,
    midiChannel: 10,
    isDrumKit: true,
    defaultPitch: 36,
    defaultAttack: 0.001,
    defaultDecay: 0.45,
    defaultSustain: 0.1,
    defaultRelease: 0.22,
    defaultCutoff: 14000,
    defaultResonance: 0.7,
    defaultChorus: 0,
    defaultReverb: 0.1,
  },
  {
    id: 'drm-electronic',
    name: 'Electronic Drum Kit',
    category: 'Drums',
    description: '808/909 club drum machine kit with sub kick, snappy clap, and crisp metallic hats',
    bank: 128,
    program: 25,
    midiChannel: 10,
    isDrumKit: true,
    defaultPitch: 36,
    defaultAttack: 0.001,
    defaultDecay: 0.4,
    defaultSustain: 0.08,
    defaultRelease: 0.18,
    defaultCutoff: 14500,
    defaultResonance: 0.8,
    defaultChorus: 0,
    defaultReverb: 0.08,
  },
  {
    id: 'drm-percussion',
    name: 'Percussion',
    category: 'Drums',
    description: 'World & studio percussion kit (Congas, Bongos, Shaker, Claves, Timbale, Cowbell)',
    bank: 128,
    program: 48,
    midiChannel: 10,
    isDrumKit: true,
    defaultPitch: 60,
    defaultAttack: 0.001,
    defaultDecay: 0.35,
    defaultSustain: 0.08,
    defaultRelease: 0.2,
    defaultCutoff: 13500,
    defaultResonance: 0.75,
    defaultChorus: 0,
    defaultReverb: 0.16,
  },

  // SYNTH
  {
    id: 'syn-lead',
    name: 'Lead',
    category: 'Synth',
    description: 'Bold unison saw/square synth lead with looped sustain for soaring melodies',
    bank: 0,
    program: 81,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.008,
    defaultDecay: 0.25,
    defaultSustain: 0.85,
    defaultRelease: 0.24,
    defaultCutoff: 9500,
    defaultResonance: 1.4,
    defaultChorus: 0.24,
    defaultReverb: 0.2,
  },
  {
    id: 'syn-pad',
    name: 'Pad',
    category: 'Synth',
    description: 'Lush evolving polyphonic synth pad with slow attack and wide stereo shimmer',
    bank: 0,
    program: 89,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.2,
    defaultDecay: 0.55,
    defaultSustain: 0.92,
    defaultRelease: 0.9,
    defaultCutoff: 6800,
    defaultResonance: 1.0,
    defaultChorus: 0.45,
    defaultReverb: 0.35,
  },
  {
    id: 'syn-pluck',
    name: 'Pluck',
    category: 'Synth',
    description: 'Crisp percussive FM & harmonic mallet pluck tailored for arps and hooks',
    bank: 0,
    program: 80,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 64,
    defaultAttack: 0.002,
    defaultDecay: 0.3,
    defaultSustain: 0.08,
    defaultRelease: 0.25,
    defaultCutoff: 11000,
    defaultResonance: 1.3,
    defaultChorus: 0.18,
    defaultReverb: 0.22,
  },
  {
    id: 'syn-keys',
    name: 'Synth Keys',
    category: 'Synth',
    description: 'Warm vintage poly analog synth keys with brassy chord bloom',
    bank: 0,
    program: 62,
    midiChannel: 1,
    isDrumKit: false,
    defaultPitch: 60,
    defaultAttack: 0.012,
    defaultDecay: 0.4,
    defaultSustain: 0.65,
    defaultRelease: 0.42,
    defaultCutoff: 7800,
    defaultResonance: 1.2,
    defaultChorus: 0.3,
    defaultReverb: 0.2,
  },
];

export function getBuiltinCatalogEntries(): InstrumentCatalogEntry[] {
  return BUILTIN_INSTRUMENTS.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    description: d.description,
    source: 'builtin',
    soundBankId: BUILTIN_BANK_ID,
    soundBankName: BUILTIN_BANK_NAME,
    bank: d.bank,
    program: d.program,
    midiChannel: d.midiChannel,
    isDrumKit: d.isDrumKit,
    defaultPitch: d.defaultPitch,
    defaultParams: {
      instrumentId: d.id,
      instrumentName: d.name,
      instrumentCategory: d.category,
      soundBankId: BUILTIN_BANK_ID,
      bankNumber: d.bank,
      programNumber: d.program,
      midiChannel: d.midiChannel,
      attack: d.defaultAttack,
      decay: d.defaultDecay,
      sustain: d.defaultSustain,
      release: d.defaultRelease,
      cutoff: d.defaultCutoff,
      resonance: d.defaultResonance,
      chorus: d.defaultChorus,
      oscVolume: 0,
      pitchSemitones: 0,
      pitchBendSemitones: 0,
      pitchBendRange: 2,
    },
  }));
}

export function findBuiltinDefinition(idOrProgram?: {
  instrumentId?: string;
  bankNumber?: number;
  programNumber?: number;
  midiChannel?: number;
}): BuiltinPresetDefinition {
  if (idOrProgram?.instrumentId) {
    const byId = BUILTIN_INSTRUMENTS.find((b) => b.id === idOrProgram.instrumentId);
    if (byId) return byId;
  }
  if (idOrProgram?.midiChannel === 10 || idOrProgram?.bankNumber === 128) {
    const drumMatch = BUILTIN_INSTRUMENTS.find(
      (b) => b.isDrumKit && b.program === (idOrProgram?.programNumber ?? 0)
    );
    if (drumMatch) return drumMatch;
    return BUILTIN_INSTRUMENTS.find((b) => b.id === 'drm-standard')!;
  }
  if (typeof idOrProgram?.programNumber === 'number') {
    const prog = idOrProgram.programNumber;
    const exact = BUILTIN_INSTRUMENTS.find((b) => !b.isDrumKit && b.program === prog);
    if (exact) return exact;
    // Closest GM program family mapping
    if (prog <= 3) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'kb-acoustic-grand')!;
    if (prog <= 7) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'kb-electric-piano')!;
    if (prog <= 23) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'kb-organ')!;
    if (prog <= 35) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'bas-electric')!;
    if (prog <= 39) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'bas-synth')!;
    if (prog <= 47) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'str-violin')!;
    if (prog <= 55) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'str-ensemble')!;
    if (prog >= 80 && prog <= 87) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'syn-lead')!;
    if (prog >= 88 && prog <= 95) return BUILTIN_INSTRUMENTS.find((b) => b.id === 'syn-pad')!;
  }
  return BUILTIN_INSTRUMENTS[0];
}

// --- Synthesis & Zone Caching (Lazy On-Demand Generation) ---

const builtinZoneCache = new Map<string, ResolvedInstrumentZones>();

export function unloadBuiltinPresetFromCache(presetId: string): void {
  for (const key of Array.from(builtinZoneCache.keys())) {
    if (key.startsWith(`${presetId}:`)) {
      builtinZoneCache.delete(key);
    }
  }
}

export function clearBuiltinSoundCache(): number {
  const count = builtinZoneCache.size;
  builtinZoneCache.clear();
  return count;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function hashNoise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function normalizePeakAndFade(
  data: Float32Array,
  sampleRate: number,
  targetPeak = 0.24,
  loop = false
): void {
  let maxAbs = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 1e-6 ? targetPeak / maxAbs : 1;
  const fadeIn = Math.min(Math.floor(data.length / 6), Math.floor(sampleRate * 0.003));
  const fadeOut = loop ? 0 : Math.min(Math.floor(data.length / 5), Math.floor(sampleRate * 0.045));

  for (let i = 0; i < data.length; i++) {
    let s = data[i] * scale;
    if (i < fadeIn && fadeIn > 0) {
      s *= 0.5 * (1 - Math.cos((Math.PI * i) / fadeIn));
    } else if (fadeOut > 0 && i >= data.length - fadeOut) {
      s *= (data.length - i) / fadeOut;
    }
    data[i] = s;
  }
}

function toAudioBuffer(pcm: Float32Array, sampleRate: number, audioCtx: BaseAudioContext): AudioBuffer {
  const buf = audioCtx.createBuffer(1, pcm.length, sampleRate);
  buf.copyToChannel(new Float32Array(pcm), 0);
  return buf;
}

/**
 * Generates an integer-cycle looped tone PCM so WebAudio AudioBufferSourceNode loops seamlessly without clicks.
 */
function synthesizeLoopedHarmonicZone(
  midi: number,
  sampleRate: number,
  options: {
    harmonicAmps: number[];
    detuneCents?: number[];
    vibRateHz?: number;
    vibDepthCents?: number;
    attackNoiseAmp?: number;
    attackNoiseDecay?: number;
    brightnessHz?: number;
  }
): { pcm: Float32Array; loopStartSec: number; loopEndSec: number } {
  const f0 = midiToFreq(midi);
  const twoPi = Math.PI * 2;
  const nyquist = sampleRate * 0.42;

  // Choose an exact integer number of fundamental cycles for a ~0.9s loop body after a ~0.18s attack section
  const attackSec = 0.16;
  const loopCycles = Math.max(8, Math.round(f0 * 0.85));
  const loopLenSamples = Math.max(256, Math.round((loopCycles / f0) * sampleRate));
  const attackSamples = Math.round(attackSec * sampleRate);
  const totalSamples = attackSamples + loopLenSamples;
  const pcm = new Float32Array(totalSamples);

  const detunes = options.detuneCents ?? [0];
  const vibRate = options.vibRateHz ?? 0;
  const vibAmpRad = ((options.vibDepthCents ?? 0) / 1200) * Math.log(2);
  let lp = 0;
  const cutoffAlpha = options.brightnessHz
    ? Math.min(0.92, Math.max(0.12, (2 * Math.PI * options.brightnessHz) / (sampleRate + 2 * Math.PI * options.brightnessHz)))
    : 0.75;

  for (let i = 0; i < totalSamples; i++) {
    // Wrap phase smoothly inside loop section or use exact periodic loop phase
    const inLoop = i >= attackSamples;
    const loopPhaseT = inLoop
      ? ((i - attackSamples) / loopLenSamples) * (loopCycles / f0)
      : i / sampleRate;
    const t = i / sampleRate;

    let sum = 0;
    for (let d = 0; d < detunes.length; d++) {
      const ratio = inLoop ? 1 : Math.pow(2, detunes[d] / 1200);
      const det = inLoop && detunes.length > 1 ? 0 : 0;
      void det;
      for (let h = 0; h < options.harmonicAmps.length; h++) {
        const harmNum = h + 1;
        const freq = f0 * harmNum * ratio;
        if (freq >= nyquist) break;
        const vibMod =
          vibRate > 0 && inLoop
            ? Math.sin(twoPi * Math.max(1, Math.round(vibRate * (loopCycles / f0))) * (i - attackSamples) / loopLenSamples) *
              vibAmpRad *
              harmNum
            : 0;
        const phaseOffset = inLoop ? 0 : d * 0.73;
        sum += options.harmonicAmps[h] * Math.sin(twoPi * freq * loopPhaseT + phaseOffset + vibMod);
      }
    }
    sum /= Math.max(1, detunes.length);

    // Subtle ensemble chorusing in loop via amplitude-matched slow harmonic phase modulation
    if (inLoop && detunes.length > 1) {
      const chorusCycles = Math.max(1, Math.round(1.8 * (loopCycles / f0)));
      const mod = Math.sin((twoPi * chorusCycles * (i - attackSamples)) / loopLenSamples);
      sum = sum * 0.84 + sum * 0.16 * mod;
    }

    if (options.attackNoiseAmp && t < 0.14) {
      const nEnv = Math.exp(-t / (options.attackNoiseDecay ?? 0.025));
      sum += hashNoise(i + midi * 31) * options.attackNoiseAmp * nEnv;
    }

    lp = lp + cutoffAlpha * (sum - lp);
    pcm[i] = lp;
  }

  // Smooth crossfade boundary at loopStart to guarantee zero click on loop wrap
  const xfade = Math.min(128, Math.floor(loopLenSamples / 8));
  for (let k = 0; k < xfade; k++) {
    const a = k / xfade;
    const idx = attackSamples + k;
    const tailIdx = totalSamples - xfade + k;
    const blended = pcm[idx] * a + pcm[tailIdx] * (1 - a);
    pcm[idx] = blended;
  }

  normalizePeakAndFade(pcm, sampleRate, 0.23, true);
  return {
    pcm,
    loopStartSec: attackSamples / sampleRate,
    loopEndSec: totalSamples / sampleRate,
  };
}

function synthesizePluckedOrStruckZone(
  midi: number,
  sampleRate: number,
  style: 'bright-piano' | 'rhodes' | 'e-bass' | 'a-bass' | 'pluck'
): Float32Array {
  const f0 = midiToFreq(midi);
  const twoPi = Math.PI * 2;
  const durationSec =
    style === 'pluck'
      ? Math.max(0.75, 1.5 - (midi - 36) * 0.01)
      : style === 'a-bass' || style === 'e-bass'
        ? 1.9
        : Math.max(1.2, 2.9 - (midi - 33) * 0.025);
  const len = Math.floor(sampleRate * durationSec);
  const out = new Float32Array(len);
  const nyquist = sampleRate * 0.42;

  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    let s = 0;

    if (style === 'bright-piano') {
      const B = 0.00014 + 0.0003 * Math.pow(Math.max(0, midi - 21) / 87, 1.6);
      for (let n = 1; n <= 11; n++) {
        const freq = n * f0 * Math.sqrt(1 + B * n * n);
        if (freq >= nyquist) break;
        const amp = 1 / Math.pow(n, 1.05);
        const tau = (durationSec * 0.56) / (1 + 0.34 * Math.pow(n - 1, 1.3));
        s += amp * Math.exp(-t / tau) * Math.sin(twoPi * freq * t);
      }
      if (t < 0.02) {
        s += hashNoise(i + midi * 53) * 0.16 * Math.exp(-t / 0.004);
      }
    } else if (style === 'rhodes') {
      const fmIdx = 0.85 * Math.exp(-t / 0.055);
      const body = Math.sin(twoPi * f0 * t + fmIdx * Math.sin(twoPi * f0 * 2 * t)) * Math.exp(-t / (durationSec * 0.68));
      const tine = 0.18 * Math.sin(twoPi * f0 * 4 * t) * Math.exp(-t / 0.09);
      const bark = 0.12 * Math.sin(twoPi * f0 * 3 * t) * Math.exp(-t / 0.22);
      const trem = 0.88 + 0.12 * Math.sin(twoPi * 4.2 * t);
      s = (body + tine + bark) * trem;
    } else if (style === 'e-bass') {
      const env = Math.exp(-t / 0.72);
      for (let n = 1; n <= 7; n++) {
        const freq = f0 * n;
        if (freq >= nyquist) break;
        const nTau = 0.72 / (1 + 0.45 * (n - 1));
        s += (1 / Math.pow(n, 1.25)) * Math.exp(-t / nTau) * Math.sin(twoPi * freq * t);
      }
      if (t < 0.02) s += 0.12 * Math.sin(twoPi * f0 * 3 * t) * Math.exp(-t / 0.006);
      s *= 0.85 + 0.15 * env;
    } else if (style === 'a-bass') {
      for (let n = 1; n <= 5; n++) {
        const freq = f0 * n;
        if (freq >= nyquist) break;
        const nTau = 0.58 / (1 + 0.6 * (n - 1));
        s += (1 / Math.pow(n, 1.55)) * Math.exp(-t / nTau) * Math.sin(twoPi * freq * t);
      }
      // Woody finger pluck thump
      if (t < 0.03) {
        s += 0.22 * hashNoise(i + midi * 19) * Math.exp(-t / 0.008) * 0.4;
        s += 0.18 * Math.sin(twoPi * 115 * t) * Math.exp(-t / 0.012);
      }
    } else {
      // FM Synth Pluck
      const modIdx = 2.4 * Math.exp(-t / 0.075);
      const carrier = Math.sin(twoPi * f0 * t + modIdx * Math.sin(twoPi * f0 * 2 * t));
      const sub = 0.35 * Math.sin(twoPi * f0 * 0.5 * t);
      s = (carrier + sub) * Math.exp(-t / 0.34);
    }

    lp = lp + 0.65 * (s - lp);
    out[i] = lp;
  }

  normalizePeakAndFade(out, sampleRate, 0.24, false);
  return out;
}

export type DrumVoiceKind =
  | 'kick-ac'
  | 'kick-808'
  | 'snare-ac'
  | 'snare-909'
  | 'rim'
  | 'clap'
  | 'tom-low'
  | 'tom-mid'
  | 'tom-high'
  | 'hat-closed'
  | 'hat-open'
  | 'crash'
  | 'ride'
  | 'conga-low'
  | 'conga-hi'
  | 'bongo'
  | 'shaker'
  | 'claves'
  | 'cowbell';

function synthesizeDrumPcm(kind: DrumVoiceKind, sampleRate: number): Float32Array {
  const twoPi = Math.PI * 2;
  const dur =
    kind === 'crash'
      ? 1.25
      : kind === 'ride' || kind === 'hat-open' || kind === 'kick-808'
        ? 0.65
        : kind === 'hat-closed' || kind === 'shaker' || kind === 'claves' || kind === 'rim'
          ? 0.16
          : 0.38;
  const len = Math.floor(sampleRate * dur);
  const out = new Float32Array(len);

  let hpPrev = 0;
  let lp = 0;

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    let s = 0;

    if (kind === 'kick-ac' || kind === 'kick-808') {
      const fStart = kind === 'kick-808' ? 165 : 145;
      const fEnd = kind === 'kick-808' ? 43 : 52;
      const pDecay = kind === 'kick-808' ? 0.045 : 0.032;
      const freq = fEnd + (fStart - fEnd) * Math.exp(-t / pDecay);
      const ampDecay = kind === 'kick-808' ? 0.36 : 0.19;
      const click = kind === 'kick-ac' ? 0.32 * Math.exp(-t / 0.005) * hashNoise(i) : 0.18 * Math.sin(twoPi * 950 * t) * Math.exp(-t / 0.004);
      // Approximate integrated frequency phase cleanly
      const phase = twoPi * (fEnd * t + (fStart - fEnd) * pDecay * (1 - Math.exp(-t / pDecay)));
      s = Math.sin(phase) * Math.exp(-t / ampDecay) + click;
    } else if (kind === 'snare-ac' || kind === 'snare-909') {
      const bodyFreq = kind === 'snare-909' ? 195 : 182;
      const body = Math.sin(twoPi * (bodyFreq + 110 * Math.exp(-t / 0.015)) * t) * Math.exp(-t / 0.075);
      const rawN = hashNoise(i + 17);
      const hp = rawN - hpPrev * 0.72;
      hpPrev = rawN;
      const wires = hp * Math.exp(-t / (kind === 'snare-909' ? 0.13 : 0.16));
      s = body * 0.65 + wires * 0.85;
    } else if (kind === 'clap') {
      // Multi-burst handclap envelope
      const burst =
        (t < 0.012 ? Math.exp(-t / 0.004) : 0) +
        (t >= 0.012 && t < 0.025 ? Math.exp(-(t - 0.012) / 0.004) : 0) +
        (t >= 0.025 ? Math.exp(-(t - 0.025) / 0.095) : 0);
      const rawN = hashNoise(i + 41);
      lp = lp + 0.35 * (rawN - lp);
      s = (rawN - lp * 0.5) * burst;
    } else if (kind === 'rim') {
      s =
        (Math.sin(twoPi * 440 * t) + 0.7 * Math.sin(twoPi * 1680 * t)) * Math.exp(-t / 0.018) +
        hashNoise(i) * 0.25 * Math.exp(-t / 0.006);
    } else if (kind === 'tom-low' || kind === 'tom-mid' || kind === 'tom-high') {
      const fEnd = kind === 'tom-low' ? 78 : kind === 'tom-mid' ? 112 : 158;
      const fStart = fEnd * 1.9;
      const phase = twoPi * (fEnd * t + (fStart - fEnd) * 0.03 * (1 - Math.exp(-t / 0.03)));
      s = Math.sin(phase) * Math.exp(-t / 0.16);
    } else if (kind === 'hat-closed' || kind === 'hat-open' || kind === 'crash' || kind === 'ride') {
      const decay =
        kind === 'hat-closed' ? 0.032 : kind === 'hat-open' ? 0.24 : kind === 'ride' ? 0.28 : 0.55;
      // Classic metallic 6-square/inharmonic partial cluster + high-passed noise
      const metal =
        Math.sin(twoPi * 3180 * t) * 0.25 +
        Math.sin(twoPi * 4520 * t) * 0.25 +
        Math.sin(twoPi * 6190 * t) * 0.25 +
        Math.sin(twoPi * 8340 * t) * 0.25;
      const rawN = hashNoise(i + 91);
      const hp = rawN - hpPrev * 0.85;
      hpPrev = rawN;
      const ping = kind === 'ride' ? 0.35 * Math.sin(twoPi * 2950 * t) * Math.exp(-t / 0.14) : 0;
      s = (metal * 0.45 + hp * 0.75) * Math.exp(-t / decay) + ping;
    } else if (kind === 'conga-low' || kind === 'conga-hi' || kind === 'bongo') {
      const baseF = kind === 'conga-low' ? 175 : kind === 'conga-hi' ? 245 : 340;
      const phase = twoPi * (baseF * t + baseF * 0.45 * 0.018 * (1 - Math.exp(-t / 0.018)));
      const slap = hashNoise(i + 5) * 0.2 * Math.exp(-t / 0.008);
      s = Math.sin(phase) * Math.exp(-t / 0.14) + slap;
    } else if (kind === 'shaker') {
      const rawN = hashNoise(i + 131);
      const hp = rawN - hpPrev * 0.82;
      hpPrev = rawN;
      const env = Math.sin(Math.min(1, t / 0.03) * Math.PI * 0.5) * Math.exp(-t / 0.045);
      s = hp * env;
    } else if (kind === 'claves') {
      s = (Math.sin(twoPi * 2520 * t) + 0.35 * Math.sin(twoPi * 5080 * t)) * Math.exp(-t / 0.022);
    } else if (kind === 'cowbell') {
      const sq1 = Math.sin(twoPi * 540 * t) >= 0 ? 1 : -1;
      const sq2 = Math.sin(twoPi * 810 * t) >= 0 ? 1 : -1;
      s = (sq1 + sq2) * 0.35 * Math.exp(-t / 0.095);
    }

    out[i] = s;
  }

  normalizePeakAndFade(out, sampleRate, 0.34, false);
  return out;
}

function buildDrumZones(
  kitId: 'drm-standard' | 'drm-electronic' | 'drm-percussion',
  sampleRate: number,
  audioCtx: BaseAudioContext
): InstrumentSampleZone[] {
  const mkZone = (
    id: string,
    keyLow: number,
    keyHigh: number,
    rootMidi: number,
    kind: DrumVoiceKind,
    pan = 0,
    exclusiveClass = 0
  ): InstrumentSampleZone => {
    const pcm = synthesizeDrumPcm(kind, sampleRate);
    return {
      id,
      keyLow,
      keyHigh,
      velLow: 0,
      velHigh: 127,
      rootMidi,
      coarseTune: 0,
      fineTune: 0,
      scaleTuning: 0, // drums don't transpose per key unless pitch bend applied
      gain: 0.9,
      pan,
      loop: false,
      loopStartSec: 0,
      loopEndSec: 0,
      attackSec: 0.001,
      decaySec: 0.4,
      sustainLevel: 0.1,
      releaseSec: 0.15,
      filterCutoffHz: 15000,
      filterQ: 0.7,
      exclusiveClass,
      buffer: toAudioBuffer(pcm, sampleRate, audioCtx),
    };
  };

  if (kitId === 'drm-percussion') {
    return [
      mkZone('perc-kick', 0, 37, 36, 'conga-low', 0),
      mkZone('perc-snare', 38, 41, 38, 'claves', -0.15),
      mkZone('perc-shaker-lo', 42, 46, 42, 'shaker', 0.25),
      mkZone('perc-tom-lo', 47, 50, 48, 'conga-hi', -0.2),
      mkZone('perc-cowbell', 51, 57, 56, 'cowbell', 0.18),
      mkZone('perc-bongo-hi', 58, 60, 60, 'bongo', -0.25),
      mkZone('perc-bongo-lo', 61, 61, 61, 'conga-hi', 0.2),
      mkZone('perc-conga-hi', 62, 63, 62, 'conga-hi', -0.15),
      mkZone('perc-conga-lo', 64, 68, 64, 'conga-low', 0.15),
      mkZone('perc-shaker', 69, 72, 70, 'shaker', 0.3),
      mkZone('perc-claves', 73, 127, 75, 'claves', -0.1),
    ];
  }

  const isElec = kitId === 'drm-electronic';
  return [
    mkZone('kick', 0, 36, 36, isElec ? 'kick-808' : 'kick-ac', 0),
    mkZone('rim', 37, 37, 37, 'rim', -0.15),
    mkZone('snare1', 38, 38, 38, isElec ? 'snare-909' : 'snare-ac', 0),
    mkZone('clap', 39, 39, 39, 'clap', 0.1),
    mkZone('snare2', 40, 40, 40, isElec ? 'snare-909' : 'snare-ac', 0.05),
    mkZone('tom-l', 41, 41, 41, 'tom-low', -0.35),
    mkZone('hat-c', 42, 42, 42, 'hat-closed', 0.2, 1),
    mkZone('tom-lm', 43, 43, 43, 'tom-low', -0.2),
    mkZone('hat-p', 44, 44, 44, 'hat-closed', 0.2, 1),
    mkZone('tom-m', 45, 45, 45, 'tom-mid', 0),
    mkZone('hat-o', 46, 46, 46, 'hat-open', 0.22, 1),
    mkZone('tom-mh', 47, 48, 47, 'tom-mid', 0.18),
    mkZone('crash', 49, 49, 49, 'crash', -0.35),
    mkZone('tom-h', 50, 50, 50, 'tom-high', 0.32),
    mkZone('ride', 51, 55, 51, 'ride', 0.3),
    mkZone('cowbell', 56, 56, 56, 'cowbell', -0.15),
    mkZone('crash2', 57, 68, 57, 'crash', 0.35),
    mkZone('shaker', 69, 127, 70, 'shaker', 0.2),
  ];
}

function splitKeyRangeZones(
  zones: Array<{
    midi: number;
    velLow?: number;
    velHigh?: number;
    build: () => {
      pcm: Float32Array;
      loop: boolean;
      loopStartSec?: number;
      loopEndSec?: number;
      attackSec: number;
      decaySec: number;
      sustainLevel: number;
      releaseSec: number;
      filterCutoffHz?: number;
    };
  }>,
  sampleRate: number,
  audioCtx: BaseAudioContext
): InstrumentSampleZone[] {
  // Group unique MIDI pitches to compute clean non-overlapping key bounds
  const uniqueMidis = Array.from(new Set(zones.map((z) => z.midi))).sort((a, b) => a - b);
  const bounds = new Map<number, { low: number; high: number }>();
  for (let i = 0; i < uniqueMidis.length; i++) {
    const m = uniqueMidis[i];
    const prev = i > 0 ? uniqueMidis[i - 1] : null;
    const next = i < uniqueMidis.length - 1 ? uniqueMidis[i + 1] : null;
    const low = prev === null ? 0 : Math.floor((prev + m) / 2) + 1;
    const high = next === null ? 127 : Math.floor((m + next) / 2);
    bounds.set(m, { low, high });
  }

  return zones.map((z, idx) => {
    const b = bounds.get(z.midi)!;
    const built = z.build();
    return {
      id: `z-${z.midi}-${idx}`,
      keyLow: b.low,
      keyHigh: b.high,
      velLow: z.velLow ?? 0,
      velHigh: z.velHigh ?? 127,
      rootMidi: z.midi,
      coarseTune: 0,
      fineTune: 0,
      scaleTuning: 100,
      gain: 0.92,
      pan: 0,
      loop: built.loop,
      loopStartSec: built.loopStartSec ?? 0,
      loopEndSec: built.loopEndSec ?? 0,
      attackSec: built.attackSec,
      decaySec: built.decaySec,
      sustainLevel: built.sustainLevel,
      releaseSec: built.releaseSec,
      filterCutoffHz: built.filterCutoffHz ?? 14000,
      filterQ: 0.7,
      exclusiveClass: 0,
      buffer: toAudioBuffer(built.pcm, sampleRate, audioCtx),
    };
  });
}

export async function decodeBuiltinPresetZones(
  presetId: string,
  audioCtx: BaseAudioContext,
  onProgress?: (loaded: number, total: number) => void
): Promise<ResolvedInstrumentZones> {
  const def = findBuiltinDefinition({ instrumentId: presetId });
  const sampleRate = audioCtx.sampleRate || 44100;
  const cacheKey = `${def.id}:${sampleRate}`;

  const isLiveCtx = typeof AudioContext !== 'undefined' && audioCtx instanceof AudioContext;
  if (isLiveCtx && builtinZoneCache.has(cacheKey)) {
    onProgress?.(1, 1);
    return builtinZoneCache.get(cacheKey)!;
  }

  let zones: InstrumentSampleZone[] = [];

  if (def.id === 'drm-standard' || def.id === 'drm-electronic' || def.id === 'drm-percussion') {
    onProgress?.(1, 2);
    zones = buildDrumZones(def.id, sampleRate, audioCtx);
    onProgress?.(2, 2);
  } else {
    const fullPitchZones = [33, 40, 47, 54, 60, 67, 74, 81, 88, 95];
    const bassPitchZones = [28, 34, 40, 46, 52, 58, 64];
    const stringPitchZones = [36, 43, 50, 57, 64, 71, 78, 85];

    if (def.id === 'kb-acoustic-grand') {
      const specs: Array<{ midi: number; velLow: number; velHigh: number; kind: 'acoustic-soft' | 'acoustic-forte' }> = [];
      for (const midi of fullPitchZones) {
        specs.push({ midi, velLow: 0, velHigh: 72, kind: 'acoustic-soft' });
        specs.push({ midi, velLow: 73, velHigh: 127, kind: 'acoustic-forte' });
      }
      zones = splitKeyRangeZones(
        specs.map((s) => ({
          midi: s.midi,
          velLow: s.velLow,
          velHigh: s.velHigh,
          build: () => ({
            pcm: synthesizePianoZonePcm(s.midi, s.kind, sampleRate),
            loop: false,
            attackSec: 0.003,
            decaySec: 0.85,
            sustainLevel: 0.25,
            releaseSec: 0.48,
            filterCutoffHz: s.kind === 'acoustic-forte' ? 11000 : 7200,
          }),
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'kb-bright-piano') {
      zones = splitKeyRangeZones(
        fullPitchZones.map((midi) => ({
          midi,
          build: () => ({
            pcm: synthesizePluckedOrStruckZone(midi, sampleRate, 'bright-piano'),
            loop: false,
            attackSec: 0.002,
            decaySec: 0.75,
            sustainLevel: 0.24,
            releaseSec: 0.44,
            filterCutoffHz: 13000,
          }),
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'kb-electric-piano') {
      zones = splitKeyRangeZones(
        fullPitchZones.map((midi) => ({
          midi,
          build: () => ({
            pcm: synthesizePianoZonePcm(midi, 'electric', sampleRate),
            loop: false,
            attackSec: 0.004,
            decaySec: 0.72,
            sustainLevel: 0.32,
            releaseSec: 0.42,
            filterCutoffHz: 9500,
          }),
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'kb-rhodes-ep') {
      zones = splitKeyRangeZones(
        fullPitchZones.map((midi) => ({
          midi,
          build: () => ({
            pcm: synthesizePluckedOrStruckZone(midi, sampleRate, 'rhodes'),
            loop: false,
            attackSec: 0.005,
            decaySec: 0.8,
            sustainLevel: 0.35,
            releaseSec: 0.46,
            filterCutoffHz: 7500,
          }),
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'kb-organ') {
      zones = splitKeyRangeZones(
        fullPitchZones.map((midi) => ({
          midi,
          build: () => {
            const res = synthesizeLoopedHarmonicZone(midi, sampleRate, {
              harmonicAmps: [0.85, 0.75, 0.42, 0.55, 0.14, 0.24, 0.06, 0.12],
              detuneCents: [0, 5],
              attackNoiseAmp: 0.08,
              attackNoiseDecay: 0.006,
              brightnessHz: 6800,
            });
            return {
              ...res,
              loop: true,
              attackSec: 0.005,
              decaySec: 0.1,
              sustainLevel: 0.95,
              releaseSec: 0.14,
              filterCutoffHz: 9200,
            };
          },
        })),
        sampleRate,
        audioCtx
      );
    } else if (
      def.id === 'str-violin' ||
      def.id === 'str-viola' ||
      def.id === 'str-cello' ||
      def.id === 'str-ensemble'
    ) {
      const isEns = def.id === 'str-ensemble';
      const harmonics =
        def.id === 'str-cello'
          ? [0.95, 0.62, 0.42, 0.26, 0.16, 0.1, 0.06]
          : def.id === 'str-viola'
            ? [0.85, 0.55, 0.38, 0.22, 0.12, 0.07]
            : isEns
              ? [0.8, 0.52, 0.36, 0.24, 0.16, 0.11, 0.07, 0.04]
              : [0.78, 0.58, 0.44, 0.3, 0.2, 0.12, 0.08, 0.04];

      zones = splitKeyRangeZones(
        stringPitchZones.map((midi) => ({
          midi,
          build: () => {
            const res = synthesizeLoopedHarmonicZone(midi, sampleRate, {
              harmonicAmps: harmonics,
              detuneCents: isEns ? [-12, -4, 4, 12] : [0, 3.5],
              vibRateHz: isEns ? 4.8 : 5.5,
              vibDepthCents: isEns ? 12 : 16,
              attackNoiseAmp: 0.06,
              attackNoiseDecay: 0.045,
              brightnessHz: def.id === 'str-cello' ? 4200 : def.id === 'str-viola' ? 5400 : 7600,
            });
            return {
              ...res,
              loop: true,
              attackSec: def.defaultAttack,
              decaySec: def.defaultDecay,
              sustainLevel: def.defaultSustain,
              releaseSec: def.defaultRelease,
              filterCutoffHz: def.defaultCutoff,
            };
          },
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'bas-electric' || def.id === 'bas-acoustic') {
      const style = def.id === 'bas-electric' ? 'e-bass' : 'a-bass';
      zones = splitKeyRangeZones(
        bassPitchZones.map((midi) => ({
          midi,
          build: () => ({
            pcm: synthesizePluckedOrStruckZone(midi, sampleRate, style),
            loop: false,
            attackSec: def.defaultAttack,
            decaySec: def.defaultDecay,
            sustainLevel: def.defaultSustain,
            releaseSec: def.defaultRelease,
            filterCutoffHz: def.defaultCutoff,
          }),
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'bas-synth') {
      zones = splitKeyRangeZones(
        bassPitchZones.map((midi) => ({
          midi,
          build: () => {
            const res = synthesizeLoopedHarmonicZone(midi, sampleRate, {
              harmonicAmps: [1.0, 0.68, 0.48, 0.36, 0.25, 0.18, 0.12, 0.08],
              detuneCents: [-8, 0, 8],
              brightnessHz: 3200,
            });
            return {
              ...res,
              loop: true,
              attackSec: def.defaultAttack,
              decaySec: def.defaultDecay,
              sustainLevel: def.defaultSustain,
              releaseSec: def.defaultRelease,
              filterCutoffHz: def.defaultCutoff,
            };
          },
        })),
        sampleRate,
        audioCtx
      );
    } else if (def.id === 'syn-pluck') {
      zones = splitKeyRangeZones(
        fullPitchZones.map((midi) => ({
          midi,
          build: () => ({
            pcm: synthesizePluckedOrStruckZone(midi, sampleRate, 'pluck'),
            loop: false,
            attackSec: def.defaultAttack,
            decaySec: def.defaultDecay,
            sustainLevel: def.defaultSustain,
            releaseSec: def.defaultRelease,
            filterCutoffHz: def.defaultCutoff,
          }),
        })),
        sampleRate,
        audioCtx
      );
    } else {
      // syn-lead, syn-pad, syn-keys
      const harmonics =
        def.id === 'syn-lead'
          ? [0.9, 0.58, 0.45, 0.32, 0.24, 0.17, 0.12, 0.08]
          : def.id === 'syn-pad'
            ? [0.95, 0.48, 0.3, 0.18, 0.1, 0.05]
            : [0.9, 0.55, 0.34, 0.22, 0.13, 0.07];
      zones = splitKeyRangeZones(
        fullPitchZones.map((midi) => ({
          midi,
          build: () => {
            const res = synthesizeLoopedHarmonicZone(midi, sampleRate, {
              harmonicAmps: harmonics,
              detuneCents: def.id === 'syn-pad' ? [-14, -5, 5, 14] : [-7, 7],
              vibRateHz: def.id === 'syn-lead' ? 5.2 : 3.2,
              vibDepthCents: def.id === 'syn-lead' ? 10 : 6,
              brightnessHz: def.defaultCutoff,
            });
            return {
              ...res,
              loop: true,
              attackSec: def.defaultAttack,
              decaySec: def.defaultDecay,
              sustainLevel: def.defaultSustain,
              releaseSec: def.defaultRelease,
              filterCutoffHz: def.defaultCutoff,
            };
          },
        })),
        sampleRate,
        audioCtx
      );
    }
    onProgress?.(1, 1);
  }

  const resolved: ResolvedInstrumentZones = {
    presetKey: def.id,
    name: def.name,
    category: def.category,
    isDrumKit: def.isDrumKit,
    bank: def.bank,
    program: def.program,
    zones,
  };

  if (isLiveCtx) {
    builtinZoneCache.set(cacheKey, resolved);
  }
  return resolved;
}
