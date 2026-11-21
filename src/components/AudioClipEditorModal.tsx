import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Maximize2, Play, RotateCcw, Scissors, Square, X } from 'lucide-react';
import * as Tone from 'tone';
import { ArrangementClip, AudioClipMeta } from '../types/daw';
import { dawController } from '../audio/dawController';
import { TouchFader } from './TouchFader';

interface AudioClipEditorModalProps {
  open: boolean;
  audioClip: AudioClipMeta | null;
  arrClip?: ArrangementClip | null;
  onClose: () => void;
}

export const AudioClipEditorModal: React.FC<AudioClipEditorModalProps> = ({
  open,
  audioClip,
  arrClip,
  onClose,
}) => {
  const duration = audioClip?.durationSeconds ?? 1;
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(duration);
  const [gainDb, setGainDb] = useState(0);
  const [isAuditioning, setIsAuditioning] = useState(false);
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    if (!open || !audioClip) return;
    setTrimStartSec(0);
    setTrimEndSec(Math.max(0.1, audioClip.durationSeconds));
    setGainDb(0);
  }, [open, audioClip?.id, audioClip?.durationSeconds]);

  useEffect(() => {
    return () => {
      try {
        previewSrcRef.current?.stop();
      } catch {
        // ignore
      }
      previewSrcRef.current = null;
    };
  }, []);

  const buffer = audioClip ? dawController.getDecodedAudioBuffer(audioClip.assetId) : null;

  const waveformBars = useMemo(() => {
    if (!audioClip) return [];
    if (buffer) {
      const ch = buffer.getChannelData(0);
      const count = 96;
      const step = Math.max(1, Math.floor(ch.length / count));
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        let peak = 0;
        const start = i * step;
        for (let j = 0; j < step && start + j < ch.length; j += Math.max(1, Math.floor(step / 16))) {
          const v = Math.abs(ch[start + j]);
          if (v > peak) peak = v;
        }
        out.push(Math.min(1, peak));
      }
      return out;
    }
    return audioClip.peaks;
  }, [audioClip, buffer]);

  if (!open || !audioClip) return null;

  const stopPreview = () => {
    try {
      previewSrcRef.current?.stop();
    } catch {
      // ignore
    }
    previewSrcRef.current = null;
    setIsAuditioning(false);
  };

  const handlePreview = async () => {
    if (isAuditioning) {
      stopPreview();
      return;
    }
    await dawController.ensureAudioReady();
    const buf = dawController.getDecodedAudioBuffer(audioClip.assetId);
    if (!buf) return;
    const rawCtx = Tone.getContext().rawContext as AudioContext;
    const src = rawCtx.createBufferSource();
    src.buffer = buf;
    const gainNode = rawCtx.createGain();
    gainNode.gain.value = Math.pow(10, gainDb / 20);
    src.connect(gainNode);
    gainNode.connect(rawCtx.destination);

    const safeStart = Math.max(0, Math.min(buf.duration - 0.05, trimStartSec));
    const safeDur = Math.max(0.05, Math.min(buf.duration - safeStart, trimEndSec - safeStart));
    src.onended = () => {
      if (previewSrcRef.current === src) {
        previewSrcRef.current = null;
        setIsAuditioning(false);
      }
    };
    previewSrcRef.current = src;
    setIsAuditioning(true);
    src.start(0, safeStart, safeDur);
  };

  const startPct = (trimStartSec / Math.max(0.01, duration)) * 100;
  const endPct = (trimEndSec / Math.max(0.01, duration)) * 100;
  const gainLinear = Math.pow(10, gainDb / 20);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Audio Editor — ${audioClip.name}`}
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs"
      onClick={() => {
        stopPreview();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-[#161923] border border-white/[0.14] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-4 py-3 bg-[#1B1F2B] border-b border-white/[0.08] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">
              Audio Editor · {audioClip.name}
            </h2>
            <p className="text-[11px] font-mono-tabular text-zinc-400">
              Duration: {duration.toFixed(2)}s · {audioClip.lengthBeats} beats
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            aria-label="Close Audio Editor"
            className="w-7 h-7 rounded bg-[#242836] text-zinc-300 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Waveform Preview with Trim Region */}
          <div className="relative h-28 rounded-lg bg-[#0C0E13] border border-white/[0.08] overflow-hidden p-2">
            <svg
              viewBox={`0 0 ${Math.max(1, waveformBars.length)} 60`}
              preserveAspectRatio="none"
              className="w-full h-full"
            >
              {waveformBars.map((pk, i) => {
                const h = Math.max(3, Math.min(56, pk * gainLinear * 52));
                return (
                  <rect
                    key={i}
                    x={i}
                    y={(60 - h) / 2}
                    width={0.75}
                    height={h}
                    fill={audioClip.color}
                    fillOpacity={0.9}
                  />
                );
              })}
            </svg>
            {/* Dimmed trimmed-out areas */}
            <div
              style={{ width: `${Math.max(0, startPct)}%` }}
              className="absolute top-0 bottom-0 left-0 bg-black/65 border-r-2 border-amber-400 pointer-events-none"
            />
            <div
              style={{ width: `${Math.max(0, 100 - endPct)}%` }}
              className="absolute top-0 bottom-0 right-0 bg-black/65 border-l-2 border-amber-400 pointer-events-none"
            />
          </div>

          {/* Touch Parameter Faders */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Trim Start</span>
                <span className="font-mono-tabular text-zinc-200">{trimStartSec.toFixed(2)}s</span>
              </div>
              <TouchFader
                orientation="horizontal"
                label="Trim Start (s)"
                value={trimStartSec}
                min={0}
                max={Math.max(0.05, trimEndSec - 0.05)}
                defaultValue={0}
                step={0.02}
                accentColor="#F59E0B"
                displayValue={`${trimStartSec.toFixed(2)}s`}
                onChange={(v) => setTrimStartSec(Math.min(trimEndSec - 0.05, Math.round(v * 50) / 50))}
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Trim End</span>
                <span className="font-mono-tabular text-zinc-200">{trimEndSec.toFixed(2)}s</span>
              </div>
              <TouchFader
                orientation="horizontal"
                label="Trim End (s)"
                value={trimEndSec}
                min={Math.min(duration, trimStartSec + 0.05)}
                max={Math.max(0.1, duration)}
                defaultValue={duration}
                step={0.02}
                accentColor="#F59E0B"
                displayValue={`${trimEndSec.toFixed(2)}s`}
                onChange={(v) => setTrimEndSec(Math.max(trimStartSec + 0.05, Math.round(v * 50) / 50))}
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Clip Gain</span>
                <span className="font-mono-tabular text-zinc-200">
                  {gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1)} dB
                </span>
              </div>
              <TouchFader
                orientation="horizontal"
                label="Clip Gain (dB)"
                value={gainDb}
                min={-24}
                max={12}
                defaultValue={0}
                step={0.5}
                accentColor="#38BDF8"
                displayValue={`${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)}dB`}
                onChange={(v) => setGainDb(Math.round(v * 2) / 2)}
              />
            </div>
          </div>

          {/* Destructive Audio Operations */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => void handlePreview()}
              className={`h-9 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                isAuditioning
                  ? 'bg-emerald-500 border-emerald-400 text-zinc-950'
                  : 'bg-[#222633] border-white/[0.08] text-zinc-100 hover:bg-[#2A2F40]'
              }`}
            >
              {isAuditioning ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isAuditioning ? 'Stop' : 'Preview'}</span>
            </button>

            <button
              type="button"
              onClick={() => void dawController.reverseAudioClip(audioClip.id)}
              className="h-9 rounded-lg bg-[#222633] hover:bg-[#2A2F40] border border-white/[0.08] text-xs font-semibold text-zinc-100 flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Reverse</span>
            </button>

            <button
              type="button"
              onClick={() => void dawController.normalizeAudioClip(audioClip.id)}
              className="h-9 rounded-lg bg-[#222633] hover:bg-[#2A2F40] border border-white/[0.08] text-xs font-semibold text-zinc-100 flex items-center justify-center gap-1.5"
            >
              <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Normalize</span>
            </button>

            <button
              type="button"
              onClick={() => dawController.exportAudioClipWav(audioClip.id)}
              className="h-9 rounded-lg bg-[#222633] hover:bg-[#2A2F40] border border-white/[0.08] text-xs font-semibold text-zinc-100 flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export WAV</span>
            </button>
          </div>
        </div>

        <div className="px-4 py-3 bg-[#141720] border-t border-white/[0.08] flex items-center justify-between gap-2">
          {arrClip ? (
            <button
              type="button"
              onClick={() => {
                void dawController.cropAudioClip(arrClip.id);
                onClose();
              }}
              className="h-9 px-3 rounded-lg bg-[#222633] hover:bg-[#2C3142] text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
            >
              <Scissors className="w-3.5 h-3.5 text-indigo-400" />
              <span>Crop to Clip Region</span>
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                stopPreview();
                onClose();
              }}
              className="h-9 px-3 rounded-lg bg-[#222633] text-xs font-semibold text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                stopPreview();
                void dawController.editAudioClipWithOptions(audioClip.id, arrClip?.id, {
                  trimStartSec,
                  trimEndSec,
                  gainDb,
                });
                onClose();
              }}
              className="h-9 px-4 rounded-lg bg-[#6D5DFB] hover:bg-[#5B4CE6] text-xs font-semibold text-white flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Trim &amp; Gain</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
