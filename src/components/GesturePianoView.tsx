import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Crosshair,
  FlipHorizontal2,
  Circle,
  Square,
  Sliders,
  Volume2,
  Piano,
  Disc,
  Waves,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  SwitchCamera,
  RotateCcw,
  Info,
  Power,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Play,
  Activity,
  Music,
  ChevronDown,
} from 'lucide-react';
import {
  EffectConfig,
  EffectType,
  GesturePianoPreset,
  GridResolution,
  InstrumentConfig,
  MidiClip,
  ProjectState,
} from '../types/daw';
import { midiToNoteName } from '../data/presets';
import { AudioSystemStatus } from '../audio/transportEngine';
import { AudioDiagnosticsSnapshot, LiveMidiRecordingState } from '../audio/dawController';
import {
  MAX_SAFE_MIDI_VELOCITY,
  normalizePianoPreset,
} from '../audio/midiEngine';
import {
  CameraDiagnostics,
  CameraErrorInfo,
  CameraFacingMode,
  HandTrackingEngine,
  TrackingStatus,
  VideoPlaybackStatus,
} from '../vision/handTrackingEngine';
import {
  GestureInstrumentMode,
  GestureMidiEvent,
  GesturePianoConfig,
  KeyboardSpanMode,
  VelocityMode,
} from '../vision/gestureKinematicsCore';
import {
  FingerPianoEngine,
  GesturePerformanceMetrics,
} from '../vision/fingerPianoEngine';
import { GesturePianoKeyboard, getKeyboardRange } from './GesturePianoKeyboard';
import { GesturePianoBottomDock } from './GesturePianoBottomDock';

interface GesturePianoViewProps {
  project: ProjectState;
  selectedTrackId: string;
  editingMidiClip: MidiClip | null;
  isPlaying: boolean;
  currentBeat: number;
  audioStatus: AudioSystemStatus;
  liveMidiRecording: LiveMidiRecordingState | null;
  activeVoiceCount: number;
  onGetAudioDiagnostics?: (trackId?: string) => AudioDiagnosticsSnapshot;
  onSelectTrack: (trackId: string) => void;
  onSetInstrumentType: (trackId: string, type: InstrumentConfig['type']) => void;
  onUpdateInstrumentParams: (
    trackId: string,
    patch: Partial<InstrumentConfig['params']>
  ) => void;
  onSetTrackVolume: (trackId: string, db: number) => void;
  onSetMasterVolume: (db: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onAddEffect: (trackId: string, type: EffectType) => void;
  onUpdateEffect: (
    trackId: string,
    effectId: string,
    patch: Partial<EffectConfig> & { paramPatch?: Record<string, number | string> }
  ) => void;
  onLiveNoteOn: (trackId: string, pitch: number, velocity: number, channel?: number) => void;
  onLiveNoteOff: (trackId: string, pitch: number) => void;
  onSetSustain: (trackId: string, active: boolean) => void;
  onPanicNotes: (trackId?: string) => void;
  onPlay: () => void;
  onStop: () => void;
  onStartLiveRecording: (target: 'session' | 'arrangement', trackId: string) => void;
  onStopLiveRecording: () => void;
  onQuantizeClip: (clipId: string, grid: GridResolution) => void;
  onOpenPianoRoll?: () => void;
  onWarmupAudio?: () => void;
  getTrackMeter: (trackId: string) => number;
  getMasterMeter: () => number;
}

const PIANO_PRESET_DEFAULTS: Record<
  GesturePianoPreset,
  { label: string; patch: Partial<InstrumentConfig['params']> }
> = {
  acousticPiano: {
    label: 'Acoustic Piano',
    patch: {
      pianoPreset: 'acousticPiano',
      attack: 0.008,
      decay: 0.72,
      sustain: 0.24,
      release: 0.55,
      cutoff: 3200,
      resonance: 0.7,
    },
  },
  electricPiano: {
    label: 'Electric Piano',
    patch: {
      pianoPreset: 'electricPiano',
      attack: 0.01,
      decay: 0.62,
      sustain: 0.34,
      release: 0.45,
      cutoff: 2400,
      resonance: 0.7,
    },
  },
  synthPiano: {
    label: 'Synth Piano',
    patch: {
      pianoPreset: 'synthPiano',
      waveform: 'triangle',
      attack: 0.008,
      decay: 0.58,
      sustain: 0.28,
      release: 0.45,
      cutoff: 3800,
      resonance: 0.8,
    },
  },
  softPiano: {
    label: 'Soft Piano',
    patch: {
      pianoPreset: 'softPiano',
      attack: 0.022,
      decay: 0.55,
      sustain: 0.42,
      release: 0.58,
      cutoff: 1450,
      resonance: 0.65,
    },
  },
};

export const GesturePianoView: React.FC<GesturePianoViewProps> = ({
  project,
  selectedTrackId,
  editingMidiClip,
  isPlaying,
  currentBeat,
  audioStatus,
  liveMidiRecording,
  activeVoiceCount,
  onGetAudioDiagnostics,
  onSelectTrack,
  onSetInstrumentType,
  onUpdateInstrumentParams,
  onSetTrackVolume,
  onSetMasterVolume,
  onToggleMute,
  onToggleSolo,
  onAddEffect,
  onUpdateEffect,
  onLiveNoteOn,
  onLiveNoteOff,
  onSetSustain,
  onPanicNotes,
  onPlay,
  onStop,
  onStartLiveRecording,
  onStopLiveRecording,
  onQuantizeClip,
  onOpenPianoRoll,
  onWarmupAudio,
  getTrackMeter,
  getMasterMeter,
}) => {
  const tracks = project.tracks;
  const midiTracks = useMemo(() => tracks.filter((t) => t.type === 'midi'), [tracks]);
  const activeTrack =
    midiTracks.find((t) => t.id === selectedTrackId) ??
    midiTracks.find((t) => t.instrument.type === 'gesturePiano') ??
    midiTracks[0] ??
    tracks[0] ??
    null;

  const trackIdRef = useRef<string>(activeTrack?.id ?? '');
  useEffect(() => {
    trackIdRef.current = activeTrack?.id ?? '';
  }, [activeTrack?.id]);

  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle');
  const [trackingMessage, setTrackingMessage] = useState<string>('');
  const [perfMetrics, setPerfMetrics] = useState<GesturePerformanceMetrics>({
    cameraFps: 0,
    inferenceMs: 0,
    confidence: 0,
    gestureMs: 0,
    fingerToMidiMs: 0,
    activeMidiNotes: 0,
    processingWidth: 480,
    processingHeight: 360,
    pipelineMode: 'worker-gpu',
    handCount: 0,
    detectedFingertips: 0,
    confidenceHistory: [],
  });
  const [mirrored, setMirrored] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('user');
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics | null>(null);
  const [cameraError, setCameraError] = useState<CameraErrorInfo | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoPlaybackStatus>({
    hasStream: false,
    playing: false,
    readyState: 0,
    width: 0,
    height: 0,
    trackState: 'none',
    trackLabel: '',
    facingMode: 'user',
  });
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [showAdvancedTracking, setShowAdvancedTracking] = useState<boolean>(false);
  const [fullScreenMode, setFullScreenMode] = useState<boolean>(false);
  const [mobilePanel, setMobilePanel] = useState<'none' | 'controls' | 'mixer' | 'midi' | 'perf'>('none');
  const [trackingSensitivity, setTrackingSensitivity] = useState<number>(0.6);
  const [sustainOn, setSustainOn] = useState<boolean>(false);

  const [leftActivePitches, setLeftActivePitches] = useState<Set<number>>(new Set());
  const [rightActivePitches, setRightActivePitches] = useState<Set<number>>(new Set());
  const [leftHoverPitches, setLeftHoverPitches] = useState<Set<number>>(new Set());
  const [rightHoverPitches, setRightHoverPitches] = useState<Set<number>>(new Set());
  const [pointerPitches, setPointerPitches] = useState<Set<number>>(new Set());
  const pointerPitchesRef = useRef<Set<number>>(new Set());

  const [recordTarget, setRecordTarget] = useState<'session' | 'arrangement'>('session');
  const [audioDiag, setAudioDiag] = useState<AudioDiagnosticsSnapshot>(() =>
    onGetAudioDiagnostics
      ? onGetAudioDiagnostics(activeTrack?.id)
      : {
          inputPeakDb: -120,
          masterPeakDb: -120,
          masterPeakLinear: 0,
          rmsDb: -120,
          preLimiterPeakDb: -120,
          masterVolumeDb: -12,
          activeVoices: activeVoiceCount,
          sampleRate: audioStatus.sampleRate,
          outputLatencyMs: audioStatus.latencyMs || audioStatus.baseLatencyMs,
          audioContextState: 'standby',
          clipping: false,
          limiterEngaged: false,
          activeEffects: [],
          processingStatus: 'standby',
        }
  );

  const triggerManualNoteOn = useCallback(
    (pitch: number, velocity: number, channel: number) => {
      if (!activeTrack) return;
      const clampedVel = Math.max(1, Math.min(MAX_SAFE_MIDI_VELOCITY, Math.round(velocity)));
      if (!pointerPitchesRef.current.has(pitch)) {
        pointerPitchesRef.current.add(pitch);
        setPointerPitches(new Set(pointerPitchesRef.current));
      }
      onLiveNoteOn(activeTrack.id, pitch, clampedVel, channel);
    },
    [activeTrack, onLiveNoteOn]
  );

  const triggerManualNoteOff = useCallback(
    (pitch: number) => {
      if (!activeTrack) return;
      if (pointerPitchesRef.current.has(pitch)) {
        pointerPitchesRef.current.delete(pitch);
        setPointerPitches(new Set(pointerPitchesRef.current));
      }
      onLiveNoteOff(activeTrack.id, pitch);
    },
    [activeTrack, onLiveNoteOff]
  );

  const [gestureConfig, setGestureConfig] = useState<GesturePianoConfig>({
    mode: 'piano',
    spanMode: '2-oct',
    leftOctave: 3,
    rightOctave: 4,
    sidewaysOctaveShift: true,
    planeY: 0.62,
    pressSensitivity: 0.72,
    velocityMode: 'dynamic',
    velocitySensitivity: 0.9,
    fixedVelocity: 94,
    smoothing: 0.14,
    scaleQuantize: 'chromatic',
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef<HandTrackingEngine | null>(null);
  const fingerEngineRef = useRef<FingerPianoEngine | null>(null);

  const handleMidiEvents = useCallback(
    (events: GestureMidiEvent[]) => {
      const tid = trackIdRef.current;
      if (!tid) return;
      for (const ev of events) {
        if (ev.type === 'noteOn') {
          onLiveNoteOn(tid, ev.pitch, ev.velocity, ev.channel);
        } else {
          onLiveNoteOff(tid, ev.pitch);
        }
      }
    },
    [onLiveNoteOn, onLiveNoteOff]
  );

  // Initialize reusable FingerPianoEngine and HandTrackingEngine once, cleanup on unmount
  useEffect(() => {
    const renderCanvasOverlay = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const fe = fingerEngineRef.current;
      if (!canvas || !video || !fe) return;
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw;
        canvas.height = vh;
      }
      fe.drawOverlay(canvas);
    };

    const fingerEngine = new FingerPianoEngine(gestureConfig, {
      onMidiEvents: handleMidiEvents,
      onHandKeyboardState: (state) => {
        setLeftActivePitches(state.leftActive);
        setRightActivePitches(state.rightActive);
        setLeftHoverPitches(state.leftHover);
        setRightHoverPitches(state.rightHover);
      },
      onCalibrationComplete: (suggestedY) => {
        setGestureConfig((prev) => ({ ...prev, planeY: Math.round(suggestedY * 100) / 100 }));
        setTrackingMessage('Strike plane calibrated to hand position');
      },
      onCalibrationChange: (active) => {
        trackerRef.current?.setCollectingCalibration(active);
      },
    });
    fingerEngineRef.current = fingerEngine;

    const tracker = new HandTrackingEngine({
      onStatusChange: (status, msg) => {
        setTrackingStatus(status);
        if (msg) setTrackingMessage(msg);
        if (status !== 'active') {
          fingerEngine.resetAllNotes();
          trackerRef.current?.resetWorkerKinematics();
        }
      },
      onDiagnosticsChange: (diag) => {
        setDiagnostics(diag);
      },
      onVideoStatusChange: (vs) => {
        setVideoStatus(vs);
      },
      onCameraError: (errInfo) => {
        setCameraError(errInfo);
      },
      onWorkerResult: (res) => {
        fingerEngine.applyWorkerResult(res);
        renderCanvasOverlay();
      },
      onCompactFrame: (frame) => {
        fingerEngine.processCompactFrame(frame);
        renderCanvasOverlay();
      },
      onWorkerResetEvents: (events) => {
        fingerEngine.resetAllNotes(events);
      },
    });
    tracker.setGestureConfig(gestureConfig);
    tracker.setTrackingSensitivity(trackingSensitivity);
    trackerRef.current = tracker;
    void tracker.runDiagnostics();

    return () => {
      tracker.dispose();
      fingerEngine.dispose();
      onPanicNotes();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll performance metrics & audio diagnostics at 4Hz
  useEffect(() => {
    if (onGetAudioDiagnostics) {
      setAudioDiag(onGetAudioDiagnostics(trackIdRef.current || undefined));
    }
    const id = window.setInterval(() => {
      if (fingerEngineRef.current) {
        setPerfMetrics({ ...fingerEngineRef.current.getPerformanceMetrics() });
      }
      if (onGetAudioDiagnostics) {
        setAudioDiag(onGetAudioDiagnostics(trackIdRef.current || undefined));
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [onGetAudioDiagnostics]);

  useEffect(() => {
    fingerEngineRef.current?.updateConfig(gestureConfig);
    trackerRef.current?.setGestureConfig(gestureConfig);
  }, [gestureConfig]);

  useEffect(() => {
    trackerRef.current?.setMirrored(mirrored);
  }, [mirrored]);

  useEffect(() => {
    trackerRef.current?.setTrackingSensitivity(trackingSensitivity);
  }, [trackingSensitivity]);

  const clearOverlayCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleStopCamera = () => {
    trackerRef.current?.stop();
    trackerRef.current?.resetWorkerKinematics();
    fingerEngineRef.current?.resetAllNotes();
    if (trackIdRef.current) onPanicNotes(trackIdRef.current);
    clearOverlayCanvas();
  };

  const handleStartOrRetryCamera = async (overrideFacing?: CameraFacingMode) => {
    const tracker = trackerRef.current;
    if (!tracker || !videoRef.current) return;
    onWarmupAudio?.();
    const targetFacing = overrideFacing ?? facingMode;
    setCameraError(null);
    await tracker.start(videoRef.current, targetFacing);
  };

  const isCameraActiveOrStarting =
    videoStatus.hasStream ||
    trackingStatus === 'active' ||
    trackingStatus === 'initializing' ||
    trackingStatus === 'requesting-camera';

  const handleToggleCamera = async () => {
    if (isCameraActiveOrStarting) {
      handleStopCamera();
      return;
    }
    await handleStartOrRetryCamera();
  };

  const handleSwitchCamera = async () => {
    const nextFacing: CameraFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    setMirrored(nextFacing === 'user');
    trackerRef.current?.setFacingMode(nextFacing);
    trackerRef.current?.setMirrored(nextFacing === 'user');
    if (isCameraActiveOrStarting) {
      await handleStartOrRetryCamera(nextFacing);
    }
  };

  const handleSelectMode = (mode: GestureInstrumentMode) => {
    setGestureConfig((prev) => ({
      ...prev,
      mode,
      scaleQuantize: mode === 'synth' && prev.scaleQuantize === 'chromatic' ? 'c-minor' : prev.scaleQuantize,
    }));

    if (!activeTrack) return;
    if (mode === 'drums') {
      const drumTrack = tracks.find((t) => t.instrument.type === 'drumSynth');
      if (drumTrack) {
        onSelectTrack(drumTrack.id);
      } else {
        onSetInstrumentType(activeTrack.id, 'drumSynth');
      }
    } else if (mode === 'synth') {
      onSetInstrumentType(activeTrack.id, 'synth');
    } else {
      onSetInstrumentType(activeTrack.id, 'gesturePiano');
    }
  };

  const handleSelectPianoPreset = (preset: GesturePianoPreset) => {
    setGestureConfig((p) => ({ ...p, mode: 'piano' }));
    if (!activeTrack) return;
    onSetInstrumentType(activeTrack.id, 'gesturePiano');
    onUpdateInstrumentParams(activeTrack.id, PIANO_PRESET_DEFAULTS[preset].patch);
  };

  const handleInstrumentDropdownChange = (val: string) => {
    if (val === 'synth') {
      handleSelectMode('synth');
      return;
    }
    if (val === 'drumSynth') {
      handleSelectMode('drums');
      return;
    }
    handleSelectPianoPreset(val as GesturePianoPreset);
  };

  const handleToggleSustain = () => {
    const next = !sustainOn;
    setSustainOn(next);
    if (activeTrack) {
      onSetSustain(activeTrack.id, next);
    }
  };

  const handleCalibrate = () => {
    if (trackingStatus !== 'active') {
      setTrackingMessage('Start camera first to calibrate your hand plane');
      return;
    }
    fingerEngineRef.current?.startCalibration();
    setTrackingMessage('Hold hands comfortably above virtual keyboard...');
  };

  const reverbFx = activeTrack?.effects.find((e) => e.type === 'reverb');
  const delayFx = activeTrack?.effects.find((e) => e.type === 'delay');
  const eqFx = activeTrack?.effects.find((e) => e.type === 'eq');
  const compFx = activeTrack?.effects.find((e) => e.type === 'compressor');

  const reverbPct = reverbFx?.enabled ? Math.round(Number(reverbFx.params.wet ?? 0.18) * 100) : 0;
  const delayPct = delayFx?.enabled ? Math.round(Number(delayFx.params.wet ?? 0.14) * 100) : 0;

  const isRecordingHere =
    Boolean(liveMidiRecording?.active) && liveMidiRecording?.trackId === activeTrack?.id;

  const currentPianoPreset: GesturePianoPreset = normalizePianoPreset(
    activeTrack?.instrument.params.pianoPreset
  );

  const selectedInstrumentDropdownValue =
    gestureConfig.mode === 'drums'
      ? 'drumSynth'
      : gestureConfig.mode === 'synth'
        ? 'synth'
        : currentPianoPreset;

  const isErrorState =
    trackingStatus === 'permission-denied' ||
    trackingStatus === 'no-camera' ||
    trackingStatus === 'camera-in-use' ||
    trackingStatus === 'overconstrained' ||
    trackingStatus === 'security-error' ||
    trackingStatus === 'error';

  const cameraBadgeLabel =
    trackingStatus === 'active'
      ? 'Camera Active'
      : trackingStatus === 'initializing' && videoStatus.playing
        ? 'Loading Hand Model'
        : trackingStatus === 'requesting-camera'
          ? 'Requesting Camera'
          : isErrorState
            ? cameraError?.name || 'Camera Error'
            : 'Camera Standby';

  const trackingStatusHeading =
    trackingStatus === 'active'
      ? perfMetrics.handCount >= 2
        ? 'Both Hands Detected'
        : perfMetrics.handCount === 1
          ? '1 Hand Detected'
          : 'Scanning for Hands'
      : trackingStatus === 'initializing'
        ? 'Initializing Model'
        : isErrorState
          ? cameraError?.name || 'Camera Blocked'
          : 'Camera Standby';

  // Compute Left/Right hand keyboard range labels accurately
  const handRangeLabels = useMemo(() => {
    if (gestureConfig.mode === 'drums') {
      return { left: 'Kick · Snare · Clap', right: 'Hat · Open Hat · Rim' };
    }
    if (gestureConfig.spanMode === 'split-1oct') {
      const lStart = (gestureConfig.leftOctave + 1) * 12;
      const rStart = (gestureConfig.rightOctave + 1) * 12;
      return {
        left: `${midiToNoteName(lStart)} – ${midiToNoteName(lStart + 11)}`,
        right: `${midiToNoteName(rStart)} – ${midiToNoteName(rStart + 11)}`,
      };
    }
    const { startMidi, endMidi } = getKeyboardRange(
      gestureConfig.spanMode,
      gestureConfig.leftOctave,
      gestureConfig.rightOctave
    );
    const mid = Math.floor((startMidi + endMidi) / 2);
    return {
      left: `${midiToNoteName(startMidi)} – ${midiToNoteName(mid)}`,
      right: `${midiToNoteName(mid + 1)} – ${midiToNoteName(endMidi)}`,
    };
  }, [gestureConfig.mode, gestureConfig.spanMode, gestureConfig.leftOctave, gestureConfig.rightOctave]);

  const sparklineCoords = useMemo(() => {
    const hist = perfMetrics.confidenceHistory;
    if (hist.length < 2) return null;
    const w = 200;
    const h = 42;
    const pts = hist.map((val, idx) => {
      const x = (idx / (hist.length - 1)) * w;
      const y = h - (Math.max(0, Math.min(100, val)) / 100) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      line: pts.join(' '),
      area: `0,${h} ${pts.join(' ')} ${w},${h}`,
    };
  }, [perfMetrics.confidenceHistory]);

  const velocityLabel =
    gestureConfig.velocityMode === 'fixed'
      ? `Fixed (${Math.min(MAX_SAFE_MIDI_VELOCITY, gestureConfig.fixedVelocity)})`
      : gestureConfig.velocitySensitivity < 0.7
        ? 'Soft'
        : gestureConfig.velocitySensitivity > 1.15
          ? 'Hard'
          : 'Medium';

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#101218] overflow-hidden select-none">
      {/* Compact Workspace Header Bar */}
      <div className="px-3 py-1.5 bg-[#15171F] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#6D5DFB]/15 border border-[#8B5CF6]/40 flex items-center justify-center shrink-0">
            <Camera className="w-3.5 h-3.5 text-[#A78BFA]" />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-sm font-bold text-white tracking-tight whitespace-nowrap">
              Gesture Piano
            </h1>
            <span className="hidden sm:inline text-xs text-zinc-400 truncate">
              Play with your hands
            </span>
          </div>

          {activeTrack && (
            <select
              aria-label="Target MIDI Track"
              value={activeTrack.id}
              onChange={(e) => onSelectTrack(e.target.value)}
              className="hidden xl:block h-7 bg-[#101217] border border-white/[0.08] rounded px-2 text-[11px] font-semibold text-zinc-200 max-w-[145px]"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  Track: {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Mode Switcher (Piano | Drums | Synth) + Camera & Fullscreen */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-[#101217] border border-white/[0.08] rounded p-0.5 gap-0.5 shrink-0">
            {(
              [
                { id: 'piano', label: 'Piano', icon: <Piano className="w-3 h-3" /> },
                { id: 'drums', label: 'Drums', icon: <Disc className="w-3 h-3" /> },
                { id: 'synth', label: 'Synth', icon: <Waves className="w-3 h-3" /> },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectMode(m.id)}
                className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  gestureConfig.mode === m.id
                    ? 'bg-[#6D5DFB] text-white'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleToggleCamera()}
            className={`min-h-[36px] sm:min-h-[30px] h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              isCameraActiveOrStarting
                ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-300'
                : 'bg-[#6D5DFB] hover:bg-[#5B4CE6] text-white'
            }`}
          >
            {isCameraActiveOrStarting ? (
              <>
                <CameraOff className="w-3.5 h-3.5" />
                <span>Stop Cam</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                <span>Start Cam</span>
              </>
            )}
          </button>

          {isErrorState && (
            <button
              type="button"
              onClick={() => void handleStartOrRetryCamera()}
              className="min-h-[36px] sm:min-h-[30px] h-7 px-2.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleSwitchCamera()}
            title={`Switch to ${facingMode === 'user' ? 'Rear' : 'Front'} Camera`}
            className="min-h-[36px] sm:min-h-[30px] h-7 px-2 rounded bg-[#1B1E28] hover:bg-[#252936] border border-white/[0.08] text-xs font-semibold text-zinc-200 flex items-center gap-1 shrink-0"
          >
            <SwitchCamera className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">{facingMode === 'user' ? 'Front' : 'Rear'}</span>
          </button>

          <button
            type="button"
            onClick={() => setFullScreenMode((v) => !v)}
            aria-pressed={fullScreenMode}
            title={fullScreenMode ? 'Exit Full-Screen Playing Mode' : 'Full-Screen Playing Mode'}
            className={`min-h-[36px] sm:min-h-[30px] h-7 px-2 rounded border text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors ${
              fullScreenMode
                ? 'bg-[#6D5DFB]/25 border-[#8B5CF6] text-white'
                : 'bg-[#1B1E28] border-white/[0.08] text-zinc-300 hover:text-white'
            }`}
          >
            {fullScreenMode ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area (Scrollable cleanly if viewport compact, structured Studio Grid on desktop) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden">
        {/* Upper Stage Row: Center Workspace (16:9 Cam + Tracking Status + Keyboard) + Right Sound Settings */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-visible lg:overflow-hidden">
          {/* Center Workspace */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col justify-between p-2 sm:p-2.5 gap-2 lg:overflow-y-auto">
            {/* Stage Row: Large 16:9 Camera Preview + Tracking Status Panel */}
            <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-2.5 items-stretch">
              {/* 16:9 Live Camera Preview */}
              <div
                className={`relative flex-1 min-w-0 aspect-video max-h-[360px] xl:max-h-none rounded-md bg-[#090B10] border overflow-hidden flex items-center justify-center ${
                  trackingStatus === 'active'
                    ? 'border-[#6D5DFB]/60 shadow-[0_0_24px_rgba(109,93,251,0.14)]'
                    : 'border-white/[0.09]'
                }`}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`absolute inset-0 w-full h-full object-cover ${
                    mirrored ? '-scale-x-100' : ''
                  } ${videoStatus.hasStream ? 'opacity-95' : 'opacity-0'}`}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                />

                {/* Top-left Status Badge & Top-right FPS Badge */}
                <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between gap-2 pointer-events-none">
                  <div className="px-2.5 py-1 rounded bg-[#101218]/85 backdrop-blur-md border border-white/[0.1] flex items-center gap-1.5 text-[11px] font-semibold text-zinc-100">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        trackingStatus === 'active'
                          ? 'bg-emerald-400'
                          : isErrorState
                            ? 'bg-rose-400'
                            : trackingStatus === 'initializing'
                              ? 'bg-amber-300'
                              : 'bg-zinc-500'
                      }`}
                    />
                    <span>{cameraBadgeLabel}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {videoStatus.playing && (
                      <div className="px-2 py-1 rounded bg-[#101218]/85 backdrop-blur-md border border-white/[0.1] text-[10px] font-mono-tabular text-zinc-300">
                        {perfMetrics.processingWidth}×{perfMetrics.processingHeight}
                      </div>
                    )}
                    <div className="px-2.5 py-1 rounded bg-[#101218]/85 backdrop-blur-md border border-white/[0.1] text-[11px] font-mono-tabular font-semibold text-zinc-100">
                      FPS: {perfMetrics.cameraFps}
                    </div>
                  </div>
                </div>

                {/* Live Camera Info / Diagnostics Popover */}
                {showDiagnostics && diagnostics && videoStatus.hasStream && (
                  <div className="absolute top-12 left-2.5 right-2.5 z-20 rounded bg-[#101218]/92 backdrop-blur-md border border-white/[0.12] p-2.5 text-[11px] font-mono-tabular text-zinc-200 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                    <span>Secure HTTPS: {diagnostics.isSecureContext ? 'Yes' : 'No'}</span>
                    <span>mediaDevices: {diagnostics.getUserMediaAvailable ? 'Yes' : 'No'}</span>
                    <span>In Iframe: {diagnostics.inIframe ? 'Yes' : 'No'}</span>
                    <span>Permission: {diagnostics.permissionState}</span>
                    <span>Cameras: {diagnostics.videoInputCount}</span>
                    <span>
                      Track:{' '}
                      {videoStatus.trackLabel || `${videoStatus.facingMode} (${videoStatus.trackState})`}
                    </span>
                  </div>
                )}

                {/* Idle / Permission / Error Overlay */}
                {((trackingStatus !== 'active' && !videoStatus.playing) || cameraError !== null) && (
                  <div className="relative z-10 w-full max-w-md max-h-full overflow-y-auto px-4 py-4 text-center flex flex-col items-center gap-2.5">
                    {isErrorState ? (
                      <AlertTriangle className="w-7 h-7 text-amber-400 shrink-0" />
                    ) : (
                      <Camera className="w-7 h-7 text-[#8B5CF6] shrink-0" />
                    )}

                    {cameraError ? (
                      <div className="w-full text-left bg-[#141722]/95 border border-rose-500/35 rounded p-3 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-tabular text-xs font-bold text-rose-300">
                            {cameraError.name}
                          </span>
                          <span className="font-mono-tabular text-[10px] text-zinc-400">
                            {facingMode === 'user' ? 'Front Camera' : 'Rear Camera'}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-100 font-medium break-words">
                          {cameraError.message}
                        </p>
                        <p className="text-[11px] text-amber-200/90 leading-snug">
                          {cameraError.causeSummary}
                        </p>
                        <ul className="text-[11px] text-zinc-300 space-y-1 list-disc pl-4">
                          {cameraError.instructions.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <h2 className="text-sm font-bold text-white">
                          {trackingStatus === 'initializing'
                            ? 'Initializing Hand Tracking Model'
                            : trackingStatus === 'requesting-camera'
                              ? 'Waiting for Camera Permission'
                              : 'Play Piano in Mid-Air with Both Hands'}
                        </h2>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          {trackingMessage ||
                            'All hand landmarks run locally on-device. Lower a fingertip past the purple strike plane to trigger notes, or play the keyboard directly.'}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleStartOrRetryCamera()}
                        disabled={trackingStatus === 'requesting-camera'}
                        className="min-h-[40px] px-4 py-1.5 rounded bg-[#6D5DFB] hover:bg-[#5B4CE6] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-colors"
                      >
                        {isErrorState ? (
                          <>
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry Camera</span>
                          </>
                        ) : (
                          <>
                            <Camera className="w-3.5 h-3.5" />
                            <span>
                              {trackingStatus === 'requesting-camera'
                                ? 'Waiting...'
                                : `Enable ${facingMode === 'user' ? 'Front' : 'Rear'} Camera`}
                            </span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleSwitchCamera()}
                        className="min-h-[40px] px-3 py-1.5 rounded bg-[#1D202A] hover:bg-[#272B38] border border-white/[0.1] text-zinc-200 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <SwitchCamera className="w-3.5 h-3.5 text-sky-400" />
                        <span>{facingMode === 'user' ? 'Use Rear' : 'Use Front'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Tracking Status Side Panel (Matches Reference Mockup; hidden in Fullscreen Playing Mode) */}
              {!fullScreenMode && (
                <aside
                  aria-label="Hand Tracking Status"
                  className="xl:w-60 shrink-0 rounded-md bg-[#151822] border border-white/[0.08] p-3 flex flex-col justify-between gap-2.5"
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <CheckCircle2
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            trackingStatus === 'active' && perfMetrics.handCount > 0
                              ? 'text-emerald-400'
                              : trackingStatus === 'active'
                                ? 'text-sky-400'
                                : 'text-zinc-500'
                          }`}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-zinc-100">Tracking Status</span>
                          <span
                            className={`text-[11px] font-medium ${
                              trackingStatus === 'active' && perfMetrics.handCount > 0
                                ? 'text-emerald-400'
                                : isErrorState
                                  ? 'text-rose-400'
                                  : 'text-zinc-400'
                            }`}
                          >
                            {trackingStatusHeading}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDiagnostics((v) => !v);
                          void trackerRef.current?.runDiagnostics();
                        }}
                        title="Camera Permissions & Diagnostics"
                        className={`p-1 rounded border transition-colors ${
                          showDiagnostics
                            ? 'bg-[#6D5DFB]/20 border-[#6D5DFB]/60 text-indigo-200'
                            : 'bg-[#101218] border-white/[0.08] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <Info className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Hands / Fingertips / Confidence Table */}
                    <div className="flex flex-col gap-1.5 text-xs pt-1 border-t border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Hands</span>
                        <span className="font-mono-tabular font-semibold text-zinc-100">
                          {perfMetrics.handCount}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Fingertips</span>
                        <span className="font-mono-tabular font-semibold text-zinc-100">
                          {perfMetrics.detectedFingertips}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Confidence</span>
                        <span className="font-mono-tabular font-semibold text-zinc-100">
                          {perfMetrics.confidence > 0 ? `${perfMetrics.confidence}%` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Real Confidence Activity Sparkline */}
                    <div className="h-12 rounded bg-[#0E1017] border border-white/[0.06] overflow-hidden">
                      <svg viewBox="0 0 200 42" preserveAspectRatio="none" className="w-full h-full">
                        <defs>
                          <linearGradient id="pgConfArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.32" />
                            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        {sparklineCoords ? (
                          <>
                            <polygon points={sparklineCoords.area} fill="url(#pgConfArea)" />
                            <polyline
                              fill="none"
                              stroke="#8B5CF6"
                              strokeWidth="1.75"
                              strokeLinejoin="round"
                              points={sparklineCoords.line}
                            />
                          </>
                        ) : (
                          <line
                            x1="0"
                            y1="34"
                            x2="200"
                            y2="34"
                            stroke="rgba(139, 92, 246, 0.25)"
                            strokeWidth="1"
                          />
                        )}
                      </svg>
                    </div>
                  </div>

                  {/* Calibrate & Mirror Buttons */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleCalibrate}
                      className="h-8 px-2 rounded bg-[#1E222E] hover:bg-[#272C3B] border border-white/[0.08] text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-[#A78BFA]" />
                      <span>Calibrate</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMirrored((m) => !m)}
                      aria-pressed={mirrored}
                      className={`h-8 px-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                        mirrored
                          ? 'bg-[#6D5DFB]/20 border-[#8B5CF6]/60 text-indigo-100'
                          : 'bg-[#1E222E] border-white/[0.08] text-zinc-300 hover:text-white'
                      }`}
                    >
                      <FlipHorizontal2 className="w-3.5 h-3.5" />
                      <span>Mirror</span>
                    </button>
                  </div>
                </aside>
              )}
            </div>

            {/* Octave Toolbar + Hand Legend + Interactive Horizontal Piano Keyboard */}
            <div className="shrink-0 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* < Octave: N > */}
                  <div className="flex items-center bg-[#151822] border border-white/[0.08] rounded p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setGestureConfig((p) => ({
                          ...p,
                          leftOctave: Math.max(1, p.leftOctave - 1),
                          rightOctave: Math.max(2, p.rightOctave - 1),
                        }))
                      }
                      aria-label="Octave Down"
                      className="w-7 h-6 rounded hover:bg-[#232736] text-zinc-300 flex items-center justify-center"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <select
                      aria-label="Base Octave"
                      value={gestureConfig.leftOctave}
                      onChange={(e) => {
                        const oct = Number(e.target.value);
                        setGestureConfig((p) => ({
                          ...p,
                          leftOctave: oct,
                          rightOctave: Math.min(7, oct + 1),
                        }));
                      }}
                      className="h-6 bg-transparent px-1.5 font-mono-tabular text-xs font-semibold text-zinc-100 focus:outline-none"
                    >
                      {[1, 2, 3, 4, 5, 6].map((o) => (
                        <option key={o} value={o} className="bg-[#151822]">
                          Octave: {o}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setGestureConfig((p) => ({
                          ...p,
                          leftOctave: Math.min(6, p.leftOctave + 1),
                          rightOctave: Math.min(7, p.rightOctave + 1),
                        }))
                      }
                      aria-label="Octave Up"
                      className="w-7 h-6 rounded hover:bg-[#232736] text-zinc-300 flex items-center justify-center"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Keyboard Span Selector (2 Oct default -> 4 Oct -> 88 Keys -> Split) */}
                  <div className="flex items-center bg-[#151822] border border-white/[0.08] rounded p-0.5 gap-0.5">
                    {(
                      [
                        { id: '2-oct', label: '2 Oct' },
                        { id: '4-oct', label: '4 Oct' },
                        { id: '88-keys', label: '88 Keys' },
                        { id: 'split-1oct', label: 'Split' },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setGestureConfig((p) => ({ ...p, spanMode: s.id }))}
                        className={`h-6 px-2 rounded text-[10px] font-mono-tabular font-semibold transition-colors ${
                          gestureConfig.spanMode === s.id
                            ? 'bg-[#6D5DFB] text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Left Hand (Purple) & Right Hand (Cyan) Range Indicators */}
                <div className="flex items-center gap-3 text-[11px] font-mono-tabular text-zinc-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                    <span>Left Hand: {handRangeLabels.left}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#38BDF8]" />
                    <span>Right Hand: {handRangeLabels.right}</span>
                  </span>
                </div>
              </div>

              <GesturePianoKeyboard
                spanMode={gestureConfig.spanMode}
                leftOctave={gestureConfig.leftOctave}
                rightOctave={gestureConfig.rightOctave}
                isDrumMode={gestureConfig.mode === 'drums'}
                leftActivePitches={leftActivePitches}
                rightActivePitches={rightActivePitches}
                pointerActivePitches={pointerPitches}
                leftHoverPitches={leftHoverPitches}
                rightHoverPitches={rightHoverPitches}
                onNoteOn={triggerManualNoteOn}
                onNoteOff={triggerManualNoteOff}
              />

              {/* Mobile Quick Transport & Collapsible Panel Toggles */}
              <div className="flex lg:hidden items-center justify-between gap-1.5 pt-0.5 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={isPlaying ? onStop : onPlay}
                    className={`min-h-[34px] px-2.5 rounded text-xs font-semibold flex items-center gap-1 ${
                      isPlaying
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-[#1C202B] border border-white/[0.08] text-zinc-100'
                    }`}
                  >
                    {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                    <span>{isPlaying ? 'Stop' : 'Play'}</span>
                  </button>
                  {activeTrack && (
                    <button
                      type="button"
                      onClick={() =>
                        isRecordingHere
                          ? onStopLiveRecording()
                          : onStartLiveRecording(recordTarget, activeTrack.id)
                      }
                      className={`min-h-[34px] px-2.5 rounded text-xs font-semibold flex items-center gap-1 ${
                        isRecordingHere
                          ? 'bg-rose-600 text-white'
                          : 'bg-[#1C202B] border border-white/[0.08] text-rose-400'
                      }`}
                    >
                      {isRecordingHere ? (
                        <>
                          <Square className="w-2.5 h-2.5 fill-current" />
                          <span>Stop ({liveMidiRecording?.noteCount ?? 0})</span>
                        </>
                      ) : (
                        <>
                          <Circle className="w-2.5 h-2.5 fill-current" />
                          <span>Rec</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleSustain}
                    className={`min-h-[34px] px-2.5 rounded border text-xs font-semibold ${
                      sustainOn
                        ? 'bg-[#6D5DFB] border-[#8B5CF6] text-white'
                        : 'bg-[#1C202B] border-white/[0.08] text-zinc-300'
                    }`}
                  >
                    Sus
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'controls', label: 'Sound', icon: <Sliders className="w-3 h-3" /> },
                      { id: 'mixer', label: 'Mixer', icon: <Volume2 className="w-3 h-3" /> },
                      { id: 'midi', label: 'MIDI', icon: <Music className="w-3 h-3" /> },
                      { id: 'perf', label: 'Perf', icon: <Activity className="w-3 h-3" /> },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setMobilePanel((p) => (p === tab.id ? 'none' : tab.id))}
                      className={`min-h-[34px] px-2 rounded border text-[11px] font-semibold flex items-center gap-1 ${
                        mobilePanel === tab.id
                          ? 'bg-[#6D5DFB] border-[#6D5DFB] text-white'
                          : 'bg-[#171A24] border-white/[0.08] text-zinc-300'
                      }`}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right-Side Sound Settings & Gesture Controls (Desktop visible unless Fullscreen; Mobile collapsible) */}
          {!fullScreenMode && (
            <aside
              aria-label="Sound Settings"
              className={`${
                mobilePanel === 'controls' ? 'flex' : 'hidden lg:flex'
              } w-full lg:w-64 xl:w-72 shrink-0 bg-[#15171F] border-t lg:border-t-0 lg:border-l border-white/[0.08] p-3 flex-col gap-3 overflow-y-auto`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-[#8B5CF6]" />
                  <span>Sound Settings</span>
                </span>
                {activeTrack && (
                  <span className="text-[10px] font-mono-tabular text-zinc-400 truncate max-w-[110px]">
                    {activeTrack.name}
                  </span>
                )}
              </div>

              {/* Instrument Voice Selector */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-zinc-400">Instrument</span>
                <select
                  aria-label="Instrument Voice"
                  value={selectedInstrumentDropdownValue}
                  onChange={(e) => handleInstrumentDropdownChange(e.target.value)}
                  className="h-8 bg-[#101218] border border-white/[0.1] rounded px-2 text-xs font-semibold text-zinc-100 focus:outline-none focus:border-[#8B5CF6]"
                >
                  <option value="acousticPiano">Acoustic Piano</option>
                  <option value="electricPiano">Electric Piano</option>
                  <option value="synthPiano">Synth Piano</option>
                  <option value="softPiano">Soft Piano</option>
                  <option value="synth">Poly Synthesizer</option>
                  <option value="drumSynth">Drum Machine</option>
                </select>
              </div>

              {/* Synth Piano Oscillator & ADSR Tuning */}
              {activeTrack &&
                gestureConfig.mode === 'piano' &&
                currentPianoPreset === 'synthPiano' && (
                  <div className="rounded bg-[#101218] border border-white/[0.07] p-2 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Waveform</span>
                      <div className="flex bg-[#161922] border border-white/[0.08] rounded p-0.5">
                        {(['triangle', 'sine', 'sawtooth', 'square'] as const).map((wf) => (
                          <button
                            key={wf}
                            type="button"
                            onClick={() =>
                              onUpdateInstrumentParams(activeTrack.id, { waveform: wf })
                            }
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                              activeTrack.instrument.params.waveform === wf
                                ? 'bg-[#6D5DFB] text-white'
                                : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {wf.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex justify-between text-[10px] text-zinc-400">
                          <span>Attack</span>
                          <span className="font-mono-tabular text-zinc-200">
                            {Math.round(activeTrack.instrument.params.attack * 1000)}ms
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.005}
                          max={0.12}
                          step={0.005}
                          value={activeTrack.instrument.params.attack}
                          onChange={(e) =>
                            onUpdateInstrumentParams(activeTrack.id, {
                              attack: Number(e.target.value),
                            })
                          }
                          aria-label="Synth Piano Attack"
                          className="daw-slider w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex justify-between text-[10px] text-zinc-400">
                          <span>Release</span>
                          <span className="font-mono-tabular text-zinc-200">
                            {activeTrack.instrument.params.release.toFixed(2)}s
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.1}
                          max={1.5}
                          step={0.05}
                          value={activeTrack.instrument.params.release}
                          onChange={(e) =>
                            onUpdateInstrumentParams(activeTrack.id, {
                              release: Number(e.target.value),
                            })
                          }
                          aria-label="Synth Piano Release"
                          className="daw-slider w-full"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>Filter Cutoff</span>
                        <span className="font-mono-tabular text-zinc-200">
                          {Math.round(activeTrack.instrument.params.cutoff)} Hz
                        </span>
                      </div>
                      <input
                        type="range"
                        min={400}
                        max={8500}
                        step={50}
                        value={activeTrack.instrument.params.cutoff}
                        onChange={(e) =>
                          onUpdateInstrumentParams(activeTrack.id, {
                            cutoff: Number(e.target.value),
                          })
                        }
                        aria-label="Synth Piano Filter Cutoff"
                        className="daw-slider w-full"
                      />
                    </div>
                  </div>
                )}

              {/* Volume */}
              {activeTrack && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Volume</span>
                    <span className="font-mono-tabular text-zinc-200 font-semibold">
                      {activeTrack.volumeDb > 0
                        ? `+${activeTrack.volumeDb.toFixed(1)}`
                        : activeTrack.volumeDb.toFixed(1)}{' '}
                      dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-36}
                    max={6}
                    step={0.5}
                    value={activeTrack.volumeDb}
                    onChange={(e) => onSetTrackVolume(activeTrack.id, Number(e.target.value))}
                    aria-label="Instrument Volume"
                    className="daw-slider w-full"
                  />
                </div>
              )}

              {/* Reverb */}
              {activeTrack && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Reverb</span>
                    <span className="font-mono-tabular text-zinc-200 font-semibold">
                      {reverbPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={75}
                    step={1}
                    value={reverbPct}
                    onChange={(e) => {
                      const wet = Math.round(Number(e.target.value)) / 100;
                      if (!reverbFx) {
                        onAddEffect(activeTrack.id, 'reverb');
                      } else {
                        onUpdateEffect(activeTrack.id, reverbFx.id, {
                          enabled: wet > 0.01,
                          paramPatch: { wet },
                        });
                      }
                    }}
                    aria-label="Reverb Mix"
                    className="daw-slider w-full"
                  />
                </div>
              )}

              {/* Delay */}
              {activeTrack && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Delay</span>
                    <span className="font-mono-tabular text-zinc-200 font-semibold">
                      {delayPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={75}
                    step={1}
                    value={delayPct}
                    onChange={(e) => {
                      const wet = Math.round(Number(e.target.value)) / 100;
                      if (!delayFx) {
                        onAddEffect(activeTrack.id, 'delay');
                      } else {
                        onUpdateEffect(activeTrack.id, delayFx.id, {
                          enabled: wet > 0.01,
                          paramPatch: { wet },
                        });
                      }
                    }}
                    aria-label="Delay Mix"
                    className="daw-slider w-full"
                  />
                </div>
              )}

              {/* Velocity Sensitivity */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Velocity Sensitivity</span>
                  <span className="font-mono-tabular text-zinc-200 font-semibold">
                    {velocityLabel}
                  </span>
                </div>
                {gestureConfig.velocityMode === 'dynamic' ? (
                  <input
                    type="range"
                    min={0.3}
                    max={1.5}
                    step={0.05}
                    value={gestureConfig.velocitySensitivity}
                    onChange={(e) =>
                      setGestureConfig((p) => ({
                        ...p,
                        velocitySensitivity: Number(e.target.value),
                      }))
                    }
                    aria-label="Velocity Sensitivity"
                    className="daw-slider w-full"
                  />
                ) : (
                  <input
                    type="range"
                    min={20}
                    max={MAX_SAFE_MIDI_VELOCITY}
                    step={1}
                    value={Math.min(MAX_SAFE_MIDI_VELOCITY, gestureConfig.fixedVelocity)}
                    onChange={(e) =>
                      setGestureConfig((p) => ({ ...p, fixedVelocity: Number(e.target.value) }))
                    }
                    aria-label="Fixed Velocity"
                    className="daw-slider w-full"
                  />
                )}
                <div className="grid grid-cols-2 gap-1 bg-[#101217] border border-white/[0.07] rounded p-0.5">
                  {(['dynamic', 'fixed'] as VelocityMode[]).map((vm) => (
                    <button
                      key={vm}
                      type="button"
                      onClick={() => setGestureConfig((p) => ({ ...p, velocityMode: vm }))}
                      className={`py-1 rounded text-[10px] font-semibold capitalize ${
                        gestureConfig.velocityMode === vm
                          ? 'bg-[#6D5DFB] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {vm}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gesture Sensitivity */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Gesture Sensitivity</span>
                  <span className="font-mono-tabular text-zinc-200 font-semibold">
                    {Math.round(gestureConfig.pressSensitivity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={gestureConfig.pressSensitivity}
                  onChange={(e) =>
                    setGestureConfig((p) => ({ ...p, pressSensitivity: Number(e.target.value) }))
                  }
                  aria-label="Gesture Sensitivity"
                  className="daw-slider w-full"
                />
              </div>

              {/* Sustain Pedal Switch */}
              <div className="flex items-center justify-between gap-2 py-1.5 border-y border-white/[0.06] text-xs">
                <span className="text-zinc-200 font-medium">Sustain Pedal</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sustainOn}
                  aria-label="Sustain Pedal"
                  onClick={handleToggleSustain}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    sustainOn ? 'bg-[#6D5DFB]' : 'bg-[#262A38]'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                      sustainOn ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* DSP Quick Effect Bypass Toggles */}
              {activeTrack && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Insert Effects
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { type: 'eq' as EffectType, label: 'EQ', fx: eqFx },
                        { type: 'compressor' as EffectType, label: 'Comp', fx: compFx },
                        { type: 'reverb' as EffectType, label: 'Rev', fx: reverbFx },
                        { type: 'delay' as EffectType, label: 'Del', fx: delayFx },
                      ] as const
                    ).map((item) => {
                      const active = Boolean(item.fx?.enabled);
                      return (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => {
                            if (!item.fx) {
                              onAddEffect(activeTrack.id, item.type);
                            } else {
                              onUpdateEffect(activeTrack.id, item.fx.id, {
                                enabled: !item.fx.enabled,
                              });
                            }
                          }}
                          className={`h-6 px-1 rounded border text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                            active
                              ? 'bg-[#6D5DFB]/25 border-[#8B5CF6] text-indigo-100'
                              : 'bg-[#101218] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <Power className="w-2.5 h-2.5" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Expandable Advanced Tracking Tuning */}
              <div className="flex flex-col gap-2 pt-1 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowAdvancedTracking((v) => !v)}
                  className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 hover:text-zinc-200"
                >
                  <span>Advanced Tracking & Scale</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      showAdvancedTracking ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {showAdvancedTracking && (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">Scale Lock</span>
                      <select
                        value={gestureConfig.scaleQuantize}
                        onChange={(e) =>
                          setGestureConfig((p) => ({
                            ...p,
                            scaleQuantize: e.target.value as GesturePianoConfig['scaleQuantize'],
                          }))
                        }
                        className="h-7 bg-[#101218] border border-white/[0.08] rounded px-1.5 text-[11px] text-zinc-100"
                      >
                        <option value="chromatic">Chromatic</option>
                        <option value="c-major">C Major</option>
                        <option value="c-minor">C Minor</option>
                        <option value="pentatonic">Pentatonic</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px] text-zinc-400">
                        <span>Strike Plane Height</span>
                        <span className="font-mono-tabular text-zinc-200">
                          {Math.round(gestureConfig.planeY * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.3}
                        max={0.85}
                        step={0.01}
                        value={gestureConfig.planeY}
                        onChange={(e) =>
                          setGestureConfig((p) => ({ ...p, planeY: Number(e.target.value) }))
                        }
                        className="daw-slider w-full"
                      />
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px] text-zinc-400">
                        <span>Landmark Confidence</span>
                        <span className="font-mono-tabular text-zinc-200">
                          {Math.round(trackingSensitivity * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.15}
                        max={0.95}
                        step={0.05}
                        value={trackingSensitivity}
                        onChange={(e) => setTrackingSensitivity(Number(e.target.value))}
                        className="daw-slider w-full"
                      />
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px] text-zinc-400">
                        <span>Smoothing</span>
                        <span className="font-mono-tabular text-zinc-200">
                          {Math.round(gestureConfig.smoothing * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.6}
                        step={0.02}
                        value={gestureConfig.smoothing}
                        onChange={(e) =>
                          setGestureConfig((p) => ({ ...p, smoothing: Number(e.target.value) }))
                        }
                        className="daw-slider w-full"
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Sideways Octave Shift</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={gestureConfig.sidewaysOctaveShift}
                        onClick={() =>
                          setGestureConfig((p) => ({
                            ...p,
                            sidewaysOctaveShift: !p.sidewaysOctaveShift,
                          }))
                        }
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                          gestureConfig.sidewaysOctaveShift ? 'bg-[#6D5DFB]' : 'bg-[#262A38]'
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                            gestureConfig.sidewaysOctaveShift ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* Bottom 3-Column Studio Dock (Desktop always shown unless Fullscreen; Mobile shows active section) */}
        {!fullScreenMode && (
          <>
            <div className="hidden lg:block">
              <GesturePianoBottomDock
                project={project}
                selectedTrack={activeTrack}
                editingMidiClip={editingMidiClip}
                isPlaying={isPlaying}
                currentBeat={currentBeat}
                audioStatus={audioStatus}
                audioDiag={audioDiag}
                liveMidiRecording={liveMidiRecording}
                perfMetrics={perfMetrics}
                isCameraActive={trackingStatus === 'active'}
                recordTarget={recordTarget}
                onChangeRecordTarget={setRecordTarget}
                onSelectTrack={onSelectTrack}
                onSetTrackVolume={onSetTrackVolume}
                onSetMasterVolume={onSetMasterVolume}
                onToggleMute={onToggleMute}
                onToggleSolo={onToggleSolo}
                onPlay={onPlay}
                onStop={onStop}
                onStartLiveRecording={onStartLiveRecording}
                onStopLiveRecording={onStopLiveRecording}
                onQuantizeClip={onQuantizeClip}
                onOpenPianoRoll={onOpenPianoRoll}
                onPanicNotes={() => {
                  fingerEngineRef.current?.resetAllNotes();
                  onPanicNotes(activeTrack?.id);
                }}
                getTrackMeter={getTrackMeter}
                getMasterMeter={getMasterMeter}
                mobileSection="all"
              />
            </div>

            {(mobilePanel === 'mixer' || mobilePanel === 'midi' || mobilePanel === 'perf') && (
              <div className="block lg:hidden">
                <GesturePianoBottomDock
                  project={project}
                  selectedTrack={activeTrack}
                  editingMidiClip={editingMidiClip}
                  isPlaying={isPlaying}
                  currentBeat={currentBeat}
                  audioStatus={audioStatus}
                  audioDiag={audioDiag}
                  liveMidiRecording={liveMidiRecording}
                  perfMetrics={perfMetrics}
                  isCameraActive={trackingStatus === 'active'}
                  recordTarget={recordTarget}
                  onChangeRecordTarget={setRecordTarget}
                  onSelectTrack={onSelectTrack}
                  onSetTrackVolume={onSetTrackVolume}
                  onSetMasterVolume={onSetMasterVolume}
                  onToggleMute={onToggleMute}
                  onToggleSolo={onToggleSolo}
                  onPlay={onPlay}
                  onStop={onStop}
                  onStartLiveRecording={onStartLiveRecording}
                  onStopLiveRecording={onStopLiveRecording}
                  onQuantizeClip={onQuantizeClip}
                  onOpenPianoRoll={onOpenPianoRoll}
                  onPanicNotes={() => {
                    fingerEngineRef.current?.resetAllNotes();
                    onPanicNotes(activeTrack?.id);
                  }}
                  getTrackMeter={getTrackMeter}
                  getMasterMeter={getMasterMeter}
                  mobileSection={mobilePanel}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
