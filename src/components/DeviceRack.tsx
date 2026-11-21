import React, { useState } from 'react';
import {
  Plus,
  Power,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  Folder,
  Layers,
  Library,
  RotateCcw,
} from 'lucide-react';
import {
  EffectConfig,
  EffectType,
  GesturePianoPreset,
  InstrumentCatalogEntry,
  InstrumentConfig,
  SoundBankSummary,
  StoredAudioAsset,
  TrackModel,
} from '../types/daw';
import { RotaryKnob } from './RotaryKnob';
import { TouchFader } from './TouchFader';
import { normalizePianoPreset } from '../audio/midiEngine';
import { getTrackInstrumentDisplayName } from '../data/presets';

interface DeviceRackProps {
  track: TrackModel | null;
  allTracks?: TrackModel[];
  onSelectTrack?: (trackId: string) => void;
  audioAssets: StoredAudioAsset[];
  soundBanks?: SoundBankSummary[];
  instrumentCatalog?: InstrumentCatalogEntry[];
  onSetInstrumentType: (trackId: string, type: InstrumentConfig['type']) => void;
  onUpdateInstrumentParams: (
    trackId: string,
    patch: Partial<InstrumentConfig['params']>
  ) => void;
  onAssignInstrument?: (trackId: string, entry: InstrumentCatalogEntry) => void;
  onSetTrackProgram?: (trackId: string, bank: number, program: number) => void;
  onSetTrackPan?: (trackId: string, pan: number) => void;
  onSetTrackSend?: (trackId: string, sendType: 'reverb' | 'delay', amount: number) => void;
  onSetTrackSustain?: (trackId: string, active: boolean) => void;
  onSetTrackPitchBend?: (trackId: string, semitones: number) => void;
  onOpenInstrumentBrowser?: (trackId: string) => void;
  onAddEffect: (trackId: string, type: EffectType) => void;
  onUpdateEffect: (
    trackId: string,
    effectId: string,
    patch: Partial<EffectConfig> & { paramPatch?: Record<string, number | string> }
  ) => void;
  onRemoveEffect: (trackId: string, effectId: string) => void;
  onMoveEffect: (trackId: string, effectId: string, delta: -1 | 1) => void;
  onAuditionTrack?: (trackId: string, pitch: number) => void;
}

const INSTRUMENT_LIST: Array<{
  id: string;
  label: string;
  engineType: InstrumentConfig['type'];
  patch?: Partial<InstrumentConfig['params']>;
}> = [
  {
    id: 'simpler',
    label: 'Simpler',
    engineType: 'sampler',
    patch: { attack: 0.005, decay: 0.35, sustain: 0.75, release: 0.22, cutoff: 10000 },
  },
  {
    id: 'sampler',
    label: 'Sampler',
    engineType: 'sampler',
    patch: { attack: 0.01, decay: 0.5, sustain: 0.85, release: 0.4, cutoff: 11500 },
  },
  {
    id: 'operator',
    label: 'Operator',
    engineType: 'synth',
    patch: { waveform: 'triangle', attack: 0.006, decay: 0.25, sustain: 0.3, release: 0.28, cutoff: 4800, resonance: 1.8 },
  },
  {
    id: 'analog',
    label: 'Analog Bass',
    engineType: 'bassSynth',
    patch: { waveform: 'sawtooth', attack: 0.005, decay: 0.2, sustain: 0.45, release: 0.16, cutoff: 950, resonance: 2.8 },
  },
  {
    id: 'wavetable',
    label: 'Wavetable',
    engineType: 'synth',
    patch: { waveform: 'sawtooth', attack: 0.02, decay: 0.38, sustain: 0.55, release: 0.42, cutoff: 2600, resonance: 1.5 },
  },
  {
    id: 'drumrack',
    label: 'Drum Rack',
    engineType: 'drumSynth',
    patch: { decay: 0.3, cutoff: 8500, resonance: 1.0 },
  },
  {
    id: 'collision',
    label: 'Collision',
    engineType: 'synth',
    patch: { waveform: 'square', attack: 0.003, decay: 0.18, sustain: 0.15, release: 0.22, cutoff: 3400, resonance: 2.4 },
  },
  {
    id: 'gesturepiano',
    label: 'Studio Piano',
    engineType: 'gesturePiano',
    patch: {
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
];

const EFFECT_META: Array<{ type: EffectType; label: string; dotColor: string }> = [
  { type: 'eq', label: 'EQ Three', dotColor: '#EAB308' },
  { type: 'compressor', label: 'Compressor', dotColor: '#38BDF8' },
  { type: 'reverb', label: 'Reverb', dotColor: '#2E9BFF' },
  { type: 'delay', label: 'Delay', dotColor: '#22C55E' },
  { type: 'distortion', label: 'Distortion', dotColor: '#F97316' },
  { type: 'filter', label: 'Auto Filter', dotColor: '#8B5CF6' },
];

function buildWaveformPath(
  waveform: InstrumentConfig['params']['waveform'],
  cutoff: number,
  resonance: number
): string {
  const pts: string[] = [];
  const harm = Math.max(1, Math.min(8, Math.round((cutoff / 12000) * 6 + resonance * 0.4)));
  for (let x = 0; x <= 280; x += 4) {
    const t = (x / 280) * Math.PI * 4;
    let yVal = 0;
    if (waveform === 'sine') {
      yVal = Math.sin(t);
    } else if (waveform === 'triangle') {
      yVal = (2 / Math.PI) * Math.asin(Math.sin(t)) + 0.15 * Math.sin(t * harm);
    } else if (waveform === 'square') {
      yVal = Math.sin(t) >= 0 ? 0.8 : -0.8;
      yVal += 0.18 * Math.sin(t * harm);
    } else {
      // sawtooth
      yVal = (2 * ((t / (2 * Math.PI)) % 1) - 1) * 0.8 + 0.2 * Math.sin(t * harm);
    }
    const y = 44 - Math.max(-1, Math.min(1, yVal)) * 32;
    pts.push(`${x === 0 ? 'M' : 'L'} ${x} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

export const DeviceRack: React.FC<DeviceRackProps> = ({
  track,
  allTracks,
  onSelectTrack,
  audioAssets,
  soundBanks = [],
  instrumentCatalog = [],
  onSetInstrumentType,
  onUpdateInstrumentParams,
  onAssignInstrument,
  onSetTrackProgram,
  onSetTrackPan,
  onSetTrackSend,
  onSetTrackSustain,
  onSetTrackPitchBend,
  onOpenInstrumentBrowser,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onMoveEffect,
  onAuditionTrack,
}) => {
  const defaultPresetForTrack = (t: TrackModel | null): string => {
    if (!t) return 'wavetable';
    if (t.instrument.type === 'soundfont') return 'soundfont';
    if (t.instrument.type === 'gesturePiano') return 'gesturepiano';
    if (t.instrument.type === 'drumSynth') return 'drumrack';
    if (t.instrument.type === 'bassSynth') return 'analog';
    if (t.instrument.type === 'sampler') return 'sampler';
    if (t.instrument.params.waveform === 'triangle') return 'operator';
    if (t.instrument.params.waveform === 'square') return 'collision';
    return 'wavetable';
  };

  const [selectedPresetByTrack, setSelectedPresetByTrack] = useState<Record<string, string>>({});
  const [expandedFxId, setExpandedFxId] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<'library' | 'engines'>('library');

  if (!track) {
    return (
      <div className="h-full flex items-center justify-center bg-[#101218] text-xs text-zinc-500">
        Select a track to edit its instrument and audio effect chain.
      </div>
    );
  }

  const p = track.instrument.params;
  const wavePath = buildWaveformPath(p.waveform, p.cutoff, p.resonance);
  const activePresetId = selectedPresetByTrack[track.id] ?? defaultPresetForTrack(track);
  const groupChildren = track.isGroupFolder
    ? (allTracks ?? []).filter((t) => !t.isGroupFolder && t.groupId === track.id)
    : [];

  const handleSelectInstrumentPreset = (item: (typeof INSTRUMENT_LIST)[number]) => {
    setSelectedPresetByTrack((prev) => ({ ...prev, [track.id]: item.id }));
    onSetInstrumentType(track.id, item.engineType);
    if (item.patch) {
      onUpdateInstrumentParams(track.id, item.patch);
    }
  };

  const activeCatalogEntries =
    track.instrument.type === 'soundfont' && p.soundBankId
      ? instrumentCatalog.filter((c) => c.soundBankId === p.soundBankId)
      : instrumentCatalog;
  const sf2BankPresets = activeCatalogEntries.length > 0 ? activeCatalogEntries : instrumentCatalog;
  const currentCatalogMatch =
    instrumentCatalog.find((c) => c.id === p.instrumentId) ??
    instrumentCatalog.find(
      (c) =>
        c.soundBankId === p.soundBankId &&
        c.bank === p.bankNumber &&
        c.program === p.programNumber
    );
  const activeSoundBank = soundBanks.find((b) => b.id === p.soundBankId);
  const bendRange = Math.max(1, p.pitchBendRange ?? 2);
  const pitchBendVal = Math.max(-bendRange, Math.min(bendRange, p.pitchBendSemitones ?? 0));
  const isDrumInstrument =
    track.instrument.type === 'drumSynth' ||
    (track.instrument.type === 'soundfont' &&
      (p.instrumentCategory === 'Drums' || p.midiChannel === 10));

  return (
    <div className="h-full flex flex-col md:flex-row bg-[#101218] select-none overflow-hidden">
      {/* Left: Sound Library / Engines OR Group Child Routing List */}
      <div className="w-full md:w-52 lg:w-56 shrink-0 bg-[#15171F] border-b md:border-b-0 md:border-r border-white/[0.08] flex flex-col max-h-44 md:max-h-none">
        <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs font-bold text-zinc-200">
            {track.isGroupFolder ? 'Group Routing' : 'Instruments'}
          </span>
          {allTracks && onSelectTrack && (
            <select
              aria-label="Select Track"
              value={track.id}
              onChange={(e) => onSelectTrack(e.target.value)}
              className="h-7 bg-[#101217] border border-white/[0.08] rounded px-1.5 text-[11px] font-semibold text-zinc-200 max-w-[110px]"
            >
              {allTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.isGroupFolder ? `[Group] ${t.name}` : t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {track.isGroupFolder ? (
          <div className="p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto">
            {groupChildren.length === 0 ? (
              <div className="text-[11px] text-zinc-500 p-1">
                No child tracks assigned yet.
              </div>
            ) : (
              groupChildren.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => onSelectTrack?.(child.id)}
                  className="px-2.5 py-2 rounded text-left text-xs font-semibold bg-[#1B1E28] hover:bg-[#242836] text-zinc-200 flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: child.color }}
                  />
                  <span className="truncate">{child.name}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-2 pt-2 pb-1 flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setRailTab('library')}
                className={`flex-1 h-7 rounded text-[11px] font-semibold transition-colors ${
                  railTab === 'library'
                    ? 'bg-[#6D5DFB] text-white'
                    : 'bg-[#101217] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Sound Library
              </button>
              <button
                type="button"
                onClick={() => setRailTab('engines')}
                className={`flex-1 h-7 rounded text-[11px] font-semibold transition-colors ${
                  railTab === 'engines'
                    ? 'bg-[#6D5DFB] text-white'
                    : 'bg-[#101217] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Synth Engines
              </button>
            </div>

            {railTab === 'library' ? (
              <div className="p-1.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto flex-1 min-h-0">
                {onOpenInstrumentBrowser && (
                  <button
                    type="button"
                    onClick={() => onOpenInstrumentBrowser(track.id)}
                    className="px-2.5 py-2 rounded bg-[#6D5DFB]/20 hover:bg-[#6D5DFB]/30 border border-[#6D5DFB]/50 text-indigo-100 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Library className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                    <span>Browse All &amp; .sf2</span>
                  </button>
                )}
                {instrumentCatalog.map((entry) => {
                  const active =
                    track.instrument.type === 'soundfont' &&
                    (p.instrumentId === entry.id ||
                      (p.soundBankId === entry.soundBankId &&
                        p.bankNumber === entry.bank &&
                        p.programNumber === entry.program));
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onAssignInstrument?.(track.id, entry)}
                      className={`px-2.5 py-1.5 rounded text-left text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-[#6D5DFB] text-white'
                          : 'text-zinc-300 hover:bg-[#1E222D]'
                      }`}
                    >
                      <span className="truncate">{entry.name}</span>
                      <span
                        className={`text-[10px] font-normal shrink-0 ${
                          active ? 'text-indigo-100' : 'text-zinc-500'
                        }`}
                      >
                        {entry.category}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-1.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto flex-1 min-h-0">
                {INSTRUMENT_LIST.map((item) => {
                  const active =
                    activePresetId === item.id && track.instrument.type === item.engineType;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectInstrumentPreset(item)}
                      className={`px-2.5 py-1.5 rounded text-left text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-[#6D5DFB] text-white'
                          : 'text-zinc-300 hover:bg-[#1E222D]'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center: Group Bus Audio Processor OR Interactive Instrument Controls Panel */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {track.isGroupFolder ? (
          <div className="rounded border border-white/[0.1] bg-[#161922] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded flex items-center justify-center text-zinc-950"
                  style={{ backgroundColor: track.color }}
                >
                  <Folder className="w-3.5 h-3.5" />
                </span>
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{track.name}</span>
                    <span className="text-[11px] font-medium text-indigo-300">
                      · Group Bus
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {groupChildren.length} routed child track{groupChildren.length === 1 ? '' : 's'} · Sums child outputs into Group Effects &amp; Master
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded bg-[#101218] border border-white/[0.06] p-2.5">
                <div className="text-[10px] uppercase text-zinc-500 font-bold">Bus Volume</div>
                <div className="text-sm font-mono-tabular font-bold text-zinc-100">
                  {track.volumeDb > 0 ? `+${track.volumeDb.toFixed(1)}` : track.volumeDb.toFixed(1)} dB
                </div>
              </div>
              <div className="rounded bg-[#101218] border border-white/[0.06] p-2.5">
                <div className="text-[10px] uppercase text-zinc-500 font-bold">Bus Pan</div>
                <div className="text-sm font-mono-tabular font-bold text-zinc-100">
                  {track.pan === 0
                    ? 'Center'
                    : track.pan < 0
                      ? `L${Math.round(Math.abs(track.pan) * 50)}`
                      : `R${Math.round(track.pan * 50)}`}
                </div>
              </div>
              <div className="rounded bg-[#101218] border border-white/[0.06] p-2.5">
                <div className="text-[10px] uppercase text-zinc-500 font-bold">Reverb Send</div>
                <div className="text-sm font-mono-tabular font-bold text-sky-300">
                  {Math.round((track.sendReverb ?? 0) * 100)}%
                </div>
              </div>
              <div className="rounded bg-[#101218] border border-white/[0.06] p-2.5">
                <div className="text-[10px] uppercase text-zinc-500 font-bold">Delay Send</div>
                <div className="text-sm font-mono-tabular font-bold text-emerald-300">
                  {Math.round((track.sendDelay ?? 0) * 100)}%
                </div>
              </div>
            </div>

            <div className="rounded bg-[#101218] border border-white/[0.06] p-3 flex items-start gap-2.5 text-xs text-zinc-300">
              <Layers className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                All child tracks in <strong>{track.name}</strong> process through their individual insert effects first, sum into this Group Bus, and then pass through the <strong>Effects Chain</strong> on the right before reaching Master.
              </span>
            </div>
          </div>
        ) : (
        <div className="rounded border border-white/[0.1] bg-[#161922] p-3 flex flex-col gap-3">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-xs shrink-0"
                style={{ backgroundColor: track.color }}
              />
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">
                  {track.name} · {getTrackInstrumentDisplayName(track)}
                </div>
                {track.instrument.type === 'soundfont' && (
                  <div className="text-[11px] font-mono-tabular text-zinc-400 truncate">
                    {p.instrumentCategory ?? 'Instrument'} ·{' '}
                    {activeSoundBank?.name ?? 'PulseGrid Sound Bank'} · Bank{' '}
                    {p.bankNumber ?? 0} · Prog {p.programNumber ?? 0} · Ch{' '}
                    {p.midiChannel ?? (isDrumInstrument ? 10 : 1)}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {onOpenInstrumentBrowser && (
                <button
                  type="button"
                  onClick={() => onOpenInstrumentBrowser(track.id)}
                  className="min-h-[36px] px-3 rounded bg-[#6D5DFB]/20 hover:bg-[#6D5DFB]/35 border border-[#6D5DFB]/50 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Library className="w-3.5 h-3.5" />
                  <span>Change Instrument</span>
                </button>
              )}

              {sf2BankPresets.length > 0 && (onSetTrackProgram || onAssignInstrument) && (
                <select
                  aria-label="Instrument or SF2 Preset"
                  value={currentCatalogMatch?.id ?? ''}
                  onChange={(e) => {
                    const entry = instrumentCatalog.find((c) => c.id === e.target.value);
                    if (!entry) return;
                    if (onAssignInstrument) {
                      onAssignInstrument(track.id, entry);
                    } else if (onSetTrackProgram) {
                      onSetTrackProgram(track.id, entry.bank, entry.program);
                    }
                  }}
                  className="h-9 max-w-[190px] bg-[#101217] border border-white/[0.1] rounded px-2 text-xs text-zinc-100"
                >
                  <option value="" disabled>
                    Select Sound / SF2 Preset...
                  </option>
                  {sf2BankPresets.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} ({entry.bank}:{entry.program})
                    </option>
                  ))}
                </select>
              )}

              {track.instrument.type === 'gesturePiano' && (
                <>
                  <div className="flex bg-[#101217] border border-white/[0.08] rounded p-0.5">
                    {(
                      ['acousticPiano', 'electricPiano', 'synthPiano', 'softPiano'] as GesturePianoPreset[]
                    ).map((gp) => (
                      <button
                        key={gp}
                        type="button"
                        onClick={() => onUpdateInstrumentParams(track.id, { pianoPreset: gp })}
                        className={`px-2 py-1 rounded text-[10px] font-bold ${
                          normalizePianoPreset(p.pianoPreset) === gp
                            ? 'bg-[#6D5DFB] text-white'
                            : 'text-zinc-400'
                        }`}
                      >
                        {gp === 'acousticPiano'
                          ? 'Acoustic'
                          : gp === 'electricPiano'
                            ? 'Electric'
                            : gp === 'synthPiano'
                              ? 'Synth'
                              : 'Soft'}
                      </button>
                    ))}
                  </div>
                  {normalizePianoPreset(p.pianoPreset) === 'synthPiano' && (
                    <div className="flex bg-[#101217] border border-white/[0.08] rounded p-0.5">
                      {(['sine', 'triangle', 'sawtooth', 'square'] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => onUpdateInstrumentParams(track.id, { waveform: w })}
                          className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                            p.waveform === w ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400'
                          }`}
                        >
                          {w.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {(track.instrument.type === 'synth' || track.instrument.type === 'bassSynth') && (
                <div className="flex bg-[#101217] border border-white/[0.08] rounded p-0.5">
                  {(['sine', 'triangle', 'sawtooth', 'square'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => onUpdateInstrumentParams(track.id, { waveform: w })}
                      className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                        p.waveform === w ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400'
                      }`}
                    >
                      {w.slice(0, 3)}
                    </button>
                  ))}
                </div>
              )}

              {onAuditionTrack && (
                <button
                  type="button"
                  onClick={() =>
                    onAuditionTrack(
                      track.id,
                      isDrumInstrument
                        ? 36
                        : track.instrument.type === 'bassSynth' ||
                            p.instrumentCategory === 'Bass'
                          ? 36
                          : 60
                    )
                  }
                  className="min-h-[36px] px-3 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Test</span>
                </button>
              )}
            </div>
          </div>

          {/* Glowing Waveform Visualizer */}
          <div className="h-20 rounded bg-[#0C0E13] border border-white/[0.08] overflow-hidden relative flex items-center justify-center">
            <svg viewBox="0 0 280 88" preserveAspectRatio="none" className="w-full h-full">
              <line x1="0" y1="44" x2="280" y2="44" stroke="rgba(255,255,255,0.06)" />
              <path
                d={wavePath}
                fill="none"
                stroke="#8B5CF6"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>

          {track.instrument.type === 'sampler' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">Sample:</span>
              <select
                value={p.sampleAssetId ?? ''}
                onChange={(e) => {
                  const asset = audioAssets.find((a) => a.id === e.target.value);
                  onUpdateInstrumentParams(track.id, {
                    sampleAssetId: asset?.id,
                    sampleName: asset?.name,
                  });
                }}
                className="flex-1 h-8 bg-[#101217] border border-white/[0.08] rounded px-2 text-xs text-zinc-100"
              >
                <option value="">Internal Triangle Tone</option>
                {audioAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.durationSeconds.toFixed(1)}s)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Compact Instrument Controls Panel (Volume, Pan, Attack, Release, Reverb, Chorus, Cutoff, Pitch Bend, Sustain) */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 pt-1">
            <RotaryKnob
              label="Volume"
              value={p.oscVolume ?? 0}
              min={-24}
              max={6}
              defaultValue={0}
              bipolar
              color="#F59E0B"
              size={42}
              displayValue={`${(p.oscVolume ?? 0) > 0 ? '+' : ''}${(p.oscVolume ?? 0).toFixed(1)}dB`}
              onChange={(v) =>
                onUpdateInstrumentParams(track.id, { oscVolume: Math.round(v * 2) / 2 })
              }
            />
            <RotaryKnob
              label="Pan"
              value={track.pan}
              min={-1}
              max={1}
              defaultValue={0}
              bipolar
              color={track.color}
              size={42}
              displayValue={
                track.pan === 0
                  ? 'C'
                  : track.pan < 0
                    ? `L${Math.round(Math.abs(track.pan) * 50)}`
                    : `R${Math.round(track.pan * 50)}`
              }
              onChange={(pan) => onSetTrackPan?.(track.id, Math.round(pan * 20) / 20)}
            />
            <RotaryKnob
              label="Attack"
              value={p.attack}
              min={0.001}
              max={0.5}
              defaultValue={0.015}
              color="#38BDF8"
              size={42}
              displayValue={`${Math.round(p.attack * 1000)}ms`}
              onChange={(v) =>
                onUpdateInstrumentParams(track.id, { attack: Math.round(v * 1000) / 1000 })
              }
            />
            <RotaryKnob
              label="Release"
              value={p.release}
              min={0.05}
              max={2}
              defaultValue={0.3}
              color="#22C55E"
              size={42}
              displayValue={`${p.release.toFixed(2)}s`}
              onChange={(v) =>
                onUpdateInstrumentParams(track.id, { release: Math.round(v * 100) / 100 })
              }
            />
            <RotaryKnob
              label="Reverb"
              value={track.sendReverb ?? 0}
              min={0}
              max={1}
              defaultValue={0}
              color="#38BDF8"
              size={42}
              displayValue={`${Math.round((track.sendReverb ?? 0) * 100)}%`}
              onChange={(v) =>
                onSetTrackSend?.(track.id, 'reverb', Math.round(v * 100) / 100)
              }
            />
            <RotaryKnob
              label="Chorus"
              value={p.chorus ?? 0}
              min={0}
              max={1}
              defaultValue={0}
              color="#A78BFA"
              size={42}
              displayValue={`${Math.round((p.chorus ?? 0) * 100)}%`}
              onChange={(v) =>
                onUpdateInstrumentParams(track.id, { chorus: Math.round(v * 100) / 100 })
              }
            />
            <RotaryKnob
              label="Cutoff"
              value={p.cutoff}
              min={150}
              max={12000}
              defaultValue={2600}
              color="#8B5CF6"
              size={42}
              displayValue={`${Math.round(p.cutoff)}Hz`}
              onChange={(v) => onUpdateInstrumentParams(track.id, { cutoff: Math.round(v) })}
            />
            <RotaryKnob
              label="Transpose"
              value={p.pitchSemitones ?? 0}
              min={-24}
              max={24}
              defaultValue={0}
              bipolar
              color="#F59E0B"
              size={42}
              displayValue={`${(p.pitchSemitones ?? 0) > 0 ? '+' : ''}${Math.round(p.pitchSemitones ?? 0)}st`}
              onChange={(v) =>
                onUpdateInstrumentParams(track.id, { pitchSemitones: Math.round(v) })
              }
            />
          </div>

          {/* Live Pitch Bend Slider + Sustain Pedal (CC64) Strip */}
          <div className="pt-2 border-t border-white/[0.07] flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px] flex items-center gap-2">
              <span className="text-[11px] font-semibold text-zinc-400 shrink-0">
                Pitch Bend
              </span>
              <input
                type="range"
                aria-label="Pitch Bend Semitones"
                min={-bendRange}
                max={bendRange}
                step={0.05}
                value={pitchBendVal}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  onSetTrackPitchBend?.(track.id, next);
                }}
                className="flex-1 accent-[#6D5DFB] cursor-pointer"
              />
              <span className="font-mono-tabular text-[11px] text-zinc-200 w-12 text-right shrink-0">
                {pitchBendVal > 0 ? `+${pitchBendVal.toFixed(1)}` : pitchBendVal.toFixed(1)}st
              </span>
              <button
                type="button"
                onClick={() => onSetTrackPitchBend?.(track.id, 0)}
                title="Center Pitch Bend"
                aria-label="Center Pitch Bend"
                className="min-h-[34px] min-w-[34px] rounded bg-[#1F2330] hover:bg-[#2B3042] text-zinc-300 flex items-center justify-center"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {onSetTrackSustain && (
              <button
                type="button"
                aria-pressed={Boolean(p.sustainActive)}
                onClick={() => onSetTrackSustain(track.id, !p.sustainActive)}
                className={`min-h-[44px] sm:min-h-[36px] px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  p.sustainActive
                    ? 'bg-amber-400 border-amber-300 text-zinc-950'
                    : 'bg-[#101217] border-white/[0.1] text-zinc-300 hover:text-white'
                }`}
              >
                Sustain Pedal (CC64): {p.sustainActive ? 'Down' : 'Up'}
              </button>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Right: Effects Chain Panel matching Screen 5 */}
      <div className="w-full md:w-64 lg:w-72 shrink-0 bg-[#15171F] border-t md:border-t-0 md:border-l border-white/[0.08] p-2.5 flex flex-col gap-2 overflow-y-auto">
        <span className="text-xs font-bold text-zinc-200">Effects Chain</span>

        <div className="flex flex-col gap-1.5">
          {track.effects.map((fx, idx) => {
            const meta = EFFECT_META.find((m) => m.type === fx.type);
            const isExpanded = expandedFxId === fx.id;
            return (
              <div
                key={fx.id}
                className="rounded border border-white/[0.08] bg-[#1B1E28] overflow-hidden"
              >
                <div className="px-2 py-1.5 flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => setExpandedFxId(isExpanded ? null : fx.id)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta?.dotColor ?? '#38BDF8' }}
                    />
                    <span className="text-xs font-semibold text-zinc-100 truncate">
                      {meta?.label ?? fx.type}
                    </span>
                  </button>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onUpdateEffect(track.id, fx.id, { enabled: !fx.enabled })}
                      className={`w-5 h-5 rounded-xs flex items-center justify-center ${
                        fx.enabled ? 'bg-amber-400 text-zinc-950' : 'bg-[#252834] text-zinc-500'
                      }`}
                    >
                      <Power className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMoveEffect(track.id, fx.id, -1)}
                      className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === track.effects.length - 1}
                      onClick={() => onMoveEffect(track.id, fx.id, 1)}
                      className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveEffect(track.id, fx.id)}
                      className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-2 border-t border-white/[0.06] bg-[#13161D] flex flex-col gap-2">
                    {Object.entries(fx.params).map(([key, val]) => {
                      if (typeof val !== 'number') return null;
                      const range =
                        key === 'frequency'
                          ? { min: 80, max: 14000, step: 20, def: 1000, fmt: `${Math.round(val)}Hz` }
                          : key === 'q'
                            ? { min: 0.5, max: 8, step: 0.1, def: 1, fmt: val.toFixed(1) }
                            : key === 'threshold'
                              ? { min: -48, max: 0, step: 1, def: -18, fmt: `${Math.round(val)}dB` }
                              : key === 'ratio'
                                ? { min: 1, max: 12, step: 0.5, def: 3.5, fmt: `${val.toFixed(1)}:1` }
                                : key === 'attack'
                                  ? { min: 0.001, max: 0.2, step: 0.002, def: 0.01, fmt: `${Math.round(val * 1000)}ms` }
                                  : key === 'release'
                                    ? { min: 0.05, max: 1, step: 0.02, def: 0.2, fmt: `${Math.round(val * 1000)}ms` }
                                    : key === 'low' || key === 'mid' || key === 'high'
                                      ? { min: -12, max: 12, step: 0.5, def: 0, fmt: `${val > 0 ? '+' : ''}${val.toFixed(1)}dB` }
                                      : key === 'decay'
                                        ? { min: 0.3, max: 6, step: 0.1, def: 2.2, fmt: `${val.toFixed(1)}s` }
                                        : key === 'delayTime'
                                          ? { min: 0.05, max: 1, step: 0.01, def: 0.375, fmt: `${Math.round(val * 1000)}ms` }
                                          : key === 'feedback'
                                            ? { min: 0, max: 0.85, step: 0.02, def: 0.32, fmt: `${Math.round(val * 100)}%` }
                                            : key === 'resonance'
                                              ? { min: 0.5, max: 12, step: 0.2, def: 1.5, fmt: val.toFixed(1) }
                                              : { min: 0, max: 1, step: 0.02, def: 0.25, fmt: `${Math.round(val * 100)}%` };

                      return (
                        <div key={key} className="flex flex-col gap-0.5">
                          <div className="flex justify-between text-[10px] text-zinc-400">
                            <span className="capitalize">{key}</span>
                            <span className="font-mono-tabular text-zinc-200">{range.fmt}</span>
                          </div>
                          <TouchFader
                            orientation="horizontal"
                            label={`${meta?.label ?? fx.type} ${key}`}
                            value={val}
                            min={range.min}
                            max={range.max}
                            defaultValue={range.def}
                            step={range.step}
                            accentColor={meta?.dotColor ?? '#38BDF8'}
                            displayValue={range.fmt}
                            onChange={(nextVal) =>
                              onUpdateEffect(track.id, fx.id, {
                                paramPatch: { [key]: Math.round(nextVal * 1000) / 1000 },
                              })
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Drop Audio Effects Here Box */}
        <div className="mt-1 rounded border border-dashed border-white/[0.12] bg-[#111319] p-2 flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-400 text-center">
            Drop or Add Audio Effects
          </span>
          <div className="grid grid-cols-2 gap-1">
            {EFFECT_META.map((m) => (
              <button
                key={m.type}
                type="button"
                onClick={() => onAddEffect(track.id, m.type)}
                className="h-7 px-2 rounded bg-[#1E222D] hover:bg-[#282D3B] text-[10px] font-semibold text-zinc-200 flex items-center gap-1 truncate"
              >
                <Plus className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                <span className="truncate">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
