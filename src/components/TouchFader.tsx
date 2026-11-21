import React from 'react';
import { Check, X } from 'lucide-react';
import { useTouchParameter } from '../hooks/useTouchParameter';

interface TouchFaderProps {
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  step?: number;
  orientation?: 'vertical' | 'horizontal';
  heightClass?: string;
  widthClass?: string;
  accentColor?: string;
  label?: string;
  displayValue?: string;
  sensitivity?: number;
  ariaLabel?: string;
  onChange: (value: number) => void;
  onSelect?: () => void;
}

export const TouchFader: React.FC<TouchFaderProps> = ({
  value,
  min,
  max,
  defaultValue,
  step,
  orientation = 'vertical',
  heightClass = 'h-32',
  widthClass = 'w-full',
  accentColor = '#34D399',
  label,
  displayValue,
  sensitivity = 140,
  ariaLabel,
  onChange,
  onSelect,
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
    sensitivity,
    onChange,
    onSelect,
  });

  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min || 1)) * 100;
  const formatted = displayValue ?? (step && step >= 1 ? `${Math.round(clamped)}` : clamped.toFixed(2));

  return (
    <div
      className={`relative select-none ${
        orientation === 'vertical' ? `flex items-center justify-center ${heightClass}` : `${widthClass}`
      }`}
    >
      {orientation === 'vertical' ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel ?? label ?? 'Fader'}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={clamped}
          {...pointerProps}
          className={`parameter-drag-area relative w-9 ${heightClass} flex items-center justify-center cursor-ns-resize focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5DFB] rounded`}
          title="Touch & drag up/down to adjust · Double-tap to reset · Long-press for exact value"
        >
          {/* Fader Groove */}
          <div className="relative w-1.5 h-[88%] rounded-full bg-[#0D0F14] border border-white/[0.1] overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 rounded-full transition-[height] duration-75"
              style={{
                height: `${pct}%`,
                backgroundColor: accentColor,
                opacity: 0.75,
              }}
            />
          </div>

          {/* Fader Cap */}
          <div
            style={{
              bottom: `calc(${pct}% * 0.84 + 8% - 9px)`,
              borderColor: isEditing ? accentColor : 'rgba(255,255,255,0.22)',
            }}
            className={`absolute left-1 right-1 h-[18px] rounded-[4px] bg-[#2B303D] border shadow-md flex items-center justify-center pointer-events-none transition-transform ${
              isEditing ? 'scale-105 bg-[#363C4D]' : ''
            }`}
          >
            <span className="w-4 h-[2px] rounded-full bg-white/80" />
          </div>

          {/* Live Value Badge */}
          {isEditing && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-50 px-1.5 py-0.5 rounded bg-[#1C1F2B] border border-[#6D5DFB] font-mono-tabular text-[10px] text-white whitespace-nowrap shadow-lg pointer-events-none">
              {formatted}
            </div>
          )}
        </div>
      ) : (
        <div
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel ?? label ?? 'Parameter slider'}
          aria-orientation="horizontal"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={clamped}
          {...pointerProps}
          className={`parameter-drag-area relative h-7 ${widthClass} flex items-center cursor-ns-resize focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5DFB] rounded`}
          title="Touch & drag up/down to adjust · Double-tap to reset · Long-press for exact value"
        >
          <div className="relative w-full h-2 rounded-full bg-[#0D0F14] border border-white/[0.1] overflow-hidden">
            <div
              className="absolute top-0 bottom-0 left-0 rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: accentColor,
                opacity: 0.85,
              }}
            />
          </div>
          <div
            style={{
              left: `calc(${pct}% - 8px)`,
              borderColor: isEditing ? accentColor : '#111214',
            }}
            className={`absolute w-4 h-4 rounded-[4px] bg-zinc-100 border-2 shadow pointer-events-none transition-transform ${
              isEditing ? 'scale-110 bg-emerald-300' : ''
            }`}
          />

          {isEditing && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-50 px-1.5 py-0.5 rounded bg-[#1C1F2B] border border-[#6D5DFB] font-mono-tabular text-[10px] text-white whitespace-nowrap shadow-lg pointer-events-none">
              {formatted}
            </div>
          )}
        </div>
      )}

      {/* Exact Numerical Value Modal */}
      {showInputModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs"
          onClick={() => setShowInputModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#161822] border border-white/[0.12] rounded-xl p-4 flex flex-col gap-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                {label ? `Set ${label}` : ariaLabel ? `Set ${ariaLabel}` : 'Set Value'}
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
            <div className="text-[11px] text-zinc-400 font-mono-tabular">
              Range: {min} — {max}
            </div>
            <input
              type="number"
              step="any"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitInput();
                if (e.key === 'Escape') setShowInputModal(false);
              }}
              autoFocus
              className="w-full h-10 px-3 rounded-lg bg-[#101217] border border-white/[0.15] text-white font-mono text-sm focus:outline-none focus:border-[#6D5DFB]"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowInputModal(false)}
                className="h-9 px-3 rounded-lg bg-[#222632] text-zinc-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitInput}
                className="h-9 px-3.5 rounded-lg bg-[#6D5DFB] hover:bg-[#5B4CE6] text-white text-xs font-semibold flex items-center gap-1"
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
