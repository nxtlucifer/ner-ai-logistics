/**
 * Where "I stopped for a break" is remembered.
 *
 * Local only, and deliberately so for now: there is no backend field for a
 * break, and inventing one would mean a schema change against a shared
 * database. The consequence is stated rather than hidden - a manager cannot
 * see break status, so this is driver-facing guidance and nothing else. When a
 * break becomes a real domain event, this module is the seam to replace.
 *
 * Kept apart from `breaks.ts` so that module stays pure: the scoring logic has
 * no platform imports and is tested without mocking storage.
 *
 * EVERY PATH SWALLOWS STORAGE FAILURE
 *
 * A full disk, a cleared app, a web build with localStorage disabled - none of
 * them may take down the safety screen. A missing break record degrades to
 * "measure from the trip start", which is the conservative direction: it can
 * only ever report MORE elapsed time, never less.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

/** Minimal shape, so tests need no native module. */
export interface KeyValue {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export const BREAK_KEY = 'ner.safety.lastBreakAt'

/** ISO timestamp of the last recorded break, or null if there is none. */
export async function readLastBreak(kv: KeyValue = AsyncStorage): Promise<string | null> {
  try {
    return await kv.getItem(BREAK_KEY)
  } catch {
    return null
  }
}

/**
 * Record a break at `when`.
 *
 * Returns whether it was actually stored, so the screen can avoid telling a
 * driver their break was logged when it was not.
 */
export async function recordBreak(
  when: Date,
  kv: KeyValue = AsyncStorage,
): Promise<boolean> {
  try {
    await kv.setItem(BREAK_KEY, when.toISOString())
    return true
  } catch {
    return false
  }
}
