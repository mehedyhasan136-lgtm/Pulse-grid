import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  CompactHandInput,
  FINGERTIP_INDICES,
  GesturePianoConfig,
  HandSide,
  KinematicsTickResult,
} from './gestureKinematicsCore';

export type { HandSide, CompactHandInput };
export type CameraFacingMode = 'user' | 'environment';
export type PipelineMode = 'worker-gpu' | 'worker-cpu' | 'main-gpu' | 'main-cpu';

export interface CompactHandFrame {
  captureTimeMs: number;
  inferenceMs: number;
  confidence: number;
  hands: CompactHandInput[];
  cameraFps: number;
  processingWidth: number;
  processingHeight: number;
  pipelineMode: PipelineMode;
}

export interface WorkerKinematicsResult {
  captureTimeMs: number;
  inferenceMs: number;
  gestureMs: number;
  confidence: number;
  handCount: number;
  cameraFps: number;
  processingWidth: number;
  processingHeight: number;
  pipelineMode: PipelineMode;
  tick: KinematicsTickResult;
}

export type TrackingStatus =
  | 'idle'
  | 'requesting-camera'
  | 'camera-ready'
  | 'initializing'
  | 'active'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'overconstrained'
  | 'security-error'
  | 'error';

export interface CameraDiagnostics {
  mediaDevicesAvailable: boolean;
  getUserMediaAvailable: boolean;
  isSecureContext: boolean;
  origin: string;
  protocol: string;
  inIframe: boolean;
  permissionsPolicyAllowsCamera: boolean | null;
  permissionState: PermissionState | 'unsupported' | 'error';
  videoInputCount: number;
  videoInputLabels: string[];
  cameraInUseDetected: boolean;
  lastCheckedAt: number;
}

export interface CameraErrorInfo {
  name: string;
  message: string;
  constraint?: string;
  causeSummary: string;
  instructions: string[];
}

export interface VideoPlaybackStatus {
  hasStream: boolean;
  playing: boolean;
  readyState: number;
  width: number;
  height: number;
  trackState: MediaStreamTrackState | 'none';
  trackLabel: string;
  facingMode: CameraFacingMode;
}

export interface HandTrackingCallbacks {
  onStatusChange: (status: TrackingStatus, message?: string) => void;
  onCompactFrame?: (frame: CompactHandFrame) => void;
  onWorkerResult?: (result: WorkerKinematicsResult) => void;
  onWorkerResetEvents?: (events: KinematicsTickResult['events']) => void;
  onDiagnosticsChange?: (diagnostics: CameraDiagnostics) => void;
  onVideoStatusChange?: (videoStatus: VideoPlaybackStatus) => void;
  onCameraError?: (error: CameraErrorInfo | null) => void;
}

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const LOCAL_WASM_BASE = '/mediapipe/wasm';
const CDN_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';

const PROCESSING_TIERS: ReadonlyArray<[number, number]> = [
  [480, 360],
  [384, 288],
  [320, 240],
];

function extractErrorDetails(err: unknown): { name: string; message: string; constraint?: string } {
  if (err && typeof err === 'object') {
    const anyErr = err as { name?: unknown; message?: unknown; constraint?: unknown };
    return {
      name: typeof anyErr.name === 'string' && anyErr.name ? anyErr.name : 'Error',
      message:
        typeof anyErr.message === 'string' && anyErr.message
          ? anyErr.message
          : String(err),
      constraint: typeof anyErr.constraint === 'string' ? anyErr.constraint : undefined,
    };
  }
  return {
    name: 'Error',
    message: typeof err === 'string' ? err : 'Unknown camera error',
  };
}

/**
 * Ultra-low-latency camera + MediaPipe HandLandmarker engine.
 * - Uses requestVideoFrameCallback where supported to eliminate duplicate-frame polling
 * - Runs MediaPipe inference + kinematics off-thread in handTrackingWorker.ts (with main-thread fallback)
 * - Extracts only wrist + 5 fingertips per hand
 * - Dynamically scales inference resolution on slower mobile devices
 */
export class HandTrackingEngine {
  private worker: Worker | null = null;
  private workerReady = false;
  private landmarker: HandLandmarker | null = null;
  private pipelineMode: PipelineMode = 'worker-gpu';

  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private vfcId: number | null = null;
  private running = false;
  private inFlight = false;

  private mirrored = true;
  private facingMode: CameraFacingMode = 'user';
  private trackingSensitivity = 0.55;
  private gestureConfig: GesturePianoConfig | null = null;
  private collectingCalibration = false;

  private lastPresentedFrames = -1;
  private lastVideoTime = -1;
  private lastMainDetectTs = 0;

  private cameraFrameCounter = 0;
  private fpsWindowStart = 0;
  private currentCameraFps = 0;

  private tierIndex = 0;
  private slowStreak = 0;
  private fastStreak = 0;
  private avgInferenceMs = 0;

  private cameraInUseDetected = false;
  private permissionStatusObj: PermissionStatus | null = null;
  private startAttemptId = 0;
  private callbacks: HandTrackingCallbacks;

  constructor(callbacks: HandTrackingCallbacks) {
    this.callbacks = callbacks;
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.tierIndex = 1; // Start mobile phones at 384x288 for fast initial response
    }
  }

  public setMirrored(mirrored: boolean): void {
    this.mirrored = mirrored;
  }

  public setFacingMode(mode: CameraFacingMode): void {
    this.facingMode = mode;
  }

  public setGestureConfig(config: GesturePianoConfig): void {
    this.gestureConfig = config;
  }

  public setCollectingCalibration(active: boolean): void {
    this.collectingCalibration = active;
  }

  public setTrackingSensitivity(sensitivity01: number): void {
    this.trackingSensitivity = Math.max(0.1, Math.min(0.95, sensitivity01));
    if (this.workerReady && this.worker) {
      this.worker.postMessage({
        type: 'set-sensitivity',
        sensitivity: this.trackingSensitivity,
      });
    } else if (this.landmarker) {
      const conf = 0.72 - this.trackingSensitivity * 0.42;
      void this.landmarker.setOptions({
        minHandDetectionConfidence: conf,
        minHandPresenceConfidence: conf,
        minTrackingConfidence: conf,
      });
    }
  }

  public resetWorkerKinematics(): void {
    if (this.workerReady && this.worker) {
      this.worker.postMessage({ type: 'reset' });
    }
  }

  public async runDiagnostics(): Promise<CameraDiagnostics> {
    const hasWindow = typeof window !== 'undefined';
    const hasNavigator = typeof navigator !== 'undefined';
    const mediaDevicesAvailable = hasNavigator && Boolean(navigator.mediaDevices);
    const getUserMediaAvailable =
      mediaDevicesAvailable && typeof navigator.mediaDevices.getUserMedia === 'function';
    const isSecureContext = hasWindow ? Boolean(window.isSecureContext) : false;
    const origin = hasWindow ? window.location.origin : '';
    const protocol = hasWindow ? window.location.protocol : '';

    let inIframe = false;
    if (hasWindow) {
      try {
        inIframe = window.self !== window.top;
      } catch {
        inIframe = true;
      }
    }

    let permissionsPolicyAllowsCamera: boolean | null = null;
    if (typeof document !== 'undefined') {
      try {
        const docAny = document as unknown as {
          permissionsPolicy?: { allowsFeature?: (name: string) => boolean };
          featurePolicy?: { allowsFeature?: (name: string) => boolean };
        };
        const policy = docAny.permissionsPolicy ?? docAny.featurePolicy;
        if (policy && typeof policy.allowsFeature === 'function') {
          permissionsPolicyAllowsCamera = policy.allowsFeature('camera');
        }
      } catch {
        permissionsPolicyAllowsCamera = null;
      }
    }

    let permissionState: CameraDiagnostics['permissionState'] = 'unsupported';
    if (hasNavigator && navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        permissionState = status.state;
        if (this.permissionStatusObj !== status) {
          if (this.permissionStatusObj) {
            this.permissionStatusObj.onchange = null;
          }
          this.permissionStatusObj = status;
          status.onchange = () => {
            void this.runDiagnostics();
          };
        }
      } catch {
        permissionState = 'unsupported';
      }
    }

    let videoInputCount = 0;
    const videoInputLabels: string[] = [];
    if (mediaDevicesAvailable && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === 'videoinput');
        videoInputCount = cameras.length;
        cameras.forEach((cam, idx) => {
          videoInputLabels.push(cam.label || `Camera ${idx + 1} (label hidden until allowed)`);
        });
      } catch {
        videoInputCount = 0;
      }
    }

    const diag: CameraDiagnostics = {
      mediaDevicesAvailable,
      getUserMediaAvailable,
      isSecureContext,
      origin,
      protocol,
      inIframe,
      permissionsPolicyAllowsCamera,
      permissionState,
      videoInputCount,
      videoInputLabels,
      cameraInUseDetected: this.cameraInUseDetected,
      lastCheckedAt: Date.now(),
    };

    this.callbacks.onDiagnosticsChange?.(diag);
    return diag;
  }

  private emitVideoStatus(): void {
    const track = this.stream?.getVideoTracks()[0];
    const el = this.videoEl;
    this.callbacks.onVideoStatusChange?.({
      hasStream: Boolean(this.stream),
      playing: Boolean(el && !el.paused && !el.ended && el.readyState >= 2 && el.videoWidth > 0),
      readyState: el?.readyState ?? 0,
      width: el?.videoWidth ?? 0,
      height: el?.videoHeight ?? 0,
      trackState: track ? track.readyState : 'none',
      trackLabel: track?.label || '',
      facingMode: this.facingMode,
    });
  }

  private async ensureTrackingBackend(): Promise<void> {
    if (this.workerReady || this.landmarker) return;

    // 1. Try off-thread MediaPipe Web Worker first (requires Worker + createImageBitmap)
    if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      const workerOk = await this.tryInitWorker();
      if (workerOk) return;
    }

    // 2. Fallback: Main-thread MediaPipe HandLandmarker
    await this.initMainThreadLandmarker();
  }

  private tryInitWorker(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;

      const fail = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.workerReady = false;
        this.worker?.terminate();
        this.worker = null;
        resolve(false);
      };

      try {
        const worker = new Worker(new URL('./handTrackingWorker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;

        timer = window.setTimeout(fail, 15000);

        worker.onerror = () => {
          if (!settled) {
            fail();
          } else {
            this.inFlight = false;
          }
        };

        worker.onmessage = (e: MessageEvent) => {
          const data = e.data;
          if (!data) return;

          if (data.type === 'init-ok') {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            this.workerReady = true;
            this.pipelineMode = data.delegate === 'GPU' ? 'worker-gpu' : 'worker-cpu';
            resolve(true);
            return;
          }

          if (data.type === 'init-error') {
            fail();
            return;
          }

          if (data.type === 'reset-result') {
            this.callbacks.onWorkerResetEvents?.(data.events ?? []);
            return;
          }

          if (data.type === 'result') {
            this.inFlight = false;
            this.updateAdaptiveResolution(data.inferenceMs);
            const [pw, ph] = PROCESSING_TIERS[this.tierIndex];
            this.callbacks.onWorkerResult?.({
              captureTimeMs: data.captureTimeMs,
              inferenceMs: data.inferenceMs,
              gestureMs: data.gestureMs,
              confidence: data.confidence,
              handCount: data.handCount,
              cameraFps: this.currentCameraFps,
              processingWidth: pw,
              processingHeight: ph,
              pipelineMode: this.pipelineMode,
              tick: data.tick,
            });
          }
        };

        worker.postMessage({
          type: 'init',
          sensitivity: this.trackingSensitivity,
        });
      } catch {
        fail();
      }
    });
  }

  private async createMainLandmarkerWithBase(
    wasmBase: string,
    conf: number
  ): Promise<HandLandmarker> {
    const vision = await FilesetResolver.forVisionTasks(wasmBase);
    try {
      const instance = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: conf,
        minHandPresenceConfidence: conf,
        minTrackingConfidence: conf,
      });
      this.pipelineMode = 'main-gpu';
      return instance;
    } catch {
      const instance = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: conf,
        minHandPresenceConfidence: conf,
        minTrackingConfidence: conf,
      });
      this.pipelineMode = 'main-cpu';
      return instance;
    }
  }

  private async initMainThreadLandmarker(): Promise<HandLandmarker> {
    if (this.landmarker) return this.landmarker;
    const conf = 0.72 - this.trackingSensitivity * 0.42;

    try {
      this.landmarker = await this.createMainLandmarkerWithBase(LOCAL_WASM_BASE, conf);
    } catch {
      this.landmarker = await this.createMainLandmarkerWithBase(CDN_WASM_BASE, conf);
    }

    return this.landmarker;
  }

  private updateAdaptiveResolution(inferenceMs: number): void {
    this.avgInferenceMs =
      this.avgInferenceMs === 0 ? inferenceMs : this.avgInferenceMs * 0.7 + inferenceMs * 0.3;

    if (this.avgInferenceMs > 26) {
      this.slowStreak += 1;
      this.fastStreak = 0;
      if (this.slowStreak >= 5 && this.tierIndex < PROCESSING_TIERS.length - 1) {
        this.tierIndex += 1;
        this.slowStreak = 0;
      }
    } else if (this.avgInferenceMs < 12) {
      this.fastStreak += 1;
      this.slowStreak = 0;
      if (this.fastStreak >= 20 && this.tierIndex > 0) {
        this.tierIndex -= 1;
        this.fastStreak = 0;
      }
    } else {
      this.slowStreak = 0;
      this.fastStreak = 0;
    }
  }

  private waitForVideoMetadataAndPlay(videoElement: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        videoElement.removeEventListener('loadedmetadata', onMeta);
        videoElement.removeEventListener('canplay', onMeta);
        videoElement.removeEventListener('error', onErr);
        window.clearTimeout(timer);
      };

      const finish = async () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          await videoElement.play();
          resolve();
        } catch (playErr) {
          reject(playErr);
        }
      };

      const onMeta = () => {
        if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
          void finish();
        } else if (videoElement.readyState >= 1) {
          void finish();
        }
      };

      const onErr = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Video element failed to load camera stream.', 'NotReadableError'));
      };

      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        void videoElement
          .play()
          .then(() => resolve())
          .catch((e) => reject(e));
      }, 4500);

      videoElement.addEventListener('loadedmetadata', onMeta);
      videoElement.addEventListener('canplay', onMeta);
      videoElement.addEventListener('error', onErr);

      if (videoElement.readyState >= 1 && videoElement.videoWidth > 0) {
        void finish();
      }
    });
  }

  private classifyCameraError(
    err: unknown,
    diag: CameraDiagnostics
  ): { status: TrackingStatus; info: CameraErrorInfo } {
    const { name, message, constraint } = extractErrorDetails(err);

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      if (diag.inIframe && diag.permissionsPolicyAllowsCamera === false) {
        return {
          status: 'permission-denied',
          info: {
            name,
            message,
            causeSummary:
              'Camera access is blocked by iframe Permissions-Policy (missing allow="camera" on the host iframe).',
            instructions: [
              'Open this HTTPS URL directly in a normal Android Chrome browser tab instead of an embedded preview iframe.',
              'If embedding is required, the outer iframe must include allow="camera; microphone".',
            ],
          },
        };
      }

      if (!diag.isSecureContext) {
        return {
          status: 'security-error',
          info: {
            name,
            message,
            causeSummary: 'Browser denied camera because this origin is not a secure HTTPS context.',
            instructions: ['Open PulseGrid using https:// (or http://localhost).'],
          },
        };
      }

      return {
        status: 'permission-denied',
        info: {
          name,
          message,
          causeSummary:
            diag.permissionState === 'denied'
              ? 'Camera permission is currently set to Denied in Chrome site settings for this URL.'
              : 'Camera permission prompt was dismissed or blocked by browser/OS settings.',
          instructions: [
            'In Android Chrome, tap the tune / lock icon to the left of the URL bar.',
            'Tap Permissions -> Camera and switch it to Allow (or Reset permissions).',
            'Verify Android Settings -> Apps -> Chrome -> Permissions -> Camera is Allowed.',
            'Tap Retry Camera below.',
          ],
        },
      };
    }

    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return {
        status: 'no-camera',
        info: {
          name,
          message,
          causeSummary:
            diag.videoInputCount === 0
              ? 'No camera device (videoinput) was detected by the browser.'
              : `Requested ${this.facingMode} camera was not found among ${diag.videoInputCount} detected device(s).`,
          instructions: [
            'Try toggling between Front and Rear camera.',
            'Ensure your device camera is enabled and recognized by Android.',
          ],
        },
      };
    }

    if (name === 'NotReadableError' || name === 'TrackStartError') {
      this.cameraInUseDetected = true;
      return {
        status: 'camera-in-use',
        info: {
          name,
          message,
          causeSummary:
            'The camera hardware could not start because another app, tab, or system process is holding it.',
          instructions: [
            'Close other apps or browser tabs that may be using the camera (Camera app, Meet, WhatsApp, Instagram).',
            'If no other app is open, switch Front/Rear or reload the tab and tap Retry Camera.',
          ],
        },
      };
    }

    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return {
        status: 'overconstrained',
        info: {
          name,
          message,
          constraint,
          causeSummary: `Camera rejected constraint${constraint ? ` "${constraint}"` : ''}.`,
          instructions: [
            'Switch between Front and Rear camera.',
            'Tap Retry Camera to use relaxed resolution/frame-rate settings.',
          ],
        },
      };
    }

    if (name === 'SecurityError') {
      return {
        status: 'security-error',
        info: {
          name,
          message,
          causeSummary:
            'Browser security policy (HTTPS requirement or Permissions-Policy header) blocked camera access.',
          instructions: [
            'Ensure you opened the HTTPS URL directly in Chrome (not inside a restricted WebView or HTTP page).',
            'Check hosting Permissions-Policy headers if self-hosting.',
          ],
        },
      };
    }

    return {
      status: 'error',
      info: {
        name,
        message,
        causeSummary: `${name}: ${message}`,
        instructions: [
          'Review the Camera Diagnostics panel for environment and permission state.',
          'Tap Retry Camera to attempt initialization again.',
        ],
      },
    };
  }

  public async start(
    videoElement: HTMLVideoElement,
    requestedFacingMode: CameraFacingMode = this.facingMode
  ): Promise<boolean> {
    const attemptId = ++this.startAttemptId;
    this.stopCameraOnly();
    this.videoEl = videoElement;
    this.facingMode = requestedFacingMode;
    this.cameraInUseDetected = false;
    this.callbacks.onCameraError?.(null);

    const isSecure = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
    const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
    const hasGetUserMedia =
      hasMediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

    if (!isSecure || !hasGetUserMedia) {
      const diag = await this.runDiagnostics();
      const classified = this.classifyCameraError(
        new DOMException(
          !isSecure
            ? 'Camera access requires a secure HTTPS context.'
            : 'navigator.mediaDevices.getUserMedia is unavailable in this browser or context.',
          'SecurityError'
        ),
        diag
      );
      this.callbacks.onCameraError?.(classified.info);
      this.callbacks.onStatusChange(
        classified.status,
        `${classified.info.name}: ${classified.info.message}`
      );
      this.emitVideoStatus();
      return false;
    }

    this.callbacks.onStatusChange(
      'requesting-camera',
      `Requesting ${requestedFacingMode === 'user' ? 'front' : 'rear'} camera permission...`
    );

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: requestedFacingMode },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60 },
        },
      });
    } catch (primaryErr) {
      const primaryDetails = extractErrorDetails(primaryErr);
      if (
        primaryDetails.name === 'OverconstrainedError' ||
        primaryDetails.name === 'ConstraintNotSatisfiedError'
      ) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          });
        } catch (fallbackErr) {
          const diag = await this.runDiagnostics();
          const classified = this.classifyCameraError(fallbackErr, diag);
          this.callbacks.onCameraError?.(classified.info);
          this.callbacks.onStatusChange(
            classified.status,
            `${classified.info.name}: ${classified.info.message}`
          );
          this.emitVideoStatus();
          return false;
        }
      } else {
        const diag = await this.runDiagnostics();
        const classified = this.classifyCameraError(primaryErr, diag);
        this.callbacks.onCameraError?.(classified.info);
        this.callbacks.onStatusChange(
          classified.status,
          `${classified.info.name}: ${classified.info.message}`
        );
        this.emitVideoStatus();
        return false;
      }
    }

    if (attemptId !== this.startAttemptId) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }

    this.stream = stream;

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        if (this.stream === stream) {
          this.running = false;
          this.emitVideoStatus();
          this.callbacks.onStatusChange('error', 'Camera track ended unexpectedly.');
          this.callbacks.onCameraError?.({
            name: 'TrackEndedError',
            message: 'The active camera stream was closed by the OS or another application.',
            causeSummary: 'Camera track stopped while active.',
            instructions: ['Tap Retry Camera to reopen the stream.'],
          });
        }
      };
    }

    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.autoplay = true;
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('muted', 'true');
    videoElement.srcObject = stream;

    try {
      await this.waitForVideoMetadataAndPlay(videoElement);
    } catch (videoErr) {
      this.stopCameraOnly();
      const diag = await this.runDiagnostics();
      const classified = this.classifyCameraError(videoErr, diag);
      this.callbacks.onCameraError?.(classified.info);
      this.callbacks.onStatusChange(
        classified.status,
        `${classified.info.name}: ${classified.info.message}`
      );
      this.emitVideoStatus();
      return false;
    }

    if (attemptId !== this.startAttemptId) return false;

    void this.runDiagnostics();
    this.emitVideoStatus();
    this.callbacks.onStatusChange(
      'initializing',
      'Camera live — initializing low-latency hand worker...'
    );

    try {
      await this.ensureTrackingBackend();
    } catch (modelErr) {
      const details = extractErrorDetails(modelErr);
      this.callbacks.onCameraError?.({
        name: details.name,
        message: details.message,
        causeSummary:
          'Camera is streaming, but the MediaPipe Hand Landmarker model failed to initialize.',
        instructions: [
          'Check internet access for downloading hand_landmarker.task (or WebGL support).',
          'Tap Retry Camera to re-initialize hand tracking.',
        ],
      });
      this.callbacks.onStatusChange('error', `${details.name}: ${details.message}`);
      this.emitVideoStatus();
      return false;
    }

    if (attemptId !== this.startAttemptId || !this.stream) return false;

    this.running = true;
    this.inFlight = false;
    this.lastPresentedFrames = -1;
    this.lastVideoTime = -1;
    this.fpsWindowStart = performance.now();
    this.cameraFrameCounter = 0;
    this.callbacks.onCameraError?.(null);
    this.callbacks.onStatusChange('active', `Tracking active (${this.pipelineMode})`);
    this.emitVideoStatus();
    this.scheduleNextFrame();
    return true;
  }

  private scheduleNextFrame(): void {
    if (!this.running || !this.videoEl) return;

    const videoWithVfc = this.videoEl as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: DOMHighResTimeStamp, metadata: { presentedFrames?: number }) => void
      ) => number;
    };

    if (typeof videoWithVfc.requestVideoFrameCallback === 'function') {
      this.vfcId = videoWithVfc.requestVideoFrameCallback((_now, metadata) => {
        this.handleVideoFrame(metadata?.presentedFrames ?? -1);
      });
    } else {
      this.rafId = window.requestAnimationFrame(() => {
        this.handleVideoFrame(-1);
      });
    }
  }

  private handleVideoFrame(presentedFrames: number): void {
    if (!this.running || !this.videoEl) return;

    const now = performance.now();
    const video = this.videoEl;

    // Duplicate frame skip: if presentedFrames or video.currentTime hasn't changed, skip inference
    let isNewFrame = false;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      if (presentedFrames >= 0) {
        if (presentedFrames !== this.lastPresentedFrames) {
          this.lastPresentedFrames = presentedFrames;
          isNewFrame = true;
        }
      } else if (video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        isNewFrame = true;
      }
    }

    if (isNewFrame) {
      this.cameraFrameCounter += 1;
      if (now - this.fpsWindowStart >= 500) {
        this.currentCameraFps = Math.round(
          (this.cameraFrameCounter * 1000) / (now - this.fpsWindowStart)
        );
        this.cameraFrameCounter = 0;
        this.fpsWindowStart = now;
        this.emitVideoStatus();
      }

      if (!this.inFlight) {
        if (this.workerReady && this.worker && this.gestureConfig) {
          this.dispatchFrameToWorker(video, now);
        } else if (this.landmarker) {
          this.processFrameOnMainThread(video, now);
        }
      }
    }

    this.scheduleNextFrame();
  }

  private dispatchFrameToWorker(video: HTMLVideoElement, captureTimeMs: number): void {
    const worker = this.worker;
    const config = this.gestureConfig;
    if (!worker || !config) return;

    const [targetW, targetH] = PROCESSING_TIERS[this.tierIndex];
    this.inFlight = true;

    createImageBitmap(video, {
      resizeWidth: targetW,
      resizeHeight: targetH,
      resizeQuality: 'low',
    })
      .then((bitmap) => {
        if (!this.running || !this.workerReady || !this.worker) {
          bitmap.close();
          this.inFlight = false;
          return;
        }
        worker.postMessage(
          {
            type: 'frame',
            bitmap,
            captureTimeMs,
            videoTimestampMs: captureTimeMs,
            mirrored: this.mirrored,
            config: this.gestureConfig ?? config,
            collectingCalibration: this.collectingCalibration,
          },
          [bitmap]
        );
      })
      .catch(() => {
        this.inFlight = false;
      });
  }

  private processFrameOnMainThread(video: HTMLVideoElement, captureTimeMs: number): void {
    if (!this.landmarker) return;
    const safeTs = Math.max(this.lastMainDetectTs + 1, Math.round(captureTimeMs));
    this.lastMainDetectTs = safeTs;

    const t0 = performance.now();
    try {
      const result = this.landmarker.detectForVideo(video, safeTs);
      const inferenceMs = Math.round((performance.now() - t0) * 100) / 100;
      this.updateAdaptiveResolution(inferenceMs);

      const handCount = result.landmarks.length;
      const hands: CompactHandInput[] = new Array(handCount);
      let scoreSum = 0;

      for (let i = 0; i < handCount; i++) {
        const raw = result.landmarks[i];
        const cat = result.handedness?.[i]?.[0];
        const rawLabel = cat?.categoryName ?? (i === 0 ? 'Right' : 'Left');
        const score = cat?.score ?? 1;
        scoreSum += score;

        const side: HandSide = this.mirrored
          ? rawLabel === 'Left'
            ? 'Right'
            : 'Left'
          : rawLabel === 'Left'
            ? 'Left'
            : 'Right';

        const wrist = raw[0];
        const wristX = wrist
          ? this.mirrored
            ? 1 - wrist.x
            : wrist.x
          : side === 'Left'
            ? 0.25
            : 0.75;

        const tips = new Array(FINGERTIP_INDICES.length);
        for (let t = 0; t < FINGERTIP_INDICES.length; t++) {
          const lm = raw[FINGERTIP_INDICES[t]];
          tips[t] = lm
            ? { x: this.mirrored ? 1 - lm.x : lm.x, y: lm.y }
            : { x: wristX, y: 0 };
        }

        const skeleton = new Float32Array(42);
        for (let k = 0; k < 21; k++) {
          const lm = raw[k];
          skeleton[k * 2] = lm ? (this.mirrored ? 1 - lm.x : lm.x) : wristX;
          skeleton[k * 2 + 1] = lm ? lm.y : 0;
        }

        hands[i] = { side, score, wristX, tips, skeleton };
      }

      const confidence = handCount > 0 ? Math.round((scoreSum / handCount) * 100) : 0;
      const [pw, ph] = PROCESSING_TIERS[this.tierIndex];

      this.callbacks.onCompactFrame?.({
        captureTimeMs,
        inferenceMs,
        confidence,
        hands,
        cameraFps: this.currentCameraFps,
        processingWidth: pw,
        processingHeight: ph,
        pipelineMode: this.pipelineMode,
      });
    } catch {
      // Skip transient frame error safely
    }
  }

  private stopCameraOnly(): void {
    this.running = false;
    this.inFlight = false;

    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.vfcId !== null && this.videoEl) {
      const videoWithVfc = this.videoEl as HTMLVideoElement & {
        cancelVideoFrameCallback?: (id: number) => void;
      };
      try {
        videoWithVfc.cancelVideoFrameCallback?.(this.vfcId);
      } catch {
        // ignore
      }
      this.vfcId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.stream = null;
    }
    if (this.videoEl) {
      try {
        this.videoEl.pause();
      } catch {
        // ignore
      }
      this.videoEl.srcObject = null;
    }
  }

  public stop(): void {
    this.startAttemptId += 1;
    this.stopCameraOnly();
    this.emitVideoStatus();
    this.callbacks.onStatusChange('idle', 'Camera stopped');
  }

  public dispose(): void {
    this.startAttemptId += 1;
    this.stopCameraOnly();
    if (this.permissionStatusObj) {
      this.permissionStatusObj.onchange = null;
      this.permissionStatusObj = null;
    }
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'dispose' });
      } catch {
        // ignore
      }
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }
    try {
      this.landmarker?.close();
    } catch {
      // ignore
    }
    this.landmarker = null;
  }
}
