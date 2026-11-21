import { InstrumentCategory } from '../types/daw';

export interface InstrumentZoneDescriptor {
  id: string;
  keyLow: number; // 0..127
  keyHigh: number; // 0..127
  velLow: number; // 0..127
  velHigh: number; // 0..127
  rootMidi: number; // 0..127
  coarseTune: number; // semitones
  fineTune: number; // cents
  scaleTuning: number; // cents per semitone (default 100)
  attenuationDb: number; // dB reduction (0..144)
  pan: number; // -1..1
  loop: boolean;
  loopStartSample: number;
  loopEndSample: number;
  sampleStart: number; // sample offset in smpl
  sampleEnd: number; // sample offset in smpl
  sampleRate: number;
  pitchCorrectionCents: number;
  attackSec: number;
  decaySec: number;
  sustainLevel: number; // 0..1
  releaseSec: number;
  filterCutoffHz: number;
  filterQ: number;
  exclusiveClass: number; // 0 = none (useful for hi-hat choke groups!)
}

export interface InstrumentSampleZone {
  id: string;
  keyLow: number;
  keyHigh: number;
  velLow: number;
  velHigh: number;
  rootMidi: number;
  coarseTune: number;
  fineTune: number;
  scaleTuning: number;
  gain: number; // 0..1 linear zone attenuation
  pan: number; // -1..1
  loop: boolean;
  loopStartSec: number;
  loopEndSec: number;
  attackSec: number;
  decaySec: number;
  sustainLevel: number;
  releaseSec: number;
  filterCutoffHz: number;
  filterQ: number;
  exclusiveClass: number;
  buffer: AudioBuffer;
}

export interface ResolvedInstrumentZones {
  presetKey: string;
  name: string;
  category: InstrumentCategory;
  isDrumKit: boolean;
  bank: number;
  program: number;
  zones: InstrumentSampleZone[];
}
