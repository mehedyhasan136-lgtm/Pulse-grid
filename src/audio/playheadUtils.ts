import { ArrangementClip } from '../types/daw';
import { SessionTrackRuntime } from './sessionEngine';

export interface ResolvedClipPlayhead {
  /** Beat position inside the clip (0 .. clipLengthBeats) */
  localBeat: number;
  /** True when the global transport beat falls within this clip's active playback span */
  inClipRange: boolean;
  /** Matched ArrangementClip if playing/editing an arrangement clip */
  activeArrClip: ArrangementClip | null;
  /** Clip-local loop start (when arrangement loop overlaps activeArrClip) */
  loopStartLocal: number | null;
  /** Clip-local loop end (when arrangement loop overlaps activeArrClip) */
  loopEndLocal: number | null;
}

export function resolveActiveArrangementClip(
  clipId: string,
  trackId: string | undefined,
  currentBeat: number,
  arrangementClips: ArrangementClip[]
): ArrangementClip | null {
  const matching = arrangementClips.filter((c) => c.sourceClipId === clipId);
  if (matching.length === 0) return null;

  // Prefer an instance on the selected track whose span currently contains the playhead
  const playingOnTrack = trackId
    ? matching.find(
        (c) =>
          c.trackId === trackId &&
          currentBeat >= c.startBeat - 1e-4 &&
          currentBeat < c.startBeat + c.lengthBeats - 1e-4
      )
    : undefined;
  if (playingOnTrack) return playingOnTrack;

  const playingAny = matching.find(
    (c) =>
      currentBeat >= c.startBeat - 1e-4 &&
      currentBeat < c.startBeat + c.lengthBeats - 1e-4
  );
  if (playingAny) return playingAny;

  const onTrack = trackId ? matching.find((c) => c.trackId === trackId) : undefined;
  return onTrack ?? matching[0];
}

export function computeClipPlayheadState(params: {
  clipId: string;
  clipLengthBeats: number;
  trackId?: string;
  currentBeat: number;
  isPlaying: boolean;
  playbackMode: 'session' | 'arrangement';
  arrangementClips?: ArrangementClip[];
  sessionRuntime?: SessionTrackRuntime | null;
  loopEnabled?: boolean;
  loopStartBeat?: number;
  loopEndBeat?: number;
}): ResolvedClipPlayhead {
  const clipLen = Math.max(0.25, params.clipLengthBeats);
  const arrClips = params.arrangementClips ?? [];
  const activeArrClip =
    params.playbackMode === 'arrangement'
      ? resolveActiveArrangementClip(params.clipId, params.trackId, params.currentBeat, arrClips)
      : null;

  let localBeat = 0;
  let inClipRange = true;
  let loopStartLocal: number | null = null;
  let loopEndLocal: number | null = null;

  if (params.playbackMode === 'arrangement' && activeArrClip) {
    const offset = activeArrClip.offsetBeats ?? 0;
    const clipStart = activeArrClip.startBeat;
    const clipEnd = clipStart + activeArrClip.lengthBeats;

    if (params.currentBeat < clipStart - 1e-4) {
      localBeat = 0;
      inClipRange = false;
    } else if (params.currentBeat > clipEnd + 1e-4) {
      localBeat = clipLen;
      inClipRange = false;
    } else {
      const rel = Math.max(0, params.currentBeat - clipStart) + offset;
      // Preserve exact clipLen endpoint when parked right on the end boundary while stopped
      if (!params.isPlaying && Math.abs(params.currentBeat - clipEnd) < 1e-4 && rel >= clipLen) {
        localBeat = clipLen;
      } else {
        localBeat = rel % clipLen;
      }
      inClipRange = true;
    }

    if (
      params.loopEnabled &&
      typeof params.loopStartBeat === 'number' &&
      typeof params.loopEndBeat === 'number' &&
      params.loopEndBeat > params.loopStartBeat
    ) {
      const overlapStart = Math.max(clipStart, params.loopStartBeat);
      const overlapEnd = Math.min(clipEnd, params.loopEndBeat);
      if (overlapEnd > overlapStart + 1e-4) {
        loopStartLocal = Math.max(0, Math.min(clipLen, overlapStart - clipStart + offset));
        const rawEnd = overlapEnd - clipStart + offset;
        loopEndLocal = rawEnd > clipLen ? clipLen : Math.max(loopStartLocal, rawEnd);
      }
    }
  } else {
    // Session playback or standalone clip editing
    const rt = params.sessionRuntime;
    const startRef = rt && rt.activeClipId === params.clipId ? rt.startBeat : 0;
    const rel = Math.max(0, params.currentBeat - startRef);
    if (!params.isPlaying && params.currentBeat <= clipLen + 1e-4) {
      localBeat = Math.max(0, Math.min(clipLen, params.currentBeat));
    } else {
      localBeat = rel % clipLen;
    }
    inClipRange = !rt || !params.isPlaying || rt.activeClipId === params.clipId || rt.activeClipId === null;
  }

  return {
    localBeat,
    inClipRange,
    activeArrClip,
    loopStartLocal,
    loopEndLocal,
  };
}

export function mapLocalBeatToGlobalBeat(params: {
  targetLocalBeat: number;
  clipId: string;
  clipLengthBeats: number;
  currentBeat: number;
  playbackMode: 'session' | 'arrangement';
  activeArrClip: ArrangementClip | null;
  sessionRuntime?: SessionTrackRuntime | null;
}): number {
  const clipLen = Math.max(0.25, params.clipLengthBeats);
  const clampedLocal = Math.max(0, Math.min(clipLen, params.targetLocalBeat));

  if (params.playbackMode === 'arrangement' && params.activeArrClip) {
    const ac = params.activeArrClip;
    const offset = ac.offsetBeats ?? 0;
    const inRepetition =
      params.currentBeat >= ac.startBeat - 1e-4 &&
      params.currentBeat < ac.startBeat + ac.lengthBeats - 1e-4;
    const repIndex = inRepetition
      ? Math.floor(Math.max(0, params.currentBeat - ac.startBeat) / clipLen)
      : 0;
    const candidate = ac.startBeat + repIndex * clipLen + Math.max(0, clampedLocal - offset);
    return Math.max(ac.startBeat, Math.min(ac.startBeat + ac.lengthBeats, candidate));
  }

  const rt = params.sessionRuntime;
  if (rt && rt.activeClipId === params.clipId && params.currentBeat >= rt.startBeat) {
    const repIndex = Math.floor(Math.max(0, params.currentBeat - rt.startBeat) / clipLen);
    return rt.startBeat + repIndex * clipLen + clampedLocal;
  }

  return clampedLocal;
}
