// Minimal promise wrapper over IndexedDB. Tables follow guitar-kb/catalog/SCHEMA.md (on-device data).
const NAME = 'guitar-trainer', VERSION = 2;
let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = e => {
      const d = r.result;
      if (e.oldVersion < 2 && !d.objectStoreNames.contains('calibration')) d.createObjectStore('calibration', { keyPath: 'key' });
      if (e.oldVersion >= 1) return;
      d.createObjectStore('lesson_progress', { keyPath: 'lesson_id' });
      const a = d.createObjectStore('attempt', { keyPath: 'id', autoIncrement: true }); a.createIndex('lesson_id', 'lesson_id');
      d.createObjectStore('practice_day', { keyPath: 'day' });
      d.createObjectStore('quiz_item_stats', { keyPath: ['quiz_id', 'item_key'] });
      d.createObjectStore('kv', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const STORES = ['lesson_progress', 'attempt', 'practice_day', 'quiz_item_stats', 'kv', 'calibration'] as const;
export async function getAll<T>(store: string): Promise<T[]> { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()) as Promise<T[]>; }
export async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>; }
export async function put(store: string, value: unknown): Promise<void> { const d = await open(); await req(d.transaction(store, 'readwrite').objectStore(store).put(value)); }
export async function clear(store: string): Promise<void> { const d = await open(); await req(d.transaction(store, 'readwrite').objectStore(store).clear()); }

/** Backup: every table as one JSON object. */
export async function exportAll(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const s of STORES) out[s] = await getAll(s);
  return out;
}
export async function importAll(data: Record<string, unknown[]>) {
  for (const s of STORES) { if (!Array.isArray(data[s])) continue; await clear(s); for (const row of data[s]) await put(s, row); }
}
