import { CLIPS, DrumStep, SynthStep } from './loops';
import {
  EffectConfig,
  EffectType,
  InstrumentConfig,
  MidiClip,
  MidiNote,
  ProjectState,
  TrackModel,
} from '../types/daw';
import { BUILTIN_BANK_ID, findBuiltinDefinition } from '../audio/builtinSoundBank';

export const TRACK_COLORS = [
  '#F59E0B', // Amber (Drums)
  '#38BDF8', // Sky (Bass)
  '#34D399', // Emerald (Chords)
  '#FB7185', // Rose (Lead)
  '#A78BFA', // Violet
  '#F97316', // Orange
  '#2DD4BF', // Teal
  '#E879F9', // Fuchsia
];

export const DRUM_MIDI_MAP: Array<{ pitch: number; label: string; short: string }> = [
  { pitch: 46, label: 'Open Hat', short: 'OH' },
  { pitch: 42, label: 'Closed Hat', short: 'CH' },
  { pitch: 39, label: 'Clap', short: 'CP' },
  { pitch: 37, label: 'Rimshot', short: 'RM' },
  { pitch: 38, label: 'Snare', short: 'SN' },
  { pitch: 36, label: 'Kick', short: 'KK' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function noteNameToMidi(note: string): number {
  const match = note.match(/^([A-G])([b#]?)(-?\d+)$/);
  if (!match) return 60;
  const baseMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semitone = baseMap[match[1]] ?? 0;
  if (match[2] === '#') semitone += 1;
  if (match[2] === 'b') semitone -= 1;
  const octave = parseInt(match[3], 10);
  return (octave + 1) * 12 + semitone;
}

function durationToBeats(dur: string): number {
  switch (dur) {
    case '1m':
      return 4;
    case '2n':
      return 2;
    case '4n.':
      return 1.5;
    case '4n':
      return 1;
    case '8n':
      return 0.5;
    case '16n':
      return 0.25;
    case '32n':
      return 0.125;
    default:
      return 0.25;
  }
}

function convertDrumPatternToNotes(clipId: string, pattern: Record<number, DrumStep>): MidiNote[] {
  const notes: MidiNote[] = [];
  let idx = 0;
  for (const [stepStr, hit] of Object.entries(pattern)) {
    const step = Number(stepStr);
    const startBeat = step * 0.25;
    const velocity = Math.round((hit.vel ?? 0.9) * 115);
    if (hit.kick) {
      notes.push({ id: `${clipId}-n-${idx++}`, pitch: 36, startBeat, durationBeats: 0.25, velocity });
    }
    if (hit.snare) {
      notes.push({ id: `${clipId}-n-${idx++}`, pitch: 38, startBeat, durationBeats: 0.25, velocity });
    }
    if (hit.clap) {
      notes.push({ id: `${clipId}-n-${idx++}`, pitch: 39, startBeat, durationBeats: 0.25, velocity });
    }
    if (hit.rim) {
      notes.push({ id: `${clipId}-n-${idx++}`, pitch: 37, startBeat, durationBeats: 0.25, velocity: Math.round(velocity * 0.85) });
    }
    if (hit.hat) {
      notes.push({ id: `${clipId}-n-${idx++}`, pitch: 42, startBeat, durationBeats: 0.25, velocity: Math.round(velocity * 0.78) });
    }
    if (hit.openHat) {
      notes.push({ id: `${clipId}-n-${idx++}`, pitch: 46, startBeat, durationBeats: 0.5, velocity: Math.round(velocity * 0.82) });
    }
  }
  return notes;
}

function convertSynthPatternToNotes(clipId: string, pattern: Record<number, SynthStep>): MidiNote[] {
  const notes: MidiNote[] = [];
  let idx = 0;
  for (const [stepStr, ev] of Object.entries(pattern)) {
    const startBeat = Number(stepStr) * 0.25;
    const durationBeats = durationToBeats(ev.duration);
    const velocity = Math.round((ev.velocity ?? 0.85) * 115);
    for (const noteName of ev.notes) {
      notes.push({
        id: `${clipId}-n-${idx++}`,
        pitch: noteNameToMidi(noteName),
        startBeat,
        durationBeats,
        velocity,
      });
    }
  }
  return notes;
}

export function createDefaultEffect(
  type: EffectType,
  idSuffix?: string,
  enabled = false
): EffectConfig {
  const id = `fx-${type}-${idSuffix ?? Math.random().toString(36).slice(2, 8)}`;
  switch (type) {
    case 'eq':
      return { id, type, enabled, params: { low: 0, mid: 0, high: 0, frequency: 1000, q: 1.0 } };
    case 'compressor':
      return { id, type, enabled, params: { threshold: -18, ratio: 2.5, attack: 0.015, release: 0.2 } };
    case 'reverb':
      return { id, type, enabled, params: { decay: 1.6, wet: 0.18 } };
    case 'delay':
      return { id, type, enabled, params: { delayTime: 0.35, feedback: 0.26, wet: 0.14 } };
    case 'distortion':
      return { id, type, enabled, params: { amount: 0.22, wet: 0.25 } };
    case 'filter':
      return { id, type, enabled, params: { frequency: 3200, resonance: 0.9, filterType: 'lowpass' } };
  }
}

export function createGesturePianoDefaultEffects(prefix = 'gp'): EffectConfig[] {
  return [
    createDefaultEffect('eq', `${prefix}-eq`, false),
    createDefaultEffect('compressor', `${prefix}-comp`, false),
    createDefaultEffect('reverb', `${prefix}-rev`, false),
    createDefaultEffect('delay', `${prefix}-del`, false),
  ];
}

export function createDefaultInstrument(
  type: InstrumentConfig['type'],
  instrumentId?: string
): InstrumentConfig {
  switch (type) {
    case 'soundfont': {
      const def = findBuiltinDefinition({ instrumentId: instrumentId ?? 'kb-acoustic-grand' });
      return {
        type: 'soundfont',
        params: {
          waveform: 'triangle',
          attack: def.defaultAttack,
          decay: def.defaultDecay,
          sustain: def.defaultSustain,
          release: def.defaultRelease,
          cutoff: def.defaultCutoff,
          resonance: def.defaultResonance,
          oscVolume: 0,
          pitchSemitones: 0,
          chorus: def.defaultChorus,
          pitchBendSemitones: 0,
          pitchBendRange: 2,
          sustainActive: false,
          instrumentId: def.id,
          instrumentName: def.name,
          instrumentCategory: def.category,
          soundBankId: BUILTIN_BANK_ID,
          bankNumber: def.bank,
          programNumber: def.program,
          midiChannel: def.midiChannel,
        },
      };
    }
    case 'drumSynth':
      return {
        type: 'drumSynth',
        params: { waveform: 'sine', attack: 0.001, decay: 0.3, sustain: 0.05, release: 0.18, cutoff: 8000, resonance: 0.8, oscVolume: 0, pitchSemitones: 0 },
      };
    case 'bassSynth':
      return {
        type: 'bassSynth',
        params: { waveform: 'sawtooth', attack: 0.008, decay: 0.22, sustain: 0.45, release: 0.16, cutoff: 950, resonance: 2.2, oscVolume: 0, pitchSemitones: 0 },
      };
    case 'sampler':
      return {
        type: 'sampler',
        params: { waveform: 'triangle', attack: 0.008, decay: 0.4, sustain: 0.8, release: 0.25, cutoff: 10000, resonance: 0.8, oscVolume: 0, pitchSemitones: 0 },
      };
    case 'gesturePiano':
      return {
        type: 'gesturePiano',
        params: {
          waveform: 'triangle',
          attack: 0.008,
          decay: 0.72,
          sustain: 0.24,
          release: 0.55,
          cutoff: 3200,
          resonance: 0.7,
          oscVolume: 0,
          pitchSemitones: 0,
          pianoPreset: 'acousticPiano',
        },
      };
    case 'synth':
    default:
      return {
        type: 'synth',
        params: { waveform: 'sawtooth', attack: 0.015, decay: 0.32, sustain: 0.5, release: 0.35, cutoff: 2600, resonance: 1.2, oscVolume: 0, pitchSemitones: 0 },
      };
  }
}

export function getTrackInstrumentDisplayName(track: TrackModel): string {
  if (track.isGroupFolder) return 'Group Bus';
  if (track.type === 'audio' && track.instrument.type === 'sampler') return 'Audio Track';
  const p = track.instrument.params;
  if (track.instrument.type === 'soundfont') {
    if (p.instrumentName) return p.instrumentName;
    const def = findBuiltinDefinition({
      instrumentId: p.instrumentId,
      bankNumber: p.bankNumber,
      programNumber: p.programNumber,
      midiChannel: p.midiChannel,
    });
    return def.name;
  }
  switch (track.instrument.type) {
    case 'gesturePiano': {
      if (p.pianoPreset === 'electricPiano') return 'Electric Tine Piano';
      if (p.pianoPreset === 'synthPiano') return 'Synth Piano';
      if (p.pianoPreset === 'softPiano') return 'Felt Soft Piano';
      return 'Concert Grand Piano';
    }
    case 'drumSynth':
      return 'Drum Machine';
    case 'bassSynth':
      return 'Mono Bass Synth';
    case 'sampler':
      return 'One-Shot Sampler';
    case 'synth':
    default:
      return 'Poly Synthesizer';
  }
}

export function createTrackModel(
  index: number,
  name: string,
  type: 'midi' | 'audio',
  sceneCount: number,
  options?: {
    id?: string;
    color?: string;
    volumeDb?: number;
    instrument?: InstrumentConfig;
    effects?: EffectConfig[];
    sessionSlots?: Array<string | null>;
  }
): TrackModel {
  const id = options?.id ?? `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const color = options?.color ?? TRACK_COLORS[index % TRACK_COLORS.length];
  return {
    id,
    name,
    type,
    color,
    volumeDb: options?.volumeDb ?? -4,
    pan: 0,
    sendReverb: 0,
    sendDelay: 0,
    muted: false,
    solo: false,
    armed: false,
    instrument: options?.instrument ?? createDefaultInstrument(type === 'midi' ? 'synth' : 'sampler'),
    effects: options?.effects ?? [],
    sessionSlots: options?.sessionSlots ?? Array.from({ length: sceneCount }, () => null),
    showAutomation: false,
    activeAutomationTarget: 'volume',
    automationLanes: [
      { target: 'volume', enabled: false, points: [{ id: `${id}-v0`, beat: 0, value: 0.78 }, { id: `${id}-v1`, beat: 16, value: 0.78 }] },
      { target: 'pan', enabled: false, points: [{ id: `${id}-p0`, beat: 0, value: 0.5 }, { id: `${id}-p1`, beat: 16, value: 0.5 }] },
      { target: 'filterCutoff', enabled: false, points: [{ id: `${id}-f0`, beat: 0, value: 0.65 }, { id: `${id}-f1`, beat: 16, value: 0.65 }] },
    ],
  };
}

export function createDefaultProject(): ProjectState {
  const midiClips: Record<string, MidiClip> = {};

  const trackColors: Record<string, string> = {
    drums: '#2E9BFF',
    bass: '#22C55E',
    chords: '#8B5CF6',
    lead: '#F97316',
  };

  for (const clip of CLIPS) {
    const notes =
      clip.trackId === 'drums' && clip.drumPattern
        ? convertDrumPatternToNotes(clip.id, clip.drumPattern)
        : clip.synthPattern
          ? convertSynthPatternToNotes(clip.id, clip.synthPattern)
          : [];

    midiClips[clip.id] = {
      id: clip.id,
      name: clip.name,
      color: trackColors[clip.trackId] ?? '#2E9BFF',
      lengthBeats: clip.lengthSteps / 4,
      notes,
    };
  }

  const tracks: TrackModel[] = [
    createTrackModel(0, 'Drums', 'midi', 4, {
      id: 'drums',
      color: '#2E9BFF',
      volumeDb: -2,
      instrument: createDefaultInstrument('drumSynth'),
      effects: [createDefaultEffect('compressor', 'drums-1')],
      sessionSlots: ['drums-0', 'drums-1', 'drums-2', 'drums-3'],
    }),
    createTrackModel(1, 'Bass', 'midi', 4, {
      id: 'bass',
      color: '#22C55E',
      volumeDb: -3,
      instrument: createDefaultInstrument('bassSynth'),
      effects: [createDefaultEffect('eq', 'bass-1')],
      sessionSlots: ['bass-0', 'bass-1', 'bass-2', 'bass-3'],
    }),
    createTrackModel(2, 'Chords', 'midi', 4, {
      id: 'chords',
      color: '#8B5CF6',
      volumeDb: -4,
      instrument: {
        type: 'synth',
        params: { waveform: 'sawtooth', attack: 0.016, decay: 0.34, sustain: 0.52, release: 0.4, cutoff: 2500, resonance: 1.2 },
      },
      effects: [
        createDefaultEffect('filter', 'chords-1'),
        createDefaultEffect('reverb', 'chords-2'),
      ],
      sessionSlots: ['chords-0', 'chords-1', 'chords-2', 'chords-3'],
    }),
    createTrackModel(3, 'Lead', 'midi', 4, {
      id: 'lead',
      color: '#F97316',
      volumeDb: -6,
      instrument: {
        type: 'synth',
        params: { waveform: 'triangle', attack: 0.008, decay: 0.22, sustain: 0.34, release: 0.28, cutoff: 5200, resonance: 1.4 },
      },
      effects: [
        createDefaultEffect('delay', 'lead-1'),
        createDefaultEffect('reverb', 'lead-2'),
      ],
      sessionSlots: ['lead-0', 'lead-1', 'lead-2', 'lead-3'],
    }),
  ];

  return {
    id: 'project-default',
    name: 'PulseGrid Session 01',
    updatedAt: Date.now(),
    bpm: 120,
    timeSignature: [4, 4],
    quantize: '1m',
    swingPercent: 0,
    metronomeEnabled: false,
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 16,
    loopSnap: 'bar',
    masterVolumeDb: -12,
    tracks,
    scenes: [
      { id: 'scene-0', name: '1 · Pulse' },
      { id: 'scene-1', name: '2 · Drive' },
      { id: 'scene-2', name: '3 · Drift' },
      { id: 'scene-3', name: '4 · Peak' },
    ],
    midiClips,
    audioClips: {},
    arrangementClips: [
      {
        id: 'arr-1',
        trackId: 'drums',
        name: 'Four on Floor',
        color: '#2E9BFF',
        kind: 'midi',
        sourceClipId: 'drums-0',
        startBeat: 0,
        lengthBeats: 16,
        offsetBeats: 0,
      },
      {
        id: 'arr-2',
        trackId: 'bass',
        name: 'Sub Pulse',
        color: '#22C55E',
        kind: 'midi',
        sourceClipId: 'bass-0',
        startBeat: 0,
        lengthBeats: 16,
        offsetBeats: 0,
      },
      {
        id: 'arr-3',
        trackId: 'chords',
        name: 'Warm Stabs',
        color: '#8B5CF6',
        kind: 'midi',
        sourceClipId: 'chords-0',
        startBeat: 4,
        lengthBeats: 12,
        offsetBeats: 0,
      },
      {
        id: 'arr-4',
        trackId: 'lead',
        name: 'Pluck Arp',
        color: '#F97316',
        kind: 'midi',
        sourceClipId: 'lead-0',
        startBeat: 8,
        lengthBeats: 8,
        offsetBeats: 0,
      },
    ],
  };
}

export interface LibraryPresetItem {
  id: string;
  category: 'Sounds' | 'Drums' | 'Instruments' | 'MIDI Effects' | 'Audio Effects';
  subCategory?: 'Piano' | 'Synthesizer' | 'Drum Machine' | 'Sampler';
  name: string;
  description: string;
  instrumentType?: InstrumentConfig['type'];
  instrumentPatch?: Partial<InstrumentConfig['params']>;
  effectType?: EffectType;
  midiAction?: 'arp-cm' | 'chord-pad-cm' | 'euclidean-kick' | 'humanize' | 'double-octave';
  opensGesturePiano?: boolean;
}

export const LIBRARY_ITEMS: LibraryPresetItem[] = [
  // Sounds
  {
    id: 'snd-warm-pad',
    category: 'Sounds',
    name: 'Analog Warm Pad',
    description: 'Lush saw pad with soft attack',
    instrumentType: 'synth',
    instrumentPatch: { waveform: 'sawtooth', attack: 0.14, decay: 0.5, sustain: 0.72, release: 0.75, cutoff: 1900, resonance: 1.4 },
  },
  {
    id: 'snd-glass-pluck',
    category: 'Sounds',
    name: 'Glass FM Pluck',
    description: 'Crisp percussive triangle lead',
    instrumentType: 'synth',
    instrumentPatch: { waveform: 'triangle', attack: 0.004, decay: 0.22, sustain: 0.15, release: 0.25, cutoff: 4800, resonance: 1.8 },
  },
  {
    id: 'snd-acid-303',
    category: 'Sounds',
    name: 'Resonant 303 Bass',
    description: 'Squelchy square/saw mono bass',
    instrumentType: 'bassSynth',
    instrumentPatch: { waveform: 'sawtooth', attack: 0.003, decay: 0.18, sustain: 0.3, release: 0.12, cutoff: 780, resonance: 5.2 },
  },
  {
    id: 'snd-sub-sine',
    category: 'Sounds',
    name: 'Deep 808 Sub',
    description: 'Clean low-end sub triangle',
    instrumentType: 'bassSynth',
    instrumentPatch: { waveform: 'triangle', attack: 0.008, decay: 0.35, sustain: 0.65, release: 0.24, cutoff: 520, resonance: 1.0 },
  },

  // Drums
  {
    id: 'drm-909-kit',
    category: 'Drums',
    name: 'Studio 909 Kit',
    description: 'Punchy synthesized electronic drums',
    instrumentType: 'drumSynth',
    instrumentPatch: { decay: 0.32, cutoff: 9500 },
  },
  {
    id: 'drm-tight-kit',
    category: 'Drums',
    name: 'Tight Minimal Kit',
    description: 'Short snappy percussive transients',
    instrumentType: 'drumSynth',
    instrumentPatch: { decay: 0.18, cutoff: 6800 },
  },

  // Instruments (Piano, Synthesizer, Drum Machine, Sampler)
  {
    id: 'inst-gesture-piano',
    category: 'Instruments',
    subCategory: 'Piano',
    name: 'Concert Grand Piano',
    description: 'Dual-velocity layer acoustic grand piano with natural physical string resonance',
    instrumentType: 'gesturePiano',
    instrumentPatch: {
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
  {
    id: 'inst-piano-grand',
    category: 'Instruments',
    subCategory: 'Piano',
    name: 'Studio Acoustic Piano',
    description: 'Warm polyphonic acoustic piano voice',
    instrumentType: 'gesturePiano',
    instrumentPatch: {
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
  {
    id: 'inst-piano-ep',
    category: 'Instruments',
    subCategory: 'Piano',
    name: 'Electric Tine Piano',
    description: 'Warm bell-tine electric piano with soft chime',
    instrumentType: 'gesturePiano',
    instrumentPatch: {
      waveform: 'sine',
      attack: 0.01,
      decay: 0.68,
      sustain: 0.3,
      release: 0.5,
      cutoff: 2400,
      resonance: 0.7,
      pianoPreset: 'electricPiano',
    },
  },
  {
    id: 'inst-piano-synth',
    category: 'Instruments',
    subCategory: 'Piano',
    name: 'Synth Piano',
    description: 'Clean polyphonic synthesized piano with tunable ADSR & oscillator',
    instrumentType: 'gesturePiano',
    instrumentPatch: {
      waveform: 'triangle',
      attack: 0.008,
      decay: 0.58,
      sustain: 0.28,
      release: 0.45,
      cutoff: 3800,
      resonance: 0.8,
      pianoPreset: 'synthPiano',
    },
  },
  {
    id: 'inst-piano-soft',
    category: 'Instruments',
    subCategory: 'Piano',
    name: 'Felt Soft Piano',
    description: 'Intimate muted felt upright piano',
    instrumentType: 'gesturePiano',
    instrumentPatch: {
      waveform: 'sine',
      attack: 0.022,
      decay: 0.85,
      sustain: 0.26,
      release: 0.65,
      cutoff: 1450,
      resonance: 0.65,
      pianoPreset: 'softPiano',
    },
  },
  {
    id: 'inst-synth',
    category: 'Instruments',
    subCategory: 'Synthesizer',
    name: 'Poly Synthesizer',
    description: 'Multi-voice subtractive poly synth',
    instrumentType: 'synth',
  },
  {
    id: 'inst-drum',
    category: 'Instruments',
    subCategory: 'Drum Machine',
    name: 'Drum Machine',
    description: '6-voice synthesized percussion engine',
    instrumentType: 'drumSynth',
  },
  {
    id: 'inst-bass',
    category: 'Instruments',
    subCategory: 'Synthesizer',
    name: 'Mono Bass Synth',
    description: '24dB resonant filter bass synth',
    instrumentType: 'bassSynth',
  },
  {
    id: 'inst-sampler',
    category: 'Instruments',
    subCategory: 'Sampler',
    name: 'One-Shot Sampler',
    description: 'Play & pitch imported audio samples',
    instrumentType: 'sampler',
  },

  // MIDI Effects (real MIDI clip transformers!)
  {
    id: 'mfx-arp',
    category: 'MIDI Effects',
    name: 'C Minor Arp Pattern',
    description: 'Generate 16th-note arpeggio on active clip',
    midiAction: 'arp-cm',
  },
  {
    id: 'mfx-chord-pad',
    category: 'MIDI Effects',
    name: 'Cm9 Progression',
    description: 'Write 2-bar minor chord progression',
    midiAction: 'chord-pad-cm',
  },
  {
    id: 'mfx-humanize',
    category: 'MIDI Effects',
    name: 'Humanize Velocity',
    description: 'Add subtle velocity groove to clip notes',
    midiAction: 'humanize',
  },
  {
    id: 'mfx-octave',
    category: 'MIDI Effects',
    name: 'Octave Double',
    description: 'Duplicate clip notes +12 semitones up',
    midiAction: 'double-octave',
  },

  // Audio Effects
  {
    id: 'afx-eq',
    category: 'Audio Effects',
    name: 'EQ Three',
    description: 'Low, Mid, and High shelving EQ',
    effectType: 'eq',
  },
  {
    id: 'afx-comp',
    category: 'Audio Effects',
    name: 'Compressor',
    description: 'Dynamic range studio compressor',
    effectType: 'compressor',
  },
  {
    id: 'afx-reverb',
    category: 'Audio Effects',
    name: 'Studio Reverb',
    description: 'Algorithmic hall & room space',
    effectType: 'reverb',
  },
  {
    id: 'afx-delay',
    category: 'Audio Effects',
    name: 'Stereo Delay',
    description: 'Feedback echo with wet/dry mix',
    effectType: 'delay',
  },
  {
    id: 'afx-dist',
    category: 'Audio Effects',
    name: 'Overdrive Distortion',
    description: 'Harmonic saturation & grit',
    effectType: 'distortion',
  },
  {
    id: 'afx-filter',
    category: 'Audio Effects',
    name: 'Auto Filter',
    description: 'Resonant LP / HP / BP filter',
    effectType: 'filter',
  },
];
