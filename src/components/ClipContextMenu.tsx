import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Edit3,
  Layers,
  Maximize2,
  Music,
  Repeat,
  RotateCcw,
  Scissors,
  Sliders,
  Trash2,
  Wand2,
} from 'lucide-react';
import { ArrangementClip, AudioClipMeta, MidiClip } from '../types/daw';
import { dawController } from '../audio/dawController';
import { ContextMenu, ContextMenuActionItem } from './ContextMenu';

export type ClipContextTarget =
  | {
      source: 'arrangement';
      arrClip: ArrangementClip;
      midiClip?: MidiClip;
      audioClip?: AudioClipMeta;
    }
  | {
      source: 'session';
      trackId: string;
      sceneIndex: number;
      clipId: string;
      midiClip?: MidiClip;
      audioClip?: AudioClipMeta;
    };

interface ClipContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  target: ClipContextTarget | null;
  onClose: () => void;
  onOpenMidiEditor: (clipId: string, trackId: string) => void;
  onOpenAudioEditor: (audioClip: AudioClipMeta, arrClip?: ArrangementClip) => void;
}

export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({
  open,
  x,
  y,
  target,
  onClose,
  onOpenMidiEditor,
  onOpenAudioEditor,
}) => {
  const [subPanel, setSubPanel] = useState<'none' | 'rename' | 'transpose' | 'color' | 'length'>('none');
  const [nameInput, setNameInput] = useState('');

  const clipName = target
    ? target.source === 'arrangement'
      ? target.arrClip.name
      : target.midiClip?.name ?? target.audioClip?.name ?? 'Clip'
    : '';

  useEffect(() => {
    if (open) {
      setSubPanel('none');
      setNameInput(clipName);
    }
  }, [open, clipName]);

  if (!open || !target) return null;

  const isMidi = Boolean(target.midiClip) || (target.source === 'arrangement' && target.arrClip.kind === 'midi');
  const sourceClipId =
    target.source === 'arrangement' ? target.arrClip.sourceClipId : target.clipId;
  const trackId =
    target.source === 'arrangement' ? target.arrClip.trackId : target.trackId;
  const arrClip = target.source === 'arrangement' ? target.arrClip : undefined;

  const customBody =
    subPanel === 'rename' ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">Rename Clip</span>
        <input
          autoFocus
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nameInput.trim()) {
              dawController.renameClip(nameInput.trim(), sourceClipId, arrClip?.id);
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
              if (nameInput.trim()) {
                dawController.renameClip(nameInput.trim(), sourceClipId, arrClip?.id);
                onClose();
              }
            }}
            className="h-7 px-2.5 rounded bg-[#6D5DFB] text-[11px] font-semibold text-white flex items-center gap-1"
          >
            <Check className="w-3 h-3" /> Apply
          </button>
        </div>
      </div>
    ) : subPanel === 'color' ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">Clip Color</span>
        <div className="grid grid-cols-4 gap-1.5">
          {['#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'].map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => {
                dawController.setClipColor(sourceClipId, hex, arrClip?.id);
                onClose();
              }}
              style={{ backgroundColor: hex }}
              className="h-7 rounded hover:opacity-90 ring-1 ring-white/20"
            />
          ))}
        </div>
      </div>
    ) : subPanel === 'length' && arrClip ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">Clip Length (Beats)</span>
        <div className="grid grid-cols-4 gap-1">
          {[4, 8, 16, 32].map((beats) => (
            <button
              key={beats}
              type="button"
              onClick={() => {
                dawController.resizeArrangementClip(arrClip.id, beats);
                onClose();
              }}
              className="h-8 rounded bg-[#222632] hover:bg-[#6D5DFB] text-xs font-mono-tabular font-semibold text-zinc-100"
            >
              {beats / 4} Bar{beats > 4 ? 's' : ''}
            </button>
          ))}
        </div>
      </div>
    ) : subPanel === 'transpose' && isMidi ? (
      <div className="p-2 mb-1 rounded-lg bg-[#101218] border border-white/[0.1] flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase text-zinc-400">Transpose MIDI</span>
        <div className="grid grid-cols-4 gap-1">
          {[-12, -1, 1, 12].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                dawController.transposeMidiClip(sourceClipId, st);
                onClose();
              }}
              className="h-8 rounded bg-[#222632] hover:bg-[#6D5DFB] text-xs font-mono-tabular font-semibold text-zinc-100"
            >
              {st > 0 ? `+${st}` : st}
            </button>
          ))}
        </div>
      </div>
    ) : undefined;

  const items: ContextMenuActionItem[] = isMidi
    ? [
        {
          id: 'open-midi-editor',
          sectionLabel: 'MIDI Clip',
          label: 'Open MIDI Editor',
          icon: <Edit3 className="w-3.5 h-3.5 text-indigo-400" />,
          onSelect: () => {
            onOpenMidiEditor(sourceClipId, trackId);
            onClose();
          },
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: <Copy className="w-3.5 h-3.5" />,
          onSelect: () => {
            if (target.source === 'arrangement') {
              dawController.duplicateArrangementClip(target.arrClip.id);
            } else {
              dawController.duplicateSessionClip(target.trackId, target.sceneIndex);
            }
            onClose();
          },
        },
        {
          id: 'rename',
          label: 'Rename',
          icon: <Edit3 className="w-3.5 h-3.5" />,
          onSelect: () => {
            setNameInput(clipName);
            setSubPanel('rename');
          },
        },
        {
          id: 'quantize',
          dividerBefore: true,
          label: 'Quantize (1/16)',
          icon: <Wand2 className="w-3.5 h-3.5 text-violet-400" />,
          onSelect: () => {
            dawController.quantizeMidiClip(sourceClipId, '1/16');
            onClose();
          },
        },
        {
          id: 'transpose',
          label: 'Transpose...',
          icon: <Music className="w-3.5 h-3.5 text-emerald-400" />,
          onSelect: () => setSubPanel(subPanel === 'transpose' ? 'none' : 'transpose'),
        },
        ...(target.source === 'arrangement'
          ? [
              {
                id: 'copy',
                label: 'Copy',
                icon: <Copy className="w-3.5 h-3.5" />,
                onSelect: () => {
                  dawController.copyArrangementClip(target.arrClip.id);
                  onClose();
                },
              },
              {
                id: 'cut',
                label: 'Cut',
                icon: <Scissors className="w-3.5 h-3.5" />,
                onSelect: () => {
                  dawController.cutArrangementClip(target.arrClip.id);
                  onClose();
                },
              },
              {
                id: 'paste',
                label: 'Paste',
                icon: <Layers className="w-3.5 h-3.5" />,
                onSelect: () => {
                  dawController.pasteArrangementClip(trackId, target.arrClip.startBeat + target.arrClip.lengthBeats);
                  onClose();
                },
              },
              {
                id: 'color',
                label: 'Color...',
                icon: <span className="w-3 h-3 rounded-xs inline-block" style={{ backgroundColor: target.arrClip.color }} />,
                onSelect: () => setSubPanel(subPanel === 'color' ? 'none' : 'color'),
              },
              {
                id: 'length',
                label: 'Resize / Length...',
                icon: <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />,
                onSelect: () => setSubPanel(subPanel === 'length' ? 'none' : 'length'),
              },
              {
                id: 'loop',
                label: target.arrClip.looped === false ? 'Enable Loop' : 'Disable Loop',
                icon: <Repeat className="w-3.5 h-3.5 text-sky-400" />,
                active: target.arrClip.looped !== false,
                onSelect: () => {
                  dawController.toggleArrangementClipLoop(target.arrClip.id);
                  onClose();
                },
              },
              {
                id: 'consolidate',
                label: 'Consolidate',
                icon: <Layers className="w-3.5 h-3.5" />,
                onSelect: () => {
                  dawController.consolidateTrackClips(trackId);
                  onClose();
                },
              },
            ]
          : []),
        {
          id: 'export-midi',
          dividerBefore: true,
          label: 'Export MIDI (.mid)',
          icon: <Download className="w-3.5 h-3.5 text-amber-400" />,
          onSelect: () => {
            dawController.exportMidiClip(sourceClipId);
            onClose();
          },
        },
        {
          id: 'delete',
          dividerBefore: true,
          label: 'Delete',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          onSelect: () => {
            if (target.source === 'arrangement') {
              dawController.deleteArrangementClip(target.arrClip.id);
            } else {
              dawController.deleteSessionClip(target.trackId, target.sceneIndex);
            }
            onClose();
          },
        },
      ]
    : [
        ...(target.audioClip
          ? [
              {
                id: 'open-audio-editor',
                sectionLabel: 'Audio Clip',
                label: 'Open Audio Editor',
                icon: <Sliders className="w-3.5 h-3.5 text-sky-400" />,
                onSelect: () => {
                  if (target.audioClip) {
                    onOpenAudioEditor(target.audioClip, arrClip);
                  }
                  onClose();
                },
              },
            ]
          : []),
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: <Copy className="w-3.5 h-3.5" />,
          onSelect: () => {
            if (target.source === 'arrangement') {
              dawController.duplicateArrangementClip(target.arrClip.id);
            } else {
              dawController.duplicateSessionClip(target.trackId, target.sceneIndex);
            }
            onClose();
          },
        },
        {
          id: 'rename',
          label: 'Rename',
          icon: <Edit3 className="w-3.5 h-3.5" />,
          onSelect: () => {
            setNameInput(clipName);
            setSubPanel('rename');
          },
        },
        {
          id: 'reverse',
          dividerBefore: true,
          label: 'Reverse',
          icon: <RotateCcw className="w-3.5 h-3.5 text-amber-400" />,
          onSelect: () => {
            void dawController.reverseAudioClip(sourceClipId);
            onClose();
          },
        },
        {
          id: 'normalize',
          label: 'Normalize',
          icon: <Maximize2 className="w-3.5 h-3.5 text-sky-400" />,
          onSelect: () => {
            void dawController.normalizeAudioClip(sourceClipId);
            onClose();
          },
        },
        ...(target.source === 'arrangement'
          ? [
              {
                id: 'crop',
                label: 'Crop',
                icon: <Scissors className="w-3.5 h-3.5 text-indigo-400" />,
                onSelect: () => {
                  void dawController.cropAudioClip(target.arrClip.id);
                  onClose();
                },
              },
              {
                id: 'consolidate',
                label: 'Consolidate',
                icon: <Layers className="w-3.5 h-3.5" />,
                onSelect: () => {
                  dawController.consolidateTrackClips(trackId);
                  onClose();
                },
              },
            ]
          : []),
        {
          id: 'export-audio',
          dividerBefore: true,
          label: 'Export Audio (.wav)',
          icon: <Download className="w-3.5 h-3.5 text-emerald-400" />,
          onSelect: () => {
            dawController.exportAudioClipWav(sourceClipId);
            onClose();
          },
        },
        {
          id: 'delete',
          dividerBefore: true,
          label: 'Delete',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          onSelect: () => {
            if (target.source === 'arrangement') {
              dawController.deleteArrangementClip(target.arrClip.id);
            } else {
              dawController.deleteSessionClip(target.trackId, target.sceneIndex);
            }
            onClose();
          },
        },
      ];

  return (
    <ContextMenu
      open={open}
      x={x}
      y={y}
      title={clipName}
      subtitle={isMidi ? 'MIDI Clip Options' : 'Audio Clip Options'}
      customBody={customBody}
      items={items}
      onClose={onClose}
    />
  );
};
