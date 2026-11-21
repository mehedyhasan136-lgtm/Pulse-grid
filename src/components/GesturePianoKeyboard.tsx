import React, { useMemo } from 'react';
import { midiToNoteName } from '../data/presets';
import { KeyboardSpanMode } from '../vision/gestureKinematicsCore';

const WHITE_KEY_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

export interface KeyboardKeyDef {
  midi: number;
  isBlack: boolean;
  label: string;
}

export function getKeyboardRange(
  spanMode: KeyboardSpanMode,
  leftOctave: number,
  rightOctave: number
): { startMidi: number; endMidi: number } {
  if (spanMode === '88-keys') {
    return { startMidi: 21, endMidi: 108 };
  }
  if (spanMode === '4-oct') {
    const startMidi = Math.max(24, Math.min(60, (leftOctave + 1) * 12));
    return { startMidi, endMidi: Math.min(108, startMidi + 47) };
  }
  if (spanMode === '2-oct') {
    const startMidi = Math.max(24, Math.min(84, (leftOctave + 1) * 12));
    return { startMidi, endMidi: Math.min(108, startMidi + 23) };
  }
  // split-1oct: show continuous span covering both left and right hand octaves
  const leftStart = Math.max(21, Math.min(96, (leftOctave + 1) * 12));
  const rightStart = Math.max(21, Math.min(96, (rightOctave + 1) * 12));
  const startMidi = Math.min(leftStart, rightStart);
  const endMidi = Math.min(108, Math.max(leftStart, rightStart) + 11);
  return { startMidi, endMidi };
}

interface GesturePianoKeyboardProps {
  spanMode: KeyboardSpanMode;
  leftOctave: number;
  rightOctave: number;
  isDrumMode: boolean;
  leftActivePitches: Set<number>;
  rightActivePitches: Set<number>;
  pointerActivePitches: Set<number>;
  leftHoverPitches: Set<number>;
  rightHoverPitches: Set<number>;
  onNoteOn: (pitch: number, velocity: number, channel: number) => void;
  onNoteOff: (pitch: number) => void;
}

const DRUM_PADS = [
  { pitch: 36, label: 'Kick', short: 'C1' },
  { pitch: 38, label: 'Snare', short: 'D1' },
  { pitch: 39, label: 'Clap', short: 'Eb1' },
  { pitch: 37, label: 'Rim', short: 'C#1' },
  { pitch: 42, label: 'CH Hat', short: 'F#1' },
  { pitch: 46, label: 'OH Hat', short: 'Bb1' },
];

export const GesturePianoKeyboard: React.FC<GesturePianoKeyboardProps> = React.memo(
  ({
    spanMode,
    leftOctave,
    rightOctave,
    isDrumMode,
    leftActivePitches,
    rightActivePitches,
    pointerActivePitches,
    leftHoverPitches,
    rightHoverPitches,
    onNoteOn,
    onNoteOff,
  }) => {
    const { keys, whiteKeys } = useMemo(() => {
      const { startMidi, endMidi } = getKeyboardRange(spanMode, leftOctave, rightOctave);
      const list: KeyboardKeyDef[] = [];
      for (let m = startMidi; m <= endMidi; m++) {
        const pc = ((m % 12) + 12) % 12;
        list.push({
          midi: m,
          isBlack: !WHITE_KEY_PCS.has(pc),
          label: midiToNoteName(m),
        });
      }
      return {
        keys: list,
        whiteKeys: list.filter((k) => !k.isBlack),
      };
    }, [spanMode, leftOctave, rightOctave]);

    if (isDrumMode) {
      return (
        <div className="h-[88px] sm:h-[96px] rounded bg-[#0C0E13] border border-white/[0.08] p-1.5 grid grid-cols-6 gap-1.5">
          {DRUM_PADS.map((pad) => {
            const isLeft = leftActivePitches.has(pad.pitch);
            const isRight = rightActivePitches.has(pad.pitch);
            const isManual = pointerActivePitches.has(pad.pitch);
            const isHoveredLeft = leftHoverPitches.has(pad.pitch);
            const isHoveredRight = rightHoverPitches.has(pad.pitch);
            const active = isLeft || isRight || isManual;

            return (
              <button
                key={pad.pitch}
                type="button"
                onPointerDown={() => onNoteOn(pad.pitch, 106, 10)}
                onPointerUp={() => onNoteOff(pad.pitch)}
                onPointerLeave={() => onNoteOff(pad.pitch)}
                onPointerCancel={() => onNoteOff(pad.pitch)}
                className={`relative rounded border font-semibold text-xs flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  isLeft
                    ? 'bg-[#8B5CF6] border-violet-300 text-white shadow-[0_0_16px_rgba(139,92,246,0.45)]'
                    : isRight || isManual
                      ? 'bg-[#38BDF8] border-sky-200 text-zinc-950 shadow-[0_0_16px_rgba(56,189,248,0.45)]'
                      : 'bg-[#171A23] border-white/[0.08] text-zinc-200 hover:bg-[#212532]'
                }`}
              >
                {(isHoveredLeft || isHoveredRight) && !active && (
                  <span
                    className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                      isHoveredLeft ? 'bg-[#A78BFA]' : 'bg-[#38BDF8]'
                    }`}
                  />
                )}
                <span>{pad.label}</span>
                <span className="text-[10px] font-mono-tabular opacity-70">{pad.short}</span>
              </button>
            );
          })}
        </div>
      );
    }

    const minWidthPx =
      spanMode === '88-keys'
        ? 1120
        : spanMode === '4-oct'
          ? 760
          : 500;

    return (
      <div className="h-[92px] sm:h-[104px] rounded bg-[#0C0E13] border border-white/[0.08] overflow-x-auto no-scrollbar p-1">
        <div
          className="relative h-full w-full flex"
          style={{ minWidth: `${minWidthPx}px` }}
        >
          {whiteKeys.map((k) => {
            const isLeft = leftActivePitches.has(k.midi);
            const isRight = rightActivePitches.has(k.midi);
            const isManual = pointerActivePitches.has(k.midi);
            const hoverLeft = leftHoverPitches.has(k.midi);
            const hoverRight = rightHoverPitches.has(k.midi);
            const isC = k.midi % 12 === 0;

            let bgClass = 'bg-gradient-to-b from-zinc-100 to-zinc-300 hover:from-white hover:to-zinc-200 text-zinc-700';
            if (isLeft && isRight) {
              bgClass = 'bg-gradient-to-b from-[#A78BFA] to-[#38BDF8] text-zinc-950 shadow-[0_0_14px_rgba(139,92,246,0.5)]';
            } else if (isLeft) {
              bgClass = 'bg-gradient-to-b from-[#8B5CF6] to-[#6D5DFB] text-white shadow-[0_0_14px_rgba(139,92,246,0.5)]';
            } else if (isRight || isManual) {
              bgClass = 'bg-gradient-to-b from-[#7DD3FC] to-[#38BDF8] text-zinc-950 shadow-[0_0_14px_rgba(56,189,248,0.5)]';
            }

            return (
              <button
                key={k.midi}
                type="button"
                onPointerDown={() => onNoteOn(k.midi, 96, 1)}
                onPointerUp={() => onNoteOff(k.midi)}
                onPointerLeave={() => onNoteOff(k.midi)}
                onPointerCancel={() => onNoteOff(k.midi)}
                aria-label={k.label}
                className={`relative flex-1 h-full border-r border-zinc-500/60 last:border-r-0 rounded-b-[3px] flex items-end justify-center pb-1 text-[9px] font-mono-tabular font-semibold transition-colors ${bgClass}`}
              >
                {(hoverLeft || hoverRight) && !isLeft && !isRight && (
                  <span
                    className={`absolute bottom-4 w-1.5 h-1.5 rounded-full ${
                      hoverLeft ? 'bg-[#8B5CF6]' : 'bg-[#38BDF8]'
                    }`}
                  />
                )}
                {isC ? k.label : ''}
              </button>
            );
          })}

          {keys.map((k) => {
            if (!k.isBlack) return null;
            const whiteIndexBefore = whiteKeys.filter((wk) => wk.midi < k.midi).length;
            const leftPct = (whiteIndexBefore / whiteKeys.length) * 100;
            const widthPct = (1 / whiteKeys.length) * 62;
            const isLeft = leftActivePitches.has(k.midi);
            const isRight = rightActivePitches.has(k.midi);
            const isManual = pointerActivePitches.has(k.midi);
            const hoverLeft = leftHoverPitches.has(k.midi);
            const hoverRight = rightHoverPitches.has(k.midi);

            let blackClass = 'bg-gradient-to-b from-[#1E222D] to-[#0B0D12] hover:from-[#2B303F] border-black';
            if (isLeft) {
              blackClass = 'bg-gradient-to-b from-[#A78BFA] to-[#6D5DFB] border-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.65)]';
            } else if (isRight || isManual) {
              blackClass = 'bg-gradient-to-b from-[#38BDF8] to-[#0284C7] border-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.65)]';
            }

            return (
              <button
                key={k.midi}
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onNoteOn(k.midi, 100, 1);
                }}
                onPointerUp={() => onNoteOff(k.midi)}
                onPointerLeave={() => onNoteOff(k.midi)}
                onPointerCancel={() => onNoteOff(k.midi)}
                aria-label={k.label}
                style={{
                  left: `calc(${leftPct}% - ${widthPct / 2}%)`,
                  width: `${widthPct}%`,
                }}
                className={`absolute top-0 h-[58%] z-10 rounded-b-[3px] border flex items-end justify-center pb-1 transition-colors ${blackClass}`}
              >
                {(hoverLeft || hoverRight) && !isLeft && !isRight && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      hoverLeft ? 'bg-[#A78BFA]' : 'bg-[#38BDF8]'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);

GesturePianoKeyboard.displayName = 'GesturePianoKeyboard';
