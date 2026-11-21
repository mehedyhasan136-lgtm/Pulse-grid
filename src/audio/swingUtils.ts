export const MAX_SWING_DELAY_BEATS = 0.125; // 1/8 beat: 67% ≈ triplet (2:1), 100% = dotted-16th (3:1)

export function clampSwingPercent(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

/**
 * Computes the micro-timing delay (in beats) applied to a MIDI note start beat
 * based on a 16th-note swing groove (0.5-beat eighth-note pairs).
 *
 * On-beat notes (0.00, 0.50, 1.00, ...) remain anchored at 0 delay, while
 * off-beat 16th notes (0.25, 0.75, 1.25, ...) receive up to MAX_SWING_DELAY_BEATS
 * scaled by `swingPercent / 100`. Because delay is strictly < 0.25 beats,
 * swung notes never collide with or cross subsequent eighth-note downbeats.
 */
export function computeSwingDelayBeats(beat: number, swingPercent: number): number {
  const clamped = clampSwingPercent(swingPercent);
  if (clamped <= 0) return 0;

  const pairSpan = 0.5;
  const phaseInPair = ((beat % pairSpan) + pairSpan) % pairSpan;
  const offBeatCenter = 0.25;
  const halfWindow = 0.125;
  const offBeatWeight = Math.max(0, 1 - Math.abs(phaseInPair - offBeatCenter) / halfWindow);

  if (offBeatWeight <= 0) return 0;
  return (clamped / 100) * MAX_SWING_DELAY_BEATS * offBeatWeight;
}

export function applySwingToBeat(beat: number, swingPercent: number): number {
  return beat + computeSwingDelayBeats(beat, swingPercent);
}
