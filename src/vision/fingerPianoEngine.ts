import {
  CompactHandFrame,
  PipelineMode,
  WorkerKinematicsResult,
} from './handTrackingEngine';
import {
  FingerRuntimeState,
  GestureKinematicsProcessor,
  GestureMidiEvent,
  GesturePianoConfig,
  HAND_CONNECTIONS,
  HandSkeletonOverlay,
  KinematicsTickResult,
} from './gestureKinematicsCore';
import { midiToNoteName } from '../data/presets';

export interface GesturePerformanceMetrics {
  cameraFps: number;
  inferenceMs: number;
  confidence: number;
  gestureMs: number;
  fingerToMidiMs: number;
  activeMidiNotes: number;
  processingWidth: number;
  processingHeight: number;
  pipelineMode: PipelineMode;
  handCount: number;
  detectedFingertips: number;
  confidenceHistory: number[];
}

export interface HandKeyboardState {
  leftActive: Set<number>;
  rightActive: Set<number>;
  leftHover: Set<number>;
  rightHover: Set<number>;
}

export interface FingerPianoCallbacks {
  onMidiEvents: (events: GestureMidiEvent[]) => void;
  onActiveNotesChanged?: (activePitches: Set<number>) => void;
  onHandKeyboardState?: (state: HandKeyboardState) => void;
  onCalibrationComplete?: (planeY: number) => void;
  onCalibrationChange?: (active: boolean) => void;
}

export class FingerPianoEngine {
  private worker: Worker | null = null;
  private fallbackProcessor = new GestureKinematicsProcessor();
  private useWorker = false;
  private latestFingers: FingerRuntimeState[] = [];
  private latestSkeletons: HandSkeletonOverlay[] = [];
  private activePitchCounts = new Map<number, number>();
  private leftActiveCounts = new Map<number, number>();
  private rightActiveCounts = new Map<number, number>();
  private lastHoverKey = '';
  private lastHistorySampleMs = 0;
  private collectingCalibration = false;
  private calibrationStartedAt = 0;
  private config: GesturePianoConfig;
  private callbacks: FingerPianoCallbacks;

  private metrics: GesturePerformanceMetrics = {
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
  };

  constructor(initialConfig: GesturePianoConfig, callbacks: FingerPianoCallbacks) {
    this.config = initialConfig;
    this.callbacks = callbacks;
    this.initFallbackKinematicsWorker();
  }

  private initFallbackKinematicsWorker(): void {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./gestureKinematicsWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data?.type === 'tick-result') {
          this.handleKinematicsResult(
            data.result as KinematicsTickResult,
            typeof data.captureTimeMs === 'number' ? data.captureTimeMs : undefined
          );
        } else if (data?.type === 'reset-result') {
          const events = (data.events ?? []) as GestureMidiEvent[];
          if (events.length > 0) this.dispatchEvents(events);
        }
      };
      this.worker.onerror = () => {
        this.useWorker = false;
        this.worker?.terminate();
        this.worker = null;
      };
      this.useWorker = true;
    } catch {
      this.useWorker = false;
      this.worker = null;
    }
  }

  public updateConfig(next: GesturePianoConfig): void {
    this.config = next;
  }

  public startCalibration(): void {
    this.collectingCalibration = true;
    this.calibrationStartedAt = performance.now();
    this.callbacks.onCalibrationChange?.(true);
  }

  public isCalibrating(): boolean {
    return this.collectingCalibration;
  }

  /**
   * Fast path: MediaPipe + kinematics already ran together in handTrackingWorker.ts.
   */
  public applyWorkerResult(res: WorkerKinematicsResult): void {
    this.metrics.cameraFps = res.cameraFps;
    this.metrics.inferenceMs = res.inferenceMs;
    this.metrics.confidence = res.confidence;
    this.metrics.gestureMs = res.gestureMs;
    this.metrics.processingWidth = res.processingWidth;
    this.metrics.processingHeight = res.processingHeight;
    this.metrics.pipelineMode = res.pipelineMode;
    this.metrics.handCount = res.handCount;

    this.handleKinematicsResult(res.tick, res.captureTimeMs);
  }

  /**
   * Main-thread MediaPipe fallback path: sends compact frame to kinematics worker.
   */
  public processCompactFrame(frame: CompactHandFrame): void {
    this.metrics.cameraFps = frame.cameraFps;
    this.metrics.inferenceMs = frame.inferenceMs;
    this.metrics.confidence = frame.confidence;
    this.metrics.processingWidth = frame.processingWidth;
    this.metrics.processingHeight = frame.processingHeight;
    this.metrics.pipelineMode = frame.pipelineMode;
    this.metrics.handCount = frame.hands.length;

    if (this.useWorker && this.worker) {
      this.worker.postMessage({
        type: 'compact-frame',
        hands: frame.hands,
        captureTimeMs: frame.captureTimeMs,
        config: this.config,
        collectingCalibration: this.collectingCalibration,
      });
    } else {
      const result = this.fallbackProcessor.processCompactHands(
        frame.hands,
        frame.captureTimeMs,
        this.config,
        this.collectingCalibration
      );
      this.handleKinematicsResult(result, frame.captureTimeMs);
    }
  }

  private emitHandKeyboardState(force = false): void {
    if (!this.callbacks.onHandKeyboardState) return;
    const leftHover = new Set<number>();
    const rightHover = new Set<number>();
    for (let i = 0; i < this.latestFingers.length; i++) {
      const f = this.latestFingers[i];
      if (f.hand === 'Left') {
        leftHover.add(f.mappedPitch);
      } else {
        rightHover.add(f.mappedPitch);
      }
    }

    const hoverKey = `${Array.from(leftHover).sort((a, b) => a - b).join(',')}|${Array.from(rightHover).sort((a, b) => a - b).join(',')}`;
    if (!force && hoverKey === this.lastHoverKey) {
      return;
    }
    this.lastHoverKey = hoverKey;

    this.callbacks.onHandKeyboardState({
      leftActive: new Set(this.leftActiveCounts.keys()),
      rightActive: new Set(this.rightActiveCounts.keys()),
      leftHover,
      rightHover,
    });
  }

  private handleKinematicsResult(result: KinematicsTickResult, captureTimeMs?: number): void {
    this.latestFingers = result.fingers;
    this.latestSkeletons = result.skeletons ?? [];
    this.metrics.gestureMs = result.gestureMs;
    this.metrics.detectedFingertips = result.fingers.length;

    const now = performance.now();
    if (now - this.lastHistorySampleMs >= 120) {
      this.lastHistorySampleMs = now;
      const nextHist = [...this.metrics.confidenceHistory, this.metrics.confidence];
      if (nextHist.length > 28) nextHist.shift();
      this.metrics.confidenceHistory = nextHist;
    }

    if (
      this.collectingCalibration &&
      result.calibrationSuggestedY !== null &&
      now - this.calibrationStartedAt >= 750
    ) {
      this.collectingCalibration = false;
      this.callbacks.onCalibrationChange?.(false);
      this.callbacks.onCalibrationComplete?.(result.calibrationSuggestedY);
    }

    if (result.events.length > 0) {
      this.dispatchEvents(result.events, captureTimeMs);
    } else {
      this.emitHandKeyboardState(false);
    }
  }

  private dispatchEvents(events: GestureMidiEvent[], captureTimeMs?: number): void {
    let changed = false;
    let hasNoteOn = false;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const handMap = ev.hand === 'Left' ? this.leftActiveCounts : this.rightActiveCounts;
      if (ev.type === 'noteOn') {
        hasNoteOn = true;
        this.activePitchCounts.set(ev.pitch, (this.activePitchCounts.get(ev.pitch) ?? 0) + 1);
        handMap.set(ev.pitch, (handMap.get(ev.pitch) ?? 0) + 1);
        changed = true;
      } else {
        const cur = this.activePitchCounts.get(ev.pitch) ?? 0;
        if (cur <= 1) {
          this.activePitchCounts.delete(ev.pitch);
        } else {
          this.activePitchCounts.set(ev.pitch, cur - 1);
        }
        const handCur = handMap.get(ev.pitch) ?? 0;
        if (handCur <= 1) {
          handMap.delete(ev.pitch);
        } else {
          handMap.set(ev.pitch, handCur - 1);
        }
        changed = true;
      }
    }

    // Trigger MIDI -> Tone.js immediately BEFORE any UI state updates
    this.callbacks.onMidiEvents(events);

    if (hasNoteOn && typeof captureTimeMs === 'number' && captureTimeMs > 0) {
      this.metrics.fingerToMidiMs = Math.round((performance.now() - captureTimeMs) * 100) / 100;
    }

    this.metrics.activeMidiNotes = this.activePitchCounts.size;

    if (changed) {
      this.callbacks.onActiveNotesChanged?.(new Set(this.activePitchCounts.keys()));
      this.emitHandKeyboardState(true);
    }
  }

  public getPerformanceMetrics(): GesturePerformanceMetrics {
    return this.metrics;
  }

  public resetAllNotes(externalEvents?: GestureMidiEvent[]): void {
    this.activePitchCounts.clear();
    this.leftActiveCounts.clear();
    this.rightActiveCounts.clear();
    this.latestFingers = [];
    this.latestSkeletons = [];
    this.lastHoverKey = '';
    this.metrics.activeMidiNotes = 0;
    this.metrics.detectedFingertips = 0;
    this.callbacks.onActiveNotesChanged?.(new Set());
    this.callbacks.onHandKeyboardState?.({
      leftActive: new Set(),
      rightActive: new Set(),
      leftHover: new Set(),
      rightHover: new Set(),
    });

    if (externalEvents && externalEvents.length > 0) {
      this.callbacks.onMidiEvents(externalEvents);
    }

    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'reset' });
    } else {
      const events = this.fallbackProcessor.reset();
      if (events.length > 0) this.callbacks.onMidiEvents(events);
    }
  }

  /**
   * High-clarity 2D canvas overlay:
   * Draws strike plane, real-time MediaPipe 21-landmark hand skeletons, Left/Right badges, and all 10 highlighted fingertips.
   */
  public drawOverlay(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const planePxY = this.config.planeY * h;

    // Subtle strike zone tint below virtual plane
    ctx.fillStyle = 'rgba(109, 93, 251, 0.08)';
    ctx.fillRect(0, planePxY, w, h - planePxY);

    if (this.config.spanMode === 'split-1oct' && this.config.mode !== 'drums') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, planePxY - 24);
      ctx.lineTo(w * 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Strike plane line
    ctx.strokeStyle = this.collectingCalibration ? '#34D399' : '#8B5CF6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, planePxY);
    ctx.lineTo(w, planePxY);
    ctx.stroke();

    // 1. Draw real-time MediaPipe 21-landmark cyan hand skeletons + joint nodes
    const skeletons = this.latestSkeletons;
    for (let s = 0; s < skeletons.length; s++) {
      const skel = skeletons[s];
      const pts = skel.points;
      if (pts.length < 42) continue;

      const isLeft = skel.hand === 'Left';
      const boneColor = isLeft ? '#38BDF8' : '#22D3EE';
      const badgeColor = isLeft ? '#8B5CF6' : '#38BDF8';

      ctx.save();
      ctx.strokeStyle = boneColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
        const [a, b] = HAND_CONNECTIONS[c];
        ctx.moveTo(pts[a * 2] * w, pts[a * 2 + 1] * h);
        ctx.lineTo(pts[b * 2] * w, pts[b * 2 + 1] * h);
      }
      ctx.stroke();

      // Joint nodes (0..20 except fingertips 4,8,12,16,20 which get larger indicators below)
      ctx.fillStyle = '#38BDF8';
      ctx.globalAlpha = 0.9;
      for (let j = 0; j < 21; j++) {
        if (j === 4 || j === 8 || j === 12 || j === 16 || j === 20) continue;
        ctx.beginPath();
        ctx.arc(pts[j * 2] * w, pts[j * 2 + 1] * h, 2.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Wrist Left/Right identification badge
      const wx = pts[0] * w;
      const wy = Math.min(h - 14, pts[1] * h + 18);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(16, 18, 24, 0.85)';
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.roundRect(wx - 22, wy - 10, 44, 16, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#F4F4F5';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isLeft ? 'LEFT' : 'RIGHT', wx, wy - 2);
      ctx.restore();
    }

    // 2. Highlight all 10 tracked fingertips & active note tags
    const fingers = this.latestFingers;
    if (fingers.length === 0) return;

    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    for (let i = 0; i < fingers.length; i++) {
      const finger = fingers[i];
      const fx = finger.x * w;
      const fy = finger.y * h;
      const isLeft = finger.hand === 'Left';
      const handAccent = isLeft ? '#8B5CF6' : '#38BDF8';

      ctx.beginPath();
      ctx.arc(fx, fy, finger.pressed ? 11 : 6.5, 0, Math.PI * 2);
      ctx.fillStyle = finger.pressed ? 'rgba(52, 211, 153, 0.35)' : `${handAccent}44`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = finger.pressed ? '#34D399' : '#22D3EE';
      ctx.stroke();

      // Inner bright core on fingertip
      ctx.beginPath();
      ctx.arc(fx, fy, finger.pressed ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = finger.pressed ? '#6EE7B7' : '#E0F2FE';
      ctx.fill();

      if (finger.pressed || finger.fingerIndex === 1) {
        ctx.fillStyle = finger.pressed ? '#6EE7B7' : '#E4E4E7';
        ctx.fillText(midiToNoteName(finger.mappedPitch), fx + 10, fy - 7);
      }
    }
  }

  public dispose(): void {
    this.resetAllNotes();
    this.worker?.terminate();
    this.worker = null;
  }
}

