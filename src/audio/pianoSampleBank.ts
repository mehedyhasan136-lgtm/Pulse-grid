import * as Tone from 'tone';

export const PIANO_SAMPLE_ZONES = [33, 40, 47, 54, 60, 67, 74, 81, 88, 95] as const;

export type PianoBankKind = 'acoustic-soft' | 'acoustic-forte' | 'electric';

const cachedBanks = new Map<string, Record<number, AudioBuffer>>();

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Deterministic pseudo-random helper for felt hammer transient (no Math.random pops)
function hashFloat(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Renders an acoustic grand piano or warm electric tine piano PCM buffer
 * for a given MIDI key zone using stiff-string inharmonicity, unison string beating,
 * frequency-dependent harmonic decay, and soft felt hammer physics.
 */
export function synthesizePianoZonePcm(
  midi: number,
  kind: PianoBankKind,
  sampleRate: number
): Float32Array {
  const f0 = midiToFreq(midi);
  // Bass notes ring longer (~3.2s), high treble notes decay faster (~1.1s)
  const durationSec =
    kind === 'electric'
      ? Math.max(1.4, Math.min(3.0, 2.8 - (midi - 33) * 0.02))
      : Math.max(1.05, Math.min(3.4, 3.3 - (midi - 33) * 0.032));

  const length = Math.floor(sampleRate * durationSec);
  const out = new Float32Array(length);

  // Target per-voice peak (-12.5 dBFS) so 16 simultaneous notes never clip or crush the limiter
  const targetPeak = 0.235;
  const fadeInSamples = Math.max(1, Math.floor(sampleRate * (kind === 'electric' ? 0.005 : 0.003)));
  const fadeOutSamples = Math.max(1, Math.floor(sampleRate * 0.065));

  if (kind === 'electric') {
    // Classic warm Rhodes / FM tine electric piano
    const bodyDecay = durationSec * 0.62;
    const secondDecay = bodyDecay * 0.42;
    const tineDecay = 0.042;
    const tineFreq = f0 * 6.0;
    const bellFreq = f0 * 3.0;
    const twoPi = Math.PI * 2;

    let lp = 0;
    let maxAbs = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const bodyEnv = Math.exp(-t / bodyDecay);
      const secEnv = Math.exp(-t / secondDecay);
      const tineEnv = Math.exp(-t / tineDecay);

      // Gentle FM-like tine strike that melts cleanly into warm fundamental sine
      const fmIndex = 0.65 * Math.exp(-t / 0.035);
      const s1 = Math.sin(twoPi * f0 * t + fmIndex * Math.sin(twoPi * (f0 * 2) * t));
      const s2 = 0.24 * Math.sin(twoPi * (f0 * 2) * t) * secEnv;
      const bell = 0.14 * Math.sin(twoPi * bellFreq * t) * Math.exp(-t / 0.14);
      const tine = 0.09 * Math.sin(twoPi * tineFreq * t) * tineEnv;
      const softHammer = 0.06 * Math.sin(twoPi * 190 * t) * Math.exp(-t / 0.009);

      let sample = (s1 * 0.85 * bodyEnv) + s2 + bell + tine + softHammer;
      // Gentle 1-pole warmth smoothing above ~7.5kHz
      lp = lp + 0.55 * (sample - lp);
      sample = lp;

      if (i < fadeInSamples) {
        sample *= 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
      } else if (i > length - fadeOutSamples) {
        const rem = length - i;
        sample *= rem / fadeOutSamples;
      }

      out[i] = sample;
      const a = Math.abs(sample);
      if (a > maxAbs) maxAbs = a;
    }

    const scale = maxAbs > 1e-6 ? targetPeak / maxAbs : 1;
    for (let i = 0; i < length; i++) out[i] *= scale;
    return out;
  }

  // Acoustic Grand Piano physical synthesis ('acoustic-soft' | 'acoustic-forte')
  const isForte = kind === 'acoustic-forte';
  const maxHarmonic = isForte ? 9 : 5;
  const nyquistLimit = sampleRate * 0.42;

  // Stiff-string inharmonicity increases smoothly with register
  const B = 0.0001 + 0.00032 * Math.pow(Math.max(0, midi - 21) / 87, 1.7);
  const unisonDetune = midi < 44 ? [1.0, 1.00042] : [1.0, 1.00048, 0.99956];
  const unisonGain = 1 / unisonDetune.length;

  const baseTau = durationSec * (isForte ? 0.52 : 0.48);
  const twoPi = Math.PI * 2;

  // Precompute valid partials below Nyquist
  const partials: Array<{
    freq: number;
    amp: number;
    tau: number;
  }> = [];

  for (let n = 1; n <= maxHarmonic; n++) {
    const stretchedFreq = n * f0 * Math.sqrt(1 + B * n * n);
    if (stretchedFreq >= nyquistLimit) break;

    const rolloffPower = isForte ? 1.28 : 1.78;
    const amp = 1 / Math.pow(n, rolloffPower);
    const tau = baseTau / (1 + 0.42 * Math.pow(n - 1, 1.45));
    partials.push({ freq: stretchedFreq, amp, tau });
  }

  // Soundboard wooden thump filter state
  let hammerLp = 0;
  let maxAbs = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sum = 0;

    for (let p = 0; p < partials.length; p++) {
      const part = partials[p];
      const env = Math.exp(-t / part.tau);
      if (env < 1e-4) continue;

      let uSum = 0;
      for (let u = 0; u < unisonDetune.length; u++) {
        uSum += Math.sin(twoPi * part.freq * unisonDetune[u] * t + u * 0.41);
      }
      sum += part.amp * env * (uSum * unisonGain);
    }

    // Felt hammer + wooden soundboard body transient (0..18ms)
    if (t < 0.028) {
      const hammerEnv = Math.exp(-t / (isForte ? 0.0045 : 0.0032));
      const rawNoise = hashFloat(i + midi * 97);
      hammerLp = hammerLp + 0.14 * (rawNoise - hammerLp);
      const bodyThump = Math.sin(twoPi * 165 * t) * Math.exp(-t / 0.007);
      sum += (hammerLp * (isForte ? 0.14 : 0.07) + bodyThump * (isForte ? 0.11 : 0.06)) * hammerEnv;
    }

    // Micro fade-in & smooth buffer tail fade-out (eliminates attack/tail clicks)
    if (i < fadeInSamples) {
      sum *= 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
    } else if (i > length - fadeOutSamples) {
      const rem = length - i;
      sum *= rem / fadeOutSamples;
    }

    out[i] = sum;
    const a = Math.abs(sum);
    if (a > maxAbs) maxAbs = a;
  }

  const scale = maxAbs > 1e-6 ? targetPeak / maxAbs : 1;
  for (let i = 0; i < length; i++) {
    out[i] *= scale;
  }
  return out;
}

function getOrBuildZoneBuffers(kind: PianoBankKind): Record<number, AudioBuffer> {
  const rawCtx = Tone.getContext().rawContext as AudioContext;
  const sampleRate = rawCtx?.sampleRate || 44100;
  const cacheKey = `${kind}:${sampleRate}`;
  const existing = cachedBanks.get(cacheKey);
  if (existing) return existing;

  const map: Record<number, AudioBuffer> = {};
  for (const midi of PIANO_SAMPLE_ZONES) {
    const pcm = synthesizePianoZonePcm(midi, kind, sampleRate);
    const buf = rawCtx.createBuffer(1, pcm.length, sampleRate);
    buf.copyToChannel(new Float32Array(pcm), 0);
    map[midi] = buf;
  }
  cachedBanks.set(cacheKey, map);
  return map;
}

export interface PianoSamplerBank {
  softSampler: Tone.Sampler;
  forteSampler: Tone.Sampler;
  electricSampler: Tone.Sampler;
}

export function createPianoSamplerBank(outputNode: Tone.ToneAudioNode): PianoSamplerBank {
  const softUrls = getOrBuildZoneBuffers('acoustic-soft');
  const forteUrls = getOrBuildZoneBuffers('acoustic-forte');
  const electricUrls = getOrBuildZoneBuffers('electric');

  const softSampler = new Tone.Sampler({
    urls: softUrls,
    attack: 0.004,
    release: 0.42,
    curve: 'exponential',
  }).connect(outputNode);
  softSampler.volume.value = 0;

  const forteSampler = new Tone.Sampler({
    urls: forteUrls,
    attack: 0.003,
    release: 0.46,
    curve: 'exponential',
  }).connect(outputNode);
  forteSampler.volume.value = 0;

  const electricSampler = new Tone.Sampler({
    urls: electricUrls,
    attack: 0.005,
    release: 0.38,
    curve: 'exponential',
  }).connect(outputNode);
  electricSampler.volume.value = 0;

  return { softSampler, forteSampler, electricSampler };
}
