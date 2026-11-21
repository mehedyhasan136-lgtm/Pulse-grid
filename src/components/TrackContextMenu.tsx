import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileAudio,
  FilePlus,
  Folder,
  FolderMinus,
  FolderPlus,
  Layers,
  Library,
  Music,
  Palette,
  Piano,
  Plus,
  Save,
  Snowflake,
  Sparkles,
  Trash2,
  Ungroup,
  Wand2,
} from 'lucide-react';
import { TrackModel } from '../types/daw';
import { getTrackInstrumentDisplayName, TRACK_COLORS } from '../data/presets';
import { dawController, orderTracksHierarchically } from '../audio/dawController';
import { ContextMenu, ContextMenuActionItem } from './ContextMenu';

interface TrackContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  track: TrackModel | null;
  allTracks: TrackModel[];
  selectedTrackIds: string[];
  onClose: () => void;
  onSelectAllClips?: (trackId: string) => void;
  onTriggerAudioFileInsert?: (trackId: string) => void;
  onOpenInstrumentPicker?: (trackId: string) => void;
}

type SubPanel = 'none' | 'rename' | 'color' | 'moveGroup' | 'savePreset';

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  open,
  x,
  y,
  track,
  allTracks,
  selectedTrackIds,
  onClose,
  onSelectAllClips,
  onTriggerAudioFileInsert,
  onOpenInstrumentPicker,
}) => {
  const [subPanel, setSubPanel] = useState<SubPanel>('none');
  const [textInput, setTextInput] = useState('');

  useEffect(() => {
    if (open) {
      setSubPanel('none');
      setTextInput(track?.name ?? '');
    }
  }, [open, track?.id, track?.name]);

  if (!open || !track) return null;

  const isGroup = Boolean(track.isGroupFolder);
  const groupFolders = allTracks.filter((t) => t.isGroupFolder);
  const groupChildren = isGroup
    ? allTracks.filter((t) => !t.isGroupFolder && t.groupId === track.id)
    : [];

  // Build hierarchical top-level blocks and sibling slices to compute accurate move up/down states
  const ordered = orderTracksHierarchically(allTracks);
  const topBlocks: TrackModel[][] = [];
  const seen = new Set<string>();
  for (const tr of ordered) {
    if (seen.has(tr.id)) continue;
    if (tr.isGroupFolder) {
      const kids = ordered.filter((c) => !c.isGroupFolder && c.groupId === tr.id);
      const blk = [tr, ...kids];
      blk.forEach((b) => seen.add(b.id));
      topBlocks.push(blk);
    } else if (!tr.groupId) {
      seen.add(tr.id);
      topBlocks.push([tr]);
    }
  }

  let canMoveUp = false;
  let canMoveDown = false;
  if (isGroup || !track.groupId) {
    const bIdx = topBlocks.findIndex((blk) => blk[0].id === track.id);
    canMoveUp = bIdx > 0;
    canMoveDown = bIdx !== -1 && bIdx < topBlocks.length - 1;
  } else {
    const siblings = ordered.filter((c) => !c.isGroupFolder && c.groupId === track.groupId);
    const sIdx = siblings.findIndex((c) => c.id === track.id);
    canMoveUp = sIdx > 0;
    canMoveDown = sIdx !== -1 && sIdx < siblings.length - 1;
  }

  const multiIds = selectedTrackIds.includes(track.id) ? selectedTrackIds : [track.id];
  const nonGroupTargets = multiIds.filter(
    (id) => !allTracks.find((t) => t.id === id)?.isGroupFolder
  );

  const customBody =
    subPanel === 'rename' ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">
          {isGroup ? 'Rename Group' : 'Rename Track'}
        </span>
        <input
          autoFocus
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && textInput.trim()) {
              dawController.renameTrack(track.id, textInput.trim());
              onClose();
            }
          }}
          className="h-8 px-2 rounded bg-[#181B24] border border-white/[0.12] text-xs text-white focus:outline-none focus:border-[#6D5DFB]"
        />
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setSubPanel('none')}
            className="h-7 px-2.5 rounded bg-[#222632] text-[11px] text-zinc-300"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (textInput.trim()) {
                dawController.renameTrack(track.id, textInput.trim());
                onClose();
              }
            }}
            className="h-7 px-2.5 rounded bg-[#6D5DFB] text-[11px] font-semibold text-white flex items-center gap-1"
          >
            <Check className="w-3 h-3" /> Save
          </button>
        </div>
      </div>
    ) : subPanel === 'color' ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">
          {isGroup ? 'Group Color' : 'Track Color'}
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {TRACK_COLORS.map((col) => (
            <button
              key={col}
              type="button"
              onClick={() => {
                dawController.setTrackColor(track.id, col);
                onClose();
              }}
              style={{ backgroundColor: col }}
              aria-label={`Set color ${col}`}
              className={`h-7 rounded border ${
                track.color === col ? 'border-white ring-2 ring-white/50' : 'border-black/40'
              }`}
            />
          ))}
        </div>
      </div>
    ) : subPanel === 'moveGroup' ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase text-zinc-400 pb-0.5">
          {nonGroupTargets.length > 1
            ? `Move ${nonGroupTargets.length} Tracks to Group`
            : 'Move Track to Group'}
        </span>
        <button
          type="button"
          onClick={() => {
            const targets = nonGroupTargets.length > 0 ? nonGroupTargets : [track.id];
            for (const tid of targets) {
              dawController.setTrackGroupId(tid, undefined);
            }
            onClose();
          }}
          className={`px-2 py-1.5 rounded text-left text-xs ${
            !track.groupId ? 'bg-[#6D5DFB]/25 text-indigo-200' : 'text-zinc-300 hover:bg-[#1E222D]'
          }`}
        >
          {track.groupId ? 'Remove from Group (Top Level)' : 'None (Top Level)'}
        </button>
        {groupFolders.map((grp) => (
          <button
            key={grp.id}
            type="button"
            onClick={() => {
              const targets = nonGroupTargets.length > 0 ? nonGroupTargets : [track.id];
              for (const tid of targets) {
                dawController.setTrackGroupId(tid, grp.id);
              }
              onClose();
            }}
            className={`px-2 py-1.5 rounded text-left text-xs flex items-center gap-1.5 ${
              track.groupId === grp.id
                ? 'bg-[#6D5DFB]/25 text-indigo-200'
                : 'text-zinc-300 hover:bg-[#1E222D]'
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-xs shrink-0"
              style={{ backgroundColor: grp.color }}
            />
            <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate">{grp.name}</span>
          </button>
        ))}
      </div>
    ) : subPanel === 'savePreset' ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">
          {isGroup ? 'Save Group Preset' : 'Save Track Preset'}
        </span>
        <input
          autoFocus
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="Preset name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              dawController.saveTrackPreset(track.id, textInput);
              onClose();
            }
          }}
          className="h-8 px-2 rounded bg-[#181B24] border border-white/[0.12] text-xs text-white focus:outline-none focus:border-[#6D5DFB]"
        />
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setSubPanel('none')}
            className="h-7 px-2.5 rounded bg-[#222632] text-[11px] text-zinc-300"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              dawController.saveTrackPreset(track.id, textInput);
              onClose();
            }}
            className="h-7 px-2.5 rounded bg-[#6D5DFB] text-[11px] font-semibold text-white flex items-center gap-1"
          >
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      </div>
    ) : undefined;

  const groupDeleteBlocked = allTracks.length - (1 + groupChildren.length) < 1;

  const groupItems: ContextMenuActionItem[] = [
    {
      id: 'rename-group',
      sectionLabel: 'Group Management',
      label: 'Rename Group',
      icon: <Edit3 className="w-3.5 h-3.5" />,
      onSelect: () => {
        setTextInput(track.name);
        setSubPanel('rename');
      },
    },
    {
      id: 'color-group',
      label: 'Change Group Color',
      icon: <Palette className="w-3.5 h-3.5" />,
      onSelect: () => setSubPanel(subPanel === 'color' ? 'none' : 'color'),
    },
    {
      id: 'collapse-expand-group',
      label: track.collapsed ? 'Expand Group' : 'Collapse Group',
      icon: track.collapsed ? (
        <ChevronRight className="w-3.5 h-3.5 text-indigo-400" />
      ) : (
        <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
      ),
      onSelect: () => {
        dawController.toggleTrackGroupCollapse(track.id);
        onClose();
      },
    },
    {
      id: 'ungroup-group',
      label: 'Ungroup',
      icon: <Ungroup className="w-3.5 h-3.5 text-amber-400" />,
      onSelect: () => {
        dawController.ungroupTracks([track.id]);
        onClose();
      },
    },
    {
      id: 'duplicate-group',
      label: 'Duplicate Group',
      icon: <Copy className="w-3.5 h-3.5" />,
      onSelect: () => {
        dawController.duplicateGroup(track.id);
        onClose();
      },
    },
    {
      id: 'delete-group',
      label: 'Delete Group',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      disabled: groupDeleteBlocked,
      onSelect: () => {
        dawController.deleteTracks([track.id]);
        onClose();
      },
    },

    // Creation inside Group
    {
      id: 'add-midi-in-group',
      dividerBefore: true,
      sectionLabel: 'Add to Group',
      label: 'Add MIDI Track to Group',
      icon: <Plus className="w-3.5 h-3.5 text-indigo-400" />,
      onSelect: () => {
        dawController.addTrack('midi', undefined, track.id);
        onClose();
      },
    },
    {
      id: 'add-audio-in-group',
      label: 'Add Audio Track to Group',
      icon: <FileAudio className="w-3.5 h-3.5 text-sky-400" />,
      onSelect: () => {
        dawController.addTrack('audio', undefined, track.id);
        onClose();
      },
    },
    {
      id: 'add-piano-in-group',
      label: 'Add Instrument Track (Piano)',
      icon: <Piano className="w-3.5 h-3.5 text-violet-400" />,
      onSelect: () => {
        dawController.addTrack('midi', undefined, track.id, 'gesturePiano');
        onClose();
      },
    },

    // Group Audio Operations
    {
      id: 'freeze-unfreeze-group',
      dividerBefore: true,
      sectionLabel: 'Group Audio',
      label: track.frozen ? 'Unfreeze Group' : 'Freeze Group',
      icon: <Snowflake className="w-3.5 h-3.5 text-cyan-400" />,
      disabled: !track.frozen && groupChildren.length === 0,
      onSelect: () => {
        if (track.frozen) {
          dawController.unfreezeGroup(track.id);
        } else {
          void dawController.freezeGroup(track.id);
        }
        onClose();
      },
    },
    {
      id: 'bounce-group',
      label: 'Bounce Group to Audio',
      icon: <Music className="w-3.5 h-3.5 text-emerald-400" />,
      disabled: groupChildren.length === 0,
      onSelect: () => {
        void dawController.bounceGroupToAudio(track.id);
        onClose();
      },
    },
    {
      id: 'export-group-wav',
      label: 'Export Group Audio (.wav)',
      icon: <Download className="w-3.5 h-3.5 text-sky-400" />,
      disabled: groupChildren.length === 0,
      onSelect: () => {
        void dawController.exportGroupAudioWav(track.id);
        onClose();
      },
    },

    // Order & Presets
    {
      id: 'move-group-up',
      dividerBefore: true,
      sectionLabel: 'Order & Presets',
      label: 'Move Group Up',
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      disabled: !canMoveUp,
      onSelect: () => {
        dawController.moveTrack(track.id, -1);
        onClose();
      },
    },
    {
      id: 'move-group-down',
      label: 'Move Group Down',
      icon: <ArrowDown className="w-3.5 h-3.5" />,
      disabled: !canMoveDown,
      onSelect: () => {
        dawController.moveTrack(track.id, 1);
        onClose();
      },
    },
    {
      id: 'save-group-preset',
      label: 'Save Group Bus Preset',
      icon: <Save className="w-3.5 h-3.5 text-emerald-400" />,
      onSelect: () => {
        setTextInput(`${track.name} Bus Preset`);
        setSubPanel('savePreset');
      },
    },
  ];

  const regularItems: ContextMenuActionItem[] = [
    ...(onOpenInstrumentPicker && track.type === 'midi'
      ? [
          {
            id: 'change-instrument',
            sectionLabel: 'Instrument & Sound',
            label: 'Change Instrument...',
            icon: <Library className="w-3.5 h-3.5 text-[#8B5CF6]" />,
            onSelect: () => {
              onClose();
              onOpenInstrumentPicker(track.id);
            },
          },
        ]
      : []),
    {
      id: 'rename',
      dividerBefore: Boolean(onOpenInstrumentPicker && track.type === 'midi'),
      sectionLabel: 'Track Management',
      label: 'Rename Track',
      icon: <Edit3 className="w-3.5 h-3.5" />,
      onSelect: () => {
        setTextInput(track.name);
        setSubPanel('rename');
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate Track',
      icon: <Copy className="w-3.5 h-3.5" />,
      onSelect: () => {
        dawController.duplicateTrack(track.id);
        onClose();
      },
    },
    {
      id: 'color',
      label: 'Change Track Color',
      icon: <Palette className="w-3.5 h-3.5" />,
      onSelect: () => setSubPanel(subPanel === 'color' ? 'none' : 'color'),
    },
    {
      id: 'toggle-select',
      label: selectedTrackIds.includes(track.id) ? 'Toggle Multi-Select' : 'Add to Selection',
      icon: <Layers className="w-3.5 h-3.5 text-indigo-400" />,
      active: selectedTrackIds.length > 1 && selectedTrackIds.includes(track.id),
      onSelect: () => {
        dawController.selectTrack(track.id, 'toggle');
        onClose();
      },
    },
    ...(nonGroupTargets.length >= 1
      ? [
          {
            id: 'group',
            label:
              nonGroupTargets.length > 1
                ? `Group ${nonGroupTargets.length} Selected Tracks`
                : 'Group Track',
            icon: <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />,
            onSelect: () => {
              dawController.groupTracks(nonGroupTargets);
              onClose();
            },
          },
        ]
      : []),
    ...(track.groupId
      ? [
          {
            id: 'ungroup',
            label: 'Remove from Group',
            icon: <Ungroup className="w-3.5 h-3.5 text-amber-400" />,
            onSelect: () => {
              const targets = nonGroupTargets.length > 0 ? nonGroupTargets : [track.id];
              dawController.ungroupTracks(targets);
              onClose();
            },
          },
        ]
      : []),
    {
      id: 'delete',
      label: multiIds.length > 1 ? `Delete ${multiIds.length} Tracks` : 'Delete Track',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      disabled: allTracks.length <= multiIds.length,
      onSelect: () => {
        dawController.deleteTracks(multiIds);
        onClose();
      },
    },

    // Creation
    {
      id: 'add-midi',
      dividerBefore: true,
      sectionLabel: 'Creation',
      label: 'Add MIDI Track',
      icon: <Plus className="w-3.5 h-3.5 text-indigo-400" />,
      onSelect: () => {
        dawController.addTrack('midi', undefined, track.groupId);
        onClose();
      },
    },
    {
      id: 'add-audio',
      label: 'Add Audio Track',
      icon: <FileAudio className="w-3.5 h-3.5 text-sky-400" />,
      onSelect: () => {
        dawController.addTrack('audio', undefined, track.groupId);
        onClose();
      },
    },
    {
      id: 'add-instrument',
      label: 'Add Instrument Track (Piano)',
      icon: <Piano className="w-3.5 h-3.5 text-violet-400" />,
      onSelect: () => {
        dawController.addTrack('midi', undefined, track.groupId, 'gesturePiano');
        onClose();
      },
    },
    {
      id: 'add-group',
      label: 'Add Group Track',
      icon: <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />,
      onSelect: () => {
        dawController.addTrackGroup(undefined, undefined, true);
        onClose();
      },
    },

    // Audio Operations
    {
      id: 'freeze-unfreeze',
      dividerBefore: true,
      sectionLabel: 'Audio Operations',
      label: track.frozen ? 'Unfreeze Track' : 'Freeze Track',
      icon: <Snowflake className="w-3.5 h-3.5 text-cyan-400" />,
      onSelect: () => {
        if (track.frozen) {
          dawController.unfreezeTrack(track.id);
        } else {
          void dawController.freezeTrack(track.id);
        }
        onClose();
      },
    },
    ...(track.frozen
      ? [
          {
            id: 'flatten',
            label: 'Flatten Track to Audio',
            icon: <Sparkles className="w-3.5 h-3.5 text-amber-300" />,
            onSelect: () => {
              dawController.flattenTrack(track.id);
              onClose();
            },
          },
        ]
      : []),
    {
      id: 'bounce',
      label: 'Bounce in Place',
      icon: <Music className="w-3.5 h-3.5 text-emerald-400" />,
      onSelect: () => {
        void dawController.bounceTrackInPlace(track.id);
        onClose();
      },
    },
    {
      id: 'export-wav',
      label: 'Export Track Audio (.wav)',
      icon: <Download className="w-3.5 h-3.5 text-sky-400" />,
      onSelect: () => {
        void dawController.exportTrackAudioWav(track.id);
        onClose();
      },
    },

    // Editing
    {
      id: 'insert-midi',
      dividerBefore: true,
      sectionLabel: 'Editing',
      label: 'Insert MIDI Clip',
      icon: <FilePlus className="w-3.5 h-3.5 text-indigo-400" />,
      onSelect: () => {
        dawController.insertMidiClipOnTrack(track.id);
        onClose();
      },
    },
    ...(onTriggerAudioFileInsert
      ? [
          {
            id: 'insert-audio',
            label: 'Insert Audio Clip...',
            icon: <FileAudio className="w-3.5 h-3.5 text-sky-400" />,
            onSelect: () => {
              onClose();
              onTriggerAudioFileInsert(track.id);
            },
          },
        ]
      : []),
    {
      id: 'dup-content',
      label: 'Duplicate Track Content',
      icon: <Copy className="w-3.5 h-3.5" />,
      onSelect: () => {
        dawController.duplicateTrackContent(track.id);
        onClose();
      },
    },
    {
      id: 'consolidate',
      label: 'Consolidate Clips',
      icon: <Layers className="w-3.5 h-3.5" />,
      onSelect: () => {
        dawController.consolidateTrackClips(track.id);
        onClose();
      },
    },
    ...(onSelectAllClips
      ? [
          {
            id: 'select-all-clips',
            label: 'Select All Clips',
            icon: <Check className="w-3.5 h-3.5" />,
            onSelect: () => {
              onSelectAllClips(track.id);
              onClose();
            },
          },
        ]
      : []),
    {
      id: 'quantize-midi',
      label: 'Quantize MIDI (1/16)',
      icon: <Wand2 className="w-3.5 h-3.5 text-violet-400" />,
      onSelect: () => {
        dawController.quantizeTrackMidi(track.id, '1/16');
        onClose();
      },
    },

    // Additional
    {
      id: 'move-up',
      dividerBefore: true,
      sectionLabel: 'Order & Presets',
      label: 'Move Track Up',
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      disabled: !canMoveUp,
      onSelect: () => {
        dawController.moveTrack(track.id, -1);
        onClose();
      },
    },
    {
      id: 'move-down',
      label: 'Move Track Down',
      icon: <ArrowDown className="w-3.5 h-3.5" />,
      disabled: !canMoveDown,
      onSelect: () => {
        dawController.moveTrack(track.id, 1);
        onClose();
      },
    },
    {
      id: 'move-to-group',
      label: 'Move to Group',
      icon: <FolderMinus className="w-3.5 h-3.5 text-indigo-400" />,
      disabled: groupFolders.length === 0 && !track.groupId,
      onSelect: () => setSubPanel(subPanel === 'moveGroup' ? 'none' : 'moveGroup'),
    },
    {
      id: 'save-preset',
      label: 'Save Track Preset',
      icon: <Save className="w-3.5 h-3.5 text-emerald-400" />,
      onSelect: () => {
        setTextInput(`${track.name} Preset`);
        setSubPanel('savePreset');
      },
    },
  ];

  const items = isGroup ? groupItems : regularItems;
  const subtitle = isGroup
    ? `Group Bus · ${groupChildren.length} track${groupChildren.length === 1 ? '' : 's'}${
        track.collapsed ? ' · Collapsed' : ''
      }${track.frozen ? ' · Frozen' : ''}`
    : `${track.type.toUpperCase()} · ${getTrackInstrumentDisplayName(track)}${
        track.frozen ? ' · Frozen' : ''
      }${multiIds.length > 1 ? ` · ${multiIds.length} selected` : ''}`;

  return (
    <ContextMenu
      open={open}
      x={x}
      y={y}
      title={track.name}
      subtitle={subtitle}
      customBody={customBody}
      items={items}
      onClose={onClose}
    />
  );
};
