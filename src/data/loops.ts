export type TrackId = 'drums' | 'bass' | 'chords' | 'lead';

export type QuantizeMode = '1m' | '2n' | '4n';

export interface DrumStep {
  kick?: boolean;
  snare?: boolean;
  hat?: boolean;
  openHat?: boolean;
  clap?: boolean;
  rim?: boolean;
  vel?: number;
}

export interface SynthStep {
  notes: string[];
  duration: string;
  velocity?: number;
}

export interface ClipDefinition {
  id: string;
  trackId: TrackId;
  sceneIndex: number; // 0..3
  name: string;
  subtitle: string;
  lengthSteps: 16 | 32;
  /** Preview lanes for the 16-column pattern mini-visualizer (normalized 0..1 vertical positions) */
  previewDots: Array<{ step: number; lane: number; accent?: boolean }>;
  drumPattern?: Record<number, DrumStep>;
  synthPattern?: Record<number, SynthStep>;
}

export interface TrackConfig {
  id: TrackId;
  name: string;
  shortName: string;
  accentHex: string;
  accentSoft: string;
  accentBorder: string;
  accentText: string;
  accentBg: string;
  defaultVolumeDb: number;
}

export const TRACKS: TrackConfig[] = [
  {
    id: 'drums',
    name: 'Drums',
    shortName: 'DRM',
    accentHex: '#F59E0B',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    accentBorder: 'rgba(245, 158, 11, 0.55)',
    accentText: 'text-amber-400',
    accentBg: 'bg-amber-500',
    defaultVolumeDb: -2,
  },
  {
    id: 'bass',
    name: 'Bass',
    shortName: 'BAS',
    accentHex: '#38BDF8',
    accentSoft: 'rgba(56, 189, 248, 0.16)',
    accentBorder: 'rgba(56, 189, 248, 0.55)',
    accentText: 'text-sky-400',
    accentBg: 'bg-sky-400',
    defaultVolumeDb: -4,
  },
  {
    id: 'chords',
    name: 'Chords',
    shortName: 'CHD',
    accentHex: '#34D399',
    accentSoft: 'rgba(52, 211, 153, 0.16)',
    accentBorder: 'rgba(52, 211, 153, 0.55)',
    accentText: 'text-emerald-400',
    accentBg: 'bg-emerald-400',
    defaultVolumeDb: -7,
  },
  {
    id: 'lead',
    name: 'Lead',
    shortName: 'LED',
    accentHex: '#FB7185',
    accentSoft: 'rgba(251, 113, 133, 0.16)',
    accentBorder: 'rgba(251, 113, 133, 0.55)',
    accentText: 'text-rose-400',
    accentBg: 'bg-rose-400',
    defaultVolumeDb: -8,
  },
];

export const SCENE_NAMES = ['Scene 1 · Pulse', 'Scene 2 · Drive', 'Scene 3 · Drift', 'Scene 4 · Peak'];

function buildDrumPreview(pattern: Record<number, DrumStep>): Array<{ step: number; lane: number; accent?: boolean }> {
  const dots: Array<{ step: number; lane: number; accent?: boolean }> = [];
  for (let s = 0; s < 16; s++) {
    const hit = pattern[s];
    if (!hit) continue;
    if (hit.kick) dots.push({ step: s, lane: 3, accent: true });
    if (hit.snare || hit.clap) dots.push({ step: s, lane: 2, accent: true });
    if (hit.rim) dots.push({ step: s, lane: 1 });
    if (hit.hat || hit.openHat) dots.push({ step: s, lane: 0, accent: Boolean(hit.openHat) });
  }
  return dots;
}

function buildSynthPreview(
  pattern: Record<number, SynthStep>,
  noteToLane: (note: string) => number
): Array<{ step: number; lane: number; accent?: boolean }> {
  const dots: Array<{ step: number; lane: number; accent?: boolean }> = [];
  for (let s = 0; s < 16; s++) {
    const ev = pattern[s];
    if (!ev) continue;
    ev.notes.forEach((n, idx) => {
      if (idx > 2) return;
      dots.push({
        step: s,
        lane: noteToLane(n),
        accent: (ev.velocity ?? 0.8) >= 0.85,
      });
    });
  }
  return dots;
}

const NOTE_ORDER = ['C', 'D', 'Eb', 'E', 'F', 'G', 'Ab', 'A', 'Bb', 'B'];
function mapNoteLane(note: string): number {
  const match = note.match(/^([A-G][b#]?)(\d)$/);
  if (!match) return 2;
  const idx = NOTE_ORDER.indexOf(match[1]);
  if (idx === -1) return 2;
  // Map higher pitch to upper lane (0) and lower pitch to lower lane (3)
  return 3 - Math.min(3, Math.floor((idx / NOTE_ORDER.length) * 4));
}

// --- DRUM PATTERNS ---
const drumsHouse: Record<number, DrumStep> = {
  0: { kick: true, hat: true, vel: 1 },
  2: { openHat: true, vel: 0.75 },
  4: { kick: true, clap: true, hat: true, vel: 0.95 },
  6: { openHat: true, vel: 0.7 },
  8: { kick: true, hat: true, vel: 1 },
  10: { openHat: true, vel: 0.75 },
  11: { rim: true, vel: 0.5 },
  12: { kick: true, clap: true, hat: true, vel: 0.95 },
  14: { openHat: true, vel: 0.75 },
  15: { hat: true, vel: 0.45 },
};

const drumsBreak: Record<number, DrumStep> = {
  0: { kick: true, hat: true, vel: 1 },
  2: { hat: true, vel: 0.6 },
  3: { kick: true, vel: 0.85 },
  4: { snare: true, hat: true, vel: 0.95 },
  6: { openHat: true, vel: 0.7 },
  7: { snare: true, vel: 0.4 },
  8: { hat: true, vel: 0.65 },
  9: { snare: true, vel: 0.45 },
  10: { kick: true, hat: true, vel: 0.9 },
  12: { snare: true, clap: true, vel: 0.95 },
  14: { openHat: true, vel: 0.75 },
  15: { kick: true, vel: 0.65 },
};

const drumsHalftime: Record<number, DrumStep> = {
  0: { kick: true, hat: true, vel: 1 },
  2: { hat: true, vel: 0.65 },
  4: { hat: true, vel: 0.55 },
  5: { rim: true, vel: 0.65 },
  6: { kick: true, hat: true, vel: 0.85 },
  8: { snare: true, clap: true, hat: true, vel: 1 },
  10: { hat: true, vel: 0.7 },
  11: { hat: true, vel: 0.55 },
  12: { hat: true, vel: 0.65 },
  13: { kick: true, hat: true, vel: 0.8 },
  14: { openHat: true, vel: 0.75 },
  15: { hat: true, vel: 0.5 },
};

const drumsMinimal: Record<number, DrumStep> = {
  0: { kick: true, hat: true, vel: 0.95 },
  1: { hat: true, vel: 0.35 },
  2: { hat: true, vel: 0.6 },
  3: { rim: true, vel: 0.75 },
  4: { kick: true, hat: true, vel: 0.9 },
  6: { openHat: true, vel: 0.65 },
  8: { kick: true, hat: true, vel: 0.95 },
  9: { rim: true, vel: 0.5 },
  10: { hat: true, vel: 0.6 },
  12: { kick: true, clap: true, vel: 0.95 },
  14: { rim: true, hat: true, vel: 0.7 },
  15: { hat: true, vel: 0.45 },
};

// --- BASS PATTERNS (C minor) ---
const bassPulse: Record<number, SynthStep> = {
  0: { notes: ['C2'], duration: '16n', velocity: 0.95 },
  2: { notes: ['C2'], duration: '16n', velocity: 0.8 },
  4: { notes: ['C2'], duration: '16n', velocity: 0.9 },
  6: { notes: ['Eb2'], duration: '16n', velocity: 0.85 },
  8: { notes: ['G1'], duration: '16n', velocity: 0.95 },
  10: { notes: ['G1'], duration: '16n', velocity: 0.75 },
  12: { notes: ['Bb1'], duration: '16n', velocity: 0.9 },
  14: { notes: ['G1'], duration: '16n', velocity: 0.85 },
};

const bassAcid: Record<number, SynthStep> = {
  0: { notes: ['C2'], duration: '16n', velocity: 1.0 },
  2: { notes: ['C3'], duration: '16n', velocity: 0.85 },
  3: { notes: ['Bb2'], duration: '16n', velocity: 0.7 },
  4: { notes: ['C2'], duration: '16n', velocity: 0.9 },
  6: { notes: ['Eb2'], duration: '16n', velocity: 0.95 },
  7: { notes: ['F2'], duration: '16n', velocity: 0.75 },
  8: { notes: ['G2'], duration: '16n', velocity: 1.0 },
  10: { notes: ['C2'], duration: '16n', velocity: 0.8 },
  11: { notes: ['G2'], duration: '16n', velocity: 0.85 },
  12: { notes: ['Bb2'], duration: '16n', velocity: 0.95 },
  14: { notes: ['G2'], duration: '16n', velocity: 0.85 },
  15: { notes: ['Eb2'], duration: '16n', velocity: 0.75 },
};

const bassReese: Record<number, SynthStep> = {
  0: { notes: ['C2'], duration: '2n', velocity: 0.9 },
  8: { notes: ['Ab1'], duration: '4n', velocity: 0.85 },
  12: { notes: ['Bb1'], duration: '4n', velocity: 0.88 },
  16: { notes: ['C2'], duration: '2n', velocity: 0.9 },
  24: { notes: ['F1'], duration: '4n', velocity: 0.85 },
  28: { notes: ['G1'], duration: '4n', velocity: 0.9 },
};

const bassFunk: Record<number, SynthStep> = {
  0: { notes: ['C2'], duration: '8n', velocity: 0.95 },
  3: { notes: ['C3'], duration: '16n', velocity: 0.85 },
  5: { notes: ['Bb2'], duration: '16n', velocity: 0.75 },
  6: { notes: ['G2'], duration: '8n', velocity: 0.9 },
  8: { notes: ['Eb2'], duration: '16n', velocity: 0.9 },
  10: { notes: ['F2'], duration: '16n', velocity: 0.85 },
  12: { notes: ['G2'], duration: '16n', velocity: 0.95 },
  14: { notes: ['Bb2'], duration: '16n', velocity: 0.8 },
  15: { notes: ['C3'], duration: '16n', velocity: 0.85 },
};

// --- CHORD PATTERNS (C minor) ---
const chordsStabs: Record<number, SynthStep> = {
  0: { notes: ['C4', 'Eb4', 'G4', 'Bb4'], duration: '8n', velocity: 0.9 },
  3: { notes: ['C4', 'Eb4', 'G4', 'Bb4'], duration: '16n', velocity: 0.75 },
  6: { notes: ['Ab3', 'C4', 'Eb4', 'G4'], duration: '8n', velocity: 0.85 },
  10: { notes: ['F3', 'Ab3', 'C4', 'Eb4'], duration: '8n', velocity: 0.8 },
  14: { notes: ['G3', 'Bb3', 'D4', 'F4'], duration: '8n', velocity: 0.85 },
};

const chordsLush: Record<number, SynthStep> = {
  0: { notes: ['C4', 'Eb4', 'G4', 'D5'], duration: '1m', velocity: 0.78 },
  16: { notes: ['Ab3', 'C4', 'Eb4', 'G4'], duration: '2n', velocity: 0.76 },
  24: { notes: ['Bb3', 'D4', 'F4', 'A4'], duration: '2n', velocity: 0.78 },
};

const chordsDub: Record<number, SynthStep> = {
  2: { notes: ['C4', 'Eb4', 'G4'], duration: '16n', velocity: 0.88 },
  6: { notes: ['C4', 'Eb4', 'G4'], duration: '16n', velocity: 0.72 },
  10: { notes: ['Bb3', 'D4', 'G4'], duration: '16n', velocity: 0.85 },
  14: { notes: ['Bb3', 'Eb4', 'G4'], duration: '16n', velocity: 0.78 },
};

const chordsLofi: Record<number, SynthStep> = {
  0: { notes: ['C4', 'Eb4', 'G4', 'Bb4'], duration: '4n.', velocity: 0.82 },
  6: { notes: ['F3', 'Ab3', 'C4', 'Eb4'], duration: '4n', velocity: 0.78 },
  12: { notes: ['G3', 'Bb3', 'D4', 'F4'], duration: '4n', velocity: 0.82 },
  16: { notes: ['Ab3', 'C4', 'Eb4', 'G4'], duration: '4n.', velocity: 0.84 },
  22: { notes: ['G3', 'Bb3', 'D4', 'F4'], duration: '4n', velocity: 0.76 },
  28: { notes: ['Bb3', 'D4', 'F4', 'Ab4'], duration: '4n', velocity: 0.8 },
};

// --- LEAD PATTERNS (C minor pentatonic / Dorian) ---
const leadArp: Record<number, SynthStep> = {
  0: { notes: ['C5'], duration: '16n', velocity: 0.85 },
  1: { notes: ['Eb5'], duration: '16n', velocity: 0.75 },
  2: { notes: ['G5'], duration: '16n', velocity: 0.9 },
  3: { notes: ['Bb5'], duration: '16n', velocity: 0.8 },
  4: { notes: ['G5'], duration: '16n', velocity: 0.85 },
  5: { notes: ['Eb5'], duration: '16n', velocity: 0.7 },
  6: { notes: ['C5'], duration: '16n', velocity: 0.88 },
  7: { notes: ['G4'], duration: '16n', velocity: 0.72 },
  8: { notes: ['Bb4'], duration: '16n', velocity: 0.85 },
  9: { notes: ['D5'], duration: '16n', velocity: 0.75 },
  10: { notes: ['F5'], duration: '16n', velocity: 0.9 },
  11: { notes: ['G5'], duration: '16n', velocity: 0.8 },
  12: { notes: ['Eb5'], duration: '16n', velocity: 0.88 },
  13: { notes: ['D5'], duration: '16n', velocity: 0.72 },
  14: { notes: ['C5'], duration: '16n', velocity: 0.85 },
  15: { notes: ['Bb4'], duration: '16n', velocity: 0.75 },
};

const leadHook: Record<number, SynthStep> = {
  0: { notes: ['G5'], duration: '8n', velocity: 0.92 },
  3: { notes: ['Eb5'], duration: '16n', velocity: 0.82 },
  4: { notes: ['F5'], duration: '8n', velocity: 0.88 },
  8: { notes: ['C5'], duration: '8n', velocity: 0.9 },
  10: { notes: ['D5'], duration: '16n', velocity: 0.8 },
  12: { notes: ['Eb5'], duration: '8n', velocity: 0.88 },
  14: { notes: ['Bb4'], duration: '8n', velocity: 0.84 },
};

const leadBells: Record<number, SynthStep> = {
  0: { notes: ['C6'], duration: '8n', velocity: 0.82 },
  4: { notes: ['G5'], duration: '8n', velocity: 0.75 },
  6: { notes: ['Bb5'], duration: '16n', velocity: 0.88 },
  10: { notes: ['Eb5'], duration: '8n', velocity: 0.78 },
  12: { notes: ['F5'], duration: '8n', velocity: 0.85 },
  15: { notes: ['G5'], duration: '16n', velocity: 0.72 },
};

const leadGlide: Record<number, SynthStep> = {
  0: { notes: ['C5'], duration: '4n', velocity: 0.9 },
  4: { notes: ['Eb5'], duration: '8n', velocity: 0.85 },
  6: { notes: ['G5'], duration: '4n', velocity: 0.92 },
  10: { notes: ['F5'], duration: '8n', velocity: 0.82 },
  12: { notes: ['D5'], duration: '4n', velocity: 0.88 },
  16: { notes: ['Eb5'], duration: '4n', velocity: 0.9 },
  20: { notes: ['C5'], duration: '8n', velocity: 0.84 },
  22: { notes: ['Bb4'], duration: '4n', velocity: 0.86 },
  26: { notes: ['G4'], duration: '8n', velocity: 0.82 },
  28: { notes: ['Bb4'], duration: '4n', velocity: 0.88 },
};

export const CLIPS: ClipDefinition[] = [
  // Row 0 (Scene 1)
  {
    id: 'drums-0',
    trackId: 'drums',
    sceneIndex: 0,
    name: 'Four on Floor',
    subtitle: '1 Bar · House',
    lengthSteps: 16,
    drumPattern: drumsHouse,
    previewDots: buildDrumPreview(drumsHouse),
  },
  {
    id: 'bass-0',
    trackId: 'bass',
    sceneIndex: 0,
    name: 'Sub Pulse',
    subtitle: '1 Bar · Cm',
    lengthSteps: 16,
    synthPattern: bassPulse,
    previewDots: buildSynthPreview(bassPulse, mapNoteLane),
  },
  {
    id: 'chords-0',
    trackId: 'chords',
    sceneIndex: 0,
    name: 'Warm Stabs',
    subtitle: '1 Bar · Cm9',
    lengthSteps: 16,
    synthPattern: chordsStabs,
    previewDots: buildSynthPreview(chordsStabs, mapNoteLane),
  },
  {
    id: 'lead-0',
    trackId: 'lead',
    sceneIndex: 0,
    name: 'Pluck Arp',
    subtitle: '1 Bar · 16th',
    lengthSteps: 16,
    synthPattern: leadArp,
    previewDots: buildSynthPreview(leadArp, mapNoteLane),
  },

  // Row 1 (Scene 2)
  {
    id: 'drums-1',
    trackId: 'drums',
    sceneIndex: 1,
    name: 'Breakbeat',
    subtitle: '1 Bar · Sync',
    lengthSteps: 16,
    drumPattern: drumsBreak,
    previewDots: buildDrumPreview(drumsBreak),
  },
  {
    id: 'bass-1',
    trackId: 'bass',
    sceneIndex: 1,
    name: 'Acid Arp',
    subtitle: '1 Bar · 303',
    lengthSteps: 16,
    synthPattern: bassAcid,
    previewDots: buildSynthPreview(bassAcid, mapNoteLane),
  },
  {
    id: 'chords-1',
    trackId: 'chords',
    sceneIndex: 1,
    name: 'Lush Pad',
    subtitle: '2 Bars · Wide',
    lengthSteps: 32,
    synthPattern: chordsLush,
    previewDots: buildSynthPreview(chordsLush, mapNoteLane),
  },
  {
    id: 'lead-1',
    trackId: 'lead',
    sceneIndex: 1,
    name: 'Hook Line',
    subtitle: '1 Bar · Motif',
    lengthSteps: 16,
    synthPattern: leadHook,
    previewDots: buildSynthPreview(leadHook, mapNoteLane),
  },

  // Row 2 (Scene 3)
  {
    id: 'drums-2',
    trackId: 'drums',
    sceneIndex: 2,
    name: 'Half-Time',
    subtitle: '1 Bar · Trap',
    lengthSteps: 16,
    drumPattern: drumsHalftime,
    previewDots: buildDrumPreview(drumsHalftime),
  },
  {
    id: 'bass-2',
    trackId: 'bass',
    sceneIndex: 2,
    name: 'Deep Reese',
    subtitle: '2 Bars · Sub',
    lengthSteps: 32,
    synthPattern: bassReese,
    previewDots: buildSynthPreview(bassReese, mapNoteLane),
  },
  {
    id: 'chords-2',
    trackId: 'chords',
    sceneIndex: 2,
    name: 'Dub Skank',
    subtitle: '1 Bar · Echo',
    lengthSteps: 16,
    synthPattern: chordsDub,
    previewDots: buildSynthPreview(chordsDub, mapNoteLane),
  },
  {
    id: 'lead-2',
    trackId: 'lead',
    sceneIndex: 2,
    name: 'Bell Counter',
    subtitle: '1 Bar · FM',
    lengthSteps: 16,
    synthPattern: leadBells,
    previewDots: buildSynthPreview(leadBells, mapNoteLane),
  },

  // Row 3 (Scene 4)
  {
    id: 'drums-3',
    trackId: 'drums',
    sceneIndex: 3,
    name: 'Minimal Perc',
    subtitle: '1 Bar · Rim',
    lengthSteps: 16,
    drumPattern: drumsMinimal,
    previewDots: buildDrumPreview(drumsMinimal),
  },
  {
    id: 'bass-3',
    trackId: 'bass',
    sceneIndex: 3,
    name: 'Funk Octave',
    subtitle: '1 Bar · Slap',
    lengthSteps: 16,
    synthPattern: bassFunk,
    previewDots: buildSynthPreview(bassFunk, mapNoteLane),
  },
  {
    id: 'chords-3',
    trackId: 'chords',
    sceneIndex: 3,
    name: 'Lo-Fi Keys',
    subtitle: '2 Bars · Rhodes',
    lengthSteps: 32,
    synthPattern: chordsLofi,
    previewDots: buildSynthPreview(chordsLofi, mapNoteLane),
  },
  {
    id: 'lead-3',
    trackId: 'lead',
    sceneIndex: 3,
    name: 'Glide Synth',
    subtitle: '2 Bars · Solo',
    lengthSteps: 32,
    synthPattern: leadGlide,
    previewDots: buildSynthPreview(leadGlide, mapNoteLane),
  },
];

export function getClipById(id: string): ClipDefinition | undefined {
  return CLIPS.find((c) => c.id === id);
}

export function getClipsForTrack(trackId: TrackId): ClipDefinition[] {
  return CLIPS.filter((c) => c.trackId === trackId).sort((a, b) => a.sceneIndex - b.sceneIndex);
}
