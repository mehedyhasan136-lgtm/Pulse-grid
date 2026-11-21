import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  CompactHandInput,
  FINGERTIP_INDICES,
  GestureKinematicsProcessor,
  GesturePianoConfig,
  HandSide,
} from './gestureKinematicsCore';

// Prevent Vite dev server from injecting `?import` onto static /public WASM loader URLs inside Module Workers
const workerScope = self as unknown as {
  import?: (url: string) => Promise<unknown>;
};
if (!workerScope.import) {
  workerScope.import = (url: string) => {
    const absUrl = new URL(url, self.location.origin).toString();
    return import(/* @vite-ignore */ absUrl);
  };
}

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const LOCAL_WASM_BASE = new URL('/mediapipe/wasm', self.location.origin).toString();
const CDN_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';

export type HandWorkerInMessage =
  | {
      type: 'init';
      sensitivity: number;
    }
  | {
      type: 'frame';
      bitmap: ImageBitmap;
      captureTimeMs: number;
      videoTimestampMs: number;
      mirrored: boolean;
      config: GesturePianoConfig;
      collectingCalibration: boolean;
    }
  | {
      type: 'set-sensitivity';
      sensitivity: number;
    }
  | {
      type: 'reset';
    }
  | {
      type: 'dispose';
    };

let landmarker: HandLandmarker | null = null;
const kinematics = new GestureKinematicsProcessor();
let lastDetectTimestampMs = 0;

function sensitivityToConfidence(sensitivity01: number): number {
  const s = Math.max(0.1, Math.min(0.95, sensitivity01));
  return 0.72 - s * 0.42;
}

async function createWithBase(
  wasmBase: string,
  conf: number
): Promise<{ instance: HandLandmarker; delegate: 'GPU' | 'CPU' }> {
  const vision = await FilesetResolver.forVisionTasks(wasmBase, true);
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
    return { instance, delegate: 'GPU' };
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
    return { instance, delegate: 'CPU' };
  }
}

async function initLandmarker(sensitivity: number): Promise<'GPU' | 'CPU'> {
  if (landmarker) return 'GPU';
  const conf = sensitivityToConfidence(sensitivity);

  try {
    const res = await createWithBase(LOCAL_WASM_BASE, conf);
    landmarker = res.instance;
    return res.delegate;
  } catch {
    const res = await createWithBase(CDN_WASM_BASE, conf);
    landmarker = res.instance;
    return res.delegate;
  }
}

self.onmessage = async (e: MessageEvent<HandWorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const delegate = await initLandmarker(msg.sensitivity);
      self.postMessage({ type: 'init-ok', delegate });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'init-error', message });
    }
    return;
  }

  if (msg.type === 'set-sensitivity') {
    if (landmarker) {
      const conf = sensitivityToConfidence(msg.sensitivity);
      try {
        await landmarker.setOptions({
          minHandDetectionConfidence: conf,
          minHandPresenceConfidence: conf,
          minTrackingConfidence: conf,
        });
      } catch {
        // ignore transient option update failure
      }
    }
    return;
  }

  if (msg.type === 'reset') {
    const events = kinematics.reset();
    self.postMessage({ type: 'reset-result', events });
    return;
  }

  if (msg.type === 'dispose') {
    kinematics.reset();
    try {
      landmarker?.close();
    } catch {
      // ignore
    }
    landmarker = null;
    return;
  }

  if (msg.type === 'frame') {
    const { bitmap, captureTimeMs, videoTimestampMs, mirrored, config, collectingCalibration } = msg;
    if (!landmarker) {
      bitmap.close();
      return;
    }

    const safeTs = Math.max(lastDetectTimestampMs + 1, Math.round(videoTimestampMs));
    lastDetectTimestampMs = safeTs;

    const tInf0 = performance.now();
    let result;
    try {
      result = landmarker.detectForVideo(bitmap, safeTs);
    } finally {
      bitmap.close();
    }
    const inferenceMs = Math.round((performance.now() - tInf0) * 100) / 100;

    const handCount = result.landmarks.length;
    const compactHands: CompactHandInput[] = new Array(handCount);
    let scoreSum = 0;

    for (let i = 0; i < handCount; i++) {
      const raw = result.landmarks[i];
      const cat = result.handedness?.[i]?.[0];
      const rawLabel = cat?.categoryName ?? (i === 0 ? 'Right' : 'Left');
      const score = cat?.score ?? 1;
      scoreSum += score;

      const side: HandSide = mirrored
        ? rawLabel === 'Left'
          ? 'Right'
          : 'Left'
        : rawLabel === 'Left'
          ? 'Left'
          : 'Right';

      const wrist = raw[0];
      const wristX = wrist ? (mirrored ? 1 - wrist.x : wrist.x) : side === 'Left' ? 0.25 : 0.75;

      const tips = new Array(FINGERTIP_INDICES.length);
      for (let t = 0; t < FINGERTIP_INDICES.length; t++) {
        const lm = raw[FINGERTIP_INDICES[t]];
        tips[t] = lm
          ? { x: mirrored ? 1 - lm.x : lm.x, y: lm.y }
          : { x: wristX, y: 0 };
      }

      const skeleton = new Float32Array(42);
      for (let k = 0; k < 21; k++) {
        const lm = raw[k];
        skeleton[k * 2] = lm ? (mirrored ? 1 - lm.x : lm.x) : wristX;
        skeleton[k * 2 + 1] = lm ? lm.y : 0;
      }

      compactHands[i] = {
        side,
        score,
        wristX,
        tips,
        skeleton,
      };
    }

    const avgConfidence = handCount > 0 ? Math.round((scoreSum / handCount) * 100) : 0;
    const tick = kinematics.processCompactHands(
      compactHands,
      captureTimeMs,
      config,
      collectingCalibration
    );

    self.postMessage({
      type: 'result',
      captureTimeMs,
      inferenceMs,
      gestureMs: tick.gestureMs,
      confidence: avgConfidence,
      handCount,
      tick,
    });
  }
};
