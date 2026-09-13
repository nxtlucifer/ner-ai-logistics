/**
 * Remote push registration - the half of alerting that works with the screen
 * off. The backend (services/notify.py) sends through Expo; this file hands it
 * the phone's token once per sign-in and routes a tapped notification to the
 * screen it names.
 *
 * HONEST STATES (returned, never hidden):
 *   REGISTERED   token stored on the backend
 *   DENIED       the driver refused the notification permission
 *   UNAVAILABLE  web, or no push credential in this build - Android needs
 *                google-services.json (FCM) for Expo push tokens; without it
 *                getExpoPushTokenAsync throws and in-app cards remain the alert
 *   FAILED       backend refused / offline; retried on the next sign-in
 */

import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { api } from '../api/client'
import { ensurePermission } from './local'

export type PushStatus = 'REGISTERED' | 'DENIED' | 'UNAVAILABLE' | 'FAILED'

let registered: string | null = null

export async function registerPush(): Promise<{ status: PushStatus; reason?: string }> {
  if (Platform.OS === 'web') return { status: 'UNAVAILABLE', reason: 'web' }
  if (!(await ensurePermission())) return { status: 'DENIED' }
  const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId
  let token: string
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Trip and hazard alerts',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      })
    }
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
  } catch (e) {
    return { status: 'UNAVAILABLE', reason: e instanceof Error ? e.message : 'no push credential' }
  }
  if (token === registered) return { status: 'REGISTERED' }
  try {
    await api.registerPushToken(token)
    registered = token
    return { status: 'REGISTERED' }
  } catch (e) {
    return { status: 'FAILED', reason: e instanceof Error ? e.message : 'backend' }
  }
}

/** The screen a tapped notification asks for (`data.screen`), else null. */
export function screenFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const screen = response?.notification.request.content.data?.screen
  return typeof screen === 'string' ? screen : null
}
