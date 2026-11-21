import * as Tone from 'tone';
import { TrackModel } from '../types/daw';

export interface TrackChannelNodes {
  input: Tone.Gain;
  channel: Tone.Channel;
  postGain: Tone.Gain;
  meter: Tone.Meter;
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
}

export interface MasterPeakMetrics {
  inputPeakDb: number;
  inputPeakLinear: number;
  masterPeakDb: number;
  masterPeakLinear: number;
  rmsDb: number;
  rmsLinear: number;
  preLimiterPeakDb: number;
  clipping: boolean;
  limiterEngaged: boolean;
}

function measureWaveformStats(analyser: Tone.Analyser | null): { peak: number; rms: number } {
  if (!analyser) return { peak: 0, rms: 0 };
  try {
    const buf = analyser.getValue();
    if (!(buf instanceof Float32Array) || buf.length === 0) {
      return { peak: 0, rms: 0 };
    }
    let maxAbs = 0;
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i];
      const a = Math.abs(s);
      if (a > maxAbs) maxAbs = a;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    return { peak: maxAbs, rms };
  } catch {
    return { peak: 0, rms: 0 };
  }
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 1e-4) return -80;
  return Math.max(-80, Math.round(20 * Math.log10(linear) * 10) / 10);
}

export class MixerEngine {
  private initialized = false;
  // Master Bus architecture:
  // Track Post-Gain -> Track Effects -> (Group Bus or Master Bus) -> masterBusInput -> masterGain -> masterLimiter (-1 dBFS) -> Destination
  private masterBusInput: Tone.Gain | null = null;
  private masterGain: Tone.Gain | null = null;
  private masterLimiter: Tone.Limiter | null = null;
  private masterMeter: Tone.Meter | null = null;
  private sendReverbInput: Tone.Gain | null = null;
  private sendDelayInput: Tone.Gain | null = null;
  private sendReverbNode: Tone.Reverb | null = null;
  private sendDelayNode: Tone.FeedbackDelay | null = null;
  private inputAnalyser: Tone.Analyser | null = null;
  private preLimiterAnalyser: Tone.Analyser | null = null;
  private postLimiterAnalyser: Tone.Analyser | null = null;
  private clipHoldUntilMs = 0;
  private channels = new Map<string, TrackChannelNodes>();

  public init(masterVolumeDb = -12): void {
    if (this.initialized) return;

    const safeDb = Math.max(-60, Math.min(6, masterVolumeDb));
    this.masterBusInput = new Tone.Gain(1);
    this.masterGain = new Tone.Gain(Tone.dbToGain(safeDb));

    // Shared Master Send Buses (Reverb & Delay)
    this.sendReverbInput = new Tone.Gain(1);
    this.sendReverbNode = new Tone.Reverb({ decay: 2.2, preDelay: 0.02, wet: 1 });
    this.sendReverbInput.chain(this.sendReverbNode, this.masterBusInput);

    this.sendDelayInput = new Tone.Gain(1);
    this.sendDelayNode = new Tone.FeedbackDelay({ delayTime: 0.375, feedback: 0.35, wet: 1 });
    this.sendDelayInput.chain(this.sendDelayNode, this.masterBusInput);

    // Brickwall output safety limiter at -1 dBFS true peak ceiling
    this.masterLimiter = new Tone.Limiter(-1);
    this.masterMeter = new Tone.Meter({ smoothing: 0.65 });
    this.inputAnalyser = new Tone.Analyser('waveform', 512);
    this.preLimiterAnalyser = new Tone.Analyser('waveform', 512);
    this.postLimiterAnalyser = new Tone.Analyser('waveform', 512);

    // Single clean destination connection for the entire DAW
    this.masterBusInput.chain(this.masterGain, this.masterLimiter, Tone.getDestination());

    this.masterBusInput.connect(this.inputAnalyser);
    this.masterGain.connect(this.preLimiterAnalyser);
    this.masterLimiter.connect(this.postLimiterAnalyser);
    this.masterLimiter.connect(this.masterMeter);

    this.initialized = true;
  }

  public getMasterInput(): Tone.Gain | null {
    return this.masterBusInput;
  }

  public setMasterVolume(db: number): void {
    if (!this.masterGain) return;
    this.masterGain.gain.rampTo(Tone.dbToGain(Math.max(-60, Math.min(6, db))), 0.03);
  }

  public ensureTrackChannel(track: TrackModel): TrackChannelNodes {
    const existing = this.channels.get(track.id);
    if (existing) return existing;

    if (!this.masterBusInput) {
      this.init(-12);
    }

    const input = new Tone.Gain(1);
    const channel = new Tone.Channel({
      volume: track.volumeDb,
      pan: track.pan,
      mute: track.muted,
    });
    const postGain = new Tone.Gain(1);
    const meter = new Tone.Meter({ smoothing: 0.65 });
    const reverbSend = new Tone.Gain(Math.max(0, Math.min(1, track.sendReverb ?? 0)));
    const delaySend = new Tone.Gain(Math.max(0, Math.min(1, track.sendDelay ?? 0)));

    input.connect(channel);
    channel.connect(postGain);
    postGain.connect(meter);

    if (this.sendReverbInput) {
      postGain.connect(reverbSend);
      reverbSend.connect(this.sendReverbInput);
    }
    if (this.sendDelayInput) {
      postGain.connect(delaySend);
      delaySend.connect(this.sendDelayInput);
    }

    const nodes: TrackChannelNodes = { input, channel, postGain, meter, reverbSend, delaySend };
    this.channels.set(track.id, nodes);
    return nodes;
  }

  public getTrackInput(trackId: string): Tone.Gain | null {
    return this.channels.get(trackId)?.input ?? null;
  }

  public getTrackPostGain(trackId: string): Tone.Gain | null {
    return this.channels.get(trackId)?.postGain ?? null;
  }

  public getTrackChannel(trackId: string): Tone.Channel | null {
    return this.channels.get(trackId)?.channel ?? null;
  }

  public syncAllTracks(tracks: TrackModel[]): void {
    const validIds = new Set(tracks.map((t) => t.id));
    for (const [id, nodes] of this.channels.entries()) {
      if (!validIds.has(id)) {
        nodes.input.dispose();
        nodes.channel.dispose();
        nodes.postGain.dispose();
        nodes.meter.dispose();
        nodes.reverbSend.dispose();
        nodes.delaySend.dispose();
        this.channels.delete(id);
      }
    }

    const trackById = new Map(tracks.map((t) => [t.id, t]));
    const anySolo = tracks.some((t) => t.solo);

    for (const track of tracks) {
      const nodes = this.ensureTrackChannel(track);
      nodes.channel.volume.rampTo(track.volumeDb, 0.025);
      nodes.channel.pan.rampTo(track.pan, 0.025);
      nodes.reverbSend.gain.rampTo(Math.max(0, Math.min(1, track.sendReverb ?? 0)), 0.03);
      nodes.delaySend.gain.rampTo(Math.max(0, Math.min(1, track.sendDelay ?? 0)), 0.03);

      const parentGroup = track.groupId ? trackById.get(track.groupId) : undefined;
      let effectivelyMuted = track.muted || Boolean(parentGroup?.muted);

      if (anySolo) {
        if (track.isGroupFolder) {
          const anyChildSolo = tracks.some((c) => c.groupId === track.id && c.solo);
          effectivelyMuted = track.muted || (!track.solo && !anyChildSolo);
        } else {
          const isSoloAllowed = track.solo || Boolean(parentGroup?.solo);
          effectivelyMuted = effectivelyMuted || !isSoloAllowed;
        }
      }

      nodes.channel.mute = effectivelyMuted;
    }
  }

  public applyTrackAutomation(trackId: string, volumeDb?: number, pan?: number): void {
    const nodes = this.channels.get(trackId);
    if (!nodes) return;
    if (typeof volumeDb === 'number') {
      nodes.channel.volume.rampTo(Math.max(-48, Math.min(6, volumeDb)), 0.04);
    }
    if (typeof pan === 'number') {
      nodes.channel.pan.rampTo(Math.max(-1, Math.min(1, pan)), 0.04);
    }
  }

  public getTrackMeterNormalized(trackId: string): number {
    const meter = this.channels.get(trackId)?.meter;
    if (!meter) return 0;
    const val = meter.getValue();
    const db = Array.isArray(val) ? val[0] : val;
    if (!Number.isFinite(db) || db <= -60) return 0;
    return Math.max(0, Math.min(1, (db + 54) / 54));
  }

  public getMasterMeterNormalized(): number {
    if (!this.masterMeter) return 0;
    const val = this.masterMeter.getValue();
    const db = Array.isArray(val) ? val[0] : val;
    if (!Number.isFinite(db) || db <= -60) return 0;
    return Math.max(0, Math.min(1, (db + 54) / 54));
  }

  public getMasterPeakMetrics(): MasterPeakMetrics {
    const inputStats = measureWaveformStats(this.inputAnalyser);
    const preStats = measureWaveformStats(this.preLimiterAnalyser);
    const postStats = measureWaveformStats(this.postLimiterAnalyser);

    const inputPeakDb = linearToDb(inputStats.peak);
    const preDb = linearToDb(preStats.peak);
    const postDb = linearToDb(postStats.peak);
    const rmsDb = linearToDb(postStats.rms);

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Clipping threshold: pre-limiter signal exceeds 0 dBFS OR post-limiter exceeds -0.1 dBFS
    if (preStats.peak >= 0.99 || postStats.peak >= 0.985) {
      this.clipHoldUntilMs = now + 1500;
    }

    return {
      inputPeakDb,
      inputPeakLinear: Math.round(inputStats.peak * 1000) / 1000,
      masterPeakDb: postDb,
      masterPeakLinear: Math.round(postStats.peak * 1000) / 1000,
      rmsDb,
      rmsLinear: Math.round(postStats.rms * 1000) / 1000,
      preLimiterPeakDb: preDb,
      clipping: now < this.clipHoldUntilMs,
      limiterEngaged: preStats.peak >= 0.891, // -1 dBFS limiter threshold
    };
  }
}
