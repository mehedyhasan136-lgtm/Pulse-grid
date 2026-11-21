import * as Tone from 'tone';
import { ProjectState } from '../types/daw';

export interface AudioSystemStatus {
  state: AudioContextState | 'standby';
  sampleRate: number;
  latencyMs: number;
  baseLatencyMs: number;
  outputLatencyMs: number | null;
}

export class TransportEngine {
  private metronomeSynth: Tone.Synth | null = null;
  private isPlaying = false;
  private isRecording = false;
  private currentBeat = 0;

  public init(destination: Tone.ToneAudioNode): void {
    if (this.metronomeSynth) return;
    this.metronomeSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.032, sustain: 0, release: 0.01 },
    }).connect(destination);
    this.metronomeSynth.volume.value = -10;
  }

  public syncProjectSettings(project: ProjectState): void {
    const t = Tone.getTransport();
    if (Math.abs(t.bpm.value - project.bpm) > 0.1) {
      t.bpm.rampTo(project.bpm, 0.03);
    }
    t.timeSignature = project.timeSignature;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public getCurrentBeat(): number {
    return this.currentBeat;
  }

  public setCurrentBeat(beat: number): void {
    this.currentBeat = Math.max(0, beat);
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    if (playing) {
      Tone.getTransport().start('+0.02');
    } else {
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
    }
  }

  public setRecording(recording: boolean): void {
    this.isRecording = recording;
  }

  public triggerMetronomeIfBeat(
    windowStartBeat: number,
    windowEndBeat: number,
    time: number,
    bpm: number,
    beatsPerBar: number,
    enabled: boolean
  ): void {
    if (!enabled || !this.metronomeSynth) return;
    const secPerBeat = 60 / bpm;
    const firstBeat = Math.ceil(windowStartBeat - 1e-6);
    for (let b = firstBeat; b < windowEndBeat - 1e-6; b += 1) {
      if (b < 0) continue;
      const offsetSec = (b - windowStartBeat) * secPerBeat;
      const isDownbeat = b % beatsPerBar === 0;
      this.metronomeSynth.triggerAttackRelease(
        isDownbeat ? 'C6' : 'G5',
        '32n',
        time + Math.max(0, offsetSec),
        isDownbeat ? 0.72 : 0.35
      );
    }
  }

  public getAudioStatus(): AudioSystemStatus {
    const raw = Tone.getContext().rawContext as AudioContext | undefined;
    if (!raw) {
      return {
        state: 'standby',
        sampleRate: 44100,
        latencyMs: 0,
        baseLatencyMs: 0,
        outputLatencyMs: null,
      };
    }
    const baseLatency = typeof raw.baseLatency === 'number' ? raw.baseLatency : 0;
    const hasOutputLatency = typeof raw.outputLatency === 'number' && Number.isFinite(raw.outputLatency);
    const outputLatency = hasOutputLatency ? raw.outputLatency : 0;
    const baseLatencyMs = Math.round(baseLatency * 10000) / 10;
    const outputLatencyMs = hasOutputLatency ? Math.round(outputLatency * 10000) / 10 : null;
    const totalMs = Math.round((baseLatency + outputLatency) * 1000);
    return {
      state: raw.state ?? 'standby',
      sampleRate: raw.sampleRate || 44100,
      latencyMs: totalMs,
      baseLatencyMs,
      outputLatencyMs,
    };
  }
}
