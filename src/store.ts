import { useSyncExternalStore } from 'react';
import type { SimState } from './types';

export class SimStore {
  private state: SimState;
  private listeners = new Set<() => void>();

  constructor(initial: SimState) {
    this.state = initial;
  }

  getSnapshot = (): SimState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replace state. Pass silent:true to skip notifying React subscribers (e.g. the cosmetic clock tick). */
  set(next: SimState, opts?: { silent?: boolean }): void {
    this.state = next;
    if (!opts?.silent) this.listeners.forEach(listener => listener());
  }
}

export function useSimState(store: SimStore): SimState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
