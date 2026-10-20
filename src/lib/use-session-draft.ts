"use client";

/**
 * Persist a string draft in sessionStorage so a refresh keeps the user's input.
 * Same-tab updates go through an in-memory listener map (storage events only fire
 * across tabs). Server snapshot is always `initial`, so hydration stays clean.
 */
import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) fn();
}

function subscribe(key: string, onStoreChange: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onStoreChange);
  return () => {
    set!.delete(onStoreChange);
    if (set!.size === 0) listeners.delete(key);
  };
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private mode / disabled storage — keep the in-memory value via emit only.
  }
  emit(key);
}

export function useSessionDraft(
  key: string,
  initial: string,
): [string, (value: string) => void] {
  const subscribeKey = useCallback(
    (onStoreChange: () => void) => subscribe(key, onStoreChange),
    [key],
  );
  const getSnapshot = useCallback(() => read(key) ?? initial, [key, initial]);
  const getServerSnapshot = useCallback(() => initial, [initial]);

  const value = useSyncExternalStore(subscribeKey, getSnapshot, getServerSnapshot);
  const setValue = useCallback((next: string) => write(key, next), [key]);

  return [value, setValue];
}
