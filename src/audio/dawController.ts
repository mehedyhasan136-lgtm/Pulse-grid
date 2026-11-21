import * as Tone from 'tone';
import {
  ArrangementClip,
  AutomationTarget,
  EffectConfig,
  EffectType,
  GridResolution,
  InstrumentCatalogEntry,
  InstrumentConfig,
  LoopSnapMode,
  MidiClip,
  MidiNote,
  ProjectState,
  ProjectSummary,
  QuantizeMode,
  SavedTrackPreset,
  SoundBankSummary,
  StoredAudioAsset,
  StoredSoundBank,
  TrackModel,
  TrackType,
} from '../types/daw';
import {
  createDefaultEffect,
  createDefaultInstrument,
  createDefaultProject,
  createGesturePianoDefaultEffects,
  createTrackModel,
  LibraryPresetItem,
} from '../data/presets';
import {
  deleteAudioAssetFromDb,
  deleteProjectFromDb,
  deleteSoundBankFromDb,
  listAudioAssetsFromDb,
  listProjectsFromDb,
  listSoundBankSummariesFromDb,
  loadAudioAssetFromDb,
  loadProjectFromDb,
  loadSoundBankFromDb,
  saveAudioAssetToDb,
  saveProjectToDb,
  saveSoundBankToDb,
} from '../storage/projectDb';
import {
  audioBufferToWavArrayBuffer,
  audioBufferToWavBlob,
  cropAudioBuffer,
  midiClipToSmfBlob,
  normalizeAudioBuffer,
  renderGroupToAudioBuffer,
  renderProjectToWav,
  renderTrackToAudioBuffer,
  reverseAudioBuffer,
} from './wavEncoder';
import { MixerEngine } from './mixerEngine';
import { EffectsEngine } from './effectsEngine';
import { MAX_SAFE_MIDI_VELOCITY, MidiEngine } from './midiEngine';
import { TransportEngine, AudioSystemStatus } from './transportEngine';
import { CaptureEvent, SessionEngine, SessionTrackRuntime } from './sessionEngine';
import { ArrangementEngine } from './arrangementEngine';
import { ClipScheduler } from './clipScheduler';
import {
  buildProjectExportBundle,
  parseAndValidateProjectJson,
  triggerJsonDownload,
  sanitizeFilename,
} from '../storage/projectSerialization';
import {
  BUILTIN_BANK_ID,
  findBuiltinDefinition,
  getBuiltinCatalogEntries,
  unloadBuiltinPresetFromCache,
} from './builtinSoundBank';
import {
  buildSoundBankPresetsMeta,
  getLoadedSf2MemoryStats,
  isSf2BankLoadedInMemory,
  parseSf2Buffer,
  registerParsedSf2Bank,
  unloadSf2BankFromMemory,
} from './soundfontParser';

export interface AudioDiagnosticsSnapshot {
  inputPeakDb: number;
  masterPeakDb: number;
  masterPeakLinear: number;
  rmsDb: number;
  preLimiterPeakDb: number;
  masterVolumeDb: number;
  activeVoices: number;
  sampleRate: number;
  outputLatencyMs: number;
  audioContextState: AudioContextState | 'standby';
  clipping: boolean;
  limiterEngaged: boolean;
  activeEffects: string[];
  processingStatus: 'clean' | 'limiting' | 'clipping' | 'suspended' | 'standby';
}

export interface LiveMidiRecordingState {
  active: boolean;
  target: 'session' | 'arrangement';
  trackId: string;
  clipId: string;
  noteCount: number;
}

export interface DawStoreState {
  project: ProjectState;
  playbackMode: 'session' | 'arrangement';
  isPlaying: boolean;
  isRecording: boolean;
  currentBeat: number;
  quantProgress: number;
  selectedTrackId: string;
  selectedTrackIds: string[];
  pendingRenameGroupId: string | null;
  editingMidiClipId: string | null;
  sessionRuntimes: Record<string, SessionTrackRuntime>;
  audioStatus: AudioSystemStatus;
  canUndo: boolean;
  canRedo: boolean;
  savedProjects: ProjectSummary[];
  savedTrackPresets: SavedTrackPreset[];
  audioAssets: StoredAudioAsset[];
  soundBanks: SoundBankSummary[];
  favoriteInstrumentIds: string[];
  recentInstrumentIds: string[];
  instrumentLoading: { presetId: string; name: string; progress: number } | null;
  soundBankError: string | null;
  liveMidiRecording: LiveMidiRecordingState | null;
  activeVoiceCount: number;
  notice: string | null;
}

type Listener = (state: DawStoreState) => void;

const TRACK_PRESETS_STORAGE_KEY = 'pulsegrid.trackPresets.v1';
const FAVORITE_INSTRUMENTS_STORAGE_KEY = 'pulsegrid.favoriteInstruments.v1';
const RECENT_INSTRUMENTS_STORAGE_KEY = 'pulsegrid.recentInstruments.v1';
const INSTRUMENT_PREVIEW_TRACK_ID = '__instrument-preview__';

export function extractPeaks(buffer: AudioBuffer, bars = 64): number[] {
  const data = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize && start + j < data.length; j += Math.max(1, Math.floor(blockSize / 32))) {
      const abs = Math.abs(data[start + j]);
      if (abs > max) max = abs;
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

class DawController {
  private project: ProjectState = createDefaultProject();
  private playbackMode: 'session' | 'arrangement' = 'session';
  private selectedTrackId = 'drums';
  private selectedTrackIds: string[] = ['drums'];
  private pendingRenameGroupId: string | null = null;
  private editingMidiClipId: string | null = 'drums-0';
  private currentBeat = 0;
  private notice: string | null = null;

  private undoStack: ProjectState[] = [];
  private redoStack: ProjectState[] = [];
  private savedProjects: ProjectSummary[] = [];
  private savedTrackPresets: SavedTrackPreset[] = [];
  private audioAssets: StoredAudioAsset[] = [];
  private soundBanks: SoundBankSummary[] = [];
  private favoriteInstrumentIds: string[] = [];
  private recentInstrumentIds: string[] = [];
  private instrumentLoading: { presetId: string; name: string; progress: number } | null = null;
  private soundBankError: string | null = null;

  private audioInitialized = false;
  private initPromise: Promise<void> | null = null;
  private autosaveTimer: number | null = null;
  private listeners = new Set<Listener>();

  private liveMidiRec: {
    target: 'session' | 'arrangement';
    trackId: string;
    clipId: string;
    arrangementClipId?: string;
    recordStartBeat: number;
    noteCount: number;
    openNotes: Map<number, { startBeat: number; velocity: number; channel: number }>;
  } | null = null;
  private pendingWarmupNotes = new Set<string>();

  private mixer = new MixerEngine();
  private effects = new EffectsEngine();
  private midi = new MidiEngine();
  private transport = new TransportEngine();
  private session = new SessionEngine();
  private arrangement = new ArrangementEngine();
  private scheduler = new ClipScheduler(
    this.transport,
    this.session,
    this.arrangement,
    this.midi,
    this.mixer
  );

  constructor() {
    this.session.syncTracks(this.project);
    this.midi.setSoundBankLoader(async (bankId: string) => {
      try {
        const stored = await loadSoundBankFromDb(bankId);
        if (!stored?.arrayBuffer) return false;
        const parsed = parseSf2Buffer(stored.arrayBuffer, stored.name);
        registerParsedSf2Bank(bankId, stored.arrayBuffer, parsed);
        return true;
      } catch {
        return false;
      }
    });
    try {
      const rawPresets = localStorage.getItem(TRACK_PRESETS_STORAGE_KEY);
      if (rawPresets) {
        const parsed = JSON.parse(rawPresets);
        if (Array.isArray(parsed)) this.savedTrackPresets = parsed;
      }
      const rawFavs = localStorage.getItem(FAVORITE_INSTRUMENTS_STORAGE_KEY);
      if (rawFavs) {
        const parsed = JSON.parse(rawFavs);
        if (Array.isArray(parsed)) this.favoriteInstrumentIds = parsed;
      }
      const rawRecent = localStorage.getItem(RECENT_INSTRUMENTS_STORAGE_KEY);
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent);
        if (Array.isArray(parsed)) this.recentInstrumentIds = parsed;
      }
    } catch {
      // ignore storage errors
    }
    void this.bootstrapPersistence();
  }

  private async bootstrapPersistence(): Promise<void> {
    try {
      const [projects, assets, banks] = await Promise.all([
        listProjectsFromDb(),
        listAudioAssetsFromDb(),
        listSoundBankSummariesFromDb(),
      ]);
      this.savedProjects = projects;
      this.audioAssets = assets;
      this.soundBanks = banks;

      // Load last active default project if previously saved
      const existing = await loadProjectFromDb(this.project.id);
      if (existing) {
        this.project = existing;
        this.session.syncTracks(this.project);
        if (!this.project.tracks.some((t) => t.id === this.selectedTrackId)) {
          this.selectedTrackId = this.project.tracks[0]?.id ?? '';
        }
        this.selectedTrackIds = this.selectedTrackId ? [this.selectedTrackId] : [];
        const firstMidi = Object.keys(this.project.midiClips)[0] ?? null;
        if (!this.editingMidiClipId || !this.project.midiClips[this.editingMidiClipId]) {
          this.editingMidiClipId = firstMidi;
        }
      } else {
        await saveProjectToDb(this.project);
        this.savedProjects = await listProjectsFromDb();
      }
      this.emit();
    } catch {
      // IndexedDB unavailable in restricted environments; continue in memory
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): DawStoreState {
    const beatsPerBar = this.project.timeSignature[0] || 4;
    const quantBeats = this.session.getQuantBeats(this.project.quantize, beatsPerBar);
    const quantPhase = this.transport.getIsPlaying()
      ? (this.currentBeat % quantBeats) / quantBeats
      : 0;

    return {
      project: this.project,
      playbackMode: this.playbackMode,
      isPlaying: this.transport.getIsPlaying(),
      isRecording: this.transport.getIsRecording(),
      currentBeat: this.currentBeat,
      quantProgress: quantPhase,
      selectedTrackId: this.selectedTrackId,
      selectedTrackIds: this.selectedTrackIds,
      pendingRenameGroupId: this.pendingRenameGroupId,
      editingMidiClipId: this.editingMidiClipId,
      sessionRuntimes: this.session.getAllRuntimes(),
      audioStatus: this.transport.getAudioStatus(),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      savedProjects: this.savedProjects,
      savedTrackPresets: this.savedTrackPresets,
      audioAssets: this.audioAssets,
      soundBanks: this.soundBanks,
      favoriteInstrumentIds: this.favoriteInstrumentIds,
      recentInstrumentIds: this.recentInstrumentIds,
      instrumentLoading: this.instrumentLoading,
      soundBankError: this.soundBankError,
      liveMidiRecording: this.liveMidiRec
        ? {
            active: true,
            target: this.liveMidiRec.target,
            trackId: this.liveMidiRec.trackId,
            clipId: this.liveMidiRec.clipId,
            noteCount: this.liveMidiRec.noteCount,
          }
        : null,
      activeVoiceCount: this.midi.getActiveVoiceCount(),
      notice: this.notice,
    };
  }

  private emit(): void {
    const state = this.getState();
    this.listeners.forEach((fn) => fn(state));
  }

  public clearNotice(): void {
    this.notice = null;
    this.emit();
  }

  public clearPendingRenameGroup(): void {
    if (this.pendingRenameGroupId === null) return;
    this.pendingRenameGroupId = null;
    this.emit();
  }

  private setNotice(msg: string): void {
    this.notice = msg;
    this.emit();
    window.setTimeout(() => {
      if (this.notice === msg) {
        this.notice = null;
        this.emit();
      }
    }, 3200);
  }

  public async warmUpAudio(): Promise<void> {
    await this.ensureAudioReady();
  }

  public getAudioStatus(): AudioSystemStatus {
    return this.transport.getAudioStatus();
  }

  public getAudioDiagnostics(trackId?: string): AudioDiagnosticsSnapshot {
    const status = this.transport.getAudioStatus();
    const peaks = this.mixer.getMasterPeakMetrics();
    const activeVoices = this.midi.getActiveVoiceCount();
    const targetTrack =
      (trackId ? this.project.tracks.find((t) => t.id === trackId) : undefined) ??
      this.project.tracks.find((t) => t.id === this.selectedTrackId);

    const activeEffects = (targetTrack?.effects ?? [])
      .filter((fx) => fx.enabled)
      .map((fx) => {
        if (fx.type === 'reverb') return `Reverb ${Math.round(Number(fx.params.wet ?? 0.18) * 100)}%`;
        if (fx.type === 'delay') return `Delay ${Math.round(Number(fx.params.wet ?? 0.14) * 100)}%`;
        if (fx.type === 'eq') return 'EQ';
        if (fx.type === 'compressor') return 'Comp';
        return fx.type.toUpperCase();
      });

    let processingStatus: AudioDiagnosticsSnapshot['processingStatus'] = 'standby';
    if (!this.audioInitialized) {
      processingStatus = 'standby';
    } else if (status.state !== 'running') {
      processingStatus = 'suspended';
    } else if (peaks.clipping) {
      processingStatus = 'clipping';
    } else if (peaks.limiterEngaged) {
      processingStatus = 'limiting';
    } else {
      processingStatus = 'clean';
    }

    return {
      inputPeakDb: peaks.inputPeakDb,
      masterPeakDb: peaks.masterPeakDb,
      masterPeakLinear: peaks.masterPeakLinear,
      rmsDb: peaks.rmsDb,
      preLimiterPeakDb: peaks.preLimiterPeakDb,
      masterVolumeDb: this.project.masterVolumeDb,
      activeVoices,
      sampleRate: status.sampleRate,
      outputLatencyMs: status.outputLatencyMs ?? status.latencyMs,
      audioContextState: this.audioInitialized ? status.state : 'standby',
      clipping: peaks.clipping,
      limiterEngaged: peaks.limiterEngaged,
      activeEffects,
      processingStatus,
    };
  }

  public async ensureAudioReady(): Promise<void> {
    if (!this.audioInitialized) {
      try {
        const cur = Tone.getContext();
        // Safe interactive lookAhead (40ms) prevents WebAudio buffer underrun crackles on busy main threads
        cur.lookAhead = 0.04;
      } catch {
        // ignore
      }
    }

    await Tone.start();
    if (this.audioInitialized) {
      this.syncAudioGraph();
      return;
    }
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      this.mixer.init(this.project.masterVolumeDb);
      const masterInput = this.mixer.getMasterInput();
      if (masterInput) {
        this.transport.init(masterInput);
      }

      // Decode any stored audio assets into Web Audio buffers
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      if (rawCtx && typeof rawCtx.addEventListener === 'function') {
        rawCtx.addEventListener('statechange', () => {
          this.emit();
        });
      }
      for (const asset of this.audioAssets) {
        if (!this.midi.getDecodedAssets().has(asset.id)) {
          try {
            const copy = asset.arrayBuffer.slice(0);
            const decoded = await rawCtx.decodeAudioData(copy);
            this.midi.registerDecodedAsset(asset.id, decoded);
          } catch {
            // ignore corrupted asset
          }
        }
      }

      this.syncAudioGraph();

      this.scheduler.start({
        getProject: () => this.project,
        getPlaybackMode: () => this.playbackMode,
        onTickUi: (beat, _changed) => {
          this.currentBeat = beat;
          this.emit();
        },
        onSessionCaptures: (captures) => {
          this.commitCapturedSessionClips(captures);
        },
      });

      this.audioInitialized = true;
      this.emit();
    })();

    await this.initPromise;
  }

  private syncAudioGraph(): void {
    this.session.syncTracks(this.project);
    this.transport.syncProjectSettings(this.project);
    if (!this.audioInitialized) return;

    this.mixer.setMasterVolume(this.project.masterVolumeDb);
    this.mixer.syncAllTracks(this.project.tracks);

    const masterInput = this.mixer.getMasterInput();
    if (!masterInput) return;

    const groupIds = new Set(
      this.project.tracks.filter((t) => t.isGroupFolder).map((t) => t.id)
    );

    // Signal Chain: Instrument -> Track Gain (Channel) -> Effects -> (Group Bus or Master Bus) -> Limiter -> Output
    for (const track of this.project.tracks) {
      const trackInput = this.mixer.getTrackInput(track.id);
      const trackPostGain = this.mixer.getTrackPostGain(track.id);
      if (!trackInput || !trackPostGain) continue;

      if (!track.isGroupFolder) {
        this.midi.syncTrackInstrument(track, trackInput);
      }

      const groupDest =
        !track.isGroupFolder && track.groupId && groupIds.has(track.groupId)
          ? this.mixer.getTrackInput(track.groupId)
          : null;
      const dest = groupDest ?? masterInput;
      this.effects.syncTrackEffects(track.id, track.effects, trackPostGain, dest);
    }
  }

  private syncGroupHierarchy(draft: ProjectState): void {
    const groupIds = new Set(draft.tracks.filter((t) => t.isGroupFolder).map((t) => t.id));
    // Enforce single-level grouping and clear orphaned groupId links
    for (const t of draft.tracks) {
      if (t.isGroupFolder) {
        t.groupId = undefined;
      } else if (t.groupId && !groupIds.has(t.groupId)) {
        t.groupId = undefined;
      }
    }
    // Keep childTrackIds synchronized with tracks order
    for (const g of draft.tracks) {
      if (g.isGroupFolder) {
        const children = draft.tracks
          .filter((c) => !c.isGroupFolder && c.groupId === g.id)
          .map((c) => c.id);
        g.childTrackIds = children;
      } else {
        g.childTrackIds = undefined;
      }
    }
  }

  private mutateProject(mutator: (draft: ProjectState) => void, recordHistory = true): void {
    if (recordHistory) {
      this.undoStack.push(structuredClone(this.project));
      if (this.undoStack.length > 40) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }

    const next = structuredClone(this.project);
    mutator(next);
    this.syncGroupHierarchy(next);
    next.updatedAt = Date.now();
    this.project = next;

    this.syncAudioGraph();
    this.scheduleAutosave();
    this.emit();
  }

  private mutateLoopState(mutator: (draft: ProjectState) => void, recordHistory = false): void {
    if (recordHistory) {
      this.undoStack.push(structuredClone(this.project));
      if (this.undoStack.length > 40) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }

    const next = structuredClone(this.project);
    mutator(next);
    next.updatedAt = Date.now();
    this.project = next;

    // Do NOT call syncAudioGraph() here — ClipScheduler reads project loop bounds live
    // every 16n tick, so editing or toggling the loop during playback never glitches audio.
    this.scheduleAutosave();
    this.emit();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = window.setTimeout(async () => {
      try {
        await saveProjectToDb(this.project);
        this.savedProjects = await listProjectsFromDb();
        this.emit();
      } catch {
        // ignore
      }
    }, 600);
  }

  public undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.project));
    this.project = prev;
    this.syncAudioGraph();
    this.scheduleAutosave();
    this.emit();
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.project));
    this.project = next;
    this.syncAudioGraph();
    this.scheduleAutosave();
    this.emit();
  }

  // --- Transport & Playback ---

  public setPlaybackMode(mode: 'session' | 'arrangement'): void {
    this.playbackMode = mode;
    this.emit();
  }

  public async play(forceMode?: 'session' | 'arrangement'): Promise<void> {
    await this.ensureAudioReady();
    if (forceMode) {
      this.playbackMode = forceMode;
    }

    if (this.playbackMode === 'session') {
      this.session.armDefaultSceneIfEmpty(this.project);
    }

    if (this.transport.getIsPlaying()) return;

    if (
      this.playbackMode === 'arrangement' &&
      this.project.loopEnabled &&
      this.project.loopEndBeat > this.project.loopStartBeat + 0.25 &&
      (this.currentBeat < this.project.loopStartBeat - 1e-4 ||
        this.currentBeat >= this.project.loopEndBeat - 1e-4)
    ) {
      this.currentBeat = this.project.loopStartBeat;
    }

    this.transport.setCurrentBeat(this.currentBeat);
    this.transport.setPlaying(true);
    this.emit();
  }

  public async stop(): Promise<void> {
    if (this.transport.getIsRecording()) {
      const micResult = await this.scheduler.stopMicRecording();
      if (micResult) {
        await this.ingestRecordedAudioBlob(micResult.trackId, micResult.startBeat, micResult.blob);
      }
      this.transport.setRecording(false);
    }

    const finalBeat = this.currentBeat;
    const captures = this.session.resetOnStop(false, finalBeat);
    if (captures.length > 0) {
      this.commitCapturedSessionClips(captures);
    }

    if (this.liveMidiRec) {
      this.stopLiveMidiRecording();
    }
    this.arrangement.stopAllPlayers();
    this.midi.releaseAllVoices();
    this.transport.setPlaying(false);
    this.currentBeat = 0;
    this.transport.setCurrentBeat(0);
    this.emit();
  }

  public async toggleRecord(): Promise<void> {
    await this.ensureAudioReady();
    const nextRec = !this.transport.getIsRecording();
    this.transport.setRecording(nextRec);

    if (nextRec) {
      // Check if an audio track is armed for mic recording
      const armedAudioTrack = this.project.tracks.find((t) => t.armed && t.type === 'audio');
      if (armedAudioTrack) {
        const started = await this.scheduler.startMicRecording(armedAudioTrack.id, this.currentBeat);
        if (!started) {
          this.setNotice('Microphone permission unavailable; capturing Session performance instead.');
        } else {
          this.setNotice(`Recording microphone onto "${armedAudioTrack.name}"`);
        }
      } else {
        this.setNotice('Recording enabled: launch Session clips to capture into Arrangement.');
      }

      if (!this.transport.getIsPlaying()) {
        this.transport.setCurrentBeat(this.currentBeat);
        this.transport.setPlaying(true);
      }
    } else {
      const micResult = await this.scheduler.stopMicRecording();
      if (micResult) {
        await this.ingestRecordedAudioBlob(micResult.trackId, micResult.startBeat, micResult.blob);
      }
    }
    this.emit();
  }

  public seekToBeat(beat: number): void {
    const safeBeat = Math.max(0, beat);
    this.currentBeat = safeBeat;
    this.transport.setCurrentBeat(safeBeat);
    this.arrangement.stopAllPlayers();
    if (this.transport.getIsPlaying()) {
      this.midi.releaseAllVoices();
    }
    this.emit();
  }

  private commitCapturedSessionClips(captures: CaptureEvent[]): void {
    if (captures.length === 0) return;
    this.mutateProject((draft) => {
      for (const cap of captures) {
        const end = cap.endBeat ?? cap.startBeat + 4;
        const length = Math.max(1, Math.round((end - cap.startBeat) * 4) / 4);
        const clip = draft.midiClips[cap.clipId] ?? draft.audioClips[cap.clipId];
        if (!clip) continue;
        draft.arrangementClips.push({
          id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          trackId: cap.trackId,
          name: clip.name,
          color: clip.color,
          kind: cap.kind,
          sourceClipId: cap.clipId,
          startBeat: cap.startBeat,
          lengthBeats: length,
          offsetBeats: 0,
        });
      }
    });
    this.setNotice(`Captured ${captures.length} clip${captures.length > 1 ? 's' : ''} into Arrangement View`);
  }

  public setBpm(bpm: number): void {
    const clamped = Math.max(50, Math.min(200, Math.round(bpm)));
    this.mutateProject((d) => {
      d.bpm = clamped;
    }, false);
  }

  public setTimeSignature(numerator: number, denominator: number): void {
    this.mutateProject((d) => {
      d.timeSignature = [numerator, denominator];
    });
  }

  public setQuantize(q: QuantizeMode): void {
    this.mutateProject((d) => {
      d.quantize = q;
    }, false);
  }

  public setSwingPercent(swingPercent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(swingPercent)));
    this.mutateProject((d) => {
      d.swingPercent = clamped;
    }, false);
  }

  public toggleMetronome(): void {
    this.mutateProject((d) => {
      d.metronomeEnabled = !d.metronomeEnabled;
    }, false);
  }

  public toggleLoop(): void {
    this.mutateLoopState((d) => {
      d.loopEnabled = !d.loopEnabled;
    }, true);
  }

  public setLoopRegion(startBeat: number, endBeat: number, recordHistory = true): void {
    const safeStart = Math.max(0, Math.round(startBeat * 8) / 8);
    const safeEnd = Math.max(safeStart + 0.25, Math.round(endBeat * 8) / 8);
    this.mutateLoopState((d) => {
      d.loopStartBeat = safeStart;
      d.loopEndBeat = safeEnd;
    }, recordHistory);
  }

  public setLoopSnap(snap: LoopSnapMode): void {
    this.mutateLoopState((d) => {
      d.loopSnap = snap;
    }, false);
  }

  public setMasterVolume(db: number): void {
    const clamped = Math.max(-48, Math.min(6, db));
    this.mutateProject((d) => {
      d.masterVolumeDb = clamped;
    }, false);
  }

  // --- Session View Actions ---

  public async triggerSessionClip(trackId: string, clipId: string): Promise<void> {
    await this.ensureAudioReady();
    this.playbackMode = 'session';
    this.selectedTrackId = trackId;
    if (this.project.midiClips[clipId]) {
      this.editingMidiClipId = clipId;
    }

    const wasPlaying = this.transport.getIsPlaying();
    this.session.queueOrTriggerClip(
      trackId,
      clipId,
      wasPlaying,
      this.transport.getIsRecording(),
      this.currentBeat
    );

    if (!wasPlaying) {
      this.currentBeat = 0;
      this.transport.setCurrentBeat(0);
      this.transport.setPlaying(true);
    }
    this.emit();
  }

  public async triggerScene(sceneIndex: number): Promise<void> {
    await this.ensureAudioReady();
    this.playbackMode = 'session';
    const wasPlaying = this.transport.getIsPlaying();
    this.session.queueScene(this.project, sceneIndex, wasPlaying);

    if (!wasPlaying) {
      this.currentBeat = 0;
      this.transport.setCurrentBeat(0);
      this.transport.setPlaying(true);
    }
    this.emit();
  }

  public stopTrackSession(trackId: string): void {
    this.session.stopTrack(trackId, this.transport.getIsPlaying());
    this.emit();
  }

  public clearAllSessionClips(): void {
    this.session.resetOnStop(true, this.currentBeat);
    this.arrangement.stopAllPlayers();
    this.midi.releaseAllVoices();
    this.transport.setPlaying(false);
    this.currentBeat = 0;
    this.transport.setCurrentBeat(0);
    this.emit();
  }

  // --- Track & Scene CRUD ---

  public selectTrack(
    trackId: string,
    mode: 'single' | 'toggle' | 'range' = 'single',
    orderedIds?: string[]
  ): void {
    if (mode === 'toggle') {
      const exists = this.selectedTrackIds.includes(trackId);
      if (exists) {
        if (this.selectedTrackIds.length > 1) {
          this.selectedTrackIds = this.selectedTrackIds.filter((id) => id !== trackId);
          if (this.selectedTrackId === trackId) {
            this.selectedTrackId = this.selectedTrackIds[this.selectedTrackIds.length - 1];
          }
        }
      } else {
        this.selectedTrackIds = [...this.selectedTrackIds, trackId];
        this.selectedTrackId = trackId;
      }
    } else if (mode === 'range') {
      const order = orderedIds ?? this.project.tracks.map((t) => t.id);
      const a = order.indexOf(this.selectedTrackId);
      const b = order.indexOf(trackId);
      if (a !== -1 && b !== -1) {
        const [start, end] = a <= b ? [a, b] : [b, a];
        this.selectedTrackIds = order.slice(start, end + 1);
      } else {
        this.selectedTrackIds = [trackId];
      }
      this.selectedTrackId = trackId;
    } else {
      this.selectedTrackId = trackId;
      this.selectedTrackIds = [trackId];
    }

    const track = this.project.tracks.find((t) => t.id === this.selectedTrackId);
    if (track) {
      const firstClipId = track.sessionSlots.find((id) => id && this.project.midiClips[id]);
      if (firstClipId) {
        this.editingMidiClipId = firstClipId;
      }
    }
    this.emit();
  }

  public addTrack(
    type: TrackType,
    customName?: string,
    groupId?: string,
    instrumentType?: InstrumentConfig['type'],
    instrumentId?: string
  ): string {
    const count = this.project.tracks.filter((t) => !t.isGroupFolder).length;
    const resolvedInstrumentType: InstrumentConfig['type'] =
      instrumentType ?? (type === 'midi' ? 'soundfont' : 'sampler');

    let defaultLabel = `${type === 'midi' ? 'MIDI' : 'Audio'} ${count + 1}`;
    if (instrumentType === 'gesturePiano') {
      defaultLabel = `Piano ${count + 1}`;
    } else if (resolvedInstrumentType === 'soundfont') {
      const def = findBuiltinDefinition({ instrumentId: instrumentId ?? 'kb-acoustic-grand' });
      defaultLabel = def.name;
    }

    const name = customName ?? defaultLabel;
    const newTrack = createTrackModel(this.project.tracks.length, name, type, this.project.scenes.length, {
      instrument: createDefaultInstrument(resolvedInstrumentType, instrumentId),
    });
    const targetGroup = groupId
      ? this.project.tracks.find((t) => t.id === groupId && t.isGroupFolder)
      : undefined;
    if (targetGroup) {
      newTrack.groupId = targetGroup.id;
      newTrack.color = targetGroup.color;
    }

    this.mutateProject((d) => {
      if (targetGroup) {
        let insertIdx = d.tracks.findIndex((t) => t.id === targetGroup.id) + 1;
        while (insertIdx < d.tracks.length && d.tracks[insertIdx].groupId === targetGroup.id) {
          insertIdx++;
        }
        d.tracks.splice(insertIdx, 0, newTrack);
        const grp = d.tracks.find((t) => t.id === targetGroup.id);
        if (grp) grp.collapsed = false;
      } else {
        d.tracks.push(newTrack);
      }
    });
    this.selectedTrackId = newTrack.id;
    this.selectedTrackIds = [newTrack.id];
    this.emit();
    return newTrack.id;
  }

  public addTrackGroup(groupName?: string, memberIds?: string[], triggerRename = false): string {
    const groupNumber = this.project.tracks.filter((t) => t.isGroupFolder).length + 1;
    const resolvedName = groupName?.trim() || `Group ${groupNumber}`;
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const groupTrack = createTrackModel(
      this.project.tracks.length,
      resolvedName,
      'midi',
      this.project.scenes.length,
      {
        id: groupId,
        color: '#8B5CF6',
      }
    );
    groupTrack.isGroupFolder = true;
    groupTrack.collapsed = false;
    groupTrack.volumeDb = 0;
    groupTrack.pan = 0;
    groupTrack.childTrackIds = [];

    this.mutateProject((d) => {
      const validIds = new Set(
        (memberIds ?? []).filter((id) => {
          const tr = d.tracks.find((t) => t.id === id);
          return Boolean(tr && !tr.isGroupFolder);
        })
      );

      if (validIds.size > 0) {
        const firstIdx = d.tracks.findIndex((t) => validIds.has(t.id));
        const pickedChildren = d.tracks.filter((t) => validIds.has(t.id));
        for (const c of pickedChildren) {
          c.groupId = groupId;
        }
        groupTrack.childTrackIds = pickedChildren.map((c) => c.id);
        const remaining = d.tracks.filter((t) => !validIds.has(t.id));
        const insertAt = Math.max(0, Math.min(remaining.length, firstIdx));
        remaining.splice(insertAt, 0, groupTrack, ...pickedChildren);
        d.tracks = remaining;
      } else {
        d.tracks.push(groupTrack);
      }
    });

    this.selectedTrackId = groupId;
    this.selectedTrackIds = [groupId];
    if (triggerRename) {
      this.pendingRenameGroupId = groupId;
    }
    this.emit();
    return groupId;
  }

  public groupTracks(trackIds: string[], groupName?: string, promptRename = true): string | null {
    const validMembers = this.project.tracks
      .filter((t) => trackIds.includes(t.id) && !t.isGroupFolder)
      .map((t) => t.id);
    if (validMembers.length === 0) return null;
    const label =
      groupName?.trim() || `Group ${this.project.tracks.filter((t) => t.isGroupFolder).length + 1}`;
    const gid = this.addTrackGroup(label, validMembers, promptRename);
    this.setNotice(
      `Grouped ${validMembers.length} track${validMembers.length === 1 ? '' : 's'} into "${label}"`
    );
    return gid;
  }

  public ungroupTracks(targetTrackIds: string[]): void {
    const removedFolderIds: string[] = [];
    this.mutateProject((d) => {
      const folderIdsToRemove = new Set<string>();
      for (const id of targetTrackIds) {
        const tr = d.tracks.find((t) => t.id === id);
        if (!tr) continue;
        if (tr.isGroupFolder) {
          folderIdsToRemove.add(tr.id);
        } else if (tr.groupId) {
          tr.groupId = undefined;
        }
      }

      if (folderIdsToRemove.size > 0) {
        // Remove any temporary frozen stem clips belonging to removed groups
        d.arrangementClips = d.arrangementClips.filter(
          (c) => !folderIdsToRemove.has(c.trackId)
        );
        for (const t of d.tracks) {
          if (t.groupId && folderIdsToRemove.has(t.groupId)) {
            t.groupId = undefined;
          }
        }
        for (const fid of folderIdsToRemove) {
          removedFolderIds.push(fid);
        }
        d.tracks = d.tracks.filter((t) => !folderIdsToRemove.has(t.id));
      }
    });

    for (const fid of removedFolderIds) {
      this.effects.removeTrack(fid);
    }

    this.selectedTrackIds = this.selectedTrackIds.filter((id) =>
      this.project.tracks.some((t) => t.id === id)
    );
    if (this.selectedTrackIds.length === 0 && this.project.tracks[0]) {
      this.selectedTrackId = this.project.tracks[0].id;
      this.selectedTrackIds = [this.selectedTrackId];
    } else if (!this.project.tracks.some((t) => t.id === this.selectedTrackId)) {
      this.selectedTrackId = this.selectedTrackIds[0] ?? '';
    }
    this.setNotice('Ungrouped tracks (clips, MIDI, instruments & automation preserved)');
    this.emit();
  }

  public toggleTrackGroupCollapse(trackId: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t && t.isGroupFolder) {
        t.collapsed = !t.collapsed;
      }
    });
  }

  public setTrackGroupId(trackId: string, groupId?: string): void {
    const src = this.project.tracks.find((t) => t.id === trackId);
    if (!src || src.isGroupFolder) return;
    if (groupId && !this.project.tracks.some((t) => t.id === groupId && t.isGroupFolder)) {
      return;
    }
    const targetGroupName = groupId
      ? this.project.tracks.find((t) => t.id === groupId)?.name
      : undefined;

    this.mutateProject((d) => {
      const idx = d.tracks.findIndex((tr) => tr.id === trackId);
      if (idx === -1) return;
      const [moved] = d.tracks.splice(idx, 1);
      const prevGroupId = moved.groupId;
      moved.groupId = groupId || undefined;

      if (groupId) {
        // Place at the end of the target group's children and expand target group
        let insertIdx = d.tracks.findIndex((t) => t.id === groupId) + 1;
        while (insertIdx < d.tracks.length && d.tracks[insertIdx].groupId === groupId) {
          insertIdx++;
        }
        d.tracks.splice(insertIdx, 0, moved);
        const grp = d.tracks.find((t) => t.id === groupId);
        if (grp) grp.collapsed = false;
      } else if (prevGroupId) {
        // Place immediately after the previous group block
        const gIdx = d.tracks.findIndex((t) => t.id === prevGroupId);
        let insertIdx = gIdx !== -1 ? gIdx + 1 : d.tracks.length;
        while (insertIdx < d.tracks.length && d.tracks[insertIdx].groupId === prevGroupId) {
          insertIdx++;
        }
        d.tracks.splice(insertIdx, 0, moved);
      } else {
        d.tracks.splice(idx, 0, moved);
      }
    });

    this.setNotice(
      targetGroupName
        ? `Moved "${src.name}" into "${targetGroupName}"`
        : `Moved "${src.name}" out of group`
    );
  }

  public setTrackColor(trackId: string, color: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.color = color;
      for (const ac of d.arrangementClips) {
        if (ac.trackId === trackId) ac.color = color;
      }
    });
  }

  public moveTrack(trackId: string, delta: -1 | 1): void {
    this.mutateProject((d) => {
      const ordered = orderTracksHierarchically(d.tracks);
      const target = ordered.find((t) => t.id === trackId);
      if (!target) return;

      // Build top-level blocks (either a group + its children, or a standalone ungrouped track)
      if (target.isGroupFolder || !target.groupId) {
        const blocks: TrackModel[][] = [];
        const visited = new Set<string>();
        for (const tr of ordered) {
          if (visited.has(tr.id)) continue;
          if (tr.isGroupFolder) {
            const kids = ordered.filter((c) => !c.isGroupFolder && c.groupId === tr.id);
            const blk = [tr, ...kids];
            blk.forEach((b) => visited.add(b.id));
            blocks.push(blk);
          } else {
            visited.add(tr.id);
            blocks.push([tr]);
          }
        }
        const bIdx = blocks.findIndex((blk) => blk[0].id === trackId);
        const nextIdx = bIdx + delta;
        if (bIdx === -1 || nextIdx < 0 || nextIdx >= blocks.length) return;
        const [blk] = blocks.splice(bIdx, 1);
        blocks.splice(nextIdx, 0, blk);
        d.tracks = blocks.flat();
      } else {
        // Move child track within its parent group
        const siblings = ordered.filter((c) => !c.isGroupFolder && c.groupId === target.groupId);
        const sIdx = siblings.findIndex((c) => c.id === trackId);
        const nextSIdx = sIdx + delta;
        if (sIdx === -1 || nextSIdx < 0 || nextSIdx >= siblings.length) return;
        const swapPartner = siblings[nextSIdx];
        const aIdx = d.tracks.findIndex((t) => t.id === target.id);
        const bIdx = d.tracks.findIndex((t) => t.id === swapPartner.id);
        if (aIdx !== -1 && bIdx !== -1) {
          const tmp = d.tracks[aIdx];
          d.tracks[aIdx] = d.tracks[bIdx];
          d.tracks[bIdx] = tmp;
        }
      }
    });
  }

  private cloneSingleTrackData(
    d: ProjectState,
    src: TrackModel,
    newTrackId: string,
    nameSuffix: string,
    overrideGroupId?: string
  ): TrackModel {
    const clone: TrackModel = structuredClone(src);
    clone.id = newTrackId;
    clone.name = `${src.name}${nameSuffix}`;
    clone.isGroupFolder = false;
    clone.groupId = overrideGroupId;
    clone.childTrackIds = undefined;
    clone.effects = clone.effects.map((fx, i) => ({
      ...fx,
      id: `fx-${fx.type}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 4)}`,
    }));
    clone.sessionSlots = src.sessionSlots.map((slotId, sIdx) => {
      if (!slotId) return null;
      const m = d.midiClips[slotId];
      if (m) {
        const cid = `midi-${Date.now()}-${sIdx}-${Math.random().toString(36).slice(2, 5)}`;
        d.midiClips[cid] = {
          ...structuredClone(m),
          id: cid,
          notes: m.notes.map((n, ni) => ({ ...n, id: `${cid}-n-${ni}` })),
        };
        return cid;
      }
      return slotId;
    });
    const srcClips = d.arrangementClips.filter((c) => c.trackId === src.id);
    for (const ac of srcClips) {
      let clonedSourceId = ac.sourceClipId;
      if (ac.kind === 'midi' && d.midiClips[ac.sourceClipId]) {
        const srcMidi = d.midiClips[ac.sourceClipId];
        const slotMatchIdx = src.sessionSlots.indexOf(ac.sourceClipId);
        if (slotMatchIdx !== -1 && clone.sessionSlots[slotMatchIdx]) {
          clonedSourceId = clone.sessionSlots[slotMatchIdx]!;
        } else {
          const cid = `midi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          d.midiClips[cid] = {
            ...structuredClone(srcMidi),
            id: cid,
            notes: srcMidi.notes.map((n, ni) => ({ ...n, id: `${cid}-n-${ni}` })),
          };
          clonedSourceId = cid;
        }
      }
      d.arrangementClips.push({
        ...structuredClone(ac),
        id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        trackId: newTrackId,
        sourceClipId: clonedSourceId,
      });
    }
    return clone;
  }

  public duplicateGroup(groupId: string): void {
    const srcGroup = this.project.tracks.find((t) => t.id === groupId && t.isGroupFolder);
    if (!srcGroup) return;
    const newGroupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    this.mutateProject((d) => {
      const children = d.tracks.filter((c) => !c.isGroupFolder && c.groupId === groupId);
      const groupClone: TrackModel = structuredClone(srcGroup);
      groupClone.id = newGroupId;
      groupClone.name = `${srcGroup.name} Copy`;
      groupClone.frozen = false;
      groupClone.frozenAudioAssetId = undefined;
      groupClone.frozenGroupClipId = undefined;
      groupClone.effects = groupClone.effects.map((fx, i) => ({
        ...fx,
        id: `fx-${fx.type}-${Date.now()}-${i}`,
      }));

      const clonedChildren: TrackModel[] = children.map((child, idx) =>
        this.cloneSingleTrackData(
          d,
          child,
          `track-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          '',
          newGroupId
        )
      );
      groupClone.childTrackIds = clonedChildren.map((c) => c.id);

      let insertIdx = d.tracks.findIndex((t) => t.id === groupId) + 1;
      while (insertIdx < d.tracks.length && d.tracks[insertIdx].groupId === groupId) {
        insertIdx++;
      }
      d.tracks.splice(insertIdx, 0, groupClone, ...clonedChildren);
    });

    this.selectedTrackId = newGroupId;
    this.selectedTrackIds = [newGroupId];
    this.setNotice(`Duplicated group "${srcGroup.name}"`);
    this.emit();
  }

  public duplicateTrack(trackId: string): void {
    const src = this.project.tracks.find((t) => t.id === trackId);
    if (!src) return;
    if (src.isGroupFolder) {
      this.duplicateGroup(trackId);
      return;
    }
    const newTrackId = `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.mutateProject((d) => {
      const idx = d.tracks.findIndex((t) => t.id === trackId);
      const clone = this.cloneSingleTrackData(d, src, newTrackId, ' Copy', src.groupId);
      d.tracks.splice(idx + 1, 0, clone);
    });
    this.selectedTrackId = newTrackId;
    this.selectedTrackIds = [newTrackId];
    this.setNotice(`Duplicated "${src.name}"`);
    this.emit();
  }

  public deleteTrack(trackId: string): void {
    this.deleteTracks([trackId]);
  }

  public deleteTracks(trackIds: string[]): void {
    const removeSet = new Set(trackIds);
    // Include children of any deleted group folder
    for (const t of this.project.tracks) {
      if (t.groupId && removeSet.has(t.groupId)) {
        removeSet.add(t.id);
      }
    }
    if (this.project.tracks.length - removeSet.size < 1) {
      this.setNotice('At least 1 track must remain in the project');
      return;
    }
    for (const id of removeSet) {
      this.effects.removeTrack(id);
      this.midi.removeTrack(id);
    }
    this.mutateProject((d) => {
      d.tracks = d.tracks.filter((t) => !removeSet.has(t.id));
      d.arrangementClips = d.arrangementClips.filter((c) => !removeSet.has(c.trackId));
    });
    this.selectedTrackIds = this.selectedTrackIds.filter((id) => !removeSet.has(id));
    if (this.selectedTrackIds.length === 0 || removeSet.has(this.selectedTrackId)) {
      this.selectedTrackId = this.project.tracks[0]?.id ?? '';
      this.selectedTrackIds = this.selectedTrackId ? [this.selectedTrackId] : [];
    }
    this.emit();
  }

  public renameTrack(trackId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.name = trimmed;
    });
  }

  public async freezeGroup(groupId: string): Promise<void> {
    await this.ensureAudioReady();
    const group = this.project.tracks.find((t) => t.id === groupId && t.isGroupFolder);
    if (!group || group.frozen) return;
    const children = this.project.tracks.filter((t) => !t.isGroupFolder && t.groupId === groupId);
    if (children.length === 0) {
      this.setNotice(`"${group.name}" has no child tracks to freeze`);
      return;
    }
    this.setNotice(`Freezing group "${group.name}"...`);
    try {
      const { buffer, totalBeats } = await renderGroupToAudioBuffer(
        this.project,
        groupId,
        this.midi.getDecodedAssets()
      );
      const asset = await this.storeAudioBufferAsAsset(`${group.name} [Frozen]`, buffer);
      const audioClipId = `aclip-frz-grp-${Date.now()}`;
      const arrClipId = `arr-frz-grp-${Date.now()}`;

      this.mutateProject((d) => {
        const grp = d.tracks.find((t) => t.id === groupId);
        if (!grp) return;
        d.audioClips[audioClipId] = {
          id: audioClipId,
          name: `${grp.name} [Frozen Stem]`,
          color: grp.color,
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
          lengthBeats: totalBeats,
          peaks: asset.peaks,
        };
        d.arrangementClips = d.arrangementClips.filter((c) => c.trackId !== groupId);
        d.arrangementClips.push({
          id: arrClipId,
          trackId: groupId,
          name: `${grp.name} [Frozen]`,
          color: grp.color,
          kind: 'audio',
          sourceClipId: audioClipId,
          startBeat: 0,
          lengthBeats: totalBeats,
          offsetBeats: 0,
        });
        grp.frozen = true;
        grp.frozenAudioAssetId = asset.id;
        grp.frozenGroupClipId = arrClipId;
      });
      this.setNotice(`Froze group "${group.name}" (child tracks preserved for Unfreeze)`);
    } catch {
      this.setNotice(`Failed to freeze group "${group.name}"`);
    }
  }

  public unfreezeGroup(groupId: string): void {
    const group = this.project.tracks.find((t) => t.id === groupId && t.isGroupFolder);
    if (!group || !group.frozen) return;
    this.mutateProject((d) => {
      const grp = d.tracks.find((t) => t.id === groupId);
      if (!grp) return;
      grp.frozen = false;
      grp.frozenAudioAssetId = undefined;
      grp.frozenGroupClipId = undefined;
      d.arrangementClips = d.arrangementClips.filter((c) => c.trackId !== groupId);
    });
    this.setNotice(`Unfroze group "${group.name}"`);
  }

  public async bounceGroupToAudio(groupId: string): Promise<void> {
    await this.ensureAudioReady();
    const group = this.project.tracks.find((t) => t.id === groupId && t.isGroupFolder);
    if (!group) return;
    const children = this.project.tracks.filter((t) => !t.isGroupFolder && t.groupId === groupId);
    if (children.length === 0) {
      this.setNotice(`"${group.name}" has no child tracks to bounce`);
      return;
    }
    this.setNotice(`Bouncing "${group.name}" to Audio...`);
    try {
      const { buffer, totalBeats } = await renderGroupToAudioBuffer(
        this.project,
        groupId,
        this.midi.getDecodedAssets()
      );
      const asset = await this.storeAudioBufferAsAsset(`${group.name} Bounce`, buffer);
      const newTrackId = `track-gbnc-${Date.now()}`;
      const audioClipId = `aclip-gbnc-${Date.now()}`;

      this.mutateProject((d) => {
        let insertIdx = d.tracks.findIndex((t) => t.id === groupId) + 1;
        while (insertIdx < d.tracks.length && d.tracks[insertIdx].groupId === groupId) {
          insertIdx++;
        }
        const bounceTrack = createTrackModel(
          d.tracks.length,
          `${group.name} Audio`,
          'audio',
          d.scenes.length,
          { id: newTrackId, color: group.color }
        );
        d.audioClips[audioClipId] = {
          id: audioClipId,
          name: asset.name,
          color: group.color,
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
          lengthBeats: totalBeats,
          peaks: asset.peaks,
        };
        bounceTrack.sessionSlots[0] = audioClipId;
        d.tracks.splice(insertIdx, 0, bounceTrack);
        d.arrangementClips.push({
          id: `arr-gbnc-${Date.now()}`,
          trackId: newTrackId,
          name: asset.name,
          color: group.color,
          kind: 'audio',
          sourceClipId: audioClipId,
          startBeat: 0,
          lengthBeats: totalBeats,
          offsetBeats: 0,
        });
      });

      this.selectedTrackId = newTrackId;
      this.selectedTrackIds = [newTrackId];
      this.setNotice(`Bounced "${group.name}" to Audio track`);
    } catch {
      this.setNotice(`Failed to bounce "${group.name}"`);
    }
  }

  public async exportGroupAudioWav(groupId: string): Promise<void> {
    await this.ensureAudioReady();
    const group = this.project.tracks.find((t) => t.id === groupId && t.isGroupFolder);
    if (!group) return;
    const children = this.project.tracks.filter((t) => !t.isGroupFolder && t.groupId === groupId);
    if (children.length === 0) {
      this.setNotice(`"${group.name}" has no child tracks to export`);
      return;
    }
    this.setNotice(`Rendering "${group.name}" WAV stem...`);
    try {
      const { buffer } = await renderGroupToAudioBuffer(
        this.project,
        groupId,
        this.midi.getDecodedAssets()
      );
      const blob = audioBufferToWavBlob(buffer);
      this.triggerBlobDownload(blob, `${sanitizeFilename(group.name)}-group.wav`);
      this.setNotice(`Exported "${group.name}" group WAV`);
    } catch {
      this.setNotice('Group audio export failed');
    }
  }

  public insertMidiClipAt(
    trackId: string,
    startBeat?: number,
    lengthBeats?: number
  ): { clipId: string; arrClipId: string; trackId: string } | null {
    let targetTrack = this.project.tracks.find((t) => t.id === trackId) ?? null;
    if (!targetTrack) return null;

    // If a Group Folder is targeted, resolve to its first child track or create a MIDI track inside it
    if (targetTrack.isGroupFolder) {
      const child =
        this.project.tracks.find(
          (t) => !t.isGroupFolder && t.groupId === targetTrack!.id && t.type === 'midi'
        ) ??
        this.project.tracks.find((t) => !t.isGroupFolder && t.groupId === targetTrack!.id);
      if (child) {
        targetTrack = child;
      } else {
        const createdId = this.addTrack('midi', undefined, targetTrack.id);
        targetTrack = this.project.tracks.find((t) => t.id === createdId) ?? null;
      }
      if (!targetTrack) return null;
    }

    const resolvedTrackId = targetTrack.id;
    const beatsPerBar = this.project.timeSignature[0] || 4;
    const clipLen = Math.max(1, lengthBeats ?? beatsPerBar);

    let targetStart: number;
    if (typeof startBeat === 'number' && !Number.isNaN(startBeat)) {
      targetStart = Math.max(0, startBeat);
    } else {
      const trackClips = this.project.arrangementClips.filter((c) => c.trackId === resolvedTrackId);
      const cur = Math.max(0, Math.round(this.currentBeat * 4) / 4);
      const overlapsCurrent = trackClips.some(
        (c) => cur >= c.startBeat - 1e-4 && cur < c.startBeat + c.lengthBeats - 1e-4
      );
      if (!overlapsCurrent) {
        targetStart = cur;
      } else {
        const maxEnd = trackClips.reduce(
          (mx, c) => Math.max(mx, c.startBeat + c.lengthBeats),
          0
        );
        targetStart = Math.ceil(maxEnd / beatsPerBar) * beatsPerBar;
      }
    }

    const usedNames = new Set(
      this.project.arrangementClips
        .filter((c) => c.trackId === resolvedTrackId)
        .map((c) => c.name)
    );
    let clipName = `${targetTrack.name} MIDI`;
    let suffix = 2;
    while (usedNames.has(clipName)) {
      clipName = `${targetTrack.name} MIDI ${suffix++}`;
    }

    const clipId = `midi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const arrClipId = `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newClip: MidiClip = {
      id: clipId,
      name: clipName,
      color: targetTrack.color,
      lengthBeats: clipLen,
      notes: [],
    };

    this.mutateProject((d) => {
      d.midiClips[clipId] = newClip;
      const tr = d.tracks.find((t) => t.id === resolvedTrackId);
      if (tr) {
        const emptySlot = tr.sessionSlots.findIndex((s) => s === null);
        if (emptySlot !== -1) tr.sessionSlots[emptySlot] = clipId;
      }
      d.arrangementClips.push({
        id: arrClipId,
        trackId: resolvedTrackId,
        name: newClip.name,
        color: targetTrack!.color,
        kind: 'midi',
        sourceClipId: clipId,
        startBeat: targetStart,
        lengthBeats: clipLen,
        offsetBeats: 0,
      });
    });

    this.selectedTrackId = resolvedTrackId;
    this.selectedTrackIds = [resolvedTrackId];
    this.editingMidiClipId = clipId;
    const barNum = Math.floor(targetStart / beatsPerBar) + 1;
    this.setNotice(`Inserted MIDI clip on "${targetTrack.name}" at Bar ${barNum}`);
    this.emit();
    return { clipId, arrClipId, trackId: resolvedTrackId };
  }

  public insertMidiClipOnTrack(trackId: string, startBeat?: number): string | null {
    return this.insertMidiClipAt(trackId, startBeat)?.clipId ?? null;
  }

  public duplicateTrackContent(trackId: string): void {
    const clips = this.project.arrangementClips.filter((c) => c.trackId === trackId);
    if (clips.length === 0) {
      this.setNotice('No arrangement clips on track to duplicate');
      return;
    }
    const minStart = Math.min(...clips.map((c) => c.startBeat));
    const maxEnd = Math.max(...clips.map((c) => c.startBeat + c.lengthBeats));
    const span = Math.max(1, maxEnd - minStart);
    this.mutateProject((d) => {
      for (const c of clips) {
        d.arrangementClips.push({
          ...structuredClone(c),
          id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          startBeat: c.startBeat + span,
        });
      }
    });
    this.setNotice('Duplicated track content');
  }

  public quantizeTrackMidi(trackId: string, grid: GridResolution = '1/16'): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const clipIds = new Set<string>();
    for (const s of track.sessionSlots) {
      if (s && this.project.midiClips[s]) clipIds.add(s);
    }
    for (const ac of this.project.arrangementClips) {
      if (ac.trackId === trackId && ac.kind === 'midi') clipIds.add(ac.sourceClipId);
    }
    const gridBeats = gridResolutionToBeats(grid);
    this.mutateProject((d) => {
      for (const cid of clipIds) {
        const clip = d.midiClips[cid];
        if (!clip) continue;
        for (const note of clip.notes) {
          note.startBeat = Math.max(
            0,
            Math.min(clip.lengthBeats - gridBeats, Math.round(note.startBeat / gridBeats) * gridBeats)
          );
          note.durationBeats = Math.max(gridBeats, Math.round(note.durationBeats / gridBeats) * gridBeats);
        }
      }
    });
    this.setNotice(`Quantized MIDI on "${track.name}" to ${grid}`);
  }

  public consolidateTrackClips(trackId: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const clips = this.project.arrangementClips
      .filter((c) => c.trackId === trackId)
      .sort((a, b) => a.startBeat - b.startBeat);
    if (clips.length === 0) return;

    const allMidi = clips.every((c) => c.kind === 'midi');
    if (allMidi) {
      const startBeat = clips[0].startBeat;
      const endBeat = Math.max(...clips.map((c) => c.startBeat + c.lengthBeats));
      const totalLen = Math.max(1, endBeat - startBeat);
      const mergedNotes: MidiNote[] = [];
      for (const ac of clips) {
        const src = this.project.midiClips[ac.sourceClipId];
        if (!src || src.lengthBeats <= 0) continue;
        let cursor = 0;
        const loopAllowed = ac.looped !== false;
        while (cursor < ac.lengthBeats - 0.001) {
          for (const n of src.notes) {
            const absBeat = ac.startBeat + cursor + (n.startBeat - ac.offsetBeats);
            if (absBeat >= ac.startBeat && absBeat < ac.startBeat + ac.lengthBeats) {
              mergedNotes.push({
                ...n,
                id: `cn-${Date.now()}-${mergedNotes.length}`,
                startBeat: absBeat - startBeat,
              });
            }
          }
          if (!loopAllowed) break;
          cursor += src.lengthBeats;
        }
      }
      const newClipId = `midi-cons-${Date.now()}`;
      this.mutateProject((d) => {
        d.midiClips[newClipId] = {
          id: newClipId,
          name: `${track.name} Consolidated`,
          color: track.color,
          lengthBeats: totalLen,
          notes: mergedNotes,
        };
        d.arrangementClips = d.arrangementClips.filter((c) => c.trackId !== trackId);
        d.arrangementClips.push({
          id: `arr-${Date.now()}`,
          trackId,
          name: `${track.name} Consolidated`,
          color: track.color,
          kind: 'midi',
          sourceClipId: newClipId,
          startBeat,
          lengthBeats: totalLen,
          offsetBeats: 0,
        });
      });
      this.setNotice(`Consolidated ${clips.length} MIDI clips on "${track.name}"`);
      return;
    }

    // Fallback for mixed/audio tracks: bounce in place via offline render
    void this.consolidateAudioTrackClips(trackId);
  }

  private async consolidateAudioTrackClips(trackId: string): Promise<void> {
    await this.ensureAudioReady();
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    try {
      const { buffer, totalBeats } = await renderTrackToAudioBuffer(
        this.project,
        trackId,
        this.midi.getDecodedAssets()
      );
      const asset = await this.storeAudioBufferAsAsset(
        `${track.name} Consolidated`,
        buffer
      );
      const audioClipId = `aclip-${Date.now()}`;
      this.mutateProject((d) => {
        d.audioClips[audioClipId] = {
          id: audioClipId,
          name: asset.name,
          color: track.color,
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
          lengthBeats: totalBeats,
          peaks: asset.peaks,
        };
        d.arrangementClips = d.arrangementClips.filter((c) => c.trackId !== trackId);
        d.arrangementClips.push({
          id: `arr-${Date.now()}`,
          trackId,
          name: asset.name,
          color: track.color,
          kind: 'audio',
          sourceClipId: audioClipId,
          startBeat: 0,
          lengthBeats: totalBeats,
          offsetBeats: 0,
        });
      });
      this.setNotice(`Consolidated audio clips on "${track.name}"`);
    } catch {
      this.setNotice('Consolidate audio failed');
    }
  }

  private async storeAudioBufferAsAsset(name: string, buffer: AudioBuffer): Promise<StoredAudioAsset> {
    const arrayBuffer = audioBufferToWavArrayBuffer(buffer);
    const peaks = extractPeaks(buffer, 64);
    const asset: StoredAudioAsset = {
      id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      mimeType: 'audio/wav',
      durationSeconds: buffer.duration,
      peaks,
      arrayBuffer,
      createdAt: Date.now(),
    };
    this.midi.registerDecodedAsset(asset.id, buffer);
    await saveAudioAssetToDb(asset);
    this.audioAssets = [asset, ...this.audioAssets];
    return asset;
  }

  public async freezeTrack(trackId: string): Promise<void> {
    await this.ensureAudioReady();
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track || track.isGroupFolder || track.frozen) return;
    this.setNotice(`Freezing "${track.name}"...`);
    try {
      const { buffer, totalBeats } = await renderTrackToAudioBuffer(
        this.project,
        trackId,
        this.midi.getDecodedAssets()
      );
      const asset = await this.storeAudioBufferAsAsset(`${track.name} [Frozen]`, buffer);
      const audioClipId = `aclip-frz-${Date.now()}`;

      this.mutateProject((d) => {
        const tr = d.tracks.find((t) => t.id === trackId);
        if (!tr) return;
        const origArr = d.arrangementClips.filter((c) => c.trackId === trackId);
        tr.frozenBackup = {
          type: tr.type,
          instrument: structuredClone(tr.instrument),
          effects: structuredClone(tr.effects),
          arrangementClips: structuredClone(origArr),
          sessionSlots: [...tr.sessionSlots],
        };
        tr.frozen = true;
        tr.frozenAudioAssetId = asset.id;
        tr.type = 'audio';
        d.audioClips[audioClipId] = {
          id: audioClipId,
          name: `${tr.name} [Frozen]`,
          color: tr.color,
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
          lengthBeats: totalBeats,
          peaks: asset.peaks,
        };
        d.arrangementClips = d.arrangementClips.filter((c) => c.trackId !== trackId);
        d.arrangementClips.push({
          id: `arr-frz-${Date.now()}`,
          trackId,
          name: `${tr.name} [Frozen]`,
          color: tr.color,
          kind: 'audio',
          sourceClipId: audioClipId,
          startBeat: 0,
          lengthBeats: totalBeats,
          offsetBeats: 0,
        });
      });
      this.setNotice(`Froze "${track.name}" (MIDI/instrument preserved for Unfreeze)`);
    } catch {
      this.setNotice(`Failed to freeze "${track.name}"`);
    }
  }

  public unfreezeTrack(trackId: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track || !track.frozen || !track.frozenBackup) return;
    this.mutateProject((d) => {
      const tr = d.tracks.find((t) => t.id === trackId);
      if (!tr || !tr.frozenBackup) return;
      const b = tr.frozenBackup;
      tr.type = b.type;
      tr.instrument = structuredClone(b.instrument);
      tr.effects = structuredClone(b.effects);
      tr.sessionSlots = [...b.sessionSlots];
      tr.frozen = false;
      tr.frozenAudioAssetId = undefined;
      tr.frozenBackup = undefined;
      d.arrangementClips = d.arrangementClips.filter((c) => c.trackId !== trackId);
      d.arrangementClips.push(...structuredClone(b.arrangementClips));
    });
    this.setNotice(`Unfroze "${track.name}"`);
  }

  public flattenTrack(trackId: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track || !track.frozen) return;
    this.mutateProject((d) => {
      const tr = d.tracks.find((t) => t.id === trackId);
      if (!tr) return;
      tr.type = 'audio';
      tr.frozen = false;
      tr.frozenBackup = undefined;
      tr.instrument = createDefaultInstrument('sampler');
    });
    this.setNotice(`Flattened "${track.name}" to Audio Track`);
  }

  public async bounceTrackInPlace(trackId: string): Promise<void> {
    await this.ensureAudioReady();
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track || track.isGroupFolder) return;
    this.setNotice(`Bouncing "${track.name}" in place...`);
    try {
      const { buffer, totalBeats } = await renderTrackToAudioBuffer(
        this.project,
        trackId,
        this.midi.getDecodedAssets()
      );
      const asset = await this.storeAudioBufferAsAsset(`${track.name} Bounce`, buffer);
      const newTrackId = `track-bnc-${Date.now()}`;
      const audioClipId = `aclip-bnc-${Date.now()}`;

      this.mutateProject((d) => {
        const idx = d.tracks.findIndex((t) => t.id === trackId);
        const bounceTrack = createTrackModel(
          d.tracks.length,
          `${track.name} Bounce`,
          'audio',
          d.scenes.length,
          { id: newTrackId, color: track.color }
        );
        bounceTrack.groupId = track.groupId;
        d.audioClips[audioClipId] = {
          id: audioClipId,
          name: asset.name,
          color: track.color,
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
          lengthBeats: totalBeats,
          peaks: asset.peaks,
        };
        bounceTrack.sessionSlots[0] = audioClipId;
        d.tracks.splice(idx + 1, 0, bounceTrack);
        d.arrangementClips.push({
          id: `arr-bnc-${Date.now()}`,
          trackId: newTrackId,
          name: asset.name,
          color: track.color,
          kind: 'audio',
          sourceClipId: audioClipId,
          startBeat: 0,
          lengthBeats: totalBeats,
          offsetBeats: 0,
        });
      });
      this.selectedTrackId = newTrackId;
      this.selectedTrackIds = [newTrackId];
      this.setNotice(`Bounced "${track.name}" to new Audio track`);
    } catch {
      this.setNotice(`Bounce failed for "${track.name}"`);
    }
  }

  public async exportTrackAudioWav(trackId: string): Promise<void> {
    await this.ensureAudioReady();
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    try {
      const { buffer } = await renderTrackToAudioBuffer(
        this.project,
        trackId,
        this.midi.getDecodedAssets()
      );
      const blob = audioBufferToWavBlob(buffer);
      this.triggerBlobDownload(blob, `${sanitizeFilename(track.name)}-stem.wav`);
      this.setNotice(`Exported "${track.name}" WAV audio`);
    } catch {
      this.setNotice('Track audio export failed');
    }
  }

  public saveTrackPreset(trackId: string, presetName?: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const preset: SavedTrackPreset = {
      id: `tpreset-${Date.now()}`,
      name: presetName?.trim() || `${track.name} Preset`,
      type: track.type,
      color: track.color,
      instrument: structuredClone(track.instrument),
      effects: structuredClone(track.effects),
      createdAt: Date.now(),
    };
    this.savedTrackPresets = [preset, ...this.savedTrackPresets];
    try {
      localStorage.setItem(TRACK_PRESETS_STORAGE_KEY, JSON.stringify(this.savedTrackPresets));
    } catch {
      // ignore
    }
    this.setNotice(`Saved track preset "${preset.name}"`);
    this.emit();
  }

  public addScene(): void {
    const idx = this.project.scenes.length + 1;
    this.mutateProject((d) => {
      d.scenes.push({ id: `scene-${Date.now()}`, name: `${idx} · Scene` });
      for (const track of d.tracks) {
        track.sessionSlots.push(null);
      }
    });
  }

  public createSessionMidiClip(trackId: string, sceneIndex: number): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const clipId = `midi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const beatsPerBar = this.project.timeSignature[0] || 4;
    const newClip: MidiClip = {
      id: clipId,
      name: `${track.name} ${sceneIndex + 1}`,
      color: track.color,
      lengthBeats: beatsPerBar,
      notes: [],
    };
    this.mutateProject((d) => {
      d.midiClips[clipId] = newClip;
      const tr = d.tracks.find((t) => t.id === trackId);
      if (tr) tr.sessionSlots[sceneIndex] = clipId;
    });
    this.selectedTrackId = trackId;
    this.selectedTrackIds = [trackId];
    this.editingMidiClipId = clipId;
    this.emit();
  }

  public deleteSessionClip(trackId: string, sceneIndex: number): void {
    const runtime = this.session.getTrackRuntime(trackId);
    const tr = this.project.tracks.find((t) => t.id === trackId);
    const clipId = tr?.sessionSlots[sceneIndex];
    if (clipId && runtime.activeClipId === clipId) {
      this.session.stopTrack(trackId, false);
    }
    this.mutateProject((d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      if (track) track.sessionSlots[sceneIndex] = null;
    });
  }

  public openMidiClipEditor(clipId: string, trackId?: string): void {
    if (trackId) {
      this.selectedTrackId = trackId;
      this.selectedTrackIds = [trackId];
    }
    if (this.project.midiClips[clipId]) {
      this.editingMidiClipId = clipId;
    }
    this.emit();
  }

  // --- Track Mixer Controls ---

  public setTrackVolume(trackId: string, volumeDb: number): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.volumeDb = Math.max(-48, Math.min(6, volumeDb));
    }, false);
  }

  public setTrackPan(trackId: string, pan: number): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.pan = Math.max(-1, Math.min(1, pan));
    }, false);
  }

  public setTrackSend(trackId: string, sendType: 'reverb' | 'delay', amount: number): void {
    const clamped = Math.max(0, Math.min(1, amount));
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      if (sendType === 'reverb') t.sendReverb = clamped;
      else t.sendDelay = clamped;
    }, false);
  }

  public toggleTrackMute(trackId: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.muted = !t.muted;
    });
  }

  public toggleTrackSolo(trackId: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.solo = !t.solo;
    });
  }

  public toggleTrackArm(trackId: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.armed = !t.armed;
    });
  }

  public getTrackMeter(trackId: string): number {
    if (!this.audioInitialized) return 0;
    const fxMeter = this.effects.getTrackMeterNormalized(trackId);
    if (fxMeter !== null) return fxMeter;
    return this.mixer.getTrackMeterNormalized(trackId);
  }

  public getMasterMeter(): number {
    if (!this.audioInitialized) return 0;
    return this.mixer.getMasterMeterNormalized();
  }

  // --- Piano Roll / Live Gesture MIDI Performance & Recording ---

  public async auditionMidiNote(trackId: string, pitch: number, velocity = 95): Promise<void> {
    await this.ensureAudioReady();
    const safeVel = Math.max(1, Math.min(MAX_SAFE_MIDI_VELOCITY, Math.round(velocity)));
    this.midi.triggerMidiNote(trackId, pitch, 0.25, Tone.now(), safeVel / 127);
  }

  public liveNoteOn(trackId: string, pitch: number, velocity = 95, channel = 1): void {
    const safePitch = Math.max(21, Math.min(108, Math.round(pitch)));
    const safeVel = Math.max(1, Math.min(MAX_SAFE_MIDI_VELOCITY, Math.round(velocity)));
    const key = `${trackId}:${safePitch}`;

    if (!this.audioInitialized) {
      this.pendingWarmupNotes.add(key);
      void this.ensureAudioReady().then(() => {
        if (this.pendingWarmupNotes.has(key)) {
          this.pendingWarmupNotes.delete(key);
          this.midi.noteOn(trackId, safePitch, safeVel / 127, Tone.now() + 0.002);
        }
      });
    } else {
      if (Tone.getContext().state !== 'running') {
        void Tone.start();
      }
      this.midi.noteOn(trackId, safePitch, safeVel / 127, Tone.now() + 0.002);
    }

    if (this.liveMidiRec && this.liveMidiRec.trackId === trackId) {
      const localBeat = Math.max(0, this.currentBeat - this.liveMidiRec.recordStartBeat);
      this.liveMidiRec.openNotes.set(safePitch, {
        startBeat: localBeat,
        velocity: safeVel,
        channel,
      });
    }
  }

  public liveNoteOff(trackId: string, pitch: number): void {
    const safePitch = Math.max(21, Math.min(108, Math.round(pitch)));
    this.pendingWarmupNotes.delete(`${trackId}:${safePitch}`);
    if (this.audioInitialized) {
      this.midi.noteOff(trackId, safePitch, Tone.now() + 0.002);
    }

    if (this.liveMidiRec && this.liveMidiRec.trackId === trackId) {
      const open = this.liveMidiRec.openNotes.get(safePitch);
      if (open) {
        this.liveMidiRec.openNotes.delete(safePitch);
        const endLocalBeat = Math.max(
          open.startBeat + 0.125,
          this.currentBeat - this.liveMidiRec.recordStartBeat
        );
        const durationBeats = Math.max(0.125, endLocalBeat - open.startBeat);
        this.commitLiveRecordedNote(this.liveMidiRec.clipId, {
          pitch: safePitch,
          startBeat: Math.round(open.startBeat * 16) / 16,
          durationBeats: Math.round(durationBeats * 16) / 16,
          velocity: open.velocity,
          channel: open.channel,
        });
      }
    }
  }

  private commitLiveRecordedNote(clipId: string, note: Omit<MidiNote, 'id'>): void {
    if (!this.liveMidiRec) return;
    this.liveMidiRec.noteCount += 1;
    const beatsPerBar = this.project.timeSignature[0] || 4;
    const neededBars = Math.max(1, Math.ceil((note.startBeat + note.durationBeats) / beatsPerBar));
    const neededBeats = neededBars * beatsPerBar;

    this.mutateProject((d) => {
      const clip = d.midiClips[clipId];
      if (!clip) return;
      clip.notes.push({
        id: `gn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ...note,
      });
      if (neededBeats > clip.lengthBeats) {
        clip.lengthBeats = Math.min(64, neededBeats);
      }
      if (this.liveMidiRec?.arrangementClipId) {
        const arr = d.arrangementClips.find((c) => c.id === this.liveMidiRec?.arrangementClipId);
        if (arr && neededBeats > arr.lengthBeats) {
          arr.lengthBeats = Math.min(64, neededBeats);
        }
      }
    }, false);
  }

  public async startLiveMidiRecording(
    target: 'session' | 'arrangement',
    trackId: string
  ): Promise<void> {
    await this.ensureAudioReady();
    if (this.liveMidiRec) {
      this.stopLiveMidiRecording();
    }

    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const beatsPerBar = this.project.timeSignature[0] || 4;
    const clipId = `gmidi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const recordStartBeat =
      target === 'arrangement'
        ? Math.floor(this.currentBeat / beatsPerBar) * beatsPerBar
        : 0;
    const clipCount = Object.keys(this.project.midiClips).length + 1;

    const newClip: MidiClip = {
      id: clipId,
      name: `Gesture Take ${clipCount}`,
      color: track.color,
      lengthBeats: beatsPerBar * 2,
      notes: [],
    };

    let arrangementClipId: string | undefined;

    this.mutateProject((d) => {
      d.midiClips[clipId] = newClip;
      const tr = d.tracks.find((t) => t.id === trackId);
      if (tr) {
        tr.armed = true;
        if (target === 'session') {
          const freeSlot = tr.sessionSlots.findIndex((s) => s === null);
          if (freeSlot !== -1) {
            tr.sessionSlots[freeSlot] = clipId;
          } else {
            const sceneIdx = d.scenes.length + 1;
            d.scenes.push({ id: `scene-${Date.now()}`, name: `${sceneIdx} · Gesture` });
            for (const other of d.tracks) {
              other.sessionSlots.push(other.id === trackId ? clipId : null);
            }
          }
        }
      }

      if (target === 'arrangement') {
        arrangementClipId = `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        d.arrangementClips.push({
          id: arrangementClipId,
          trackId,
          name: newClip.name,
          color: track.color,
          kind: 'midi',
          sourceClipId: clipId,
          startBeat: recordStartBeat,
          lengthBeats: beatsPerBar * 2,
          offsetBeats: 0,
        });
      }
    });

    this.selectedTrackId = trackId;
    this.editingMidiClipId = clipId;
    this.playbackMode = target;
    this.liveMidiRec = {
      target,
      trackId,
      clipId,
      arrangementClipId,
      recordStartBeat,
      noteCount: 0,
      openNotes: new Map(),
    };

    if (!this.transport.getIsPlaying()) {
      this.currentBeat = recordStartBeat;
      this.transport.setCurrentBeat(recordStartBeat);
      this.transport.setPlaying(true);
    }
    this.transport.setRecording(true);
    this.setNotice(
      `Recording Gesture MIDI into ${target === 'session' ? 'Session View' : 'Arrangement View'}`
    );
    this.emit();
  }

  public stopLiveMidiRecording(): void {
    const rec = this.liveMidiRec;
    if (!rec) return;

    // Flush any still-held notes
    for (const [pitch, open] of Array.from(rec.openNotes.entries())) {
      const endLocal = Math.max(open.startBeat + 0.25, this.currentBeat - rec.recordStartBeat);
      this.commitLiveRecordedNote(rec.clipId, {
        pitch,
        startBeat: Math.round(open.startBeat * 16) / 16,
        durationBeats: Math.max(0.125, Math.round((endLocal - open.startBeat) * 16) / 16),
        velocity: open.velocity,
        channel: open.channel,
      });
    }
    rec.openNotes.clear();
    const count = rec.noteCount;
    const targetLabel = rec.target === 'session' ? 'Session View' : 'Arrangement View';
    this.liveMidiRec = null;
    this.transport.setRecording(false);
    this.setNotice(`Recorded ${count} MIDI note${count === 1 ? '' : 's'} into ${targetLabel}`);
    this.emit();
  }

  public setTrackSustain(trackId: string, active: boolean): void {
    this.midi.setSustain(trackId, active);
    const target = this.project.tracks.find((t) => t.id === trackId);
    if (target) {
      target.instrument.params.sustainActive = active;
      this.emit();
    }
  }

  public panicAllNotes(trackId?: string): void {
    if (trackId) {
      this.midi.releaseTrackVoices(trackId);
    } else {
      this.midi.releaseAllVoices();
    }
    this.emit();
  }

  public getActiveVoiceCount(): number {
    return this.midi.getActiveVoiceCount();
  }

  public ensureGesturePianoTrack(): string {
    const existing = this.project.tracks.find(
      (t) => t.instrument.type === 'gesturePiano'
    );
    if (existing) {
      this.selectedTrackId = existing.id;
      this.emit();
      return existing.id;
    }

    const count = this.project.tracks.length;
    const newTrack = createTrackModel(count, 'Gesture Piano', 'midi', this.project.scenes.length, {
      color: '#8B5CF6',
      volumeDb: -2,
      instrument: {
        type: 'gesturePiano',
        params: {
          waveform: 'triangle',
          attack: 0.008,
          decay: 0.72,
          sustain: 0.24,
          release: 0.55,
          cutoff: 3200,
          resonance: 0.7,
          pianoPreset: 'acousticPiano',
        },
      },
      effects: createGesturePianoDefaultEffects(`gp-${Date.now()}`),
    });
    this.mutateProject((d) => {
      d.tracks.push(newTrack);
    });
    this.selectedTrackId = newTrack.id;
    this.emit();
    return newTrack.id;
  }

  private mutateMidiProject(mutator: (draft: ProjectState) => void, recordHistory = true): void {
    if (recordHistory) {
      this.undoStack.push(structuredClone(this.project));
      if (this.undoStack.length > 40) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }

    const next = structuredClone(this.project);
    mutator(next);
    next.updatedAt = Date.now();
    this.project = next;

    this.scheduleAutosave();
    this.emit();
  }

  public addMidiNote(clipId: string, note: Omit<MidiNote, 'id'>): void {
    this.mutateMidiProject((d) => {
      const clip = d.midiClips[clipId];
      if (!clip) return;
      clip.notes.push({
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ...note,
      });
    }, true);
  }

  public updateMidiNote(clipId: string, noteId: string, patch: Partial<MidiNote>, recordHistory = true): void {
    this.mutateMidiProject((d) => {
      const clip = d.midiClips[clipId];
      if (!clip) return;
      const n = clip.notes.find((x) => x.id === noteId);
      if (!n) return;
      Object.assign(n, patch);
    }, recordHistory);
  }

  public deleteMidiNote(clipId: string, noteId: string): void {
    this.mutateMidiProject((d) => {
      const clip = d.midiClips[clipId];
      if (!clip) return;
      clip.notes = clip.notes.filter((n) => n.id !== noteId);
    }, true);
  }

  public quantizeMidiClip(clipId: string, grid: GridResolution): void {
    const gridBeats = gridResolutionToBeats(grid);
    this.mutateMidiProject((d) => {
      const clip = d.midiClips[clipId];
      if (!clip) return;
      for (const note of clip.notes) {
        note.startBeat = Math.max(
          0,
          Math.min(
            clip.lengthBeats - gridBeats,
            Math.round(note.startBeat / gridBeats) * gridBeats
          )
        );
        note.durationBeats = Math.max(
          gridBeats,
          Math.round(note.durationBeats / gridBeats) * gridBeats
        );
      }
    }, true);
  }

  public setMidiClipLength(clipId: string, lengthBeats: number): void {
    this.mutateMidiProject((d) => {
      const clip = d.midiClips[clipId];
      if (!clip) return;
      clip.lengthBeats = Math.max(1, Math.min(32, lengthBeats));
    }, true);
  }

  // --- Arrangement View Operations ---

  public addSessionClipToArrangement(
    trackId: string,
    sourceClipId: string,
    startBeat: number
  ): void {
    const midi = this.project.midiClips[sourceClipId];
    const audio = this.project.audioClips[sourceClipId];
    const source = midi ?? audio;
    if (!source) return;

    const newClip: ArrangementClip = {
      id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trackId,
      name: source.name,
      color: source.color,
      kind: midi ? 'midi' : 'audio',
      sourceClipId,
      startBeat: Math.max(0, startBeat),
      lengthBeats: source.lengthBeats,
      offsetBeats: 0,
    };

    this.mutateProject((d) => {
      d.arrangementClips.push(newClip);
    });
  }

  private clipClipboard: ArrangementClip | null = null;

  public moveArrangementClip(clipId: string, newStartBeat: number, newTrackId?: string): void {
    this.mutateProject((d) => {
      const clip = d.arrangementClips.find((c) => c.id === clipId);
      if (!clip) return;
      clip.startBeat = Math.max(0, newStartBeat);
      if (newTrackId) {
        clip.trackId = newTrackId;
      }
    });
  }

  public moveArrangementClips(
    clipIds: string[],
    beatDelta: number,
    targetTrackId?: string,
    sourceTrackId?: string,
    orderedTrackIds?: string[]
  ): void {
    this.mutateProject((d) => {
      const clips = d.arrangementClips.filter((c) => clipIds.includes(c.id));
      if (clips.length === 0) return;

      let trackIdMap: Record<string, string> = {};
      if (targetTrackId && sourceTrackId && orderedTrackIds) {
        const srcIdx = orderedTrackIds.indexOf(sourceTrackId);
        const tgtIdx = orderedTrackIds.indexOf(targetTrackId);
        if (srcIdx !== -1 && tgtIdx !== -1) {
          const trackOffset = tgtIdx - srcIdx;
          for (const c of clips) {
            const curIdx = orderedTrackIds.indexOf(c.trackId);
            if (curIdx !== -1) {
              const newIdx = Math.max(0, Math.min(orderedTrackIds.length - 1, curIdx + trackOffset));
              trackIdMap[c.id] = orderedTrackIds[newIdx];
            } else {
              trackIdMap[c.id] = targetTrackId;
            }
          }
        }
      }

      for (const clip of clips) {
        clip.startBeat = Math.max(0, clip.startBeat + beatDelta);
        if (trackIdMap[clip.id]) {
          clip.trackId = trackIdMap[clip.id];
        } else if (targetTrackId) {
          clip.trackId = targetTrackId;
        }
      }
    });
  }

  public resizeArrangementClip(clipId: string, newLengthBeats: number): void {
    this.mutateProject((d) => {
      const clip = d.arrangementClips.find((c) => c.id === clipId);
      if (!clip) return;
      clip.lengthBeats = Math.max(0.5, newLengthBeats);
    });
  }

  public duplicateArrangementClip(clipId: string): void {
    this.duplicateArrangementClips([clipId]);
  }

  public duplicateArrangementClips(clipIds: string[]): void {
    this.mutateProject((d) => {
      const clips = d.arrangementClips.filter((c) => clipIds.includes(c.id));
      for (const clip of clips) {
        let newSourceId = clip.sourceClipId;
        if (clip.kind === 'midi' && d.midiClips[clip.sourceClipId]) {
          const srcMidi = d.midiClips[clip.sourceClipId];
          const newMidiId = `midi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          d.midiClips[newMidiId] = {
            ...structuredClone(srcMidi),
            id: newMidiId,
            notes: srcMidi.notes.map((n, ni) => ({ ...n, id: `${newMidiId}-n-${ni}` })),
          };
          newSourceId = newMidiId;
        }
        d.arrangementClips.push({
          ...structuredClone(clip),
          id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sourceClipId: newSourceId,
          startBeat: clip.startBeat + clip.lengthBeats,
        });
      }
    });
  }

  public copyArrangementClip(clipId: string): void {
    const c = this.project.arrangementClips.find((x) => x.id === clipId);
    if (!c) return;
    this.clipClipboard = structuredClone(c);
    this.setNotice(`Copied clip "${c.name}"`);
  }

  public cutArrangementClip(clipId: string): void {
    const c = this.project.arrangementClips.find((x) => x.id === clipId);
    if (!c) return;
    this.clipClipboard = structuredClone(c);
    this.deleteArrangementClip(clipId);
    this.setNotice(`Cut clip "${c.name}"`);
  }

  public pasteArrangementClip(targetTrackId: string, beat: number): void {
    if (!this.clipClipboard) return;
    this.mutateProject((d) => {
      let newSourceId = this.clipClipboard!.sourceClipId;
      if (this.clipClipboard!.kind === 'midi' && d.midiClips[this.clipClipboard!.sourceClipId]) {
        const srcM = d.midiClips[this.clipClipboard!.sourceClipId];
        const newMId = `midi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        d.midiClips[newMId] = {
          ...structuredClone(srcM),
          id: newMId,
          notes: srcM.notes.map((n, ni) => ({ ...n, id: `${newMId}-n-${ni}` })),
        };
        newSourceId = newMId;
      }
      d.arrangementClips.push({
        ...structuredClone(this.clipClipboard!),
        id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        trackId: targetTrackId,
        sourceClipId: newSourceId,
        startBeat: Math.max(0, beat),
      });
    });
    this.setNotice('Pasted clip');
  }

  public setClipColor(sourceClipId: string, color: string, arrClipId?: string): void {
    this.mutateProject((d) => {
      if (d.midiClips[sourceClipId]) d.midiClips[sourceClipId].color = color;
      if (d.audioClips[sourceClipId]) d.audioClips[sourceClipId].color = color;
      if (arrClipId) {
        const ac = d.arrangementClips.find((c) => c.id === arrClipId);
        if (ac) ac.color = color;
      }
      for (const ac of d.arrangementClips) {
        if (ac.sourceClipId === sourceClipId) ac.color = color;
      }
    });
  }

  public splitArrangementClipAtBeat(clipId: string, splitBeat: number): void {
    this.mutateProject((d) => {
      const idx = d.arrangementClips.findIndex((c) => c.id === clipId);
      if (idx === -1) return;
      const clip = d.arrangementClips[idx];
      if (splitBeat <= clip.startBeat + 0.25 || splitBeat >= clip.startBeat + clip.lengthBeats - 0.25) {
        return;
      }
      const leftLen = splitBeat - clip.startBeat;
      const rightLen = clip.lengthBeats - leftLen;
      clip.lengthBeats = leftLen;
      d.arrangementClips.splice(idx + 1, 0, {
        ...structuredClone(clip),
        id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        startBeat: splitBeat,
        lengthBeats: rightLen,
        offsetBeats: clip.offsetBeats + leftLen,
      });
    });
  }

  public deleteArrangementClip(clipId: string): void {
    this.deleteArrangementClips([clipId]);
  }

  public deleteArrangementClips(clipIds: string[]): void {
    this.mutateProject((d) => {
      d.arrangementClips = d.arrangementClips.filter((c) => !clipIds.includes(c.id));
    });
  }

  public renameClip(clipName: string, sourceClipId: string, arrClipId?: string): void {
    const trimmed = clipName.trim();
    if (!trimmed) return;
    this.mutateProject((d) => {
      if (d.midiClips[sourceClipId]) d.midiClips[sourceClipId].name = trimmed;
      if (d.audioClips[sourceClipId]) d.audioClips[sourceClipId].name = trimmed;
      if (arrClipId) {
        const ac = d.arrangementClips.find((c) => c.id === arrClipId);
        if (ac) ac.name = trimmed;
      }
      for (const ac of d.arrangementClips) {
        if (ac.sourceClipId === sourceClipId) ac.name = trimmed;
      }
    });
  }

  public toggleArrangementClipLoop(clipId: string): void {
    this.mutateProject((d) => {
      const clip = d.arrangementClips.find((c) => c.id === clipId);
      if (!clip) return;
      clip.looped = clip.looped === false ? true : false;
    });
  }

  public transposeMidiClip(sourceClipId: string, semitones: number): void {
    this.mutateProject((d) => {
      const mc = d.midiClips[sourceClipId];
      if (!mc) return;
      for (const n of mc.notes) {
        n.pitch = Math.max(21, Math.min(108, n.pitch + semitones));
      }
    });
    this.setNotice(`Transposed MIDI clip ${semitones > 0 ? `+${semitones}` : semitones} st`);
  }

  public exportMidiClip(sourceClipId: string): void {
    const mc = this.project.midiClips[sourceClipId];
    if (!mc) return;
    const blob = midiClipToSmfBlob(mc, this.project.bpm, this.project.swingPercent ?? 0);
    this.triggerBlobDownload(blob, `${sanitizeFilename(mc.name)}.mid`);
    this.setNotice(`Exported "${mc.name}.mid"`);
  }

  public async reverseAudioClip(audioClipId: string): Promise<void> {
    await this.ensureAudioReady();
    const meta = this.project.audioClips[audioClipId];
    if (!meta) return;
    const srcBuf = this.midi.getDecodedAssets().get(meta.assetId);
    if (!srcBuf) return;
    const ctx = Tone.getContext().rawContext as AudioContext;
    const revBuf = reverseAudioBuffer(ctx, srcBuf);
    const asset = await this.storeAudioBufferAsAsset(`${meta.name} (Rev)`, revBuf);
    this.mutateProject((d) => {
      const c = d.audioClips[audioClipId];
      if (!c) return;
      c.assetId = asset.id;
      c.peaks = asset.peaks;
      c.durationSeconds = asset.durationSeconds;
    });
    this.setNotice(`Reversed "${meta.name}"`);
  }

  public async normalizeAudioClip(audioClipId: string): Promise<void> {
    await this.ensureAudioReady();
    const meta = this.project.audioClips[audioClipId];
    if (!meta) return;
    const srcBuf = this.midi.getDecodedAssets().get(meta.assetId);
    if (!srcBuf) return;
    const ctx = Tone.getContext().rawContext as AudioContext;
    const normBuf = normalizeAudioBuffer(ctx, srcBuf, 0.95);
    const asset = await this.storeAudioBufferAsAsset(`${meta.name} (Norm)`, normBuf);
    this.mutateProject((d) => {
      const c = d.audioClips[audioClipId];
      if (!c) return;
      c.assetId = asset.id;
      c.peaks = asset.peaks;
      c.durationSeconds = asset.durationSeconds;
    });
    this.setNotice(`Normalized "${meta.name}"`);
  }

  public async cropAudioClip(arrClipId: string): Promise<void> {
    await this.ensureAudioReady();
    const arr = this.project.arrangementClips.find((c) => c.id === arrClipId);
    if (!arr || arr.kind !== 'audio') return;
    const meta = this.project.audioClips[arr.sourceClipId];
    if (!meta) return;
    const srcBuf = this.midi.getDecodedAssets().get(meta.assetId);
    if (!srcBuf) return;
    const secPerBeat = 60 / this.project.bpm;
    const startSec = arr.offsetBeats * secPerBeat;
    const durSec = arr.lengthBeats * secPerBeat;
    const ctx = Tone.getContext().rawContext as AudioContext;
    const cropped = cropAudioBuffer(ctx, srcBuf, startSec, durSec, 1);
    const asset = await this.storeAudioBufferAsAsset(`${meta.name} (Crop)`, cropped);
    const newClipId = `aclip-crop-${Date.now()}`;
    this.mutateProject((d) => {
      d.audioClips[newClipId] = {
        id: newClipId,
        name: `${meta.name} (Crop)`,
        color: meta.color,
        assetId: asset.id,
        durationSeconds: asset.durationSeconds,
        lengthBeats: arr.lengthBeats,
        peaks: asset.peaks,
      };
      const targetArr = d.arrangementClips.find((c) => c.id === arrClipId);
      if (targetArr) {
        targetArr.sourceClipId = newClipId;
        targetArr.offsetBeats = 0;
        targetArr.name = `${meta.name} (Crop)`;
      }
    });
    this.setNotice(`Cropped "${meta.name}"`);
  }

  public async editAudioClipWithOptions(
    audioClipId: string,
    arrClipId: string | undefined,
    opts: { trimStartSec: number; trimEndSec: number; gainDb: number }
  ): Promise<void> {
    await this.ensureAudioReady();
    const meta = this.project.audioClips[audioClipId];
    if (!meta) return;
    const srcBuf = this.midi.getDecodedAssets().get(meta.assetId);
    if (!srcBuf) return;
    const ctx = Tone.getContext().rawContext as AudioContext;
    const startSec = Math.max(0, Math.min(srcBuf.duration - 0.05, opts.trimStartSec));
    const endSec = Math.max(startSec + 0.05, Math.min(srcBuf.duration, opts.trimEndSec));
    const gainLinear = Math.pow(10, Math.max(-24, Math.min(12, opts.gainDb)) / 20);
    const edited = cropAudioBuffer(ctx, srcBuf, startSec, endSec - startSec, gainLinear);
    const asset = await this.storeAudioBufferAsAsset(meta.name, edited);
    const newLengthBeats = Math.max(
      0.5,
      Math.round((edited.duration * (this.project.bpm / 60)) * 4) / 4
    );
    this.mutateProject((d) => {
      const c = d.audioClips[audioClipId];
      if (c) {
        c.assetId = asset.id;
        c.durationSeconds = asset.durationSeconds;
        c.lengthBeats = newLengthBeats;
        c.peaks = asset.peaks;
      }
      if (arrClipId) {
        const ac = d.arrangementClips.find((x) => x.id === arrClipId);
        if (ac) {
          ac.offsetBeats = 0;
          ac.lengthBeats = newLengthBeats;
        }
      }
    });
    this.setNotice(`Updated audio clip "${meta.name}"`);
  }

  public getDecodedAudioBuffer(assetId: string): AudioBuffer | null {
    return this.midi.getDecodedAssets().get(assetId) ?? null;
  }

  public exportAudioClipWav(audioClipId: string): void {
    const meta = this.project.audioClips[audioClipId];
    if (!meta) return;
    const buf = this.midi.getDecodedAssets().get(meta.assetId);
    if (!buf) {
      this.setNotice('Audio buffer not loaded yet');
      return;
    }
    const blob = audioBufferToWavBlob(buf);
    this.triggerBlobDownload(blob, `${sanitizeFilename(meta.name)}.wav`);
    this.setNotice(`Exported "${meta.name}.wav"`);
  }

  public duplicateSessionClip(trackId: string, sceneIndex: number): void {
    const tr = this.project.tracks.find((t) => t.id === trackId);
    const clipId = tr?.sessionSlots[sceneIndex];
    if (!tr || !clipId) return;
    const midi = this.project.midiClips[clipId];
    const audio = this.project.audioClips[clipId];
    if (!midi && !audio) return;

    this.mutateProject((d) => {
      const targetTrack = d.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return;
      let nextSlot = targetTrack.sessionSlots.findIndex((s, i) => i > sceneIndex && s === null);
      if (nextSlot === -1) {
        nextSlot = targetTrack.sessionSlots.length;
        const scIdx = d.scenes.length + 1;
        d.scenes.push({ id: `scene-${Date.now()}`, name: `${scIdx} · Scene` });
        for (const t of d.tracks) t.sessionSlots.push(null);
      }
      if (midi) {
        const cid = `midi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        d.midiClips[cid] = {
          ...structuredClone(midi),
          id: cid,
          name: `${midi.name} Copy`,
          notes: midi.notes.map((n, i) => ({ ...n, id: `${cid}-n-${i}` })),
        };
        targetTrack.sessionSlots[nextSlot] = cid;
      } else if (audio) {
        targetTrack.sessionSlots[nextSlot] = clipId;
      }
    });
  }

  private triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  public toggleTrackAutomationView(trackId: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (t) t.showAutomation = !t.showAutomation;
    }, false);
  }

  public setTrackAutomationTarget(trackId: string, target: AutomationTarget): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.activeAutomationTarget = target;
      const lane = t.automationLanes.find((l) => l.target === target);
      if (lane) lane.enabled = true;
    }, false);
  }

  public toggleAutomationLaneEnabled(trackId: string, target: AutomationTarget): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      const lane = t?.automationLanes.find((l) => l.target === target);
      if (lane) lane.enabled = !lane.enabled;
    });
  }

  public upsertAutomationPoint(trackId: string, target: AutomationTarget, beat: number, value: number): void {
    const clampedBeat = Math.max(0, Math.round(beat * 4) / 4);
    const clampedVal = Math.max(0, Math.min(1, value));
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      const lane = t?.automationLanes.find((l) => l.target === target);
      if (!lane) return;
      lane.enabled = true;
      const near = lane.points.find((p) => Math.abs(p.beat - clampedBeat) < 0.25);
      if (near) {
        near.beat = clampedBeat;
        near.value = clampedVal;
      } else {
        lane.points.push({
          id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          beat: clampedBeat,
          value: clampedVal,
        });
      }
      lane.points.sort((a, b) => a.beat - b.beat);
    });
  }

  // --- Device & Effects Chain Operations ---

  public setTrackInstrumentType(trackId: string, type: InstrumentConfig['type']): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.instrument.type = type;
    });
  }

  public updateTrackInstrumentParams(
    trackId: string,
    patch: Partial<InstrumentConfig['params']>
  ): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      Object.assign(t.instrument.params, patch);
    }, false);
  }

  public getInstrumentCatalog(): InstrumentCatalogEntry[] {
    const builtins = getBuiltinCatalogEntries();
    const sf2Entries: InstrumentCatalogEntry[] = [];
    for (const bank of this.soundBanks) {
      for (const preset of bank.presetsMeta) {
        sf2Entries.push({
          id: preset.id,
          name: preset.name,
          category: preset.category,
          description: `${bank.name} · Bank ${preset.bank} · Prog ${preset.program}`,
          source: 'soundfont',
          soundBankId: bank.id,
          soundBankName: bank.name,
          bank: preset.bank,
          program: preset.program,
          midiChannel: preset.isDrumKit ? 10 : 1,
          isDrumKit: preset.isDrumKit,
          defaultPitch: preset.isDrumKit ? 36 : 60,
          defaultParams: {
            instrumentId: preset.id,
            instrumentName: preset.name,
            instrumentCategory: preset.category,
            soundBankId: bank.id,
            bankNumber: preset.bank,
            programNumber: preset.program,
            midiChannel: preset.isDrumKit ? 10 : 1,
            attack: 0.005,
            decay: 0.38,
            sustain: 0.72,
            release: 0.35,
            cutoff: 12000,
            resonance: 0.75,
            chorus: 0.08,
            oscVolume: 0,
            pitchSemitones: 0,
            pitchBendSemitones: 0,
            pitchBendRange: 2,
          },
        });
      }
    }
    return [...builtins, ...sf2Entries];
  }

  public isSoundBankInMemory(bankId: string): boolean {
    return isSf2BankLoadedInMemory(bankId);
  }

  public getSoundFontMemoryStats(): { bankCount: number; decodedZones: number; approxMb: number } {
    return getLoadedSf2MemoryStats();
  }

  public async assignTrackInstrument(
    trackId: string,
    entry: InstrumentCatalogEntry
  ): Promise<void> {
    const existing = this.project.tracks.find((t) => t.id === trackId);
    if (!existing || existing.isGroupFolder) return;

    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.instrument = {
        type: 'soundfont',
        params: {
          ...t.instrument.params,
          ...entry.defaultParams,
          waveform: 'triangle',
          instrumentId: entry.id,
          instrumentName: entry.name,
          instrumentCategory: entry.category,
          soundBankId: entry.soundBankId,
          bankNumber: entry.bank,
          programNumber: entry.program,
          midiChannel: entry.midiChannel,
          oscVolume: t.instrument.params.oscVolume ?? 0,
          pitchSemitones: t.instrument.params.pitchSemitones ?? 0,
          pitchBendSemitones: 0,
          pitchBendRange: t.instrument.params.pitchBendRange ?? 2,
        },
      };
    });

    this.recordRecentInstrument(entry.id);

    this.instrumentLoading = { presetId: entry.id, name: entry.name, progress: 0.1 };
    this.emit();
    try {
      await this.ensureAudioReady();
      const updatedTrack = this.project.tracks.find((t) => t.id === trackId);
      if (updatedTrack) {
        await this.midi.ensureTrackSoundfontLoaded(updatedTrack, (loaded, total) => {
          this.instrumentLoading = {
            presetId: entry.id,
            name: entry.name,
            progress: total > 0 ? Math.min(1, loaded / total) : 1,
          };
          this.emit();
        });
      }
    } finally {
      this.instrumentLoading = null;
      this.emit();
    }

    this.setNotice(`Loaded "${entry.name}" on "${existing.name}" (MIDI notes preserved)`);
  }

  public async setTrackProgram(
    trackId: string,
    bank: number,
    program: number
  ): Promise<void> {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const bankId = track.instrument.params.soundBankId ?? BUILTIN_BANK_ID;
    const catalog = this.getInstrumentCatalog();
    const match =
      catalog.find((c) => c.soundBankId === bankId && c.bank === bank && c.program === program) ??
      catalog.find((c) => c.bank === bank && c.program === program) ??
      catalog.find((c) => c.program === program);
    if (match) {
      await this.assignTrackInstrument(trackId, match);
    }
  }

  public setTrackPitchBend(trackId: string, semitones: number): void {
    const clamped = Math.max(-12, Math.min(12, semitones));
    const t = this.project.tracks.find((tr) => tr.id === trackId);
    if (t) {
      t.instrument.params.pitchBendSemitones = clamped;
    }
    if (this.audioInitialized) {
      this.midi.setPitchBend(trackId, clamped);
    }
    this.emit();
  }

  public async previewInstrumentPreset(
    entry: InstrumentCatalogEntry,
    pitch?: number
  ): Promise<void> {
    this.instrumentLoading = { presetId: entry.id, name: entry.name, progress: 0.15 };
    this.emit();
    try {
      await this.ensureAudioReady();
      const masterIn = this.mixer.getMasterInput();
      if (!masterIn) return;

      const previewTrack: TrackModel = {
        ...createTrackModel(0, '__preview__', 'midi', 1, {
          id: INSTRUMENT_PREVIEW_TRACK_ID,
          instrument: {
            type: 'soundfont',
            params: {
              waveform: 'triangle',
              attack: entry.defaultParams.attack ?? 0.005,
              decay: entry.defaultParams.decay ?? 0.45,
              sustain: entry.defaultParams.sustain ?? 0.5,
              release: entry.defaultParams.release ?? 0.35,
              cutoff: entry.defaultParams.cutoff ?? 12000,
              resonance: entry.defaultParams.resonance ?? 0.75,
              oscVolume: 0,
              pitchSemitones: 0,
              chorus: entry.defaultParams.chorus ?? 0,
              pitchBendSemitones: 0,
              pitchBendRange: 2,
              instrumentId: entry.id,
              instrumentName: entry.name,
              instrumentCategory: entry.category,
              soundBankId: entry.soundBankId,
              bankNumber: entry.bank,
              programNumber: entry.program,
              midiChannel: entry.midiChannel,
            },
          },
        }),
      };

      this.midi.syncTrackInstrument(previewTrack, masterIn);
      await this.midi.ensureTrackSoundfontLoaded(previewTrack, (loaded, total) => {
        this.instrumentLoading = {
          presetId: entry.id,
          name: entry.name,
          progress: total > 0 ? Math.min(1, loaded / total) : 1,
        };
        this.emit();
      });

      const now = Tone.now() + 0.015;
      const basePitch = pitch ?? entry.defaultPitch;
      if (entry.isDrumKit) {
        // Trigger punchy preview groove: Kick -> Hat -> Snare
        this.midi.triggerMidiNote(INSTRUMENT_PREVIEW_TRACK_ID, 36, 0.25, now, 0.85, { channel: 10 });
        this.midi.triggerMidiNote(INSTRUMENT_PREVIEW_TRACK_ID, 42, 0.18, now + 0.16, 0.72, { channel: 10 });
        this.midi.triggerMidiNote(INSTRUMENT_PREVIEW_TRACK_ID, 38, 0.25, now + 0.32, 0.85, { channel: 10 });
      } else {
        // Trigger clean musical triad preview
        this.midi.triggerMidiNote(INSTRUMENT_PREVIEW_TRACK_ID, basePitch, 0.7, now, 0.82);
        this.midi.triggerMidiNote(INSTRUMENT_PREVIEW_TRACK_ID, basePitch + 4, 0.58, now + 0.12, 0.74);
        this.midi.triggerMidiNote(INSTRUMENT_PREVIEW_TRACK_ID, basePitch + 7, 0.55, now + 0.24, 0.78);
      }
      this.recordRecentInstrument(entry.id);
    } finally {
      this.instrumentLoading = null;
      this.emit();
    }
  }

  public toggleFavoriteInstrument(instrumentId: string): void {
    if (this.favoriteInstrumentIds.includes(instrumentId)) {
      this.favoriteInstrumentIds = this.favoriteInstrumentIds.filter((id) => id !== instrumentId);
    } else {
      this.favoriteInstrumentIds = [instrumentId, ...this.favoriteInstrumentIds];
    }
    try {
      localStorage.setItem(
        FAVORITE_INSTRUMENTS_STORAGE_KEY,
        JSON.stringify(this.favoriteInstrumentIds)
      );
    } catch {
      // ignore
    }
    this.emit();
  }

  private recordRecentInstrument(instrumentId: string): void {
    const next = [instrumentId, ...this.recentInstrumentIds.filter((id) => id !== instrumentId)].slice(
      0,
      12
    );
    this.recentInstrumentIds = next;
    try {
      localStorage.setItem(RECENT_INSTRUMENTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  public clearSoundBankError(): void {
    this.soundBankError = null;
    this.emit();
  }

  public async importSoundFontFile(file: File): Promise<SoundBankSummary | null> {
    this.soundBankError = null;
    if (!file.name.toLowerCase().endsWith('.sf2')) {
      const msg = 'Unsupported format: please select a SoundFont 2 (.sf2) file.';
      this.soundBankError = msg;
      this.setNotice(msg);
      this.emit();
      return null;
    }

    this.instrumentLoading = { presetId: 'sf2-import', name: file.name, progress: 0.25 };
    this.emit();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = parseSf2Buffer(arrayBuffer, file.name);
      const bankId = `sf2bank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const presetsMeta = buildSoundBankPresetsMeta(bankId, parsed);

      const bank: StoredSoundBank = {
        id: bankId,
        name: parsed.name || file.name.replace(/\.sf2$/i, ''),
        fileName: file.name,
        sizeBytes: arrayBuffer.byteLength,
        engineName: parsed.engineName,
        author: parsed.author,
        presetsMeta,
        arrayBuffer,
        createdAt: Date.now(),
      };

      registerParsedSf2Bank(bankId, arrayBuffer, parsed);
      await saveSoundBankToDb(bank);
      this.soundBanks = await listSoundBankSummariesFromDb();
      this.instrumentLoading = null;
      this.setNotice(`Imported SoundFont "${bank.name}" (${presetsMeta.length} presets)`);
      this.emit();
      return this.soundBanks.find((b) => b.id === bankId) ?? null;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Could not import SoundFont "${file.name}": corrupted or incompatible file.`;
      this.instrumentLoading = null;
      this.soundBankError = msg;
      this.setNotice(msg);
      this.emit();
      return null;
    }
  }

  public unloadSoundBankFromRam(bankId: string): void {
    const freed = unloadSf2BankFromMemory(bankId);
    const bank = this.soundBanks.find((b) => b.id === bankId);
    this.setNotice(
      `Unloaded "${bank?.name ?? 'Sound Bank'}" from RAM (${freed} cached zones freed)`
    );
    this.emit();
  }

  public unloadBuiltinInstrumentCache(presetId?: string): void {
    if (presetId) {
      unloadBuiltinPresetFromCache(presetId);
    }
    this.emit();
  }

  public async deleteSoundBank(bankId: string): Promise<void> {
    unloadSf2BankFromMemory(bankId);
    await deleteSoundBankFromDb(bankId);
    this.soundBanks = this.soundBanks.filter((b) => b.id !== bankId);
    this.setNotice('Deleted SoundFont bank from library');
    this.emit();
  }

  public addTrackEffect(trackId: string, type: EffectType): void {
    const fx = createDefaultEffect(type, undefined, true);
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.effects.push(fx);
    });
  }

  public updateTrackEffect(
    trackId: string,
    effectId: string,
    patch: Partial<EffectConfig> & { paramPatch?: Record<string, number | string> }
  ): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      const fx = t?.effects.find((e) => e.id === effectId);
      if (!fx) return;
      if (typeof patch.enabled === 'boolean') fx.enabled = patch.enabled;
      if (patch.paramPatch) {
        Object.assign(fx.params, patch.paramPatch);
      }
    }, false);
  }

  public removeTrackEffect(trackId: string, effectId: string): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.effects = t.effects.filter((e) => e.id !== effectId);
    });
  }

  public moveTrackEffect(trackId: string, effectId: string, delta: -1 | 1): void {
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      const idx = t.effects.findIndex((e) => e.id === effectId);
      const target = idx + delta;
      if (idx === -1 || target < 0 || target >= t.effects.length) return;
      const [item] = t.effects.splice(idx, 1);
      t.effects.splice(target, 0, item);
    });
  }

  // --- Browser Library Application ---

  public applyLibraryPreset(item: LibraryPresetItem): void {
    const trackId = this.selectedTrackId;
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    if (item.effectType) {
      this.addTrackEffect(trackId, item.effectType);
      this.setNotice(`Added ${item.name} to ${track.name}`);
      return;
    }

    if (item.instrumentType) {
      this.mutateProject((d) => {
        const t = d.tracks.find((tr) => tr.id === trackId);
        if (!t) return;
        t.instrument.type = item.instrumentType!;
        if (item.instrumentPatch) {
          Object.assign(t.instrument.params, item.instrumentPatch);
        }
      });
      this.setNotice(`Loaded ${item.name} on ${track.name}`);
      return;
    }

    if (item.midiAction && this.editingMidiClipId && this.project.midiClips[this.editingMidiClipId]) {
      const clipId = this.editingMidiClipId;
      this.mutateProject((d) => {
        const clip = d.midiClips[clipId];
        if (!clip) return;
        if (item.midiAction === 'arp-cm') {
          const pitches = [60, 63, 67, 70, 67, 63, 60, 55, 58, 62, 65, 67, 63, 62, 60, 58];
          clip.lengthBeats = 4;
          clip.notes = pitches.map((p, i) => ({
            id: `arp-${Date.now()}-${i}`,
            pitch: p,
            startBeat: i * 0.25,
            durationBeats: 0.22,
            velocity: 92 + (i % 4 === 0 ? 18 : 0),
          }));
        } else if (item.midiAction === 'chord-pad-cm') {
          clip.lengthBeats = 8;
          const chords = [
            { beat: 0, dur: 3.8, notes: [60, 63, 67, 74] },
            { beat: 4, dur: 1.9, notes: [56, 60, 63, 67] },
            { beat: 6, dur: 1.9, notes: [58, 62, 65, 69] },
          ];
          clip.notes = chords.flatMap((c, ci) =>
            c.notes.map((p, ni) => ({
              id: `ch-${Date.now()}-${ci}-${ni}`,
              pitch: p,
              startBeat: c.beat,
              durationBeats: c.dur,
              velocity: 92,
            }))
          );
        } else if (item.midiAction === 'humanize') {
          for (const n of clip.notes) {
            const jitter = Math.round((Math.random() - 0.5) * 24);
            n.velocity = Math.max(35, Math.min(125, n.velocity + jitter));
          }
        } else if (item.midiAction === 'double-octave') {
          const doubled = clip.notes
            .filter((n) => n.pitch + 12 <= 96)
            .map((n, i) => ({
              ...n,
              id: `oct-${Date.now()}-${i}`,
              pitch: n.pitch + 12,
              velocity: Math.max(40, Math.round(n.velocity * 0.82)),
            }));
          clip.notes.push(...doubled);
        }
      });
      this.setNotice(`Applied ${item.name} to clip`);
    }
  }

  // --- Audio File Import & Sample Loading ---

  public async importAudioFile(
    file: File,
    target?: { trackId: string; sceneIndex?: number; startBeat?: number }
  ): Promise<StoredAudioAsset | null> {
    await this.ensureAudioReady();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      const decoded = await rawCtx.decodeAudioData(arrayBuffer.slice(0));
      const peaks = extractPeaks(decoded, 64);

      const asset: StoredAudioAsset = {
        id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        mimeType: file.type || 'audio/wav',
        durationSeconds: decoded.duration,
        peaks,
        arrayBuffer,
        createdAt: Date.now(),
      };

      this.midi.registerDecodedAsset(asset.id, decoded);
      await saveAudioAssetToDb(asset);
      this.audioAssets = [asset, ...this.audioAssets];

      if (target) {
        this.assignAudioAssetToTarget(asset, target.trackId, target.sceneIndex, target.startBeat);
      }

      this.setNotice(`Imported audio sample "${asset.name}"`);
      this.emit();
      return asset;
    } catch {
      this.setNotice(`Could not decode audio file "${file.name}"`);
      return null;
    }
  }

  private async ingestRecordedAudioBlob(
    trackId: string,
    startBeat: number,
    blob: Blob
  ): Promise<void> {
    const file = new File([blob], `Recording ${new Date().toLocaleTimeString()}`, {
      type: blob.type || 'audio/webm',
    });
    await this.importAudioFile(file, { trackId, startBeat });
  }

  public async assignAudioAssetToTarget(
    asset: StoredAudioAsset,
    trackId: string,
    sceneIndex?: number,
    startBeat?: number
  ): Promise<void> {
    await this.ensureAudioReady();
    if (!this.midi.getDecodedAssets().has(asset.id)) {
      const stored = await loadAudioAssetFromDb(asset.id);
      if (stored) {
        const rawCtx = Tone.getContext().rawContext as AudioContext;
        const decoded = await rawCtx.decodeAudioData(stored.arrayBuffer.slice(0));
        this.midi.registerDecodedAsset(asset.id, decoded);
      }
    }

    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const lengthBeats = Math.max(
      1,
      Math.round((asset.durationSeconds * (this.project.bpm / 60)) * 4) / 4
    );
    const audioClipId = `aclip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

    this.mutateProject((d) => {
      d.audioClips[audioClipId] = {
        id: audioClipId,
        name: asset.name,
        color: track.color,
        assetId: asset.id,
        durationSeconds: asset.durationSeconds,
        lengthBeats,
        peaks: asset.peaks,
      };

      if (typeof sceneIndex === 'number') {
        const tr = d.tracks.find((t) => t.id === trackId);
        if (tr) tr.sessionSlots[sceneIndex] = audioClipId;
      } else {
        d.arrangementClips.push({
          id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          trackId,
          name: asset.name,
          color: track.color,
          kind: 'audio',
          sourceClipId: audioClipId,
          startBeat: startBeat ?? 0,
          lengthBeats,
          offsetBeats: 0,
        });
      }
    });
  }

  public loadSampleIntoTrackSampler(asset: StoredAudioAsset): void {
    const trackId = this.selectedTrackId;
    this.mutateProject((d) => {
      const t = d.tracks.find((tr) => tr.id === trackId);
      if (!t) return;
      t.instrument.type = 'sampler';
      t.instrument.params.sampleAssetId = asset.id;
      t.instrument.params.sampleName = asset.name;
    });
    this.setNotice(`Loaded "${asset.name}" into Sampler`);
  }

  public async deleteStoredAudioAsset(assetId: string): Promise<void> {
    await deleteAudioAssetFromDb(assetId);
    this.audioAssets = this.audioAssets.filter((a) => a.id !== assetId);
    this.emit();
  }

  // --- Project Management & WAV Export ---

  public renameProject(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutateProject((d) => {
      d.name = trimmed;
    });
  }

  public async createNewProject(): Promise<void> {
    await this.stop();
    const fresh = createDefaultProject();
    fresh.id = `project-${Date.now()}`;
    fresh.name = `PulseGrid Session ${this.savedProjects.length + 1}`;
    this.project = fresh;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedTrackId = fresh.tracks[0]?.id ?? 'drums';
    this.editingMidiClipId = 'drums-0';
    this.syncAudioGraph();
    await saveProjectToDb(fresh);
    this.savedProjects = await listProjectsFromDb();
    this.setNotice(`Created "${fresh.name}"`);
    this.emit();
  }

  public async saveCurrentProject(): Promise<void> {
    await saveProjectToDb(this.project);
    this.savedProjects = await listProjectsFromDb();
    this.setNotice(`Saved "${this.project.name}"`);
    this.emit();
  }

  public async loadProject(projectId: string): Promise<void> {
    await this.stop();
    const loaded = await loadProjectFromDb(projectId);
    if (!loaded) return;
    this.project = loaded;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedTrackId = loaded.tracks[0]?.id ?? '';
    this.editingMidiClipId = Object.keys(loaded.midiClips)[0] ?? null;
    this.syncAudioGraph();
    this.setNotice(`Loaded "${loaded.name}"`);
    this.emit();
  }

  public async deleteSavedProject(projectId: string): Promise<void> {
    if (projectId === this.project.id) return;
    await deleteProjectFromDb(projectId);
    this.savedProjects = await listProjectsFromDb();
    this.emit();
  }

  public async exportProjectWav(): Promise<void> {
    await this.ensureAudioReady();
    this.setNotice('Rendering WAV mixdown...');
    try {
      const blob = await renderProjectToWav(this.project, this.midi.getDecodedAssets());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.setNotice('Exported 16-bit WAV mixdown');
    } catch {
      this.setNotice('WAV export failed');
    }
  }

  public async exportProjectJson(
    projectId?: string,
    includeAudioAssets = true,
    pretty = true
  ): Promise<string> {
    let targetProject = this.project;
    if (projectId && projectId !== this.project.id) {
      const loaded = await loadProjectFromDb(projectId);
      if (loaded) targetProject = loaded;
    }

    const bundle = buildProjectExportBundle(targetProject, this.audioAssets, includeAudioAssets);
    const jsonString = pretty ? JSON.stringify(bundle, null, 2) : JSON.stringify(bundle);
    const filename = `${sanitizeFilename(targetProject.name)}.pulsegrid.json`;

    triggerJsonDownload(jsonString, filename);
    this.setNotice(`Exported composition "${targetProject.name}" (.pulsegrid.json)`);
    return filename;
  }

  public async getProjectJsonString(
    projectId?: string,
    includeAudioAssets = false,
    pretty = true
  ): Promise<string> {
    let targetProject = this.project;
    if (projectId && projectId !== this.project.id) {
      const loaded = await loadProjectFromDb(projectId);
      if (loaded) targetProject = loaded;
    }
    const bundle = buildProjectExportBundle(targetProject, this.audioAssets, includeAudioAssets);
    return pretty ? JSON.stringify(bundle, null, 2) : JSON.stringify(bundle);
  }

  public async importProjectFromJsonFile(
    file: File,
    asNewProject = false
  ): Promise<ProjectState | null> {
    this.setNotice(`Reading ${file.name}...`);
    try {
      const text = await file.text();
      return await this.importProjectFromJsonString(text, asNewProject, file.name);
    } catch (err) {
      const msg = (err as Error).message || 'Failed to read file';
      this.setNotice(`Import failed: ${msg}`);
      return null;
    }
  }

  public async importProjectFromJsonString(
    jsonString: string,
    asNewProject = false,
    _sourceFileName?: string
  ): Promise<ProjectState | null> {
    try {
      const { project: imported, restoredAssets, warnings } = parseAndValidateProjectJson(jsonString);

      // Handle existing project ID collision or asNewProject flag
      const existing = await loadProjectFromDb(imported.id);
      if (asNewProject || existing) {
        imported.id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (existing) {
          imported.name = `${imported.name} (Imported)`;
        }
      }

      // Restore and save any embedded audio assets
      if (restoredAssets.length > 0) {
        const rawCtx = Tone.getContext().rawContext as AudioContext;
        for (const asset of restoredAssets) {
          await saveAudioAssetToDb(asset);
          if (asset.arrayBuffer && asset.arrayBuffer.byteLength > 0 && rawCtx) {
            try {
              const copy = asset.arrayBuffer.slice(0);
              const decoded = await rawCtx.decodeAudioData(copy);
              this.midi.registerDecodedAsset(asset.id, decoded);
            } catch {
              // Ignore decoding failure for non-audio data
            }
          }
          if (!this.audioAssets.some((a) => a.id === asset.id)) {
            this.audioAssets = [asset, ...this.audioAssets];
          }
        }
      }

      // Stop current playback and save imported project
      await this.stop();
      await saveProjectToDb(imported);
      this.savedProjects = await listProjectsFromDb();

      // Load imported project into active DAW state
      this.project = imported;
      this.undoStack = [];
      this.redoStack = [];
      this.selectedTrackId = imported.tracks[0]?.id ?? '';
      this.editingMidiClipId = Object.keys(imported.midiClips)[0] ?? null;
      this.syncAudioGraph();

      const warningText = warnings.length > 0 ? ` (${warnings.length} warning)` : '';
      this.setNotice(`Imported "${imported.name}" successfully!${warningText}`);
      this.emit();
      return imported;
    } catch (err) {
      const msg = (err as Error).message || 'Invalid PulseGrid project';
      this.setNotice(`Import failed: ${msg}`);
      return null;
    }
  }
}

export function orderTracksHierarchically(tracks: TrackModel[]): TrackModel[] {
  const validGroupIds = new Set(tracks.filter((t) => t.isGroupFolder).map((t) => t.id));
  const result: TrackModel[] = [];
  const emitted = new Set<string>();

  for (const track of tracks) {
    if (emitted.has(track.id)) continue;
    if (track.isGroupFolder) {
      result.push(track);
      emitted.add(track.id);
      const children = tracks.filter((c) => !c.isGroupFolder && c.groupId === track.id);
      const childById = new Map(children.map((c) => [c.id, c]));
      if (Array.isArray(track.childTrackIds)) {
        for (const cid of track.childTrackIds) {
          const c = childById.get(cid);
          if (c && !emitted.has(c.id)) {
            result.push(c);
            emitted.add(c.id);
          }
        }
      }
      for (const c of children) {
        if (!emitted.has(c.id)) {
          result.push(c);
          emitted.add(c.id);
        }
      }
    } else if (!track.groupId || !validGroupIds.has(track.groupId)) {
      result.push(track);
      emitted.add(track.id);
    }
  }

  for (const track of tracks) {
    if (!emitted.has(track.id)) {
      result.push(track);
      emitted.add(track.id);
    }
  }
  return result;
}

export function gridResolutionToBeats(grid: GridResolution): number {
  switch (grid) {
    case '1/4':
      return 1;
    case '1/8':
      return 0.5;
    case '1/16':
      return 0.25;
    case '1/32':
      return 0.125;
    case '1/8T':
      return 1 / 3;
    case '1/16T':
      return 1 / 6;
  }
}

export function loopSnapToBeats(snap: LoopSnapMode, beatsPerBar = 4): number {
  switch (snap) {
    case 'bar':
      return Math.max(1, beatsPerBar);
    case '1/2':
      return Math.max(1, beatsPerBar / 2);
    case '1/4':
      return 1;
    case '1/8':
      return 0.5;
    case 'off':
    default:
      return 0.125;
  }
}

export const dawController = new DawController();
