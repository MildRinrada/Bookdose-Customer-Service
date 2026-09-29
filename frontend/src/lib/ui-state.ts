'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

/* Choices a person makes on a screen (filters, sort order, search text, the page of a list, a draft) survive moving
   to another screen and back, like they did before the move to Next.js. They live in memory only: a reload starts
   fresh, and switching organization clears them (resetUiState). */

const store = new Map<string, unknown>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function useUiState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [fallback] = useState(initial);
  const read = () => (store.has(key) ? (store.get(key) as T) : fallback);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = store.has(key) ? (store.get(key) as T) : fallback;
      store.set(key, typeof next === 'function' ? (next as (previous: T) => T)(previous) : next);
      emit();
    },
    [key, fallback],
  );
  return [value, set];
}

/** Forget every screen's choices, e.g. after switching to another organization. Screens are not told: each caller
    clears the query cache next and the frame reopens them from scratch, while a screen told now would redraw before
    the frame and find the workspace already gone (useWork() throws). */
export function resetUiState() {
  store.clear();
}
