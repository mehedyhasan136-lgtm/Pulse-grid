import * as Tone from 'tone';
import { ArrangementClip, AutomationLane, ProjectState, TrackModel } from '../types/daw';
import { MidiEngine } from './midiEngine';
import { MixerEngine } from './mixerEngine';
import { applySwingToBeat, MAX_SWING_DELAY_BEATS } from './swingUtils';

export class ArrangementEngine {
  private activeAudioPlayers = new Map<string, Tone.Player>();

  public scheduleWindow(
    project: ProjectState,
    windowStartBeat: number,
    windowEndBeat: number,
    time: number,
    midiEngine: MidiEngine,
    mixerEngine: MixerEngine
  ): void {
    const secPerBeat = 60 / project.bpm;

    const groupById = new Map(
      project.tracks.filter((t) => t.isGroupFolder).map((t) => [t.id, t])
    );

    for (const track of project.tracks) {
      const parentGroup = track.groupId ? groupById.get(track.groupId) : undefined;
      if (!track.isGroupFolder && parentGroup?.frozen) {
        continue;
      }

      // Apply track automation lanes if enabled
      this.applyAutomation(track, windowStartBeat, midiEngine, mixerEngine);

      const clips = project.arrangementClips.filter((c) => c.trackId === track.id);
      for (const arrClip of clips) {
        const clipEndBeat = arrClip.startBeat + arrClip.lengthBeats;
        if (clipEndBeat <= windowStartBeat || arrClip.startBeat >= windowEndBeat) {
          continue;
        }

        if (arrClip.kind === 'midi') {
          this.scheduleMidiClipWindow(
            track,
            arrClip,
            project,
            windowStartBeat,
            windowEndBeat,
            time,
            secPerBeat,
            midiEngine
          );
        } else if (arrClip.kind === 'audio') {
          this.scheduleAudioClipIfEntering(
            track,
            arrClip,
            project,
            windowStartBeat,
            windowEndBeat,
            time,
            secPerBeat,
            midiEngine,
            mixerEngine
          );
        }
      }
    }
  }

  private scheduleMidiClipWindow(
    track: TrackModel,
    arrClip: ArrangementClip,
    project: ProjectState,
    windowStartBeat: number,
    windowEndBeat: number,
    time: number,
    secPerBeat: number,
    midiEngine: MidiEngine
  ): void {
    const midi = project.midiClips[arrClip.sourceClipId];
    if (!midi || midi.lengthBeats <= 0) return;

    const clipEndBeat = arrClip.startBeat + arrClip.lengthBeats;
    const loopActive =
      project.loopEnabled &&
      project.loopEndBeat > project.loopStartBeat + 0.25 &&
      windowStartBeat < project.loopEndBeat;
    const effectiveEndBeat = loopActive ? Math.min(clipEndBeat, project.loopEndBeat) : clipEndBeat;
    const relStart = Math.max(0, windowStartBeat - arrClip.startBeat) + arrClip.offsetBeats;
    const relEnd = Math.min(arrClip.lengthBeats, windowEndBeat - arrClip.startBeat) + arrClip.offsetBeats;
    const swingPercent = project.swingPercent ?? 0;
    const maxDelay = swingPercent > 0 ? MAX_SWING_DELAY_BEATS : 0;

    const firstLoopIdx = Math.floor(Math.max(0, relStart - maxDelay) / midi.lengthBeats);
    const maxLoopIdx = arrClip.looped === false ? 0 : Math.floor(Math.max(0, relEnd - 1e-6) / midi.lengthBeats);

    for (let loopIdx = firstLoopIdx; loopIdx <= maxLoopIdx; loopIdx++) {
      const loopBase = loopIdx * midi.lengthBeats;
      for (const note of midi.notes) {
        const noteRelBeat = loopBase + note.startBeat;
        if (noteRelBeat < relStart - maxDelay - 1e-6 || noteRelBeat >= relEnd - 1e-6) continue;

        const rawAbsBeat = arrClip.startBeat + (noteRelBeat - arrClip.offsetBeats);
        if (rawAbsBeat < arrClip.startBeat - 1e-6 || rawAbsBeat >= effectiveEndBeat - 1e-6) continue;

        const swungAbsBeat = applySwingToBeat(rawAbsBeat, swingPercent);
        if (swungAbsBeat < windowStartBeat - 1e-6 || swungAbsBeat >= windowEndBeat - 1e-6) continue;
        if (swungAbsBeat >= effectiveEndBeat - 1e-6) continue;

        const offsetSec = Math.max(0, (swungAbsBeat - windowStartBeat) * secPerBeat);
        const remainingBeats = Math.max(0.05, effectiveEndBeat - swungAbsBeat);
        const durBeats = Math.min(note.durationBeats, remainingBeats);

        midiEngine.triggerMidiNote(
          track.id,
          note.pitch,
          durBeats * secPerBeat,
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
  }

  private scheduleAudioClipIfEntering(
    track: TrackModel,
    arrClip: ArrangementClip,
    project: ProjectState,
    windowStartBeat: number,
    windowEndBeat: number,
    time: number,
    secPerBeat: number,
    midiEngine: MidiEngine,
    mixerEngine: MixerEngine
  ): void {
    const audioMeta = project.audioClips[arrClip.sourceClipId];
    if (!audioMeta) return;
    const buffer = midiEngine.getDecodedAssets().get(audioMeta.assetId);
    if (!buffer) return;

    const clipEndBeat = arrClip.startBeat + arrClip.lengthBeats;
    const loopActive =
      project.loopEnabled &&
      project.loopEndBeat > project.loopStartBeat + 0.25 &&
      windowStartBeat < project.loopEndBeat;
    const effectiveEndBeat = loopActive ? Math.min(clipEndBeat, project.loopEndBeat) : clipEndBeat;
    if (windowStartBeat >= effectiveEndBeat - 1e-6) return;

    // Trigger once when playhead enters the clip start (or seeks inside on beat 0 of playback)
    const isEntering =
      arrClip.startBeat >= windowStartBeat - 1e-6 && arrClip.startBeat < windowEndBeat - 1e-6;
    const isAlreadyInsideAndNotPlaying =
      windowStartBeat > arrClip.startBeat &&
      windowStartBeat < effectiveEndBeat &&
      !this.activeAudioPlayers.has(arrClip.id);

    if (!isEntering && !isAlreadyInsideAndNotPlaying) return;

    const existing = this.activeAudioPlayers.get(arrClip.id);
    if (existing) {
      try {
        existing.stop(time);
        window.setTimeout(() => {
          try {
            existing.dispose();
          } catch {
            // ignore
          }
        }, 350);
      } catch {
        // ignore
      }
    }

    const dest = mixerEngine.getTrackInput(track.id);
    if (!dest) return;

    const player = new Tone.Player({
      url: buffer,
      fadeIn: 0.004,
      fadeOut: 0.004,
    }).connect(dest);
    const entryBeat = Math.max(arrClip.startBeat, windowStartBeat);
    const offsetSec = Math.max(0, (entryBeat - windowStartBeat) * secPerBeat);
    const audioOffsetSec = Math.max(0, (entryBeat - arrClip.startBeat + arrClip.offsetBeats) * secPerBeat);
    const remainingSec = Math.max(0.05, (effectiveEndBeat - entryBeat) * secPerBeat);
    const safeDur = Math.min(remainingSec, Math.max(0.05, buffer.duration - audioOffsetSec));

    if (audioOffsetSec < buffer.duration) {
      player.start(time + offsetSec, audioOffsetSec, safeDur);
      this.activeAudioPlayers.set(arrClip.id, player);
    } else {
      player.dispose();
    }
  }

  private applyAutomation(
    track: TrackModel,
    beat: number,
    midiEngine: MidiEngine,
    mixerEngine: MixerEngine
  ): void {
    for (const lane of track.automationLanes) {
      if (!lane.enabled || lane.points.length === 0) continue;
      const val = sampleAutomationLane(lane, beat);
      if (lane.target === 'volume') {
        // Map 0..1 -> -40..+6 dB
        const db = -40 + val * 46;
        mixerEngine.applyTrackAutomation(track.id, db, undefined);
      } else if (lane.target === 'pan') {
        const pan = val * 2 - 1;
        mixerEngine.applyTrackAutomation(track.id, undefined, pan);
      } else if (lane.target === 'filterCutoff') {
        // Exponential mapping 120 Hz .. 14000 Hz
        const hz = 120 * Math.pow(14000 / 120, val);
        midiEngine.applyFilterCutoff(track.id, hz);
      }
    }
  }

  public stopAllPlayers(atTime?: number): void {
    for (const player of this.activeAudioPlayers.values()) {
      try {
        if (atTime !== undefined) {
          player.stop(atTime);
          window.setTimeout(() => {
            try {
              player.dispose();
            } catch {
              // ignore
            }
          }, 350);
        } else {
          player.stop();
          player.dispose();
        }
      } catch {
        // ignore
      }
    }
    this.activeAudioPlayers.clear();
  }
}

export function sampleAutomationLane(lane: AutomationLane, beat: number): number {
  const pts = [...lane.points].sort((a, b) => a.beat - b.beat);
  if (pts.length === 0) return 0.5;
  if (beat <= pts[0].beat) return pts[0].value;
  if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (beat >= a.beat && beat <= b.beat) {
      const span = b.beat - a.beat;
      if (span <= 1e-6) return b.value;
      const t = (beat - a.beat) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return pts[pts.length - 1].value;
}
