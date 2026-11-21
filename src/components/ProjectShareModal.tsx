import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Download,
  Upload,
  Copy,
  Check,
  FileJson,
  Music,
  Sliders,
  Layers,
  Radio,
  AlertCircle,
  FileDown,
  Sparkles,
} from 'lucide-react';
import { ProjectState, ProjectSummary, StoredAudioAsset } from '../types/daw';
import { parseAndValidateProjectJson, ParsedProjectResult } from '../storage/projectSerialization';

interface ProjectShareModalProps {
  isOpen: boolean;
  project: ProjectState;
  audioAssets: StoredAudioAsset[];
  savedProjects: ProjectSummary[];
  onClose: () => void;
  onExportJson: (includeAudio: boolean, pretty: boolean) => Promise<string>;
  onExportWav: () => void;
  onImportFile: (file: File, asNewProject: boolean) => Promise<ProjectState | null>;
  onImportString: (json: string, asNewProject: boolean) => Promise<ProjectState | null>;
}

export const ProjectShareModal: React.FC<ProjectShareModalProps> = ({
  isOpen,
  project,
  audioAssets,
  onClose,
  onExportJson,
  onExportWav,
  onImportFile,
  onImportString,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [prettyPrint, setPrettyPrint] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Import state
  const [pastedJson, setPastedJson] = useState('');
  const [importAsNew, setImportAsNew] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<ParsedProjectResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPastedJson('');
      setImportError(null);
      setParsedPreview(null);
      setCopied(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Stats calculation
  const trackCount = project.tracks.length;
  const midiClipCount = Object.keys(project.midiClips).length;
  const audioClipCount = Object.keys(project.audioClips).length;
  const sceneCount = project.scenes.length;

  const handleExportJsonClick = async () => {
    setIsExporting(true);
    try {
      await onExportJson(includeAudio, prettyPrint);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyJsonClick = async () => {
    setIsExporting(true);
    try {
      // Dynamic import or serialization
      const { buildProjectExportBundle } = await import('../storage/projectSerialization');
      const bundle = buildProjectExportBundle(project, audioAssets, includeAudio);
      const text = prettyPrint ? JSON.stringify(bundle, null, 2) : JSON.stringify(bundle);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setImportError('Failed to copy to clipboard.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    setImportError(null);
    setIsImporting(true);
    try {
      const text = await file.text();
      const result = parseAndValidateProjectJson(text);
      setParsedPreview(result);
    } catch (err) {
      setImportError((err as Error).message);
      setParsedPreview(null);
    } finally {
      setIsImporting(false);
    }
  };

  const handlePasteChange = (text: string) => {
    setPastedJson(text);
    setImportError(null);
    if (!text.trim()) {
      setParsedPreview(null);
      return;
    }
    try {
      const result = parseAndValidateProjectJson(text);
      setParsedPreview(result);
    } catch (err) {
      setImportError((err as Error).message);
      setParsedPreview(null);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedPreview) return;
    setIsImporting(true);
    try {
      const jsonStr = JSON.stringify(parsedPreview.project);
      const result = await onImportString(jsonStr, importAsNew);
      if (result) {
        onClose();
      }
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#14161E] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="h-14 px-5 bg-[#181B26] border-b border-white/[0.08] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#6D5DFB]/20 border border-[#6D5DFB]/40 flex items-center justify-center text-[#8B5CF6]">
              <FileJson className="w-4 h-4" />
            </div>
            <div>
              <h2 id="share-modal-title" className="text-sm font-bold text-white tracking-tight">
                Share & Transfer Composition
              </h2>
              <p className="text-[11px] text-zinc-400">
                PulseGrid JSON Project Exchange
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 p-1.5 bg-[#101218] border-b border-white/[0.06] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'export'
                ? 'bg-[#6D5DFB] text-white shadow-sm shadow-[#6D5DFB]/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Export Composition (JSON)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'import'
                ? 'bg-[#6D5DFB] text-white shadow-sm shadow-[#6D5DFB]/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Composition (JSON)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {activeTab === 'export' ? (
            <>
              {/* Project Overview Card */}
              <div className="p-3.5 rounded-lg bg-[#181B24] border border-white/[0.08] flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-400">Active Project</div>
                    <div className="text-base font-bold text-white">{project.name}</div>
                  </div>
                  <div className="px-2.5 py-1 rounded bg-[#6D5DFB]/15 border border-[#6D5DFB]/30 text-xs font-mono font-bold text-[#A78BFA]">
                    {project.bpm} BPM · {project.timeSignature[0]}/{project.timeSignature[1]}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 border-t border-white/[0.06] text-center">
                  <div className="p-2 rounded bg-[#101217]">
                    <div className="text-xs font-bold text-white">{trackCount}</div>
                    <div className="text-[10px] text-zinc-400">Tracks</div>
                  </div>
                  <div className="p-2 rounded bg-[#101217]">
                    <div className="text-xs font-bold text-white">{midiClipCount}</div>
                    <div className="text-[10px] text-zinc-400">MIDI Clips</div>
                  </div>
                  <div className="p-2 rounded bg-[#101217]">
                    <div className="text-xs font-bold text-white">{sceneCount}</div>
                    <div className="text-[10px] text-zinc-400">Scenes</div>
                  </div>
                  <div className="p-2 rounded bg-[#101217]">
                    <div className="text-xs font-bold text-white">{audioClipCount}</div>
                    <div className="text-[10px] text-zinc-400">Audio Clips</div>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="flex flex-col gap-2.5">
                <label className="flex items-center justify-between p-3 rounded-lg bg-[#181B24] border border-white/[0.06] cursor-pointer hover:border-white/20 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <Music className="w-4 h-4 text-[#8B5CF6]" />
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">Embed Audio Samples</div>
                      <div className="text-[10px] text-zinc-400">
                        Include base64 audio data so custom samples play on any machine
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#101217] border-white/20 text-[#6D5DFB] focus:ring-0 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-lg bg-[#181B24] border border-white/[0.06] cursor-pointer hover:border-white/20 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <FileJson className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">Formatted JSON</div>
                      <div className="text-[10px] text-zinc-400">
                        Indented formatting for easy reading and editing in text editors
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={prettyPrint}
                    onChange={(e) => setPrettyPrint(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#101217] border-white/20 text-[#6D5DFB] focus:ring-0 cursor-pointer"
                  />
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleExportJsonClick}
                  className="w-full sm:flex-1 h-10 px-4 rounded-lg bg-[#6D5DFB] hover:bg-[#5B4CE6] text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-[#6D5DFB]/20 transition-all disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .pulsegrid.json</span>
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={handleCopyJsonClick}
                  className="w-full sm:w-auto h-10 px-4 rounded-lg bg-[#222530] hover:bg-[#2C3040] border border-white/[0.08] text-zinc-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
                <span>Looking for audio mixdown?</span>
                <button
                  type="button"
                  onClick={() => {
                    onExportWav();
                    onClose();
                  }}
                  className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Render 16-bit WAV</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Import Tab */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.pulsegrid.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                }}
              />

              {/* Drag & Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) void handleFileSelected(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-[#6D5DFB] bg-[#6D5DFB]/10'
                    : 'border-white/[0.12] bg-[#161822] hover:border-white/30'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-[#6D5DFB]/15 border border-[#6D5DFB]/30 flex items-center justify-center text-[#8B5CF6]">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-xs font-semibold text-zinc-200 text-center">
                  Click to choose a .pulsegrid.json or .json file
                </div>
                <div className="text-[11px] text-zinc-400 text-center">
                  or drag and drop composition file anywhere here
                </div>
              </div>

              {/* Or Paste Raw JSON */}
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold text-zinc-400 flex items-center justify-between">
                  <span>Or paste JSON composition code:</span>
                  {pastedJson && (
                    <button
                      type="button"
                      onClick={() => handlePasteChange('')}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={pastedJson}
                  onChange={(e) => handlePasteChange(e.target.value)}
                  placeholder="Paste { &quot;app&quot;: &quot;PulseGrid&quot;, &quot;project&quot;: { ... } } here..."
                  className="w-full p-2.5 rounded-lg bg-[#101217] border border-white/[0.08] font-mono text-[11px] text-zinc-300 focus:outline-none focus:border-[#6D5DFB] resize-none"
                />
              </div>

              {/* Error Notice */}
              {importError && (
                <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-start gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Parsed Preview Card */}
              {parsedPreview && (
                <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-white">
                        Valid Composition Detected
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400">
                      {parsedPreview.project.bpm} BPM
                    </span>
                  </div>

                  <div className="text-sm font-bold text-zinc-100">
                    {parsedPreview.project.name}
                  </div>

                  <div className="text-[11px] text-zinc-300">
                    Includes {parsedPreview.project.tracks.length} tracks (
                    {parsedPreview.project.tracks.map((t) => t.name).join(', ')}) with{' '}
                    {Object.keys(parsedPreview.project.midiClips).length} MIDI clips
                    {parsedPreview.restoredAssets.length > 0 &&
                      ` and ${parsedPreview.restoredAssets.length} embedded audio samples`}
                    .
                  </div>

                  <label className="flex items-center gap-2 pt-1.5 border-t border-emerald-500/20 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importAsNew}
                      onChange={(e) => setImportAsNew(e.target.checked)}
                      className="rounded bg-[#101217] border-white/20 text-[#6D5DFB] focus:ring-0 cursor-pointer"
                    />
                    <span>Import as new project copy (keep current composition safe)</span>
                  </label>

                  <button
                    type="button"
                    disabled={isImporting}
                    onClick={handleConfirmImport}
                    className="h-10 mt-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>Load Composition into Studio</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
