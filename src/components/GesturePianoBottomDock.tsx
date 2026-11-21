import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Circle,
  ExternalLink,
  Music,
  Play,
  Sliders,
  Square,
  Wand2,
} from 'lucide-react';
import {
  GridResolution,
  MidiClip,
  ProjectState,
  TrackModel,
} from '../types/daw';
import { AudioSystemStatus } from '../audio/transportEngine';
import { AudioDiagnosticsSnapshot, LiveMidiRecordingState } from '../audio/dawController';
import { MAX_PIANO_POLYPHONY } from '../audio/midiEngine';
import { GesturePerformanceMetrics } from '../vision/fingerPianoEngine';

export interface GesturePianoBottomDockProps {
  project: ProjectState;
  selectedTrack: TrackModel | null;
  editingMidiClip: MidiClip | null;
  isPlaying: boolean;
  currentBeat: number;
  audioStatus: AudioSystemStatus;
  audioDiag: AudioDiagnosticsSnapshot;
  liveMidiRecording: LiveMidiRecordingState | null;
  perfMetrics: GesturePerformanceMetrics;
  isCameraActive: boolean;
  recordTarget: 'session' | 'arrangement';
  onChangeRecordTarget: (target: 'session' | 'arrangement') => void;
  onSelectTrack: (trackId: string) => void;
  onSetTrackVolume: (trackId: string, db: number) => void;
  onSetMasterVolume: (db: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onPlay: () => void;
  onStop: () => void;
  onStartLiveRecording: (target: 'session' | 'arrangement', trackId: string) => void;
  onStopLiveRecording: () => void;
  onQuantizeClip: (clipId: string, grid: GridResolution) => void;
  onOpenPianoRoll?: () => void;
  onPanicNotes: () => void;
  getTrackMeter: (trackId: string) => number;
  getMasterMeter: () => number;
  mobileSection?: 'all' | 'mixer' | 'midi' | 'perf';
}

function formatTimer(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const GesturePianoBottomDock: React.FC<GesturePianoBottomDockProps> = ({
  project,
  selectedTrack,
  editingMidiClip,
  isPlaying,
  currentBeat,
  audioStatus,
  audioDiag,
  liveMidiRecording,
  perfMetrics,
  isCameraActive,
  recordTarget,
  onChangeRecordTarget,
  onSelectTrack,
  onSetTrackVolume,
  onSetMasterVolume,
  onToggleMute,
  onToggleSolo,
  onPlay,
  onStop,
  onStartLiveRecording,
  onStopLiveRecording,
  onQuantizeClip,
  onOpenPianoRoll,
  onPanicNotes,
  getTrackMeter,
  getMasterMeter,
  mobileSection = 'all',
}) => {
  const [midiTab, setMidiTab] = useState<'recording' | 'playback' | 'quantize'>('recording');
  const [quantGrid, setQuantGrid] = useState<GridResolution>('1/16');
  const [recordElapsedSec, setRecordElapsedSec] = useState(0);
  const [trackMeters, setTrackMeters] = useState<Record<string, number>>({});
  const [masterMeter, setMasterMeter] = useState(0);
  const [perfHistory, setPerfHistory] = useState<number[]>([]);
  const lastMeterUpdateRef = useRef(0);

  // Elapsed timer during active MIDI recording
  useEffect(() => {
    if (!liveMidiRecording?.active) {
      setRecordElapsedSec(0);
      return;
    }
    const started = Date.now();
    setRecordElapsedSec(0);
    const id = window.setInterval(() => {
      setRecordElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [liveMidiRecording?.active, liveMidiRecording?.clipId]);

  // Smooth ~20Hz audio level meters via rAF
  useEffect(() => {
    let rafId = 0;
    const tick = (now: number) => {
      if (now - lastMeterUpdateRef.current >= 50) {
        lastMeterUpdateRef.current = now;
        const nextMeters: Record<string, number> = {};
        for (const t of project.tracks) {
          nextMeters[t.id] = getTrackMeter(t.id);
        }
        setTrackMeters(nextMeters);
        setMasterMeter(getMasterMeter());
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [project.tracks, getTrackMeter, getMasterMeter]);

  // Track real performance waveform history (FPS / active load)
  useEffect(() => {
    if (!isCameraActive && perfMetrics.cameraFps <= 0) return;
    setPerfHistory((prev) => {
      const normalized = Math.max(8, Math.min(100, (perfMetrics.cameraFps / 60) * 85));
      const next = [...prev, normalized];
      if (next.length > 26) next.shift();
      return next;
    });
  }, [isCameraActive, perfMetrics.cameraFps, perfMetrics.inferenceMs]);

  // Show selected track + up to 3 other tracks cleanly in compact mixer dock
  const visibleTracks = useMemo(() => {
    if (project.tracks.length <= 4) return project.tracks;
    const base = project.tracks.slice(0, 4);
    if (selectedTrack && !base.some((t) => t.id === selectedTrack.id)) {
      return [...project.tracks.slice(0, 3), selectedTrack];
    }
    return base;
  }, [project.tracks, selectedTrack]);

  // Resolve clip shown in live MIDI Piano Roll preview
  const previewClip: MidiClip | null = useMemo(() => {
    if (liveMidiRecording?.clipId && project.midiClips[liveMidiRecording.clipId]) {
      return project.midiClips[liveMidiRecording.clipId];
    }
    if (selectedTrack) {
      for (const slotCid of selectedTrack.sessionSlots) {
        if (slotCid && project.midiClips[slotCid]) {
          return project.midiClips[slotCid];
        }
      }
    }
    if (editingMidiClip) return editingMidiClip;
    const all = Object.values(project.midiClips);
    return all[0] ?? null;
  }, [liveMidiRecording?.clipId, project.midiClips, selectedTrack, editingMidiClip]);

  const isRecordingActive = Boolean(liveMidiRecording?.active);
  const clipLength = Math.max(4, previewClip?.lengthBeats ?? 4);
  const playheadPct = Math.max(0, Math.min(100, ((currentBeat % clipLength) / clipLength) * 100));

  const mixerVisible = mobileSection === 'all' || mobileSection === 'mixer';
  const midiVisible = mobileSection === 'all' || mobileSection === 'midi';
  const perfVisible = mobileSection === 'all' || mobileSection === 'perf';

  const perfPolyline = useMemo(() => {
    const pts = perfHistory.length > 1 ? perfHistory : [0, 0];
    const width = 220;
    const height = 44;
    const coords = pts.map((v, idx) => {
      const x = (idx / Math.max(1, pts.length - 1)) * width;
      const y = height - (v / 100) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      line: coords.join(' '),
      area: `0,${height} ${coords.join(' ')} ${width},${height}`,
    };
  }, [perfHistory]);

  return (
    <div className="shrink-0 border-t border-white/[0.08] bg-[#111319] p-2 grid grid-cols-1 lg:grid-cols-12 gap-2">
      {/* 1. COMPACT MIXER PANEL (4 cols on desktop) */}
      {mixerVisible && (
        <section
          aria-label="Gesture Piano Mixer"
          className="lg:col-span-4 rounded bg-[#151822] border border-white/[0.08] flex flex-col overflow-hidden"
        >
          <div className="h-7 px-2.5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
              <Sliders className="w-3.5 h-3.5 text-[#8B5CF6]" />
              <span>Mixer</span>
            </div>
            <span className="text-[10px] font-mono-tabular text-zinc-500">
              {project.tracks.length} Tracks · Master
            </span>
          </div>

          <div className="p-2 flex items-stretch gap-1.5 overflow-x-auto no-scrollbar">
            {visibleTracks.map((t) => {
              const isSelected = selectedTrack?.id === t.id;
              const meter = trackMeters[t.id] ?? 0;
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTrack(t.id)}
                  className={`flex-1 min-w-[58px] rounded border px-1.5 py-1.5 flex flex-col gap-1 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#1D2130] border-[#8B5CF6]/50'
                      : 'bg-[#11131B] border-white/[0.06] hover:border-white/[0.14]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="text-[10px] font-semibold text-zinc-200 truncate">
                      {t.name}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 h-[62px]">
                    {/* Compact vertical volume fader */}
                    <div className="flex flex-col items-center justify-between h-full">
                      <input
                        type="range"
                        min={-36}
                        max={6}
                        step={0.5}
                        value={t.volumeDb}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onSetTrackVolume(t.id, Number(e.target.value))}
                        aria-label={`${t.name} volume`}
                        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                        className="h-12 w-3 accent-[#8B5CF6] cursor-pointer"
                      />
                    </div>

                    {/* Level Meter */}
                    <div className="w-2 h-12 rounded-sm bg-[#0A0C11] border border-white/[0.06] overflow-hidden flex flex-col justify-end">
                      <div
                        className="w-full transition-all duration-75"
                        style={{
                          height: `${Math.min(100, Math.round(meter * 100))}%`,
                          background:
                            meter > 0.85
                              ? 'linear-gradient(to top, #22C55E, #FACC15 70%, #EF4444)'
                              : 'linear-gradient(to top, #10B981, #22C55E 65%, #A3E635)',
                        }}
                      />
                    </div>

                    {/* Solo & Mute */}
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSolo(t.id);
                        }}
                        className={`w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center transition-colors ${
                          t.solo
                            ? 'bg-amber-400 text-zinc-950'
                            : 'bg-[#1B1E29] text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMute(t.id);
                        }}
                        className={`w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center transition-colors ${
                          t.muted
                            ? 'bg-rose-500 text-white'
                            : 'bg-[#1B1E29] text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        M
                      </button>
                    </div>
                  </div>

                  <span className="text-[9px] font-mono-tabular text-zinc-400 text-center">
                    {t.volumeDb > 0 ? `+${t.volumeDb.toFixed(1)}` : t.volumeDb.toFixed(1)} dB
                  </span>
                </div>
              );
            })}

            {/* Master Strip */}
            <div className="min-w-[66px] rounded border border-[#6D5DFB]/40 bg-[#171A26] px-1.5 py-1.5 flex flex-col gap-1 shrink-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-bold text-indigo-200">Master</span>
                <span className="text-[8px] font-mono-tabular text-emerald-400">-1dB</span>
              </div>

              <div className="flex items-center justify-center gap-2 h-[62px]">
                <input
                  type="range"
                  min={-36}
                  max={0}
                  step={0.5}
                  value={project.masterVolumeDb}
                  onChange={(e) => onSetMasterVolume(Number(e.target.value))}
                  aria-label="Master Volume"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                  className="h-12 w-3 accent-[#6D5DFB] cursor-pointer"
                />
                <div className="w-2.5 h-12 rounded-sm bg-[#0A0C11] border border-white/[0.08] overflow-hidden flex flex-col justify-end">
                  <div
                    className="w-full transition-all duration-75"
                    style={{
                      height: `${Math.min(100, Math.round(masterMeter * 100))}%`,
                      background:
                        audioDiag.clipping
                          ? '#EF4444'
                          : 'linear-gradient(to top, #10B981, #22C55E 65%, #FACC15)',
                    }}
                  />
                </div>
              </div>

              <span className="text-[9px] font-mono-tabular text-zinc-200 text-center font-semibold">
                {project.masterVolumeDb.toFixed(1)} dB
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 2. MIDI RECORDING + PIANO ROLL PREVIEW (5 cols on desktop) */}
      {midiVisible && (
        <section
          aria-label="MIDI Recording and Piano Roll Preview"
          className="lg:col-span-5 rounded bg-[#151822] border border-white/[0.08] flex flex-col overflow-hidden"
        >
          <div className="h-7 px-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs font-bold text-zinc-200">
                <Music className="w-3.5 h-3.5 text-[#8B5CF6]" />
                <span>MIDI</span>
              </div>
              <div className="flex items-center bg-[#0F1118] border border-white/[0.07] rounded p-0.5 gap-0.5">
                {(['recording', 'playback', 'quantize'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMidiTab(t)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize transition-colors ${
                      midiTab === t
                        ? 'bg-[#6D5DFB] text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {onOpenPianoRoll && (
              <button
                type="button"
                onClick={onOpenPianoRoll}
                className="text-[10px] font-semibold text-indigo-300 hover:text-white flex items-center gap-1 shrink-0"
              >
                <span>Open Editor</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {/* Active MIDI Tab Bar */}
          <div className="px-2.5 py-1.5 border-b border-white/[0.05] flex items-center justify-between gap-2 text-[11px] bg-[#131620]">
            {midiTab === 'recording' && (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isRecordingActive ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'
                    }`}
                  />
                  <span className="font-mono-tabular text-zinc-200 truncate">
                    {isRecordingActive
                      ? `Recording... ${formatTimer(recordElapsedSec)} (${liveMidiRecording?.noteCount ?? 0} notes)`
                      : `Ready · ${selectedTrack?.name ?? 'Track'}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <select
                    aria-label="MIDI recording destination"
                    value={recordTarget}
                    onChange={(e) =>
                      onChangeRecordTarget(e.target.value as 'session' | 'arrangement')
                    }
                    className="h-6 bg-[#0F1118] border border-white/[0.08] rounded px-1.5 text-[10px] font-semibold text-zinc-300 focus:outline-none"
                  >
                    <option value="session">Session</option>
                    <option value="arrangement">Arrangement</option>
                  </select>
                  {selectedTrack && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isRecordingActive) {
                          onStopLiveRecording();
                        } else {
                          onStartLiveRecording(recordTarget, selectedTrack.id);
                        }
                      }}
                      className={`h-6 px-2.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                        isRecordingActive
                          ? 'bg-zinc-100 text-zinc-950 hover:bg-white'
                          : 'bg-rose-600 hover:bg-rose-500 text-white'
                      }`}
                    >
                      {isRecordingActive ? (
                        <>
                          <Square className="w-2.5 h-2.5 fill-current" />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Circle className="w-2.5 h-2.5 fill-current" />
                          <span>Rec MIDI</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </>
            )}

            {midiTab === 'playback' && (
              <>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={isPlaying ? onStop : onPlay}
                    className={`h-6 px-2.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                      isPlaying
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-[#252938] text-zinc-100 hover:bg-[#31364A]'
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Square className="w-2.5 h-2.5 fill-current" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-2.5 h-2.5 fill-current" />
                        <span>Play</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onPanicNotes}
                    className="h-6 px-2 rounded bg-[#1E2230] border border-white/[0.08] text-[10px] font-semibold text-zinc-300 hover:text-white"
                  >
                    Panic
                  </button>
                </div>
                <span className="font-mono-tabular text-[10px] text-zinc-400 truncate">
                  {previewClip ? `${previewClip.name} · ${previewClip.notes.length} notes` : 'No clip selected'}
                </span>
              </>
            )}

            {midiTab === 'quantize' && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-400">Grid</span>
                  <select
                    aria-label="Quantize grid resolution"
                    value={quantGrid}
                    onChange={(e) => setQuantGrid(e.target.value as GridResolution)}
                    className="h-6 bg-[#0F1118] border border-white/[0.08] rounded px-1.5 font-mono-tabular text-[10px] text-zinc-200"
                  >
                    <option value="1/4">1/4</option>
                    <option value="1/8">1/8</option>
                    <option value="1/16">1/16</option>
                    <option value="1/32">1/32</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={!previewClip}
                  onClick={() => {
                    if (previewClip) onQuantizeClip(previewClip.id, quantGrid);
                  }}
                  className="h-6 px-2.5 rounded bg-[#6D5DFB] hover:bg-[#5B4CE6] disabled:opacity-40 text-white text-[10px] font-semibold flex items-center gap-1"
                >
                  <Wand2 className="w-2.5 h-2.5" />
                  <span>Apply Quantize</span>
                </button>
              </>
            )}
          </div>

          {/* Live Piano Roll Preview */}
          <div className="flex-1 min-h-[78px] flex bg-[#0E1017] overflow-hidden">
            {/* Left Octave Reference */}
            <div className="w-8 bg-[#181B25] border-r border-white/[0.08] flex flex-col justify-between py-1 px-1 text-[8px] font-mono-tabular text-zinc-400 shrink-0">
              <span>C6</span>
              <span>C4</span>
              <span>C2</span>
            </div>

            {/* Grid + Real Notes */}
            <div
              onClick={onOpenPianoRoll}
              title="Click to open full MIDI Piano Roll editor"
              className="relative flex-1 overflow-hidden cursor-pointer"
            >
              {/* Subtle Beat Grid */}
              <div className="absolute inset-0 grid grid-cols-8 pointer-events-none">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`border-r ${
                      idx % 4 === 3 ? 'border-white/[0.08]' : 'border-white/[0.03]'
                    }`}
                  />
                ))}
              </div>
              <div className="absolute inset-0 grid grid-rows-4 pointer-events-none">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="border-b border-white/[0.03]" />
                ))}
              </div>

              {/* Clip Notes */}
              {previewClip && previewClip.notes.length > 0 ? (
                previewClip.notes.map((n) => {
                  const leftPct = Math.max(0, Math.min(99, (n.startBeat / clipLength) * 100));
                  const widthPct = Math.max(1.5, Math.min(100 - leftPct, (n.durationBeats / clipLength) * 100));
                  // Map MIDI 36..96 vertically inside preview
                  const pitchNorm = Math.max(0, Math.min(1, (n.pitch - 36) / 60));
                  const topPct = (1 - pitchNorm) * 84 + 4;
                  const isLeftCh = n.channel === 1;
                  return (
                    <div
                      key={n.id}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: `${topPct}%`,
                      }}
                      className={`absolute h-[5px] rounded-[1px] ${
                        isLeftCh ? 'bg-[#8B5CF6]' : 'bg-[#6D5DFB]'
                      }`}
                    />
                  );
                })
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-500">
                  Play notes or press Rec MIDI to capture performance
                </div>
              )}

              {/* Playhead (always visible at current transport position) */}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[#FF8C24] shadow-[0_0_8px_rgba(255,140,36,0.7)] pointer-events-none z-10"
              >
                <div className="w-2 h-2 -ml-[3px] bg-[#FF8C24] rotate-45 -mt-1" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. PERFORMANCE MONITOR (3 cols on desktop) */}
      {perfVisible && (
        <section
          aria-label="Performance Monitor"
          className="lg:col-span-3 rounded bg-[#151822] border border-white/[0.08] flex flex-col overflow-hidden"
        >
          <div className="h-7 px-2.5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Performance Monitor</span>
            </div>
            <span
              className={`text-[9px] font-mono-tabular font-semibold uppercase ${
                audioDiag.clipping
                  ? 'text-rose-400'
                  : audioDiag.limiterEngaged
                    ? 'text-amber-300'
                    : audioStatus.state === 'running'
                      ? 'text-emerald-400'
                      : 'text-zinc-500'
              }`}
            >
              {audioDiag.clipping
                ? 'Clip'
                : audioDiag.limiterEngaged
                  ? 'Limit'
                  : audioStatus.state === 'running'
                    ? 'DSP Clean'
                    : 'Standby'}
            </span>
          </div>

          <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
            <div className="flex flex-col gap-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isCameraActive && perfMetrics.cameraFps > 0 ? 'bg-emerald-400' : 'bg-zinc-600'
                    }`}
                  />
                  <span>Camera FPS</span>
                </span>
                <span className="font-mono-tabular font-semibold text-zinc-100">
                  {perfMetrics.cameraFps > 0 ? `${perfMetrics.cameraFps} fps` : '0 fps'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span>Inference Time</span>
                </span>
                <span className="font-mono-tabular font-semibold text-zinc-100">
                  {perfMetrics.inferenceMs > 0 ? `${perfMetrics.inferenceMs.toFixed(1)} ms` : '0.0 ms'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                  <span>Audio Latency</span>
                </span>
                <span className="font-mono-tabular font-semibold text-zinc-100">
                  {audioDiag.outputLatencyMs > 0
                    ? `${audioDiag.outputLatencyMs.toFixed(0)} ms`
                    : audioStatus.latencyMs > 0
                      ? `${audioStatus.latencyMs.toFixed(0)} ms`
                      : `${audioStatus.baseLatencyMs.toFixed(1)} ms`}
                  <span className="text-zinc-500 ml-1">
                    · {((audioDiag.sampleRate || audioStatus.sampleRate || 48000) / 1000).toFixed(1)}kHz
                  </span>
                </span>
              </div>
            </div>

            {/* Real DSP / Peak / RMS / Voices Strip */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono-tabular text-zinc-400 pt-1 border-t border-white/[0.06]">
              <span>
                Voices:{' '}
                <strong className="text-indigo-300">
                  {audioDiag.activeVoices}/{MAX_PIANO_POLYPHONY}
                </strong>
              </span>
              <span className="text-right">
                RMS:{' '}
                <strong className="text-zinc-200">
                  {audioDiag.rmsDb <= -100 ? '-inf' : `${audioDiag.rmsDb.toFixed(1)}dB`}
                </strong>
              </span>
              <span>
                In:{' '}
                <strong className="text-sky-300">
                  {audioDiag.inputPeakDb <= -100 ? '-inf' : `${audioDiag.inputPeakDb.toFixed(1)}dB`}
                </strong>
              </span>
              <span className="text-right">
                Out:{' '}
                <strong className={audioDiag.clipping ? 'text-rose-400' : 'text-emerald-300'}>
                  {audioDiag.masterPeakDb <= -100 ? '-inf' : `${audioDiag.masterPeakDb.toFixed(1)}dB`}
                </strong>
              </span>
            </div>

            {/* Real Telemetry Activity Curve */}
            <div className="h-11 rounded bg-[#0D1017] border border-white/[0.06] overflow-hidden relative">
              <svg
                viewBox="0 0 220 44"
                preserveAspectRatio="none"
                className="w-full h-full"
              >
                <defs>
                  <linearGradient id="pgPerfArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {perfHistory.length > 1 ? (
                  <>
                    <polygon points={perfPolyline.area} fill="url(#pgPerfArea)" />
                    <polyline
                      fill="none"
                      stroke="#34D399"
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                      points={perfPolyline.line}
                    />
                  </>
                ) : (
                  <line
                    x1="0"
                    y1="38"
                    x2="220"
                    y2="38"
                    stroke="rgba(148,163,184,0.22)"
                    strokeWidth="1"
                  />
                )}
              </svg>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
