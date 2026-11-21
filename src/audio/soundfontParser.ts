import { InstrumentCategory, SoundBankPresetMeta } from '../types/daw';
import {
  InstrumentSampleZone,
  InstrumentZoneDescriptor,
  ResolvedInstrumentZones,
} from './soundfontTypes';

export interface ParsedSf2Preset {
  bank: number;
  program: number;
  name: string;
  category: InstrumentCategory;
  isDrumKit: boolean;
  zones: InstrumentZoneDescriptor[];
}

export interface ParsedSf2Bank {
  name: string;
  engineName?: string;
  author?: string;
  smplByteOffset: number;
  smplByteLength: number;
  sm24ByteOffset?: number;
  presets: ParsedSf2Preset[];
}

interface Sf2SampleHeader {
  name: string;
  start: number;
  end: number;
  startLoop: number;
  endLoop: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  sampleLink: number;
  sampleType: number;
}

interface GenMap {
  keyLow?: number;
  keyHigh?: number;
  velLow?: number;
  velHigh?: number;
  instrumentId?: number;
  sampleId?: number;
  overridingRootKey?: number;
  coarseTune: number;
  fineTune: number;
  scaleTuning: number;
  attenuationCb: number; // centibels
  panTenths: number; // -500..500
  sampleModes: number;
  exclusiveClass: number;
  attackTc: number; // timecents
  decayTc: number;
  sustainCb: number; // centibels attenuation (0 = max, 1000 = -100dB)
  releaseTc: number;
  filterFcCents: number; // absolute cents (default 13500 = ~19912 Hz)
  filterQCb: number;
  startAddrsOffset: number;
  endAddrsOffset: number;
  startloopAddrsOffset: number;
  endloopAddrsOffset: number;
  startAddrsCoarseOffset: number;
  endAddrsCoarseOffset: number;
  startloopAddrsCoarseOffset: number;
  endloopAddrsCoarseOffset: number;
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readFixedAscii(bytes: Uint8Array, offset: number, maxLen: number): string {
  let end = offset;
  const limit = Math.min(bytes.length, offset + maxLen);
  while (end < limit && bytes[end] !== 0) {
    end++;
  }
  let out = '';
  for (let i = offset; i < end; i++) {
    const ch = bytes[i];
    if (ch >= 32 && ch <= 126) {
      out += String.fromCharCode(ch);
    }
  }
  return out.trim();
}

function timecentsToSeconds(tc: number, fallback: number): number {
  if (!Number.isFinite(tc) || tc <= -32768) return fallback;
  const sec = Math.pow(2, tc / 1200);
  return Math.max(0.001, Math.min(30, sec));
}

function absCentsToHz(cents: number): number {
  const hz = 8.176 * Math.pow(2, cents / 1200);
  return Math.max(80, Math.min(18000, hz));
}

export function classifyInstrumentCategory(
  bank: number,
  program: number,
  name: string
): InstrumentCategory {
  const lower = name.toLowerCase();
  if (
    bank === 128 ||
    lower.includes('drum') ||
    lower.includes('kit') ||
    lower.includes('perc') ||
    lower.includes('808') ||
    lower.includes('909')
  ) {
    return 'Drums';
  }
  if (lower.includes('bass') || (program >= 32 && program <= 39)) {
    return 'Bass';
  }
  if (
    lower.includes('violin') ||
    lower.includes('viola') ||
    lower.includes('cello') ||
    lower.includes('string') ||
    lower.includes('orch') ||
    lower.includes('contrabass') ||
    (program >= 40 && program <= 51)
  ) {
    return 'Strings';
  }
  if (
    lower.includes('piano') ||
    lower.includes('rhodes') ||
    lower.includes('ep') ||
    lower.includes('organ') ||
    lower.includes('clav') ||
    lower.includes('harpsi') ||
    lower.includes('celesta') ||
    (program >= 0 && program <= 23)
  ) {
    return 'Keyboard';
  }
  if (
    lower.includes('synth') ||
    lower.includes('lead') ||
    lower.includes('pad') ||
    lower.includes('pluck') ||
    (program >= 80 && program <= 103)
  ) {
    return 'Synth';
  }
  if (program >= 52 && program <= 79) {
    return 'Strings';
  }
  return 'Synth';
}

function createEmptyGenMap(isPresetLevel: boolean): GenMap {
  return {
    coarseTune: 0,
    fineTune: 0,
    scaleTuning: isPresetLevel ? 0 : 100,
    attenuationCb: 0,
    panTenths: 0,
    sampleModes: 0,
    exclusiveClass: 0,
    attackTc: isPresetLevel ? 0 : -12000,
    decayTc: isPresetLevel ? 0 : -12000,
    sustainCb: 0,
    releaseTc: isPresetLevel ? 0 : -12000,
    filterFcCents: isPresetLevel ? 0 : 13500,
    filterQCb: 0,
    startAddrsOffset: 0,
    endAddrsOffset: 0,
    startloopAddrsOffset: 0,
    endloopAddrsOffset: 0,
    startAddrsCoarseOffset: 0,
    endAddrsCoarseOffset: 0,
    startloopAddrsCoarseOffset: 0,
    endloopAddrsCoarseOffset: 0,
  };
}

function applyGenerator(map: GenMap, oper: number, view: DataView, valOffset: number): void {
  const u16 = view.getUint16(valOffset, true);
  const s16 = view.getInt16(valOffset, true);
  const lo = view.getUint8(valOffset);
  const hi = view.getUint8(valOffset + 1);

  switch (oper) {
    case 0:
      map.startAddrsOffset = s16;
      break;
    case 1:
      map.endAddrsOffset = s16;
      break;
    case 2:
      map.startloopAddrsOffset = s16;
      break;
    case 3:
      map.endloopAddrsOffset = s16;
      break;
    case 4:
      map.startAddrsCoarseOffset = s16;
      break;
    case 8:
      map.filterFcCents = s16;
      break;
    case 9:
      map.filterQCb = s16;
      break;
    case 12:
      map.endAddrsCoarseOffset = s16;
      break;
    case 17:
      map.panTenths = s16;
      break;
    case 34:
      map.attackTc = s16;
      break;
    case 36:
      map.decayTc = s16;
      break;
    case 37:
      map.sustainCb = s16;
      break;
    case 38:
      map.releaseTc = s16;
      break;
    case 41:
      map.instrumentId = u16;
      break;
    case 43:
      map.keyLow = Math.min(lo, hi);
      map.keyHigh = Math.max(lo, hi);
      break;
    case 44:
      map.velLow = Math.min(lo, hi);
      map.velHigh = Math.max(lo, hi);
      break;
    case 45:
      map.startloopAddrsCoarseOffset = s16;
      break;
    case 48:
      map.attenuationCb = s16;
      break;
    case 50:
      map.endloopAddrsCoarseOffset = s16;
      break;
    case 51:
      map.coarseTune = s16;
      break;
    case 52:
      map.fineTune = s16;
      break;
    case 53:
      map.sampleId = u16;
      break;
    case 54:
      map.sampleModes = u16;
      break;
    case 56:
      map.scaleTuning = s16;
      break;
    case 57:
      map.exclusiveClass = u16;
      break;
    case 58:
      map.overridingRootKey = s16;
      break;
    default:
      break;
  }
}

function mergeGlobalZone(global: GenMap | null, zone: GenMap): GenMap {
  if (!global) return zone;
  return {
    ...global,
    ...zone,
    // Keep zone-specific overrides if defined, otherwise fall back to global
    keyLow: zone.keyLow ?? global.keyLow,
    keyHigh: zone.keyHigh ?? global.keyHigh,
    velLow: zone.velLow ?? global.velLow,
    velHigh: zone.velHigh ?? global.velHigh,
    overridingRootKey: zone.overridingRootKey ?? global.overridingRootKey,
  };
}

/**
 * Parses a SoundFont 2 (.sf2) ArrayBuffer into lightweight preset + zone descriptors
 * without eagerly copying or decoding the entire PCM sample pool.
 */
export function parseSf2Buffer(buffer: ArrayBuffer, fallbackName = 'SoundFont Bank'): ParsedSf2Bank {
  if (!buffer || buffer.byteLength < 64) {
    throw new Error('Invalid SoundFont (.sf2): file is empty or too small.');
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const riff = readFourCC(view, 0);
  const form = readFourCC(view, 8);
  if (riff !== 'RIFF' || form !== 'sfbk') {
    throw new Error('Invalid SoundFont (.sf2): missing RIFF/sfbk signature.');
  }

  let bankName = fallbackName.replace(/\.sf2$/i, '');
  let engineName: string | undefined;
  let author: string | undefined;
  let smplByteOffset = -1;
  let smplByteLength = 0;
  let sm24ByteOffset: number | undefined;

  const pdtaChunks = new Map<string, { offset: number; size: number }>();

  let pos = 12;
  const totalLen = buffer.byteLength;
  while (pos + 8 <= totalLen) {
    const chunkId = readFourCC(view, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    const chunkEnd = Math.min(totalLen, dataStart + chunkSize);

    if (chunkId === 'LIST' && dataStart + 4 <= totalLen) {
      const listType = readFourCC(view, dataStart);
      let subPos = dataStart + 4;
      while (subPos + 8 <= chunkEnd) {
        const subId = readFourCC(view, subPos);
        const subSize = view.getUint32(subPos + 4, true);
        const subDataStart = subPos + 8;
        const subDataEnd = Math.min(chunkEnd, subDataStart + subSize);

        if (listType === 'INFO') {
          const text = readFixedAscii(bytes, subDataStart, subSize);
          if (subId === 'INAM' && text) bankName = text;
          else if (subId === 'ISNG' && text) engineName = text;
          else if (subId === 'IENG' && text) author = text;
        } else if (listType === 'sdta') {
          if (subId === 'smpl') {
            smplByteOffset = subDataStart;
            smplByteLength = subDataEnd - subDataStart;
          } else if (subId === 'sm24') {
            sm24ByteOffset = subDataStart;
          }
        } else if (listType === 'pdta') {
          pdtaChunks.set(subId, { offset: subDataStart, size: subDataEnd - subDataStart });
        }

        subPos = subDataStart + subSize + (subSize % 2);
      }
    }

    pos = dataStart + chunkSize + (chunkSize % 2);
  }

  if (smplByteOffset < 0 || smplByteLength < 4) {
    throw new Error('Corrupted SoundFont (.sf2): missing sdta/smpl PCM sample block.');
  }

  const requiredPdta = ['phdr', 'pbag', 'pgen', 'inst', 'ibag', 'igen', 'shdr'];
  for (const req of requiredPdta) {
    if (!pdtaChunks.has(req)) {
      throw new Error(`Corrupted SoundFont (.sf2): missing pdta/${req} chunk.`);
    }
  }

  const phdrChunk = pdtaChunks.get('phdr')!;
  const pbagChunk = pdtaChunks.get('pbag')!;
  const pgenChunk = pdtaChunks.get('pgen')!;
  const instChunk = pdtaChunks.get('inst')!;
  const ibagChunk = pdtaChunks.get('ibag')!;
  const igenChunk = pdtaChunks.get('igen')!;
  const shdrChunk = pdtaChunks.get('shdr')!;

  // Parse sample headers (46 bytes each, last record is EOP/EOS sentinel)
  const samples: Sf2SampleHeader[] = [];
  const shdrCount = Math.floor(shdrChunk.size / 46);
  for (let i = 0; i < Math.max(0, shdrCount - 1); i++) {
    const o = shdrChunk.offset + i * 46;
    samples.push({
      name: readFixedAscii(bytes, o, 20),
      start: view.getUint32(o + 20, true),
      end: view.getUint32(o + 24, true),
      startLoop: view.getUint32(o + 28, true),
      endLoop: view.getUint32(o + 32, true),
      sampleRate: Math.max(8000, Math.min(192000, view.getUint32(o + 36, true) || 44100)),
      originalPitch: view.getUint8(o + 40),
      pitchCorrection: view.getInt8(o + 41),
      sampleLink: view.getUint16(o + 42, true),
      sampleType: view.getUint16(o + 44, true),
    });
  }

  // Parse ibag/igen
  const ibagCount = Math.floor(ibagChunk.size / 4);
  const ibags: Array<{ genNdx: number }> = [];
  for (let i = 0; i < ibagCount; i++) {
    ibags.push({ genNdx: view.getUint16(ibagChunk.offset + i * 4, true) });
  }
  const igenCount = Math.floor(igenChunk.size / 4);

  const readInstBagGens = (bagStart: number, bagEnd: number): GenMap => {
    const map = createEmptyGenMap(false);
    const gStart = ibags[bagStart]?.genNdx ?? 0;
    const gEnd = Math.min(igenCount, ibags[bagEnd]?.genNdx ?? gStart);
    for (let g = gStart; g < gEnd; g++) {
      const o = igenChunk.offset + g * 4;
      applyGenerator(map, view.getUint16(o, true), view, o + 2);
    }
    return map;
  };

  // Parse inst records (22 bytes each, last is EOI sentinel)
  const instCount = Math.floor(instChunk.size / 22);
  const instZonesByInstIdx: GenMap[][] = [];
  for (let i = 0; i < Math.max(0, instCount - 1); i++) {
    const o = instChunk.offset + i * 22;
    const bagStart = view.getUint16(o + 20, true);
    const bagEnd = view.getUint16(o + 22 + 20, true);
    const zones: GenMap[] = [];
    let globalInstZone: GenMap | null = null;

    for (let b = bagStart; b < Math.min(bagEnd, ibags.length - 1); b++) {
      const gens = readInstBagGens(b, b + 1);
      if (b === bagStart && gens.sampleId === undefined) {
        globalInstZone = gens;
      } else if (gens.sampleId !== undefined) {
        zones.push(mergeGlobalZone(globalInstZone, gens));
      }
    }
    instZonesByInstIdx.push(zones);
  }

  // Parse pbag/pgen
  const pbagCount = Math.floor(pbagChunk.size / 4);
  const pbags: Array<{ genNdx: number }> = [];
  for (let i = 0; i < pbagCount; i++) {
    pbags.push({ genNdx: view.getUint16(pbagChunk.offset + i * 4, true) });
  }
  const pgenCount = Math.floor(pgenChunk.size / 4);

  const readPresetBagGens = (bagStart: number, bagEnd: number): GenMap => {
    const map = createEmptyGenMap(true);
    const gStart = pbags[bagStart]?.genNdx ?? 0;
    const gEnd = Math.min(pgenCount, pbags[bagEnd]?.genNdx ?? gStart);
    for (let g = gStart; g < gEnd; g++) {
      const o = pgenChunk.offset + g * 4;
      applyGenerator(map, view.getUint16(o, true), view, o + 2);
    }
    return map;
  };

  // Parse phdr records (38 bytes each, last is EOP sentinel)
  const phdrCount = Math.floor(phdrChunk.size / 38);
  const presets: ParsedSf2Preset[] = [];
  const maxSamplesAvailable = Math.floor(smplByteLength / 2);

  for (let p = 0; p < Math.max(0, phdrCount - 1); p++) {
    const o = phdrChunk.offset + p * 38;
    const name = readFixedAscii(bytes, o, 20) || `Preset ${p + 1}`;
    const program = view.getUint16(o + 20, true);
    const bank = view.getUint16(o + 22, true);
    const bagStart = view.getUint16(o + 24, true);
    const bagEnd = view.getUint16(o + 38 + 24, true);

    let globalPresetZone: GenMap | null = null;
    const resolvedZones: InstrumentZoneDescriptor[] = [];

    for (let pb = bagStart; pb < Math.min(bagEnd, pbags.length - 1); pb++) {
      const rawPGen = readPresetBagGens(pb, pb + 1);
      if (pb === bagStart && rawPGen.instrumentId === undefined) {
        globalPresetZone = rawPGen;
        continue;
      }
      const pGen = mergeGlobalZone(globalPresetZone, rawPGen);
      if (pGen.instrumentId === undefined) continue;

      const instZones = instZonesByInstIdx[pGen.instrumentId];
      if (!instZones) continue;

      for (let izIdx = 0; izIdx < instZones.length; izIdx++) {
        const iz = instZones[izIdx];
        if (iz.sampleId === undefined) continue;
        const shdr = samples[iz.sampleId];
        if (!shdr) continue;
        // Skip right-linked stereo duplicate if sampleType === 2 (right sample) to avoid phase doubling, or keep mono/left
        if ((shdr.sampleType & 0x0f) === 2) continue;

        const pKeyLo = pGen.keyLow ?? 0;
        const pKeyHi = pGen.keyHigh ?? 127;
        const iKeyLo = iz.keyLow ?? 0;
        const iKeyHi = iz.keyHigh ?? 127;
        const keyLow = Math.max(pKeyLo, iKeyLo);
        const keyHigh = Math.min(pKeyHi, iKeyHi);
        if (keyLow > keyHigh) continue;

        const pVelLo = pGen.velLow ?? 0;
        const pVelHi = pGen.velHigh ?? 127;
        const iVelLo = iz.velLow ?? 0;
        const iVelHi = iz.velHigh ?? 127;
        const velLow = Math.max(pVelLo, iVelLo);
        const velHigh = Math.min(pVelHi, iVelHi);
        if (velLow > velHigh) continue;

        const start = Math.max(
          0,
          shdr.start + iz.startAddrsOffset + iz.startAddrsCoarseOffset * 32768
        );
        const end = Math.min(
          maxSamplesAvailable,
          shdr.end + iz.endAddrsOffset + iz.endAddrsCoarseOffset * 32768
        );
        if (end <= start + 8) continue;

        const loopStartSample = Math.max(
          start,
          shdr.startLoop + iz.startloopAddrsOffset + iz.startloopAddrsCoarseOffset * 32768
        );
        const loopEndSample = Math.min(
          end,
          shdr.endLoop + iz.endloopAddrsOffset + iz.endloopAddrsCoarseOffset * 32768
        );

        const rawRoot =
          iz.overridingRootKey !== undefined && iz.overridingRootKey >= 0 && iz.overridingRootKey <= 127
            ? iz.overridingRootKey
            : shdr.originalPitch <= 127
              ? shdr.originalPitch
              : 60;

        const mode = iz.sampleModes & 3;
        const loop = (mode === 1 || mode === 3) && loopEndSample > loopStartSample + 16;

        const attackSec = timecentsToSeconds(iz.attackTc + pGen.attackTc, 0.005);
        const decaySec = timecentsToSeconds(iz.decayTc + pGen.decayTc, 0.35);
        const sustainCb = Math.max(0, Math.min(1440, iz.sustainCb + pGen.sustainCb));
        const sustainLevel = Math.max(0.0, Math.min(1.0, Math.pow(10, -sustainCb / 200)));
        const releaseSec = timecentsToSeconds(iz.releaseTc + pGen.releaseTc, 0.3);
        const attenuationDb = Math.max(0, (iz.attenuationCb + pGen.attenuationCb) / 10);
        const pan = Math.max(-1, Math.min(1, (iz.panTenths + pGen.panTenths) / 500));
        const filterCutoffHz = absCentsToHz(iz.filterFcCents + pGen.filterFcCents);
        const filterQ = Math.max(0.5, Math.min(12, 0.707 * Math.pow(10, (iz.filterQCb + pGen.filterQCb) / 200)));

        resolvedZones.push({
          id: `sf2-${bank}-${program}-${iz.sampleId}-${resolvedZones.length}`,
          keyLow,
          keyHigh,
          velLow,
          velHigh,
          rootMidi: rawRoot,
          coarseTune: iz.coarseTune + pGen.coarseTune,
          fineTune: iz.fineTune + pGen.fineTune,
          scaleTuning: Math.max(0, Math.min(200, iz.scaleTuning + pGen.scaleTuning)),
          attenuationDb,
          pan,
          loop,
          loopStartSample,
          loopEndSample,
          sampleStart: start,
          sampleEnd: end,
          sampleRate: shdr.sampleRate,
          pitchCorrectionCents: shdr.pitchCorrection,
          attackSec,
          decaySec,
          sustainLevel,
          releaseSec,
          filterCutoffHz,
          filterQ,
          exclusiveClass: iz.exclusiveClass,
        });
      }
    }

    if (resolvedZones.length > 0) {
      const category = classifyInstrumentCategory(bank, program, name);
      presets.push({
        bank,
        program,
        name,
        category,
        isDrumKit: bank === 128 || category === 'Drums',
        zones: resolvedZones,
      });
    }
  }

  if (presets.length === 0) {
    throw new Error('Incompatible SoundFont (.sf2): no playable instrument presets found.');
  }

  presets.sort((a, b) => (a.bank !== b.bank ? a.bank - b.bank : a.program - b.program));

  return {
    name: bankName,
    engineName,
    author,
    smplByteOffset,
    smplByteLength,
    sm24ByteOffset,
    presets,
  };
}

export function buildSoundBankPresetsMeta(
  bankId: string,
  parsed: ParsedSf2Bank
): SoundBankPresetMeta[] {
  return parsed.presets.map((p) => ({
    id: `sf2:${bankId}:${p.bank}:${p.program}`,
    bankId,
    bank: p.bank,
    program: p.program,
    name: p.name,
    category: p.category,
    isDrumKit: p.isDrumKit,
    zoneCount: p.zones.length,
  }));
}

// --- Lazy Per-Preset AudioBuffer Cache & Memory Unloading ---

const parsedBankCache = new Map<string, { rawBuffer: ArrayBuffer; parsed: ParsedSf2Bank }>();
const sampleBufferCache = new Map<string, AudioBuffer>(); // key: `${bankId}:${sampleStart}:${sampleEnd}:${sampleRate}`

export function registerParsedSf2Bank(
  bankId: string,
  rawBuffer: ArrayBuffer,
  parsed: ParsedSf2Bank
): void {
  parsedBankCache.set(bankId, { rawBuffer, parsed });
}

export function getRegisteredParsedSf2Bank(
  bankId: string
): { rawBuffer: ArrayBuffer; parsed: ParsedSf2Bank } | undefined {
  return parsedBankCache.get(bankId);
}

export function isSf2BankLoadedInMemory(bankId: string): boolean {
  if (parsedBankCache.has(bankId)) return true;
  const prefix = `${bankId}:`;
  for (const key of sampleBufferCache.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function getLoadedSf2MemoryStats(): { bankCount: number; decodedZones: number; approxMb: number } {
  let bytes = 0;
  for (const buf of sampleBufferCache.values()) {
    bytes += buf.length * buf.numberOfChannels * 4;
  }
  return {
    bankCount: parsedBankCache.size,
    decodedZones: sampleBufferCache.size,
    approxMb: Math.round((bytes / (1024 * 1024)) * 100) / 100,
  };
}

export function unloadSf2BankFromMemory(bankId: string): number {
  let freed = 0;
  parsedBankCache.delete(bankId);
  const prefix = `${bankId}:`;
  for (const key of Array.from(sampleBufferCache.keys())) {
    if (key.startsWith(prefix)) {
      sampleBufferCache.delete(key);
      freed++;
    }
  }
  return freed;
}

function decodePcmSliceToAudioBuffer(
  rawBuffer: ArrayBuffer,
  smplByteOffset: number,
  desc: InstrumentZoneDescriptor,
  audioCtx: BaseAudioContext
): AudioBuffer {
  const frameCount = Math.max(1, desc.sampleEnd - desc.sampleStart);
  const view = new DataView(rawBuffer);
  const buf = audioCtx.createBuffer(1, frameCount, desc.sampleRate);
  const channel = buf.getChannelData(0);

  // Scale peak safely (-9 dBFS nominal) to keep multi-voice mixes clean
  const inv16 = 1 / 32768;
  const fadeSamples = Math.min(64, Math.floor(frameCount / 8));

  for (let i = 0; i < frameCount; i++) {
    const bytePos = smplByteOffset + (desc.sampleStart + i) * 2;
    if (bytePos + 1 >= rawBuffer.byteLength) break;
    let s = view.getInt16(bytePos, true) * inv16;
    if (i < fadeSamples && fadeSamples > 0) {
      s *= i / fadeSamples;
    } else if (!desc.loop && i >= frameCount - fadeSamples && fadeSamples > 0) {
      s *= (frameCount - i) / fadeSamples;
    }
    channel[i] = s * 0.7;
  }

  return buf;
}

export async function decodeSf2PresetZones(
  bankId: string,
  bank: number,
  program: number,
  audioCtx: BaseAudioContext,
  rawBufferOverride?: ArrayBuffer,
  parsedOverride?: ParsedSf2Bank,
  onProgress?: (loaded: number, total: number) => void
): Promise<ResolvedInstrumentZones | null> {
  const cachedEntry = parsedBankCache.get(bankId);
  const rawBuffer = rawBufferOverride ?? cachedEntry?.rawBuffer;
  const parsed = parsedOverride ?? cachedEntry?.parsed;
  if (!rawBuffer || !parsed) return null;

  const preset =
    parsed.presets.find((p) => p.bank === bank && p.program === program) ??
    parsed.presets.find((p) => p.program === program) ??
    parsed.presets[0];
  if (!preset) return null;

  const zones: InstrumentSampleZone[] = [];
  const total = preset.zones.length;

  for (let i = 0; i < total; i++) {
    const d = preset.zones[i];
    const cacheKey = `${bankId}:${d.sampleStart}:${d.sampleEnd}:${d.sampleRate}`;
    let buf = sampleBufferCache.get(cacheKey);
    if (!buf) {
      buf = decodePcmSliceToAudioBuffer(rawBuffer, parsed.smplByteOffset, d, audioCtx);
      // Only cache across live AudioContext instances (not temporary OfflineAudioContext)
      if (typeof AudioContext !== 'undefined' && audioCtx instanceof AudioContext) {
        sampleBufferCache.set(cacheKey, buf);
      }
    }

    const attenLinear = Math.max(0.05, Math.min(1, Math.pow(10, -d.attenuationDb / 20)));
    const loopStartSec = Math.max(0, (d.loopStartSample - d.sampleStart) / d.sampleRate);
    const loopEndSec = Math.min(buf.duration, (d.loopEndSample - d.sampleStart) / d.sampleRate);

    zones.push({
      id: d.id,
      keyLow: d.keyLow,
      keyHigh: d.keyHigh,
      velLow: d.velLow,
      velHigh: d.velHigh,
      rootMidi: d.rootMidi,
      coarseTune: d.coarseTune,
      fineTune: d.fineTune + d.pitchCorrectionCents,
      scaleTuning: d.scaleTuning,
      gain: attenLinear,
      pan: d.pan,
      loop: d.loop && loopEndSec > loopStartSec + 0.005,
      loopStartSec,
      loopEndSec,
      attackSec: d.attackSec,
      decaySec: d.decaySec,
      sustainLevel: d.sustainLevel,
      releaseSec: d.releaseSec,
      filterCutoffHz: d.filterCutoffHz,
      filterQ: d.filterQ,
      exclusiveClass: d.exclusiveClass,
      buffer: buf,
    });

    if (onProgress && (i % 6 === 5 || i === total - 1)) {
      onProgress(i + 1, total);
      // Yield back to UI thread on large banks so playback/touch never freezes
      if (i < total - 1) {
        await Promise.resolve();
      }
    }
  }

  return {
    presetKey: `sf2:${bankId}:${preset.bank}:${preset.program}`,
    name: preset.name,
    category: preset.category,
    isDrumKit: preset.isDrumKit,
    bank: preset.bank,
    program: preset.program,
    zones,
  };
}
