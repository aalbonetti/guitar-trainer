// Tiny observable store + a Preact hook to subscribe to it.
import { useEffect, useRef, useState } from 'preact/hooks';

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
  // Re-read after subscribing: the store may have changed between render and this effect
  // (e.g. loadProgress() finishing on app start), and that change would otherwise be missed.
  useEffect(() => { const off = s.subscribe(setV); setV(s.get()); return off; }, [s]);
  return v;
}

/** Subscribe to one derived value: the component re-renders only when it changes (Object.is).
 *  The selector must return a primitive or a reference already held in the store, never a new object. */
export function useSelect<T extends object, R>(s: Store<T>, selector: (v: T) => R): R {
  const sel = useRef(selector); sel.current = selector;
  const [, bump] = useState(0);
  const value = selector(s.get());
  const shown = useRef(value); shown.current = value;
  useEffect(() => {
    const check = (v: T) => { const next = sel.current(v); if (!Object.is(next, shown.current)) { shown.current = next; bump(x => x + 1); } };
    const off = s.subscribe(check); check(s.get()); return off; // check: it may have changed before this effect ran
  }, [s]);
  return value;
}

// Small persisted settings (localStorage; IndexedDB arrives with progress tracking in M3).
export function persisted<T>(key: string, fallback: T): { get(): T; set(v: T): void } {
  return {
    get() { try { const r = localStorage.getItem(key); return r === null ? fallback : JSON.parse(r); } catch { return fallback; } },
    set(v: T) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
}
