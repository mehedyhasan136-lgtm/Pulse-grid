import React, { useEffect, useRef, useState } from 'react';

export interface TouchParamConfig {
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  step?: number;
  sensitivity?: number; // base pixel travel for full range (default 140)
  zoomScale?: number; // optional zoom multiplier (>1 = finer)
  onChange: (val: number) => void;
  onSelect?: () => void;
}

export function useTouchParameter({
  value,
  min,
  max,
  defaultValue,
  step,
  sensitivity = 140,
  zoomScale = 1,
  onChange,
  onSelect,
}: TouchParamConfig) {
  const [isEditing, setIsEditing] = useState(false);
  const [showInputModal, setShowInputModal] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;

  const activePointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastYRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const workingValRef = useRef(value);
  const movedRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef(0);
  const downTimeRef = useRef(0);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(String(Math.round(value * 1000) / 1000));
    }
  }, [value, isEditing]);

  const clampAndSnap = (raw: number): number => {
    const clamped = Math.max(min, Math.min(max, raw));
    if (step && step > 0) {
      const snapped = min + Math.round((clamped - min) / step) * step;
      return Math.max(min, Math.min(max, Math.round(snapped * 10000) / 10000));
    }
    return clamped;
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, []);

  const cleanupCapture = (target: HTMLElement | null, pointerId: number | null) => {
    if (target && pointerId !== null) {
      try {
        if (target.hasPointerCapture?.(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
    }
    activePointerIdRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    try {
      target.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    activePointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    lastYRef.current = e.clientY;
    lastMoveTimeRef.current = performance.now();
    downTimeRef.current = lastMoveTimeRef.current;
    workingValRef.current = valueRef.current;
    movedRef.current = false;
    setIsEditing(true);

    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      if (!movedRef.current && activePointerIdRef.current === e.pointerId) {
        setIsEditing(false);
        setInputValue(String(Math.round(valueRef.current * 1000) / 1000));
        setShowInputModal(true);
        cleanupCapture(target, e.pointerId);
      }
    }, 550);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const totalDx = e.clientX - startXRef.current;
    const totalDy = e.clientY - startYRef.current;
    if (Math.hypot(totalDx, totalDy) > 5) {
      movedRef.current = true;
      clearLongPress();
    }

    const now = performance.now();
    const dt = Math.max(4, now - lastMoveTimeRef.current);
    const stepDeltaY = lastYRef.current - e.clientY; // positive when moving UP, negative when moving DOWN
    lastYRef.current = e.clientY;
    lastMoveTimeRef.current = now;

    if (Math.abs(stepDeltaY) < 0.05) return;

    const range = max - min;
    if (range <= 0) return;

    // Dynamic sensitivity scaling based on viewport height, parameter range, zoom, and pointer speed
    const screenHeightScale = Math.max(0.65, Math.min(1.35, window.innerHeight / 820));
    const rangeScale = Math.max(0.7, Math.min(1.8, Math.log10(range + 1) * 0.65 + 0.5));
    const zoomFactor = Math.max(0.5, Math.min(3, zoomScale));
    const effectivePxRange = sensitivity * screenHeightScale * rangeScale * zoomFactor;

    // Fine adjustment when moving slowly (< 0.14 px/ms) or Shift held on desktop
    const pxPerMs = Math.abs(stepDeltaY) / dt;
    let fineMultiplier = 1.0;
    if (e.shiftKey) {
      fineMultiplier = 0.25;
    } else if (pxPerMs < 0.12) {
      fineMultiplier = 0.45;
    } else if (pxPerMs > 0.9) {
      fineMultiplier = 1.2;
    }

    const deltaVal = (stepDeltaY / effectivePxRange) * range * fineMultiplier;
    workingValRef.current = Math.max(min, Math.min(max, workingValRef.current + deltaVal));
    const nextVal = clampAndSnap(workingValRef.current);
    onChangeRef.current(nextVal);
  };

  const finishPointer = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    clearLongPress();
    setIsEditing(false);
    cleanupCapture(e.currentTarget, e.pointerId);

    if (!cancelled && !movedRef.current) {
      const now = performance.now();
      const heldMs = now - downTimeRef.current;
      if (heldMs < 350) {
        onSelectRef.current?.();
        if (typeof defaultValue === 'number' && now - lastTapTimeRef.current < 320) {
          lastTapTimeRef.current = 0;
          onChangeRef.current(clampAndSnap(defaultValue));
          return;
        }
        lastTapTimeRef.current = now;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    finishPointer(e, false);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    finishPointer(e, true);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (typeof defaultValue === 'number') {
      onChangeRef.current(clampAndSnap(defaultValue));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const baseStep = step && step > 0 ? step : (max - min) / 25;
    const mult = e.shiftKey ? 0.25 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChangeRef.current(clampAndSnap(valueRef.current + baseStep * mult));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChangeRef.current(clampAndSnap(valueRef.current - baseStep * mult));
    } else if (e.key === 'Home' && typeof defaultValue === 'number') {
      e.preventDefault();
      onChangeRef.current(clampAndSnap(defaultValue));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setInputValue(String(Math.round(valueRef.current * 1000) / 1000));
      setShowInputModal(true);
    }
  };

  const commitInput = () => {
    const num = parseFloat(inputValue);
    if (!Number.isNaN(num)) {
      onChangeRef.current(clampAndSnap(num));
    }
    setShowInputModal(false);
  };

  return {
    isEditing,
    showInputModal,
    setShowInputModal,
    inputValue,
    setInputValue,
    commitInput,
    pointerProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onDoubleClick: handleDoubleClick,
      onKeyDown: handleKeyDown,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      style: {
        touchAction: 'none' as const,
        userSelect: 'none' as const,
        WebkitUserSelect: 'none' as const,
      },
    },
  };
}
