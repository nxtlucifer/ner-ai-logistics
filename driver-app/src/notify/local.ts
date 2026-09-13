/**
 * Local notifications for the moments a driver must not miss while the app
 * is in the background: a trip assigned, a reroute approved, a danger card
 * that appeared, a hold decision. NOT a push system - the app's own polls
 * decide; this only surfaces what they already found when the screen is not
 * in front of the driver.
 *
 * RULES
 *   foreground  -> nothing here; the in-app card / trip page IS the alert
 *   background  -> one notification per KEY, then a cooldown per key
 *   dedupe      -> a key seen within COOLDOWN_MS is silent, so a poll every
 *                  10 s cannot repeat an alert
 *   wording     -> comes from the caller, which already words evidence
 *                  honestly ("High historical landslide exposure ahead",
 *                  never "landslide detected")
 *
 * Remote push (Expo push / FCM) is NOT wired: no push credential exists in
 * this project and none is pretended. REMOTE_PUSH_NOTIFICATION_READY = BLOCKED.
 */

import * as Notifications from 'expo-notifications'
import { AppState, Platform } from 'react-native'

export const COOLDOWN_MS = 10 * 60_000

const lastSent = new Map<string, number>()
let permissionAsked = false

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/** Ask once, when a trip first exists. Denied = the in-app cards still work. */
export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  if (permissionAsked) return (await Notifications.getPermissionsAsync()).granted
  permissionAsked = true
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  const asked = await Notifications.requestPermissionsAsync()
  return asked.granted
}

/** Pure: should `key` fire now? Exported for the test. */
export function shouldFire(key: string, now: number, sent: Map<string, number> = lastSent): boolean {
  const last = sent.get(key)
  if (last !== undefined && now - last < COOLDOWN_MS) return false
  sent.set(key, now)
  return true
}

/**
 * Notify if the app is NOT in the foreground and the key has not fired lately.
 * Returns true when a notification was scheduled.
 */
export async function notifyInBackground(key: string, title: string, body: string): Promise<boolean> {
  if (Platform.OS === 'web') return false
  if (AppState.currentState === 'active') return false
  if (!shouldFire(key, Date.now())) return false
  try {
    if (!(await ensurePermission())) return false
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null })
    return true
  } catch {
    return false
  }
}
