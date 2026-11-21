import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Copy,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Edit3,
  Activity,
  Circle,
  Plus,
  Repeat,
  Maximize2,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Folder,
  MoreVertical,
  Snowflake,
  Layers,
  Sliders,
  GripVertical,
  Ungroup,
  FilePlus,
  FileAudio,
  Piano,
  LocateFixed,
} from 'lucide-react';
import {
  ArrangementClip,
  AudioClipMeta,
  AutomationTarget,
  LoopSnapMode,
  MidiClip,
  ProjectState,
  TrackModel,
} from '../types/daw';
import { sampleAutomationLane } from '../audio/arrangementEngine';
import { dawController, loopSnapToBeats, orderTracksHierarchically } from '../audio/dawController';
import { getTrackInstrumentDisplayName } from '../data/presets';
import { useLongPressContextMenu } from '../hooks/useLongPressContextMenu';
import { AutoScrollMode, useTimelineAutoScroll } from '../hooks/useTimelineAutoScroll';
import { TouchFader } from './TouchFader';
import { RotaryKnob } from './RotaryKnob';
import { TrackContextMenu } from './TrackContextMenu';
import { ClipContextMenu, ClipContextTarget } from './ClipContextMenu';
import { AudioClipEditorModal } from './AudioClipEditorModal';
import { ContextMenu } from './ContextMenu';

interface ArrangementViewProps {
  project: ProjectState;
  selectedTrackId: string;
  selectedTrackIds?: string[];
  isPlaying: boolean;
  playbackMode: 'session' | 'arrangement';
  currentBeat: number;
  onPlayArrangement: () => void;
  onSeekBeat: (beat: number) => void;
  onSelectTrack: (
    trackId: string,
    mode?: 'single' | 'toggle' | 'range',
    orderedIds?: string[]
  ) => void;
  onMoveClip: (clipId: string, startBeat: number, trackId?: string) => void;
  onMoveClips?: (
    clipIds: string[],
    beatDelta: number,
    targetTrackId: string,
    sourceTrackId: string,
    orderedTrackIds: string[]
  ) => void;
  onResizeClip: (clipId: string, lengthBeats: number) => void;
  onDuplicateClip: (clipId: string) => void;
  onDuplicateClips?: (clipIds: string[]) => void;
  onSplitClip: (clipId: string, beat: number) => void;
  onDeleteClip: (clipId: string) => void;
  onDeleteClips?: (clipIds: string[]) => void;
  onCopyClip?: (clipId: string) => void;
  onCutClip?: (clipId: string) => void;
  onPasteClip?: (trackId: string, beat: number) => void;
  onSetClipColor?: (sourceClipId: string, color: string, arrClipId?: string) => void;
  onEditMidiClip: (clipId: string, trackId: string) => void;
  onSetLoopRegion: (startBeat: number, endBeat: number, recordHistory?: boolean) => void;
  onSetLoopSnap?: (snap: LoopSnapMode) => void;
  onToggleLoop: () => void;
  onToggleAutomation: (trackId: string) => void;
  onSetAutomationTarget: (trackId: string, target: AutomationTarget) => void;
  onToggleAutomationEnabled: (trackId: string, target: AutomationTarget) => void;
  onUpsertAutomationPoint: (
    trackId: string,
    target: AutomationTarget,
    beat: number,
    value: number
  ) => void;
  onSetTrackVolume?: (trackId: string, db: number) => void;
  onSetTrackPan?: (trackId: string, pan: number) => void;
  onToggleArm: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onAddTrack: (type: 'midi' | 'audio', name?: string, groupId?: string) => void;
  onAddTrackGroup: (groupName?: string) => void;
  onToggleGroupCollapse: (trackId: string) => void;
  onSetTrackGroupId: (trackId: string, groupId?: string) => void;
  onDropFilesToTimeline: (files: FileList, trackId: string, beat: number) => void;
  onDropAssetToTimeline: (assetId: string, trackId: string, beat: number) => void;
  onOpenInstrumentPicker?: (trackId: string) => void;
}

const MiniLevelMeter: React.FC<{ getLevel: () => number; muted?: boolean }> = ({
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
    <div
      aria-hidden="true"
      className="relative w-2 h-14 rounded-xs bg-[#0B0D11] border border-white/[0.08] overflow-hidden shrink-0"
    >
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

interface ArrangementTrackHeaderProps {
  track: TrackModel;
  parentGroup?: TrackModel | null;
  isPrimary: boolean;
  isMultiSelected: boolean;
  isNested: boolean;
  isLastInGroup?: boolean;
  panelCollapsed: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggleSolo: () => void;
  onToggleMute: () => void;
  onToggleArm: () => void;
  onToggleAutomation: () => void;
  onSetVolume: (db: number) => void;
  onSetPan: (pan: number) => void;
  onSetAutomationTarget: (target: AutomationTarget) => void;
  onToggleAutomationEnabled: (target: AutomationTarget) => void;
  onOpenMenu: (x: number, y: number) => void;
  onDragStartTrack?: (trackId: string) => void;
  onDragEndTrack?: () => void;
  onDropTrackHere?: (draggedTrackId: string) => void;
  onOpenInstrumentPicker?: () => void;
}

const ArrangementTrackHeader: React.FC<ArrangementTrackHeaderProps> = ({
  track,
  parentGroup,
  isPrimary,
  isMultiSelected,
  isNested,
  isLastInGroup,
  panelCollapsed,
  onSelect,
  onToggleSolo,
  onToggleMute,
  onToggleArm,
  onToggleAutomation,
  onSetVolume,
  onSetPan,
  onSetAutomationTarget,
  onToggleAutomationEnabled,
  onOpenMenu,
  onDragStartTrack,
  onDragEndTrack,
  onDropTrackHere,
  onOpenInstrumentPicker,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const { bind, consumeLongPressClick } = useLongPressContextMenu({
    onOpen: ({ x, y }) => onOpenMenu(x, y),
  });

  const activeLane = track.automationLanes.find(
    (l) => l.target === track.activeAutomationTarget
  );
  const rowHeight = track.showAutomation ? 144 : 88;

  if (panelCollapsed) {
    return (
      <div
        {...bind}
        onClick={(e) => {
          if (consumeLongPressClick()) return;
          onSelect(e);
        }}
        style={{ height: rowHeight }}
        className={`box-border border-b border-white/[0.08] px-1 py-1.5 flex flex-col items-center justify-center gap-1 cursor-pointer ${
          isPrimary ? 'bg-[#1D202A]' : isMultiSelected ? 'bg-[#1A1D2B]' : 'bg-[#151820]'
        }`}
      >
        <span
          className="w-4 h-4 rounded-xs text-[9px] font-bold text-zinc-950 flex items-center justify-center"
          style={{ backgroundColor: track.color }}
        >
          {track.name.slice(0, 1).toUpperCase()}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          className={`w-6 h-5 rounded-xs text-[9px] font-bold ${
            track.muted ? 'bg-orange-500 text-zinc-950' : 'bg-[#222631] text-zinc-300'
          }`}
        >
          M
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSolo();
          }}
          className={`w-6 h-5 rounded-xs text-[9px] font-bold ${
            track.solo ? 'bg-amber-400 text-zinc-950' : 'bg-[#222631] text-zinc-300'
          }`}
        >
          S
        </button>
      </div>
    );
  }

  return (
    <div
      {...bind}
      onClick={(e) => {
        if (consumeLongPressClick()) return;
        onSelect(e);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-pulsegrid-track')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        const draggedId = e.dataTransfer.getData('application/x-pulsegrid-track');
        setIsDragOver(false);
        if (draggedId && draggedId !== track.id) {
          e.preventDefault();
          onDropTrackHere?.(draggedId);
        }
      }}
      style={{ height: rowHeight }}
      className={`relative box-border border-b border-white/[0.08] py-1.5 pr-2 flex flex-col justify-between transition-colors cursor-pointer ${
        isNested ? 'pl-5 bg-[#13151D]' : 'pl-2'
      } ${
        isDragOver
          ? 'ring-2 ring-inset ring-indigo-400 bg-[#212538]'
          : isPrimary
            ? 'bg-[#1D202A] ring-1 ring-inset ring-white/20'
            : isMultiSelected
              ? 'bg-[#1A1D2B] ring-1 ring-inset ring-[#6D5DFB]/70'
              : 'bg-[#151820] hover:bg-[#191C26]'
      }`}
    >
      {/* Visual Group Tree Connector */}
      {isNested && parentGroup && (
        <>
          <div
            aria-hidden="true"
            style={{
              backgroundColor: parentGroup.color,
              bottom: isLastInGroup ? '50%' : '0',
            }}
            className="absolute left-1.5 top-0 w-[2px] opacity-80 pointer-events-none"
          />
          <div
            aria-hidden="true"
            style={{ backgroundColor: parentGroup.color }}
            className="absolute left-1.5 top-1/2 w-2.5 h-[2px] opacity-80 pointer-events-none"
          />
        </>
      )}

      {/* Row 1: Drag Grip, Color, Name, Instrument/Frozen Badge, S/M/Arm/Auto + Options */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData('application/x-pulsegrid-track', track.id);
              e.dataTransfer.effectAllowed = 'move';
              onDragStartTrack?.(track.id);
            }}
            onDragEnd={() => onDragEndTrack?.()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            title="Drag to move track into or out of a group"
            aria-label={`Drag ${track.name}`}
            className="w-4 h-5 rounded-xs text-zinc-500 hover:text-zinc-200 flex items-center justify-center cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-3 h-3" />
          </button>
          <span
            className="w-4 h-4 rounded-xs shrink-0 flex items-center justify-center text-[9px] font-bold text-zinc-950"
            style={{ backgroundColor: track.color }}
          >
            {track.frozen ? (
              <Snowflake className="w-2.5 h-2.5" />
            ) : (
              track.name.slice(0, 1).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-zinc-100 truncate leading-tight">
              {track.name}
            </div>
            {track.frozen ? (
              <div className="text-[9px] font-mono-tabular text-cyan-300 truncate leading-none">
                Frozen
              </div>
            ) : track.type === 'midi' && onOpenInstrumentPicker ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInstrumentPicker();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Change instrument"
                className="text-[9px] text-zinc-400 hover:text-indigo-300 truncate leading-tight text-left max-w-full block"
              >
                {getTrackInstrumentDisplayName(track)}
              </button>
            ) : (
              <div className="text-[9px] text-zinc-400 truncate leading-none">
                {getTrackInstrumentDisplayName(track)}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSolo();
            }}
            aria-pressed={track.solo}
            aria-label={`Solo ${track.name}`}
            className={`h-5 w-5 rounded-xs text-[9px] font-bold ${
              track.solo ? 'bg-amber-400 text-zinc-950' : 'bg-[#222631] text-zinc-300'
            }`}
          >
            S
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            aria-pressed={track.muted}
            aria-label={`Mute ${track.name}`}
            className={`h-5 w-5 rounded-xs text-[9px] font-bold ${
              track.muted ? 'bg-orange-500 text-zinc-950' : 'bg-[#222631] text-zinc-300'
            }`}
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleArm();
            }}
            aria-pressed={track.armed}
            aria-label={`Arm ${track.name}`}
            className={`h-5 w-5 rounded-xs text-[9px] font-bold flex items-center justify-center ${
              track.armed ? 'bg-rose-600 text-white' : 'bg-[#222631] text-zinc-400'
            }`}
          >
            <Circle className="w-2.5 h-2.5 fill-current" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAutomation();
            }}
            aria-pressed={track.showAutomation}
            title="Automation Lane"
            className={`h-5 w-5 rounded-xs flex items-center justify-center ${
              track.showAutomation
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-[#222631] text-zinc-400'
            }`}
          >
            <Activity className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenMenu(rect.left, rect.bottom + 4);
            }}
            aria-label={`Track options for ${track.name}`}
            className="h-5 w-5 rounded-xs bg-[#222631] hover:bg-[#2C3140] text-zinc-300 flex items-center justify-center"
          >
            <MoreVertical className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Row 2: Volume TouchFader + Pan RotaryKnob + Live Level Meter */}
      <div
        className="flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <TouchFader
              orientation="horizontal"
              label={`${track.name} Volume`}
              ariaLabel={`${track.name} volume`}
              value={track.volumeDb}
              min={-48}
              max={6}
              defaultValue={0}
              step={0.5}
              accentColor={track.color}
              displayValue={`${track.volumeDb > 0 ? '+' : ''}${track.volumeDb.toFixed(1)}dB`}
              onChange={(db) => onSetVolume(Math.round(db * 2) / 2)}
            />
          </div>
          <span className="font-mono-tabular text-[9px] text-zinc-300 w-9 text-right shrink-0">
            {track.volumeDb.toFixed(0)}dB
          </span>
        </div>

        <RotaryKnob
          value={track.pan}
          min={-1}
          max={1}
          defaultValue={0}
          bipolar
          size={24}
          color={track.color}
          displayValue={
            track.pan === 0
              ? 'C'
              : track.pan < 0
                ? `L${Math.round(Math.abs(track.pan) * 50)}`
                : `R${Math.round(track.pan * 50)}`
          }
          onChange={(p) => onSetPan(Math.round(p * 20) / 20)}
        />

        <MiniLevelMeter
          getLevel={() => dawController.getTrackMeter(track.id)}
          muted={track.muted || Boolean(parentGroup?.muted)}
        />
      </div>

      {/* Row 3 (Optional): Automation Target Selector */}
      {track.showAutomation && (
        <div
          className="flex items-center gap-1 pt-1 border-t border-white/[0.06]"
          onClick={(e) => e.stopPropagation()}
        >
          <select
            value={track.activeAutomationTarget}
            onChange={(e) => onSetAutomationTarget(e.target.value as AutomationTarget)}
            className="flex-1 h-6 bg-[#101217] border border-white/[0.08] rounded text-[10px] text-zinc-200 px-1"
          >
            <option value="volume">Volume</option>
            <option value="pan">Pan</option>
            <option value="filterCutoff">Filter Cutoff</option>
          </select>
          <button
            type="button"
            onClick={() => onToggleAutomationEnabled(track.activeAutomationTarget)}
            className={`h-6 px-1.5 rounded text-[10px] font-semibold ${
              activeLane?.enabled
                ? 'bg-emerald-500 text-zinc-950'
                : 'bg-[#222631] text-zinc-400'
            }`}
          >
            {activeLane?.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      )}
    </div>
  );
};

interface ArrangementGroupHeaderProps {
  group: TrackModel;
  childCount: number;
  isPrimary: boolean;
  isMultiSelected: boolean;
  panelCollapsed: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
  onToggleSolo: () => void;
  onToggleMute: () => void;
  onSetVolume: (db: number) => void;
  onSetPan: (pan: number) => void;
  onRenameGroup: (name: string) => void;
  onAddTrackToGroup: (type: 'midi' | 'audio') => void;
  onDropTrackToGroup: (trackId: string) => void;
  onOpenMenu: (x: number, y: number) => void;
}

const ArrangementGroupHeader: React.FC<ArrangementGroupHeaderProps> = ({
  group,
  childCount,
  isPrimary,
  isMultiSelected,
  panelCollapsed,
  onSelect,
  onToggleCollapse,
  onToggleSolo,
  onToggleMute,
  onSetVolume,
  onSetPan,
  onRenameGroup,
  onAddTrackToGroup,
  onDropTrackToGroup,
  onOpenMenu,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameText, setRenameText] = useState(group.name);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const { bind, consumeLongPressClick } = useLongPressContextMenu({
    onOpen: ({ x, y }) => onOpenMenu(x, y),
  });

  useEffect(() => {
    setRenameText(group.name);
  }, [group.name]);

  if (panelCollapsed) {
    return (
      <div
        {...bind}
        onClick={(e) => {
          if (consumeLongPressClick()) return;
          onToggleCollapse();
        }}
        className="h-[84px] box-border bg-[#1B1E2D] border-b border-white/[0.1] px-1 py-1.5 flex flex-col items-center justify-between cursor-pointer"
        style={{ borderLeft: `3px solid ${group.color}` }}
      >
        <div className="text-indigo-200">
          {group.collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </div>
        <Folder className="w-3.5 h-3.5" style={{ color: group.color }} />
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            className={`w-6 h-4 rounded-xs text-[8px] font-bold ${
              group.muted ? 'bg-orange-500 text-zinc-950' : 'bg-[#25293A] text-zinc-300'
            }`}
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSolo();
            }}
            className={`w-6 h-4 rounded-xs text-[8px] font-bold ${
              group.solo ? 'bg-amber-400 text-zinc-950' : 'bg-[#25293A] text-zinc-300'
            }`}
          >
            S
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      {...bind}
      onClick={(e) => {
        if (consumeLongPressClick()) return;
        onSelect(e);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-pulsegrid-track')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        const draggedId = e.dataTransfer.getData('application/x-pulsegrid-track');
        setIsDragOver(false);
        if (draggedId) {
          e.preventDefault();
          onDropTrackToGroup(draggedId);
        }
      }}
      style={{ borderLeft: `4px solid ${group.color}` }}
      className={`relative h-[84px] box-border border-b border-white/[0.1] py-1.5 px-2 flex flex-col justify-between transition-colors cursor-pointer ${
        isDragOver
          ? 'bg-[#262B42] ring-2 ring-inset ring-indigo-400'
          : isPrimary
            ? 'bg-[#222538] ring-1 ring-inset ring-white/20'
            : isMultiSelected
              ? 'bg-[#1F2235] ring-1 ring-inset ring-[#6D5DFB]/70'
              : 'bg-[#191C2A] hover:bg-[#1E2233]'
      }`}
    >
      {/* Row 1: Collapse Chevron, Color/Folder, Group Name, S/M, Add Track, Options */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
            className="w-7 h-6 -ml-1 rounded flex items-center justify-center text-zinc-200 hover:bg-white/10 shrink-0"
          >
            {group.collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          <span
            className="w-4 h-4 rounded-xs shrink-0 flex items-center justify-center text-zinc-950"
            style={{ backgroundColor: group.color }}
          >
            {group.frozen ? <Snowflake className="w-2.5 h-2.5" /> : <Folder className="w-2.5 h-2.5" />}
          </span>

          {isRenaming ? (
            <input
              autoFocus
              type="text"
              value={renameText}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameText(e.target.value)}
              onBlur={() => {
                if (renameText.trim()) onRenameGroup(renameText.trim());
                setIsRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (renameText.trim()) onRenameGroup(renameText.trim());
                  setIsRenaming(false);
                } else if (e.key === 'Escape') {
                  setRenameText(group.name);
                  setIsRenaming(false);
                }
              }}
              className="h-5 px-1 w-full min-w-0 rounded bg-[#101218] border border-indigo-400 text-[11px] font-bold text-white"
            />
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenameText(group.name);
                setIsRenaming(true);
              }}
              title="Double-click to rename group"
              className="min-w-0 flex-1"
            >
              <div className="text-[11px] font-bold text-zinc-100 truncate leading-tight flex items-center gap-1">
                <span className="truncate">{group.name}</span>
              </div>
              <div className="text-[9px] font-mono-tabular text-indigo-300/80 truncate leading-none">
                GROUP · {childCount} {childCount === 1 ? 'track' : 'tracks'}
                {group.frozen ? ' · Frozen' : ''}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSolo();
            }}
            aria-pressed={group.solo}
            aria-label={`Solo ${group.name}`}
            className={`h-5 w-5 rounded-xs text-[9px] font-bold ${
              group.solo ? 'bg-amber-400 text-zinc-950' : 'bg-[#252A3C] text-zinc-300'
            }`}
          >
            S
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            aria-pressed={group.muted}
            aria-label={`Mute ${group.name}`}
            className={`h-5 w-5 rounded-xs text-[9px] font-bold ${
              group.muted ? 'bg-orange-500 text-zinc-950' : 'bg-[#252A3C] text-zinc-300'
            }`}
          >
            M
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu((v) => !v);
              }}
              title="Add Track to Group"
              aria-label={`Add track to ${group.name}`}
              className="h-5 px-1.5 rounded-xs bg-indigo-500/25 hover:bg-indigo-500/40 text-indigo-200 text-[10px] font-bold flex items-center gap-0.5"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
            {showAddMenu && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-6 z-40 w-32 rounded bg-[#151824] border border-white/[0.15] shadow-xl p-1 flex flex-col gap-0.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    onAddTrackToGroup('midi');
                    setShowAddMenu(false);
                  }}
                  className="px-2 py-1.5 rounded text-left text-[11px] font-semibold text-indigo-200 hover:bg-white/[0.08]"
                >
                  + MIDI Track
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddTrackToGroup('audio');
                    setShowAddMenu(false);
                  }}
                  className="px-2 py-1.5 rounded text-left text-[11px] font-semibold text-sky-200 hover:bg-white/[0.08]"
                >
                  + Audio Track
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenMenu(rect.left, rect.bottom + 4);
            }}
            aria-label={`Group options for ${group.name}`}
            className="h-5 w-5 rounded-xs bg-[#252A3C] hover:bg-[#31374E] text-zinc-200 flex items-center justify-center"
          >
            <MoreVertical className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Row 2: Group Volume TouchFader + Group Pan RotaryKnob + Group Level Meter */}
      <div
        className="flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <TouchFader
              orientation="horizontal"
              label={`${group.name} Volume`}
              ariaLabel={`${group.name} volume`}
              value={group.volumeDb}
              min={-48}
              max={6}
              defaultValue={0}
              step={0.5}
              accentColor={group.color}
              displayValue={`${group.volumeDb > 0 ? '+' : ''}${group.volumeDb.toFixed(1)}dB`}
              onChange={(db) => onSetVolume(Math.round(db * 2) / 2)}
            />
          </div>
          <span className="font-mono-tabular text-[9px] text-zinc-300 w-9 text-right shrink-0">
            {group.volumeDb.toFixed(0)}dB
          </span>
        </div>

        <RotaryKnob
          value={group.pan}
          min={-1}
          max={1}
          defaultValue={0}
          bipolar
          size={24}
          color={group.color}
          displayValue={
            group.pan === 0
              ? 'C'
              : group.pan < 0
                ? `L${Math.round(Math.abs(group.pan) * 50)}`
                : `R${Math.round(group.pan * 50)}`
          }
          onChange={(p) => onSetPan(Math.round(p * 20) / 20)}
        />

        <MiniLevelMeter
          getLevel={() => dawController.getTrackMeter(group.id)}
          muted={group.muted}
        />
      </div>
    </div>
  );
};

interface ArrangementClipItemProps {
  clip: ArrangementClip;
  midiClip?: MidiClip;
  audioClip?: AudioClipMeta;
  isSelected: boolean;
  pxPerBeat: number;
  snapBeat: (raw: number) => number;
  onSelect: () => void;
  onMoveClip: (startBeat: number, targetTrackId?: string) => void;
  onResizeClip: (lengthBeats: number) => void;
  onDoubleClick: () => void;
  onOpenClipMenu: (target: ClipContextTarget, x: number, y: number) => void;
}

const ArrangementClipItem: React.FC<ArrangementClipItemProps> = ({
  clip,
  midiClip,
  audioClip,
  isSelected,
  pxPerBeat,
  snapBeat,
  onSelect,
  onMoveClip,
  onResizeClip,
  onDoubleClick,
  onOpenClipMenu,
}) => {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearLongPress(), []);

  const openMenuAt = (x: number, y: number) => {
    onOpenClipMenu(
      {
        source: 'arrangement',
        arrClip: clip,
        midiClip,
        audioClip,
      },
      x,
      y
    );
  };

  const handleClipPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'move' | 'resize'
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    onSelect();

    const targetEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = clip.startBeat;
    const origLen = clip.lengthBeats;
    let moved = false;
    longPressFiredRef.current = false;

    clearLongPress();
    if (mode === 'move') {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressFiredRef.current = true;
        openMenuAt(startX, startY);
      }, 500);
    }

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || longPressFiredRef.current) return;
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (dist > 8) {
        moved = true;
        clearLongPress();
      }
      if (!moved && mode === 'move') return;

      const deltaBeats = (ev.clientX - startX) / pxPerBeat;
      if (mode === 'move') {
        let hoveredTrackId: string | undefined;
        const els = document.elementsFromPoint(ev.clientX, ev.clientY);
        for (const el of els) {
          const tid = (el as HTMLElement).dataset?.trackLaneId;
          const tkind = (el as HTMLElement).dataset?.trackLaneKind;
          if (tid && tkind === clip.kind) {
            hoveredTrackId = tid;
            break;
          }
        }
        onMoveClip(snapBeat(origStart + deltaBeats), hoveredTrackId);
      } else {
        onResizeClip(Math.max(0.5, snapBeat(origLen + deltaBeats)));
      }
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      clearLongPress();
      try {
        if (targetEl.hasPointerCapture(pointerId)) {
          targetEl.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  return (
    <div
      onPointerDown={(e) => handleClipPointerDown(e, 'move')}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        clearLongPress();
        openMenuAt(e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      style={{
        left: clip.startBeat * pxPerBeat,
        width: Math.max(18, clip.lengthBeats * pxPerBeat),
        backgroundColor: `${clip.color}30`,
        borderColor: isSelected ? '#ffffff' : clip.color,
      }}
      className={`parameter-drag-area absolute top-1 bottom-1 rounded-[3px] border overflow-hidden cursor-grab active:cursor-grabbing flex flex-col ${
        isSelected ? 'ring-1 ring-white/80 z-10' : ''
      }`}
    >
      <div
        style={{ backgroundColor: clip.color }}
        className="h-3.5 px-1.5 flex items-center justify-between gap-1 text-[9px] font-bold text-zinc-950 truncate shrink-0"
      >
        <span className="truncate">{clip.name}</span>
        {clip.looped === false && <span className="text-[8px] opacity-75">1x</span>}
      </div>

      <div className="flex-1 min-h-0 px-0.5 py-0.5 relative pointer-events-none">
        {midiClip ? (
          <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-full">
            {midiClip.notes.map((n) => {
              const x = (n.startBeat / midiClip.lengthBeats) * 100;
              const w = Math.max(2.5, (n.durationBeats / midiClip.lengthBeats) * 100);
              const y = 22 - ((Math.max(36, Math.min(84, n.pitch)) - 36) / 48) * 19;
              return (
                <rect
                  key={n.id}
                  x={x}
                  y={y}
                  width={w}
                  height={3.2}
                  rx={0.5}
                  fill={clip.color}
                />
              );
            })}
          </svg>
        ) : audioClip ? (
          <svg viewBox="0 0 64 28" preserveAspectRatio="none" className="w-full h-full">
            {audioClip.peaks.map((pk, pi) => {
              const h = Math.max(3, pk * 24);
              return (
                <rect
                  key={pi}
                  x={pi}
                  y={(28 - h) / 2}
                  width={0.8}
                  height={h}
                  fill={clip.color}
                />
              );
            })}
          </svg>
        ) : null}
      </div>

      <div
        onPointerDown={(e) => handleClipPointerDown(e, 'resize')}
        title="Drag to resize"
        className="parameter-drag-area absolute top-0 right-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/30"
      />
    </div>
  );
};

export const ArrangementView: React.FC<ArrangementViewProps> = ({
  project,
  selectedTrackId,
  selectedTrackIds,
  isPlaying,
  playbackMode,
  currentBeat,
  onPlayArrangement,
  onSeekBeat,
  onSelectTrack,
  onMoveClip,
  onResizeClip,
  onDuplicateClip,
  onSplitClip,
  onDeleteClip,
  onEditMidiClip,
  onSetLoopRegion,
  onSetLoopSnap,
  onToggleLoop,
  onToggleAutomation,
  onSetAutomationTarget,
  onToggleAutomationEnabled,
  onUpsertAutomationPoint,
  onSetTrackVolume,
  onSetTrackPan,
  onToggleArm,
  onToggleMute,
  onToggleSolo,
  onAddTrack,
  onAddTrackGroup,
  onToggleGroupCollapse,
  onSetTrackGroupId,
  onDropFilesToTimeline,
  onDropAssetToTimeline,
  onOpenInstrumentPicker,
}) => {
  const [pxPerBeat, setPxPerBeat] = useState(32);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>(() =>
    project.arrangementClips[0]?.id ? [project.arrangementClips[0].id] : []
  );
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [loopDragMode, setLoopDragMode] = useState<'create' | 'move' | 'start' | 'end' | null>(null);
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);
  const [scrubBeatLabel, setScrubBeatLabel] = useState<string | null>(null);

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
  const [laneMenu, setLaneMenu] = useState<{
    track: TrackModel;
    beat: number;
    x: number;
    y: number;
  } | null>(null);
  const [audioEditorState, setAudioEditorState] = useState<{
    audioClip: AudioClipMeta;
    arrClip?: ArrangementClip;
  } | null>(null);

  const insertAudioInputRef = useRef<HTMLInputElement | null>(null);
  const insertAudioTrackRef = useRef<string | null>(null);
  const rulerTrackRef = useRef<HTMLDivElement | null>(null);
  const rulerPlayheadRef = useRef<HTMLDivElement | null>(null);
  const lanesPlayheadRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const trackPanelRef = useRef<HTMLDivElement | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(32);
  const lastArrTickRef = useRef<{ beat: number; at: number }>({
    beat: currentBeat,
    at: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  useEffect(() => {
    lastArrTickRef.current = {
      beat: currentBeat,
      at: performance.now(),
    };
    if (!isScrubbingPlayhead) {
      const x = Math.round(currentBeat * pxPerBeat * 100) / 100;
      const tf = `translate3d(${x}px, 0, 0)`;
      if (rulerPlayheadRef.current) rulerPlayheadRef.current.style.transform = tf;
      if (lanesPlayheadRef.current) lanesPlayheadRef.current.style.transform = tf;
    }
  }, [currentBeat, pxPerBeat, isScrubbingPlayhead]);

  useEffect(() => {
    if (!isPlaying || playbackMode !== 'arrangement' || isScrubbingPlayhead) {
      return;
    }

    let rafId = 0;
    const step = (now: number) => {
      const { beat: baseBeat, at } = lastArrTickRef.current;
      const elapsedSec = Math.max(0, Math.min(0.25, (now - at) / 1000));
      let smoothBeat = Math.min(baseBeat + 0.25, baseBeat + elapsedSec * (project.bpm / 60));
      if (
        project.loopEnabled &&
        project.loopEndBeat > project.loopStartBeat &&
        baseBeat < project.loopEndBeat &&
        smoothBeat >= project.loopEndBeat
      ) {
        smoothBeat = project.loopStartBeat + (smoothBeat - project.loopEndBeat);
      }

      const x = Math.round(smoothBeat * pxPerBeat * 100) / 100;
      const tf = `translate3d(${x}px, 0, 0)`;
      if (rulerPlayheadRef.current) rulerPlayheadRef.current.style.transform = tf;
      if (lanesPlayheadRef.current) lanesPlayheadRef.current.style.transform = tf;

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    isPlaying,
    playbackMode,
    isScrubbingPlayhead,
    pxPerBeat,
    project.bpm,
    project.loopEnabled,
    project.loopStartBeat,
    project.loopEndBeat,
  ]);

  const {
    autoScrollEnabled,
    autoScrollMode,
    followPaused,
    toggleAutoScroll,
    changeAutoScrollMode,
    resumeFollowAtBeat,
    handleScrollerWheel,
    handleScrollerTouchStart,
    handleScrollerTouchMove,
    handleScrollerTouchEnd,
    handleScrollerScroll,
  } = useTimelineAutoScroll({
    scrollerRef: timelineScrollRef,
    rightPanelRef: trackPanelRef,
    isPlayingArrangement: isPlaying && playbackMode === 'arrangement',
    currentBeat,
    pxPerBeat,
    bpm: project.bpm,
    loopEnabled: project.loopEnabled,
    loopStartBeat: project.loopStartBeat,
    loopEndBeat: project.loopEndBeat,
    isDraggingInteraction: loopDragMode !== null || isScrubbingPlayhead,
    panelCollapsed,
  });

  const beatsPerBar = project.timeSignature[0] || 4;
  const maxClipEnd = project.arrangementClips.reduce(
    (max, c) => Math.max(max, c.startBeat + c.lengthBeats),
    0
  );
  const totalBars = Math.max(
    24,
    Math.ceil(Math.max(maxClipEnd, project.loopEndBeat) / beatsPerBar) + 4
  );
  const totalBeats = totalBars * beatsPerBar;
  const timelineWidth = totalBeats * pxPerBeat;

  const snapBeat = (rawBeat: number) =>
    snapToGrid ? Math.max(0, Math.round(rawBeat)) : Math.max(0, Math.round(rawBeat * 4) / 4);

  const snapPlayheadBeat = (rawBeat: number) =>
    snapToGrid ? Math.max(0, Math.round(rawBeat)) : Math.max(0, Math.round(rawBeat * 64) / 64);

  const loopSnap: LoopSnapMode = project.loopSnap ?? 'bar';
  const loopStepBeats = loopSnapToBeats(loopSnap, beatsPerBar);
  const minLoopBeats = Math.max(0.25, loopSnap === 'off' ? 0.25 : loopStepBeats);

  const snapLoopBeat = (rawBeat: number, fn: 'round' | 'floor' | 'ceil' = 'round') => {
    const clamped = Math.max(0, rawBeat);
    const snapped = Math[fn](clamped / loopStepBeats) * loopStepBeats;
    return Math.max(0, Math.round(snapped * 8) / 8);
  };

  const formatBarPos = (beat: number) => {
    const bar = Math.floor(beat / beatsPerBar) + 1;
    const rem = Math.round((beat % beatsPerBar) * 100) / 100;
    if (Math.abs(rem) < 0.01) return `${bar}`;
    const beatInBar = Math.floor(rem) + 1;
    return `${bar}.${beatInBar}`;
  };

  const loopLengthBars = Math.round(((project.loopEndBeat - project.loopStartBeat) / beatsPerBar) * 10) / 10;
  const loopRangeLabel = `${formatBarPos(project.loopStartBeat)}–${formatBarPos(project.loopEndBeat)}`;

  const primarySelectedClipId = selectedClipIds[0] ?? null;
  const selectedClip =
    project.arrangementClips.find((c) => c.id === primarySelectedClipId) ?? null;

  const hierarchicalTracks = orderTracksHierarchically(project.tracks);
  const collapsedGroupIds = new Set(
    project.tracks.filter((t) => t.isGroupFolder && t.collapsed).map((t) => t.id)
  );
  const orderedTracks = hierarchicalTracks.filter(
    (t) => t.isGroupFolder || !t.groupId || !collapsedGroupIds.has(t.groupId)
  );
  const orderedIds = orderedTracks.map((t) => t.id);
  const activeSelectionIds = selectedTrackIds ?? [selectedTrackId];

  const handleTrackSelect = (e: React.MouseEvent, trackId: string) => {
    if (e.shiftKey) {
      onSelectTrack(trackId, 'range', orderedIds);
    } else if (e.metaKey || e.ctrlKey || multiSelectMode) {
      onSelectTrack(trackId, 'toggle', orderedIds);
    } else {
      onSelectTrack(trackId, 'single', orderedIds);
    }
  };

  const handleInsertMidiClip = (
    explicitTrackId?: string,
    startBeat?: number,
    lengthBeats?: number,
    openEditor = false
  ) => {
    let targetId = explicitTrackId ?? selectedTrackId;
    const candidate = project.tracks.find((t) => t.id === targetId);
    if (!candidate) {
      const firstTrack = project.tracks.find((t) => !t.isGroupFolder);
      if (firstTrack) {
        targetId = firstTrack.id;
      } else {
        targetId = dawController.addTrack('midi');
      }
    }
    const res = dawController.insertMidiClipAt(targetId, startBeat, lengthBeats);
    if (res) {
      setSelectedClipIds([res.arrClipId]);
      if (openEditor) {
        onEditMidiClip(res.clipId, res.trackId);
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    handleScrollerTouchStart(e);
    if (e.touches.length === 2) {
      pinchStartDistRef.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartZoomRef.current = pxPerBeat;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    handleScrollerTouchMove(e);
    if (e.touches.length === 2 && pinchStartDistRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchStartDistRef.current;
      setPxPerBeat(Math.max(12, Math.min(84, Math.round(pinchStartZoomRef.current * scale))));
    }
  };

  const handleTouchEnd = () => {
    handleScrollerTouchEnd();
    pinchStartDistRef.current = null;
  };

  const startLoopInteraction = (
    e: React.PointerEvent<HTMLElement>,
    mode: 'create' | 'move' | 'start' | 'end',
    fromBarRuler = false
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const trackEl = rulerTrackRef.current;
    if (!trackEl) return;
    e.stopPropagation();

    const pointerId = e.pointerId;
    const captureTarget = e.currentTarget;
    if (!fromBarRuler) {
      try {
        captureTarget.setPointerCapture(pointerId);
      } catch {
        // ignore
      }
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = trackEl.getBoundingClientRect();
    const startRawBeat = Math.max(0, (startX - rect.left) / pxPerBeat);
    const origStart = project.loopStartBeat;
    const origEnd = project.loopEndBeat;
    const origLen = Math.max(minLoopBeats, origEnd - origStart);

    const anchorFloor = snapLoopBeat(startRawBeat, 'floor');
    const anchorCeil = Math.max(minLoopBeats, snapLoopBeat(startRawBeat, 'ceil'));

    let activated = mode !== 'create';
    let cancelledForScroll = false;
    let lastStart = origStart;
    let lastEnd = origEnd;

    if (activated) {
      setLoopDragMode(mode);
    }

    const computeAndApply = (clientX: number, recordHistory: boolean) => {
      const curRect = trackEl.getBoundingClientRect();
      const curRawBeat = Math.max(0, (clientX - curRect.left) / pxPerBeat);

      if (mode === 'create') {
        if (curRawBeat >= anchorFloor) {
          lastStart = anchorFloor;
          lastEnd = Math.max(lastStart + minLoopBeats, snapLoopBeat(curRawBeat, 'round'));
        } else {
          lastStart = Math.max(0, Math.min(anchorCeil - minLoopBeats, snapLoopBeat(curRawBeat, 'round')));
          lastEnd = anchorCeil;
        }
      } else if (mode === 'start') {
        const deltaBeats = (clientX - startX) / pxPerBeat;
        lastStart = Math.max(0, Math.min(origEnd - minLoopBeats, snapLoopBeat(origStart + deltaBeats, 'round')));
        lastEnd = origEnd;
      } else if (mode === 'end') {
        const deltaBeats = (clientX - startX) / pxPerBeat;
        lastStart = origStart;
        lastEnd = Math.max(origStart + minLoopBeats, snapLoopBeat(origEnd + deltaBeats, 'round'));
      } else {
        const deltaBeats = (clientX - startX) / pxPerBeat;
        lastStart = Math.max(0, snapLoopBeat(origStart + deltaBeats, 'round'));
        lastEnd = lastStart + origLen;
      }

      onSetLoopRegion(lastStart, lastEnd, recordHistory);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || cancelledForScroll) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!activated) {
        if (fromBarRuler && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          cancelledForScroll = true;
          return;
        }
        if (Math.abs(dx) >= (fromBarRuler ? 8 : 5)) {
          activated = true;
          setLoopDragMode('create');
          try {
            captureTarget.setPointerCapture(pointerId);
          } catch {
            // ignore
          }
        } else {
          return;
        }
      }

      computeAndApply(ev.clientX, false);
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      try {
        if (captureTarget.hasPointerCapture(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      setLoopDragMode(null);

      if (cancelledForScroll) return;

      if (activated) {
        computeAndApply(ev.clientX, true);
      } else if (fromBarRuler) {
        // Short tap on the bar ruler seeks playhead cleanly
        onSeekBeat(snapBeat(startRawBeat));
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const formatPlayheadReadout = (beat: number) => {
    const safe = Math.max(0, beat);
    const bar = Math.floor(safe / beatsPerBar) + 1;
    const rem = safe % beatsPerBar;
    const beatNum = Math.floor(rem) + 1;
    const sixteenth = Math.floor((rem - Math.floor(rem)) * 4) + 1;
    return `${bar}.${beatNum}.${sixteenth}`;
  };

  const startPlayheadScrub = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const trackEl = rulerTrackRef.current;
    if (!trackEl) return;
    e.stopPropagation();

    const pointerId = e.pointerId;
    const captureTarget = e.currentTarget;
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    setIsScrubbingPlayhead(true);
    let lastScrubBeat = currentBeat;

    const applyFromClientX = (clientX: number) => {
      const rect = trackEl.getBoundingClientRect();
      const rawBeat = Math.max(0, Math.min(totalBeats, (clientX - rect.left) / pxPerBeat));
      const targetBeat = snapPlayheadBeat(rawBeat);
      lastScrubBeat = targetBeat;

      const x = Math.round(targetBeat * pxPerBeat * 100) / 100;
      const tf = `translate3d(${x}px, 0, 0)`;
      if (rulerPlayheadRef.current) rulerPlayheadRef.current.style.transform = tf;
      if (lanesPlayheadRef.current) lanesPlayheadRef.current.style.transform = tf;
      setScrubBeatLabel(formatPlayheadReadout(targetBeat));
      onSeekBeat(targetBeat);
    };

    applyFromClientX(e.clientX);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      applyFromClientX(ev.clientX);
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      try {
        if (captureTarget.hasPointerCapture(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      setIsScrubbingPlayhead(false);
      setScrubBeatLabel(null);
      resumeFollowAtBeat(lastScrubBeat);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const handleOverviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetBeat = snapPlayheadBeat(ratio * totalBeats);
    onSeekBeat(targetBeat);
    resumeFollowAtBeat(targetBeat);
  };

  const handleAutomationPointerDown = (
    e: React.PointerEvent<SVGSVGElement>,
    track: TrackModel
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const svg = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      svg.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const updatePoint = (clientX: number, clientY: number) => {
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const beat = snapBeat(x / pxPerBeat);
      const val = 1 - Math.max(0, Math.min(1, y / rect.height));
      onUpsertAutomationPoint(track.id, track.activeAutomationTarget, beat, val);
    };

    updatePoint(e.clientX, e.clientY);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      updatePoint(ev.clientX, ev.clientY);
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      try {
        if (svg.hasPointerCapture(pointerId)) {
          svg.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const selectedNonGroupCount = activeSelectionIds.filter(
    (id) => !project.tracks.find((t) => t.id === id)?.isGroupFolder
  ).length;

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
            void dawController.importAudioFile(file, { trackId: tid, startBeat: currentBeat });
            e.target.value = '';
          }
        }}
      />

      {/* Arrangement Action Strip */}
      <div className="px-2 sm:px-3 py-1.5 bg-[#15171F] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <button
            type="button"
            onClick={onPlayArrangement}
            className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1.5 ${
              isPlaying && playbackMode === 'arrangement'
                ? 'bg-emerald-500 text-zinc-950'
                : 'bg-[#222632] text-zinc-100 hover:bg-[#2C3140]'
            }`}
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Play Timeline</span>
          </button>

          <button
            type="button"
            onClick={() => setSnapToGrid((s) => !s)}
            aria-pressed={snapToGrid}
            className={`h-9 sm:h-7 px-2.5 sm:px-2 rounded border text-[11px] font-semibold whitespace-nowrap shrink-0 ${
              snapToGrid
                ? 'bg-[#6D5DFB]/20 border-[#6D5DFB] text-indigo-200'
                : 'bg-[#101217] border-white/[0.08] text-zinc-400'
            }`}
          >
            Snap
          </button>

          {/* Auto-Scroll / Playhead Follow Control */}
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleAutoScroll}
              aria-pressed={autoScrollEnabled && !followPaused}
              title={
                !autoScrollEnabled
                  ? 'Enable timeline auto-scroll during playback'
                  : followPaused
                    ? 'Auto-scroll paused by manual scroll — tap to re-center on playhead'
                    : 'Auto-scroll active — tap to disable'
              }
              className={`h-8 sm:h-6 px-2.5 sm:px-2 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                autoScrollEnabled && !followPaused
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/60'
                  : autoScrollEnabled && followPaused
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-400/60'
                    : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <LocateFixed className="w-3 h-3 shrink-0" />
              <span>{autoScrollEnabled && followPaused ? 'Re-center' : 'Follow'}</span>
            </button>
            <select
              aria-label="Auto-Scroll Mode"
              title="Playhead Auto-Scroll Mode"
              value={autoScrollMode}
              onChange={(e) => changeAutoScrollMode(e.target.value as AutoScrollMode)}
              className="h-8 sm:h-6 bg-[#181B24] border border-white/[0.08] rounded px-1.5 sm:px-1 text-[10px] font-semibold text-zinc-200 focus:outline-none"
            >
              <option value="center">Center</option>
              <option value="page">Page</option>
            </select>
          </div>

          {/* Arrangement Loop Badge + Loop Snap */}
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-1">
            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={project.loopEnabled}
              title="Toggle Arrangement Loop (Range preserved)"
              className={`h-6 px-2 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                project.loopEnabled
                  ? 'bg-sky-500/25 text-sky-200 border border-sky-400/60'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Repeat className="w-3 h-3" />
              <span className="font-mono-tabular whitespace-nowrap">
                {loopRangeLabel}
              </span>
            </button>
            <select
              aria-label="Loop Snap Grid"
              title="Loop Range Snap Resolution"
              value={loopSnap}
              onChange={(e) => {
                const next = e.target.value as LoopSnapMode;
                if (onSetLoopSnap) {
                  onSetLoopSnap(next);
                } else {
                  dawController.setLoopSnap(next);
                }
              }}
              className="h-6 bg-[#181B24] border border-white/[0.08] rounded px-1 font-mono-tabular text-[10px] font-semibold text-zinc-200 focus:outline-none"
            >
              <option value="bar">Bar</option>
              <option value="1/2">1/2</option>
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="off">Off</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() =>
              selectedNonGroupCount >= 2
                ? dawController.groupTracks(activeSelectionIds)
                : onAddTrackGroup()
            }
            className="h-7 px-2.5 rounded bg-[#6D5DFB]/20 hover:bg-[#6D5DFB]/30 border border-[#6D5DFB]/40 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{selectedNonGroupCount >= 2 ? `Group (${selectedNonGroupCount})` : 'Add Group'}</span>
          </button>
        </div>

        {/* Selected Clip Actions + Add Track */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {selectedClip && (
            <div className="flex items-center gap-1 bg-[#101217] border border-white/[0.08] rounded p-0.5">
              {selectedClip.kind === 'midi' ? (
                <button
                  type="button"
                  onClick={() => onEditMidiClip(selectedClip.sourceClipId, selectedClip.trackId)}
                  className="h-6 px-2 rounded text-[11px] font-semibold text-indigo-300 hover:bg-white/[0.06] flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" />
                  <span className="hidden sm:inline">MIDI</span>
                </button>
              ) : (
                project.audioClips[selectedClip.sourceClipId] && (
                  <button
                    type="button"
                    onClick={() =>
                      setAudioEditorState({
                        audioClip: project.audioClips[selectedClip.sourceClipId],
                        arrClip: selectedClip,
                      })
                    }
                    className="h-6 px-2 rounded text-[11px] font-semibold text-sky-300 hover:bg-white/[0.06] flex items-center gap-1"
                  >
                    <Sliders className="w-3 h-3" />
                    <span className="hidden sm:inline">Audio</span>
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => onDuplicateClip(selectedClip.id)}
                title="Duplicate clip"
                className="h-6 w-6 rounded bg-[#222632] hover:bg-[#2C3140] text-zinc-200 flex items-center justify-center"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onSplitClip(selectedClip.id, currentBeat)}
                title="Split at playhead"
                className="h-6 w-6 rounded bg-[#222632] hover:bg-[#2C3140] text-zinc-200 flex items-center justify-center"
              >
                <Scissors className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteClip(selectedClip.id)}
                title="Delete clip"
                className="h-6 w-6 rounded bg-[#222632] hover:bg-rose-600/80 text-zinc-200 flex items-center justify-center"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleInsertMidiClip()}
            aria-label="Insert MIDI Clip"
            title="Insert MIDI clip on selected track (or double-click any track lane)"
            className="h-7 px-2.5 rounded bg-[#6D5DFB] hover:bg-[#7D6EFF] text-white flex items-center gap-1 text-[11px] font-semibold shadow-xs shadow-[#6D5DFB]/25 transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>+ MIDI Clip</span>
          </button>
          <button
            type="button"
            onClick={() => onAddTrack('midi')}
            className="h-7 px-2 rounded bg-[#222632] hover:bg-[#2C3140] text-zinc-200 flex items-center gap-1 text-[11px] font-semibold"
          >
            <Plus className="w-3 h-3 text-indigo-400" />
            <span>MIDI Track</span>
          </button>
          <button
            type="button"
            onClick={() => onAddTrack('audio')}
            className="h-7 px-2 rounded bg-[#222632] hover:bg-[#2C3140] text-zinc-200 flex items-center gap-1 text-[11px] font-semibold"
          >
            <Plus className="w-3 h-3 text-sky-400" />
            <span>Audio Track</span>
          </button>
        </div>
      </div>

      {/* Multi-Track Selection Action Bar */}
      {(multiSelectMode || activeSelectionIds.length >= 2) && (
        <div className="px-2 sm:px-3 py-1.5 bg-[#1B1E2C] border-b border-[#6D5DFB]/35 flex items-center justify-between gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-2 text-xs text-indigo-200 font-semibold">
            <Layers className="w-3.5 h-3.5 text-[#6D5DFB]" />
            <span>
              {activeSelectionIds.length} track{activeSelectionIds.length === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={selectedNonGroupCount < 1}
              onClick={() => {
                dawController.groupTracks(activeSelectionIds);
                setMultiSelectMode(false);
              }}
              className="h-7 px-2.5 rounded bg-[#6D5DFB] hover:bg-[#7D6EFF] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Group Tracks</span>
            </button>
            {activeSelectionIds.some((id) => {
              const t = project.tracks.find((tr) => tr.id === id);
              return Boolean(t && (t.isGroupFolder || t.groupId));
            }) && (
              <button
                type="button"
                onClick={() => {
                  dawController.ungroupTracks(activeSelectionIds);
                  setMultiSelectMode(false);
                }}
                className="h-7 px-2.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-xs font-semibold flex items-center gap-1"
              >
                <Ungroup className="w-3.5 h-3.5" />
                <span>Ungroup</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMultiSelectMode(false);
                onSelectTrack(selectedTrackId, 'single', orderedIds);
              }}
              className="h-7 px-2 rounded bg-[#252938] text-[11px] text-zinc-300 font-semibold"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Multitrack Timeline (LEFT/CENTER) & Track Control Panel (RIGHT) */}
      <div
        ref={timelineScrollRef}
        className="flex-1 min-h-0 overflow-auto overscroll-x-contain relative"
        onScroll={handleScrollerScroll}
        onWheel={handleScrollerWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="flex min-w-max">
          {/* LEFT & CENTER: Arrangement Timeline */}
          <div className="flex flex-col flex-1">
            {/* Two-Tier Sticky Ruler: Loop Selection Brace Lane + Bar Ruler */}
            <div className="sticky top-0 z-[28] flex flex-col bg-[#161922] border-b border-white/[0.12]">
              <div
                ref={rulerTrackRef}
                style={{ width: timelineWidth }}
                className="relative flex flex-col select-none"
              >
                {/* Tier 1: Dedicated Loop Selection & Brace Lane (touch-none) */}
                <div
                  onPointerDown={(e) => startLoopInteraction(e, 'create', false)}
                  title="Drag across bars to select a loop range"
                  className="relative h-6 bg-[#10131C] border-b border-white/[0.07] touch-none cursor-crosshair"
                >
                  {/* Bar tick guides in loop lane */}
                  {Array.from({ length: totalBars }, (_, barIdx) => (
                    <div
                      key={barIdx}
                      style={{ left: barIdx * beatsPerBar * pxPerBeat }}
                      className="absolute top-0 bottom-0 border-l border-white/[0.07] pointer-events-none"
                    />
                  ))}

                  {/* Visual Loop Brace (always visible, highlighted when enabled) */}
                  <div
                    onPointerDown={(e) => startLoopInteraction(e, 'move', false)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onToggleLoop();
                    }}
                    style={{
                      left: project.loopStartBeat * pxPerBeat,
                      width: Math.max(16, (project.loopEndBeat - project.loopStartBeat) * pxPerBeat),
                    }}
                    title="Drag to move loop · Drag ends to resize · Double-click to toggle"
                    className={`absolute top-0.5 bottom-0.5 rounded-[3px] border touch-none cursor-grab active:cursor-grabbing flex items-center justify-center transition-colors ${
                      project.loopEnabled
                        ? 'bg-sky-500/35 border-sky-300 text-sky-50 shadow-[0_0_8px_rgba(56,189,248,0.28)]'
                        : 'bg-zinc-600/30 border-zinc-400/50 text-zinc-300'
                    } ${loopDragMode ? 'ring-1 ring-white/80' : ''}`}
                  >
                    {/* Left Touch-Friendly Loop Handle */}
                    <div
                      role="slider"
                      aria-label="Loop Start Handle"
                      aria-valuenow={project.loopStartBeat}
                      onPointerDown={(e) => startLoopInteraction(e, 'start', false)}
                      className="absolute -left-2.5 top-0 bottom-0 w-5 z-20 cursor-ew-resize touch-none flex items-center justify-center"
                    >
                      <span
                        className={`w-2 h-4 rounded-[2px] border flex items-center justify-center ${
                          project.loopEnabled
                            ? 'bg-sky-300 border-sky-100'
                            : 'bg-zinc-300 border-zinc-100'
                        }`}
                      />
                    </div>

                    {/* Loop Range Bar Readout */}
                    <span className="px-2.5 font-mono-tabular text-[10px] font-bold tracking-tight truncate pointer-events-none select-none">
                      {loopRangeLabel}
                      {pxPerBeat * (project.loopEndBeat - project.loopStartBeat) > 76
                        ? ` (${loopLengthBars}b)`
                        : ''}
                    </span>

                    {/* Right Touch-Friendly Loop Handle */}
                    <div
                      role="slider"
                      aria-label="Loop End Handle"
                      aria-valuenow={project.loopEndBeat}
                      onPointerDown={(e) => startLoopInteraction(e, 'end', false)}
                      className="absolute -right-2.5 top-0 bottom-0 w-5 z-20 cursor-ew-resize touch-none flex items-center justify-center"
                    >
                      <span
                        className={`w-2 h-4 rounded-[2px] border flex items-center justify-center ${
                          project.loopEnabled
                            ? 'bg-sky-300 border-sky-100'
                            : 'bg-zinc-300 border-zinc-100'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* Tier 2: Bar Number & Playhead Seek Ruler */}
                <div
                  onPointerDown={startPlayheadScrub}
                  title="Tap or drag across bars to position playhead"
                  className="relative h-7 bg-[#141721] touch-none cursor-pointer"
                >
                  {Array.from({ length: totalBars }, (_, barIdx) => {
                    const barStart = barIdx * beatsPerBar;
                    const barEnd = barStart + beatsPerBar;
                    const inLoop =
                      barEnd > project.loopStartBeat + 1e-4 &&
                      barStart < project.loopEndBeat - 1e-4;
                    return (
                      <div
                        key={barIdx}
                        style={{
                          left: barStart * pxPerBeat,
                          width: beatsPerBar * pxPerBeat,
                        }}
                        className={`absolute top-0 bottom-0 border-l border-white/[0.15] px-1.5 flex items-center font-mono-tabular text-[10px] pointer-events-none ${
                          inLoop && project.loopEnabled
                            ? 'text-sky-300 font-bold bg-sky-500/[0.06]'
                            : inLoop
                              ? 'text-zinc-200 font-semibold'
                              : 'text-zinc-400'
                        }`}
                      >
                        {barIdx + 1}
                      </div>
                    );
                  })}

                  {/* Ableton-style Triangular Playhead Handle + 44px Touch Scrub Target */}
                  <div
                    ref={rulerPlayheadRef}
                    style={{ transform: `translate3d(${currentBeat * pxPerBeat}px, 0, 0)` }}
                    className="absolute top-0 bottom-0 left-0 z-30 will-change-transform"
                  >
                    <div
                      role="slider"
                      aria-label="Arrangement Playhead"
                      aria-valuemin={0}
                      aria-valuemax={totalBeats}
                      aria-valuenow={Math.round(currentBeat * 100) / 100}
                      onPointerDown={startPlayheadScrub}
                      title="Drag to scrub Arrangement playhead"
                      className="absolute top-0 bottom-0 -left-[22px] w-11 touch-none cursor-ew-resize flex flex-col items-center"
                    >
                      <svg
                        width="14"
                        height="10"
                        viewBox="0 0 14 10"
                        className="shrink-0 drop-shadow-[0_1px_4px_rgba(255,140,36,0.75)]"
                      >
                        <polygon points="0,0 14,0 7,10" fill="#FF8C24" />
                      </svg>
                      <div className="w-[2px] flex-1 bg-[#FF8C24] shadow-[0_0_8px_rgba(255,140,36,0.75)]" />
                      {scrubBeatLabel && (
                        <span className="absolute -top-0.5 left-8 px-1.5 py-0.5 rounded bg-[#FF8C24] text-zinc-950 font-mono-tabular text-[9px] font-bold shadow-md whitespace-nowrap pointer-events-none">
                          {scrubBeatLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline Track Lanes Container + Full-Height Loop Highlight Column */}
            <div className="relative flex flex-col">
            {orderedTracks.map((track) => {
              if (track.isGroupFolder) {
                const groupChildren = project.tracks.filter(
                  (c) => !c.isGroupFolder && c.groupId === track.id
                );
                const childIdSet = new Set(groupChildren.map((c) => c.id));
                const childClips = project.arrangementClips.filter((c) =>
                  childIdSet.has(c.trackId)
                );
                const frozenStemClips = project.arrangementClips.filter(
                  (c) => c.trackId === track.id
                );

                return (
                  <div
                    key={track.id}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/x-pulsegrid-track')) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => {
                      const draggedId = e.dataTransfer.getData('application/x-pulsegrid-track');
                      if (draggedId) {
                        e.preventDefault();
                        onSetTrackGroupId(draggedId, track.id);
                      }
                    }}
                    style={{
                      width: timelineWidth,
                      backgroundColor: `${track.color}12`,
                    }}
                    className="h-[84px] box-border border-b border-white/[0.1] relative overflow-hidden"
                  >
                    {/* Beat Grid Lines */}
                    {Array.from({ length: totalBeats }, (_, b) => {
                      const isBar = b % beatsPerBar === 0;
                      return (
                        <div
                          key={b}
                          style={{ left: b * pxPerBeat }}
                          className={`absolute top-0 bottom-0 border-l pointer-events-none ${
                            isBar ? 'border-white/[0.11]' : 'border-white/[0.03]'
                          }`}
                        />
                      );
                    })}

                    {/* Group Lane Summary Header Tag */}
                    <div className="relative z-10 px-2.5 pt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-indigo-200 pointer-events-none">
                      <Folder className="w-3 h-3 shrink-0" style={{ color: track.color }} />
                      <span>
                        Group Bus: {track.name}{' '}
                        <span className="font-normal text-zinc-400">
                          ({groupChildren.length} track{groupChildren.length === 1 ? '' : 's'}
                          {track.collapsed ? ' · collapsed' : ''}
                          {track.frozen ? ' · frozen' : ''})
                        </span>
                      </span>
                    </div>

                    {/* Summary Strip of Child Clips (and/or Frozen Stem) */}
                    <div className="absolute left-0 right-0 top-6 bottom-1.5 pointer-events-none">
                      {frozenStemClips.map((sc) => (
                        <div
                          key={sc.id}
                          style={{
                            left: sc.startBeat * pxPerBeat,
                            width: Math.max(14, sc.lengthBeats * pxPerBeat),
                            backgroundColor: `${track.color}38`,
                            borderColor: track.color,
                          }}
                          className="absolute top-0 bottom-0 rounded-[3px] border px-1.5 flex items-center text-[9px] font-bold text-white truncate"
                        >
                          {sc.name}
                        </div>
                      ))}

                      {!track.frozen &&
                        childClips.map((cc, ci) => {
                          const laneRow = groupChildren.findIndex((g) => g.id === cc.trackId);
                          const laneCount = Math.max(1, groupChildren.length);
                          const rowH = Math.max(8, Math.floor(46 / Math.min(4, laneCount)));
                          const topPx = (Math.max(0, laneRow) % 4) * (rowH + 2);
                          return (
                            <div
                              key={`${cc.id}-${ci}`}
                              style={{
                                left: cc.startBeat * pxPerBeat,
                                width: Math.max(10, cc.lengthBeats * pxPerBeat),
                                top: topPx,
                                height: rowH,
                                backgroundColor: `${cc.color}55`,
                                borderColor: cc.color,
                              }}
                              className="absolute rounded-[2px] border px-1 flex items-center text-[8px] font-bold text-white/95 truncate"
                            >
                              {rowH >= 12 ? cc.name : null}
                            </div>
                          );
                        })}
                    </div>

                      </div>
                    );
                  }

              const trackClips = project.arrangementClips.filter((c) => c.trackId === track.id);
              const activeLane = track.automationLanes.find(
                (l) => l.target === track.activeAutomationTarget
              );

              return (
                <div
                  key={track.id}
                  style={{ height: track.showAutomation ? 144 : 88 }}
                  className="box-border flex flex-col border-b border-white/[0.08]"
                >
                  {/* Timeline Lane (88px minus automation) */}
                  <div
                    data-track-lane-id={track.id}
                    data-track-lane-kind={track.type}
                    style={{ width: timelineWidth }}
                    title="Double-click or right-click to insert MIDI clip"
                    onDoubleClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickBeat = snapBeat((e.clientX - rect.left) / pxPerBeat);
                      handleInsertMidiClip(track.id, clickBeat);
                    }}
                    onContextMenu={(e) => {
                      if (e.target !== e.currentTarget) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickBeat = snapBeat((e.clientX - rect.left) / pxPerBeat);
                      onSelectTrack(track.id, 'single', orderedIds);
                      setLaneMenu({
                        track,
                        beat: clickBeat,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const dropBeat = snapBeat((e.clientX - rect.left) / pxPerBeat);
                      const assetId = e.dataTransfer.getData('application/x-pulsegrid-asset');
                      if (assetId) {
                        onDropAssetToTimeline(assetId, track.id, dropBeat);
                      } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        onDropFilesToTimeline(e.dataTransfer.files, track.id, dropBeat);
                      }
                    }}
                    className="relative flex-1 min-h-0 bg-[#111319]"
                  >
                    {/* Grid Lines */}
                    {Array.from({ length: totalBeats }, (_, b) => {
                      const isBar = b % beatsPerBar === 0;
                      return (
                        <div
                          key={b}
                          style={{ left: b * pxPerBeat }}
                          className={`absolute top-0 bottom-0 border-l pointer-events-none ${
                            isBar ? 'border-white/[0.11]' : 'border-white/[0.03]'
                          }`}
                        />
                      );
                    })}

                    {/* Clips */}
                    {trackClips.map((clip) => {
                      const isSelected = selectedClipIds.includes(clip.id);
                      const midiClip =
                        clip.kind === 'midi' ? project.midiClips[clip.sourceClipId] : undefined;
                      const audioClip =
                        clip.kind === 'audio' ? project.audioClips[clip.sourceClipId] : undefined;

                      return (
                        <ArrangementClipItem
                          key={clip.id}
                          clip={clip}
                          midiClip={midiClip}
                          audioClip={audioClip}
                          isSelected={isSelected}
                          pxPerBeat={pxPerBeat}
                          snapBeat={snapBeat}
                          onSelect={() => {
                            setSelectedClipIds([clip.id]);
                            onSelectTrack(clip.trackId, 'single', orderedIds);
                          }}
                          onMoveClip={(startBeat, targetTrackId) =>
                            onMoveClip(clip.id, startBeat, targetTrackId)
                          }
                          onResizeClip={(len) => onResizeClip(clip.id, len)}
                          onDoubleClick={() => {
                            if (clip.kind === 'midi') {
                              onEditMidiClip(clip.sourceClipId, clip.trackId);
                            } else if (audioClip) {
                              setAudioEditorState({ audioClip, arrClip: clip });
                            }
                          }}
                          onOpenClipMenu={(target, x, y) => setClipMenu({ target, x, y })}
                        />
                      );
                    })}
                  </div>

                  {/* Automation Lane (56px) */}
                  {track.showAutomation && activeLane && (
                    <div
                      style={{ width: timelineWidth }}
                      className="relative h-14 shrink-0 bg-[#0D0F14] border-t border-white/[0.06]"
                    >
                      <svg
                        width={timelineWidth}
                        height={56}
                        onPointerDown={(e) => handleAutomationPointerDown(e, track)}
                        className="parameter-drag-area cursor-crosshair block"
                      >
                        <polyline
                          fill="none"
                          stroke={activeLane.enabled ? track.color : '#52525b'}
                          strokeWidth="2"
                          points={Array.from({ length: totalBeats + 1 }, (_, b) => {
                            const val = sampleAutomationLane(activeLane, b);
                            return `${b * pxPerBeat},${(1 - val) * 52 + 2}`;
                          }).join(' ')}
                        />
                        {activeLane.points.map((pt) => (
                          <circle
                            key={pt.id}
                            cx={pt.beat * pxPerBeat}
                            cy={(1 - pt.value) * 52 + 2}
                            r={4.5}
                            fill="#ffffff"
                            stroke={track.color}
                            strokeWidth="2"
                          />
                        ))}
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}
              {/* Full-height non-blocking Loop Highlight Column across all track & group lanes */}
              <div
                aria-hidden="true"
                style={{
                  left: project.loopStartBeat * pxPerBeat,
                  width: Math.max(4, (project.loopEndBeat - project.loopStartBeat) * pxPerBeat),
                }}
                className={`absolute top-0 bottom-0 pointer-events-none z-[5] ${
                  project.loopEnabled
                    ? 'bg-sky-400/[0.06] border-x border-sky-400/50'
                    : 'bg-zinc-400/[0.02] border-x border-dashed border-zinc-400/25'
                }`}
              />

              {/* Full-height GPU-composited Playhead Line across all track, group & automation lanes */}
              <div
                ref={lanesPlayheadRef}
                aria-hidden="true"
                style={{ transform: `translate3d(${currentBeat * pxPerBeat}px, 0, 0)` }}
                className="absolute top-0 bottom-0 left-0 w-[2px] -ml-[1px] bg-[#FF8C24] shadow-[0_0_10px_rgba(255,140,36,0.55)] opacity-90 pointer-events-none z-[25] will-change-transform"
              />
            </div>
          </div>

          {/* RIGHT EDGE: Docked Track Control Panel */}
          <div
            ref={trackPanelRef}
            className={`sticky right-0 z-30 shrink-0 bg-[#151820] border-l border-white/[0.12] flex flex-col transition-[width] duration-150 ${
              panelCollapsed ? 'w-11' : 'w-60 sm:w-72'
            }`}
          >
            {/* Top Header Label matching Two-Tier Ruler height (h-13) */}
            <div className="sticky top-0 z-30 h-[53px] bg-[#161922] border-b border-white/[0.12] px-2 flex items-center justify-between gap-1 shrink-0">
              {!panelCollapsed && (
                <>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 truncate">
                    Tracks ({project.tracks.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setMultiSelectMode((m) => !m)}
                    aria-pressed={multiSelectMode}
                    title="Toggle multi-track selection mode"
                    className={`h-5 px-1.5 rounded text-[9px] font-bold flex items-center gap-0.5 ${
                      multiSelectMode
                        ? 'bg-[#6D5DFB] text-white'
                        : 'bg-[#222631] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Layers className="w-2.5 h-2.5" />
                    <span>Multi</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setPanelCollapsed((c) => !c)}
                title={panelCollapsed ? 'Expand track panel' : 'Collapse track panel'}
                aria-label={panelCollapsed ? 'Expand track panel' : 'Collapse track panel'}
                className="h-6 w-6 rounded bg-[#222631] hover:bg-[#2C3140] text-zinc-300 flex items-center justify-center shrink-0 mx-auto sm:mx-0"
              >
                {panelCollapsed ? (
                  <ChevronLeft className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* Track & Group Folder Rows */}
            {orderedTracks.map((track, idx) => {
              if (track.isGroupFolder) {
                const childCount = project.tracks.filter(
                  (c) => !c.isGroupFolder && c.groupId === track.id
                ).length;
                return (
                  <ArrangementGroupHeader
                    key={track.id}
                    group={track}
                    childCount={childCount}
                    isPrimary={selectedTrackId === track.id}
                    isMultiSelected={activeSelectionIds.includes(track.id)}
                    panelCollapsed={panelCollapsed}
                    onSelect={(e) => handleTrackSelect(e, track.id)}
                    onToggleCollapse={() => onToggleGroupCollapse(track.id)}
                    onToggleSolo={() => onToggleSolo(track.id)}
                    onToggleMute={() => onToggleMute(track.id)}
                    onSetVolume={(db) =>
                      onSetTrackVolume
                        ? onSetTrackVolume(track.id, db)
                        : dawController.setTrackVolume(track.id, db)
                    }
                    onSetPan={(pan) =>
                      onSetTrackPan
                        ? onSetTrackPan(track.id, pan)
                        : dawController.setTrackPan(track.id, pan)
                    }
                    onRenameGroup={(name) => dawController.renameTrack(track.id, name)}
                    onAddTrackToGroup={(type) => onAddTrack(type, undefined, track.id)}
                    onDropTrackToGroup={(draggedId) => {
                      setDraggingTrackId(null);
                      onSetTrackGroupId(draggedId, track.id);
                    }}
                    onOpenMenu={(x, y) => setTrackMenu({ track, x, y })}
                  />
                );
              }

              const isPrimary = selectedTrackId === track.id;
              const isMultiSelected = activeSelectionIds.includes(track.id);
              const isNested = Boolean(track.groupId);
              const parentGroup = track.groupId
                ? project.tracks.find((g) => g.id === track.groupId) ?? null
                : null;
              const nextTrack = orderedTracks[idx + 1];
              const isLastInGroup = Boolean(
                isNested && (!nextTrack || nextTrack.groupId !== track.groupId)
              );

              return (
                <ArrangementTrackHeader
                  key={track.id}
                  track={track}
                  parentGroup={parentGroup}
                  isPrimary={isPrimary}
                  isMultiSelected={isMultiSelected}
                  isNested={isNested}
                  isLastInGroup={isLastInGroup}
                  panelCollapsed={panelCollapsed}
                  onSelect={(e) => handleTrackSelect(e, track.id)}
                  onToggleSolo={() => onToggleSolo(track.id)}
                  onToggleMute={() => onToggleMute(track.id)}
                  onToggleArm={() => onToggleArm(track.id)}
                  onToggleAutomation={() => onToggleAutomation(track.id)}
                  onSetVolume={(db) =>
                    onSetTrackVolume
                      ? onSetTrackVolume(track.id, db)
                      : dawController.setTrackVolume(track.id, db)
                  }
                  onSetPan={(pan) =>
                    onSetTrackPan
                      ? onSetTrackPan(track.id, pan)
                      : dawController.setTrackPan(track.id, pan)
                  }
                  onSetAutomationTarget={(target) => onSetAutomationTarget(track.id, target)}
                  onToggleAutomationEnabled={(target) =>
                    onToggleAutomationEnabled(track.id, target)
                  }
                  onOpenMenu={(x, y) => setTrackMenu({ track, x, y })}
                  onDragStartTrack={(id) => setDraggingTrackId(id)}
                  onDragEndTrack={() => setDraggingTrackId(null)}
                  onDropTrackHere={(draggedId) => {
                    setDraggingTrackId(null);
                    onSetTrackGroupId(draggedId, track.groupId);
                  }}
                  onOpenInstrumentPicker={
                    onOpenInstrumentPicker ? () => onOpenInstrumentPicker(track.id) : undefined
                  }
                />
              );
            })}

            {/* Drop zone to move a grouped track back to top level */}
            {draggingTrackId &&
              project.tracks.find((t) => t.id === draggingTrackId)?.groupId &&
              !panelCollapsed && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const draggedId = e.dataTransfer.getData('application/x-pulsegrid-track');
                    setDraggingTrackId(null);
                    if (draggedId) {
                      e.preventDefault();
                      onSetTrackGroupId(draggedId, undefined);
                    }
                  }}
                  className="m-2 h-10 rounded border border-dashed border-amber-400/60 bg-amber-500/10 flex items-center justify-center text-[11px] font-semibold text-amber-200"
                >
                  Drop here to remove from group
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Bottom Overview Waveform & Zoom Bar */}
      <div className="h-11 bg-[#141720] border-t border-white/[0.08] px-2 sm:px-3 flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleLoop}
          aria-pressed={project.loopEnabled}
          title="Toggle Loop Region"
          className={`h-7 w-7 rounded border flex items-center justify-center shrink-0 ${
            project.loopEnabled
              ? 'bg-[#6D5DFB]/25 border-[#6D5DFB] text-indigo-200'
              : 'bg-[#101217] border-white/[0.08] text-zinc-400'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" />
        </button>

        {/* Overview Minimap */}
        <div
          onClick={handleOverviewClick}
          className="relative flex-1 h-7 rounded bg-[#0D0F14] border border-white/[0.08] overflow-hidden cursor-pointer"
          title="Click anywhere to jump playhead"
        >
          <svg viewBox={`0 0 ${totalBeats} 28`} preserveAspectRatio="none" className="w-full h-full">
            <rect
              x={project.loopStartBeat}
              y={0}
              width={Math.max(0.5, project.loopEndBeat - project.loopStartBeat)}
              height={28}
              fill={project.loopEnabled ? '#38BDF8' : '#71717A'}
              fillOpacity={project.loopEnabled ? 0.16 : 0.08}
            />
            {project.arrangementClips.map((c) => (
              <rect
                key={c.id}
                x={c.startBeat}
                y={6}
                width={Math.max(0.5, c.lengthBeats)}
                height={16}
                rx={0.5}
                fill={c.color}
                fillOpacity={0.65}
              />
            ))}
          </svg>
          <div
            style={{ left: `${Math.min(100, (currentBeat / totalBeats) * 100)}%` }}
            className="absolute top-0 bottom-0 w-0.5 bg-[#FF8C24] pointer-events-none"
          />
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setPxPerBeat((z) => Math.max(12, z - 6))}
            aria-label="Zoom Out"
            className="h-7 w-7 rounded bg-[#1E222D] text-zinc-300 hover:text-white flex items-center justify-center"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPxPerBeat((z) => Math.min(84, z + 6))}
            aria-label="Zoom In"
            className="h-7 w-7 rounded bg-[#1E222D] text-zinc-300 hover:text-white flex items-center justify-center"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPxPerBeat(24)}
            title="Fit Timeline"
            className="hidden sm:flex h-7 w-7 rounded bg-[#1E222D] text-zinc-300 hover:text-white items-center justify-center"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
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
        onSelectAllClips={(tid) => {
          const ids = project.arrangementClips
            .filter((c) => c.trackId === tid)
            .map((c) => c.id);
          setSelectedClipIds(ids);
        }}
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
        onOpenAudioEditor={(audioClip, arrClip) => setAudioEditorState({ audioClip, arrClip })}
      />

      <AudioClipEditorModal
        open={Boolean(audioEditorState)}
        audioClip={audioEditorState?.audioClip ?? null}
        arrClip={audioEditorState?.arrClip ?? null}
        onClose={() => setAudioEditorState(null)}
      />

      <ContextMenu
        open={Boolean(laneMenu)}
        x={laneMenu?.x ?? 0}
        y={laneMenu?.y ?? 0}
        title={laneMenu ? `${laneMenu.track.name} · Bar ${Math.floor(laneMenu.beat / beatsPerBar) + 1}` : 'Insert Clip'}
        subtitle={laneMenu ? `Beat ${laneMenu.beat + 1}` : undefined}
        onClose={() => setLaneMenu(null)}
        items={
          laneMenu
            ? [
                {
                  id: 'lane-insert-midi-1',
                  label: 'Insert MIDI Clip (1 Bar)',
                  icon: <FilePlus className="w-3.5 h-3.5 text-indigo-400" />,
                  onSelect: () => {
                    handleInsertMidiClip(laneMenu.track.id, laneMenu.beat, beatsPerBar, false);
                    setLaneMenu(null);
                  },
                },
                {
                  id: 'lane-insert-midi-edit',
                  label: 'Insert MIDI Clip & Open Piano Roll',
                  icon: <Piano className="w-3.5 h-3.5 text-emerald-400" />,
                  onSelect: () => {
                    handleInsertMidiClip(laneMenu.track.id, laneMenu.beat, beatsPerBar, true);
                    setLaneMenu(null);
                  },
                },
                {
                  id: 'lane-insert-midi-2',
                  label: 'Insert 2-Bar MIDI Clip',
                  icon: <FilePlus className="w-3.5 h-3.5 text-violet-400" />,
                  onSelect: () => {
                    handleInsertMidiClip(laneMenu.track.id, laneMenu.beat, beatsPerBar * 2, false);
                    setLaneMenu(null);
                  },
                },
                {
                  id: 'lane-insert-midi-4',
                  label: 'Insert 4-Bar MIDI Clip',
                  icon: <FilePlus className="w-3.5 h-3.5 text-amber-400" />,
                  onSelect: () => {
                    handleInsertMidiClip(laneMenu.track.id, laneMenu.beat, beatsPerBar * 4, false);
                    setLaneMenu(null);
                  },
                },
                {
                  id: 'lane-insert-audio',
                  dividerBefore: true,
                  label: 'Insert Audio Clip...',
                  icon: <FileAudio className="w-3.5 h-3.5 text-sky-400" />,
                  onSelect: () => {
                    insertAudioTrackRef.current = laneMenu.track.id;
                    setLaneMenu(null);
                    insertAudioInputRef.current?.click();
                  },
                },
              ]
            : []
        }
      />
    </div>
  );
};
