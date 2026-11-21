import * as Tone from 'tone';
import { ProjectState, QuantizeMode } from '../types/daw';
import { MidiEngine } from './midiEngine';
import { MixerEngine } from './mixerEngine';
import { applySwingToBeat, MAX_SWING_DELAY_BEATS } from './swingUtils';

export interface SessionTrackRuntime {
  activeClipId: string | null;
  queuedClipId: string | null;
  queuedStop: boolean;
  startBeat: number;
}

export interface CaptureEvent {
  trackId: string;
  clipId: string;
  kind: 'midi' | 'audio';
  startBeat: number;
  endBeat?: number;
}

export class SessionEngine {
  private trackStates = new Map<string, SessionTrackRuntime>();
  private activeAudioPlayers = new Map<string, { player: Tone.Player; clipId: string; loopStartBeat: number }>();
  private openCaptures = new Map<string, CaptureEvent>();
  private completedCaptures: CaptureEvent[] = [];

  public syncTracks(project: ProjectState): void {
    const valid = new Set(project.tracks.map((t) => t.id));
    for (const id of this.trackStates.keys()) {
      if (!valid.has(id)) {
        this.trackStates.delete(id);
        this.stopAudioPlayer(id);
      }
    }
    for (const track of project.tracks) {
      if (!this.trackStates.has(track.id)) {
        this.trackStates.set(track.id, {
          activeClipId: null,
          queuedClipId: null,
          queuedStop: false,
          startBeat: 0,
        });
      }
    }
  }

  public getTrackRuntime(trackId: string): SessionTrackRuntime {
    return (
      this.trackStates.get(trackId) ?? {
        activeClipId: null,
        queuedClipId: null,
        queuedStop: false,
        startBeat: 0,
      }
    );
  }

  public getAllRuntimes(): Record<string, SessionTrackRuntime> {
    const out: Record<string, SessionTrackRuntime> = {};
    for (const [k, v] of this.trackStates.entries()) {
      out[k] = { ...v };
    }
    return out;
  }

  public queueOrTriggerClip(
    trackId: string,
    clipId: string,
    isPlaying: boolean,
    isRecording: boolean,
    currentBeat: number
  ): void {
    const st = this.getTrackRuntime(trackId);
    if (!this.trackStates.has(trackId)) {
      this.trackStates.set(trackId, st);
    }

    if (!isPlaying) {
      st.activeClipId = clipId;
      st.queuedClipId = null;
      st.queuedStop = false;
      st.startBeat = 0;
      if (isRecording) {
        this.openCaptures.set(trackId, {
          trackId,
          clipId,
          kind: 'midi',
          startBeat: 0,
        });
      }
      return;
    }

    if (st.activeClipId === clipId) {
      if (st.queuedStop) {
        st.queuedStop = false;
      } else if (st.queuedClipId) {
        st.queuedClipId = null;
      } else {
        st.queuedStop = true;
      }
    } else {
      if (st.queuedClipId === clipId) {
        st.queuedClipId = null;
      } else {
        st.queuedClipId = clipId;
        st.queuedStop = false;
      }
    }
    void currentBeat;
  }

  public queueScene(
    project: ProjectState,
    sceneIndex: number,
    isPlaying: boolean
  ): void {
    for (const track of project.tracks) {
      const clipId = track.sessionSlots[sceneIndex] ?? null;
      const st = this.getTrackRuntime(track.id);
      if (!this.trackStates.has(track.id)) {
        this.trackStates.set(track.id, st);
      }

      if (!isPlaying) {
        st.activeClipId = clipId;
        st.queuedClipId = null;
        st.queuedStop = false;
        st.startBeat = 0;
      } else if (clipId) {
        if (st.activeClipId === clipId) {
          st.queuedClipId = null;
          st.queuedStop = false;
        } else {
          st.queuedClipId = clipId;
          st.queuedStop = false;
        }
      } else if (st.activeClipId) {
        st.queuedStop = true;
        st.queuedClipId = null;
      }
    }
  }

  public stopTrack(trackId: string, isPlaying: boolean): void {
    const st = this.getTrackRuntime(trackId);
    if (!isPlaying) {
      st.activeClipId = null;
      st.queuedClipId = null;
      st.queuedStop = false;
      this.stopAudioPlayer(trackId);
      return;
    }
    if (st.activeClipId) {
      st.queuedStop = true;
      st.queuedClipId = null;
    } else {
      st.queuedClipId = null;
      st.queuedStop = false;
    }
  }

  public armDefaultSceneIfEmpty(project: ProjectState): void {
    const hasAny = Array.from(this.trackStates.values()).some((s) => s.activeClipId !== null);
    if (hasAny) return;
    for (const track of project.tracks) {
      const firstClipId = track.sessionSlots[0] ?? null;
      if (firstClipId) {
        const st = this.getTrackRuntime(track.id);
        st.activeClipId = firstClipId;
        st.startBeat = 0;
        this.trackStates.set(track.id, st);
      }
    }
  }

  public resetOnStop(clearActive: boolean, finalBeat: number): CaptureEvent[] {
    this.stopAllAudioPlayers();
    for (const [trackId, cap] of this.openCaptures.entries()) {
      if (finalBeat > cap.startBeat + 0.25) {
        this.completedCaptures.push({ ...cap, endBeat: finalBeat });
      }
      this.openCaptures.delete(trackId);
    }
    const flushed = [...this.completedCaptures];
    this.completedCaptures = [];

    for (const st of this.trackStates.values()) {
      if (clearActive) {
        st.activeClipId = null;
      }
      st.queuedClipId = null;
      st.queuedStop = false;
      st.startBeat = 0;
    }
    return flushed;
  }

  public getQuantBeats(quantize: QuantizeMode, beatsPerBar: number): number {
    if (quantize === '2n') return Math.max(1, beatsPerBar / 2);
    if (quantize === '4n') return 1;
    return beatsPerBar;
  }

  public scheduleWindow(
    project: ProjectState,
    windowStartBeat: number,
    windowEndBeat: number,
    time: number,
    isRecording: boolean,
    midiEngine: MidiEngine,
    mixerEngine: MixerEngine
  ): boolean {
    const beatsPerBar = project.timeSignature[0] || 4;
    const quantBeats = this.getQuantBeats(project.quantize, beatsPerBar);
    const secPerBeat = 60 / project.bpm;

    let stateChanged = false;

    // Check if a quantize boundary lies inside [windowStartBeat, windowEndBeat)
    const boundaryIndex = Math.ceil((windowStartBeat - 1e-6) / quantBeats);
    const boundaryBeat = boundaryIndex * quantBeats;

    if (boundaryBeat >= windowStartBeat - 1e-6 && boundaryBeat < windowEndBeat - 1e-6) {
      for (const track of project.tracks) {
        const st = this.getTrackRuntime(track.id);
        if (st.queuedStop) {
          this.finalizeCapture(track.id, boundaryBeat);
          st.activeClipId = null;
          st.queuedStop = false;
          st.queuedClipId = null;
          this.stopAudioPlayer(track.id);
          midiEngine.releaseTrackVoices(track.id);
          stateChanged = true;
        } else if (st.queuedClipId) {
          this.finalizeCapture(track.id, boundaryBeat);
          st.activeClipId = st.queuedClipId;
          st.queuedClipId = null;
          st.startBeat = boundaryBeat;
          this.stopAudioPlayer(track.id);
          midiEngine.releaseTrackVoices(track.id);
          if (isRecording) {
            const kind = project.audioClips[st.activeClipId] ? 'audio' : 'midi';
            this.openCaptures.set(track.id, {
              trackId: track.id,
              clipId: st.activeClipId,
              kind,
              startBeat: boundaryBeat,
            });
          }
          stateChanged = true;
        } else if (isRecording && st.activeClipId && !this.openCaptures.has(track.id)) {
          const kind = project.audioClips[st.activeClipId] ? 'audio' : 'midi';
          this.openCaptures.set(track.id, {
            trackId: track.id,
            clipId: st.activeClipId,
            kind,
            startBeat: boundaryBeat,
          });
        }
      }
    }

    const frozenGroupIds = new Set(
      project.tracks.filter((t) => t.isGroupFolder && t.frozen).map((t) => t.id)
    );

    // Trigger MIDI or Audio loops for active Session clips
    for (const track of project.tracks) {
      if (track.isGroupFolder || (track.groupId && frozenGroupIds.has(track.groupId))) continue;
      const st = this.getTrackRuntime(track.id);
      if (!st.activeClipId) continue;

      const midiClip = project.midiClips[st.activeClipId];
      if (midiClip && midiClip.lengthBeats > 0) {
        const relStart = Math.max(0, windowStartBeat - st.startBeat);
        const relEnd = windowEndBeat - st.startBeat;
        if (relEnd <= 0) continue;

        const swingPercent = project.swingPercent ?? 0;
        const maxDelay = swingPercent > 0 ? MAX_SWING_DELAY_BEATS : 0;
        const firstLoop = Math.floor(Math.max(0, relStart - maxDelay) / midiClip.lengthBeats);
        const lastLoop = Math.floor(Math.max(0, relEnd - 1e-6) / midiClip.lengthBeats);

        for (let loopIdx = firstLoop; loopIdx <= lastLoop; loopIdx++) {
          const loopBase = st.startBeat + loopIdx * midiClip.lengthBeats;
          for (const note of midiClip.notes) {
            const rawAbsBeat = loopBase + note.startBeat;
            const swungAbsBeat = applySwingToBeat(rawAbsBeat, swingPercent);
            if (swungAbsBeat < windowStartBeat - 1e-6 || swungAbsBeat >= windowEndBeat - 1e-6) continue;
            const offsetSec = Math.max(0, (swungAbsBeat - windowStartBeat) * secPerBeat);
            midiEngine.triggerMidiNote(
              track.id,
              note.pitch,
              note.durationBeats * secPerBeat,
              time + offsetSec,
              note.velocity / 127,
              {
                channel: note.channel,
                pitchSlide: note.pitchSlide,
                mpe: note.mpe,
                beatDurationSec: secPerBeat,
              }
            );
          }
        }
        continue;
      }

      const audioMeta = project.audioClips[st.activeClipId];
      if (audioMeta && audioMeta.lengthBeats > 0) {
        const loopBeat = Math.floor((Math.max(0, windowStartBeat - st.startBeat)) / audioMeta.lengthBeats);
        const existing = this.activeAudioPlayers.get(track.id);
        if (!existing || existing.clipId !== audioMeta.id || existing.loopStartBeat !== loopBeat) {
          this.stopAudioPlayer(track.id);
          const buffer = midiEngine.getDecodedAssets().get(audioMeta.assetId);
          const dest = mixerEngine.getTrackInput(track.id);
          if (buffer && dest) {
            const player = new Tone.Player(buffer).connect(dest);
            const targetStartBeat = st.startBeat + loopBeat * audioMeta.lengthBeats;
            const offsetSec = Math.max(0, (targetStartBeat - windowStartBeat) * secPerBeat);
            const seekSec = Math.max(0, (windowStartBeat - targetStartBeat) * secPerBeat);
            if (seekSec < buffer.duration) {
              player.start(time + offsetSec, seekSec, Math.min(audioMeta.lengthBeats * secPerBeat, buffer.duration - seekSec));
              this.activeAudioPlayers.set(track.id, {
                player,
                clipId: audioMeta.id,
                loopStartBeat: loopBeat,
              });
            } else {
              player.dispose();
            }
          }
        }
      }
    }

    return stateChanged;
  }

  private finalizeCapture(trackId: string, endBeat: number): void {
    const cap = this.openCaptures.get(trackId);
    if (cap && endBeat > cap.startBeat + 0.25) {
      this.completedCaptures.push({ ...cap, endBeat });
    }
    this.openCaptures.delete(trackId);
  }

  private stopAudioPlayer(trackId: string): void {
    const entry = this.activeAudioPlayers.get(trackId);
    if (!entry) return;
    try {
      entry.player.stop();
      entry.player.dispose();
    } catch {
      // ignore
    }
    this.activeAudioPlayers.delete(trackId);
  }

  private stopAllAudioPlayers(): void {
    for (const trackId of Array.from(this.activeAudioPlayers.keys())) {
      this.stopAudioPlayer(trackId);
    }
  }
}
