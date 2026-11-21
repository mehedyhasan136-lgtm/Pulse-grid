/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { X, Sliders, Piano, ArrowLeft } from 'lucide-react';
import { MobileScreen, ViewMode } from './types/daw';
import { DawStoreState, dawController } from './audio/dawController';
import { TopToolbar } from './components/TopToolbar';
import { BrowserSidebar } from './components/BrowserSidebar';
import { BrowserWorkspace } from './components/BrowserWorkspace';
import { SessionView } from './components/SessionView';
import { ArrangementView } from './components/ArrangementView';
import { MixerView } from './components/MixerView';
import { PianoRoll } from './components/PianoRoll';
import { DeviceRack } from './components/DeviceRack';
import { ProjectShareModal } from './components/ProjectShareModal';
import { InstrumentBrowser } from './components/InstrumentBrowser';

export default function App() {
  const [daw, setDaw] = useState<DawStoreState>(() => dawController.getState());
  const [viewMode, setViewMode] = useState<ViewMode>('session');
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>('session');
  const [browserOpen, setBrowserOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [bottomDockMode, setBottomDockMode] = useState<'pianoroll' | 'device' | 'closed'>('closed');
  const [mobileMidiSubTab, setMobileMidiSubTab] = useState<'pianoroll' | 'device'>('pianoroll');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [pendingGroupName, setPendingGroupName] = useState('');
  const [instrumentPickerTrackId, setInstrumentPickerTrackId] = useState<string | null>(null);

  useEffect(() => {
    if (daw.pendingRenameGroupId) {
      const grp = daw.project.tracks.find((t) => t.id === daw.pendingRenameGroupId);
      setPendingGroupName(grp?.name ?? 'Group 1');
    }
  }, [daw.pendingRenameGroupId, daw.project.tracks]);

  useEffect(() => {
    const unsubscribe = dawController.subscribe(setDaw);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          dawController.redo();
        } else {
          dawController.undo();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dawController.redo();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (daw.isPlaying) {
          void dawController.stop();
        } else {
          void dawController.play();
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        setViewMode((prev) => {
          const next = prev === 'session' ? 'arrangement' : 'session';
          dawController.setPlaybackMode(next);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [daw.isPlaying]);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };

    const handleDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.sf2')) {
        e.preventDefault();
        e.stopPropagation();
        void dawController.importSoundFontFile(file);
        return;
      }
      if (file.name.endsWith('.json') || file.type === 'application/json') {
        e.preventDefault();
        e.stopPropagation();
        void dawController.importProjectFromJsonFile(file);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  const { project } = daw;
  const selectedTrack =
    project.tracks.find((t) => t.id === daw.selectedTrackId) ?? project.tracks[0] ?? null;
  const editingMidiClip =
    daw.editingMidiClipId ? project.midiClips[daw.editingMidiClipId] ?? null : null;
  const instrumentCatalog = dawController.getInstrumentCatalog();
  const memoryStats = dawController.getSoundFontMemoryStats();
  const instrumentPickerTrack =
    instrumentPickerTrackId
      ? project.tracks.find((t) => t.id === instrumentPickerTrackId) ?? selectedTrack
      : null;

  const openInstrumentPicker = (trackId?: string) => {
    const resolvedId = trackId ?? selectedTrack?.id ?? null;
    if (!resolvedId) return;
    dawController.selectTrack(resolvedId);
    setInstrumentPickerTrackId(resolvedId);
  };

  const handleSelectViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'session' || mode === 'arrangement') {
      dawController.setPlaybackMode(mode);
    }
  };

  const handleSelectMobileScreen = (screen: MobileScreen) => {
    setMobileScreen(screen);
    if (screen === 'session' || screen === 'arrangement') {
      dawController.setPlaybackMode(screen);
    }
  };

  const handleOpenMidiEditor = (clipId: string, trackId: string) => {
    dawController.openMidiClipEditor(clipId, trackId);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileMidiSubTab('pianoroll');
      setMobileScreen('pianoroll');
    } else {
      setViewMode('pianoroll');
    }
  };

  const handleToggleBottomDock = (mode: 'pianoroll' | 'device') => {
    setBottomDockMode((prev) => (prev === mode ? 'closed' : mode));
  };

  const showSidebarInDesktop =
    browserOpen &&
    viewMode !== 'browser' &&
    viewMode !== 'pianoroll' &&
    viewMode !== 'devices';

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#101218] text-zinc-100 flex flex-col">
      <TopToolbar
        projectName={project.name}
        viewMode={viewMode}
        mobileScreen={mobileScreen}
        browserOpen={browserOpen}
        bottomDockMode={bottomDockMode}
        isPlaying={daw.isPlaying}
        isRecording={daw.isRecording}
        bpm={project.bpm}
        timeSignature={project.timeSignature}
        metronomeEnabled={project.metronomeEnabled}
        loopEnabled={project.loopEnabled}
        quantize={project.quantize}
        swingPercent={project.swingPercent ?? 0}
        currentBeat={daw.currentBeat}
        canUndo={daw.canUndo}
        canRedo={daw.canRedo}
        audioStatus={daw.audioStatus}
        onSelectViewMode={handleSelectViewMode}
        onSelectMobileScreen={handleSelectMobileScreen}
        onToggleBrowser={() => setBrowserOpen((o) => !o)}
        onToggleBottomDock={handleToggleBottomDock}
        onPlay={() => void dawController.play()}
        onStop={() => void dawController.stop()}
        onToggleRecord={() => void dawController.toggleRecord()}
        onBpmChange={(bpm) => dawController.setBpm(bpm)}
        onTimeSigChange={(n, d) => dawController.setTimeSignature(n, d)}
        onToggleMetronome={() => dawController.toggleMetronome()}
        onToggleLoop={() => dawController.toggleLoop()}
        onQuantizeChange={(q) => dawController.setQuantize(q)}
        onSwingChange={(s) => dawController.setSwingPercent(s)}
        onUndo={() => dawController.undo()}
        onRedo={() => dawController.redo()}
        onExportWav={() => void dawController.exportProjectWav()}
        onOpenShareModal={() => setIsShareModalOpen(true)}
        onImportJsonFile={(file) => void dawController.importProjectFromJsonFile(file)}
        onExportJson={() => void dawController.exportProjectJson()}
      />

      {/* Main Studio Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden pb-[92px] md:pb-0 relative">
        {/* Mobile Slide-Over Browser OR Desktop Collapsible Sidebar */}
        <div className={showSidebarInDesktop ? 'flex' : browserOpen ? 'flex md:hidden' : 'hidden'}>
          <BrowserSidebar
            open={browserOpen}
            activeProjectId={project.id}
            activeProjectName={project.name}
            selectedTrackName={selectedTrack?.name ?? 'Track'}
            selectedTrack={selectedTrack}
            selectedInstrumentType={selectedTrack?.instrument.type}
            savedProjects={daw.savedProjects}
            audioAssets={daw.audioAssets}
            instrumentCatalog={instrumentCatalog}
            soundBanks={daw.soundBanks}
            onClose={() => setBrowserOpen(false)}
            onAssignTrackInstrument={(tid, entry) =>
              void dawController.assignTrackInstrument(tid, entry)
            }
            onPreviewInstrumentPreset={(entry) =>
              void dawController.previewInstrumentPreset(entry)
            }
            onImportSoundFontFile={(file) => void dawController.importSoundFontFile(file)}
            onOpenInstrumentBrowser={(tid) => openInstrumentPicker(tid)}
            onApplyPreset={(item) => dawController.applyLibraryPreset(item)}
            onImportAudioFiles={(files) => {
              Array.from(files).forEach((f) => {
                void dawController.importAudioFile(f);
              });
            }}
            onLoadSampleToSampler={(asset) => dawController.loadSampleIntoTrackSampler(asset)}
            onAddSampleToArrangement={(asset) =>
              void dawController.assignAudioAssetToTarget(
                asset,
                selectedTrack?.id ?? project.tracks[0]?.id ?? 'drums',
                undefined,
                daw.currentBeat
              )
            }
            onDeleteSample={(id) => void dawController.deleteStoredAudioAsset(id)}
            onCreateProject={() => void dawController.createNewProject()}
            onSaveProject={() => void dawController.saveCurrentProject()}
            onLoadProject={(id) => void dawController.loadProject(id)}
            onDeleteProject={(id) => void dawController.deleteSavedProject(id)}
            onRenameProject={(name) => dawController.renameProject(name)}
            onExportProjectJson={(id) => void dawController.exportProjectJson(id)}
            onImportProjectJsonFile={(file) => void dawController.importProjectFromJsonFile(file)}
          />
        </div>

        {/* Desktop 6-Screen Workspaces */}
        <div className="hidden md:flex flex-1 min-w-0 min-h-0 flex-col">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {viewMode === 'session' && (
              <SessionView
                project={project}
                selectedTrackId={daw.selectedTrackId}
                selectedTrackIds={daw.selectedTrackIds}
                isPlaying={daw.isPlaying}
                currentBeat={daw.currentBeat}
                quantProgress={daw.quantProgress}
                sessionRuntimes={daw.sessionRuntimes}
                onSelectTrack={(id, mode, orderedIds) =>
                  dawController.selectTrack(id, mode, orderedIds)
                }
                onTriggerClip={(tid, cid) => void dawController.triggerSessionClip(tid, cid)}
                onTriggerScene={(idx) => void dawController.triggerScene(idx)}
                onStopTrack={(tid) => dawController.stopTrackSession(tid)}
                onClearAll={() => dawController.clearAllSessionClips()}
                onCreateMidiClip={(tid, idx) => dawController.createSessionMidiClip(tid, idx)}
                onDeleteClip={(tid, idx) => dawController.deleteSessionClip(tid, idx)}
                onEditMidiClip={handleOpenMidiEditor}
                onSendToArrangement={(tid, cid) => {
                  dawController.addSessionClipToArrangement(tid, cid, daw.currentBeat);
                }}
                onAddTrack={(type) => dawController.addTrack(type)}
                onDeleteTrack={(id) => dawController.deleteTrack(id)}
                onRenameTrack={(id, name) => dawController.renameTrack(id, name)}
                onAddScene={() => dawController.addScene()}
                onSetTrackVolume={(id, db) => dawController.setTrackVolume(id, db)}
                onSetTrackPan={(id, pan) => dawController.setTrackPan(id, pan)}
                onToggleMute={(id) => dawController.toggleTrackMute(id)}
                onToggleSolo={(id) => dawController.toggleTrackSolo(id)}
                onToggleArm={(id) => dawController.toggleTrackArm(id)}
                onDropFilesToSlot={(files, tid, idx) => {
                  const file = files[0];
                  if (file) void dawController.importAudioFile(file, { trackId: tid, sceneIndex: idx });
                }}
                onDropAssetToSlot={(assetId, tid, idx) => {
                  const asset = daw.audioAssets.find((a) => a.id === assetId);
                  if (asset) void dawController.assignAudioAssetToTarget(asset, tid, idx);
                }}
                onOpenInstrumentPicker={(tid) => openInstrumentPicker(tid)}
                onDropFilesNewTrack={(files) => {
                  const file = files[0];
                  if (file) {
                    dawController.addTrack('audio', file.name.replace(/\.[^/.]+$/, ''));
                    const newTrackId = dawController.getState().selectedTrackId;
                    void dawController.importAudioFile(file, { trackId: newTrackId, sceneIndex: 0 });
                  }
                }}
              />
            )}

            {viewMode === 'arrangement' && (
              <ArrangementView
                project={project}
                selectedTrackId={daw.selectedTrackId}
                selectedTrackIds={daw.selectedTrackIds}
                isPlaying={daw.isPlaying}
                playbackMode={daw.playbackMode}
                currentBeat={daw.currentBeat}
                onPlayArrangement={() => void dawController.play('arrangement')}
                onSeekBeat={(b) => dawController.seekToBeat(b)}
                onSelectTrack={(id, mode, orderedIds) =>
                  dawController.selectTrack(id, mode, orderedIds)
                }
                onMoveClip={(cid, b, tid) => dawController.moveArrangementClip(cid, b, tid)}
                onMoveClips={(cids, delta, tid, sid, ordered) =>
                  dawController.moveArrangementClips(cids, delta, tid, sid, ordered)
                }
                onResizeClip={(cid, len) => dawController.resizeArrangementClip(cid, len)}
                onDuplicateClip={(cid) => dawController.duplicateArrangementClip(cid)}
                onDuplicateClips={(cids) => dawController.duplicateArrangementClips(cids)}
                onSplitClip={(cid, b) => dawController.splitArrangementClipAtBeat(cid, b)}
                onDeleteClip={(cid) => dawController.deleteArrangementClip(cid)}
                onDeleteClips={(cids) => dawController.deleteArrangementClips(cids)}
                onCopyClip={(cid) => dawController.copyArrangementClip(cid)}
                onCutClip={(cid) => dawController.cutArrangementClip(cid)}
                onPasteClip={(tid, b) => dawController.pasteArrangementClip(tid, b)}
                onSetClipColor={(sid, col, cid) => dawController.setClipColor(sid, col, cid)}
                onEditMidiClip={handleOpenMidiEditor}
                onSetLoopRegion={(s, e, rec) => dawController.setLoopRegion(s, e, rec)}
                onSetLoopSnap={(snap) => dawController.setLoopSnap(snap)}
                onToggleLoop={() => dawController.toggleLoop()}
                onToggleAutomation={(tid) => dawController.toggleTrackAutomationView(tid)}
                onSetAutomationTarget={(tid, target) =>
                  dawController.setTrackAutomationTarget(tid, target)
                }
                onToggleAutomationEnabled={(tid, target) =>
                  dawController.toggleAutomationLaneEnabled(tid, target)
                }
                onUpsertAutomationPoint={(tid, target, b, v) =>
                  dawController.upsertAutomationPoint(tid, target, b, v)
                }
                onSetTrackVolume={(id, db) => dawController.setTrackVolume(id, db)}
                onSetTrackPan={(id, pan) => dawController.setTrackPan(id, pan)}
                onToggleArm={(tid) => dawController.toggleTrackArm(tid)}
                onToggleMute={(tid) => dawController.toggleTrackMute(tid)}
                onToggleSolo={(tid) => dawController.toggleTrackSolo(tid)}
                onAddTrack={(type, name, groupId) => dawController.addTrack(type, name, groupId)}
                onAddTrackGroup={(name) => dawController.addTrackGroup(name, undefined, true)}
                onToggleGroupCollapse={(id) => dawController.toggleTrackGroupCollapse(id)}
                onSetTrackGroupId={(id, gid) => dawController.setTrackGroupId(id, gid)}
                onDropFilesToTimeline={(files, tid, beat) => {
                  const file = files[0];
                  if (file) void dawController.importAudioFile(file, { trackId: tid, startBeat: beat });
                }}
                onOpenInstrumentPicker={(tid) => openInstrumentPicker(tid)}
                onDropAssetToTimeline={(assetId, tid, beat) => {
                  const asset = daw.audioAssets.find((a) => a.id === assetId);
                  if (asset) void dawController.assignAudioAssetToTarget(asset, tid, undefined, beat);
                }}
              />
            )}

            {viewMode === 'pianoroll' && (
              <PianoRoll
                clip={editingMidiClip}
                track={selectedTrack}
                allMidiClips={Object.values(project.midiClips)}
                currentBeat={daw.currentBeat}
                isPlaying={daw.isPlaying}
                playbackMode={daw.playbackMode}
                bpm={project.bpm}
                timeSignature={project.timeSignature}
                loopEnabled={project.loopEnabled}
                loopStartBeat={project.loopStartBeat}
                loopEndBeat={project.loopEndBeat}
                arrangementClips={project.arrangementClips}
                sessionRuntime={selectedTrack ? (daw.sessionRuntimes[selectedTrack.id] ?? null) : null}
                onSeekBeat={(b) => dawController.seekToBeat(b)}
                onSelectClip={(cid) => {
                  const owner = project.tracks.find((t) => t.sessionSlots.includes(cid));
                  dawController.openMidiClipEditor(cid, owner?.id);
                }}
                onAddNote={(cid, n) => dawController.addMidiNote(cid, n)}
                onUpdateNote={(cid, nid, p) => dawController.updateMidiNote(cid, nid, p)}
                onDeleteNote={(cid, nid) => dawController.deleteMidiNote(cid, nid)}
                onQuantizeClip={(cid, g) => dawController.quantizeMidiClip(cid, g)}
                onSetClipLength={(cid, len) => dawController.setMidiClipLength(cid, len)}
                onAuditionNote={(tid, pitch, vel) =>
                  void dawController.auditionMidiNote(tid, pitch, vel)
                }
              />
            )}

            {viewMode === 'mixer' && (
              <MixerView
                project={project}
                selectedTrackId={daw.selectedTrackId}
                selectedTrackIds={daw.selectedTrackIds}
                onSelectTrack={(id, mode, orderedIds) =>
                  dawController.selectTrack(id, mode, orderedIds)
                }
                onSetTrackVolume={(id, db) => dawController.setTrackVolume(id, db)}
                onSetTrackPan={(id, pan) => dawController.setTrackPan(id, pan)}
                onSetTrackSend={(id, st, amt) => dawController.setTrackSend(id, st, amt)}
                onToggleMute={(id) => dawController.toggleTrackMute(id)}
                onToggleSolo={(id) => dawController.toggleTrackSolo(id)}
                onToggleArm={(id) => dawController.toggleTrackArm(id)}
                onAddEffect={(tid, type) => dawController.addTrackEffect(tid, type)}
                onUpdateEffect={(tid, fid, patch) =>
                  dawController.updateTrackEffect(tid, fid, patch)
                }
                onRemoveEffect={(tid, fid) => dawController.removeTrackEffect(tid, fid)}
                onApplyMidiPreset={(item) => dawController.applyLibraryPreset(item)}
                onSetMasterVolume={(db) => dawController.setMasterVolume(db)}
              />
            )}

            {viewMode === 'devices' && (
              <DeviceRack
                track={selectedTrack}
                allTracks={project.tracks}
                onSelectTrack={(id) => dawController.selectTrack(id)}
                audioAssets={daw.audioAssets}
                soundBanks={daw.soundBanks}
                instrumentCatalog={instrumentCatalog}
                onSetInstrumentType={(tid, type) =>
                  dawController.setTrackInstrumentType(tid, type)
                }
                onUpdateInstrumentParams={(tid, patch) =>
                  dawController.updateTrackInstrumentParams(tid, patch)
                }
                onAssignInstrument={(tid, entry) =>
                  void dawController.assignTrackInstrument(tid, entry)
                }
                onSetTrackProgram={(tid, bank, prog) =>
                  void dawController.setTrackProgram(tid, bank, prog)
                }
                onSetTrackPan={(tid, pan) => dawController.setTrackPan(tid, pan)}
                onSetTrackSend={(tid, st, amt) => dawController.setTrackSend(tid, st, amt)}
                onSetTrackSustain={(tid, active) => dawController.setTrackSustain(tid, active)}
                onSetTrackPitchBend={(tid, st) => dawController.setTrackPitchBend(tid, st)}
                onOpenInstrumentBrowser={(tid) => openInstrumentPicker(tid)}
                onAddEffect={(tid, type) => dawController.addTrackEffect(tid, type)}
                onUpdateEffect={(tid, fid, patch) =>
                  dawController.updateTrackEffect(tid, fid, patch)
                }
                onRemoveEffect={(tid, fid) => dawController.removeTrackEffect(tid, fid)}
                onMoveEffect={(tid, fid, delta) =>
                  dawController.moveTrackEffect(tid, fid, delta)
                }
                onAuditionTrack={(tid, pitch) => void dawController.auditionMidiNote(tid, pitch)}
              />
            )}

            {viewMode === 'browser' && (
              <BrowserWorkspace
                activeProjectId={project.id}
                activeProjectName={project.name}
                selectedTrackId={selectedTrack?.id ?? 'drums'}
                selectedTrackName={selectedTrack?.name ?? 'Drums'}
                selectedTrack={selectedTrack}
                savedProjects={daw.savedProjects}
                audioAssets={daw.audioAssets}
                instrumentCatalog={instrumentCatalog}
                soundBanks={daw.soundBanks}
                favoriteInstrumentIds={daw.favoriteInstrumentIds}
                recentInstrumentIds={daw.recentInstrumentIds}
                instrumentLoading={daw.instrumentLoading}
                soundBankError={daw.soundBankError}
                isSoundBankInMemory={(bankId) => dawController.isSoundBankInMemory(bankId)}
                memoryStats={memoryStats}
                onAssignTrackInstrument={(tid, entry) =>
                  void dawController.assignTrackInstrument(tid, entry)
                }
                onPreviewInstrumentPreset={(entry) =>
                  void dawController.previewInstrumentPreset(entry)
                }
                onToggleFavoriteInstrument={(id) => dawController.toggleFavoriteInstrument(id)}
                onImportSoundFontFile={(file) => void dawController.importSoundFontFile(file)}
                onUnloadSoundBank={(bankId) => dawController.unloadSoundBankFromRam(bankId)}
                onDeleteSoundBank={(bankId) => void dawController.deleteSoundBank(bankId)}
                onClearSoundBankError={() => dawController.clearSoundBankError()}
                onApplyPreset={(item) => dawController.applyLibraryPreset(item)}
                onPreviewSound={(tid, pitch) => void dawController.auditionMidiNote(tid, pitch)}
                onImportAudioFiles={(files) => {
                  Array.from(files).forEach((f) => {
                    void dawController.importAudioFile(f);
                  });
                }}
                onLoadSampleToSampler={(asset) => dawController.loadSampleIntoTrackSampler(asset)}
                onAddSampleToArrangement={(asset) =>
                  void dawController.assignAudioAssetToTarget(
                    asset,
                    selectedTrack?.id ?? project.tracks[0]?.id ?? 'drums',
                    undefined,
                    daw.currentBeat
                  )
                }
                onDeleteSample={(id) => void dawController.deleteStoredAudioAsset(id)}
                onCreateProject={() => void dawController.createNewProject()}
                onSaveProject={() => void dawController.saveCurrentProject()}
                onLoadProject={(id) => void dawController.loadProject(id)}
                onDeleteProject={(id) => void dawController.deleteSavedProject(id)}
                onRenameProject={(name) => dawController.renameProject(name)}
                onExportProjectJson={(id) => void dawController.exportProjectJson(id)}
                onImportProjectJsonFile={(file) => void dawController.importProjectFromJsonFile(file)}
              />
            )}
          </div>

          {/* Optional Quick Bottom Dock on Session / Arrangement */}
          {(viewMode === 'session' || viewMode === 'arrangement') && bottomDockMode !== 'closed' && (
            <div className="h-64 lg:h-72 shrink-0 border-t border-white/[0.1] flex flex-col bg-[#121418]">
              <div className="h-7 px-2 bg-[#181A22] border-b border-white/[0.08] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setBottomDockMode('pianoroll')}
                    className={`h-5 px-2 rounded text-[11px] font-semibold flex items-center gap-1 ${
                      bottomDockMode === 'pianoroll'
                        ? 'bg-[#6D5DFB] text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Piano className="w-3 h-3" />
                    <span>MIDI Piano Roll</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBottomDockMode('device')}
                    className={`h-5 px-2 rounded text-[11px] font-semibold flex items-center gap-1 ${
                      bottomDockMode === 'device'
                        ? 'bg-[#6D5DFB] text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Sliders className="w-3 h-3" />
                    <span>Devices & Effects</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setBottomDockMode('closed')}
                  aria-label="Close bottom panel"
                  className="text-zinc-400 hover:text-white p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 min-h-0">
                {bottomDockMode === 'pianoroll' ? (
                  <PianoRoll
                    clip={editingMidiClip}
                    track={selectedTrack}
                    allMidiClips={Object.values(project.midiClips)}
                    currentBeat={daw.currentBeat}
                    isPlaying={daw.isPlaying}
                    playbackMode={daw.playbackMode}
                    bpm={project.bpm}
                    timeSignature={project.timeSignature}
                    loopEnabled={project.loopEnabled}
                    loopStartBeat={project.loopStartBeat}
                    loopEndBeat={project.loopEndBeat}
                    arrangementClips={project.arrangementClips}
                    sessionRuntime={selectedTrack ? (daw.sessionRuntimes[selectedTrack.id] ?? null) : null}
                    onSeekBeat={(b) => dawController.seekToBeat(b)}
                    onSelectClip={(cid) => {
                      const owner = project.tracks.find((t) => t.sessionSlots.includes(cid));
                      dawController.openMidiClipEditor(cid, owner?.id);
                    }}
                    onAddNote={(cid, n) => dawController.addMidiNote(cid, n)}
                    onUpdateNote={(cid, nid, p) => dawController.updateMidiNote(cid, nid, p)}
                    onDeleteNote={(cid, nid) => dawController.deleteMidiNote(cid, nid)}
                    onQuantizeClip={(cid, g) => dawController.quantizeMidiClip(cid, g)}
                    onSetClipLength={(cid, len) => dawController.setMidiClipLength(cid, len)}
                    onAuditionNote={(tid, pitch, vel) =>
                      void dawController.auditionMidiNote(tid, pitch, vel)
                    }
                  />
                ) : (
                  <DeviceRack
                    track={selectedTrack}
                    allTracks={project.tracks}
                    onSelectTrack={(id) => dawController.selectTrack(id)}
                    audioAssets={daw.audioAssets}
                    soundBanks={daw.soundBanks}
                    instrumentCatalog={instrumentCatalog}
                    onSetInstrumentType={(tid, type) =>
                      dawController.setTrackInstrumentType(tid, type)
                    }
                    onUpdateInstrumentParams={(tid, patch) =>
                      dawController.updateTrackInstrumentParams(tid, patch)
                    }
                    onAssignInstrument={(tid, entry) =>
                      void dawController.assignTrackInstrument(tid, entry)
                    }
                    onSetTrackProgram={(tid, bank, prog) =>
                      void dawController.setTrackProgram(tid, bank, prog)
                    }
                    onSetTrackPan={(tid, pan) => dawController.setTrackPan(tid, pan)}
                    onSetTrackSend={(tid, st, amt) => dawController.setTrackSend(tid, st, amt)}
                    onSetTrackSustain={(tid, active) => dawController.setTrackSustain(tid, active)}
                    onSetTrackPitchBend={(tid, st) => dawController.setTrackPitchBend(tid, st)}
                    onOpenInstrumentBrowser={(tid) => openInstrumentPicker(tid)}
                    onAddEffect={(tid, type) => dawController.addTrackEffect(tid, type)}
                    onUpdateEffect={(tid, fid, patch) =>
                      dawController.updateTrackEffect(tid, fid, patch)
                    }
                    onRemoveEffect={(tid, fid) => dawController.removeTrackEffect(tid, fid)}
                    onMoveEffect={(tid, fid, delta) =>
                      dawController.moveTrackEffect(tid, fid, delta)
                    }
                    onAuditionTrack={(tid, pitch) => void dawController.auditionMidiNote(tid, pitch)}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dedicated Mobile Screens (Preserving Bottom Play/Stop/Record/BPM/Sess|Arr|MIDI|Mix Bar) */}
        <div className="flex md:hidden flex-1 min-w-0 min-h-0 flex-col">
          {mobileScreen === 'session' && (
            <SessionView
              project={project}
              selectedTrackId={daw.selectedTrackId}
              selectedTrackIds={daw.selectedTrackIds}
              isPlaying={daw.isPlaying}
              currentBeat={daw.currentBeat}
              quantProgress={daw.quantProgress}
              sessionRuntimes={daw.sessionRuntimes}
              onSelectTrack={(id, mode, orderedIds) =>
                dawController.selectTrack(id, mode, orderedIds)
              }
              onTriggerClip={(tid, cid) => void dawController.triggerSessionClip(tid, cid)}
              onTriggerScene={(idx) => void dawController.triggerScene(idx)}
              onStopTrack={(tid) => dawController.stopTrackSession(tid)}
              onClearAll={() => dawController.clearAllSessionClips()}
              onCreateMidiClip={(tid, idx) => dawController.createSessionMidiClip(tid, idx)}
              onDeleteClip={(tid, idx) => dawController.deleteSessionClip(tid, idx)}
              onEditMidiClip={handleOpenMidiEditor}
              onSendToArrangement={(tid, cid) => {
                dawController.addSessionClipToArrangement(tid, cid, daw.currentBeat);
              }}
              onAddTrack={(type) => dawController.addTrack(type)}
              onDeleteTrack={(id) => dawController.deleteTrack(id)}
              onRenameTrack={(id, name) => dawController.renameTrack(id, name)}
              onAddScene={() => dawController.addScene()}
              onSetTrackVolume={(id, db) => dawController.setTrackVolume(id, db)}
              onSetTrackPan={(id, pan) => dawController.setTrackPan(id, pan)}
              onToggleMute={(id) => dawController.toggleTrackMute(id)}
              onToggleSolo={(id) => dawController.toggleTrackSolo(id)}
              onToggleArm={(id) => dawController.toggleTrackArm(id)}
              onDropFilesToSlot={(files, tid, idx) => {
                const file = files[0];
                if (file) void dawController.importAudioFile(file, { trackId: tid, sceneIndex: idx });
              }}
              onDropAssetToSlot={(assetId, tid, idx) => {
                const asset = daw.audioAssets.find((a) => a.id === assetId);
                if (asset) void dawController.assignAudioAssetToTarget(asset, tid, idx);
              }}
              onOpenInstrumentPicker={(tid) => openInstrumentPicker(tid)}
              onDropFilesNewTrack={(files) => {
                const file = files[0];
                if (file) {
                  dawController.addTrack('audio', file.name.replace(/\.[^/.]+$/, ''));
                  const newTrackId = dawController.getState().selectedTrackId;
                  void dawController.importAudioFile(file, { trackId: newTrackId, sceneIndex: 0 });
                }
              }}
            />
          )}

          {mobileScreen === 'arrangement' && (
            <ArrangementView
              project={project}
              selectedTrackId={daw.selectedTrackId}
              selectedTrackIds={daw.selectedTrackIds}
              isPlaying={daw.isPlaying}
              playbackMode={daw.playbackMode}
              currentBeat={daw.currentBeat}
              onPlayArrangement={() => void dawController.play('arrangement')}
              onSeekBeat={(b) => dawController.seekToBeat(b)}
              onSelectTrack={(id, mode, orderedIds) =>
                dawController.selectTrack(id, mode, orderedIds)
              }
              onMoveClip={(cid, b, tid) => dawController.moveArrangementClip(cid, b, tid)}
              onMoveClips={(cids, delta, tid, sid, ordered) =>
                dawController.moveArrangementClips(cids, delta, tid, sid, ordered)
              }
              onResizeClip={(cid, len) => dawController.resizeArrangementClip(cid, len)}
              onDuplicateClip={(cid) => dawController.duplicateArrangementClip(cid)}
              onDuplicateClips={(cids) => dawController.duplicateArrangementClips(cids)}
              onSplitClip={(cid, b) => dawController.splitArrangementClipAtBeat(cid, b)}
              onDeleteClip={(cid) => dawController.deleteArrangementClip(cid)}
              onDeleteClips={(cids) => dawController.deleteArrangementClips(cids)}
              onCopyClip={(cid) => dawController.copyArrangementClip(cid)}
              onCutClip={(cid) => dawController.cutArrangementClip(cid)}
              onPasteClip={(tid, b) => dawController.pasteArrangementClip(tid, b)}
              onSetClipColor={(sid, col, cid) => dawController.setClipColor(sid, col, cid)}
              onEditMidiClip={handleOpenMidiEditor}
              onSetLoopRegion={(s, e, rec) => dawController.setLoopRegion(s, e, rec)}
              onSetLoopSnap={(snap) => dawController.setLoopSnap(snap)}
              onToggleLoop={() => dawController.toggleLoop()}
              onToggleAutomation={(tid) => dawController.toggleTrackAutomationView(tid)}
              onSetAutomationTarget={(tid, target) =>
                dawController.setTrackAutomationTarget(tid, target)
              }
              onToggleAutomationEnabled={(tid, target) =>
                dawController.toggleAutomationLaneEnabled(tid, target)
              }
              onUpsertAutomationPoint={(tid, target, b, v) =>
                dawController.upsertAutomationPoint(tid, target, b, v)
              }
              onSetTrackVolume={(id, db) => dawController.setTrackVolume(id, db)}
              onSetTrackPan={(id, pan) => dawController.setTrackPan(id, pan)}
              onToggleArm={(tid) => dawController.toggleTrackArm(tid)}
              onToggleMute={(tid) => dawController.toggleTrackMute(tid)}
              onToggleSolo={(tid) => dawController.toggleTrackSolo(tid)}
              onAddTrack={(type, name, groupId) => dawController.addTrack(type, name, groupId)}
              onAddTrackGroup={(name) => dawController.addTrackGroup(name, undefined, true)}
              onToggleGroupCollapse={(id) => dawController.toggleTrackGroupCollapse(id)}
              onSetTrackGroupId={(id, gid) => dawController.setTrackGroupId(id, gid)}
              onDropFilesToTimeline={(files, tid, beat) => {
                const file = files[0];
                if (file) void dawController.importAudioFile(file, { trackId: tid, startBeat: beat });
              }}
              onOpenInstrumentPicker={(tid) => openInstrumentPicker(tid)}
              onDropAssetToTimeline={(assetId, tid, beat) => {
                const asset = daw.audioAssets.find((a) => a.id === assetId);
                if (asset) void dawController.assignAudioAssetToTarget(asset, tid, undefined, beat);
              }}
            />
          )}

          {mobileScreen === 'pianoroll' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-2 py-1.5 bg-[#16181D] border-b border-white/[0.08] flex items-center justify-between gap-2">
                <select
                  aria-label="Select MIDI clip to edit"
                  value={daw.editingMidiClipId ?? ''}
                  onChange={(e) => {
                    const clipId = e.target.value;
                    const owner = project.tracks.find((t) => t.sessionSlots.includes(clipId));
                    dawController.openMidiClipEditor(clipId, owner?.id);
                  }}
                  className="h-8 bg-[#111214] border border-white/[0.08] rounded px-2 text-xs text-zinc-100 flex-1 min-w-0"
                >
                  {Object.values(project.midiClips).map((mc) => (
                    <option key={mc.id} value={mc.id}>
                      {mc.name}
                    </option>
                  ))}
                </select>

                <div className="flex bg-[#111214] border border-white/[0.08] rounded p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileMidiSubTab('pianoroll')}
                    className={`px-2 py-1 rounded text-[11px] font-semibold ${
                      mobileMidiSubTab === 'pianoroll' ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400'
                    }`}
                  >
                    Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileMidiSubTab('device')}
                    className={`px-2 py-1 rounded text-[11px] font-semibold ${
                      mobileMidiSubTab === 'device' ? 'bg-[#6D5DFB] text-white' : 'text-zinc-400'
                    }`}
                  >
                    Devices
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {mobileMidiSubTab === 'pianoroll' ? (
                  <PianoRoll
                    clip={editingMidiClip}
                    track={selectedTrack}
                    allMidiClips={Object.values(project.midiClips)}
                    currentBeat={daw.currentBeat}
                    isPlaying={daw.isPlaying}
                    playbackMode={daw.playbackMode}
                    bpm={project.bpm}
                    timeSignature={project.timeSignature}
                    loopEnabled={project.loopEnabled}
                    loopStartBeat={project.loopStartBeat}
                    loopEndBeat={project.loopEndBeat}
                    arrangementClips={project.arrangementClips}
                    sessionRuntime={selectedTrack ? (daw.sessionRuntimes[selectedTrack.id] ?? null) : null}
                    onSeekBeat={(b) => dawController.seekToBeat(b)}
                    onSelectClip={(cid) => {
                      const owner = project.tracks.find((t) => t.sessionSlots.includes(cid));
                      dawController.openMidiClipEditor(cid, owner?.id);
                    }}
                    onAddNote={(cid, n) => dawController.addMidiNote(cid, n)}
                    onUpdateNote={(cid, nid, p) => dawController.updateMidiNote(cid, nid, p)}
                    onDeleteNote={(cid, nid) => dawController.deleteMidiNote(cid, nid)}
                    onQuantizeClip={(cid, g) => dawController.quantizeMidiClip(cid, g)}
                    onSetClipLength={(cid, len) => dawController.setMidiClipLength(cid, len)}
                    onAuditionNote={(tid, pitch, vel) =>
                      void dawController.auditionMidiNote(tid, pitch, vel)
                    }
                  />
                ) : (
                  <DeviceRack
                    track={selectedTrack}
                    allTracks={project.tracks}
                    onSelectTrack={(id) => dawController.selectTrack(id)}
                    audioAssets={daw.audioAssets}
                    soundBanks={daw.soundBanks}
                    instrumentCatalog={instrumentCatalog}
                    onSetInstrumentType={(tid, type) =>
                      dawController.setTrackInstrumentType(tid, type)
                    }
                    onUpdateInstrumentParams={(tid, patch) =>
                      dawController.updateTrackInstrumentParams(tid, patch)
                    }
                    onAssignInstrument={(tid, entry) =>
                      void dawController.assignTrackInstrument(tid, entry)
                    }
                    onSetTrackProgram={(tid, bank, prog) =>
                      void dawController.setTrackProgram(tid, bank, prog)
                    }
                    onSetTrackPan={(tid, pan) => dawController.setTrackPan(tid, pan)}
                    onSetTrackSend={(tid, st, amt) => dawController.setTrackSend(tid, st, amt)}
                    onSetTrackSustain={(tid, active) => dawController.setTrackSustain(tid, active)}
                    onSetTrackPitchBend={(tid, st) => dawController.setTrackPitchBend(tid, st)}
                    onOpenInstrumentBrowser={(tid) => openInstrumentPicker(tid)}
                    onAddEffect={(tid, type) => dawController.addTrackEffect(tid, type)}
                    onUpdateEffect={(tid, fid, patch) =>
                      dawController.updateTrackEffect(tid, fid, patch)
                    }
                    onRemoveEffect={(tid, fid) => dawController.removeTrackEffect(tid, fid)}
                    onMoveEffect={(tid, fid, delta) =>
                      dawController.moveTrackEffect(tid, fid, delta)
                    }
                    onAuditionTrack={(tid, pitch) => void dawController.auditionMidiNote(tid, pitch)}
                  />
                )}
              </div>
            </div>
          )}

          {mobileScreen === 'mixer' && (
            <MixerView
              project={project}
              selectedTrackId={daw.selectedTrackId}
              selectedTrackIds={daw.selectedTrackIds}
              onSelectTrack={(id, mode, orderedIds) =>
                dawController.selectTrack(id, mode, orderedIds)
              }
              onSetTrackVolume={(id, db) => dawController.setTrackVolume(id, db)}
              onSetTrackPan={(id, pan) => dawController.setTrackPan(id, pan)}
              onSetTrackSend={(id, st, amt) => dawController.setTrackSend(id, st, amt)}
              onToggleMute={(id) => dawController.toggleTrackMute(id)}
              onToggleSolo={(id) => dawController.toggleTrackSolo(id)}
              onToggleArm={(id) => dawController.toggleTrackArm(id)}
              onAddEffect={(tid, type) => dawController.addTrackEffect(tid, type)}
              onUpdateEffect={(tid, fid, patch) =>
                dawController.updateTrackEffect(tid, fid, patch)
              }
              onRemoveEffect={(tid, fid) => dawController.removeTrackEffect(tid, fid)}
              onApplyMidiPreset={(item) => dawController.applyLibraryPreset(item)}
              onSetMasterVolume={(db) => dawController.setMasterVolume(db)}
            />
          )}
        </div>

        {/* Transient Action Notice */}
        {daw.notice && (
          <div className="fixed top-14 right-3 z-50 bg-[#1B1E28] border border-[#6D5DFB]/60 text-zinc-100 px-3 py-2 rounded shadow-lg text-xs font-medium flex items-center gap-2">
            <span>{daw.notice}</span>
            <button
              type="button"
              onClick={() => dawController.clearNotice()}
              aria-label="Dismiss notice"
              className="text-zinc-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Immediate Group Rename Modal after Group Tracks / Add Group */}
        {daw.pendingRenameGroupId && (() => {
          const pendingGrp = project.tracks.find((t) => t.id === daw.pendingRenameGroupId);
          if (!pendingGrp) return null;
          const commitRename = () => {
            if (pendingGroupName.trim()) {
              dawController.renameTrack(pendingGrp.id, pendingGroupName.trim());
            }
            dawController.clearPendingRenameGroup();
          };
          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Name New Group"
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
              onClick={() => dawController.clearPendingRenameGroup()}
            >
              <div
                className="w-full max-w-sm rounded-lg bg-[#161922] border border-white/[0.15] shadow-2xl p-4 flex flex-col gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-xs shrink-0"
                      style={{ backgroundColor: pendingGrp.color }}
                    />
                    <h2 className="text-sm font-bold text-white">Name New Group</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => dawController.clearPendingRenameGroup()}
                    aria-label="Close group rename dialog"
                    className="text-zinc-400 hover:text-white p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <input
                  autoFocus
                  type="text"
                  value={pendingGroupName}
                  onChange={(e) => setPendingGroupName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') dawController.clearPendingRenameGroup();
                  }}
                  placeholder="Enter group name"
                  className="h-9 px-3 rounded bg-[#101218] border border-white/[0.15] text-sm text-white focus:outline-none focus:border-[#6D5DFB]"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => dawController.clearPendingRenameGroup()}
                    className="h-8 px-3 rounded bg-[#222631] hover:bg-[#2C3140] text-xs font-semibold text-zinc-300"
                  >
                    Keep &ldquo;{pendingGrp.name}&rdquo;
                  </button>
                  <button
                    type="button"
                    onClick={commitRename}
                    className="h-8 px-3.5 rounded bg-[#6D5DFB] hover:bg-[#7C6EFF] text-xs font-semibold text-white"
                  >
                    Save Group Name
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Instrument & SoundFont Library Modal */}
        {instrumentPickerTrackId && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Instrument & Sound Library"
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
            onClick={() => setInstrumentPickerTrackId(null)}
          >
            <div
              className="w-full sm:max-w-4xl h-[88vh] sm:h-[82vh] rounded-t-2xl sm:rounded-xl bg-[#101218] border border-white/[0.14] shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-2.5 bg-[#15171F] border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white truncate">
                    Instrument &amp; Sound Library
                  </h2>
                  <p className="text-[11px] text-zinc-400 truncate">
                    Assign a built-in instrument or SoundFont (.sf2) preset without modifying your MIDI notes
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInstrumentPickerTrackId(null)}
                  aria-label="Close instrument library"
                  className="min-h-[40px] min-w-[40px] rounded-lg bg-[#202431] hover:bg-[#2B3042] text-zinc-200 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <InstrumentBrowser
                  catalog={instrumentCatalog}
                  soundBanks={daw.soundBanks}
                  selectedTrack={instrumentPickerTrack}
                  favoriteIds={daw.favoriteInstrumentIds}
                  recentIds={daw.recentInstrumentIds}
                  instrumentLoading={daw.instrumentLoading}
                  soundBankError={daw.soundBankError}
                  onPreviewPreset={(entry) => void dawController.previewInstrumentPreset(entry)}
                  onAssignPreset={(tid, entry) =>
                    void dawController.assignTrackInstrument(tid, entry)
                  }
                  onToggleFavorite={(id) => dawController.toggleFavoriteInstrument(id)}
                  onImportSoundFontFile={(file) => void dawController.importSoundFontFile(file)}
                  onUnloadSoundBank={(bankId) => dawController.unloadSoundBankFromRam(bankId)}
                  onDeleteSoundBank={(bankId) => void dawController.deleteSoundBank(bankId)}
                  onClearError={() => dawController.clearSoundBankError()}
                  isSoundBankInMemory={(bankId) => dawController.isSoundBankInMemory(bankId)}
                  memoryStats={memoryStats}
                  compact
                  onAfterAssign={() => setInstrumentPickerTrackId(null)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Full Project Share & JSON Import/Export Modal */}
        <ProjectShareModal
          isOpen={isShareModalOpen}
          project={project}
          audioAssets={daw.audioAssets}
          savedProjects={daw.savedProjects}
          onClose={() => setIsShareModalOpen(false)}
          onExportJson={(includeAudio, pretty) =>
            dawController.exportProjectJson(undefined, includeAudio, pretty)
          }
          onExportWav={() => void dawController.exportProjectWav()}
          onImportFile={(file, asNew) => dawController.importProjectFromJsonFile(file, asNew)}
          onImportString={(str, asNew) => dawController.importProjectFromJsonString(str, asNew)}
        />
      </div>
    </div>
  );
}
