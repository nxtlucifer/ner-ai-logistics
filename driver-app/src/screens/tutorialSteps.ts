/**
 * What a driver is told the first time they open RASTA.
 *
 * WHY THE CONTENT IS A SEPARATE MODULE
 *
 * Every line here is a promise about how the app behaves. Keeping them in
 * one list means a test can check them against the behaviour — and it
 * catches the failure mode a tutorial invites, which is describing a
 * feature that was renamed, moved, or never shipped.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No claim that a route is safe. No promise that alerts always arrive. The
 * tutorial explains the controls; it does not make guarantees the product
 * cannot keep on a hill road with no signal.
 */

import type { IconName } from '../components/icons'

export interface TutorialStep {
  /** Stable id — persisted progress and tests refer to this, not the order. */
  id: string
  /** Feather glyph. Typed, so an invented name fails the build rather
   *  than rendering an empty square on a driver's phone. */
  icon: IconName
  title: string
  body: string
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'accept',
    icon: 'clipboard',
    title: 'Accepting a trip',
    body: 'A new job appears on the Trip page. Read the pickup and the destination, then tap Accept trip. Nothing starts moving until you do.',
  },
  {
    id: 'truck',
    icon: 'truck',
    title: 'Checking your truck',
    body: 'Before a trip can start you photograph the truck and confirm the number plate. This is what pairs you to the vehicle for the whole journey.',
  },
  {
    id: 'navigate',
    icon: 'navigation',
    title: 'Navigation',
    body: 'Navigate follows the road your manager approved. You go to the PICKUP first, then to the destination. The map shows your position and the end point.',
  },
  {
    id: 'offline',
    icon: 'wifi-off',
    title: 'When the signal drops',
    body: 'The route, the turns and the safety guidance are saved on the phone before you lose signal. The screen tells you how old that information is, so you always know what you are looking at.',
  },
  {
    id: 'alert',
    icon: 'alert-triangle',
    title: 'If the road changes',
    body: 'When your manager approves a different road, the phone tells you even if RASTA is closed. Open Navigate to follow the new one.',
  },
  {
    id: 'sos',
    icon: 'phone',
    title: 'Emergency',
    body: 'Safety has the emergency numbers, one tap each. If you must stop during a trip, use Request a stop and say why — your manager sees it immediately and can call you.',
  },
  {
    id: 'instruction',
    icon: 'message-circle',
    title: 'Instructions from your manager',
    body: 'A manager can add a stop, change the destination or ask you to hold. You will be asked to confirm you have read it, so nobody assumes you saw something you did not.',
  },
  {
    id: 'delivery',
    icon: 'check-circle',
    title: 'Arriving and delivering',
    body: 'Arrival and delivery both ask you to confirm twice. That is on purpose: one stray tap should not close a trip.',
  },
  {
    id: 'language',
    icon: 'globe',
    title: 'Your language',
    body: 'More → Language changes the app. You can also type a question to the assistant in your own language and it will answer in the one you chose.',
  },
  {
    id: 'privacy',
    icon: 'map-pin',
    title: 'Your location',
    body: 'Your position is shared with your manager while a trip is running, so they can help if something goes wrong. The app says GPS, NETWORK or LAST KNOWN so you can see which one it is using.',
  },
] as const

/** Storage key for "this driver has seen the tutorial". */
export const TUTORIAL_SEEN_KEY = '@ner_driver_tutorial_seen'
