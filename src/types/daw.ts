export type TrackType = 'midi' | 'audio';
export type ViewMode =
  | 'session'
  | 'arrangement'
  | 'pianoroll'
  | 'mixer'
  | 'devices'
  | 'browser'
  | 'gesture-piano';
export type MobileScreen = 'session' | 'arrangement' | 'pianoroll' | 'mixer' | 'gesture-piano';
export type QuantizeMode = '1m' | '2n' | '4n';
export type LoopSnapMode = 'bar' | '1/2' | '1/4' | '1/8' | 'off';
export type GridResolution = '1/4' | '1/8' | '1/16' | '1/32' | '1/8T' | '1/16T';
export type InstrumentType =
  | 'synth'
  | 'drumSynth'
  | 'bassSynth'
  | 'sampler'
  | 'gesturePiano'
  | 'soundfont';
export type GesturePianoPreset = 'acousticPiano' | 'electricPiano' | 'softPiano' | 'synthPiano';
export type InstrumentCategory = 'Keyboard' | 'Strings' | 'Bass' | 'Drums' | 'Synth';
export type EffectType = 'eq' | 'compressor' | 'reverb' | 'delay' | 'distortion' | 'filter';
export type AutomationTarget = 'volume' | 'pan' | 'filterCutoff';

export interface MidiNote {
  id: string;
  pitch: number; // MIDI note 21..108 (88 keys) or 24..96
  startBeat: number; // 0-based within clip
  durationBeats: number;
  velocity: number; // 1..127
  channel?: number; // MIDI channel 1..16
  pitchSlide?: Array<{ beatOffset: number; semitones: number }>; // Note slide / pitch glide
  mpe?: {
    pressure?: Array<{ beatOffset: number; value: number }>; // 0..127
    timbre?: Array<{ beatOffset: number; value: number }>; // 0..127
  };
}

export interface MidiClip {
  id: string;
  name: string;
  color: string;
  lengthBeats: number; // e.g. 4 = 1 bar in 4/4, 8 = 2 bars
  notes: MidiNote[];
  rootNote?: string; // e.g. 'C'
  scale?: string; // e.g. 'Major'
  scaleHighlight?: boolean;
  scaleSnap?: boolean;
}

export interface AudioClipMeta {
  id: string;
  name: string;
  color: string;
  assetId: string;
  durationSeconds: number;
  lengthBeats: number;
  peaks: number[]; // Normalized 0..1 waveform peaks
}

export interface ArrangementClip {
  id: string;
  trackId: string;
  name: string;
  color: string;
  kind: 'midi' | 'audio';
  sourceClipId: string; // MidiClip id or AudioClipMeta id
  startBeat: number;
  lengthBeats: number;
  offsetBeats: number; // Trim/start offset inside source clip
  looped?: boolean; // Whether MIDI clip loops across lengthBeats (default true)
}

export interface AutomationPoint {
  id: string;
  beat: number;
  value: number; // Normalized 0..1
}

export interface AutomationLane {
  target: AutomationTarget;
  enabled: boolean;
  points: AutomationPoint[];
}

export interface InstrumentConfig {
  type: InstrumentType;
  params: {
    waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
    attack: number; // 0.001..0.5
    decay: number; // 0.05..1.5
    sustain: number; // 0..1
    release: number; // 0.05..2.5
    cutoff: number; // 150..16000 Hz
    resonance: number; // 0.5..12 Q
    oscVolume?: number; // -24..6 dB
    pitchSemitones?: number; // -24..24 st
    sampleAssetId?: string;
    sampleName?: string;
    pianoPreset?: GesturePianoPreset;
    // Real Instrument / SoundFont Library fields
    instrumentId?: string;
    instrumentName?: string;
    instrumentCategory?: InstrumentCategory;
    soundBankId?: string; // 'builtin' or stored SoundBank ID
    bankNumber?: number; // MIDI Bank MSB/LSB 0..128
    programNumber?: number; // MIDI Program 0..127
    midiChannel?: number; // 1..16 (10 = drums)
    chorus?: number; // 0..1 wet/depth
    pitchBendSemitones?: number; // -12..12 live pitch bend
    pitchBendRange?: number; // max semitone range (default 2)
    sustainActive?: boolean; // CC64 sustain pedal state
  };
}

export interface SoundBankPresetMeta {
  id: string;
  bankId: string;
  bank: number;
  program: number;
  name: string;
  category: InstrumentCategory;
  isDrumKit: boolean;
  zoneCount: number;
}

export interface StoredSoundBank {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  engineName?: string;
  author?: string;
  presetsMeta: SoundBankPresetMeta[];
  arrayBuffer: ArrayBuffer;
  createdAt: number;
}

export interface SoundBankSummary {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  engineName?: string;
  author?: string;
  presetsMeta: SoundBankPresetMeta[];
  createdAt: number;
}

export interface InstrumentCatalogEntry {
  id: string;
  name: string;
  category: InstrumentCategory;
  description: string;
  source: 'builtin' | 'soundfont';
  soundBankId: string;
  soundBankName: string;
  bank: number;
  program: number;
  midiChannel: number;
  isDrumKit: boolean;
  defaultPitch: number;
  defaultParams: Partial<InstrumentConfig['params']>;
}

export interface EffectConfig {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number | string>;
}

export interface FrozenTrackBackup {
  type: TrackType;
  instrument: InstrumentConfig;
  effects: EffectConfig[];
  arrangementClips: ArrangementClip[];
  sessionSlots: Array<string | null>;
}

export interface TrackModel {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  volumeDb: number;
  pan: number; // -1..1
  sendReverb?: number; // 0..1
  sendDelay?: number; // 0..1
  muted: boolean;
  solo: boolean;
  armed: boolean;
  instrument: InstrumentConfig;
  effects: EffectConfig[];
  sessionSlots: Array<string | null>; // Clip ID per scene row
  automationLanes: AutomationLane[];
  showAutomation: boolean;
  activeAutomationTarget: AutomationTarget;
  groupId?: string; // ID of parent group if nested
  isGroupFolder?: boolean; // True if this track functions as a group folder header & bus
  childTrackIds?: string[]; // Ordered IDs of child tracks belonging to this group
  collapsed?: boolean; // True if group folder is collapsed
  frozen?: boolean;
  frozenAudioAssetId?: string;
  frozenGroupClipId?: string;
  frozenBackup?: FrozenTrackBackup;
}

export interface SavedTrackPreset {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  instrument: InstrumentConfig;
  effects: EffectConfig[];
  createdAt: number;
}

export interface SceneModel {
  id: string;
  name: string;
}

export interface ProjectState {
  id: string;
  name: string;
  updatedAt: number;
  bpm: number;
  timeSignature: [number, number];
  quantize: QuantizeMode;
  swingPercent?: number; // 0..100 global swing/groove amount
  metronomeEnabled: boolean;
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  loopSnap?: LoopSnapMode;
  masterVolumeDb: number;
  tracks: TrackModel[];
  scenes: SceneModel[];
  midiClips: Record<string, MidiClip>;
  audioClips: Record<string, AudioClipMeta>;
  arrangementClips: ArrangementClip[];
}

export interface StoredAudioAsset {
  id: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  peaks: number[];
  arrayBuffer: ArrayBuffer;
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  bpm: number;
  trackCount: number;
  updatedAt: number;
}
