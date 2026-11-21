import {
  ProjectState,
  ProjectSummary,
  SoundBankSummary,
  StoredAudioAsset,
  StoredSoundBank,
} from '../types/daw';

const DB_NAME = 'pulsegrid_daw_db';
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';
const ASSETS_STORE = 'audioAssets';
const SOUND_BANKS_STORE = 'soundBanks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SOUND_BANKS_STORE)) {
        db.createObjectStore(SOUND_BANKS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveProjectToDb(project: ProjectState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    const store = tx.objectStore(PROJECTS_STORE);
    store.put({ ...project, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save project'));
  });
}

export async function loadProjectFromDb(projectId: string): Promise<ProjectState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const store = tx.objectStore(PROJECTS_STORE);
    const req = store.get(projectId);
    req.onsuccess = () => resolve((req.result as ProjectState) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to load project'));
  });
}

export async function listProjectsFromDb(): Promise<ProjectSummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const store = tx.objectStore(PROJECTS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as ProjectState[]) ?? [];
      const summaries: ProjectSummary[] = rows
        .map((p) => ({
          id: p.id,
          name: p.name,
          bpm: p.bpm,
          trackCount: p.tracks.length,
          updatedAt: p.updatedAt ?? 0,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(summaries);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list projects'));
  });
}

export async function deleteProjectFromDb(projectId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    tx.objectStore(PROJECTS_STORE).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete project'));
  });
}

export async function saveAudioAssetToDb(asset: StoredAudioAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    tx.objectStore(ASSETS_STORE).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save audio asset'));
  });
}

export async function loadAudioAssetFromDb(assetId: string): Promise<StoredAudioAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const req = tx.objectStore(ASSETS_STORE).get(assetId);
    req.onsuccess = () => resolve((req.result as StoredAudioAsset) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to load audio asset'));
  });
}

export async function listAudioAssetsFromDb(): Promise<StoredAudioAsset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const req = tx.objectStore(ASSETS_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredAudioAsset[]) ?? [];
      resolve(rows.sort((a, b) => b.createdAt - a.createdAt));
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list audio assets'));
  });
}

export async function deleteAudioAssetFromDb(assetId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    tx.objectStore(ASSETS_STORE).delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete audio asset'));
  });
}

export async function saveSoundBankToDb(bank: StoredSoundBank): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_BANKS_STORE, 'readwrite');
    tx.objectStore(SOUND_BANKS_STORE).put(bank);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save SoundFont bank'));
  });
}

export async function loadSoundBankFromDb(bankId: string): Promise<StoredSoundBank | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_BANKS_STORE, 'readonly');
    const req = tx.objectStore(SOUND_BANKS_STORE).get(bankId);
    req.onsuccess = () => resolve((req.result as StoredSoundBank) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to load SoundFont bank'));
  });
}

export async function listSoundBankSummariesFromDb(): Promise<SoundBankSummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_BANKS_STORE, 'readonly');
    const store = tx.objectStore(SOUND_BANKS_STORE);
    const summaries: SoundBankSummary[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const row = cursor.value as StoredSoundBank;
        summaries.push({
          id: row.id,
          name: row.name,
          fileName: row.fileName,
          sizeBytes: row.sizeBytes,
          engineName: row.engineName,
          author: row.author,
          presetsMeta: Array.isArray(row.presetsMeta) ? row.presetsMeta : [],
          createdAt: row.createdAt ?? 0,
        });
        cursor.continue();
      } else {
        summaries.sort((a, b) => b.createdAt - a.createdAt);
        resolve(summaries);
      }
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list SoundFont banks'));
  });
}

export async function deleteSoundBankFromDb(bankId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_BANKS_STORE, 'readwrite');
    tx.objectStore(SOUND_BANKS_STORE).delete(bankId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete SoundFont bank'));
  });
}
