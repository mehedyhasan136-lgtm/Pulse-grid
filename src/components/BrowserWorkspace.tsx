import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Play,
  Upload,
  Plus,
  Save,
  FolderPlus,
  FolderOpen,
  Trash2,
  Download,
  Share2,
} from 'lucide-react';
import { LIBRARY_ITEMS, LibraryPresetItem } from '../data/presets';
import {
  InstrumentCatalogEntry,
  ProjectSummary,
  SoundBankSummary,
  StoredAudioAsset,
  TrackModel,
} from '../types/daw';
import { DawStoreState } from '../audio/dawController';
import { InstrumentBrowser } from './InstrumentBrowser';

type BrowserCat =
  | 'Sounds'
  | 'Drums'
  | 'Instruments'
  | 'Audio Effects'
  | 'MIDI Effects'
  | 'Samples'
  | 'Packs'
  | 'Projects';

const CATEGORIES: BrowserCat[] = [
  'Instruments',
  'Sounds',
  'Drums',
  'Audio Effects',
  'MIDI Effects',
  'Samples',
  'Packs',
  'Projects',
];

interface BrowserWorkspaceProps {
  activeProjectId: string;
  activeProjectName: string;
  selectedTrackId: string;
  selectedTrackName: string;
  selectedTrack?: TrackModel | null;
  savedProjects: ProjectSummary[];
  audioAssets: StoredAudioAsset[];
  instrumentCatalog?: InstrumentCatalogEntry[];
  soundBanks?: SoundBankSummary[];
  favoriteInstrumentIds?: string[];
  recentInstrumentIds?: string[];
  instrumentLoading?: DawStoreState['instrumentLoading'];
  soundBankError?: string | null;
  isSoundBankInMemory?: (bankId: string) => boolean;
  memoryStats?: { bankCount: number; decodedZones: number; approxMb: number };
  onAssignTrackInstrument?: (trackId: string, entry: InstrumentCatalogEntry) => void;
  onPreviewInstrumentPreset?: (entry: InstrumentCatalogEntry) => void;
  onToggleFavoriteInstrument?: (instrumentId: string) => void;
  onImportSoundFontFile?: (file: File) => void;
  onUnloadSoundBank?: (bankId: string) => void;
  onDeleteSoundBank?: (bankId: string) => void;
  onClearSoundBankError?: () => void;
  onApplyPreset: (item: LibraryPresetItem) => void;
  onPreviewSound: (trackId: string, pitch: number) => void;
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

const PACK_CARDS: Array<{
  id: string;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  preset: LibraryPresetItem;
  previewPitch: number;
}> = [
  {
    id: 'pack-808',
    title: '808 Kit',
    subtitle: 'Drum Rack',
    description: 'Classic 808 drum kit with punchy synthesized sub kick, crisp hats, and snare.',
    accent: '#2E9BFF',
    preset: LIBRARY_ITEMS.find((i) => i.id === 'drm-909-kit')!,
    previewPitch: 36,
  },
  {
    id: 'pack-pad',
    title: 'Synth Pad',
    subtitle: 'Wavetable',
    description: 'Lush analog sawtooth pad with gentle attack and warm harmonic sweep.',
    accent: '#8B5CF6',
    preset: LIBRARY_ITEMS.find((i) => i.id === 'snd-warm-pad')!,
    previewPitch: 60,
  },
  {
    id: 'pack-bass',
    title: 'Bass Line',
    subtitle: 'Analog Bass',
    description: 'Resonant lowpass mono bass synth calibrated for club sub-bass grooves.',
    accent: '#22C55E',
    preset: LIBRARY_ITEMS.find((i) => i.id === 'snd-acid-303')!,
    previewPitch: 36,
  },
  {
    id: 'pack-pluck',
    title: 'Glass Pluck',
    subtitle: 'Operator FM',
    description: 'Sharp percussive triangle lead tailored for melodic hooks and arps.',
    accent: '#F97316',
    preset: LIBRARY_ITEMS.find((i) => i.id === 'snd-glass-pluck')!,
    previewPitch: 67,
  },
  {
    id: 'pack-piano',
    title: 'Studio Grand',
    subtitle: 'Acoustic Piano',
    description: 'Rich dual-layer acoustic grand piano with natural string resonance and felt hammer dynamics.',
    accent: '#A78BFA',
    preset: LIBRARY_ITEMS.find((i) => i.id === 'inst-piano-grand')!,
    previewPitch: 60,
  },
];

export const BrowserWorkspace: React.FC<BrowserWorkspaceProps> = ({
  activeProjectId,
  activeProjectName,
  selectedTrackId,
  selectedTrackName,
  selectedTrack = null,
  savedProjects,
  audioAssets,
  instrumentCatalog = [],
  soundBanks = [],
  favoriteInstrumentIds = [],
  recentInstrumentIds = [],
  instrumentLoading = null,
  soundBankError = null,
  isSoundBankInMemory = () => false,
  memoryStats,
  onAssignTrackInstrument,
  onPreviewInstrumentPreset,
  onToggleFavoriteInstrument,
  onImportSoundFontFile,
  onUnloadSoundBank,
  onDeleteSoundBank,
  onClearSoundBankError,
  onApplyPreset,
  onPreviewSound,
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
  const [category, setCategory] = useState<BrowserCat>('Instruments');
  const [query, setQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<
    | { kind: 'pack'; item: (typeof PACK_CARDS)[number] }
    | { kind: 'lib'; item: LibraryPresetItem }
    | { kind: 'asset'; item: StoredAudioAsset }
  >({ kind: 'pack', item: PACK_CARDS[0] });
  const [projectNameInput, setProjectNameInput] = useState(activeProjectName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectJsonInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setProjectNameInput(activeProjectName);
  }, [activeProjectName]);

  useEffect(() => {
    if (
      selectedCard.kind === 'asset' &&
      !audioAssets.some((a) => a.id === selectedCard.item.id)
    ) {
      setSelectedCard({ kind: 'pack', item: PACK_CARDS[0] });
    }
  }, [audioAssets, selectedCard]);

  const filteredLib = LIBRARY_ITEMS.filter((i) => {
    if (i.category !== category) return false;
    return (
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      i.description.toLowerCase().includes(query.toLowerCase())
    );
  });

  return (
    <div className="flex-1 min-h-0 flex bg-[#101218] select-none overflow-hidden">
      {/* Left Category Rail */}
      <nav className="w-36 sm:w-44 shrink-0 bg-[#15171F] border-r border-white/[0.08] flex flex-col">
        <div className="px-3 py-2 border-b border-white/[0.08] text-xs font-bold text-zinc-200">
          Browser
        </div>
        <div className="p-1.5 flex flex-col gap-0.5 overflow-y-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-2.5 py-2 rounded text-left text-xs font-semibold transition-colors ${
                category === cat
                  ? 'bg-[#6D5DFB] text-white'
                  : 'text-zinc-300 hover:bg-[#1E222D]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </nav>

      {category === 'Instruments' ? (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <InstrumentBrowser
            catalog={instrumentCatalog}
            soundBanks={soundBanks}
            selectedTrack={selectedTrack}
            favoriteIds={favoriteInstrumentIds}
            recentIds={recentInstrumentIds}
            instrumentLoading={instrumentLoading}
            soundBankError={soundBankError}
            onPreviewPreset={(entry) => onPreviewInstrumentPreset?.(entry)}
            onAssignPreset={(tid, entry) => onAssignTrackInstrument?.(tid, entry)}
            onToggleFavorite={(id) => onToggleFavoriteInstrument?.(id)}
            onImportSoundFontFile={(file) => onImportSoundFontFile?.(file)}
            onUnloadSoundBank={(bankId) => onUnloadSoundBank?.(bankId)}
            onDeleteSoundBank={(bankId) => onDeleteSoundBank?.(bankId)}
            onClearError={() => onClearSoundBankError?.()}
            isSoundBankInMemory={isSoundBankInMemory}
            memoryStats={memoryStats}
          />
        </div>
      ) : (
      <>
      {/* Center Cards / Presets Grid */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-white/[0.08] bg-[#14161D] flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search presets, packs, samples..."
              className="w-full h-8 pl-8 pr-3 bg-[#101217] border border-white/[0.08] rounded text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#6D5DFB]"
            />
          </div>
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
                className="h-8 px-3 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Audio</span>
              </button>
            </>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {category === 'Packs' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {PACK_CARDS.filter((p) =>
                p.title.toLowerCase().includes(query.toLowerCase())
              ).map((card) => {
                const isSel = selectedCard.kind === 'pack' && selectedCard.item.id === card.id;
                return (
                  <div
                    key={card.id}
                    onClick={() => setSelectedCard({ kind: 'pack', item: card })}
                    className={`rounded border bg-[#161922] overflow-hidden cursor-pointer transition-colors ${
                      isSel ? 'border-[#6D5DFB] ring-1 ring-[#6D5DFB]/60' : 'border-white/[0.08] hover:border-white/25'
                    }`}
                  >
                    {/* Crisp SVG Synth/Pad Art */}
                    <div className="h-28 bg-[#0C0E13] p-3 flex items-center justify-center relative border-b border-white/[0.06]">
                      <svg viewBox="0 0 160 72" className="w-full h-full">
                        {card.id === 'pack-808' ? (
                          Array.from({ length: 16 }, (_, idx) => {
                            const col = idx % 4;
                            const row = Math.floor(idx / 4);
                            return (
                              <rect
                                key={idx}
                                x={26 + col * 28}
                                y={8 + row * 15}
                                width={22}
                                height={11}
                                rx={2}
                                fill={idx % 3 === 0 ? card.accent : '#252936'}
                              />
                            );
                          })
                        ) : (
                          <path
                            d="M 8 44 Q 32 10, 56 38 T 104 34 T 152 36"
                            fill="none"
                            stroke={card.accent}
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        )}
                      </svg>
                    </div>

                    <div className="p-2.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-white">{card.title}</div>
                        <div className="text-[10px] text-zinc-400">{card.subtitle}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApplyPreset(card.preset);
                          onPreviewSound(selectedTrackId, card.previewPitch);
                        }}
                        aria-label={`Audition ${card.title}`}
                        className="w-7 h-7 rounded bg-[#222632] hover:bg-[#6D5DFB] text-white flex items-center justify-center transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {category === 'Samples' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {audioAssets.length === 0 ? (
                <div className="col-span-full rounded border border-dashed border-white/[0.1] p-6 text-center text-xs text-zinc-400">
                  No imported samples yet. Click Import Audio above to add WAV/MP3/OGG files.
                </div>
              ) : (
                audioAssets
                  .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
                  .map((asset) => (
                    <div
                      key={asset.id}
                      onClick={() => setSelectedCard({ kind: 'asset', item: asset })}
                      className="rounded border border-white/[0.08] bg-[#161922] p-2.5 flex flex-col gap-2 cursor-pointer hover:border-white/25"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-zinc-100 truncate">
                          {asset.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSample(asset.id);
                          }}
                          className="text-zinc-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <svg viewBox="0 0 64 20" preserveAspectRatio="none" className="w-full h-6 bg-[#0C0E13] rounded-xs">
                        {asset.peaks.map((pk, idx) => {
                          const h = Math.max(2, pk * 18);
                          return (
                            <rect
                              key={idx}
                              x={idx}
                              y={(20 - h) / 2}
                              width={0.75}
                              height={h}
                              fill="#22C55E"
                            />
                          );
                        })}
                      </svg>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onLoadSampleToSampler(asset);
                          }}
                          className="py-1 rounded bg-[#222632] hover:bg-[#2C3140] text-[10px] font-semibold text-zinc-200"
                        >
                          Load Sampler
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddSampleToArrangement(asset);
                          }}
                          className="py-1 rounded bg-[#222632] hover:bg-[#2C3140] text-[10px] font-semibold text-zinc-200"
                        >
                          + Arrangement
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}

          {category === 'Projects' && (
            <div className="flex flex-col gap-3 max-w-xl">
              <input
                ref={projectJsonInputRef}
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

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    onBlur={() => onRenameProject(projectNameInput)}
                    placeholder="Project name"
                    className="flex-1 h-8 px-2.5 rounded bg-[#101217] border border-white/[0.08] text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={onSaveProject}
                    className="h-8 px-3 rounded bg-[#6D5DFB] text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="h-8 px-3 rounded bg-[#222632] text-zinc-200 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>New</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onExportProjectJson?.(activeProjectId)}
                    className="h-8 px-2.5 rounded bg-[#1C1F2B] hover:bg-[#252A3B] border border-white/[0.08] text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Export Active JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => projectJsonInputRef.current?.click()}
                    className="h-8 px-2.5 rounded bg-[#1C1F2B] hover:bg-[#252A3B] border border-white/[0.08] text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#8B5CF6]" />
                    <span>Import JSON Project</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                {savedProjects.map((proj) => {
                  const isCurrent = proj.id === activeProjectId;
                  return (
                    <div
                      key={proj.id}
                      className={`p-2.5 rounded border flex items-center justify-between ${
                        isCurrent
                          ? 'bg-[#6D5DFB]/15 border-[#6D5DFB]'
                          : 'bg-[#161922] border-white/[0.08]'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold text-zinc-100">{proj.name}</div>
                        <div className="text-[10px] font-mono-tabular text-zinc-400">
                          {proj.bpm} BPM · {proj.trackCount} tracks
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onExportProjectJson?.(proj.id)}
                          title={`Export "${proj.name}" to JSON`}
                          className="h-7 w-7 rounded bg-[#222632] hover:bg-[#2F3445] text-zinc-300 hover:text-white flex items-center justify-center transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {isCurrent ? (
                          <span className="text-[11px] font-semibold text-emerald-400 px-2">Active</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onLoadProject(proj.id)}
                              className="h-7 px-2.5 rounded bg-[#222632] text-xs font-semibold text-zinc-200 flex items-center gap-1"
                            >
                              <FolderOpen className="w-3 h-3" />
                              <span>Load</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteProject(proj.id)}
                              className="h-7 w-7 rounded bg-[#222632] text-zinc-400 hover:text-rose-400 flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {category !== 'Packs' && category !== 'Samples' && category !== 'Projects' && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {filteredLib.map((item) => {
                  const isSel = selectedCard.kind === 'lib' && selectedCard.item.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedCard({ kind: 'lib', item })}
                      onDoubleClick={() => {
                        onApplyPreset(item);
                      }}
                      className={`p-3 rounded border text-left transition-colors ${
                        isSel
                          ? 'bg-[#1D202C] border-[#6D5DFB]'
                          : 'bg-[#161922] border-white/[0.08] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-100">{item.name}</span>
                        {item.subCategory && (
                          <span className="text-[10px] text-zinc-400">{item.subCategory}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{item.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Details Inspector matching Screen 6 */}
      <div className="hidden lg:flex w-64 shrink-0 bg-[#15171F] border-l border-white/[0.08] p-3 flex-col justify-between">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-bold text-white">
            {selectedCard.kind === 'pack'
              ? selectedCard.item.title
              : selectedCard.item.name}
          </div>
          <div className="text-xs font-semibold text-[#8B5CF6]">
            {selectedCard.kind === 'pack'
              ? selectedCard.item.subtitle
              : selectedCard.kind === 'lib'
                ? selectedCard.item.category
                : 'Audio Sample'}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed pt-1">
            {selectedCard.kind === 'pack'
              ? selectedCard.item.description
              : selectedCard.kind === 'lib'
                ? selectedCard.item.description
                : `${selectedCard.item.durationSeconds.toFixed(2)}s audio file stored in local IndexedDB.`}
          </p>
          <div className="text-[11px] text-zinc-500 pt-2">
            Target Track: <span className="text-zinc-200 font-semibold">{selectedTrackName}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (selectedCard.kind === 'pack') {
              onApplyPreset(selectedCard.item.preset);
            } else if (selectedCard.kind === 'lib') {
              onApplyPreset(selectedCard.item);
            } else {
              onLoadSampleToSampler(selectedCard.item);
            }
          }}
          className="h-9 w-full rounded bg-[#6D5DFB] hover:bg-[#5B4CE6] text-white text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add to Project</span>
        </button>
      </div>
      </>
      )}
    </div>
  );
};
