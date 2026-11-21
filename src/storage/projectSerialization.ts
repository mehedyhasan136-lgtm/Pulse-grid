import {
  ProjectState,
  StoredAudioAsset,
  TrackModel,
  SceneModel,
  MidiClip,
  AudioClipMeta,
  ArrangementClip,
} from '../types/daw';

export interface PulseGridAssetExport {
  id: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  peaks: number[];
  base64Data?: string;
  createdAt: number;
}

export interface PulseGridProjectExport {
  app: 'PulseGrid';
  version: 1;
  format: 'pulsegrid-composition';
  exportedAt: string;
  project: ProjectState;
  embeddedAssets?: PulseGridAssetExport[];
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunking
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'composition';
}

export function buildProjectExportBundle(
  project: ProjectState,
  assets: StoredAudioAsset[] = [],
  includeAudioData = true
): PulseGridProjectExport {
  const referencedAssetIds = new Set<string>();
  if (project.audioClips) {
    Object.values(project.audioClips).forEach((c) => {
      if (c?.assetId) referencedAssetIds.add(c.assetId);
    });
  }
  if (Array.isArray(project.tracks)) {
    project.tracks.forEach((t) => {
      if (t?.instrument?.params?.sampleAssetId) {
        referencedAssetIds.add(t.instrument.params.sampleAssetId);
      }
    });
  }

  const matchingAssets = assets.filter((a) => referencedAssetIds.has(a.id));

  const embeddedAssets: PulseGridAssetExport[] = matchingAssets.map((asset) => {
    let base64Data: string | undefined;
    if (includeAudioData && asset.arrayBuffer && asset.arrayBuffer.byteLength > 0) {
      try {
        base64Data = arrayBufferToBase64(asset.arrayBuffer);
      } catch {
        // Skip encoding if memory is constrained
      }
    }
    return {
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType || 'audio/wav',
      durationSeconds: asset.durationSeconds || 0,
      peaks: Array.isArray(asset.peaks) ? asset.peaks : [],
      createdAt: asset.createdAt || Date.now(),
      base64Data,
    };
  });

  return {
    app: 'PulseGrid',
    version: 1,
    format: 'pulsegrid-composition',
    exportedAt: new Date().toISOString(),
    project,
    embeddedAssets: embeddedAssets.length > 0 ? embeddedAssets : undefined,
  };
}

export function triggerJsonDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

export interface ParsedProjectResult {
  project: ProjectState;
  restoredAssets: StoredAudioAsset[];
  isBundle: boolean;
  warnings: string[];
}

export function parseAndValidateProjectJson(jsonInput: string | unknown): ParsedProjectResult {
  const warnings: string[] = [];
  let parsed: unknown;

  if (typeof jsonInput === 'string') {
    try {
      parsed = JSON.parse(jsonInput);
    } catch (err) {
      throw new Error(`Invalid JSON format: ${(err as Error).message}`);
    }
  } else {
    parsed = jsonInput;
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Imported data is not a valid JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  const isBundle = obj.app === 'PulseGrid' || 'project' in obj;
  const rawProject = (isBundle && obj.project ? obj.project : obj) as Partial<ProjectState>;

  if (!rawProject || typeof rawProject !== 'object') {
    throw new Error('Could not find project data in the imported JSON.');
  }

  // Restore assets if present
  const restoredAssets: StoredAudioAsset[] = [];
  const rawAssets = (obj.embeddedAssets || obj.assets) as PulseGridAssetExport[] | undefined;
  if (Array.isArray(rawAssets)) {
    for (const rawAsset of rawAssets) {
      if (rawAsset && rawAsset.id && rawAsset.name) {
        let buffer: ArrayBuffer;
        if (rawAsset.base64Data) {
          try {
            buffer = base64ToArrayBuffer(rawAsset.base64Data);
          } catch {
            buffer = new ArrayBuffer(0);
            warnings.push(`Could not decode audio data for sample "${rawAsset.name}".`);
          }
        } else {
          buffer = new ArrayBuffer(0);
        }

        restoredAssets.push({
          id: String(rawAsset.id),
          name: String(rawAsset.name),
          mimeType: String(rawAsset.mimeType || 'audio/wav'),
          durationSeconds: Number(rawAsset.durationSeconds) || 0,
          peaks: Array.isArray(rawAsset.peaks) ? rawAsset.peaks : [],
          arrayBuffer: buffer,
          createdAt: Number(rawAsset.createdAt) || Date.now(),
        });
      }
    }
  }

  // Validate and sanitize project state
  const name = typeof rawProject.name === 'string' && rawProject.name.trim()
    ? rawProject.name.trim()
    : 'Imported Composition';

  const bpmRaw = Number(rawProject.bpm);
  const bpm = !isNaN(bpmRaw) && bpmRaw >= 20 && bpmRaw <= 300 ? Math.round(bpmRaw) : 120;

  const timeSignature: [number, number] = Array.isArray(rawProject.timeSignature) &&
    rawProject.timeSignature.length === 2 &&
    typeof rawProject.timeSignature[0] === 'number' &&
    typeof rawProject.timeSignature[1] === 'number'
      ? [rawProject.timeSignature[0], rawProject.timeSignature[1]]
      : [4, 4];

  const quantize = rawProject.quantize === '1m' || rawProject.quantize === '2n' || rawProject.quantize === '4n'
    ? rawProject.quantize
    : '1m';

  const swingRaw = Number(rawProject.swingPercent);
  const swingPercent = !isNaN(swingRaw) ? Math.max(0, Math.min(100, Math.round(swingRaw))) : 0;

  const masterVolumeDb = typeof rawProject.masterVolumeDb === 'number' && !isNaN(rawProject.masterVolumeDb)
    ? Math.max(-60, Math.min(6, rawProject.masterVolumeDb))
    : -6;

  const loopStartBeat = Math.max(0, Number(rawProject.loopStartBeat) || 0);
  const rawLoopEnd = Number(rawProject.loopEndBeat);
  const loopEndBeat = !isNaN(rawLoopEnd) && rawLoopEnd > loopStartBeat + 0.25 ? rawLoopEnd : loopStartBeat + 16;
  const loopSnap =
    rawProject.loopSnap === 'bar' ||
    rawProject.loopSnap === '1/2' ||
    rawProject.loopSnap === '1/4' ||
    rawProject.loopSnap === '1/8' ||
    rawProject.loopSnap === 'off'
      ? rawProject.loopSnap
      : 'bar';

  // Sanitize tracks
  const tracks: TrackModel[] = Array.isArray(rawProject.tracks)
    ? rawProject.tracks.map((t, index) => {
        const id = t?.id ? String(t.id) : `track-${index + 1}`;
        const tName = t?.name ? String(t.name) : `Track ${index + 1}`;
        const type = t?.type === 'audio' ? 'audio' : 'midi';
        const color = typeof t?.color === 'string' ? t.color : '#6D5DFB';
        const vol = typeof t?.volumeDb === 'number' && !isNaN(t.volumeDb) ? t.volumeDb : -6;
        const pan = typeof t?.pan === 'number' && !isNaN(t.pan) ? Math.max(-1, Math.min(1, t.pan)) : 0;

        return {
          id,
          name: tName,
          type,
          color,
          volumeDb: vol,
          pan,
          sendReverb: typeof t?.sendReverb === 'number' ? Math.max(0, Math.min(1, t.sendReverb)) : 0,
          sendDelay: typeof t?.sendDelay === 'number' ? Math.max(0, Math.min(1, t.sendDelay)) : 0,
          muted: Boolean(t?.muted),
          solo: Boolean(t?.solo),
          armed: Boolean(t?.armed),
          instrument: t?.instrument && typeof t.instrument === 'object'
            ? {
                type: t.instrument.type || (type === 'audio' ? 'sampler' : 'synth'),
                params: {
                  waveform: t.instrument.params?.waveform || 'sine',
                  attack: typeof t.instrument.params?.attack === 'number' ? t.instrument.params.attack : 0.01,
                  decay: typeof t.instrument.params?.decay === 'number' ? t.instrument.params.decay : 0.2,
                  sustain: typeof t.instrument.params?.sustain === 'number' ? t.instrument.params.sustain : 0.5,
                  release: typeof t.instrument.params?.release === 'number' ? t.instrument.params.release : 0.5,
                  cutoff: typeof t.instrument.params?.cutoff === 'number' ? t.instrument.params.cutoff : 3000,
                  resonance: typeof t.instrument.params?.resonance === 'number' ? t.instrument.params.resonance : 1,
                  oscVolume: typeof t.instrument.params?.oscVolume === 'number' ? t.instrument.params.oscVolume : 0,
                  pitchSemitones: typeof t.instrument.params?.pitchSemitones === 'number' ? t.instrument.params.pitchSemitones : 0,
                  sampleAssetId: t.instrument.params?.sampleAssetId,
                  sampleName: t.instrument.params?.sampleName,
                  pianoPreset: t.instrument.params?.pianoPreset,
                  instrumentId: t.instrument.params?.instrumentId,
                  instrumentName: t.instrument.params?.instrumentName,
                  instrumentCategory: t.instrument.params?.instrumentCategory,
                  soundBankId: t.instrument.params?.soundBankId,
                  bankNumber: typeof t.instrument.params?.bankNumber === 'number' ? t.instrument.params.bankNumber : undefined,
                  programNumber: typeof t.instrument.params?.programNumber === 'number' ? t.instrument.params.programNumber : undefined,
                  midiChannel: typeof t.instrument.params?.midiChannel === 'number' ? t.instrument.params.midiChannel : undefined,
                  chorus: typeof t.instrument.params?.chorus === 'number' ? t.instrument.params.chorus : 0,
                  pitchBendSemitones: typeof t.instrument.params?.pitchBendSemitones === 'number' ? t.instrument.params.pitchBendSemitones : 0,
                  pitchBendRange: typeof t.instrument.params?.pitchBendRange === 'number' ? t.instrument.params.pitchBendRange : 2,
                  sustainActive: Boolean(t.instrument.params?.sustainActive),
                },
              }
            : {
                type: type === 'audio' ? 'sampler' : 'synth',
                params: {
                  waveform: 'sine',
                  attack: 0.01,
                  decay: 0.2,
                  sustain: 0.5,
                  release: 0.5,
                  cutoff: 3000,
                  resonance: 1,
                  oscVolume: 0,
                  pitchSemitones: 0,
                },
              },
          effects: Array.isArray(t?.effects) ? t.effects : [],
          sessionSlots: Array.isArray(t?.sessionSlots) ? t.sessionSlots : [null, null, null, null],
          automationLanes: Array.isArray(t?.automationLanes) ? t.automationLanes : [],
          showAutomation: Boolean(t?.showAutomation),
          activeAutomationTarget: t?.activeAutomationTarget || 'volume',
          groupId: t?.groupId ? String(t.groupId) : undefined,
          isGroupFolder: Boolean(t?.isGroupFolder),
          childTrackIds: Array.isArray(t?.childTrackIds) ? t.childTrackIds.map(String) : undefined,
          collapsed: Boolean(t?.collapsed),
          frozen: Boolean(t?.frozen),
          frozenAudioAssetId: t?.frozenAudioAssetId ? String(t.frozenAudioAssetId) : undefined,
          frozenGroupClipId: t?.frozenGroupClipId ? String(t.frozenGroupClipId) : undefined,
          frozenBackup: t?.frozenBackup,
        };
      })
    : [];

  // Reconcile bidirectional group IDs (single-level enforcement & orphan cleanup)
  const validGroupIds = new Set(tracks.filter((t) => t.isGroupFolder).map((t) => t.id));
  for (const t of tracks) {
    if (t.isGroupFolder) {
      t.groupId = undefined;
    } else if (t.groupId && !validGroupIds.has(t.groupId)) {
      t.groupId = undefined;
    }
  }
  for (const g of tracks) {
    if (g.isGroupFolder) {
      const actualChildren = tracks.filter((c) => !c.isGroupFolder && c.groupId === g.id);
      const actualIds = new Set(actualChildren.map((c) => c.id));
      const preservedOrder = (g.childTrackIds ?? []).filter((id) => actualIds.has(id));
      const remaining = actualChildren.map((c) => c.id).filter((id) => !preservedOrder.includes(id));
      g.childTrackIds = [...preservedOrder, ...remaining];
    } else {
      g.childTrackIds = undefined;
    }
  }

  // Sanitize scenes
  const scenes: SceneModel[] = Array.isArray(rawProject.scenes) && rawProject.scenes.length > 0
    ? rawProject.scenes.map((s, index) => ({
        id: s?.id ? String(s.id) : `scene-${index + 1}`,
        name: s?.name ? String(s.name) : `Scene ${index + 1}`,
      }))
    : [
        { id: 'scene-1', name: 'Intro' },
        { id: 'scene-2', name: 'Verse' },
        { id: 'scene-3', name: 'Chorus' },
        { id: 'scene-4', name: 'Outro' },
      ];

  // Sanitize midi clips
  const midiClips: Record<string, MidiClip> = {};
  if (rawProject.midiClips && typeof rawProject.midiClips === 'object') {
    Object.entries(rawProject.midiClips).forEach(([key, clip]) => {
      if (clip && typeof clip === 'object') {
        const id = clip.id ? String(clip.id) : key;
        const notes = Array.isArray(clip.notes)
          ? clip.notes
              .filter((n) => n && typeof n.pitch === 'number')
              .map((n, idx) => ({
                id: n.id ? String(n.id) : `note-${idx}`,
                pitch: Math.max(0, Math.min(127, Number(n.pitch) || 60)),
                startBeat: Math.max(0, Number(n.startBeat) || 0),
                durationBeats: Math.max(0.05, Number(n.durationBeats) || 1),
                velocity: Math.max(1, Math.min(127, Number(n.velocity) || 100)),
                channel: typeof n.channel === 'number' ? n.channel : undefined,
                pitchSlide: Array.isArray(n.pitchSlide) ? n.pitchSlide : undefined,
                mpe: n.mpe && typeof n.mpe === 'object' ? n.mpe : undefined,
              }))
          : [];

        midiClips[id] = {
          id,
          name: clip.name ? String(clip.name) : 'Clip',
          color: clip.color ? String(clip.color) : '#6D5DFB',
          lengthBeats: Number(clip.lengthBeats) || 4,
          notes,
          rootNote: typeof clip.rootNote === 'string' ? clip.rootNote : undefined,
          scale: typeof clip.scale === 'string' ? clip.scale : undefined,
          scaleHighlight: typeof clip.scaleHighlight === 'boolean' ? clip.scaleHighlight : undefined,
          scaleSnap: typeof clip.scaleSnap === 'boolean' ? clip.scaleSnap : undefined,
        };
      }
    });
  }

  // Sanitize audio clips
  const audioClips: Record<string, AudioClipMeta> = {};
  if (rawProject.audioClips && typeof rawProject.audioClips === 'object') {
    Object.entries(rawProject.audioClips).forEach(([key, clip]) => {
      if (clip && typeof clip === 'object') {
        const id = clip.id ? String(clip.id) : key;
        audioClips[id] = {
          id,
          name: clip.name ? String(clip.name) : 'Audio Clip',
          color: clip.color ? String(clip.color) : '#3B82F6',
          assetId: clip.assetId ? String(clip.assetId) : '',
          durationSeconds: Number(clip.durationSeconds) || 0,
          lengthBeats: Number(clip.lengthBeats) || 4,
          peaks: Array.isArray(clip.peaks) ? clip.peaks : [],
        };
      }
    });
  }

  // Sanitize arrangement clips
  const arrangementClips: ArrangementClip[] = Array.isArray(rawProject.arrangementClips)
    ? rawProject.arrangementClips.map((c, index) => ({
        id: c?.id ? String(c.id) : `arr-clip-${index}`,
        trackId: c?.trackId ? String(c.trackId) : (tracks[0]?.id || 'track-1'),
        name: c?.name ? String(c.name) : 'Clip',
        color: c?.color ? String(c.color) : '#6D5DFB',
        kind: c?.kind === 'audio' ? 'audio' : 'midi',
        sourceClipId: c?.sourceClipId ? String(c.sourceClipId) : '',
        startBeat: Math.max(0, Number(c?.startBeat) || 0),
        lengthBeats: Math.max(0.25, Number(c?.lengthBeats) || 4),
        offsetBeats: Math.max(0, Number(c?.offsetBeats) || 0),
      }))
    : [];

  const project: ProjectState = {
    id: rawProject.id ? String(rawProject.id) : `project-${Date.now()}`,
    name,
    updatedAt: Date.now(),
    bpm,
    timeSignature,
    quantize,
    swingPercent,
    metronomeEnabled: Boolean(rawProject.metronomeEnabled),
    loopEnabled: rawProject.loopEnabled !== undefined ? Boolean(rawProject.loopEnabled) : true,
    loopStartBeat,
    loopEndBeat,
    loopSnap,
    masterVolumeDb,
    tracks,
    scenes,
    midiClips,
    audioClips,
    arrangementClips,
  };

  return {
    project,
    restoredAssets,
    isBundle,
    warnings,
  };
}
