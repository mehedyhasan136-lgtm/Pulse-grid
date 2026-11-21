import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  FolderPlus,
  Layers,
  MoreVertical,
  Plus,
  Power,
  Snowflake,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { EffectConfig, EffectType, ProjectState, TrackModel } from '../types/daw';
import { LIBRARY_ITEMS, LibraryPresetItem } from '../data/presets';
import { dawController, orderTracksHierarchically } from '../audio/dawController';
import { useLongPressContextMenu } from '../hooks/useLongPressContextMenu';
import { RotaryKnob } from './RotaryKnob';
import { TouchFader } from './TouchFader';
import { TrackContextMenu } from './TrackContextMenu';

interface MixerViewProps {
  project: ProjectState;
  selectedTrackId: string;
  selectedTrackIds?: string[];
  onSelectTrack: (
    trackId: string,
    mode?: 'single' | 'toggle' | 'range',
    orderedIds?: string[]
  ) => void;
  onSetTrackVolume: (trackId: string, db: number) => void;
  onSetTrackPan: (trackId: string, pan: number) => void;
  onSetTrackSend?: (trackId: string, sendType: 'reverb' | 'delay', amount: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onToggleArm: (trackId: string) => void;
  onAddEffect: (trackId: string, type: EffectType) => void;
  onUpdateEffect: (
    trackId: string,
    effectId: string,
    patch: Partial<EffectConfig> & { paramPatch?: Record<string, number | string> }
  ) => void;
  onRemoveEffect: (trackId: string, effectId: string) => void;
  onApplyMidiPreset?: (item: LibraryPresetItem) => void;
  onSetMasterVolume: (db: number) => void;
}

const GradientMeter: React.FC<{ getLevel: () => number; muted?: boolean }> = ({
  getLevel,
  muted,
}) => {
  const maskRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const lvl = muted ? 0 : getLevel();
      if (maskRef.current) {
        maskRef.current.style.transform = `scaleY(${(1 - lvl).toFixed(3)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, muted]);

  return (
    <div className="relative w-3 h-40 rounded-xs bg-[#0B0D11] border border-white/[0.08] overflow-hidden shrink-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, #16A34A 0%, #22C55E 65%, #EAB308 85%, #EF4444 100%)',
        }}
      />
      <div
        ref={maskRef}
        className="absolute inset-0 bg-[#0B0D11] origin-top will-change-transform"
        style={{ transform: 'scaleY(1)' }}
      />
    </div>
  );
};

interface MixerChannelHeaderProps {
  track: TrackModel;
  onToggleCollapse?: () => void;
  onOpenMenu: (track: TrackModel, x: number, y: number) => void;
}

const MixerChannelHeader: React.FC<MixerChannelHeaderProps> = ({
  track,
  onToggleCollapse,
  onOpenMenu,
}) => {
  const { bind, consumeLongPressClick } = useLongPressContextMenu({
    onOpen: ({ x, y }) => onOpenMenu(track, x, y),
  });

  return (
    <div
      {...bind}
      onClick={(e) => {
        if (consumeLongPressClick()) e.stopPropagation();
      }}
      style={{ backgroundColor: track.color }}
      className="px-2 py-1.5 rounded-t-[3px] flex items-center justify-between gap-1 text-zinc-950"
    >
      <div className="flex items-center gap-1 min-w-0">
        {track.isGroupFolder && onToggleCollapse && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={track.collapsed ? `Expand ${track.name}` : `Collapse ${track.name}`}
            className="w-6 h-6 -ml-1 rounded flex items-center justify-center bg-black/15 hover:bg-black/25 shrink-0"
          >
            {track.collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {track.isGroupFolder && <Folder className="w-3 h-3 shrink-0" />}
        {track.frozen && <Snowflake className="w-3 h-3 shrink-0" />}
        <span className="text-xs font-bold truncate">{track.name}</span>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <span className="text-[9px] font-mono-tabular uppercase font-bold opacity-75">
          {track.isGroupFolder ? 'GRP' : track.type}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenMenu(track, rect.left, rect.bottom + 4);
          }}
          aria-label={`Track options for ${track.name}`}
          className="w-6 h-6 rounded flex items-center justify-center text-zinc-950/80 hover:bg-black/15"
        >
          <MoreVertical className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export const MixerView: React.FC<MixerViewProps> = ({
  project,
  selectedTrackId,
  selectedTrackIds,
  onSelectTrack,
  onSetTrackVolume,
  onSetTrackPan,
  onSetTrackSend,
  onToggleMute,
  onToggleSolo,
  onToggleArm,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onApplyMidiPreset,
  onSetMasterVolume,
}) => {
  const [fxTab, setFxTab] = useState<'audio' | 'midi'>('audio');
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [trackMenu, setTrackMenu] = useState<{
    track: TrackModel;
    x: number;
    y: number;
  } | null>(null);
  const insertAudioInputRef = useRef<HTMLInputElement | null>(null);
  const insertAudioTargetTrackRef = useRef<string | null>(null);

  const hierarchicalTracks = orderTracksHierarchically(project.tracks);
  const collapsedGroupIds = new Set(
    project.tracks.filter((t) => t.isGroupFolder && t.collapsed).map((t) => t.id)
  );
  const visibleTracks = hierarchicalTracks.filter(
    (t) => t.isGroupFolder || !t.groupId || !collapsedGroupIds.has(t.groupId)
  );

  const selectedTrack =
    project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0] ?? null;
  const activeSelectionIds = selectedTrackIds ?? [selectedTrackId];
  const orderedIds = visibleTracks.map((t) => t.id);

  const selectedNonGroupIds = activeSelectionIds.filter(
    (id) => !project.tracks.find((t) => t.id === id)?.isGroupFolder
  );
  const hasGroupableOrUngroupable = activeSelectionIds.some((id) => {
    const tr = project.tracks.find((t) => t.id === id);
    return Boolean(tr && (tr.isGroupFolder || tr.groupId));
  });

  const eqFx = selectedTrack?.effects.find((e) => e.type === 'eq');
  const compFx = selectedTrack?.effects.find((e) => e.type === 'compressor');
  const reverbFx = selectedTrack?.effects.find((e) => e.type === 'reverb');
  const delayFx = selectedTrack?.effects.find((e) => e.type === 'delay');

  const lowDb = Number(eqFx?.params.low ?? 0);
  const midDb = Number(eqFx?.params.mid ?? 0);
  const highDb = Number(eqFx?.params.high ?? 0);
  const mapEqY = (db: number) => 36 - (db / 12) * 24;
  const eqPath = `M 0 ${mapEqY(lowDb)} C 45 ${mapEqY(lowDb)}, 70 ${mapEqY(midDb)}, 100 ${mapEqY(midDb)} C 130 ${mapEqY(midDb)}, 155 ${mapEqY(highDb)}, 200 ${mapEqY(highDb)}`;

  const handleTrackClick = (e: React.MouseEvent, trackId: string) => {
    if (e.shiftKey) {
      onSelectTrack(trackId, 'range', orderedIds);
    } else if (e.metaKey || e.ctrlKey || multiSelectMode) {
      onSelectTrack(trackId, 'toggle', orderedIds);
    } else {
      onSelectTrack(trackId, 'single', orderedIds);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row bg-[#101218] overflow-hidden select-none">
      <input
        ref={insertAudioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const tid = insertAudioTargetTrackRef.current;
          if (file && tid) {
            void dawController.importAudioFile(file, { trackId: tid, startBeat: 0 });
            e.target.value = '';
          }
        }}
      />

      {/* Left/Center: Multi-Track Channel Console */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Mixer Action Bar (Multi-select & Group Actions) */}
        <div className="px-2.5 py-1.5 bg-[#141720] border-b border-white/[0.08] flex items-center justify-between gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setMultiSelectMode((m) => !m)}
              aria-pressed={multiSelectMode}
              className={`h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1 border ${
                multiSelectMode
                  ? 'bg-[#6D5DFB] border-[#6D5DFB] text-white'
                  : 'bg-[#1D202B] border-white/[0.08] text-zinc-300'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Multi-Select</span>
            </button>

            <button
              type="button"
              onClick={() =>
                selectedNonGroupIds.length >= 2
                  ? dawController.groupTracks(selectedNonGroupIds)
                  : dawController.addTrackGroup(undefined, undefined, true)
              }
              className="h-7 px-2.5 rounded bg-[#6D5DFB]/20 hover:bg-[#6D5DFB]/35 border border-[#6D5DFB]/40 text-indigo-200 text-[11px] font-semibold flex items-center gap-1"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>
                {selectedNonGroupIds.length >= 2
                  ? `Group (${selectedNonGroupIds.length})`
                  : 'Add Group'}
              </span>
            </button>

            {hasGroupableOrUngroupable && (
              <button
                type="button"
                onClick={() => dawController.ungroupTracks(activeSelectionIds)}
                className="h-7 px-2 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-[11px] font-semibold flex items-center gap-1"
              >
                <Ungroup className="w-3 h-3" />
                <span>Ungroup</span>
              </button>
            )}
          </div>

          {activeSelectionIds.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setMultiSelectMode(false);
                onSelectTrack(selectedTrackId, 'single', orderedIds);
              }}
              className="h-7 px-2 rounded bg-[#222631] text-[10px] font-semibold text-zinc-300"
            >
              Clear ({activeSelectionIds.length})
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0 min-h-0 overflow-x-auto p-2.5 sm:p-3 flex items-stretch gap-2">
        {visibleTracks.map((track) => {
          const isPrimary = track.id === selectedTrackId;
          const isMultiSelected = activeSelectionIds.includes(track.id);
          const parentGroup = track.groupId
            ? project.tracks.find((g) => g.id === track.groupId)
            : null;
          const childCount = track.isGroupFolder
            ? project.tracks.filter((c) => !c.isGroupFolder && c.groupId === track.id).length
            : 0;

          return (
            <div
              key={track.id}
              onClick={(e) => handleTrackClick(e, track.id)}
              className={`w-36 sm:w-40 shrink-0 rounded border flex flex-col justify-between transition-colors ${
                track.isGroupFolder
                  ? 'bg-[#191C2B]'
                  : parentGroup
                    ? 'bg-[#131620]'
                    : 'bg-[#151820]'
              } ${
                isPrimary
                  ? 'border-white/40 ring-1 ring-white/25'
                  : isMultiSelected
                    ? 'border-[#6D5DFB]'
                    : 'border-white/[0.08]'
              }`}
            >
              <div>
                <MixerChannelHeader
                  track={track}
                  onToggleCollapse={
                    track.isGroupFolder
                      ? () => dawController.toggleTrackGroupCollapse(track.id)
                      : undefined
                  }
                  onOpenMenu={(t, x, y) => setTrackMenu({ track: t, x, y })}
                />
                {track.isGroupFolder && (
                  <div className="px-2 py-0.5 bg-[#111320] border-b border-white/[0.06] text-[9px] font-semibold text-indigo-300 flex items-center justify-between">
                    <span>GROUP BUS</span>
                    <span>
                      {childCount} {childCount === 1 ? 'ch' : 'chs'}
                      {track.collapsed ? ' · Folded' : ''}
                    </span>
                  </div>
                )}
                {parentGroup && (
                  <div
                    className="px-2 py-0.5 bg-[#101218] border-b border-white/[0.06] text-[9px] text-indigo-300 truncate flex items-center gap-1"
                    style={{ borderTop: `2px solid ${parentGroup.color}` }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: parentGroup.color }}
                    />
                    <span className="truncate">Bus: {parentGroup.name}</span>
                  </div>
                )}
              </div>

              {/* Pan + Send Reverb / Delay Knobs */}
              <div className="p-2 border-b border-white/[0.06] flex flex-col items-center gap-1.5">
                <div className="flex items-center justify-around w-full gap-1">
                  <RotaryKnob
                    label="Pan"
                    value={track.pan}
                    min={-1}
                    max={1}
                    defaultValue={0}
                    bipolar
                    color={track.color}
                    size={34}
                    displayValue={
                      track.pan === 0
                        ? 'C'
                        : track.pan < 0
                          ? `L${Math.round(Math.abs(track.pan) * 50)}`
                          : `R${Math.round(track.pan * 50)}`
                    }
                    onChange={(pan) => onSetTrackPan(track.id, Math.round(pan * 20) / 20)}
                  />
                  <RotaryKnob
                    label="Rev"
                    value={track.sendReverb ?? 0}
                    min={0}
                    max={1}
                    defaultValue={0}
                    color="#2E9BFF"
                    size={30}
                    displayValue={`${Math.round((track.sendReverb ?? 0) * 100)}%`}
                    onChange={(amt) =>
                      (onSetTrackSend ?? dawController.setTrackSend.bind(dawController))(
                        track.id,
                        'reverb',
                        Math.round(amt * 100) / 100
                      )
                    }
                  />
                  <RotaryKnob
                    label="Del"
                    value={track.sendDelay ?? 0}
                    min={0}
                    max={1}
                    defaultValue={0}
                    color="#22C55E"
                    size={30}
                    displayValue={`${Math.round((track.sendDelay ?? 0) * 100)}%`}
                    onChange={(amt) =>
                      (onSetTrackSend ?? dawController.setTrackSend.bind(dawController))(
                        track.id,
                        'delay',
                        Math.round(amt * 100) / 100
                      )
                    }
                  />
                </div>
                <div className="font-mono-tabular text-[10px] font-semibold text-zinc-200">
                  {track.volumeDb > 0 ? `+${track.volumeDb.toFixed(1)}` : track.volumeDb.toFixed(1)} dB
                </div>
              </div>

              {/* S / M / Arm + Vertical TouchFader + Peak Meter */}
              <div className="p-2.5 flex items-center justify-between gap-1.5 flex-1">
                <div className="flex flex-col gap-1.5 w-9 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSolo(track.id);
                    }}
                    aria-pressed={track.solo}
                    className={`h-8 rounded-[3px] text-[11px] font-bold border ${
                      track.solo
                        ? 'bg-amber-400 border-amber-300 text-zinc-950'
                        : 'bg-[#222631] border-white/[0.08] text-zinc-300'
                    }`}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMute(track.id);
                    }}
                    aria-pressed={track.muted}
                    className={`h-8 rounded-[3px] text-[11px] font-bold border ${
                      track.muted
                        ? 'bg-orange-500 border-orange-400 text-zinc-950'
                        : 'bg-[#222631] border-white/[0.08] text-zinc-300'
                    }`}
                  >
                    M
                  </button>
                  {!track.isGroupFolder && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleArm(track.id);
                      }}
                      aria-pressed={track.armed}
                      className={`h-8 rounded-[3px] text-[11px] font-bold border flex items-center justify-center ${
                        track.armed
                          ? 'bg-rose-600 border-rose-400 text-white'
                          : 'bg-[#222631] border-white/[0.08] text-zinc-400'
                      }`}
                    >
                      <Circle className="w-3 h-3 fill-current" />
                    </button>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center">
                  <TouchFader
                    orientation="vertical"
                    heightClass="h-40"
                    label={`${track.name} Volume`}
                    ariaLabel={`${track.name} volume`}
                    value={track.volumeDb}
                    min={-48}
                    max={6}
                    defaultValue={0}
                    step={0.5}
                    accentColor={track.color}
                    displayValue={`${track.volumeDb > 0 ? '+' : ''}${track.volumeDb.toFixed(1)} dB`}
                    onSelect={() => onSelectTrack(track.id, 'single', orderedIds)}
                    onChange={(db) => onSetTrackVolume(track.id, Math.round(db * 2) / 2)}
                  />
                </div>

                <GradientMeter
                  getLevel={() => dawController.getTrackMeter(track.id)}
                  muted={track.muted || Boolean(parentGroup?.muted)}
                />
              </div>
            </div>
          );
        })}

        {/* Master Channel */}
        <div className="w-36 sm:w-40 shrink-0 rounded border border-white/[0.15] bg-[#161922] flex flex-col justify-between ml-auto">
          <div className="px-2.5 py-1.5 rounded-t-[3px] bg-[#2B303E] text-white flex items-center justify-between">
            <span className="text-xs font-bold">Master</span>
            <span className="text-[9px] font-mono-tabular text-emerald-400">BUS</span>
          </div>

          <div className="p-2.5 border-b border-white/[0.06] flex flex-col items-center gap-1">
            <RotaryKnob
              label="Master"
              value={project.masterVolumeDb}
              min={-48}
              max={6}
              defaultValue={0}
              color="#22C55E"
              size={38}
              displayValue={`${project.masterVolumeDb > 0 ? '+' : ''}${project.masterVolumeDb.toFixed(1)} dB`}
              onChange={(db) => onSetMasterVolume(Math.round(db * 2) / 2)}
            />
          </div>

          <div className="p-2.5 flex items-center justify-center gap-3 flex-1">
            <div className="flex-1 flex items-center justify-center">
              <TouchFader
                orientation="vertical"
                heightClass="h-40"
                label="Master Gain"
                ariaLabel="Master volume"
                value={project.masterVolumeDb}
                min={-48}
                max={6}
                defaultValue={0}
                step={0.5}
                accentColor="#22C55E"
                displayValue={`${project.masterVolumeDb > 0 ? '+' : ''}${project.masterVolumeDb.toFixed(1)} dB`}
                onChange={(db) => onSetMasterVolume(Math.round(db * 2) / 2)}
              />
            </div>
            <GradientMeter getLevel={() => dawController.getMasterMeter()} />
          </div>
        </div>
        </div>
      </div>

      {/* Right DSP Panel */}
      {selectedTrack && (
        <div className="w-full lg:w-[400px] xl:w-[440px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-[#14161D] p-2.5 flex flex-col gap-2.5 overflow-y-auto max-h-[300px] lg:max-h-none">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5">
              <button
                type="button"
                onClick={() => setFxTab('audio')}
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  fxTab === 'audio' ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400'
                }`}
              >
                Audio Effects
              </button>
              <button
                type="button"
                onClick={() => setFxTab('midi')}
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  fxTab === 'midi' ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400'
                }`}
              >
                MIDI Effects
              </button>
            </div>
            <span className="text-[11px] font-semibold text-zinc-400 truncate">
              {selectedTrack.name}
            </span>
          </div>

          {fxTab === 'audio' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* EQ Three Card */}
              <div className="rounded border border-white/[0.08] bg-[#191C24] p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-100">EQ Three</span>
                  {eqFx ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateEffect(selectedTrack.id, eqFx.id, { enabled: !eqFx.enabled })
                      }
                      className={`w-5 h-5 rounded-xs flex items-center justify-center ${
                        eqFx.enabled ? 'bg-amber-400 text-zinc-950' : 'bg-[#252834] text-zinc-500'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddEffect(selectedTrack.id, 'eq')}
                      className="text-[10px] font-semibold text-sky-400 flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>

                <div className="h-14 rounded bg-[#0E1015] border border-white/[0.06] overflow-hidden">
                  <svg viewBox="0 0 200 72" className="w-full h-full">
                    <line x1="0" y1="36" x2="200" y2="36" stroke="rgba(255,255,255,0.08)" />
                    <path d={eqPath} fill="none" stroke="#EAB308" strokeWidth="2" />
                  </svg>
                </div>

                {eqFx && (
                  <div className="grid grid-cols-5 gap-1">
                    <RotaryKnob
                      label="Low"
                      value={lowDb}
                      min={-12}
                      max={12}
                      defaultValue={0}
                      bipolar
                      size={28}
                      color="#EAB308"
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, eqFx.id, {
                          paramPatch: { low: Math.round(v * 2) / 2 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Mid"
                      value={midDb}
                      min={-12}
                      max={12}
                      defaultValue={0}
                      bipolar
                      size={28}
                      color="#EAB308"
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, eqFx.id, {
                          paramPatch: { mid: Math.round(v * 2) / 2 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="High"
                      value={highDb}
                      min={-12}
                      max={12}
                      defaultValue={0}
                      bipolar
                      size={28}
                      color="#EAB308"
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, eqFx.id, {
                          paramPatch: { high: Math.round(v * 2) / 2 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Freq"
                      value={Number(eqFx.params.frequency ?? 1000)}
                      min={120}
                      max={8000}
                      defaultValue={1000}
                      size={28}
                      color="#F59E0B"
                      displayValue={`${Math.round(Number(eqFx.params.frequency ?? 1000))}`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, eqFx.id, {
                          paramPatch: { frequency: Math.round(v) },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Q"
                      value={Number(eqFx.params.q ?? 1)}
                      min={0.5}
                      max={8}
                      defaultValue={1}
                      size={28}
                      color="#F59E0B"
                      displayValue={Number(eqFx.params.q ?? 1).toFixed(1)}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, eqFx.id, {
                          paramPatch: { q: Math.round(v * 10) / 10 },
                        })
                      }
                    />
                  </div>
                )}
              </div>

              {/* Compressor Card */}
              <div className="rounded border border-white/[0.08] bg-[#191C24] p-2.5 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-100">Compressor</span>
                  {compFx ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateEffect(selectedTrack.id, compFx.id, { enabled: !compFx.enabled })
                      }
                      className={`w-5 h-5 rounded-xs flex items-center justify-center ${
                        compFx.enabled ? 'bg-sky-400 text-zinc-950' : 'bg-[#252834] text-zinc-500'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddEffect(selectedTrack.id, 'compressor')}
                      className="text-[10px] font-semibold text-sky-400 flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>

                {compFx ? (
                  <div className="grid grid-cols-2 gap-2 py-1">
                    <RotaryKnob
                      label="Thresh"
                      value={Number(compFx.params.threshold ?? -18)}
                      min={-48}
                      max={0}
                      defaultValue={-18}
                      size={36}
                      color="#38BDF8"
                      displayValue={`${Math.round(Number(compFx.params.threshold ?? -18))}dB`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, compFx.id, {
                          paramPatch: { threshold: Math.round(v) },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Ratio"
                      value={Number(compFx.params.ratio ?? 3.5)}
                      min={1}
                      max={12}
                      defaultValue={3.5}
                      size={36}
                      color="#38BDF8"
                      displayValue={`${(Math.round(Number(compFx.params.ratio ?? 3.5) * 10) / 10).toFixed(1)}:1`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, compFx.id, {
                          paramPatch: { ratio: Math.round(v * 10) / 10 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Attack"
                      value={Number(compFx.params.attack ?? 0.01)}
                      min={0.001}
                      max={0.2}
                      defaultValue={0.01}
                      size={36}
                      color="#38BDF8"
                      displayValue={`${Math.round(Number(compFx.params.attack ?? 0.01) * 1000)}ms`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, compFx.id, {
                          paramPatch: { attack: Math.round(v * 1000) / 1000 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Release"
                      value={Number(compFx.params.release ?? 0.2)}
                      min={0.05}
                      max={1}
                      defaultValue={0.2}
                      size={36}
                      color="#38BDF8"
                      displayValue={`${Math.round(Number(compFx.params.release ?? 0.2) * 1000)}ms`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, compFx.id, {
                          paramPatch: { release: Math.round(v * 100) / 100 },
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 py-6 text-center">
                    Click Add to insert Compressor
                  </div>
                )}
              </div>

              {/* Reverb Card */}
              <div className="rounded border border-white/[0.08] bg-[#191C24] p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-100">Reverb</span>
                  {reverbFx ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEffect(selectedTrack.id, reverbFx.id, {
                            enabled: !reverbFx.enabled,
                          })
                        }
                        className={`w-5 h-5 rounded-xs flex items-center justify-center ${
                          reverbFx.enabled
                            ? 'bg-sky-400 text-zinc-950'
                            : 'bg-[#252834] text-zinc-500'
                        }`}
                      >
                        <Power className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveEffect(selectedTrack.id, reverbFx.id)}
                        className="text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddEffect(selectedTrack.id, 'reverb')}
                      className="text-[10px] font-semibold text-sky-400 flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>

                <div className="h-12 rounded bg-[#0E1015] border border-white/[0.06] flex items-center px-2">
                  <svg viewBox="0 0 120 36" className="w-full h-full">
                    {Array.from({ length: 24 }, (_, i) => {
                      const decay = Number(reverbFx?.params.decay ?? 2.2);
                      const wet = Number(reverbFx?.params.wet ?? 0.25);
                      const amp = Math.exp(-i / (decay * 3.5)) * (0.3 + wet * 0.7) * 30;
                      return (
                        <rect
                          key={i}
                          x={i * 5}
                          y={18 - amp / 2}
                          width={3}
                          height={Math.max(2, amp)}
                          rx={1}
                          fill="#2E9BFF"
                          fillOpacity={reverbFx?.enabled ? 0.85 : 0.25}
                        />
                      );
                    })}
                  </svg>
                </div>

                {reverbFx && (
                  <div className="flex items-center justify-around">
                    <RotaryKnob
                      label="Decay"
                      value={Number(reverbFx.params.decay ?? 2.2)}
                      min={0.3}
                      max={6}
                      defaultValue={2.2}
                      size={34}
                      color="#2E9BFF"
                      displayValue={`${Number(reverbFx.params.decay ?? 2.2).toFixed(1)}s`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, reverbFx.id, {
                          paramPatch: { decay: Math.round(v * 10) / 10 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Wet"
                      value={Number(reverbFx.params.wet ?? 0.25)}
                      min={0}
                      max={1}
                      defaultValue={0.25}
                      size={34}
                      color="#2E9BFF"
                      displayValue={`${Math.round(Number(reverbFx.params.wet ?? 0.25) * 100)}%`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, reverbFx.id, {
                          paramPatch: { wet: Math.round(v * 100) / 100 },
                        })
                      }
                    />
                  </div>
                )}
              </div>

              {/* Delay Card */}
              <div className="rounded border border-white/[0.08] bg-[#191C24] p-2.5 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-100">Delay</span>
                  {delayFx ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEffect(selectedTrack.id, delayFx.id, {
                            enabled: !delayFx.enabled,
                          })
                        }
                        className={`w-5 h-5 rounded-xs flex items-center justify-center ${
                          delayFx.enabled
                            ? 'bg-emerald-400 text-zinc-950'
                            : 'bg-[#252834] text-zinc-500'
                        }`}
                      >
                        <Power className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveEffect(selectedTrack.id, delayFx.id)}
                        className="text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddEffect(selectedTrack.id, 'delay')}
                      className="text-[10px] font-semibold text-sky-400 flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>

                {delayFx ? (
                  <div className="flex items-center justify-around py-2">
                    <RotaryKnob
                      label="Time"
                      value={Number(delayFx.params.delayTime ?? 0.375)}
                      min={0.05}
                      max={1}
                      defaultValue={0.375}
                      size={40}
                      color="#22C55E"
                      displayValue={`${Math.round(Number(delayFx.params.delayTime ?? 0.375) * 1000)}ms`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, delayFx.id, {
                          paramPatch: { delayTime: Math.round(v * 100) / 100 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Fdbk"
                      value={Number(delayFx.params.feedback ?? 0.32)}
                      min={0}
                      max={0.85}
                      defaultValue={0.32}
                      size={40}
                      color="#22C55E"
                      displayValue={`${Math.round(Number(delayFx.params.feedback ?? 0.32) * 100)}%`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, delayFx.id, {
                          paramPatch: { feedback: Math.round(v * 100) / 100 },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Wet"
                      value={Number(delayFx.params.wet ?? 0.22)}
                      min={0}
                      max={1}
                      defaultValue={0.22}
                      size={40}
                      color="#22C55E"
                      displayValue={`${Math.round(Number(delayFx.params.wet ?? 0.22) * 100)}%`}
                      onChange={(v) =>
                        onUpdateEffect(selectedTrack.id, delayFx.id, {
                          paramPatch: { wet: Math.round(v * 100) / 100 },
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 py-6 text-center">
                    Click Add to insert Delay
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {LIBRARY_ITEMS.filter((i) => i.category === 'MIDI Effects').map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onApplyMidiPreset?.(item)}
                  className="p-2.5 rounded border border-white/[0.08] bg-[#191C24] hover:bg-[#222632] text-left"
                >
                  <div className="text-xs font-bold text-zinc-100">{item.name}</div>
                  <div className="text-[11px] text-zinc-400">{item.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <TrackContextMenu
        open={Boolean(trackMenu)}
        x={trackMenu?.x ?? 0}
        y={trackMenu?.y ?? 0}
        track={trackMenu?.track ?? null}
        allTracks={project.tracks}
        selectedTrackIds={activeSelectionIds}
        onClose={() => setTrackMenu(null)}
        onTriggerAudioFileInsert={(tid) => {
          insertAudioTargetTrackRef.current = tid;
          insertAudioInputRef.current?.click();
        }}
      />
    </div>
  );
};
