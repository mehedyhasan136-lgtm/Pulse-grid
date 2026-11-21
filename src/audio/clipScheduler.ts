import * as Tone from 'tone';
import { ProjectState } from '../types/daw';
import { ArrangementEngine } from './arrangementEngine';
import { MidiEngine } from './midiEngine';
import { MixerEngine } from './mixerEngine';
import { CaptureEvent, SessionEngine } from './sessionEngine';
import { TransportEngine } from './transportEngine';

export interface SchedulerCallbacks {
  getProject: () => ProjectState;
  getPlaybackMode: () => 'session' | 'arrangement';
  onTickUi: (currentBeat: number, sessionStateChanged: boolean) => void;
  onSessionCaptures: (captures: CaptureEvent[]) => void;
}

export class ClipScheduler {
  private repeatId: number | null = null;
  private stepBeats = 0.25; // 16th-note window tick

  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private micRecordStartBeat = 0;
  private micRecordTrackId: string | null = null;

  constructor(
    private transport: TransportEngine,
    private session: SessionEngine,
    private arrangement: ArrangementEngine,
    private midi: MidiEngine,
    private mixer: MixerEngine
  ) {}

  public start(callbacks: SchedulerCallbacks): void {
    this.stopRepeatLoop();
    this.repeatId = Tone.getTransport().scheduleRepeat((time) => {
      const project = callbacks.getProject();
      const mode = callbacks.getPlaybackMode();
      const beatsPerBar = project.timeSignature[0] || 4;
      const secPerBeat = 60 / project.bpm;

      let beat = this.transport.getCurrentBeat();
      let nextBeat = beat + this.stepBeats;
      let sessionChanged = false;
      let uiBeat = beat;

      const arrangementLoopActive =
        mode === 'arrangement' &&
        project.loopEnabled &&
        project.loopEndBeat > project.loopStartBeat + 0.25;

      if (arrangementLoopActive && beat >= project.loopEndBeat - 1e-6) {
        // Wrap directly from loopEndBeat back to loopStartBeat
        beat = project.loopStartBeat;
        nextBeat = beat + this.stepBeats;
        uiBeat = beat;
        this.arrangement.stopAllPlayers(time);

        this.transport.triggerMetronomeIfBeat(
          beat,
          nextBeat,
          time,
          project.bpm,
          beatsPerBar,
          project.metronomeEnabled
        );
        this.arrangement.scheduleWindow(
          project,
          beat,
          nextBeat,
          time,
          this.midi,
          this.mixer
        );
      } else if (
        arrangementLoopActive &&
        beat < project.loopEndBeat - 1e-6 &&
        nextBeat > project.loopEndBeat + 1e-6
      ) {
        // Step crosses the loop boundary mid-tick: schedule tail up to loopEndBeat, then wrap to loopStartBeat
        const tailEndBeat = project.loopEndBeat;
        const remainderBeats = nextBeat - tailEndBeat;
        const wrapTime = time + (tailEndBeat - beat) * secPerBeat;

        this.transport.triggerMetronomeIfBeat(
          beat,
          tailEndBeat,
          time,
          project.bpm,
          beatsPerBar,
          project.metronomeEnabled
        );
        this.arrangement.scheduleWindow(
          project,
          beat,
          tailEndBeat,
          time,
          this.midi,
          this.mixer
        );

        this.arrangement.stopAllPlayers(wrapTime);
        const wrappedEndBeat = project.loopStartBeat + remainderBeats;
        nextBeat = wrappedEndBeat;

        this.transport.triggerMetronomeIfBeat(
          project.loopStartBeat,
          wrappedEndBeat,
          wrapTime,
          project.bpm,
          beatsPerBar,
          project.metronomeEnabled
        );
        this.arrangement.scheduleWindow(
          project,
          project.loopStartBeat,
          wrappedEndBeat,
          wrapTime,
          this.midi,
          this.mixer
        );
      } else {
        // Standard window (Session or un-wrapped Arrangement)
        this.transport.triggerMetronomeIfBeat(
          beat,
          nextBeat,
          time,
          project.bpm,
          beatsPerBar,
          project.metronomeEnabled
        );

        if (mode === 'session') {
          sessionChanged = this.session.scheduleWindow(
            project,
            beat,
            nextBeat,
            time,
            this.transport.getIsRecording(),
            this.midi,
            this.mixer
          );
        } else {
          this.arrangement.scheduleWindow(
            project,
            beat,
            nextBeat,
            time,
            this.midi,
            this.mixer
          );
        }
      }

      this.transport.setCurrentBeat(nextBeat);

      const scheduledBeat = uiBeat;
      const changedFlag = sessionChanged;
      Tone.getDraw().schedule(() => {
        callbacks.onTickUi(scheduledBeat, changedFlag);
      }, time);
    }, '16n');
  }

  public stopRepeatLoop(): void {
    if (this.repeatId !== null) {
      Tone.getTransport().clear(this.repeatId);
      this.repeatId = null;
    }
  }

  public async startMicRecording(trackId: string, startBeat: number): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      this.recordedChunks = [];
      this.micRecordStartBeat = startBeat;
      this.micRecordTrackId = trackId;

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          this.recordedChunks.push(ev.data);
        }
      };
      recorder.start(100);
      this.mediaRecorder = recorder;
      return true;
    } catch {
      return false;
    }
  }

  public async stopMicRecording(): Promise<{
    trackId: string;
    startBeat: number;
    blob: Blob;
  } | null> {
    const recorder = this.mediaRecorder;
    const stream = this.mediaStream;
    const trackId = this.micRecordTrackId;
    const startBeat = this.micRecordStartBeat;

    this.mediaRecorder = null;
    this.mediaStream = null;
    this.micRecordTrackId = null;

    if (!recorder || !trackId) {
      stream?.getTracks().forEach((t) => t.stop());
      return null;
    }

    const blob = await new Promise<Blob>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve(new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
        return;
      }
      recorder.onstop = () => {
        resolve(new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.stop();
    });

    stream?.getTracks().forEach((t) => t.stop());
    this.recordedChunks = [];
    if (blob.size < 64) return null;
    return { trackId, startBeat, blob };
  }
}
