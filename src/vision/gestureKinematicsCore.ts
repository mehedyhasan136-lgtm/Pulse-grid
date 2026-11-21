export type HandSide = 'Left' | 'Right';

export const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
export const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;

export type GestureInstrumentMode = 'piano' | 'drums' | 'synth';
export type KeyboardSpanMode = 'split-1oct' | '2-oct' | '4-oct' | '88-keys';
export type VelocityMode = 'dynamic' | 'fixed';

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
] as const;

export interface CompactTipPoint {
  x: number;
  y: number;
}

export interface CompactHandInput {
  side: HandSide;
  score: number;
  wristX: number;
  tips: CompactTipPoint[]; // Strictly 5 fingertips [Thumb, Index, Middle, Ring, Pinky]
  skeleton?: Float32Array; // Optional 21x2 normalized landmarks [x0, y0, ..., x20, y20]
}

export interface HandSkeletonOverlay {
  hand: HandSide;
  points: Float32Array;
}

export interface GesturePianoConfig {
  mode: GestureInstrumentMode;
  spanMode: KeyboardSpanMode;
  leftOctave: number; // 1..6 (default 3 -> C3)
  rightOctave: number; // 1..7 (default 4 -> C4)
  sidewaysOctaveShift: boolean;
  planeY: number; // 0.25..0.88 normalized camera Y
  pressSensitivity: number; // 0.1..1.0
  velocityMode: VelocityMode;
  velocitySensitivity: number; // 0.2..1.5
  fixedVelocity: number; // 30..127
  smoothing: number; // 0.0..0.75 (low = fastest response)
  scaleQuantize: 'chromatic' | 'c-major' | 'c-minor' | 'pentatonic';
}

export interface FingerRuntimeState {
  id: string; // e.g. "Left:1"
  hand: HandSide;
  fingerIndex: number; // 0..4
  fingerName: string;
  x: number;
  y: number;
  vy: number; // downward speed (+ = moving down)
  vyHistory?: number[]; // recent downward speed samples for 3-frame outlier rejection
  pressed: boolean;
  activePitch: number | null;
  mappedPitch: number;
  lastSeenMs: number;
  lastTriggerMs: number;
  lastVelocity: number;
}

export interface GestureMidiEvent {
  type: 'noteOn' | 'noteOff';
  pitch: number;
  velocity: number;
  channel: number;
  hand: HandSide;
  fingerIndex: number;
  fingerId: string;
}

export interface KinematicsTickResult {
  events: GestureMidiEvent[];
  fingers: FingerRuntimeState[];
  skeletons: HandSkeletonOverlay[];
  calibrationSuggestedY: number | null;
  gestureMs: number;
}

const SCALE_NOTES: Record<GesturePianoConfig['scaleQuantize'], number[] | null> = {
  chromatic: null,
  'c-major': [0, 2, 4, 5, 7, 9, 11],
  'c-minor': [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

const DRUM_PITCHES = [36, 38, 42, 46, 39, 37];

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val));
}

function quantizeToScale(midi: number, scale: GesturePianoConfig['scaleQuantize']): number {
  const allowed = SCALE_NOTES[scale];
  if (!allowed) return clamp(21, 108, midi);
  const pc = ((midi % 12) + 12) % 12;
  if (allowed.includes(pc)) return clamp(21, 108, midi);
  for (let d = 1; d <= 6; d++) {
    if (allowed.includes((pc + d) % 12)) return clamp(21, 108, midi + d);
    if (allowed.includes(((pc - d) % 12 + 12) % 12)) return clamp(21, 108, midi - d);
  }
  return clamp(21, 108, midi);
}

export function mapFingerToMidiPitch(
  hand: HandSide,
  fingerIndex: number,
  xNorm: number,
  wristX: number,
  config: GesturePianoConfig
): number {
  if (config.mode === 'drums') {
    if (hand === 'Left') {
      return [36, 38, 39, 37, 42][fingerIndex] ?? 36;
    }
    return [42, 46, 38, 39, 36][fingerIndex] ?? 42;
  }

  const clampedX = clamp(0.04, 0.96, xNorm);
  let rawPitch = 60;

  if (config.spanMode === '88-keys') {
    const t = (clampedX - 0.04) / 0.92;
    rawPitch = Math.round(21 + t * 87);
  } else if (config.spanMode === '4-oct') {
    const baseMidi = clamp(24, 60, (config.leftOctave + 1) * 12);
    const t = (clampedX - 0.04) / 0.92;
    rawPitch = Math.round(baseMidi + t * 47);
  } else if (config.spanMode === '2-oct') {
    const baseMidi = clamp(24, 84, (config.leftOctave + 1) * 12);
    const t = (clampedX - 0.04) / 0.92;
    rawPitch = Math.round(baseMidi + t * 23);
  } else {
    const baseOct = hand === 'Left' ? config.leftOctave : config.rightOctave;
    let octaveShift = 0;
    if (config.sidewaysOctaveShift) {
      if (hand === 'Left') {
        octaveShift = wristX < 0.16 ? -1 : wristX > 0.42 ? 1 : 0;
      } else {
        octaveShift = wristX < 0.56 ? -1 : wristX > 0.84 ? 1 : 0;
      }
    }
    const startMidi = clamp(21, 96, (baseOct + octaveShift + 1) * 12);
    const handNormX =
      hand === 'Left'
        ? clamp(0, 1, (clampedX - 0.05) / 0.43)
        : clamp(0, 1, (clampedX - 0.52) / 0.43);
    rawPitch = Math.round(startMidi + handNormX * 11);
  }

  if (config.mode === 'synth' && config.scaleQuantize === 'chromatic') {
    return quantizeToScale(rawPitch, 'c-minor');
  }

  return quantizeToScale(rawPitch, config.scaleQuantize);
}

export class GestureKinematicsProcessor {
  private fingerMap = new Map<string, FingerRuntimeState>();
  private lastTimestampMs = 0;
  private calibrationSamples: number[] = [];

  public reset(): GestureMidiEvent[] {
    const releaseEvents: GestureMidiEvent[] = [];
    for (const f of this.fingerMap.values()) {
      if (f.pressed && f.activePitch !== null) {
        releaseEvents.push({
          type: 'noteOff',
          pitch: f.activePitch,
          velocity: 0,
          channel: f.hand === 'Left' ? 1 : 2,
          hand: f.hand,
          fingerIndex: f.fingerIndex,
          fingerId: f.id,
        });
      }
    }
    this.fingerMap.clear();
    this.calibrationSamples = [];
    this.lastTimestampMs = 0;
    return releaseEvents;
  }

  /**
   * High-speed compact landmark kinematics (wrist + 5 fingertips only).
   * Eliminates artificial cooldown debouncing and uses hysteresis + early velocity-assisted strike detection.
   */
  public processCompactHands(
    hands: CompactHandInput[],
    timestampMs: number,
    config: GesturePianoConfig,
    collectingCalibration = false
  ): KinematicsTickResult {
    const t0 = performance.now();
    const dtSec =
      this.lastTimestampMs > 0
        ? clamp(0.006, 0.1, (timestampMs - this.lastTimestampMs) / 1000)
        : 0.033;
    this.lastTimestampMs = timestampMs;

    const events: GestureMidiEvent[] = [];
    const seenIds = new Set<string>();
    const skeletons: HandSkeletonOverlay[] = [];

    const sens = clamp(0.1, 1.0, config.pressSensitivity);
    // Minimal EMA lag for instantaneous downward strike detection
    const alpha = clamp(0.32, 0.96, 1 - config.smoothing * 0.65);

    // Separate press and release thresholds via hysteresis
    const pressBaseY = config.planeY + (1 - sens) * 0.014;
    const hysteresisGap = 0.022 + (1 - sens) * 0.012;
    const releaseLineY = config.planeY - hysteresisGap;

    if (collectingCalibration && hands.length > 0) {
      let sumTipY = 0;
      let count = 0;
      for (let h = 0; h < hands.length; h++) {
        const tips = hands[h].tips;
        for (let i = 0; i < tips.length; i++) {
          sumTipY += tips[i].y;
          count += 1;
        }
      }
      if (count > 0) {
        this.calibrationSamples.push(sumTipY / count);
        if (this.calibrationSamples.length > 24) {
          this.calibrationSamples.shift();
        }
      }
    } else if (!collectingCalibration && this.calibrationSamples.length > 0) {
      this.calibrationSamples = [];
    }

    for (let hIdx = 0; hIdx < hands.length; hIdx++) {
      const hand = hands[hIdx];
      if (hand.skeleton && hand.skeleton.length >= 42) {
        skeletons.push({ hand: hand.side, points: hand.skeleton });
      }
      const wristX = hand.wristX;
      const channel = hand.side === 'Left' ? 1 : 2;

      for (let fIdx = 0; fIdx < hand.tips.length; fIdx++) {
        const tip = hand.tips[fIdx];
        const id = `${hand.side}:${fIdx}`;
        seenIds.add(id);

        const prev = this.fingerMap.get(id);
        const smoothX = prev ? prev.x + alpha * (tip.x - prev.x) : tip.x;
        const smoothY = prev ? prev.y + alpha * (tip.y - prev.y) : tip.y;
        const rawVy = prev ? (smoothY - prev.y) / dtSec : 0;
        // Clamp isolated camera landmark jumps and filter via 3-sample median + EMA
        const clampedVy = clamp(-2.8, 2.8, rawVy);
        const nextHistory = prev?.vyHistory ? [...prev.vyHistory, clampedVy] : [clampedVy];
        if (nextHistory.length > 3) nextHistory.shift();
        let filteredVy = clampedVy;
        if (nextHistory.length === 3) {
          const [a, b, c] = nextHistory;
          filteredVy = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
        } else if (nextHistory.length === 2) {
          filteredVy = (nextHistory[0] + nextHistory[1]) * 0.5;
        }
        const smoothVy = prev ? prev.vy * 0.45 + filteredVy * 0.55 : 0;

        const mappedPitch = mapFingerToMidiPitch(
          hand.side,
          fIdx,
          smoothX,
          wristX,
          config
        );

        let pressed = prev?.pressed ?? false;
        let activePitch = prev?.activePitch ?? null;
        let lastTriggerMs = prev?.lastTriggerMs ?? 0;
        let lastVelocity = prev?.lastVelocity ?? clamp(1, 127, config.fixedVelocity);

        if (!pressed) {
          // Early velocity-assisted onset: if moving down rapidly, trigger slightly before crossing static plane
          const velocityLead =
            smoothVy > 0.35 ? Math.min(0.032, (smoothVy - 0.35) * 0.022 * sens) : 0;
          const pressLineY = pressBaseY - velocityLead;

          if (smoothY >= pressLineY && smoothVy >= -0.04) {
            let velocity = Math.round(clamp(1, 127, config.fixedVelocity));
            if (config.velocityMode === 'dynamic') {
              // Expressive soft-saturating velocity curve (1..127) with rapid-strike spike smoothing
              const speed = Math.max(0, smoothVy) * clamp(0.2, 1.5, config.velocitySensitivity);
              const normalized = 1 - Math.exp(-speed * 0.88);
              const rawVelocity = 26 + normalized * 96;
              const isRapidRestrike = lastTriggerMs > 0 && timestampMs - lastTriggerMs < 220;
              const stabilizedVelocity = isRapidRestrike
                ? rawVelocity * 0.65 + lastVelocity * 0.35
                : rawVelocity;
              velocity = Math.round(clamp(1, 127, stabilizedVelocity));
            }
            pressed = true;
            activePitch = mappedPitch;
            lastTriggerMs = timestampMs;
            lastVelocity = velocity;
            events.push({
              type: 'noteOn',
              pitch: mappedPitch,
              velocity,
              channel,
              hand: hand.side,
              fingerIndex: fIdx,
              fingerId: id,
            });
          }
        } else {
          // Strict hysteresis: do NOT retrigger while finger remains pressed; release immediately on lift
          if (smoothY <= releaseLineY) {
            if (activePitch !== null) {
              events.push({
                type: 'noteOff',
                pitch: activePitch,
                velocity: 0,
                channel,
                hand: hand.side,
                fingerIndex: fIdx,
                fingerId: id,
              });
            }
            pressed = false;
            activePitch = null;
          }
        }

        if (prev) {
          prev.x = smoothX;
          prev.y = smoothY;
          prev.vy = smoothVy;
          prev.vyHistory = nextHistory;
          prev.pressed = pressed;
          prev.activePitch = activePitch;
          prev.mappedPitch = mappedPitch;
          prev.lastSeenMs = timestampMs;
          prev.lastTriggerMs = lastTriggerMs;
          prev.lastVelocity = lastVelocity;
        } else {
          this.fingerMap.set(id, {
            id,
            hand: hand.side,
            fingerIndex: fIdx,
            fingerName: FINGER_NAMES[fIdx],
            x: smoothX,
            y: smoothY,
            vy: smoothVy,
            vyHistory: nextHistory,
            pressed,
            activePitch,
            mappedPitch,
            lastSeenMs: timestampMs,
            lastTriggerMs,
            lastVelocity,
          });
        }
      }
    }

    // Immediate tracking-loss release watchdog (> 55ms unseen -> immediate noteOff)
    for (const [id, f] of this.fingerMap.entries()) {
      if (!seenIds.has(id) && timestampMs - f.lastSeenMs > 55) {
        if (f.pressed && f.activePitch !== null) {
          events.push({
            type: 'noteOff',
            pitch: f.activePitch,
            velocity: 0,
            channel: f.hand === 'Left' ? 1 : 2,
            hand: f.hand,
            fingerIndex: f.fingerIndex,
            fingerId: f.id,
          });
        }
        this.fingerMap.delete(id);
      }
    }

    let calibrationSuggestedY: number | null = null;
    if (this.calibrationSamples.length >= 6) {
      const avg =
        this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
      calibrationSuggestedY = clamp(0.32, 0.85, avg + 0.06);
    }

    const gestureMs = Math.round((performance.now() - t0) * 100) / 100;

    return {
      events,
      fingers: Array.from(this.fingerMap.values()),
      skeletons,
      calibrationSuggestedY,
      gestureMs,
    };
  }

  /**
   * Compatibility wrapper for full-landmark HandFrame callers / tests.
   */
  public processFrame(
    frame: { timestampMs: number; hands: Array<{ side: HandSide; score: number; landmarks: Array<{ x: number; y: number }> }> },
    config: GesturePianoConfig,
    collectingCalibration = false
  ): KinematicsTickResult {
    const compactHands: CompactHandInput[] = new Array(frame.hands.length);
    for (let h = 0; h < frame.hands.length; h++) {
      const hand = frame.hands[h];
      const lms = hand.landmarks;
      const tips: CompactTipPoint[] = new Array(FINGERTIP_INDICES.length);
      for (let i = 0; i < FINGERTIP_INDICES.length; i++) {
        const lm = lms[FINGERTIP_INDICES[i]];
        tips[i] = lm ? { x: lm.x, y: lm.y } : { x: 0.5, y: 0 };
      }
      const skeleton = new Float32Array(42);
      for (let k = 0; k < 21; k++) {
        const lm = lms[k];
        skeleton[k * 2] = lm ? lm.x : 0.5;
        skeleton[k * 2 + 1] = lm ? lm.y : 0;
      }
      compactHands[h] = {
        side: hand.side,
        score: hand.score,
        wristX: lms[0]?.x ?? (hand.side === 'Left' ? 0.25 : 0.75),
        tips,
        skeleton,
      };
    }
    return this.processCompactHands(
      compactHands,
      frame.timestampMs,
      config,
      collectingCalibration
    );
  }
}

export { DRUM_PITCHES };
