import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Upload,
  FolderPlus,
  Save,
  Trash2,
  X,
  Music,
  Sliders,
  Disc,
  Piano,
  FolderOpen,
  Cpu,
  Download,
  Play,
  Library,
} from 'lucide-react';
import { LIBRARY_ITEMS, LibraryPresetItem } from '../data/presets';
import {
  InstrumentCatalogEntry,
  InstrumentType,
  ProjectSummary,
  SoundBankSummary,
  StoredAudioAsset,
  TrackModel,
} from '../types/daw';

type BrowserCategory =
  | 'Sounds'
  | 'Drums'
  | 'Instruments'
  | 'Audio Effects'
  | 'MIDI Effects'
  | 'Samples'
  | 'Packs'
  | 'Projects';

const CATEGORIES: BrowserCategory[] = [
  'Instruments',
  'Sounds',
  'Drums',
  'Audio Effects',
  'MIDI Effects',
  'Samples',
  'Packs',
  'Projects',
];

interface BrowserSidebarProps {
  open: boolean;
  activeProjectId: string;
  activeProjectName: string;
  selectedTrackName: string;
  selectedTrack?: TrackModel | null;
  selectedInstrumentType?: InstrumentType;
  savedProjects: ProjectSummary[];
  audioAssets: StoredAudioAsset[];
  instrumentCatalog?: InstrumentCatalogEntry[];
  soundBanks?: SoundBankSummary[];
  onClose: () => void;
  onAssignTrackInstrument?: (trackId: string, entry: InstrumentCatalogEntry) => void;
  onPreviewInstrumentPreset?: (entry: InstrumentCatalogEntry) => void;
  onImportSoundFontFile?: (file: File) => void;
  onOpenInstrumentBrowser?: (trackId?: string) => void;
  onApplyPreset: (item: LibraryPresetItem) => void;
  onImportAudioFiles: (files: FileList) => void;
  onLoadSampleToSampler: (asset: StoredAudioAsset) => void;
  onAddSampleToArrangement: (asset: StoredAudioAsset) => void;
  onDeleteSample: (assetId: string) => void;
  onCreateProject: () => void;
  onSaveProject: () => void;
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (name: string) => void;
  onExportProjectJson?: (projectId?: string) => void;
  onImportProjectJsonFile?: (file: File) => void;
}

export const BrowserSidebar: React.FC<BrowserSidebarProps> = ({
  open,
  activeProjectId,
  activeProjectName,
  selectedTrackName,
  selectedTrack = null,
  selectedInstrumentType,
  savedProjects,
  audioAssets,
  instrumentCatalog = [],
  soundBanks = [],
  onClose,
  onAssignTrackInstrument,
  onPreviewInstrumentPreset,
  onImportSoundFontFile,
  onOpenInstrumentBrowser,
  onApplyPreset,
  onImportAudioFiles,
  onLoadSampleToSampler,
  onAddSampleToArrangement,
  onDeleteSample,
  onCreateProject,
  onSaveProject,
  onLoadProject,
  onDeleteProject,
  onRenameProject,
  onExportProjectJson,
  onImportProjectJsonFile,
}) => {
  const [category, setCategory] = useState<BrowserCategory>('Instruments');
  const [query, setQuery] = useState('');
  const [editingName, setEditingName] = useState(activeProjectName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sf2SidebarInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarJsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setEditingName(activeProjectName);
  }, [activeProjectName]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const quickInstruments: Array<{
    id: string;
    label: string;
    presetId: string;
    icon: React.ReactNode;
    isGesture?: boolean;
    activeMatch: boolean;
  }> = [
    {
      id: 'q-piano',
      label: 'Piano',
      presetId: 'inst-piano-grand',
      icon: <Piano className="w-3.5 h-3.5 text-zinc-300 shrink-0" />,
      activeMatch: selectedInstrumentType === 'gesturePiano',
    },
    {
      id: 'q-synth',
      label: 'Synthesizer',
      presetId: 'inst-synth',
      icon: <Cpu className="w-3.5 h-3.5 text-zinc-300 shrink-0" />,
      activeMatch: selectedInstrumentType === 'synth' || selectedInstrumentType === 'bassSynth',
    },
    {
      id: 'q-drum',
      label: 'Drum Machine',
      presetId: 'inst-drum',
      icon: <Disc className="w-3.5 h-3.5 text-zinc-300 shrink-0" />,
      activeMatch: selectedInstrumentType === 'drumSynth',
    },
    {
      id: 'q-sampler',
      label: 'Sampler',
      presetId: 'inst-sampler',
      icon: <Music className="w-3.5 h-3.5 text-zinc-300 shrink-0" />,
      activeMatch: selectedInstrumentType === 'sampler',
    },
  ];

  const filteredCatalog = instrumentCatalog.filter(
    (entry) =>
      entry.name.toLowerCase().includes(query.toLowerCase()) ||
      entry.category.toLowerCase().includes(query.toLowerCase()) ||
      entry.soundBankName.toLowerCase().includes(query.toLowerCase())
  );

  const filteredLibrary = LIBRARY_ITEMS.filter(
    (item) =>
      item.category === category &&
      (item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()))
  );

  const filteredAssets = audioAssets.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase())
  );

  const filteredProjects = savedProjects.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside
      aria-label="Browser and Sound Library"
      className="fixed md:static inset-y-0 left-0 z-50 md:z-auto w-72 md:w-64 bg-[#16181D] border-r border-white/[0.08] flex flex-col shrink-0 select-none"
    >
      {/* Header */}
      <div className="h-10 px-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
          Browser
        </span>
        <span className="text-[11px] text-zinc-500 truncate">
          Target: {selectedTrackName}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close browser"
          className="md:hidden w-7 h-7 rounded flex items-center justify-center text-zinc-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-white/[0.06]">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search instruments..."
            className="w-full h-8 pl-8 pr-11 bg-[#111214] border border-white/[0.08] rounded text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#8B5CF6]/70"
          />
          <span className="hidden sm:inline-block absolute right-2 text-[9px] font-mono-tabular text-zinc-500 pointer-events-none">
            Ctrl+F
          </span>
        </div>
      </div>

      {/* Split Category List + Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Categories Rail */}
        <nav className="w-24 border-r border-white/[0.06] py-1.5 flex flex-col justify-between overflow-y-auto bg-[#13151A]">
          <div className="flex flex-col gap-0.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2 py-2 text-left text-[11px] font-semibold transition-colors truncate ${
                  category === cat
                    ? 'bg-[#252830] text-indigo-300 border-r-2 border-[#6D5DFB]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="pt-2 mt-2 border-t border-white/[0.06] px-2 flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              Favorites
            </span>
            <button
              type="button"
              onClick={() => setCategory('Drums')}
              className="flex items-center gap-1.5 py-1 text-[10px] text-zinc-300 hover:text-white text-left"
            >
              <span className="w-2 h-2 rounded-full bg-[#F97316] shrink-0" />
              <span className="truncate">Drum Kits</span>
            </button>
            <button
              type="button"
              onClick={() => setCategory('Sounds')}
              className="flex items-center gap-1.5 py-1 text-[10px] text-zinc-300 hover:text-white text-left"
            >
              <span className="w-2 h-2 rounded-full bg-[#8B5CF6] shrink-0" />
              <span className="truncate">Synths</span>
            </button>
            <button
              type="button"
              onClick={() => setCategory('Instruments')}
              className="flex items-center gap-1.5 py-1 text-[10px] text-zinc-300 hover:text-white text-left"
            >
              <span className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
              <span className="truncate">Bass</span>
            </button>
          </div>
        </nav>

        {/* Items Pane */}
        <div className="flex-1 min-w-0 overflow-y-auto p-2 flex flex-col gap-1.5">
          {category === 'Samples' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onImportAudioFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 px-2.5 rounded bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Audio</span>
              </button>

              {filteredAssets.length === 0 ? (
                <p className="text-[11px] text-zinc-500 leading-relaxed p-1">
                  Import WAV, MP3, or OGG files from your device, or record audio onto an armed Audio track.
                </p>
              ) : (
                filteredAssets.map((asset) => (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-pulsegrid-asset', asset.id);
                    }}
                    className="p-2 rounded bg-[#1B1E24] border border-white/[0.07] flex flex-col gap-1.5 cursor-grab"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-zinc-200 truncate">
                        {asset.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteSample(asset.id)}
                        aria-label={`Delete ${asset.name}`}
                        className="text-zinc-500 hover:text-rose-400 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-[10px] font-mono-tabular text-zinc-500">
                      {asset.durationSeconds.toFixed(1)}s · Drag or load
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => onLoadSampleToSampler(asset)}
                        className="py-1 rounded bg-[#252830] hover:bg-[#303440] text-[10px] font-semibold text-zinc-200"
                      >
                        Sampler
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddSampleToArrangement(asset)}
                        className="py-1 rounded bg-[#252830] hover:bg-[#303440] text-[10px] font-semibold text-zinc-200"
                      >
                        + Arrange
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {category === 'Projects' && (
            <>
              <input
                ref={sidebarJsonFileInputRef}
                type="file"
                accept=".json,.pulsegrid.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onImportProjectJsonFile?.(file);
                    e.target.value = '';
                  }
                }}
              />

              <div className="flex flex-col gap-1.5 pb-2 border-b border-white/[0.06]">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => onRenameProject(editingName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onRenameProject(editingName);
                  }}
                  aria-label="Project name"
                  className="h-7 px-2 rounded bg-[#111214] border border-white/[0.08] text-xs text-zinc-100"
                />
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={onSaveProject}
                    className="py-1.5 px-2 rounded bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[11px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Save className="w-3 h-3" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="py-1.5 px-2 rounded bg-[#252830] text-zinc-200 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1"
                  >
                    <FolderPlus className="w-3 h-3" />
                    <span>New</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => onExportProjectJson?.(activeProjectId)}
                    className="py-1 px-1.5 rounded bg-[#1C1F2B] border border-white/[0.08] text-zinc-300 hover:text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <Download className="w-2.5 h-2.5 text-emerald-400" />
                    <span>Export JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sidebarJsonFileInputRef.current?.click()}
                    className="py-1 px-1.5 rounded bg-[#1C1F2B] border border-white/[0.08] text-zinc-300 hover:text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <Upload className="w-2.5 h-2.5 text-[#8B5CF6]" />
                    <span>Import JSON</span>
                  </button>
                </div>
              </div>

              {filteredProjects.map((proj) => {
                const isCurrent = proj.id === activeProjectId;
                return (
                  <div
                    key={proj.id}
                    className={`p-2 rounded border flex flex-col gap-1 ${
                      isCurrent
                        ? 'bg-emerald-500/10 border-emerald-400/40'
                        : 'bg-[#1B1E24] border-white/[0.07]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-zinc-100 truncate">
                        {proj.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onExportProjectJson?.(proj.id)}
                          title={`Export "${proj.name}" to JSON`}
                          className="text-zinc-400 hover:text-white"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => onDeleteProject(proj.id)}
                            aria-label={`Delete ${proj.name}`}
                            className="text-zinc-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono-tabular text-zinc-400">
                      <span>{proj.bpm} BPM · {proj.trackCount} trk</span>
                      {!isCurrent ? (
                        <button
                          type="button"
                          onClick={() => onLoadProject(proj.id)}
                          className="text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-0.5"
                        >
                          <FolderOpen className="w-3 h-3" />
                          <span>Load</span>
                        </button>
                      ) : (
                        <span className="text-emerald-400 font-semibold">Active</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {category === 'Packs' &&
            LIBRARY_ITEMS.filter((i) => i.instrumentType).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplyPreset(item)}
                className="w-full p-2 rounded bg-[#1B1E24] hover:bg-[#242830] border border-white/[0.07] text-left flex flex-col gap-0.5 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                  <Music className="w-3 h-3 text-[#8B5CF6] shrink-0" />
                  <span className="truncate">{item.name}</span>
                </div>
                <span className="text-[10px] text-zinc-400 leading-snug">
                  {item.description}
                </span>
              </button>
            ))}

          {category === 'Instruments' && (
            <>
              <input
                ref={sf2SidebarInputRef}
                type="file"
                accept=".sf2"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onImportSoundFontFile?.(file);
                    e.target.value = '';
                  }
                }}
              />
              <div className="flex flex-col gap-1 pb-1.5 border-b border-white/[0.06]">
                {onOpenInstrumentBrowser && (
                  <button
                    type="button"
                    onClick={() => onOpenInstrumentBrowser(selectedTrack?.id)}
                    className="w-full min-h-[36px] px-2.5 rounded bg-[#6D5DFB] hover:bg-[#7D6EFF] text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Library className="w-3.5 h-3.5" />
                    <span>Open Full Library</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => sf2SidebarInputRef.current?.click()}
                  className="w-full min-h-[34px] px-2.5 rounded bg-[#1E222E] hover:bg-[#282D3D] border border-white/[0.08] text-zinc-200 text-[11px] font-semibold flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3 h-3 text-[#8B5CF6]" />
                  <span>Import .sf2 ({soundBanks.length})</span>
                </button>
              </div>

              {filteredCatalog.map((entry) => {
                const isActive =
                  selectedTrack?.instrument.type === 'soundfont' &&
                  selectedTrack.instrument.params.instrumentId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={`p-2 rounded border flex items-center justify-between gap-1.5 transition-colors ${
                      isActive
                        ? 'bg-[#6D5DFB]/20 border-[#6D5DFB]'
                        : 'bg-[#1B1E24] border-white/[0.07] hover:border-white/20'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!selectedTrack || selectedTrack.isGroupFolder}
                      onClick={() => {
                        if (selectedTrack && !selectedTrack.isGroupFolder) {
                          onAssignTrackInstrument?.(selectedTrack.id, entry);
                        }
                      }}
                      className="min-w-0 flex-1 text-left disabled:opacity-50"
                    >
                      <div className="text-xs font-semibold text-zinc-100 truncate">
                        {entry.name}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {entry.category} · {entry.source === 'builtin' ? 'Built-in' : entry.soundBankName}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPreviewInstrumentPreset?.(entry)}
                      aria-label={`Preview ${entry.name}`}
                      className="w-8 h-8 rounded bg-[#252834] hover:bg-[#6D5DFB] text-zinc-200 hover:text-white flex items-center justify-center shrink-0"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {category !== 'Samples' &&
            category !== 'Projects' &&
            category !== 'Packs' &&
            category !== 'Instruments' &&
            filteredLibrary.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplyPreset(item)}
                className="w-full p-2 rounded border text-left flex flex-col gap-0.5 transition-colors bg-[#1B1E24] hover:bg-[#242830] border-white/[0.07]"
              >
                <div className="flex items-center justify-between gap-1 text-xs font-semibold text-zinc-100">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.category === 'Audio Effects' ? (
                      <Sliders className="w-3 h-3 text-sky-400 shrink-0" />
                    ) : item.category === 'MIDI Effects' ? (
                      <Piano className="w-3 h-3 text-amber-400 shrink-0" />
                    ) : item.category === 'Drums' ? (
                      <Disc className="w-3 h-3 text-amber-400 shrink-0" />
                    ) : (
                      <Music className="w-3 h-3 text-emerald-400 shrink-0" />
                    )}
                    <span className="truncate">{item.name}</span>
                  </div>
                  {item.subCategory && (
                    <span className="text-[9px] font-mono-tabular text-zinc-400 shrink-0">
                      {item.subCategory}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-400 leading-snug">
                  {item.description}
                </span>
              </button>
            ))}
        </div>
      </div>

      {/* Quick Instruments Switcher */}
      <div className="border-t border-white/[0.08] bg-[#13151C] p-2 flex flex-col gap-1 shrink-0">
        <div className="px-1 pb-0.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Quick Assign
          </span>
          <span className="text-[9px] font-mono-tabular text-zinc-500">
            {instrumentCatalog.length}
          </span>
        </div>
        {quickInstruments.map((qi) => {
          const preset = LIBRARY_ITEMS.find((i) => i.id === qi.presetId);
          return (
            <button
              key={qi.id}
              type="button"
              onClick={() => {
                if (preset) onApplyPreset(preset);
                setCategory('Instruments');
              }}
              className={`h-7 px-2 rounded text-xs font-semibold flex items-center justify-between gap-2 transition-colors ${
                qi.activeMatch
                  ? 'bg-[#6D5DFB]/25 border border-[#8B5CF6]/60 text-white'
                  : 'hover:bg-[#1D202A] border border-transparent text-zinc-300'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {qi.icon}
                <span className="truncate">{qi.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
