export const SCALE_NAMES = [
  'Chromatic',
  'Major',
  'Minor',
  'Harmonic Minor',
  'Melodic Minor',
  'Major Pentatonic',
  'Minor Pentatonic',
  'Blues',
  'Dorian',
  'Phrygian',
  'Lydian',
  'Mixolydian',
  'Locrian',
] as const;

export type ScaleName = (typeof SCALE_NAMES)[number];

export const ROOT_NOTES = [
  { label: 'C', value: 0 },
  { label: 'C# / Db', value: 1 },
  { label: 'D', value: 2 },
  { label: 'D# / Eb', value: 3 },
  { label: 'E', value: 4 },
  { label: 'F', value: 5 },
  { label: 'F# / Gb', value: 6 },
  { label: 'G', value: 7 },
  { label: 'G# / Ab', value: 8 },
  { label: 'A', value: 9 },
  { label: 'A# / Bb', value: 10 },
  { label: 'B', value: 11 },
];

const SCALE_INTERVALS: Record<string, number[]> = {
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Pentatonic Major': [0, 2, 4, 7, 9],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Pentatonic Minor': [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
};

export function getScaleIntervals(scale: string): number[] {
  return SCALE_INTERVALS[scale as ScaleName] ?? SCALE_INTERVALS.Major;
}

export function isPitchInScale(pitch: number, rootNoteValue = 0, scaleName: string = 'Major'): boolean {
  if (scaleName === 'Chromatic') return true;
  const intervals = getScaleIntervals(scaleName);
  const pc = ((pitch % 12) + 12) % 12;
  const relPc = ((pc - rootNoteValue) + 12) % 12;
  return intervals.includes(relPc);
}

export function snapPitchToScale(pitch: number, rootNoteValue = 0, scaleName: string = 'Major'): number {
  if (scaleName === 'Chromatic') return pitch;
  if (isPitchInScale(pitch, rootNoteValue, scaleName)) return pitch;

  // Search upward and downward for the nearest scale note
  let up = pitch;
  let down = pitch;
  while (up <= 108 || down >= 21) {
    if (up <= 108 && isPitchInScale(up, rootNoteValue, scaleName)) return up;
    if (down >= 21 && isPitchInScale(down, rootNoteValue, scaleName)) return down;
    up++;
    down--;
  }
  return pitch;
}
