/**
 * ONE profile-photo source for every avatar (header, More, My details).
 *
 * Each screen used to fetch `/me/profile` for itself, so the header could
 * show initials while My details showed the photo it had just uploaded. The
 * URL now lives here; whoever learns it (a profile load, a photo upload)
 * publishes it and every avatar re-renders from the same value.
 */

import { useSyncExternalStore } from 'react'

import { api } from '../api/client'

let url: string | null = null
const listeners = new Set<() => void>()

export function setProfilePhotoUrl(next: string | null): void {
  if (next === url) return
  url = next
  listeners.forEach((l) => l())
}

/** Re-read the profile; a failure keeps whatever was known. */
export function refreshProfilePhoto(): void {
  api.myProfile().then((p) => setProfilePhotoUrl(p.photo_url)).catch(() => {})
}

export function useProfilePhotoUrl(): string | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => url,
    () => url,
  )
}
