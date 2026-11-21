import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Plus,
  Trash2,
  Circle,
  Clock,
  Edit3,
  ArrowRight,
  Upload,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Layers,
  Snowflake,
  MoreVertical,
  Ungroup,
} from 'lucide-react';
import {
  AudioClipMeta,
  MidiClip,
  ProjectState,
  TrackModel,
  TrackType,
} from '../types/daw';
import { SessionTrackRuntime } from '../audio/sessionEngine';
import { dawController, orderTracksHierarchically } from '../audio/dawController';
import { getTrackInstrumentDisplayName } from '../data/presets';
import { useLongPressContextMenu } from '../hooks/useLongPressContextMenu';
import { RotaryKnob } from './RotaryKnob';
import { TouchFader } from './TouchFader';
import { TrackContextMenu } from './TrackContextMenu';
import { ClipContextMenu, ClipContextTarget } from './ClipContextMenu';
import { AudioClipEditorModal } from './AudioClipEditorModal';

interface SessionViewProps {
  project: ProjectState;
  selectedTrackId: string;
  selectedTrackIds?: string[];
  isPlaying: boolean;
  currentBeat: number;
  quantProgress: number;
  sessionRuntimes: Record<string, SessionTrackRuntime>;
  onSelectTrack: (
    trackId: string,
    mode?: 'single' | 'toggle' | 'range',
    orderedIds?: string[]
  ) => void;
  onTriggerClip: (trackId: string, clipId: string) => void;
  onTriggerScene: (sceneIndex: number) => void;
  onStopTrack: (trackId: string) => void;
  onClearAll: () => void;
  onCreateMidiClip: (trackId: string, sceneIndex: number) => void;
  onDeleteClip: (trackId: string, sceneIndex: number) => void;
  onEditMidiClip: (clipId: string, trackId: string) => void;
  onSendToArrangement: (trackId: string, clipId: string) => void;
  onAddTrack: (type: TrackType) => void;
  onDeleteTrack: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onAddScene: () => void;
  onSetTrackVolume: (trackId: string, db: number) => void;
  onSetTrackPan: (trackId: string, pan: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onToggleArm: (trackId: string) => void;
  onDropFilesToSlot: (files: FileList, trackId: string, sceneIndex: number) => void;
  onDropAssetToSlot: (assetId: string, trackId: string, sceneIndex: number) => void;
  onDropFilesNewTrack: (files: FileList) => void;
  onOpenInstrumentPicker?: (trackId: string) => void;
}

const GradientPeakMeter: React.FC<{ getLevel: () => number; muted?: boolean }> = ({
  getLevel,
  muted,
}) => {
  const maskRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const level = muted ? 0 : getLevel();
      if (maskRef.current) {
        maskRef.current.style.transform = `scaleY(${(1 - level).toFixed(3)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, muted]);

  return (
    <div className="relative w-3 h-28 rounded-xs bg-[#0B0D11] border border-white/[0.08] overflow-hidden shrink-0">
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

interface SessionTrackHeaderProps {
  track: TrackModel;
  canDelete: boolean;
  isRenaming: boolean;
  renameText: string;
  onRenameTextChange: (val: string) => void;
  onRenameStart: (track: TrackModel) => void;
  onRenameCommit: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleCollapse?: () => void;
  onOpenTrackMenu: (track: TrackModel, x: number, y: number) => void;
}

const SessionTrackHeader: React.FC<SessionTrackHeaderProps> = ({
  track,
  canDelete,
  isRenaming,
  renameText,
  onRenameTextChange,
  onRenameStart,
  onRenameCommit,
  onDeleteTrack,
  onToggleCollapse,
  onOpenTrackMenu,
}) => {
  const { bind, consumeLongPressClick } = useLongPressContextMenu({
    onOpen: ({ x, y }) => onOpenTrackMenu(track, x, y),
  });

  return (
    <div
      {...bind}
      onClick={(e) => {
        if (consumeLongPressClick()) {
          e.stopPropagation();
        }
      }}
      style={{ backgroundColor: track.color }}
      className="px-2 py-1.5 rounded-t-[3px] flex items-center justify-between gap-1 text-zinc-950"
    >
      {isRenaming ? (
        <input
          autoFocus
          value={renameText}
          onChange={(e) => onRenameTextChange(e.target.value)}
          onBlur={() => onRenameCommit(track.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit(track.id);
          }}
          className="w-full h-5 px-1 bg-black/25 border border-white/40 rounded text-xs font-bold text-white"
        />
      ) : (
        <div className="flex items-center gap-1 min-w-0 flex-1">
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
          <button
            type="button"
            onDoubleClick={() => onRenameStart(track)}
            title="Double-click to rename · Long-press or right-click for track options"
            className="text-xs font-bold truncate text-left flex-1 text-zinc-950 flex items-center gap-1 min-w-0"
          >
            {track.isGroupFolder && <Folder className="w-3 h-3 shrink-0" />}
            {track.frozen && <Snowflake className="w-3 h-3 shrink-0" />}
            <span className="truncate">{track.name}</span>
          </button>
        </div>
      )}

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenTrackMenu(track, rect.left, rect.bottom + 4);
          }}
          aria-label={`Options for ${track.name}`}
          className="w-6 h-6 rounded flex items-center justify-center text-zinc-950/75 hover:bg-black/15"
        >
          <MoreVertical className="w-3 h-3" />
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTrack(track.id);
            }}
            aria-label={`Delete ${track.name} track`}
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-950/70 hover:bg-black/15"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};

interface SessionClipSlotProps {
  track: TrackModel;
  sceneId: string;
  sceneIndex: number;
  clipId: string | null;
  midiClip?: MidiClip;
  audioClip?: AudioClipMeta;
  isActive: boolean;
  isQueued: boolean;
  isStopping: boolean;
  isPlayingNow: boolean;
  playheadPct: number;
  isDragOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDropFiles: (files: FileList) => void;
  onDropAsset: (assetId: string) => void;
  onTriggerClip: () => void;
  onCreateMidiClip: () => void;
  onEditMidiClip: () => void;
  onSendToArrangement: () => void;
  onDeleteClip: () => void;
  onOpenClipMenu: (target: ClipContextTarget, x: number, y: number) => void;
}

const SessionClipSlot: React.FC<SessionClipSlotProps> = ({
  track,
  sceneIndex,
  clipId,
  midiClip,
  audioClip,
  isQueued,
  isStopping,
  isPlayingNow,
  playheadPct,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDropFiles,
  onDropAsset,
  onTriggerClip,
  onCreateMidiClip,
  onEditMidiClip,
  onSendToArrangement,
  onDeleteClip,
  onOpenClipMenu,
}) => {
  const clip = midiClip ?? audioClip;
  const { bind, consumeLongPressClick } = useLongPressContextMenu({
    onOpen: ({ x, y }) => {
      if (!clip || !clipId) return;
      onOpenClipMenu(
        {
          source: 'session',
          trackId: track.id,
          sceneIndex,
          clipId,
          midiClip,
          audioClip,
        },
        x,
        y
      );
    },
  });

  return (
    <div
      {...(clip ? bind : {})}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeave();
        const assetId = e.dataTransfer.getData('application/x-pulsegrid-asset');
        if (assetId) {
          onDropAsset(assetId);
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
      style={
        clip
          ? {
              backgroundColor: isPlayingNow ? track.color : `${track.color}CC`,
            }
          : undefined
      }
      className={`relative h-[44px] sm:h-[46px] rounded-[3px] border transition-all overflow-hidden group ${
        isDragOver
          ? 'border-white bg-white/15'
          : isPlayingNow
            ? 'border-white ring-1 ring-white/80'
            : isQueued
              ? 'border-amber-300 animate-queue-pulse'
              : clip
                ? 'border-black/30 hover:brightness-110'
                : 'border-white/[0.05] bg-[#191C24] hover:border-white/20'
      }`}
    >
      {clip ? (
        <div className="h-full flex items-center justify-between px-1.5 gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (consumeLongPressClick()) return;
              onTriggerClip();
            }}
            className="flex items-center gap-1.5 min-w-0 flex-1 h-full text-left"
          >
            <span className="w-4 h-4 rounded-xs bg-black/25 text-white flex items-center justify-center shrink-0">
              {isStopping && isPlayingNow ? (
                <Square className="w-2.5 h-2.5 fill-current" />
              ) : isQueued ? (
                <Clock className="w-2.5 h-2.5 text-amber-300" />
              ) : isPlayingNow ? (
                <Square className="w-2.5 h-2.5 fill-current" />
              ) : (
                <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
              )}
            </span>
            <span className="text-[11px] font-bold text-zinc-950 truncate">{clip.name}</span>
          </button>

          <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100">
            {midiClip && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditMidiClip();
                }}
                title="Edit MIDI"
                aria-label={`Edit ${clip.name} in Piano Roll`}
                className="w-5 h-5 rounded-xs flex items-center justify-center bg-black/20 text-white hover:bg-black/40"
              >
                <Edit3 className="w-2.5 h-2.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSendToArrangement();
              }}
              title="Send to Arrangement"
              aria-label={`Send ${clip.name} to Arrangement`}
              className="hidden sm:flex w-5 h-5 rounded-xs items-center justify-center bg-black/20 text-white hover:bg-black/40"
            >
              <ArrowRight className="w-2.5 h-2.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteClip();
              }}
              title="Delete Clip"
              aria-label={`Delete ${clip.name}`}
              className="w-5 h-5 rounded-xs flex items-center justify-center bg-black/20 text-white hover:bg-rose-600"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </div>

          {isPlayingNow && (
            <div
              className="absolute bottom-0 left-0 h-[3px] bg-white"
              style={{ width: `${playheadPct}%` }}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (track.type === 'midi' && !track.isGroupFolder) {
              onCreateMidiClip();
            }
          }}
          className="w-full h-full flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors"
          aria-label={`Create clip in ${track.name} scene ${sceneIndex + 1}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const SessionView: React.FC<SessionViewProps> = ({
  project,
  selectedTrackId,
  selectedTrackIds,
  isPlaying,
  currentBeat,
  quantProgress,
  sessionRuntimes,
  onSelectTrack,
  onTriggerClip,
  onTriggerScene,
  onStopTrack,
  onClearAll,
  onCreateMidiClip,
  onDeleteClip,
  onEditMidiClip,
  onSendToArrangement,
  onAddTrack,
  onDeleteTrack,
  onRenameTrack,
  onAddScene,
  onSetTrackVolume,
  onSetTrackPan,
  onToggleMute,
  onToggleSolo,
  onToggleArm,
  onDropFilesToSlot,
  onDropAssetToSlot,
  onDropFilesNewTrack,
  onOpenInstrumentPicker,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [dragOverDropZone, setDragOverDropZone] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  const [trackMenu, setTrackMenu] = useState<{
    track: TrackModel;
    x: number;
    y: number;
  } | null>(null);
  const [clipMenu, setClipMenu] = useState<{
    target: ClipContextTarget;
    x: number;
    y: number;
  } | null>(null);
  const [editingAudioClip, setEditingAudioClip] = useState<AudioClipMeta | null>(null);
  const insertAudioInputRef = useRef<HTMLInputElement | null>(null);
  const insertAudioTrackRef = useRef<string | null>(null);

  const hierarchicalTracks = orderTracksHierarchically(project.tracks);
  const collapsedGroupIds = new Set(
    project.tracks.filter((t) => t.isGroupFolder && t.collapsed).map((t) => t.id)
  );
  const visibleTracks = hierarchicalTracks.filter(
    (t) => t.isGroupFolder || !t.groupId || !collapsedGroupIds.has(t.groupId)
  );

  const activeSelectionIds = selectedTrackIds ?? [selectedTrackId];
  const orderedIds = visibleTracks.map((t) => t.id);
  const selectedNonGroupIds = activeSelectionIds.filter(
    (id) => !project.tracks.find((t) => t.id === id)?.isGroupFolder
  );
  const hasGroupableOrUngroupable = activeSelectionIds.some((id) => {
    const tr = project.tracks.find((t) => t.id === id);
    return Boolean(tr && (tr.isGroupFolder || tr.groupId));
  });

  const anyQueued = project.tracks.some((t) => {
    const rt = sessionRuntimes[t.id];
    return rt && (rt.queuedClipId !== null || rt.queuedStop);
  });

  const handleRenameStart = (track: TrackModel) => {
    setRenamingId(track.id);
    setRenameText(track.name);
  };

  const handleRenameCommit = (trackId: string) => {
    if (renameText.trim()) {
      onRenameTrack(trackId, renameText.trim());
    }
    setRenamingId(null);
  };

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
    <div className="flex-1 min-h-0 flex flex-col bg-[#101218] overflow-hidden select-none">
      <input
        ref={insertAudioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const tid = insertAudioTrackRef.current;
          if (file && tid) {
            void dawController.importAudioFile(file, { trackId: tid, sceneIndex: 0 });
            e.target.value = '';
          }
        }}
      />

      {/* Quantize Phase Bar */}
      <div className="h-[3px] w-full bg-[#0A0B0F] shrink-0">
        <div
          className="h-full transition-[width] duration-75 ease-linear"
          style={{
            width: `${isPlaying ? quantProgress * 100 : 0}%`,
            backgroundColor: anyQueued ? '#F59E0B' : '#22C55E',
          }}
        />
      </div>

      {/* Session Selection & Group Action Bar */}
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

      {/* Horizontal Scrollable Session Grid */}
      <div className="flex-1 min-h-0 overflow-auto p-2 sm:p-3">
        <div className="inline-flex min-w-full items-stretch gap-1.5 sm:gap-2">
          {visibleTracks.map((track) => {
            const rt = sessionRuntimes[track.id] ?? {
              activeClipId: null,
              queuedClipId: null,
              queuedStop: false,
              startBeat: 0,
            };
            const isPrimary = track.id === selectedTrackId;
            const isMultiSelected = activeSelectionIds.includes(track.id);
            const parentGroup = track.groupId
              ? project.tracks.find((g) => g.id === track.groupId)
              : null;
            const groupChildren = track.isGroupFolder
              ? project.tracks.filter((c) => !c.isGroupFolder && c.groupId === track.id)
              : [];

            return (
              <div
                key={track.id}
                onClick={(e) => handleTrackClick(e, track.id)}
                className={`w-[136px] sm:w-[158px] shrink-0 flex flex-col rounded border transition-colors ${
                  isPrimary
                    ? 'bg-[#181B23] border-white/30'
                    : isMultiSelected
                      ? 'bg-[#171A26] border-[#6D5DFB]'
                      : track.isGroupFolder
                        ? 'bg-[#171926] border-white/[0.1]'
                        : 'bg-[#14161D] border-white/[0.08]'
                }`}
              >
                <SessionTrackHeader
                  track={track}
                  canDelete={project.tracks.length > 1}
                  isRenaming={renamingId === track.id}
                  renameText={renameText}
                  onRenameTextChange={setRenameText}
                  onRenameStart={handleRenameStart}
                  onRenameCommit={handleRenameCommit}
                  onDeleteTrack={onDeleteTrack}
                  onToggleCollapse={
                    track.isGroupFolder
                      ? () => dawController.toggleTrackGroupCollapse(track.id)
                      : undefined
                  }
                  onOpenTrackMenu={(t, x, y) => setTrackMenu({ track: t, x, y })}
                />

                {!track.isGroupFolder && track.type === 'midi' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenInstrumentPicker?.(track.id);
                    }}
                    title="Change track instrument"
                    className="px-2 py-1 bg-[#101218] hover:bg-[#191D28] border-b border-white/[0.06] text-[10px] font-medium text-zinc-300 hover:text-white truncate text-left transition-colors"
                  >
                    {getTrackInstrumentDisplayName(track)}
                  </button>
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
                    <span className="truncate">{parentGroup.name}</span>
                  </div>
                )}

                {track.isGroupFolder ? (
                  <div className="p-1.5 flex flex-col gap-1 flex-1 bg-[#12141E]">
                    {project.scenes.map((scene, sceneIndex) => {
                      const clipsInRow = groupChildren.filter(
                        (c) => Boolean(c.sessionSlots[sceneIndex])
                      );
                      const playingInRow = clipsInRow.some((c) => {
                        const crt = sessionRuntimes[c.id];
                        return Boolean(isPlaying && crt?.activeClipId === c.sessionSlots[sceneIndex]);
                      });

                      return (
                        <button
                          key={scene.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            for (const c of groupChildren) {
                              const cid = c.sessionSlots[sceneIndex];
                              if (cid) onTriggerClip(c.id, cid);
                            }
                          }}
                          disabled={clipsInRow.length === 0}
                          className={`h-[44px] sm:h-[46px] rounded-[3px] border px-2 flex items-center justify-between gap-1 text-left transition-colors ${
                            playingInRow
                              ? 'border-white/70 bg-indigo-500/30 text-white'
                              : clipsInRow.length > 0
                                ? 'border-white/[0.08] bg-[#1B1F2E] hover:bg-[#242A3E] text-zinc-200'
                                : 'border-white/[0.04] bg-[#151722] text-zinc-600'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <Play className="w-2.5 h-2.5 fill-current shrink-0" />
                            <span className="text-[10px] font-semibold truncate">
                              {clipsInRow.length > 0
                                ? `${clipsInRow.length} clip${clipsInRow.length > 1 ? 's' : ''}`
                                : 'Group Bus'}
                            </span>
                          </span>
                        </button>
                      );
                    })}

                    <div className="mt-1 flex gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          dawController.addTrack('midi', undefined, track.id);
                        }}
                        className="flex-1 h-7 rounded-[3px] border border-white/[0.08] bg-[#1C202E] hover:bg-[#252A3C] text-[10px] font-semibold text-indigo-200 flex items-center justify-center gap-0.5"
                      >
                        <Plus className="w-2.5 h-2.5" /> MIDI
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          for (const c of groupChildren) {
                            onStopTrack(c.id);
                          }
                        }}
                        title="Stop all child tracks in group"
                        className="h-7 px-2 rounded-[3px] border border-white/[0.08] bg-[#181B22] hover:bg-[#242834] text-[10px] font-semibold text-zinc-300 flex items-center justify-center"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Clip Slots */
                  <div className="p-1.5 flex flex-col gap-1 flex-1 bg-[#13151C]">
                    {project.scenes.map((scene, sceneIndex) => {
                      const clipId = track.sessionSlots[sceneIndex] ?? null;
                      const midiClip = clipId ? project.midiClips[clipId] : undefined;
                      const audioClip = clipId ? project.audioClips[clipId] : undefined;
                      const clip = midiClip ?? audioClip;

                      const isActive = clipId !== null && rt.activeClipId === clipId;
                      const isQueued = clipId !== null && rt.queuedClipId === clipId;
                      const isStopping = isActive && rt.queuedStop;
                      const isPlayingNow = isActive && isPlaying;
                      const slotKey = `${track.id}-${sceneIndex}`;

                      const clipLen = clip?.lengthBeats ?? 4;
                      const localBeat = isPlayingNow
                        ? Math.max(0, currentBeat - rt.startBeat) % clipLen
                        : 0;
                      const playheadPct = isPlayingNow ? (localBeat / clipLen) * 100 : 0;

                      return (
                        <SessionClipSlot
                          key={scene.id}
                          track={track}
                          sceneId={scene.id}
                          sceneIndex={sceneIndex}
                          clipId={clipId}
                          midiClip={midiClip}
                          audioClip={audioClip}
                          isActive={isActive}
                          isQueued={isQueued}
                          isStopping={isStopping}
                          isPlayingNow={isPlayingNow}
                          playheadPct={playheadPct}
                          isDragOver={dragOverSlot === slotKey}
                          onDragOver={() => setDragOverSlot(slotKey)}
                          onDragLeave={() => setDragOverSlot(null)}
                          onDropFiles={(files) => onDropFilesToSlot(files, track.id, sceneIndex)}
                          onDropAsset={(assetId) => onDropAssetToSlot(assetId, track.id, sceneIndex)}
                          onTriggerClip={() => clipId && onTriggerClip(track.id, clipId)}
                          onCreateMidiClip={() => onCreateMidiClip(track.id, sceneIndex)}
                          onEditMidiClip={() => midiClip && onEditMidiClip(midiClip.id, track.id)}
                          onSendToArrangement={() => clip && onSendToArrangement(track.id, clip.id)}
                          onDeleteClip={() => onDeleteClip(track.id, sceneIndex)}
                          onOpenClipMenu={(target, x, y) => setClipMenu({ target, x, y })}
                        />
                      );
                    })}

                    {/* Track Stop Slot */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStopTrack(track.id);
                      }}
                      className={`mt-1 h-7 rounded-[3px] border flex items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${
                        rt.queuedStop
                          ? 'bg-amber-500/20 border-amber-400/60 text-amber-300 animate-queue-pulse'
                          : rt.activeClipId && isPlaying
                            ? 'bg-[#252934] border-white/25 text-white'
                            : 'bg-[#181B22] border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span>{rt.queuedStop ? 'Stopping' : 'Stop'}</span>
                    </button>
                  </div>
                )}

                {/* Integrated Studio Channel Strip */}
                <div className="p-2.5 border-t border-white/[0.08] bg-[#161922] flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-1">
                    <RotaryKnob
                      label="Pan"
                      value={track.pan}
                      min={-1}
                      max={1}
                      defaultValue={0}
                      bipolar
                      color={track.color}
                      size={36}
                      onChange={(pan) => onSetTrackPan(track.id, Math.round(pan * 20) / 20)}
                    />
                    <div className="text-right">
                      <div className="font-mono-tabular text-[11px] font-semibold text-zinc-200">
                        {track.volumeDb > 0 ? `+${track.volumeDb.toFixed(1)}` : track.volumeDb.toFixed(1)} dB
                      </div>
                      <div className="font-mono-tabular text-[9px] text-zinc-500">
                        {track.pan === 0
                          ? 'C'
                          : track.pan < 0
                            ? `L${Math.round(Math.abs(track.pan) * 50)}`
                            : `R${Math.round(track.pan * 50)}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-1">
                    <div className="flex flex-col gap-1 w-9 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSolo(track.id);
                        }}
                        aria-pressed={track.solo}
                        aria-label={`Solo ${track.name}`}
                        className={`h-8 rounded-[3px] text-[11px] font-bold border transition-colors ${
                          track.solo
                            ? 'bg-amber-400 border-amber-300 text-zinc-950'
                            : 'bg-[#222631] border-white/[0.08] text-zinc-300 hover:text-white'
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
                        aria-label={`Mute ${track.name}`}
                        className={`h-8 rounded-[3px] text-[11px] font-bold border transition-colors ${
                          track.muted
                            ? 'bg-orange-500 border-orange-400 text-zinc-950'
                            : 'bg-[#222631] border-white/[0.08] text-zinc-300 hover:text-white'
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
                          aria-label={`Arm ${track.name}`}
                          className={`h-8 rounded-[3px] text-[11px] font-bold border flex items-center justify-center transition-colors ${
                            track.armed
                              ? 'bg-rose-600 border-rose-400 text-white'
                              : 'bg-[#222631] border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          <Circle className="w-3 h-3 fill-current" />
                        </button>
                      )}
                    </div>

                    <div className="flex-1 flex items-center justify-center">
                      <TouchFader
                        orientation="vertical"
                        heightClass="h-28"
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

                    <GradientPeakMeter
                      getLevel={() => dawController.getTrackMeter(track.id)}
                      muted={track.muted || Boolean(parentGroup?.muted)}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add Track Column */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverDropZone(true);
            }}
            onDragLeave={() => setDragOverDropZone(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverDropZone(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                onDropFilesNewTrack(e.dataTransfer.files);
              }
            }}
            className={`w-[130px] sm:w-[152px] shrink-0 rounded border border-dashed flex flex-col items-center justify-center p-3 gap-2.5 text-center transition-colors ${
              dragOverDropZone
                ? 'border-emerald-400 bg-emerald-500/10'
                : 'border-white/[0.1] bg-[#12141A]'
            }`}
          >
            <Upload className="w-5 h-5 text-zinc-500" />
            <p className="text-[11px] text-zinc-400 leading-snug">
              Drop Files and Devices Here
            </p>
            <div className="flex flex-col gap-1.5 w-full mt-1">
              <button
                type="button"
                onClick={() => onAddTrack('midi')}
                className="w-full py-1.5 px-2 rounded bg-[#222631] hover:bg-[#2C313F] border border-white/[0.08] text-[11px] font-semibold text-zinc-200 flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                <span>MIDI Track</span>
              </button>
              <button
                type="button"
                onClick={() => onAddTrack('audio')}
                className="w-full py-1.5 px-2 rounded bg-[#222631] hover:bg-[#2C313F] border border-white/[0.08] text-[11px] font-semibold text-zinc-200 flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3 text-sky-400" />
                <span>Audio Track</span>
              </button>
            </div>
          </div>

          {/* Master Column */}
          <div className="w-[104px] sm:w-[126px] shrink-0 flex flex-col rounded border border-white/[0.1] bg-[#161922] ml-auto">
            <div className="px-2.5 py-1.5 bg-[#232734] border-b border-white/[0.08] rounded-t-[3px] flex items-center justify-between">
              <span className="text-xs font-bold text-white">Master</span>
              <button
                type="button"
                onClick={onAddScene}
                title="Add Scene"
                className="text-zinc-300 hover:text-emerald-300"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-1.5 flex flex-col gap-1 flex-1 bg-[#13151C]">
              {project.scenes.map((scene, idx) => (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => onTriggerScene(idx)}
                  className="h-[44px] sm:h-[46px] rounded-[3px] border border-white/[0.08] bg-[#1E222D] hover:bg-[#282D3C] px-2 flex items-center gap-1.5 transition-colors active:scale-[0.98]"
                >
                  <Play className="w-3 h-3 fill-current text-emerald-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-zinc-200 truncate">
                    {scene.name}
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={onClearAll}
                className="mt-1 h-7 rounded-[3px] border border-white/[0.08] bg-[#181B22] hover:bg-[#242834] text-[10px] font-semibold text-zinc-300 flex items-center justify-center gap-1"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>Stop All</span>
              </button>
            </div>

            <div className="p-2.5 border-t border-white/[0.08] bg-[#161922] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-zinc-400">Out</span>
                <span className="font-mono-tabular text-[11px] font-semibold text-zinc-200">
                  {project.masterVolumeDb > 0
                    ? `+${project.masterVolumeDb.toFixed(1)}`
                    : project.masterVolumeDb.toFixed(1)}{' '}
                  dB
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex-1 flex items-center justify-center">
                  <TouchFader
                    orientation="vertical"
                    heightClass="h-28"
                    label="Master Gain"
                    ariaLabel="Master volume"
                    value={project.masterVolumeDb}
                    min={-48}
                    max={6}
                    defaultValue={0}
                    step={0.5}
                    accentColor="#22C55E"
                    displayValue={`${project.masterVolumeDb > 0 ? '+' : ''}${project.masterVolumeDb.toFixed(1)} dB`}
                    onChange={(db) => dawController.setMasterVolume(Math.round(db * 2) / 2)}
                  />
                </div>
                <GradientPeakMeter getLevel={() => dawController.getMasterMeter()} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <TrackContextMenu
        open={Boolean(trackMenu)}
        x={trackMenu?.x ?? 0}
        y={trackMenu?.y ?? 0}
        track={trackMenu?.track ?? null}
        allTracks={project.tracks}
        selectedTrackIds={activeSelectionIds}
        onClose={() => setTrackMenu(null)}
        onOpenInstrumentPicker={onOpenInstrumentPicker}
        onTriggerAudioFileInsert={(tid) => {
          insertAudioTrackRef.current = tid;
          insertAudioInputRef.current?.click();
        }}
      />

      <ClipContextMenu
        open={Boolean(clipMenu)}
        x={clipMenu?.x ?? 0}
        y={clipMenu?.y ?? 0}
        target={clipMenu?.target ?? null}
        onClose={() => setClipMenu(null)}
        onOpenMidiEditor={(cid, tid) => onEditMidiClip(cid, tid)}
        onOpenAudioEditor={(audioClip) => setEditingAudioClip(audioClip)}
      />

      <AudioClipEditorModal
        open={Boolean(editingAudioClip)}
        audioClip={editingAudioClip}
        onClose={() => setEditingAudioClip(null)}
      />
    </div>
  );
};
