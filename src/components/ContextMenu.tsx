import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ContextMenuActionItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
  dividerBefore?: boolean;
  sectionLabel?: string;
  onSelect: () => void;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  items: ContextMenuActionItem[];
  customBody?: React.ReactNode;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  open,
  x,
  y,
  title,
  subtitle,
  items,
  customBody,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const menuW = 248;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  const maxMenuH = Math.max(240, viewportH - 24);
  const estHeight = Math.min(maxMenuH, items.length * 36 + 96);
  const clampedLeft =
    typeof window !== 'undefined'
      ? Math.max(8, Math.min(window.innerWidth - menuW - 8, x))
      : x;
  const clampedTop =
    typeof window !== 'undefined'
      ? Math.max(8, Math.min(viewportH - estHeight - 12, y))
      : y;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 sm:bg-transparent"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={
          isMobile
            ? undefined
            : {
                left: clampedLeft,
                top: clampedTop,
                width: menuW,
                maxHeight: Math.max(220, viewportH - clampedTop - 12),
              }
        }
        className={
          isMobile
            ? 'fixed bottom-0 left-0 right-0 max-h-[78vh] rounded-t-2xl bg-[#161923] border-t border-white/[0.14] shadow-2xl flex flex-col overflow-hidden pb-safe'
            : 'fixed rounded-lg bg-[#161923] border border-white/[0.14] shadow-2xl flex flex-col overflow-hidden'
        }
      >
        {isMobile && (
          <div className="w-10 h-1 rounded-full bg-white/25 mx-auto mt-2 mb-1 shrink-0" />
        )}

        <div className="px-3 py-2 border-b border-white/[0.08] bg-[#1B1F2B] flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate">{title}</div>
            {subtitle && (
              <div className="text-[10px] text-zinc-400 truncate">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-y-auto py-1.5 px-1.5 flex flex-col gap-0.5">
          {customBody}

          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.dividerBefore && (
                <div className="my-1 border-t border-white/[0.08]" />
              )}
              {item.sectionLabel && (
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                  {item.sectionLabel}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect();
                }}
                className={`w-full px-2.5 py-2 sm:py-1.5 rounded text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                  item.disabled
                    ? 'opacity-35 cursor-not-allowed text-zinc-500'
                    : item.danger
                      ? 'text-rose-300 hover:bg-rose-500/20'
                      : item.active
                        ? 'bg-[#6D5DFB]/25 text-indigo-200'
                        : 'text-zinc-200 hover:bg-[#232836]'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {item.icon && <span className="shrink-0 opacity-85">{item.icon}</span>}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.shortcut && (
                  <span className="text-[10px] font-mono-tabular text-zinc-500 shrink-0">
                    {item.shortcut}
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
