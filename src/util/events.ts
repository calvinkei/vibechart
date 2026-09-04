/** Minimal typed event emitter (zero dependencies). */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private _listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this._listeners.get(event)?.delete(fn);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[vibechart] listener for "${String(event)}" threw`, e);
      }
    }
  }

  hasListeners(event: keyof Events): boolean {
    return (this._listeners.get(event)?.size ?? 0) > 0;
  }

  clear(): void {
    this._listeners.clear();
  }
}

/** Simple single-purpose delegate (subscribe/fire). */
export class Delegate<T = void> {
  private _fns: Array<Listener<T>> = [];
  subscribe(fn: Listener<T>): () => void {
    this._fns.push(fn);
    return () => this.unsubscribe(fn);
  }
  unsubscribe(fn: Listener<T>): void {
    const i = this._fns.indexOf(fn);
    if (i >= 0) this._fns.splice(i, 1);
  }
  fire(payload: T): void {
    for (const fn of this._fns.slice()) fn(payload);
  }
  get size(): number {
    return this._fns.length;
  }
}
