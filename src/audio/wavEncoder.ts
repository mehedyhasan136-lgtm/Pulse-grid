import * as Tone from 'tone';
import { MidiClip, MidiNote, ProjectState, TrackModel } from '../types/daw';
import { midiToNoteName } from '../data/presets';
import { getPianoPartials, mapVelocityToNaturalGain } from './midiEngine';
import { applySwingToBeat } from './swingUtils';
import {
  BUILTIN_BANK_ID,
  decodeBuiltinPresetZones,
  findBuiltinDefinition,
} from './builtinSoundBank';
import {
  decodeSf2PresetZones,
  getRegisteredParsedSf2Bank,
  parseSf2Buffer,
  registerParsedSf2Bank,
} from './soundfontParser';
import { InstrumentSampleZone, ResolvedInstrumentZones } from './soundfontTypes';
import { loadSoundBankFromDb } from '../storage/projectDb';

export function audioBufferToWavArrayBuffer(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  return new Blob([audioBufferToWavArrayBuffer(buffer)], { type: 'audio/wav' });
}

function buildOfflineEffectChain(
  effects: TrackModel['effects'],
  source: Tone.ToneAudioNode,
  destination: Tone.ToneAudioNode
): void {
  const order: Record<string, number> = {
    eq: 0,
    filter: 1,
    compressor: 2,
    distortion: 3,
    reverb: 4,
    delay: 5,
  };
  const enabled = effects
    .filter((e) => e.enabled)
    .slice()
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

  if (enabled.length === 0) {
    source.connect(destination);
    return;
  }

  let tail: Tone.ToneAudioNode = source;
  for (const fx of enabled) {
    const p = fx.params;
    if (fx.type === 'eq') {
      const eq = new Tone.EQ3({
        low: Math.max(-12, Math.min(12, Number(p.low ?? 0))),
        mid: Math.max(-12, Math.min(12, Number(p.mid ?? 0))),
        high: Math.max(-12, Math.min(12, Number(p.high ?? 0))),
      });
      const peaking = new Tone.Filter({
        type: 'peaking',
        frequency: Math.max(80, Math.min(14000, Number(p.frequency ?? 1000))),
        Q: Math.max(0.5, Math.min(8, Number(p.q ?? 1))),
        gain: Math.max(-12, Math.min(12, Number(p.mid ?? 0))),
      });
      tail.connect(eq);
      eq.connect(peaking);
      tail = peaking;
    } else if (fx.type === 'compressor') {
      const comp = new Tone.Compressor({
        threshold: Math.max(-48, Math.min(0, Number(p.threshold ?? -18))),
        ratio: Math.max(1, Math.min(12, Number(p.ratio ?? 3.5))),
        attack: Math.max(0.001, Math.min(0.2, Number(p.attack ?? 0.01))),
        release: Math.max(0.05, Math.min(1, Number(p.release ?? 0.2))),
      });
      tail.connect(comp);
      tail = comp;
    } else if (fx.type === 'reverb') {
      const rev = new Tone.Reverb({
        decay: Math.max(0.3, Math.min(6, Number(p.decay ?? 2.2))),
        preDelay: 0.015,
        wet: Math.max(0, Math.min(1, Number(p.wet ?? 0.25))),
      });
      tail.connect(rev);
      tail = rev;
    } else if (fx.type === 'delay') {
      const del = new Tone.FeedbackDelay({
        delayTime: Math.max(0.05, Math.min(1, Number(p.delayTime ?? 0.375))),
        feedback: Math.max(0, Math.min(0.85, Number(p.feedback ?? 0.32))),
        wet: Math.max(0, Math.min(1, Number(p.wet ?? 0.22))),
      });
      tail.connect(del);
      tail = del;
    } else if (fx.type === 'distortion') {
      const dist = new Tone.Distortion({
        distortion: Math.max(0, Math.min(1, Number(p.amount ?? 0.18))),
        wet: Math.max(0, Math.min(1, Number(p.wet ?? 0.2))),
      });
      tail.connect(dist);
      tail = dist;
    } else if (fx.type === 'filter') {
      const filt = new Tone.Filter({
        frequency: Math.max(80, Math.min(16000, Number(p.frequency ?? 3200))),
        Q: Math.max(0.5, Math.min(12, Number(p.resonance ?? 1.2))),
        type: (p.filterType as BiquadFilterType) ?? 'lowpass',
      });
      tail.connect(filt);
      tail = filt;
    }
  }
  tail.connect(destination);
}

async function resolveOfflineSoundfontZones(
  track: TrackModel,
  rawOfflineCtx: BaseAudioContext
): Promise<ResolvedInstrumentZones> {
  const p = track.instrument.params;
  const bankId = p.soundBankId ?? BUILTIN_BANK_ID;
  const bank = p.bankNumber ?? 0;
  const program = p.programNumber ?? 0;

  if (bankId !== BUILTIN_BANK_ID) {
    if (!getRegisteredParsedSf2Bank(bankId)) {
      try {
        const stored = await loadSoundBankFromDb(bankId);
        if (stored?.arrayBuffer) {
          const parsed = parseSf2Buffer(stored.arrayBuffer, stored.name);
          registerParsedSf2Bank(bankId, stored.arrayBuffer, parsed);
        }
      } catch {
        // Fallback to built-in below if SF2 unavailable
      }
    }
    const sf2Resolved = await decodeSf2PresetZones(bankId, bank, program, rawOfflineCtx);
    if (sf2Resolved) return sf2Resolved;
  }

  const def = findBuiltinDefinition({
    instrumentId: p.instrumentId,
    bankNumber: bank,
    programNumber: program,
    midiChannel: p.midiChannel,
  });
  return decodeBuiltinPresetZones(def.id, rawOfflineCtx);
}

function selectOfflineZones(
  zones: InstrumentSampleZone[],
  pitch: number,
  velMidi: number
): InstrumentSampleZone[] {
  let matches = zones.filter(
    (z) => pitch >= z.keyLow && pitch <= z.keyHigh && velMidi >= z.velLow && velMidi <= z.velHigh
  );
  if (matches.length === 0) {
    matches = zones.filter((z) => pitch >= z.keyLow && pitch <= z.keyHigh);
  }
  if (matches.length === 0 && zones.length > 0) {
    let best = zones[0];
    let bestDist = Infinity;
    for (const z of zones) {
      const mid = (z.keyLow + z.keyHigh) * 0.5;
      const d = Math.abs(mid - pitch);
      if (d < bestDist) {
        bestDist = d;
        best = z;
      }
    }
    matches = [best];
  }
  return matches.slice(0, 3);
}

function scheduleOfflineSoundfontNote(
  track: TrackModel,
  resolved: ResolvedInstrumentZones,
  sfBus: Tone.Gain,
  note: MidiNote,
  when: number,
  durSec: number,
  secPerBeat: number
): void {
  const p = track.instrument.params;
  const isDrum =
    resolved.isDrumKit ||
    (p.midiChannel ?? 1) === 10 ||
    note.channel === 10;
  const pitchOffset = Math.round(p.pitchSemitones ?? 0);
  const targetPitch = isDrum
    ? Math.max(0, Math.min(127, Math.round(note.pitch)))
    : Math.max(12, Math.min(120, Math.round(note.pitch + pitchOffset)));
  const velNorm = Math.max(1 / 127, Math.min(1, note.velocity / 127));
  const velMidi = Math.max(1, Math.min(127, Math.round(note.velocity)));
  const zones = selectOfflineZones(resolved.zones, targetPitch, velMidi);
  if (zones.length === 0) return;

  const ctx = Tone.getContext();
  const naturalGain = mapVelocityToNaturalGain(velNorm);
  const pitchBend = p.pitchBendSemitones ?? 0;

  for (const zone of zones) {
    const src = ctx.createBufferSource();
    const filt = ctx.createBiquadFilter();
    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    if (!src?.playbackRate || !filt?.frequency || !pan?.pan || !gain?.gain) {
      return;
    }

    src.buffer = zone.buffer;
    src.loop = zone.loop;
    if (zone.loop && zone.loopEndSec > zone.loopStartSec + 0.005) {
      src.loopStart = zone.loopStartSec;
      src.loopEnd = zone.loopEndSec;
    }

    const baseDetune =
      (targetPitch - zone.rootMidi) * zone.scaleTuning +
      zone.coarseTune * 100 +
      zone.fineTune;
    const initialRate = Math.max(
      0.05,
      Math.min(16, Math.pow(2, (baseDetune + pitchBend * 100) / 1200))
    );
    src.playbackRate.setValueAtTime(initialRate, when);

    if (note.pitchSlide && note.pitchSlide.length > 0 && !isDrum) {
      const sorted = [...note.pitchSlide].sort((a, b) => a.beatOffset - b.beatOffset);
      for (const pt of sorted) {
        const slideRate = Math.max(
          0.05,
          Math.min(16, Math.pow(2, (baseDetune + (pitchBend + pt.semitones) * 100) / 1200))
        );
        src.playbackRate.exponentialRampToValueAtTime(
          slideRate,
          when + Math.max(0.004, pt.beatOffset * secPerBeat)
        );
      }
    }

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(
      Math.max(180, Math.min(18000, Math.min(zone.filterCutoffHz, p.cutoff || 14000))),
      when
    );
    filt.Q.setValueAtTime(Math.max(0.5, Math.min(8, zone.filterQ)), when);

    if (note.mpe?.timbre && note.mpe.timbre.length > 0) {
      const sortedTimbre = [...note.mpe.timbre].sort((a, b) => a.beatOffset - b.beatOffset);
      for (const pt of sortedTimbre) {
        const hz = 320 * Math.pow(16000 / 320, Math.max(0, Math.min(1, pt.value / 127)));
        filt.frequency.linearRampToValueAtTime(hz, when + Math.max(0.004, pt.beatOffset * secPerBeat));
      }
    }

    pan.pan.setValueAtTime(Math.max(-1, Math.min(1, zone.pan)), when);
    const peakGain = Math.max(0.01, (naturalGain * zone.gain * 0.9) / Math.sqrt(zones.length));
    const isOneShotDrum = isDrum && !zone.loop;
    const attack = isOneShotDrum ? 0.001 : Math.max(0.001, p.attack);
    const decay = isOneShotDrum ? Math.max(0.15, zone.decaySec) : Math.max(0.04, p.decay);
    const sustain = isOneShotDrum ? 1.0 : Math.max(0.02, Math.min(1, p.sustain));
    const release = isOneShotDrum ? 0.16 : Math.max(0.015, p.release);
    const sustainLevel = Math.max(0.0001, peakGain * sustain);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peakGain, when + attack);
    if (!isOneShotDrum) {
      gain.gain.linearRampToValueAtTime(sustainLevel, when + attack + decay);
    }

    if (note.mpe?.pressure && note.mpe.pressure.length > 0 && !isOneShotDrum) {
      const sortedPress = [...note.mpe.pressure].sort((a, b) => a.beatOffset - b.beatOffset);
      for (const pt of sortedPress) {
        const scale = 0.4 + 0.95 * Math.max(0, Math.min(1, pt.value / 127));
        gain.gain.linearRampToValueAtTime(
          Math.max(0.0001, Math.min(1, sustainLevel * scale)),
          when + Math.max(0.006, pt.beatOffset * secPerBeat)
        );
      }
    }

    src.connect(filt);
    filt.connect(pan);
    pan.connect(gain);
    Tone.connect(gain, sfBus);

    src.start(when);
    if (isOneShotDrum) {
      src.stop(when + Math.min(zone.buffer.duration, Math.max(durSec, 1.5)));
    } else {
      const off = when + durSec;
      gain.gain.setTargetAtTime(0, off, Math.max(0.006, release / 3.5));
      src.stop(off + release + 0.05);
    }
  }
}

async function scheduleOfflineTrack(
  track: TrackModel,
  project: ProjectState,
  decodedBuffers: Map<string, AudioBuffer>,
  destNode: Tone.ToneAudioNode,
  secPerBeat: number,
  includeSessionFallback = false
): Promise<void> {
  const p = track.instrument.params;
  const oscVolDb = Math.max(-24, Math.min(6, p.oscVolume ?? 0));
  const pitchOffset = Math.round(p.pitchSemitones ?? 0);

  const ch = new Tone.Channel({
    volume: track.volumeDb + (track.isGroupFolder ? 0 : oscVolDb),
    pan: track.pan,
  });
  buildOfflineEffectChain(track.effects, ch, destNode);

  let poly: Tone.PolySynth | null = null;
  let mono: Tone.MonoSynth | null = null;
  let kick: Tone.MembraneSynth | null = null;
  let snare: Tone.NoiseSynth | null = null;
  let hat: Tone.NoiseSynth | null = null;
  let sfZones: ResolvedInstrumentZones | null = null;
  let sfBus: Tone.Gain | null = null;

  if (track.instrument.type === 'soundfont') {
    const chorusNode = new Tone.Chorus({
      frequency: 1.5,
      delayTime: 3.2,
      depth: 0.45,
      wet: Math.max(0, Math.min(1, p.chorus ?? 0)),
    }).connect(ch);
    try {
      chorusNode.start();
    } catch {
      // ignore
    }
    const filter = new Tone.Filter(Math.max(120, Math.min(16000, p.cutoff)), 'lowpass').connect(chorusNode);
    sfBus = new Tone.Gain(1).connect(filter);
    sfZones = await resolveOfflineSoundfontZones(
      track,
      Tone.getContext().rawContext as BaseAudioContext
    );
  } else if (track.instrument.type === 'drumSynth') {
    kick = new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 5.5 }).connect(ch);
    snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
    }).connect(new Tone.Filter(1800, 'bandpass').connect(ch));
    hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
    }).connect(new Tone.Filter(7200, 'highpass').connect(ch));
  } else if (track.instrument.type === 'bassSynth') {
    mono = new Tone.MonoSynth({
      oscillator: { type: p.waveform },
      filter: { Q: p.resonance, type: 'lowpass', rolloff: -24 },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
      filterEnvelope: {
        attack: 0.005,
        decay: 0.18,
        sustain: 0.25,
        release: 0.14,
        baseFrequency: Math.max(60, p.cutoff * 0.2),
        octaves: 2.5,
      },
    }).connect(ch);
  } else if (track.instrument.type === 'gesturePiano') {
    const filter = new Tone.Filter(Math.min(8500, p.cutoff), 'lowpass').connect(ch);
    const preset = p.pianoPreset ?? 'acousticPiano';
    const oscOptions =
      preset === 'synthPiano' && p.waveform !== 'triangle'
        ? { type: p.waveform }
        : { type: 'custom' as const, partials: getPianoPartials(preset) };
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: oscOptions,
      envelope: {
        attack: Math.max(0.006, p.attack),
        decay: Math.max(0.18, p.decay),
        sustain: p.sustain,
        release: Math.max(0.15, p.release),
      },
    }).connect(filter);
    poly.volume.value = -9;
  } else {
    const filter = new Tone.Filter(p.cutoff, 'lowpass').connect(ch);
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: p.waveform },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
    }).connect(filter);
  }

  let trackClips = project.arrangementClips.filter((c) => c.trackId === track.id);
  if (trackClips.length === 0 && includeSessionFallback) {
    const firstSlotId = track.sessionSlots.find((s) => Boolean(s));
    if (firstSlotId) {
      const m = project.midiClips[firstSlotId];
      const a = project.audioClips[firstSlotId];
      if (m) {
        trackClips = [
          {
            id: 'tmp-session',
            trackId: track.id,
            name: m.name,
            color: m.color,
            kind: 'midi',
            sourceClipId: m.id,
            startBeat: 0,
            lengthBeats: m.lengthBeats,
            offsetBeats: 0,
          },
        ];
      } else if (a) {
        trackClips = [
          {
            id: 'tmp-session',
            trackId: track.id,
            name: a.name,
            color: a.color,
            kind: 'audio',
            sourceClipId: a.id,
            startBeat: 0,
            lengthBeats: a.lengthBeats,
            offsetBeats: 0,
          },
        ];
      }
    }
  }

  for (const arrClip of trackClips) {
    if (arrClip.kind === 'midi') {
      const midi = project.midiClips[arrClip.sourceClipId];
      if (!midi || midi.lengthBeats <= 0) continue;

      const loopAllowed = arrClip.looped !== false;
      const swingPercent = project.swingPercent ?? 0;
      let cursor = 0;
      while (cursor < arrClip.lengthBeats - 0.001) {
        for (const note of midi.notes) {
          const localBeat = note.startBeat - arrClip.offsetBeats;
          const rawAbsBeat = arrClip.startBeat + cursor + localBeat;
          if (rawAbsBeat < arrClip.startBeat || rawAbsBeat >= arrClip.startBeat + arrClip.lengthBeats) {
            continue;
          }
          const absBeat = applySwingToBeat(rawAbsBeat, swingPercent);
          if (absBeat >= arrClip.startBeat + arrClip.lengthBeats) continue;
          const when = absBeat * secPerBeat;
          const dur = Math.max(
            0.05,
            Math.min(note.durationBeats, arrClip.startBeat + arrClip.lengthBeats - absBeat) * secPerBeat
          );
          const vel = Math.max(0.05, Math.min(1, note.velocity / 127));
          const shiftedPitch = Math.max(21, Math.min(108, note.pitch + pitchOffset));

          if (sfZones && sfBus) {
            scheduleOfflineSoundfontNote(track, sfZones, sfBus, note, when, dur, secPerBeat);
          } else if (track.instrument.type === 'drumSynth') {
            if (note.pitch === 36) kick?.triggerAttackRelease('C1', dur, when, vel);
            else if (note.pitch === 38 || note.pitch === 39) snare?.triggerAttackRelease(dur, when, vel);
            else hat?.triggerAttackRelease(dur, when, vel * 0.7);
          } else if (mono) {
            mono.triggerAttackRelease(midiToNoteName(shiftedPitch), dur, when, vel);
          } else if (poly) {
            poly.triggerAttackRelease(midiToNoteName(shiftedPitch), dur, when, vel);
          }
        }
        if (!loopAllowed) break;
        cursor += midi.lengthBeats;
      }
    } else if (arrClip.kind === 'audio') {
      const audioMeta = project.audioClips[arrClip.sourceClipId];
      if (!audioMeta) continue;
      const buf = decodedBuffers.get(audioMeta.assetId);
      if (!buf) continue;
      const player = new Tone.Player(buf).connect(ch);
      const startTime = arrClip.startBeat * secPerBeat;
      const offsetSec = arrClip.offsetBeats * secPerBeat;
      const durSec = Math.min(arrClip.lengthBeats * secPerBeat, Math.max(0.05, buf.duration - offsetSec));
      player.start(startTime, offsetSec, durSec);
    }
  }
}

export async function renderProjectToWav(
  project: ProjectState,
  decodedBuffers: Map<string, AudioBuffer>
): Promise<Blob> {
  const secPerBeat = 60 / project.bpm;

  let totalBeats = Math.max(project.loopEndBeat, 16);
  if (project.arrangementClips.length > 0) {
    const maxEnd = Math.max(
      ...project.arrangementClips.map((c) => c.startBeat + c.lengthBeats)
    );
    totalBeats = Math.max(8, maxEnd);
  }
  const durationSeconds = totalBeats * secPerBeat + 0.8;

  const anySolo = project.tracks.some((t) => t.solo);
  const trackMap = new Map(project.tracks.map((t) => [t.id, t]));

  const rendered = await Tone.Offline(async ({ transport }) => {
    transport.bpm.value = project.bpm;

    const masterGain = new Tone.Gain(Tone.dbToGain(project.masterVolumeDb));
    const limiter = new Tone.Limiter(-1);
    masterGain.chain(limiter, Tone.getDestination());

    const groupBuses = new Map<string, Tone.Gain>();
    for (const grp of project.tracks) {
      if (!grp.isGroupFolder) continue;
      const anyChildSolo = project.tracks.some((c) => c.groupId === grp.id && c.solo);
      const groupSoloAllowed = !anySolo || grp.solo || anyChildSolo;
      if (grp.muted || !groupSoloAllowed) continue;

      const grpInput = new Tone.Gain(1);
      const grpChannel = new Tone.Channel({ volume: grp.volumeDb, pan: grp.pan });
      grpInput.connect(grpChannel);
      buildOfflineEffectChain(grp.effects, grpChannel, masterGain);
      groupBuses.set(grp.id, grpInput);

      // If group is frozen, play its frozen audio stem directly into the group channel
      if (grp.frozen) {
        const frzClip = project.arrangementClips.find(
          (c) => c.trackId === grp.id && c.kind === 'audio'
        );
        if (frzClip) {
          const audioMeta = project.audioClips[frzClip.sourceClipId];
          const buf = audioMeta ? decodedBuffers.get(audioMeta.assetId) : undefined;
          if (buf) {
            const player = new Tone.Player(buf).connect(grpInput);
            const durSec = Math.min(frzClip.lengthBeats * secPerBeat, buf.duration);
            player.start(frzClip.startBeat * secPerBeat, 0, Math.max(0.05, durSec));
          }
        }
      }
    }

    for (const track of project.tracks) {
      if (track.isGroupFolder) continue;
      const parentGroup = track.groupId ? trackMap.get(track.groupId) : undefined;
      if (parentGroup?.frozen) continue;
      const muted = track.muted || Boolean(parentGroup?.muted);
      const soloAllowed = !anySolo || track.solo || Boolean(parentGroup?.solo);
      if (muted || !soloAllowed) continue;

      const dest =
        track.groupId && groupBuses.has(track.groupId)
          ? groupBuses.get(track.groupId)!
          : masterGain;
      await scheduleOfflineTrack(track, project, decodedBuffers, dest, secPerBeat);
    }
  }, durationSeconds);

  return audioBufferToWavBlob(rendered.get() as AudioBuffer);
}

export async function renderGroupToAudioBuffer(
  project: ProjectState,
  groupId: string,
  decodedBuffers: Map<string, AudioBuffer>
): Promise<{ buffer: AudioBuffer; totalBeats: number }> {
  const group = project.tracks.find((t) => t.id === groupId && t.isGroupFolder);
  if (!group) throw new Error('Group track not found');

  const children = project.tracks.filter((t) => !t.isGroupFolder && t.groupId === groupId);
  const childIds = new Set(children.map((c) => c.id));
  const secPerBeat = 60 / project.bpm;

  const arrClips = project.arrangementClips.filter((c) => childIds.has(c.trackId));
  let totalBeats = 4;
  if (arrClips.length > 0) {
    totalBeats = Math.max(1, Math.max(...arrClips.map((c) => c.startBeat + c.lengthBeats)));
  } else {
    for (const c of children) {
      const slotId = c.sessionSlots.find((s) => Boolean(s));
      if (slotId) {
        const m = project.midiClips[slotId];
        const a = project.audioClips[slotId];
        totalBeats = Math.max(totalBeats, m?.lengthBeats ?? a?.lengthBeats ?? 4);
      }
    }
  }

  const durationSeconds = totalBeats * secPerBeat + 0.6;
  const rendered = await Tone.Offline(async ({ transport }) => {
    transport.bpm.value = project.bpm;

    const grpInput = new Tone.Gain(1);
    const grpChannel = new Tone.Channel({ volume: group.volumeDb, pan: group.pan });
    grpInput.connect(grpChannel);
    buildOfflineEffectChain(group.effects, grpChannel, Tone.getDestination());

    for (const child of children) {
      if (child.muted) continue;
      await scheduleOfflineTrack(child, project, decodedBuffers, grpInput, secPerBeat, true);
    }
  }, durationSeconds);

  return { buffer: rendered.get() as AudioBuffer, totalBeats };
}

export async function renderTrackToAudioBuffer(
  project: ProjectState,
  trackId: string,
  decodedBuffers: Map<string, AudioBuffer>
): Promise<{ buffer: AudioBuffer; totalBeats: number }> {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error('Track not found');

  const secPerBeat = 60 / project.bpm;
  const arrClips = project.arrangementClips.filter((c) => c.trackId === trackId);
  let totalBeats = 4;
  if (arrClips.length > 0) {
    totalBeats = Math.max(1, Math.max(...arrClips.map((c) => c.startBeat + c.lengthBeats)));
  } else {
    const firstSlotId = track.sessionSlots.find((s) => Boolean(s));
    if (firstSlotId) {
      const m = project.midiClips[firstSlotId];
      const a = project.audioClips[firstSlotId];
      totalBeats = Math.max(1, m?.lengthBeats ?? a?.lengthBeats ?? 4);
    }
  }
  const durationSeconds = totalBeats * secPerBeat + 0.4;

  const rendered = await Tone.Offline(async ({ transport }) => {
    transport.bpm.value = project.bpm;
    const bus = new Tone.Gain(1).toDestination();
    await scheduleOfflineTrack(track, project, decodedBuffers, bus, secPerBeat, true);
  }, durationSeconds);

  return { buffer: rendered.get() as AudioBuffer, totalBeats };
}

export function reverseAudioBuffer(ctx: BaseAudioContext, source: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) {
      dst[i] = src[j];
    }
  }
  return out;
}

export function normalizeAudioBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  targetPeak = 0.95
): AudioBuffer {
  let maxAbs = 0;
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > maxAbs) maxAbs = a;
    }
  }
  const gain = maxAbs > 1e-5 ? targetPeak / maxAbs : 1;
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = Math.max(-1, Math.min(1, src[i] * gain));
    }
  }
  return out;
}

export function cropAudioBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  durationSec: number,
  gainLinear = 1
): AudioBuffer {
  const startSample = Math.max(0, Math.min(source.length - 1, Math.floor(startSec * source.sampleRate)));
  const count = Math.max(1, Math.min(source.length - startSample, Math.floor(durationSec * source.sampleRate)));
  const out = ctx.createBuffer(source.numberOfChannels, count, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const src = source.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < count; i++) {
      dst[i] = Math.max(-1, Math.min(1, src[startSample + i] * gainLinear));
    }
  }
  return out;
}

/**
 * Generates a standard Type-0 MIDI (.mid) file Blob for exporting a MidiClip.
 */
export function midiClipToSmfBlob(clip: MidiClip, bpm: number, swingPercent = 0): Blob {
  const ppq = 480;
  const tempoUsec = Math.round(60000000 / Math.max(30, bpm));

  const writeVarLen = (val: number): number[] => {
    let v = Math.max(0, Math.floor(val));
    const bytes = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    return bytes;
  };

  interface RawEvt {
    tick: number;
    bytes: number[];
  }
  const events: RawEvt[] = [
    {
      tick: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (tempoUsec >> 16) & 0xff,
        (tempoUsec >> 8) & 0xff,
        tempoUsec & 0xff,
      ],
    },
  ];

  for (const n of clip.notes) {
    const swungStartBeat = applySwingToBeat(n.startBeat, swingPercent);
    const startTick = Math.max(0, Math.round(swungStartBeat * ppq));
    const endTick = Math.max(startTick + 12, Math.round((swungStartBeat + n.durationBeats) * ppq));
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
    const ch = Math.max(0, Math.min(15, (n.channel ?? 1) - 1));
    events.push({ tick: startTick, bytes: [0x90 | ch, pitch, vel] });
    events.push({ tick: endTick, bytes: [0x80 | ch, pitch, 0] });
  }

  events.sort((a, b) => a.tick - b.tick);

  const trackData: number[] = [];
  let prevTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - prevTick);
    prevTick = ev.tick;
    trackData.push(...writeVarLen(delta), ...ev.bytes);
  }
  // End of track
  trackData.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0x00, 0x00, 0x00, 0x06, // header length
    0x00, 0x00, // format 0
    0x00, 0x01, // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];
  const len = trackData.length;
  const trackChunk = [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...trackData,
  ];

  return new Blob([new Uint8Array([...header, ...trackChunk])], { type: 'audio/midi' });
}
