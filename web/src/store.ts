// Tiny observable store + a Preact hook to subscribe to it.
import { useEffect, useState } from 'preact/hooks';

export class Store<T extends object> {
  private v: T;
  private subs = new Set<(v: T) => void>();
  constructor(v: T) { this.v = v; }
  get(): T { return this.v; }
  set(p: Partial<T>) { this.v = { ...this.v, ...p }; this.subs.forEach(f => f(this.v)); }
  subscribe(f: (v: T) => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
}

export function useStore<T extends object>(s: Store<T>): T {
  const [v, setV] = useState(s.get());
  useEffect(() => s.subscribe(setV), [s]);
  return v;
}

// Small persisted settings (localStorage; IndexedDB arrives with progress tracking in M3).
export function persisted<T>(key: string, fallback: T): { get(): T; set(v: T): void } {
  return {
    get() { try { const r = localStorage.getItem(key); return r === null ? fallback : JSON.parse(r); } catch { return fallback; } },
    set(v: T) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
}
