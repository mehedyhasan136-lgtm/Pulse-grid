import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Music,
  Play,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  InstrumentCatalogEntry,
  InstrumentCategory,
  SoundBankSummary,
  TrackModel,
} from '../types/daw';
import { DawStoreState } from '../audio/dawController';
import { getTrackInstrumentDisplayName } from '../data/presets';

type BrowserTab = 'All' | InstrumentCategory | 'Sound Banks';

const TABS: Array<{ id: BrowserTab; label: string }> = [
  { id: 'All', label: 'All' },
  { id: 'Keyboard', label: 'Keyboard' },
  { id: 'Strings', label: 'Strings' },
  { id: 'Bass', label: 'Bass' },
  { id: 'Drums', label: 'Drums' },
  { id: 'Synth', label: 'Synth' },
  { id: 'Sound Banks', label: 'Sound Banks (.sf2)' },
];

export interface InstrumentBrowserProps {
  catalog: InstrumentCatalogEntry[];
  soundBanks: SoundBankSummary[];
  selectedTrack: TrackModel | null;
  favoriteIds: string[];
  recentIds: string[];
  instrumentLoading: DawStoreState['instrumentLoading'];
  soundBankError: string | null;
  onPreviewPreset: (entry: InstrumentCatalogEntry) => void;
  onAssignPreset: (trackId: string, entry: InstrumentCatalogEntry) => void;
  onToggleFavorite: (instrumentId: string) => void;
  onImportSoundFontFile: (file: File) => void;
  onUnloadSoundBank: (bankId: string) => void;
  onDeleteSoundBank: (bankId: string) => void;
  onClearError: () => void;
  isSoundBankInMemory: (bankId: string) => boolean;
  memoryStats?: { bankCount: number; decodedZones: number; approxMb: number };
  compact?: boolean;
  onAfterAssign?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const InstrumentBrowser: React.FC<InstrumentBrowserProps> = ({
  catalog,
  soundBanks,
  selectedTrack,
  favoriteIds,
  recentIds,
  instrumentLoading,
  soundBankError,
  onPreviewPreset,
  onAssignPreset,
  onToggleFavorite,
  onImportSoundFontFile,
  onUnloadSoundBank,
  onDeleteSoundBank,
  onClearError,
  isSoundBankInMemory,
  memoryStats,
  compact = false,
  onAfterAssign,
}) => {
  const [activeTab, setActiveTab] = useState<BrowserTab>('All');
  const [query, setQuery] = useState('');
  const [isDragOverSf2, setIsDragOverSf2] = useState(false);
  const [expandedBankIds, setExpandedBankIds] = useState<Record<string, boolean>>({});
  const sf2InputRef = useRef<HTMLInputElement | null>(null);

  const canAssignToSelected = Boolean(selectedTrack && !selectedTrack.isGroupFolder);
  const activeInstrumentId = selectedTrack?.instrument.params.instrumentId;
  const activeBankId = selectedTrack?.instrument.params.soundBankId;
  const activeBankNum = selectedTrack?.instrument.params.bankNumber;
  const activeProgramNum = selectedTrack?.instrument.params.programNumber;

  const isEntryActiveOnTrack = (entry: InstrumentCatalogEntry): boolean => {
    if (!selectedTrack || selectedTrack.instrument.type !== 'soundfont') return false;
    if (activeInstrumentId && activeInstrumentId === entry.id) return true;
    return (
      activeBankId === entry.soundBankId &&
      activeBankNum === entry.bank &&
      activeProgramNum === entry.program
    );
  };

  const catalogById = useMemo(() => {
    const map = new Map<string, InstrumentCatalogEntry>();
    for (const item of catalog) {
      map.set(item.id, item);
    }
    return map;
  }, [catalog]);

  const favoriteEntries = useMemo(
    () =>
      favoriteIds
        .map((id) => catalogById.get(id))
        .filter((e): e is InstrumentCatalogEntry => Boolean(e)),
    [favoriteIds, catalogById]
  );

  const recentEntries = useMemo(
    () =>
      recentIds
        .map((id) => catalogById.get(id))
        .filter((e): e is InstrumentCatalogEntry => Boolean(e)),
    [recentIds, catalogById]
  );

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((entry) => {
      if (activeTab !== 'All' && activeTab !== 'Sound Banks' && entry.category !== activeTab) {
        return false;
      }
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.soundBankName.toLowerCase().includes(q)
      );
    });
  }, [catalog, activeTab, query]);

  const filteredBanks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return soundBanks;
    return soundBanks.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.fileName.toLowerCase().includes(q) ||
        b.presetsMeta.some((p) => p.name.toLowerCase().includes(q))
    );
  }, [soundBanks, query]);

  const handleAssign = (entry: InstrumentCatalogEntry) => {
    if (!selectedTrack || selectedTrack.isGroupFolder) return;
    onAssignPreset(selectedTrack.id, entry);
    onAfterAssign?.();
  };

  const handleSf2Files = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file) {
      onImportSoundFontFile(file);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#101218] text-zinc-100 select-none overflow-hidden">
      <input
        ref={sf2InputRef}
        type="file"
        accept=".sf2"
        className="hidden"
        onChange={(e) => {
          handleSf2Files(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Active Track & Instrument Context Bar */}
      <div className="px-3 py-2.5 bg-[#15171F] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {selectedTrack && (
            <span
              className="w-2.5 h-2.5 rounded-xs shrink-0"
              style={{ backgroundColor: selectedTrack.color }}
            />
          )}
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate">
              {selectedTrack ? selectedTrack.name : 'No Track Selected'}
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {selectedTrack
                ? selectedTrack.isGroupFolder
                  ? 'Group Bus · Select a MIDI track to assign an instrument'
                  : `Active: ${getTrackInstrumentDisplayName(selectedTrack)}${
                      selectedTrack.instrument.type === 'soundfont' &&
                      typeof selectedTrack.instrument.params.programNumber === 'number'
                        ? ` · Bank ${selectedTrack.instrument.params.bankNumber ?? 0} · Prog ${selectedTrack.instrument.params.programNumber}`
                        : ''
                    }`
                : 'Select a MIDI track in your session or arrangement'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => sf2InputRef.current?.click()}
          className="min-h-[44px] sm:min-h-[36px] px-3.5 rounded-lg bg-[#1E222E] hover:bg-[#272C3B] border border-white/[0.1] text-xs font-semibold text-zinc-100 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
        >
          <Upload className="w-3.5 h-3.5 text-[#8B5CF6]" />
          <span>Import .sf2</span>
        </button>
      </div>

      {/* Category Tabs */}
      <div className="px-3 py-2 bg-[#13151D] border-b border-white/[0.08] flex items-center gap-1.5 overflow-x-auto shrink-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count =
            tab.id === 'All'
              ? catalog.length
              : tab.id === 'Sound Banks'
                ? soundBanks.length
                : catalog.filter((c) => c.category === tab.id).length;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-[#6D5DFB] text-white'
                  : 'bg-[#191C26] text-zinc-300 hover:bg-[#222634] hover:text-white'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono-tabular text-[11px] ${
                  isActive ? 'text-indigo-100' : 'text-zinc-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="px-3 py-2 bg-[#12141B] border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <div className="relative flex-1 flex items-center">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              activeTab === 'Sound Banks'
                ? 'Search SoundFont banks or presets...'
                : 'Search Grand Piano, Strings, Bass, Drums, Synth...'
            }
            className="w-full min-h-[44px] sm:min-h-[36px] pl-9 pr-9 rounded-lg bg-[#0D0F14] border border-white/[0.1] text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#6D5DFB]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Loading Progress Bar */}
      {instrumentLoading && (
        <div className="px-3 py-2 bg-[#171A26] border-b border-[#6D5DFB]/40 flex flex-col gap-1 shrink-0">
          <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-200">
            <span className="truncate">Loading {instrumentLoading.name}...</span>
            <span className="font-mono-tabular shrink-0">
              {Math.round(instrumentLoading.progress * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded bg-[#0C0E14] overflow-hidden">
            <div
              className="h-full bg-[#6D5DFB] transition-[width] duration-150"
              style={{ width: `${Math.max(8, Math.round(instrumentLoading.progress * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* SoundFont Validation / Decode Error Banner */}
      {soundBankError && (
        <div
          role="alert"
          className="mx-3 mt-2.5 p-2.5 rounded-lg bg-rose-500/12 border border-rose-500/40 flex items-center justify-between gap-2 text-xs text-rose-200 shrink-0"
        >
          <span className="min-w-0 flex-1">{soundBankError}</span>
          <button
            type="button"
            onClick={onClearError}
            aria-label="Dismiss SoundFont error"
            className="min-h-[36px] px-2.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4">
        {activeTab === 'Sound Banks' ? (
          <div className="flex flex-col gap-3">
            {/* Import Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOverSf2(true);
              }}
              onDragLeave={() => setIsDragOverSf2(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOverSf2(false);
                handleSf2Files(e.dataTransfer.files);
              }}
              className={`p-4 rounded-xl border border-dashed flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors ${
                isDragOverSf2
                  ? 'border-[#6D5DFB] bg-[#6D5DFB]/15'
                  : 'border-white/[0.15] bg-[#15171F]'
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  Load SoundFont (.sf2) Bank
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Banks are saved locally in IndexedDB and decoded lazily per preset to protect mobile RAM.
                </div>
                {memoryStats && (
                  <div className="text-[11px] font-mono-tabular text-zinc-400 mt-1">
                    RAM Cache: {memoryStats.bankCount} bank{memoryStats.bankCount === 1 ? '' : 's'} ·{' '}
                    {memoryStats.decodedZones} decoded zones · ~{memoryStats.approxMb.toFixed(1)} MB
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => sf2InputRef.current?.click()}
                className="min-h-[44px] px-4 rounded-lg bg-[#6D5DFB] hover:bg-[#7D6EFF] text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Upload className="w-4 h-4" />
                <span>Choose .sf2 File</span>
              </button>
            </div>

            {filteredBanks.length === 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-[#15171F] p-6 text-center flex flex-col items-center gap-1.5">
                <HardDrive className="w-6 h-6 text-zinc-500" />
                <div className="text-sm font-semibold text-zinc-200">
                  No SoundFont (.sf2) banks installed
                </div>
                <p className="text-xs text-zinc-400 max-w-md">
                  Import any SoundFont 2 (.sf2) file from your device to browse its presets, audition notes, and assign them to any MIDI track.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {filteredBanks.map((bank) => {
                  const inRam = isSoundBankInMemory(bank.id);
                  const expanded = Boolean(expandedBankIds[bank.id]);
                  const bankEntries = catalog.filter((c) => c.soundBankId === bank.id);

                  return (
                    <div
                      key={bank.id}
                      className="rounded-xl border border-white/[0.09] bg-[#15171F] overflow-hidden"
                    >
                      <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedBankIds((prev) => ({ ...prev, [bank.id]: !prev[bank.id] }))
                          }
                          className="min-h-[44px] flex items-center gap-2.5 text-left min-w-0 flex-1"
                        >
                          {expanded ? (
                            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white truncate">{bank.name}</div>
                            <div className="text-[11px] font-mono-tabular text-zinc-400 truncate">
                              {bank.fileName} · {formatBytes(bank.sizeBytes)} ·{' '}
                              {bank.presetsMeta.length} presets ·{' '}
                              <span className={inRam ? 'text-emerald-400' : 'text-zinc-500'}>
                                {inRam ? 'Loaded in RAM' : 'Saved on Disk'}
                              </span>
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={!inRam}
                            onClick={() => onUnloadSoundBank(bank.id)}
                            className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg bg-[#202431] hover:bg-[#2A2F40] disabled:opacity-40 text-xs font-semibold text-zinc-200 whitespace-nowrap"
                          >
                            Unload RAM
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSoundBank(bank.id)}
                            aria-label={`Delete ${bank.name}`}
                            className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg bg-[#202431] hover:bg-rose-600/25 text-zinc-300 hover:text-rose-200 flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="border-t border-white/[0.07] bg-[#101218] p-2.5 grid grid-cols-1 md:grid-cols-2 gap-2">
                          {bankEntries.map((entry) => {
                            const active = isEntryActiveOnTrack(entry);
                            return (
                              <div
                                key={entry.id}
                                className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                                  active
                                    ? 'bg-[#6D5DFB]/15 border-[#6D5DFB]'
                                    : 'bg-[#161922] border-white/[0.08]'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-white truncate">
                                    {entry.name}
                                  </div>
                                  <div className="text-[11px] font-mono-tabular text-zinc-400 truncate">
                                    {entry.category} · Bank {entry.bank} · Prog {entry.program}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => onPreviewPreset(entry)}
                                    aria-label={`Preview ${entry.name}`}
                                    className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] rounded-lg bg-[#222632] hover:bg-[#2F3545] text-zinc-100 flex items-center justify-center"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canAssignToSelected}
                                    onClick={() => handleAssign(entry)}
                                    className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-40 ${
                                      active
                                        ? 'bg-emerald-500 text-zinc-950'
                                        : 'bg-[#6D5DFB] hover:bg-[#7C6EFF] text-white'
                                    }`}
                                  >
                                    {active && <Check className="w-3.5 h-3.5" />}
                                    <span>{active ? 'Active' : 'Assign'}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Favorites & Recently Used Quick Access */}
            {!query && activeTab === 'All' && favoriteEntries.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-zinc-400">
                  Favorites ({favoriteEntries.length})
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {favoriteEntries.map((entry) => {
                    const active = isEntryActiveOnTrack(entry);
                    return (
                      <div
                        key={`fav-${entry.id}`}
                        className={`rounded-lg border px-2.5 py-1.5 flex items-center gap-2 shrink-0 ${
                          active
                            ? 'bg-[#6D5DFB]/20 border-[#6D5DFB]'
                            : 'bg-[#161922] border-white/[0.08]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onPreviewPreset(entry)}
                          aria-label={`Preview ${entry.name}`}
                          className="min-h-[36px] min-w-[36px] rounded bg-[#222632] hover:bg-[#2F3545] text-zinc-100 flex items-center justify-center"
                        >
                          <Play className="w-3 h-3 fill-current" />
                        </button>
                        <button
                          type="button"
                          disabled={!canAssignToSelected}
                          onClick={() => handleAssign(entry)}
                          className="min-h-[36px] text-left pr-1 disabled:opacity-50"
                        >
                          <div className="text-xs font-semibold text-white whitespace-nowrap">
                            {entry.name}
                          </div>
                          <div className="text-[10px] text-zinc-400 whitespace-nowrap">
                            {entry.category}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!query && activeTab === 'All' && recentEntries.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-zinc-400">
                  Recently Used
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {recentEntries.slice(0, 8).map((entry) => (
                    <button
                      key={`rec-${entry.id}`}
                      type="button"
                      disabled={!canAssignToSelected}
                      onClick={() => handleAssign(entry)}
                      className="min-h-[44px] sm:min-h-[34px] px-3 rounded-lg bg-[#161922] hover:bg-[#202431] border border-white/[0.08] text-xs font-medium text-zinc-200 whitespace-nowrap shrink-0 disabled:opacity-45"
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Catalog Cards */}
            {filteredCatalog.length === 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-[#15171F] p-6 text-center flex flex-col items-center gap-1.5">
                <Music className="w-6 h-6 text-zinc-500" />
                <div className="text-sm font-semibold text-zinc-200">
                  No instruments match &ldquo;{query}&rdquo;
                </div>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="min-h-[40px] px-3 rounded-lg bg-[#222632] text-xs font-semibold text-zinc-200 mt-1"
                >
                  Clear Filter
                </button>
              </div>
            ) : (
              <div
                className={`grid gap-2.5 ${
                  compact
                    ? 'grid-cols-1 md:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
                }`}
              >
                {filteredCatalog.map((entry) => {
                  const isActive = isEntryActiveOnTrack(entry);
                  const isFav = favoriteIds.includes(entry.id);

                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 transition-colors ${
                        isActive
                          ? 'bg-[#1D1B31] border-[#6D5DFB]'
                          : 'bg-[#15171F] border-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-bold text-white leading-snug">
                            {entry.name}
                          </div>
                          <button
                            type="button"
                            onClick={() => onToggleFavorite(entry.id)}
                            aria-label={
                              isFav
                                ? `Remove ${entry.name} from favorites`
                                : `Favorite ${entry.name}`
                            }
                            aria-pressed={isFav}
                            className={`min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] -m-1.5 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                              isFav ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200'
                            }`}
                          >
                            <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                          </button>
                        </div>

                        <div className="text-[11px] text-zinc-400 font-mono-tabular truncate">
                          {entry.category} ·{' '}
                          {entry.source === 'builtin' ? 'PulseGrid Library' : entry.soundBankName} ·
                          Bank {entry.bank} · Prog {entry.program}
                        </div>

                        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
                          {entry.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onPreviewPreset(entry)}
                          className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg bg-[#202431] hover:bg-[#2B3042] text-xs font-semibold text-zinc-100 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current text-emerald-400" />
                          <span>Preview</span>
                        </button>

                        <button
                          type="button"
                          disabled={!canAssignToSelected}
                          onClick={() => handleAssign(entry)}
                          className={`flex-1 min-h-[44px] sm:min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 ${
                            isActive
                              ? 'bg-emerald-500 text-zinc-950'
                              : 'bg-[#6D5DFB] hover:bg-[#7D6EFF] text-white'
                          }`}
                        >
                          {isActive && <Check className="w-3.5 h-3.5" />}
                          <span>
                            {!canAssignToSelected
                              ? 'Select MIDI Track'
                              : isActive
                                ? 'Assigned'
                                : 'Assign to Track'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
