import {
  CompactHandInput,
  GestureKinematicsProcessor,
  GesturePianoConfig,
  HandSide,
} from './gestureKinematicsCore';

const processor = new GestureKinematicsProcessor();

export type WorkerInMessage =
  | {
      type: 'compact-frame';
      hands: CompactHandInput[];
      captureTimeMs: number;
      config: GesturePianoConfig;
      collectingCalibration: boolean;
    }
  | {
      type: 'frame';
      frame: {
        timestampMs: number;
        hands: Array<{ side: HandSide; score: number; landmarks: Array<{ x: number; y: number }> }>;
      };
      config: GesturePianoConfig;
      collectingCalibration: boolean;
    }
  | { type: 'reset' };

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === 'reset') {
    const events = processor.reset();
    self.postMessage({ type: 'reset-result', events });
    return;
  }

  if (msg.type === 'compact-frame') {
    const result = processor.processCompactHands(
      msg.hands,
      msg.captureTimeMs,
      msg.config,
      msg.collectingCalibration
    );
    self.postMessage({
      type: 'tick-result',
      captureTimeMs: msg.captureTimeMs,
      result,
    });
    return;
  }

  if (msg.type === 'frame') {
    const result = processor.processFrame(msg.frame, msg.config, msg.collectingCalibration);
    self.postMessage({
      type: 'tick-result',
      captureTimeMs: msg.frame.timestampMs,
      result,
    });
  }
};
