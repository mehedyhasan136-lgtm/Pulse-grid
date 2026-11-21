import React from 'react';
import { useTouchParameter } from '../hooks/useTouchParameter';
import { X, Check } from 'lucide-react';

interface RotaryKnobProps {
  label?: string;
  ariaLabel?: string;
  compact?: boolean;
  step?: number;
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  color?: string;
  size?: number;
  bipolar?: boolean;
  displayValue?: string;
  onChange: (value: number) => void;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  ariaLabel,
  compact = false,
  step,
  value,
  min,
  max,
  defaultValue,
  color = '#38BDF8',
  size = 38,
  bipolar = false,
  displayValue,
  onChange,
}) => {
  const {
    isEditing,
    showInputModal,
    setShowInputModal,
    inputValue,
    setInputValue,
    commitInput,
    pointerProps,
  } = useTouchParameter({
    value,
    min,
    max,
    defaultValue,
    step,
    onChange,
  });

  const clamped = Math.max(min, Math.min(max, value));
  const norm = (clamped - min) / (max - min || 1);
  const startAngle = -135;
  const endAngle = 135;
  const angle = startAngle + norm * (endAngle - startAngle);

  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;

  const polarToCartesian = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (fromDeg: number, toDeg: number) => {
    const start = polarToCartesian(fromDeg);
    const end = polarToCartesian(toDeg);
    const diff = toDeg - fromDeg;
    const largeArc = Math.abs(diff) > 180 ? 1 : 0;
    const sweep = diff >= 0 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  };

  const indicatorEnd = polarToCartesian(angle);
  const trackPath = describeArc(startAngle, endAngle);
  const valuePath = bipolar ? describeArc(0, angle) : describeArc(startAngle, angle);

  return (
    <div className="flex flex-col items-center gap-0.5 select-none relative">
      <div
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel ?? label ?? 'Knob'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        {...pointerProps}
        className={`parameter-drag-area relative cursor-ns-resize rounded-full transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          isEditing ? 'ring-2 ring-[#6D5DFB]' : ''
        }`}
        title="Drag up/down to adjust · Double-tap to reset · Long-press for exact value"
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path
            d={trackPath}
            fill="none"
            stroke="#2B2F3B"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {Math.abs(bipolar ? angle : angle - startAngle) > 1 && (
            <path
              d={valuePath}
              fill="none"
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
          <circle
            cx={cx}
            cy={cy}
            r={r * 0.68}
            fill="#1B1E26"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1}
          />
          <line
            x1={cx}
            y1={cy}
            x2={cx + (indicatorEnd.x - cx) * 0.62}
            y2={cy + (indicatorEnd.y - cy) * 0.62}
            stroke="#F4F4F5"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>

        {/* Live Value Tooltip while dragging */}
        {isEditing && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-50 px-1.5 py-0.5 rounded bg-[#1C1F2B] border border-[#6D5DFB] font-mono text-[10px] text-white whitespace-nowrap shadow-lg pointer-events-none">
            {displayValue ?? clamped.toFixed(2)}
          </div>
        )}
      </div>

      {!compact && label && (
        <span className="text-[10px] text-zinc-400 leading-none truncate max-w-full">
          {label}
        </span>
      )}
      {!compact && displayValue && (
        <span className="font-mono-tabular text-[10px] text-zinc-200 leading-none">
          {displayValue}
        </span>
      )}

      {/* Exact Numerical Value Modal */}
      {showInputModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="exact-value-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs"
          onClick={() => setShowInputModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#161822] border border-white/[0.12] rounded-xl p-4 flex flex-col gap-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 id="exact-value-modal-title" className="text-xs font-bold text-white uppercase tracking-wider">
                {label ? `Set ${label}` : 'Set Value'}
              </h3>
              <button
                type="button"
                onClick={() => setShowInputModal(false)}
                aria-label="Close dialog"
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] text-zinc-400">
              Range: {min} — {max}
            </div>
            <input
              type="number"
              step="any"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitInput();
              }}
              autoFocus
              className="w-full h-9 px-3 rounded-lg bg-[#101217] border border-white/[0.15] text-white font-mono text-xs focus:outline-none focus:border-[#6D5DFB]"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowInputModal(false)}
                className="h-8 px-3 rounded-lg bg-[#222632] text-zinc-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitInput}
                className="h-8 px-3 rounded-lg bg-[#6D5DFB] hover:bg-[#5B4CE6] text-white text-xs font-semibold flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
