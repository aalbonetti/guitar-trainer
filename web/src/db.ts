// Minimal promise wrapper over IndexedDB. Tables follow guitar-kb/catalog/SCHEMA.md (on-device data).
const NAME = 'guitar-trainer', VERSION = 5;
let dbp: Promise<IDBDatabase> | null = null;
let blockedHook: (() => void) | null = null;
/** Called when the database upgrade is blocked by another open copy of the app. */
export function onBlocked(f: () => void) { blockedHook = f; }
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = e => {
      const d = r.result;
      if (e.oldVersion < 2 && !d.objectStoreNames.contains('calibration')) d.createObjectStore('calibration', { keyPath: 'key' });
      if (e.oldVersion < 3 && !d.objectStoreNames.contains('practice_session')) { const ps = d.createObjectStore('practice_session', { keyPath: 'id' }); ps.createIndex('day', 'day'); }
      if (e.oldVersion < 4 && !d.objectStoreNames.contains('imported_chart')) d.createObjectStore('imported_chart', { keyPath: 'id' });
      if (e.oldVersion < 5) {
        if (!d.objectStoreNames.contains('game_run')) d.createObjectStore('game_run', { keyPath: 'id', autoIncrement: true }).createIndex('game_id', 'game_id');
        if (!d.objectStoreNames.contains('game_best')) d.createObjectStore('game_best', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('xp_ledger')) d.createObjectStore('xp_ledger', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('service_day')) d.createObjectStore('service_day', { keyPath: 'day' });
      }
      if (e.oldVersion >= 1) return;
      d.createObjectStore('lesson_progress', { keyPath: 'lesson_id' });
      const a = d.createObjectStore('attempt', { keyPath: 'id', autoIncrement: true }); a.createIndex('lesson_id', 'lesson_id');
      d.createObjectStore('practice_day', { keyPath: 'day' });
      d.createObjectStore('quiz_item_stats', { keyPath: ['quiz_id', 'item_key'] });
      d.createObjectStore('kv', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const d = r.result;
      // A newer version of the app opened in another tab/window: let it upgrade, then reload into it.
      d.onversionchange = () => { d.close(); dbp = null; location.reload(); };
      res(d);
    };
    r.onerror = () => { dbp = null; rej(r.error); };
    // An older copy of the app is still open and holding the database: tell the user instead of hanging forever.
    r.onblocked = () => { blockedHook?.(); };
  });
  return dbp;
}
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const STORES = ['lesson_progress', 'attempt', 'practice_day', 'quiz_item_stats', 'kv', 'calibration', 'practice_session', 'imported_chart', 'game_run', 'game_best', 'xp_ledger', 'service_day'] as const;
export async function getAll<T>(store: string): Promise<T[]> { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()) as Promise<T[]>; }
export async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>; }
export async function put(store: string, value: unknown): Promise<void> { const d = await open(); await req(d.transaction(store, 'readwrite').objectStore(store).put(value)); }
/** Insert into an auto-increment table (no id given). */
export async function add(store: string, value: unknown): Promise<void> { const d = await open(); await req(d.transaction(store, 'readwrite').objectStore(store).add(value)); }
export async function del(store: string, key: IDBValidKey): Promise<void> { const d = await open(); await req(d.transaction(store, 'readwrite').objectStore(store).delete(key)); }
export async function clear(store: string): Promise<void> { const d = await open(); await req(d.transaction(store, 'readwrite').objectStore(store).clear()); }

/** Backup: every table, plus the small settings kept in localStorage (gt_* keys: set list, input, prefs). */
export async function exportAll(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { _app: 'guitar-trainer', _exported_at: new Date().toISOString() };
  for (const s of STORES) out[s] = await getAll(s);
  const local: Record<string, string> = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('gt_') && k !== 'gt_session') local[k] = localStorage.getItem(k)!; } } catch { /* ignore */ }
  out._local = local;
  return out;
}
export async function importAll(data: Record<string, unknown>) {
  if (!data || typeof data !== 'object' || !STORES.some(s => Array.isArray(data[s]))) throw new Error('This doesn’t look like a Guitar Trainer backup.');
  for (const s of STORES) { const rows = data[s]; if (!Array.isArray(rows)) continue; await clear(s); for (const row of rows) await put(s, row); }
  const local = data._local as Record<string, string> | undefined;
  if (local) try { for (const [k, v] of Object.entries(local)) if (k.startsWith('gt_')) localStorage.setItem(k, v); } catch { /* ignore */ }
}
function backupFile(data: unknown): File {
  const n = new Date(), name = `guitar-trainer-backup-${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}.json`;
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}
const stamp = () => { try { localStorage.setItem('gt_last_backup', JSON.stringify(Date.now())); } catch { /* ignore */ } };
/** Save the backup as a .json file (Downloads on the phone). */
export async function downloadBackup(): Promise<string> {
  const f = backupFile(await exportAll());
  const url = URL.createObjectURL(f);
  const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  stamp();
  return f.name;
}
/** Can this phone hand a file to the share sheet (Drive, Gmail…)? */
export function canShareBackup(): boolean {
  try { return !!navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }); } catch { return false; }
}
/** Open the share sheet with the backup file (pick Drive to keep it safe). Falls back to a download. */
export async function shareBackup(): Promise<{ name: string; how: 'shared' | 'downloaded' | 'cancelled' }> {
  const f = backupFile(await exportAll());
  if (canShareBackup()) {
    try { await navigator.share({ files: [f], title: 'Guitar Trainer backup' }); stamp(); return { name: f.name, how: 'shared' }; }
    catch (e) { if ((e as Error).name === 'AbortError') return { name: f.name, how: 'cancelled' }; }
  }
  return { name: await downloadBackup(), how: 'downloaded' };
}
