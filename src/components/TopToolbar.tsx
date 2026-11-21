import React, { useRef, useState } from 'react';
import {
  Play,
  Square,
  Circle,
  Undo2,
  Redo2,
  Volume2,
  Repeat,
  PanelLeft,
  Download,
  Upload,
  Share2,
  FileDown,
  Sliders,
  LayoutGrid,
  AlignJustify,
  Piano,
  Cpu,
  FolderOpen,
  Minus,
  Plus,
  Hand,
} from 'lucide-react';
import { MobileScreen, QuantizeMode, ViewMode } from '../types/daw';
import { AudioSystemStatus } from '../audio/transportEngine';
import { TouchFader } from './TouchFader';
import { RotaryKnob } from './RotaryKnob';

interface TopToolbarProps {
  projectName: string;
  viewMode: ViewMode;
  mobileScreen: MobileScreen;
  browserOpen: boolean;
  bottomDockMode: 'pianoroll' | 'device' | 'closed';
  isPlaying: boolean;
  isRecording: boolean;
  bpm: number;
  timeSignature: [number, number];
  metronomeEnabled: boolean;
  loopEnabled: boolean;
  quantize: QuantizeMode;
  swingPercent: number;
  currentBeat: number;
  canUndo: boolean;
  canRedo: boolean;
  audioStatus: AudioSystemStatus;
  onSelectViewMode: (mode: ViewMode) => void;
  onSelectMobileScreen: (screen: MobileScreen) => void;
  onToggleBrowser: () => void;
  onToggleBottomDock: (mode: 'pianoroll' | 'device') => void;
  onPlay: () => void;
  onStop: () => void;
  onToggleRecord: () => void;
  onBpmChange: (bpm: number) => void;
  onTimeSigChange: (num: number, den: number) => void;
  onToggleMetronome: () => void;
  onToggleLoop: () => void;
  onQuantizeChange: (q: QuantizeMode) => void;
  onSwingChange: (swingPercent: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportWav: () => void;
  onOpenShareModal?: () => void;
  onImportJsonFile?: (file: File) => void;
  onExportJson?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  projectName,
  viewMode,
  mobileScreen,
  browserOpen,
  bottomDockMode,
  isPlaying,
  isRecording,
  bpm,
  timeSignature,
  metronomeEnabled,
  loopEnabled,
  quantize,
  swingPercent,
  currentBeat,
  canUndo,
  canRedo,
  audioStatus,
  onSelectViewMode,
  onSelectMobileScreen,
  onToggleBrowser,
  onToggleBottomDock,
  onPlay,
  onStop,
  onToggleRecord,
  onBpmChange,
  onTimeSigChange,
  onToggleMetronome,
  onToggleLoop,
  onQuantizeChange,
  onSwingChange,
  onUndo,
  onRedo,
  onExportWav,
  onOpenShareModal,
  onImportJsonFile,
  onExportJson,
}) => {
  const tapTimesRef = useRef<number[]>([]);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showBpmPopover, setShowBpmPopover] = useState(false);

  const beatsPerBar = timeSignature[0] || 4;
  const bar = Math.floor(currentBeat / beatsPerBar) + 1;
  const beatInBar = Math.floor(currentBeat % beatsPerBar) + 1;
  const sixteenth = Math.floor((currentBeat % 1) * 4) + 1;
  const clockText = `${String(bar).padStart(3, '0')}.${beatInBar}.${sixteenth}`;

  const handleTapTempo = () => {
    const now = performance.now();
    const recent = tapTimesRef.current.filter((t) => now - t < 2200);
    recent.push(now);
    tapTimesRef.current = recent.slice(-5);
    if (recent.length >= 2) {
      let sum = 0;
      for (let i = 1; i < recent.length; i++) sum += recent[i] - recent[i - 1];
      const next = Math.round(60000 / (sum / (recent.length - 1)));
      if (next >= 50 && next <= 200) onBpmChange(next);
    }
  };

  const desktopTabs: Array<{ id: ViewMode; label: string; icon: React.ReactNode }> = [
    { id: 'session', label: 'Session', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { id: 'arrangement', label: 'Arrangement', icon: <AlignJustify className="w-3.5 h-3.5" /> },
    { id: 'pianoroll', label: 'Piano Roll', icon: <Piano className="w-3.5 h-3.5" /> },
    { id: 'mixer', label: 'Mixer', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'devices', label: 'Devices', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'browser', label: 'Browser', icon: <FolderOpen className="w-3.5 h-3.5" /> },
  ];

  return (
    <>
      <header className="w-full bg-[#15171E] border-b border-white/[0.08] select-none shrink-0 z-30">
        <div className="px-2 sm:px-3 h-12 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          {/* Zone 1: Browser Toggle + PulseGrid Logo + 6-View Workspace Switcher */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleBrowser}
              aria-pressed={browserOpen}
              aria-label="Toggle Browser Sidebar"
              title="Toggle Browser Sidebar"
              className={`h-8 w-8 rounded flex items-center justify-center border transition-colors ${
                browserOpen
                  ? 'bg-[#6D5DFB] text-white border-[#6D5DFB]'
                  : 'bg-[#111318] text-zinc-300 border-white/[0.08] hover:text-white'
              }`}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 pr-1">
              <div
                className="w-6 h-6 rounded bg-[#6D5DFB] flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <div className="flex items-end gap-[2px] h-3">
                  <span className="w-[2px] h-1.5 bg-white rounded-xs" />
                  <span className="w-[2px] h-3 bg-white rounded-xs" />
                  <span className="w-[2px] h-2 bg-white rounded-xs" />
                  <span className="w-[2px] h-2.5 bg-white rounded-xs" />
                </div>
              </div>
              <span className="font-bold text-sm tracking-tight text-white whitespace-nowrap">
                PulseGrid
              </span>
              <span className="hidden 2xl:inline text-xs text-zinc-500 truncate max-w-[120px]">
                {projectName}
              </span>
            </div>

            {/* Desktop 6-Workspace Switcher */}
            <div
              className="hidden md:flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-0.5"
              role="tablist"
              aria-label="DAW Workspaces"
            >
              {desktopTabs.map((tab) => {
                const active = viewMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onSelectViewMode(tab.id)}
                    className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#6D5DFB] text-white shadow-sm shadow-[#6D5DFB]/25'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {tab.icon}
                    <span className={tab.id === 'session' || tab.id === 'arrangement' ? '' : 'hidden lg:inline'}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Zone 2: Transport Controls + Tempo + Time Sig + Metronome */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Desktop Transport Buttons */}
            <div className="hidden md:flex items-center gap-1 bg-[#101217] border border-white/[0.08] rounded p-0.5">
              <button
                type="button"
                onClick={onPlay}
                aria-label="Global Play"
                className={`h-7 w-8 rounded flex items-center justify-center transition-colors ${
                  isPlaying
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'bg-[#1D202A] text-zinc-200 hover:bg-[#282C3A]'
                }`}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
              <button
                type="button"
                onClick={onStop}
                aria-label="Global Stop"
                className="h-7 w-8 rounded bg-[#1D202A] text-zinc-200 hover:bg-[#282C3A] flex items-center justify-center transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
              </button>
              <button
                type="button"
                onClick={onToggleRecord}
                aria-pressed={isRecording}
                aria-label="Global Record"
                title="Record Session Performance or Armed Audio Track"
                className={`h-7 w-8 rounded flex items-center justify-center transition-colors ${
                  isRecording
                    ? 'bg-rose-600 text-white'
                    : 'bg-[#1D202A] text-rose-400 hover:bg-[#282C3A]'
                }`}
              >
                <Circle className="w-3 h-3 fill-current" />
              </button>
              <button
                type="button"
                onClick={onToggleLoop}
                aria-pressed={loopEnabled}
                aria-label="Toggle Arrangement Loop"
                title="Toggle Arrangement Loop"
                className={`h-7 w-8 rounded flex items-center justify-center border transition-colors ${
                  loopEnabled
                    ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                    : 'bg-[#1D202A] border-transparent text-zinc-400 hover:text-white hover:bg-[#282C3A]'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tempo + Tap (Desktop) */}
            <div className="hidden md:flex items-center bg-[#101217] border border-white/[0.08] rounded h-8 px-1.5 gap-1">
              <button
                type="button"
                onClick={() => onBpmChange(bpm - 1)}
                aria-label="Decrease BPM"
                className="w-5 h-6 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="font-mono-tabular text-xs font-semibold text-zinc-100 w-14 text-center whitespace-nowrap">
                {bpm.toFixed(2).replace(/\.00$/, '.00')}
              </span>
              <button
                type="button"
                onClick={() => onBpmChange(bpm + 1)}
                aria-label="Increase BPM"
                className="w-5 h-6 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={handleTapTempo}
                className="h-6 px-1.5 rounded bg-[#1D202A] text-[10px] font-semibold text-zinc-300 hover:text-white"
              >
                TAP
              </button>
            </div>

            {/* Time Signature */}
            <select
              aria-label="Time signature"
              value={`${timeSignature[0]}/${timeSignature[1]}`}
              onChange={(e) => {
                const [n, d] = e.target.value.split('/').map(Number);
                onTimeSigChange(n, d);
              }}
              className="hidden sm:block h-8 bg-[#101217] border border-white/[0.08] rounded px-1.5 font-mono-tabular text-xs font-semibold text-zinc-200 focus:outline-none"
            >
              <option value="4/4">4/4</option>
              <option value="3/4">3/4</option>
              <option value="6/8">6/8</option>
            </select>

            {/* Launch Quantize */}
            <select
              aria-label="Clip launch quantization"
              value={quantize}
              onChange={(e) => onQuantizeChange(e.target.value as QuantizeMode)}
              className="hidden xl:block h-8 bg-[#101217] border border-white/[0.08] rounded px-1.5 font-mono-tabular text-xs font-semibold text-zinc-300 focus:outline-none"
            >
              <option value="1m">Q: 1 Bar</option>
              <option value="2n">Q: 1/2</option>
              <option value="4n">Q: 1/4</option>
            </select>

            {/* Global Swing / Groove */}
            <div
              className="hidden md:flex items-center bg-[#101217] border border-white/[0.08] rounded h-8 px-2 gap-1.5"
              title="Global Swing / Groove (delays off-beat 16th MIDI notes)"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Swing
              </span>
              <RotaryKnob
                ariaLabel="Global Swing"
                compact
                step={1}
                value={swingPercent}
                min={0}
                max={100}
                defaultValue={0}
                size={22}
                color="#A78BFA"
                displayValue={`${Math.round(swingPercent)}%`}
                onChange={(v) => onSwingChange(Math.round(v))}
              />
              <span className="font-mono-tabular text-[11px] font-semibold text-violet-300 w-8 text-right whitespace-nowrap">
                {Math.round(swingPercent)}%
              </span>
            </div>

            {/* Metronome */}
            <button
              type="button"
              onClick={onToggleMetronome}
              aria-pressed={metronomeEnabled}
              title="Metronome Click"
              className={`h-8 px-2 rounded border text-xs font-semibold flex items-center gap-1 transition-colors ${
                metronomeEnabled
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                  : 'bg-[#101217] border-white/[0.08] text-zinc-400 hover:text-white'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>

            {/* Clock Readout */}
            <div className="h-8 bg-[#101217] border border-white/[0.08] rounded px-2 flex items-center">
              <span className="font-mono-tabular text-xs font-semibold text-zinc-100 whitespace-nowrap">
                {clockText}
              </span>
            </div>
          </div>

          {/* Zone 3: Undo/Redo, Quick Dock, Audio Status, Export */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                className="h-8 w-8 rounded bg-[#101217] border border-white/[0.08] flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                className="h-8 w-8 rounded bg-[#101217] border border-white/[0.08] flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Bottom Panel Toggles on Session/Arrangement */}
            {(viewMode === 'session' || viewMode === 'arrangement') && (
              <div className="hidden lg:flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => onToggleBottomDock('pianoroll')}
                  aria-pressed={bottomDockMode === 'pianoroll'}
                  title="Toggle Bottom Piano Roll"
                  className={`h-7 px-2 rounded text-[11px] font-semibold flex items-center gap-1 ${
                    bottomDockMode === 'pianoroll'
                      ? 'bg-[#2B303A] text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Piano className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onToggleBottomDock('device')}
                  aria-pressed={bottomDockMode === 'device'}
                  title="Toggle Bottom Device Rack"
                  className={`h-7 px-2 rounded text-[11px] font-semibold flex items-center gap-1 ${
                    bottomDockMode === 'device'
                      ? 'bg-[#2B303A] text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Sliders className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Audio Engine Status */}
            <div
              className="hidden 2xl:flex items-center gap-1.5 h-8 px-2 rounded bg-[#101217] border border-white/[0.08] font-mono-tabular text-[11px] text-zinc-400"
              title="Web Audio Context Status"
            >
              <span
                className={
                  audioStatus.state === 'running' ? 'text-emerald-400' : 'text-zinc-500'
                }
              >
                {audioStatus.state === 'running' ? 'AUDIO ON' : 'STANDBY'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{Math.round(audioStatus.sampleRate / 1000)}kHz</span>
              {audioStatus.latencyMs > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{audioStatus.latencyMs}ms</span>
                </>
              )}
            </div>

            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json,.pulsegrid.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onImportJsonFile?.(file);
                  e.target.value = '';
                }
              }}
            />

            <button
              type="button"
              onClick={() => jsonFileInputRef.current?.click()}
              title="Import PulseGrid Composition (.json)"
              className="h-8 px-2.5 rounded bg-[#161822] hover:bg-[#202432] border border-white/[0.08] text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-[#8B5CF6]" />
              <span className="hidden sm:inline">Import JSON</span>
            </button>

            <button
              type="button"
              onClick={onOpenShareModal || onExportJson}
              title="Share or Export Composition JSON"
              className="h-8 px-2.5 rounded bg-[#6D5DFB] hover:bg-[#5B4CE6] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm shadow-[#6D5DFB]/25 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share / Export</span>
            </button>

            <button
              type="button"
              onClick={onExportWav}
              title="Render & Download 16-bit WAV"
              className="hidden xl:flex h-8 px-2 rounded bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold items-center gap-1 whitespace-nowrap transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>WAV</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Compact Transport + Screen Switcher Dock (Preserved Exact Layout) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#181A1F]/95 backdrop-blur-md border-t border-white/[0.1]">
        {showBpmPopover && (
          <div className="px-3 py-2 border-b border-white/[0.08] bg-[#14161A] flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-xs font-bold text-amber-400 w-16 shrink-0">
                {bpm} BPM
              </span>
              <div className="flex-1">
                <TouchFader
                  orientation="horizontal"
                  label="Tempo BPM"
                  ariaLabel="Tempo BPM"
                  value={bpm}
                  min={50}
                  max={200}
                  defaultValue={120}
                  step={1}
                  accentColor="#F59E0B"
                  displayValue={`${bpm} BPM`}
                  onChange={(v) => onBpmChange(Math.round(v))}
                />
              </div>
              <button
                type="button"
                onClick={handleTapTempo}
                className="min-h-[36px] px-2.5 rounded bg-[#252830] text-xs font-semibold text-zinc-200"
              >
                Tap
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-xs font-bold text-violet-300 w-16 shrink-0">
                SWG {Math.round(swingPercent)}%
              </span>
              <div className="flex-1">
                <TouchFader
                  orientation="horizontal"
                  label="Swing Groove"
                  ariaLabel="Mobile Global Swing"
                  value={swingPercent}
                  min={0}
                  max={100}
                  defaultValue={0}
                  step={1}
                  accentColor="#A78BFA"
                  displayValue={`${Math.round(swingPercent)}%`}
                  onChange={(v) => onSwingChange(Math.round(v))}
                />
              </div>
              <button
                type="button"
                onClick={() => onSwingChange(0)}
                className="min-h-[36px] px-2 rounded bg-[#252830] text-xs font-semibold text-zinc-300"
              >
                0%
              </button>
            </div>
          </div>
        )}

        <div className="px-1.5 pt-1.5 pb-1 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onPlay}
              aria-label="Play"
              className={`min-h-[42px] min-w-[36px] px-2 rounded flex items-center justify-center ${
                isPlaying ? 'bg-emerald-500 text-zinc-950' : 'bg-[#252830] text-zinc-100'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
            </button>
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="min-h-[42px] min-w-[34px] rounded bg-[#252830] text-zinc-200 flex items-center justify-center"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
            <button
              type="button"
              onClick={onToggleRecord}
              aria-label="Record"
              className={`min-h-[42px] min-w-[34px] rounded flex items-center justify-center ${
                isRecording ? 'bg-rose-600 text-white' : 'bg-[#252830] text-rose-400'
              }`}
            >
              <Circle className="w-3.5 h-3.5 fill-current" />
            </button>
            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={loopEnabled}
              aria-label="Loop"
              title="Toggle Loop"
              className={`min-h-[42px] min-w-[34px] rounded border flex items-center justify-center transition-colors ${
                loopEnabled
                  ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                  : 'bg-[#252830] border-transparent text-zinc-400'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowBpmPopover((v) => !v)}
            aria-label="Tempo and Swing controls"
            className="min-h-[42px] px-1.5 rounded bg-[#111214] border border-white/[0.08] font-mono-tabular text-[11px] font-semibold text-amber-400 flex items-center gap-0.5 shrink-0"
          >
            <span>{bpm}</span>
            <span className="hidden xs:inline text-[9px] text-amber-400/75">BPM</span>
            {swingPercent > 0 && (
              <span className="text-violet-300 text-[9px]">·{Math.round(swingPercent)}%</span>
            )}
          </button>

          <div className="grid grid-cols-4 gap-0.5 bg-[#111214] border border-white/[0.08] rounded p-0.5 shrink-0">
            {(
              [
                { id: 'session', label: 'Sess' },
                { id: 'arrangement', label: 'Arr' },
                { id: 'pianoroll', label: 'MIDI' },
                { id: 'mixer', label: 'Mix' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectMobileScreen(tab.id)}
                className={`min-h-[38px] px-1.5 rounded text-[10px] font-semibold transition-colors ${
                  mobileScreen === tab.id
                    ? 'bg-[#2B303A] text-white'
                    : 'text-zinc-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
