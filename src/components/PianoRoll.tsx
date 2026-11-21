import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Wand2,
  ZoomIn,
  ZoomOut,
  Eye,
  Magnet,
} from 'lucide-react';
import { ArrangementClip, GridResolution, MidiClip, MidiNote, TrackModel } from '../types/daw';
import { DRUM_MIDI_MAP, midiToNoteName } from '../data/presets';
import { gridResolutionToBeats } from '../audio/dawController';
import { SessionTrackRuntime } from '../audio/sessionEngine';
import { computeClipPlayheadState, mapLocalBeatToGlobalBeat } from '../audio/playheadUtils';
import { SCALE_NAMES, ROOT_NOTES, isPitchInScale, snapPitchToScale } from '../audio/scaleUtils';

interface PianoRollProps {
  clip: MidiClip | null;
  track: TrackModel | null;
  allMidiClips?: MidiClip[];
  currentBeat?: number;
  isPlaying?: boolean;
  playbackMode?: 'session' | 'arrangement';
  bpm?: number;
  timeSignature?: [number, number];
  loopEnabled?: boolean;
  loopStartBeat?: number;
  loopEndBeat?: number;
  arrangementClips?: ArrangementClip[];
  sessionRuntime?: SessionTrackRuntime | null;
  onSeekBeat?: (beat: number) => void;
  onSelectClip?: (clipId: string) => void;
  onAddNote: (clipId: string, note: Omit<MidiNote, 'id'>) => void;
  onUpdateNote: (clipId: string, noteId: string, patch: Partial<MidiNote>, recordHistory?: boolean) => void;
  onDeleteNote: (clipId: string, noteId: string) => void;
  onQuantizeClip: (clipId: string, grid: GridResolution) => void;
  onSetClipLength: (clipId: string, lengthBeats: number) => void;
  onAuditionNote: (trackId: string, pitch: number, velocity?: number) => void;
}

const NOTE_LENGTH_OPTIONS = [
  { label: '1 bar', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16T', beats: 1 / 6 },
];

const GRID_OPTIONS: GridResolution[] = ['1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'];

function isBlackKey(midi: number): boolean {
  const n = ((midi % 12) + 12) % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

export const PianoRoll: React.FC<PianoRollProps> = ({
  clip,
  track,
  allMidiClips,
  currentBeat = 0,
  isPlaying = false,
  playbackMode = 'session',
  bpm = 120,
  timeSignature = [4, 4],
  loopEnabled = false,
  loopStartBeat = 0,
  loopEndBeat = 16,
  arrangementClips = [],
  sessionRuntime = null,
  onSeekBeat,
  onSelectClip,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onQuantizeClip,
  onAuditionNote,
}) => {
  const [grid, setGrid] = useState<GridResolution>('1/16');
  const [gridSnap, setGridSnap] = useState<boolean>(true);
  const [defaultNoteLength, setDefaultNoteLength] = useState<number>(0.25); // default 1/16 bar
  const [scaleHighlight, setScaleHighlight] = useState<boolean>(true);
  const [scaleSnap, setScaleSnap] = useState<boolean>(true);
  const [scaleName, setScaleName] = useState<string>('Major');
  const [rootNoteVal, setRootNoteVal] = useState<number>(0); // C = 0

  const [defaultVelocity, setDefaultVelocity] = useState(100);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [pxPerBeat, setPxPerBeat] = useState(64);
  const [rowHeight] = useState(24);
  const [velocityLaneOpen, setVelocityLaneOpen] = useState(false);
  const [expressionTab, setExpressionTab] = useState<'none' | 'slide' | 'mpe'>('none');
  const [scrubBeatLabel, setScrubBeatLabel] = useState<string | null>(null);

  const lastClickTimeRef = useRef(0);
  const lastClickNoteIdRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rulerBarRef = useRef<HTMLDivElement | null>(null);
  const rulerPlayheadRef = useRef<HTMLDivElement | null>(null);
  const gridPlayheadRef = useRef<HTMLDivElement | null>(null);
  const velPlayheadRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingPlayheadRef = useRef(false);
  const manualScrollAtRef = useRef(0);

  const isDrumTrack = track?.instrument.type === 'drumSynth';

  const rows = useMemo(() => {
    if (isDrumTrack) {
      return DRUM_MIDI_MAP.map((d) => ({
        pitch: d.pitch,
        label: d.label,
        dark: false,
        inScale: true,
      }));
    }
    const list: Array<{ pitch: number; label: string; dark: boolean; inScale: boolean }> = [];
    const minPitch = 36; // C2
    const maxPitch = 84; // C6
    for (let p = maxPitch; p >= minPitch; p--) {
      list.push({
        pitch: p,
        label: midiToNoteName(p),
        dark: isBlackKey(p),
        inScale: isPitchInScale(p, rootNoteVal, scaleName),
      });
    }
    return list;
  }, [isDrumTrack, rootNoteVal, scaleName]);

  const beatsPerBar = Math.max(1, timeSignature?.[0] || 4);
  const clipLengthBeats = Math.max(0.25, clip?.lengthBeats ?? 4);
  const gridBeats = gridResolutionToBeats(grid);
  const gridWidth = Math.max(400, clipLengthBeats * pxPerBeat);

  const playheadState = useMemo(() => {
    if (!clip) {
      return {
        localBeat: 0,
        inClipRange: true,
        activeArrClip: null,
        loopStartLocal: null,
        loopEndLocal: null,
      };
    }
    return computeClipPlayheadState({
      clipId: clip.id,
      clipLengthBeats,
      trackId: track?.id,
      currentBeat,
      isPlaying,
      playbackMode,
      arrangementClips,
      sessionRuntime,
      loopEnabled,
      loopStartBeat,
      loopEndBeat,
    });
  }, [
    clip,
    clipLengthBeats,
    track?.id,
    currentBeat,
    isPlaying,
    playbackMode,
    arrangementClips,
    sessionRuntime,
    loopEnabled,
    loopStartBeat,
    loopEndBeat,
  ]);

  const lastAudioTickRef = useRef<{ beat: number; at: number }>({
    beat: playheadState.localBeat,
    at: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  useEffect(() => {
    lastAudioTickRef.current = {
      beat: playheadState.localBeat,
      at: performance.now(),
    };
  }, [playheadState.localBeat, currentBeat, clip?.id]);

  const applyPlayheadPosition = useCallback(
    (localBeat: number) => {
      const clampedBeat = Math.max(0, Math.min(clipLengthBeats, localBeat));
      const x = Math.round(clampedBeat * pxPerBeat * 100) / 100;
      const tf = `translate3d(${x}px, 0, 0)`;
      if (rulerPlayheadRef.current) rulerPlayheadRef.current.style.transform = tf;
      if (gridPlayheadRef.current) gridPlayheadRef.current.style.transform = tf;
      if (velPlayheadRef.current) velPlayheadRef.current.style.transform = tf;
    },
    [clipLengthBeats, pxPerBeat]
  );

  // Sync playhead immediately on seek, zoom, clip switch, or audio tick
  useEffect(() => {
    if (!clip) return;
    applyPlayheadPosition(playheadState.localBeat);
  }, [clip, playheadState.localBeat, velocityLaneOpen, applyPlayheadPosition]);

  // Keep playhead smoothly animated at 60fps via rAF clamped strictly to audio clock tick
  useEffect(() => {
    if (!clip || !isPlaying) return;

    let rafId = 0;
    const step = (now: number) => {
      if (!isScrubbingPlayheadRef.current) {
        const tick = lastAudioTickRef.current;
        const elapsedSec = Math.max(0, Math.min(0.25, (now - tick.at) / 1000));
        let smoothLocal = Math.min(tick.beat + 0.25, tick.beat + elapsedSec * (bpm / 60));

        const lStart = playheadState.loopStartLocal;
        const lEnd = playheadState.loopEndLocal;
        if (
          loopEnabled &&
          playbackMode === 'arrangement' &&
          lStart !== null &&
          lEnd !== null &&
          lEnd > lStart &&
          tick.beat >= lStart - 1e-4 &&
          tick.beat < lEnd
        ) {
          if (smoothLocal >= lEnd) {
            smoothLocal = lStart + (smoothLocal - lEnd);
          }
        } else if (smoothLocal >= clipLengthBeats) {
          smoothLocal = smoothLocal % clipLengthBeats;
        }

        applyPlayheadPosition(smoothLocal);

        // Gently keep playhead in horizontal view during playback unless user recently panned manually
        const scroller = scrollContainerRef.current;
        if (
          scroller &&
          playheadState.inClipRange &&
          now - manualScrollAtRef.current > 2200
        ) {
          const playX = smoothLocal * pxPerBeat;
          const kbWidth = 88;
          const viewW = Math.max(120, scroller.clientWidth - kbWidth);
          const sLeft = scroller.scrollLeft;
          if (playX < sLeft + 16 || playX > sLeft + viewW - 24) {
            const target = Math.max(
              0,
              Math.min(scroller.scrollWidth - scroller.clientWidth, playX - viewW * 0.25)
            );
            scroller.scrollLeft = Math.round(target);
          }
        }
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    clip,
    isPlaying,
    bpm,
    pxPerBeat,
    clipLengthBeats,
    loopEnabled,
    playbackMode,
    playheadState.inClipRange,
    playheadState.loopStartLocal,
    playheadState.loopEndLocal,
    applyPlayheadPosition,
  ]);

  if (!clip || !track) {
    return (
      <div className="h-full flex items-center justify-center bg-[#101218] text-xs text-zinc-500 p-4">
        Select or double-click any MIDI clip in Session View or Arrangement View to edit notes.
      </div>
    );
  }

  const primarySelectedId = selectedNoteIds[0] ?? null;
  const primarySelectedNote = clip.notes.find((n) => n.id === primarySelectedId) ?? null;
  const subStepCount = Math.max(1, Math.round(clip.lengthBeats / gridBeats));

  const formatLocalPos = (beat: number) => {
    const safe = Math.max(0, beat);
    const bar = Math.floor(safe / beatsPerBar) + 1;
    const rem = safe % beatsPerBar;
    const beatNum = Math.floor(rem) + 1;
    const sixteenth = Math.floor((rem - Math.floor(rem)) * 4) + 1;
    return `${bar}.${beatNum}.${sixteenth}`;
  };

  const snapValue = (raw: number) => {
    const snapped = Math.round(raw / gridBeats) * gridBeats;
    return Math.max(0, Math.min(clip.lengthBeats - 0.0625, Math.round(snapped * 1000) / 1000));
  };

  const snapPlayheadLocal = (raw: number) => {
    const clamped = Math.max(0, Math.min(clip.lengthBeats, raw));
    if (!gridSnap) {
      return Math.round(clamped * 64) / 64;
    }
    const snapped = Math.round(clamped / gridBeats) * gridBeats;
    return Math.max(0, Math.min(clip.lengthBeats, Math.round(snapped * 1000) / 1000));
  };

  const snapNoteStart = (beat: number) =>
    gridSnap ? snapValue(beat) : Math.max(0, Math.min(clip.lengthBeats - 0.0625, Math.round(beat * 64) / 64));

  const snapNoteDuration = (rawDur: number) => {
    if (!gridSnap) return Math.max(0.0625, Math.round(rawDur * 64) / 64);
    const snapped = Math.round(rawDur / gridBeats) * gridBeats;
    return Math.max(0.125, Math.round(snapped * 1000) / 1000);
  };

  // Ruler tap & Playhead triangular handle drag-to-scrub
  const startPlayheadScrub = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!onSeekBeat || !rulerBarRef.current) return;
    e.stopPropagation();

    const targetEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    isScrubbingPlayheadRef.current = true;
    const rulerEl = rulerBarRef.current;

    const seekFromClientX = (clientX: number) => {
      const rect = rulerEl.getBoundingClientRect();
      const rawLocal = (clientX - rect.left) / pxPerBeat;
      const localBeat = snapPlayheadLocal(rawLocal);
      applyPlayheadPosition(localBeat);
      setScrubBeatLabel(formatLocalPos(localBeat));

      const globalBeat = mapLocalBeatToGlobalBeat({
        targetLocalBeat: localBeat,
        clipId: clip.id,
        clipLengthBeats,
        currentBeat,
        playbackMode,
        activeArrClip: playheadState.activeArrClip,
        sessionRuntime,
      });
      onSeekBeat(globalBeat);
    };

    seekFromClientX(e.clientX);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      seekFromClientX(ev.clientX);
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      isScrubbingPlayheadRef.current = false;
      setScrubBeatLabel(null);
      try {
        if (targetEl.hasPointerCapture(pointerId)) {
          targetEl.releasePointerCapture(pointerId);
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

  // Tap to create note instantly at tapped row/column with selected note length
  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rowIdx = Math.min(rows.length - 1, Math.max(0, Math.floor(y / rowHeight)));
    let pitch = rows[rowIdx].pitch;

    if (scaleSnap && !isDrumTrack) {
      pitch = snapPitchToScale(pitch, rootNoteVal, scaleName);
    }

    const rawBeat = x / pxPerBeat;
    const floored = gridSnap ? Math.floor(rawBeat / gridBeats) * gridBeats : rawBeat;
    const startBeat = snapNoteStart(floored);

    onAuditionNote(track.id, pitch, defaultVelocity);
    onAddNote(clip.id, {
      pitch,
      startBeat,
      durationBeats: defaultNoteLength,
      velocity: defaultVelocity,
    });
  };

  const handleNotePointerDown = (e: React.PointerEvent<HTMLDivElement>, note: MidiNote): boolean => {
    e.stopPropagation();
    const now = Date.now();
    // Double-tap to delete
    if (lastClickNoteIdRef.current === note.id && now - lastClickTimeRef.current < 450) {
      onDeleteNote(clip.id, note.id);
      setSelectedNoteIds(selectedNoteIds.filter((id) => id !== note.id));
      lastClickNoteIdRef.current = null;
      return true;
    }
    lastClickTimeRef.current = now;
    lastClickNoteIdRef.current = note.id;

    if (!selectedNoteIds.includes(note.id)) {
      setSelectedNoteIds([note.id]);
    }

    onAuditionNote(track.id, note.pitch, note.velocity);
    return false;
  };

  // Drag to move notes
  const startNoteMoveDrag = (e: React.PointerEvent<HTMLDivElement>, note: MidiNote) => {
    e.stopPropagation();
    const targetEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = note.startBeat;
    const origRowIdx = rows.findIndex((r) => r.pitch === note.pitch);

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dxBeats = (ev.clientX - startX) / pxPerBeat;
      const dyRows = Math.round((ev.clientY - startY) / rowHeight);
      const nextRowIdx = Math.min(rows.length - 1, Math.max(0, origRowIdx + dyRows));
      let nextPitch = rows[nextRowIdx]?.pitch ?? note.pitch;
      if (scaleSnap && !isDrumTrack) {
        nextPitch = snapPitchToScale(nextPitch, rootNoteVal, scaleName);
      }
      const nextStart = Math.max(
        0,
        Math.min(clip.lengthBeats - note.durationBeats, snapNoteStart(origStart + dxBeats))
      );
      onUpdateNote(
        clip.id,
        note.id,
        {
          startBeat: nextStart,
          pitch: nextPitch,
        },
        false
      );
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
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

  const startNoteResizeDrag = (e: React.PointerEvent<HTMLDivElement>, note: MidiNote) => {
    e.stopPropagation();
    const targetEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const startX = e.clientX;
    const origDur = note.durationBeats;

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dxBeats = (ev.clientX - startX) / pxPerBeat;
      const nextDur = snapNoteDuration(origDur + dxBeats);
      onUpdateNote(clip.id, note.id, { durationBeats: nextDur }, false);
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
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

  // Velocity handle directly on the note
  const startNoteVelocityDrag = (e: React.PointerEvent<HTMLDivElement>, note: MidiNote) => {
    e.stopPropagation();
    setSelectedNoteIds([note.id]);
    const targetEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const startY = e.clientY;
    const origVel = note.velocity;

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dy = startY - ev.clientY;
      const nextVel = Math.max(1, Math.min(127, Math.round(origVel + dy * 1.5)));
      setDefaultVelocity(nextVel);
      onUpdateNote(clip.id, note.id, { velocity: nextVel }, false);
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
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
    <div className="h-full flex flex-col bg-[#101218] select-none overflow-hidden">
      {/* Ableton-Inspired Mobile Touch MIDI Editor Toolbar */}
      <div className="px-2.5 py-2 bg-[#15171F] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {allMidiClips && onSelectClip && (
            <select
              aria-label="Select MIDI clip"
              value={clip.id}
              onChange={(e) => onSelectClip(e.target.value)}
              className="h-7 bg-[#101217] border border-white/[0.08] rounded px-2 text-xs font-semibold text-zinc-100"
            >
              {allMidiClips.map((mc) => (
                <option key={mc.id} value={mc.id}>
                  {mc.name}
                </option>
              ))}
            </select>
          )}

          {/* Note Length Selector */}
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded px-1.5 h-7 gap-1">
            <span className="text-[10px] font-bold text-zinc-400 uppercase">Len</span>
            <select
              aria-label="Default note length"
              value={defaultNoteLength}
              onChange={(e) => setDefaultNoteLength(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-indigo-300 focus:outline-none"
            >
              {NOTE_LENGTH_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.beats} className="bg-[#161822] text-zinc-200">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Grid Resolution + Snap Toggle */}
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded px-1.5 h-7 gap-1">
            <span className="text-[10px] font-bold text-zinc-400 uppercase">Grid</span>
            <select
              aria-label="Grid resolution"
              value={grid}
              onChange={(e) => setGrid(e.target.value as GridResolution)}
              className="bg-transparent text-xs font-mono-tabular font-semibold text-zinc-200 focus:outline-none"
            >
              {GRID_OPTIONS.map((gOpt) => (
                <option key={gOpt} value={gOpt} className="bg-[#161822] text-zinc-200">
                  {gOpt}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setGridSnap((s) => !s)}
              aria-pressed={gridSnap}
              title="Toggle Time Grid Snapping (notes & playhead)"
              className={`h-5 px-1.5 rounded text-[10px] font-bold transition-colors ${
                gridSnap
                  ? 'bg-[#6D5DFB] text-white'
                  : 'bg-[#1B1E28] text-zinc-400 hover:text-white'
              }`}
            >
              Snap
            </button>
          </div>

          {/* Root Note Selector */}
          <select
            aria-label="Root note"
            value={rootNoteVal}
            onChange={(e) => setRootNoteVal(Number(e.target.value))}
            className="h-7 bg-[#101217] border border-white/[0.08] rounded px-2 text-xs font-semibold text-indigo-300"
          >
            {ROOT_NOTES.map((rn) => (
              <option key={rn.value} value={rn.value}>
                {rn.label}
              </option>
            ))}
          </select>

          {/* Scale Selector */}
          <select
            aria-label="Scale"
            value={scaleName}
            onChange={(e) => setScaleName(e.target.value)}
            className="h-7 bg-[#101217] border border-white/[0.08] rounded px-2 text-xs font-semibold text-indigo-300"
          >
            {SCALE_NAMES.map((sc) => (
              <option key={sc} value={sc}>
                {sc}
              </option>
            ))}
          </select>

          {/* Scale Highlight Toggle */}
          <button
            type="button"
            onClick={() => setScaleHighlight((h) => !h)}
            aria-pressed={scaleHighlight}
            title="Toggle Scale Highlighting"
            className={`h-7 px-2 rounded border text-xs font-semibold flex items-center gap-1 transition-colors ${
              scaleHighlight
                ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-300'
                : 'bg-[#101217] border-white/[0.08] text-zinc-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Highlight</span>
          </button>

          {/* Scale Snap Toggle */}
          <button
            type="button"
            onClick={() => setScaleSnap((s) => !s)}
            aria-pressed={scaleSnap}
            title="Toggle Scale Pitch Snapping"
            className={`h-7 px-2 rounded border text-xs font-semibold flex items-center gap-1 transition-colors ${
              scaleSnap
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                : 'bg-[#101217] border-white/[0.08] text-zinc-400 hover:text-white'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scale</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Zoom controls */}
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setPxPerBeat((z) => Math.max(32, z - 12))}
              aria-label="Zoom Out"
              className="h-6 w-6 rounded text-zinc-400 hover:text-white flex items-center justify-center"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPxPerBeat(64)}
              title="Reset Zoom"
              className="h-6 px-1.5 text-[10px] font-mono-tabular text-zinc-300"
            >
              Zoom
            </button>
            <button
              type="button"
              onClick={() => setPxPerBeat((z) => Math.min(140, z + 12))}
              aria-label="Zoom In"
              className="h-6 w-6 rounded text-zinc-400 hover:text-white flex items-center justify-center"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Velocity Lane & MPE Toggles */}
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setVelocityLaneOpen((o) => !o)}
              aria-pressed={velocityLaneOpen}
              title="Toggle Velocity Lane"
              className={`h-6 px-2 rounded text-[11px] font-semibold transition-colors ${
                velocityLaneOpen ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Vel Lane
            </button>
            <button
              type="button"
              onClick={() => setExpressionTab(expressionTab === 'slide' ? 'none' : 'slide')}
              aria-pressed={expressionTab === 'slide'}
              title="Pitch Slide / Glide Editor"
              className={`h-6 px-2 rounded text-[11px] font-semibold transition-colors ${
                expressionTab === 'slide' ? 'bg-[#38BDF8] text-zinc-950' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Slide
            </button>
            <button
              type="button"
              onClick={() => setExpressionTab(expressionTab === 'mpe' ? 'none' : 'mpe')}
              aria-pressed={expressionTab === 'mpe'}
              title="MPE Pressure & Timbre"
              className={`h-6 px-2 rounded text-[11px] font-semibold transition-colors ${
                expressionTab === 'mpe' ? 'bg-[#34D399] text-zinc-950' : 'text-zinc-400 hover:text-white'
              }`}
            >
              MPE
            </button>
          </div>

          <button
            type="button"
            onClick={() => onQuantizeClip(clip.id, grid)}
            className="h-7 px-2.5 rounded bg-[#242834] hover:bg-[#2F3444] border border-white/[0.08] text-xs font-semibold text-zinc-100 flex items-center gap-1"
          >
            <Wand2 className="w-3.5 h-3.5 text-[#8B5CF6]" />
            <span>Quantize</span>
          </button>
        </div>
      </div>

      {/* Main Scrollable Piano Roll Area */}
      <div
        ref={scrollContainerRef}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > 1.5 || e.shiftKey) {
            manualScrollAtRef.current = performance.now();
          }
        }}
        onTouchStart={() => {
          manualScrollAtRef.current = performance.now();
        }}
        className="flex-1 min-h-0 overflow-auto flex flex-col overscroll-x-contain"
      >
        {/* Sticky Beat Ruler Header + Playhead Handle */}
        <div className="sticky top-0 z-30 flex min-w-max bg-[#15171F] border-b border-white/[0.08]">
          <div className="sticky left-0 z-40 w-20 sm:w-24 shrink-0 bg-[#15171F] border-r border-white/[0.1] h-7 px-2 flex items-center justify-between">
            <span className="font-mono-tabular text-[10px] font-semibold text-[#FF8C24]">
              {scrubBeatLabel ?? formatLocalPos(playheadState.localBeat)}
            </span>
          </div>
          <div
            ref={rulerBarRef}
            onPointerDown={startPlayheadScrub}
            style={{ width: gridWidth }}
            title="Tap or drag ruler to position playhead"
            className="relative h-7 bg-[#12141B] touch-none cursor-pointer"
          >
            {/* Overlapping Arrangement Loop Brace indicator inside Piano Roll Ruler */}
            {playheadState.loopStartLocal !== null && playheadState.loopEndLocal !== null && (
              <div
                aria-hidden="true"
                style={{
                  left: playheadState.loopStartLocal * pxPerBeat,
                  width: Math.max(
                    4,
                    (playheadState.loopEndLocal - playheadState.loopStartLocal) * pxPerBeat
                  ),
                }}
                className="absolute top-0 h-1.5 bg-sky-400/55 border-x border-sky-300 pointer-events-none z-10"
              />
            )}

            {/* Ruler Beat Ticks & Bar.Beat Labels */}
            {Array.from({ length: Math.max(1, Math.round(clip.lengthBeats * 4)) }, (_, s) => {
              const beatPos = s * 0.25;
              const barNum = Math.floor(beatPos / beatsPerBar) + 1;
              const beatInBar = Math.floor(beatPos % beatsPerBar) + 1;
              const isWholeBeat = s % 4 === 0;
              const isBarStart = isWholeBeat && Math.round(beatPos) % beatsPerBar === 0;
              return (
                <div
                  key={s}
                  style={{ left: beatPos * pxPerBeat }}
                  className={`absolute bottom-0 border-l px-1 font-mono-tabular text-[10px] pointer-events-none select-none ${
                    isBarStart
                      ? 'top-0 border-white/25 text-zinc-100 font-bold pt-1.5'
                      : isWholeBeat
                        ? 'top-1.5 border-white/15 text-zinc-400 pt-0.5'
                        : 'top-4 border-white/[0.06]'
                  }`}
                >
                  {isWholeBeat ? `${barNum}.${beatInBar}` : ''}
                </div>
              );
            })}

            {/* Playhead Ruler Stem + Touch-Friendly 44px Triangular Marker */}
            <div
              ref={rulerPlayheadRef}
              style={{ transform: `translate3d(${playheadState.localBeat * pxPerBeat}px, 0, 0)` }}
              className={`absolute top-0 bottom-0 left-0 z-30 will-change-transform ${
                playheadState.inClipRange ? 'opacity-100' : 'opacity-45'
              }`}
            >
              <div
                role="slider"
                aria-label="MIDI Editor Playhead"
                aria-valuemin={0}
                aria-valuemax={clip.lengthBeats}
                aria-valuenow={Math.round(playheadState.localBeat * 100) / 100}
                onPointerDown={startPlayheadScrub}
                title="Drag to scrub playhead"
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

        <div className="flex min-w-max">
          {/* Left Sticky Piano Keyboard */}
          <div className="sticky left-0 z-20 w-20 sm:w-24 shrink-0 bg-[#181A22] border-r border-white/[0.1]">
            {rows.map((row) => {
              const inSc = scaleHighlight && row.inScale;
              return (
                <button
                  key={row.pitch}
                  type="button"
                  onClick={() => onAuditionNote(track.id, row.pitch, defaultVelocity)}
                  style={{ height: rowHeight }}
                  className={`w-full px-2 border-b border-white/[0.06] flex items-center justify-between text-[10px] font-mono-tabular transition-colors active:bg-[#6D5DFB]/40 ${
                    row.dark
                      ? 'bg-[#0F1015] text-zinc-400 hover:bg-[#1A1C24]'
                      : 'bg-[#E4E4E7] text-zinc-950 font-semibold hover:bg-white'
                  } ${inSc && !isDrumTrack ? 'ring-inset ring-1 ring-indigo-400/40' : ''}`}
                >
                  <span className="truncate">{row.label}</span>
                  {scaleHighlight && inSc && !isDrumTrack && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Interactive Note Grid (Tap to create, double tap to delete) */}
          <div
            onClick={handleGridClick}
            style={{ width: gridWidth, height: rows.length * rowHeight }}
            className="relative bg-[#111319] cursor-crosshair"
          >
            {rows.map((row, rIdx) => {
              const inSc = scaleHighlight && row.inScale;
              return (
                <div
                  key={row.pitch}
                  style={{ top: rIdx * rowHeight, height: rowHeight }}
                  className={`absolute left-0 right-0 border-b border-white/[0.04] pointer-events-none ${
                    row.dark
                      ? 'bg-black/25'
                      : scaleHighlight && !inSc && !isDrumTrack
                        ? 'bg-black/40'
                        : scaleHighlight && inSc && !isDrumTrack
                          ? 'bg-indigo-950/15'
                          : ''
                  }`}
                />
              );
            })}

            {/* Grid Subdivisions */}
            {Array.from({ length: subStepCount }, (_, idx) => {
              const beatPos = idx * gridBeats;
              const isWholeBeat = Math.abs(beatPos - Math.round(beatPos)) < 1e-4;
              const isBar = isWholeBeat && Math.round(beatPos) % beatsPerBar === 0;
              return (
                <div
                  key={idx}
                  style={{ left: beatPos * pxPerBeat }}
                  className={`absolute top-0 bottom-0 border-l pointer-events-none ${
                    isBar
                      ? 'border-white/20'
                      : isWholeBeat
                        ? 'border-white/10'
                        : 'border-white/[0.04]'
                  }`}
                />
              );
            })}

            {/* Overlapping Arrangement Loop Shading in Grid (non-blocking) */}
            {playheadState.loopStartLocal !== null && playheadState.loopEndLocal !== null && (
              <div
                aria-hidden="true"
                style={{
                  left: playheadState.loopStartLocal * pxPerBeat,
                  width: Math.max(
                    4,
                    (playheadState.loopEndLocal - playheadState.loopStartLocal) * pxPerBeat
                  ),
                }}
                className="absolute top-0 bottom-0 bg-sky-400/[0.04] border-x border-sky-400/25 pointer-events-none z-[1]"
              />
            )}

            {/* MIDI Notes */}
            {clip.notes.map((note) => {
              const rowIdx = rows.findIndex((r) => r.pitch === note.pitch);
              if (rowIdx === -1) return null;
              const isSelected = selectedNoteIds.includes(note.id);
              const noteColor = isDrumTrack ? track.color : '#8B5CF6';
              return (
                <div
                  key={note.id}
                  onPointerDown={(e) => {
                    const isDeleted = handleNotePointerDown(e, note);
                    if (!isDeleted) {
                      startNoteMoveDrag(e, note);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onDeleteNote(clip.id, note.id);
                  }}
                  style={{
                    left: note.startBeat * pxPerBeat,
                    top: rowIdx * rowHeight + 1,
                    width: Math.max(14, note.durationBeats * pxPerBeat - 1),
                    height: rowHeight - 2,
                    backgroundColor: noteColor,
                    opacity: 0.6 + (note.velocity / 127) * 0.4,
                  }}
                  className={`parameter-drag-area absolute rounded-xs cursor-grab active:cursor-grabbing flex items-center justify-between px-1.5 text-[10px] font-mono-tabular font-bold text-white shadow-sm ${
                    isSelected ? 'ring-2 ring-white z-10' : 'border border-white/25 z-[5]'
                  }`}
                >
                  <span className="truncate pointer-events-none">
                    {isDrumTrack ? '' : midiToNoteName(note.pitch)}
                  </span>

                  {/* Velocity handle directly on the note */}
                  <div
                    onPointerDown={(e) => startNoteVelocityDrag(e, note)}
                    title={`Velocity ${note.velocity} (drag up/down)`}
                    className="absolute right-3.5 top-0 bottom-0 w-2.5 bg-black/30 hover:bg-white/50 cursor-ns-resize flex items-center justify-center rounded-xs"
                  >
                    <span className="w-1 h-2 bg-white/70 rounded-full" />
                  </div>

                  {/* Distinct Right Resize Handle */}
                  <div
                    onPointerDown={(e) => startNoteResizeDrag(e, note)}
                    title="Drag to resize note length"
                    className="absolute top-0 right-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/40 flex items-center justify-center"
                  >
                    <span className="w-[2px] h-3 bg-white/80 rounded-full" />
                  </div>
                </div>
              );
            })}

            {/* Full-Height Non-Blocking Vertical Playhead Line */}
            <div
              ref={gridPlayheadRef}
              aria-hidden="true"
              style={{ transform: `translate3d(${playheadState.localBeat * pxPerBeat}px, 0, 0)` }}
              className={`absolute top-0 bottom-0 left-0 w-[2px] -ml-[1px] pointer-events-none z-20 will-change-transform ${
                playheadState.inClipRange
                  ? 'bg-[#FF8C24] shadow-[0_0_10px_rgba(255,140,36,0.55)] opacity-90'
                  : 'bg-[#FF8C24]/40 opacity-50'
              }`}
            />
          </div>
        </div>

        {/* Optional Velocity Lane */}
        {velocityLaneOpen && (
          <div className="flex min-w-max border-t border-white/[0.12] bg-[#14161D] shrink-0">
            <div className="sticky left-0 z-20 w-20 sm:w-24 shrink-0 bg-[#181A22] border-r border-white/[0.1] px-2 py-1.5 flex flex-col justify-center">
              <span className="text-[10px] font-bold text-zinc-300">Velocity Lane</span>
              <span className="text-[9px] font-mono text-zinc-400">
                {primarySelectedNote ? `${primarySelectedNote.velocity} / 127` : '1–127'}
              </span>
            </div>
            <div style={{ width: gridWidth }} className="relative h-16 bg-[#0D0F14]">
              {clip.notes.map((note) => {
                const isSelected = selectedNoteIds.includes(note.id);
                const heightPct = Math.max(12, (note.velocity / 127) * 100);
                return (
                  <div
                    key={note.id}
                    onPointerDown={(e) => {
                      setSelectedNoteIds([note.id]);
                      const targetEl = e.currentTarget;
                      const pointerId = e.pointerId;
                      targetEl.setPointerCapture(pointerId);
                      const startY = e.clientY;
                      const origV = note.velocity;
                      const onMove = (ev: PointerEvent) => {
                        const dy = startY - ev.clientY;
                        const v = Math.max(1, Math.min(127, Math.round(origV + dy * 1.5)));
                        onUpdateNote(clip.id, note.id, { velocity: v });
                      };
                      const onUp = () => {
                        try {
                          targetEl.releasePointerCapture(pointerId);
                        } catch {
                          // ignore
                        }
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                      };
                      window.addEventListener('pointermove', onMove);
                      window.addEventListener('pointerup', onUp);
                    }}
                    style={{ left: note.startBeat * pxPerBeat }}
                    className="parameter-drag-area absolute top-0 bottom-0 w-5 flex items-end cursor-ns-resize group"
                    title={`Velocity ${note.velocity}`}
                  >
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-3.5 rounded-t-xs transition-colors ${
                        isSelected ? 'bg-white shadow-sm' : 'bg-[#8B5CF6] group-hover:bg-[#A78BFA]'
                      }`}
                    />
                  </div>
                );
              })}

              {/* Velocity Lane Playhead Line */}
              <div
                ref={velPlayheadRef}
                aria-hidden="true"
                style={{ transform: `translate3d(${playheadState.localBeat * pxPerBeat}px, 0, 0)` }}
                className={`absolute top-0 bottom-0 left-0 w-[2px] -ml-[1px] pointer-events-none z-20 will-change-transform ${
                  playheadState.inClipRange ? 'bg-[#FF8C24] opacity-90' : 'bg-[#FF8C24]/40 opacity-50'
                }`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

