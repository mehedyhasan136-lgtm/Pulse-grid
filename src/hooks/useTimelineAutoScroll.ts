import { useCallback, useEffect, useRef, useState } from 'react';

export type AutoScrollMode = 'center' | 'page';

export interface AutoScrollGeometry {
  beat: number;
  pxPerBeat: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  rightPanelWidth: number;
  mode: AutoScrollMode;
  forceReveal?: boolean;
}

const STORAGE_ENABLED_KEY = 'pulsegrid.arrangement.followEnabled';
const STORAGE_MODE_KEY = 'pulsegrid.arrangement.followMode';

function readStoredFollowEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_ENABLED_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // ignore storage errors
  }
  return true;
}

function readStoredFollowMode(): AutoScrollMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_MODE_KEY);
    if (raw === 'page' || raw === 'center') return raw;
  } catch {
    // ignore storage errors
  }
  return 'center';
}

export function computeTimelineAutoScrollLeft(g: AutoScrollGeometry): number | null {
  if (g.clientWidth <= 0 || g.scrollWidth <= g.clientWidth) return null;

  const visibleTimelineWidth = Math.max(80, g.clientWidth - Math.max(0, g.rightPanelWidth));
  const maxScrollLeft = Math.max(0, g.scrollWidth - g.clientWidth);
  const playheadX = Math.max(0, g.beat * g.pxPerBeat);

  if (g.mode === 'center') {
    const centered = playheadX - visibleTimelineWidth * 0.5;
    return Math.max(0, Math.min(maxScrollLeft, centered));
  }

  // 'page' mode: keep playhead inside [8%, 88%] of visible timeline area; flip page when out of bounds
  const leftMargin = g.scrollLeft <= 1 ? 0 : g.scrollLeft + visibleTimelineWidth * 0.08;
  const rightMargin = g.scrollLeft + visibleTimelineWidth * 0.88;
  if (g.forceReveal || playheadX < leftMargin || playheadX > rightMargin) {
    const paged = playheadX - visibleTimelineWidth * 0.15;
    return Math.max(0, Math.min(maxScrollLeft, paged));
  }

  return null;
}

export interface UseTimelineAutoScrollOptions {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  rightPanelRef: React.RefObject<HTMLDivElement | null>;
  isPlayingArrangement: boolean;
  currentBeat: number;
  pxPerBeat: number;
  bpm: number;
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  isDraggingInteraction: boolean;
  panelCollapsed?: boolean;
}

export function useTimelineAutoScroll({
  scrollerRef,
  rightPanelRef,
  isPlayingArrangement,
  currentBeat,
  pxPerBeat,
  bpm,
  loopEnabled,
  loopStartBeat,
  loopEndBeat,
  isDraggingInteraction,
  panelCollapsed,
}: UseTimelineAutoScrollOptions) {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(readStoredFollowEnabled);
  const [autoScrollMode, setAutoScrollMode] = useState<AutoScrollMode>(readStoredFollowMode);
  const [followPaused, setFollowPaused] = useState<boolean>(false);

  const lastBeatTickRef = useRef<{ beat: number; at: number }>({
    beat: currentBeat,
    at: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  // Cached layout dimensions updated by ResizeObserver (prevents forced reflow inside 60fps rAF)
  const cachedMetricsRef = useRef<{
    clientWidth: number;
    scrollWidth: number;
    rightPanelWidth: number;
  }>({ clientWidth: 0, scrollWidth: 0, rightPanelWidth: 0 });

  // Sub-pixel float accumulator & integer scroll guard to avoid mobile rounding jitter
  const virtualScrollLeftRef = useRef<number>(0);
  const lastAppliedIntLeftRef = useRef<number>(0);
  const lastProgrammaticScrollRef = useRef<{ left: number; at: number }>({ left: 0, at: 0 });
  const programmaticGraceUntilRef = useRef<number>(0);
  const userScrollIntentAtRef = useRef<number>(0);
  const isFingerTouchingRef = useRef<boolean>(false);
  const touchPanStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasPlayingRef = useRef<boolean>(false);

  const latestRef = useRef({
    pxPerBeat,
    bpm,
    autoScrollMode,
    loopEnabled,
    loopStartBeat,
    loopEndBeat,
    isPlayingArrangement,
    autoScrollEnabled,
    followPaused,
    isDraggingInteraction,
  });
  latestRef.current = {
    pxPerBeat,
    bpm,
    autoScrollMode,
    loopEnabled,
    loopStartBeat,
    loopEndBeat,
    isPlayingArrangement,
    autoScrollEnabled,
    followPaused,
    isDraggingInteraction,
  };

  const refreshCachedMetrics = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    cachedMetricsRef.current = {
      clientWidth: scroller.clientWidth,
      scrollWidth: scroller.scrollWidth,
      rightPanelWidth: rightPanelRef.current?.offsetWidth ?? 0,
    };
    virtualScrollLeftRef.current = scroller.scrollLeft;
    lastAppliedIntLeftRef.current = Math.round(scroller.scrollLeft);
  }, [rightPanelRef, scrollerRef]);

  // Observe container & right panel sizes outside rAF to prevent forced layout thrashing
  useEffect(() => {
    refreshCachedMetrics();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      refreshCachedMetrics();
    });
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    if (rightPanelRef.current) observer.observe(rightPanelRef.current);
    return () => observer.disconnect();
  }, [refreshCachedMetrics, rightPanelRef, scrollerRef, pxPerBeat, panelCollapsed]);

  useEffect(() => {
    lastBeatTickRef.current = {
      beat: currentBeat,
      at: performance.now(),
    };
  }, [currentBeat]);

  const applyProgrammaticScroll = useCallback(
    (nextLeft: number, smooth = false) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const metrics = cachedMetricsRef.current;
      const maxScroll = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
      const clamped = Math.max(0, Math.min(maxScroll, nextLeft));
      const rounded = Math.round(clamped);

      virtualScrollLeftRef.current = clamped;
      if (rounded === lastAppliedIntLeftRef.current && Math.abs(scroller.scrollLeft - rounded) <= 1) {
        return;
      }

      const now = performance.now();
      lastAppliedIntLeftRef.current = rounded;
      lastProgrammaticScrollRef.current = { left: rounded, at: now };

      if (smooth && typeof scroller.scrollTo === 'function') {
        programmaticGraceUntilRef.current = now + 420;
        scroller.scrollTo({ left: rounded, behavior: 'smooth' });
      } else {
        programmaticGraceUntilRef.current = now + 60;
        scroller.scrollLeft = rounded;
      }
    },
    [scrollerRef]
  );

  const revealBeat = useCallback(
    (beat: number, modeOverride?: AutoScrollMode, forceReveal = true, smooth = false) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      refreshCachedMetrics();
      const metrics = cachedMetricsRef.current;
      const target = computeTimelineAutoScrollLeft({
        beat,
        pxPerBeat: latestRef.current.pxPerBeat,
        scrollLeft: scroller.scrollLeft,
        scrollWidth: metrics.scrollWidth,
        clientWidth: metrics.clientWidth,
        rightPanelWidth: metrics.rightPanelWidth,
        mode: modeOverride ?? latestRef.current.autoScrollMode,
        forceReveal,
      });
      if (target !== null) {
        const prefersReduced =
          typeof window !== 'undefined' &&
          Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        applyProgrammaticScroll(target, smooth && !prefersReduced);
      }
    },
    [applyProgrammaticScroll, refreshCachedMetrics, scrollerRef]
  );

  // When playback starts on Arrangement, resume follow & jump playhead into view if needed.
  // When playback stops, clear temporary manual-scroll pause.
  useEffect(() => {
    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlayingArrangement;

    if (isPlayingArrangement && !wasPlaying) {
      setFollowPaused(false);
      if (latestRef.current.autoScrollEnabled) {
        revealBeat(lastBeatTickRef.current.beat, latestRef.current.autoScrollMode, true, false);
      }
    } else if (!isPlayingArrangement && wasPlaying) {
      setFollowPaused(false);
    }
  }, [isPlayingArrangement, revealBeat]);

  // Keep playhead centered/visible when zooming horizontally or jumping externally while paused
  const prevZoomRef = useRef<number>(pxPerBeat);
  useEffect(() => {
    if (prevZoomRef.current === pxPerBeat) return;
    prevZoomRef.current = pxPerBeat;
    if (latestRef.current.autoScrollEnabled && !latestRef.current.followPaused) {
      revealBeat(lastBeatTickRef.current.beat, latestRef.current.autoScrollMode, true, false);
    }
  }, [pxPerBeat, revealBeat]);

  const prevPausedBeatRef = useRef<number>(currentBeat);
  useEffect(() => {
    const prev = prevPausedBeatRef.current;
    prevPausedBeatRef.current = currentBeat;
    if (
      !isPlayingArrangement &&
      latestRef.current.autoScrollEnabled &&
      !latestRef.current.isDraggingInteraction &&
      Math.abs(currentBeat - prev) > 0.5
    ) {
      revealBeat(currentBeat, latestRef.current.autoScrollMode, false, false);
    }
  }, [currentBeat, isPlayingArrangement, revealBeat]);

  const prevPanelCollapsedRef = useRef<boolean | undefined>(panelCollapsed);
  useEffect(() => {
    if (prevPanelCollapsedRef.current === panelCollapsed) return;
    prevPanelCollapsedRef.current = panelCollapsed;
    programmaticGraceUntilRef.current = performance.now() + 200;
    lastProgrammaticScrollRef.current.at = performance.now();
    if (latestRef.current.autoScrollEnabled && !latestRef.current.followPaused) {
      revealBeat(lastBeatTickRef.current.beat, latestRef.current.autoScrollMode, false, false);
    }
  }, [panelCollapsed, revealBeat]);

  // Zero-reflow 60fps requestAnimationFrame auto-scroll loop during arrangement playback
  useEffect(() => {
    if (!isPlayingArrangement || !autoScrollEnabled || followPaused || isDraggingInteraction) {
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    const scroller = scrollerRef.current;
    if (scroller) {
      refreshCachedMetrics();
    }

    let rafId = 0;
    let prevFrameAt = performance.now();

    const step = (now: number) => {
      const dtSec = Math.max(0.001, Math.min(0.1, (now - prevFrameAt) / 1000));
      prevFrameAt = now;

      const el = scrollerRef.current;
      const s = latestRef.current;
      if (
        el &&
        !isFingerTouchingRef.current &&
        s.isPlayingArrangement &&
        s.autoScrollEnabled &&
        !s.followPaused &&
        !s.isDraggingInteraction &&
        now >= programmaticGraceUntilRef.current
      ) {
        const metrics = cachedMetricsRef.current;
        if (metrics.clientWidth > 0 && metrics.scrollWidth > metrics.clientWidth) {
          const { beat: baseBeat, at } = lastBeatTickRef.current;
          const elapsedSec = Math.max(0, Math.min(0.25, (now - at) / 1000));
          let smoothBeat = Math.min(baseBeat + 0.25, baseBeat + elapsedSec * (s.bpm / 60));
          if (
            s.loopEnabled &&
            s.loopEndBeat > s.loopStartBeat &&
            baseBeat < s.loopEndBeat &&
            smoothBeat >= s.loopEndBeat
          ) {
            smoothBeat = s.loopStartBeat + (smoothBeat - s.loopEndBeat);
          }

          const visibleWidth = Math.max(80, metrics.clientWidth - metrics.rightPanelWidth);
          const currentVirtualLeft = virtualScrollLeftRef.current;
          const target = computeTimelineAutoScrollLeft({
            beat: smoothBeat,
            pxPerBeat: s.pxPerBeat,
            scrollLeft: currentVirtualLeft,
            scrollWidth: metrics.scrollWidth,
            clientWidth: metrics.clientWidth,
            rightPanelWidth: metrics.rightPanelWidth,
            mode: s.autoScrollMode,
            forceReveal: false,
          });

          if (target !== null) {
            const diff = target - currentVirtualLeft;
            const isLargeJump = Math.abs(diff) > visibleWidth * 0.35;
            if (s.autoScrollMode === 'page') {
              // Discrete page flip using compositor smooth scroll when motion is allowed
              applyProgrammaticScroll(target, !isLargeJump && !prefersReducedMotion);
            } else if (isLargeJump || prefersReducedMotion) {
              applyProgrammaticScroll(target, false);
            } else if (Math.abs(diff) >= 0.4) {
              const alpha = 1 - Math.exp(-16 * dtSec);
              applyProgrammaticScroll(currentVirtualLeft + diff * alpha, false);
            }
          }
        }
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    applyProgrammaticScroll,
    autoScrollEnabled,
    followPaused,
    isDraggingInteraction,
    isPlayingArrangement,
    refreshCachedMetrics,
    scrollerRef,
  ]);

  const toggleAutoScroll = useCallback(() => {
    if (autoScrollEnabled && followPaused) {
      setFollowPaused(false);
      revealBeat(lastBeatTickRef.current.beat, autoScrollMode, true, true);
      return;
    }
    const next = !autoScrollEnabled;
    setAutoScrollEnabled(next);
    setFollowPaused(false);
    try {
      window.localStorage.setItem(STORAGE_ENABLED_KEY, String(next));
    } catch {
      // ignore
    }
    if (next) {
      revealBeat(lastBeatTickRef.current.beat, autoScrollMode, true, true);
    }
  }, [autoScrollEnabled, autoScrollMode, followPaused, revealBeat]);

  const changeAutoScrollMode = useCallback(
    (nextMode: AutoScrollMode) => {
      setAutoScrollMode(nextMode);
      setAutoScrollEnabled(true);
      setFollowPaused(false);
      try {
        window.localStorage.setItem(STORAGE_MODE_KEY, nextMode);
        window.localStorage.setItem(STORAGE_ENABLED_KEY, 'true');
      } catch {
        // ignore
      }
      revealBeat(lastBeatTickRef.current.beat, nextMode, true, true);
    },
    [revealBeat]
  );

  const resumeFollowAtBeat = useCallback(
    (beat: number) => {
      setFollowPaused(false);
      if (latestRef.current.autoScrollEnabled) {
        revealBeat(beat, latestRef.current.autoScrollMode, true, true);
      }
    },
    [revealBeat]
  );

  // Scroller event handlers so manual wheel/touch/scrollbar drags pause follow cleanly
  const handleScrollerWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) > 1.5 || e.shiftKey) {
      userScrollIntentAtRef.current = performance.now();
    }
  }, []);

  const handleScrollerTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    isFingerTouchingRef.current = true;
    if (e.touches.length === 1) {
      touchPanStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else {
      touchPanStartRef.current = null;
    }
  }, []);

  const handleScrollerTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1 && touchPanStartRef.current) {
      const dx = Math.abs(e.touches[0].clientX - touchPanStartRef.current.x);
      const dy = Math.abs(e.touches[0].clientY - touchPanStartRef.current.y);
      if (dx > 8 && dx >= dy) {
        userScrollIntentAtRef.current = performance.now();
      }
    }
  }, []);

  const handleScrollerTouchEnd = useCallback(() => {
    isFingerTouchingRef.current = false;
    touchPanStartRef.current = null;
    if (scrollerRef.current) {
      virtualScrollLeftRef.current = scrollerRef.current.scrollLeft;
      lastAppliedIntLeftRef.current = Math.round(scrollerRef.current.scrollLeft);
    }
  }, [scrollerRef]);

  const handleScrollerScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const now = performance.now();
    // Always sync virtual accumulator when smooth-scroll or user touch moves the viewport
    if (now < programmaticGraceUntilRef.current || isFingerTouchingRef.current) {
      virtualScrollLeftRef.current = scroller.scrollLeft;
      lastAppliedIntLeftRef.current = Math.round(scroller.scrollLeft);
    }

    const s = latestRef.current;
    if (!s.isPlayingArrangement || !s.autoScrollEnabled || s.followPaused || s.isDraggingInteraction) {
      return;
    }
    if (now < programmaticGraceUntilRef.current) {
      return;
    }

    const movedSinceProgrammatic = Math.abs(scroller.scrollLeft - lastProgrammaticScrollRef.current.left);
    const msSinceProgrammatic = now - lastProgrammaticScrollRef.current.at;
    const recentUserIntent = now - userScrollIntentAtRef.current < 360;

    if ((recentUserIntent && movedSinceProgrammatic > 8) || (msSinceProgrammatic > 140 && movedSinceProgrammatic > 16)) {
      virtualScrollLeftRef.current = scroller.scrollLeft;
      lastAppliedIntLeftRef.current = Math.round(scroller.scrollLeft);
      setFollowPaused(true);
    }
  }, [scrollerRef]);

  return {
    autoScrollEnabled,
    autoScrollMode,
    followPaused,
    toggleAutoScroll,
    changeAutoScrollMode,
    resumeFollowAtBeat,
    handleScrollerWheel,
    handleScrollerTouchStart,
    handleScrollerTouchMove,
    handleScrollerTouchEnd,
    handleScrollerScroll,
  };
}
