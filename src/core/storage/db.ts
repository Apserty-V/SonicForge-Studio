/**
 * SonicForge Studio - IndexedDB Local Storage Manager
 * Stores local preferences, soundboard configurations, and session metadata.
 * Never uploads data to any server.
 */

const DB_NAME = 'SonicForgeStudioDB';
const DB_VERSION = 1;

export interface RecentItem {
  id: string;
  name: string;
  size: number;
  type: string;
  duration: number;
  timestamp: number;
}

export interface StoredSettings {
  defaultFormat: string;
  defaultSampleRate: number;
  autoNormalize: boolean;
  theme: string;
}

const DEFAULT_SETTINGS: StoredSettings = {
  defaultFormat: 'wav',
  defaultSampleRate: 44100,
  autoNormalize: false,
  theme: 'dark',
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      if (!db.objectStoreNames.contains('recents')) {
        db.createObjectStore('recents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('soundboard')) {
        db.createObjectStore('soundboard', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredSettings(): Promise<StoredSettings> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get('userSettings');
      req.onsuccess = () => resolve(req.result || DEFAULT_SETTINGS);
      req.onerror = () => resolve(DEFAULT_SETTINGS);
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveStoredSettings(settings: StoredSettings): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put(settings, 'userSettings');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

export async function addRecentItem(item: Omit<RecentItem, 'id' | 'timestamp'>): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction('recents', 'readwrite');
    const store = tx.objectStore('recents');
    const entry: RecentItem = {
      ...item,
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    store.put(entry);
  } catch (err) {
    console.warn('Failed to add recent item:', err);
  }
}

export async function getRecentItems(): Promise<RecentItem[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction('recents', 'readonly');
      const store = tx.objectStore('recents');
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result || []) as RecentItem[];
        items.sort((a, b) => b.timestamp - a.timestamp);
        resolve(items.slice(0, 10)); // return top 10 recent items
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
