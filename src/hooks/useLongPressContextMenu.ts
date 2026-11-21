import React, { useEffect, useRef } from 'react';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface UseLongPressContextMenuOptions {
  delayMs?: number;
  moveThresholdPx?: number;
  onOpen: (pos: ContextMenuPosition) => void;
}

/**
 * Centralized long-press & desktop right-click handler.
 * Initiates a useRef timer ONLY on pointerdown, clears if pointer moves > 10px
 * (scroll protection), and suppresses the trailing click when a long-press fires.
 */
export function useLongPressContextMenu({
  delayMs = 500,
  moveThresholdPx = 10,
  onOpen,
}: UseLongPressContextMenuOptions) {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
    activePointerIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // Do not start long-press timer for right-click (handled by onContextMenu)
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    clearTimer();
    didLongPressRef.current = false;
    const x = e.clientX;
    const y = e.clientY;
    startPosRef.current = { x, y };
    activePointerIdRef.current = e.pointerId;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      didLongPressRef.current = true;
      startPosRef.current = null;
      activePointerIdRef.current = null;
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(14);
        }
      } catch {
        // ignore
      }
      onOpenRef.current({ x, y });
    }, delayMs);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (activePointerIdRef.current !== e.pointerId || !startPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - startPosRef.current.x,
      e.clientY - startPosRef.current.y
    );
    if (dist > moveThresholdPx) {
      clearTimer();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (activePointerIdRef.current === e.pointerId) {
      clearTimer();
    }
  };

  const onPointerCancel = () => {
    clearTimer();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimer();
    onOpenRef.current({ x: e.clientX, y: e.clientY });
  };

  const consumeLongPressClick = (): boolean => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return true;
    }
    return false;
  };

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onContextMenu,
    },
    consumeLongPressClick,
  };
}
