/**
 * Local intent classifier - keyword matching, nothing learned.
 *
 * Typed or spoken text becomes one of the assistant's intents by matching
 * normalised words against per-language alias lists. No model, no network,
 * no score: the first intent whose alias appears wins, in the priority order
 * below (emergency before everything, because "my truck broke down, help" is
 * an emergency question before it is a truck question).
 *
 * UNKNOWN is a real answer. Text that matches nothing is told what the
 * assistant can do rather than guessed at - a wrong confident answer at a
 * roadside is worse than "I can help with…".
 *
 * Aliases cover English, Hindi, Assamese (the reason-code languages) plus
 * common romanised Hindi ("mausam", "rasta") because that is how drivers type.
 * TRANSLATION REVIEW STATUS: hi/as aliases are unreviewed by a native
 * speaker, like every other hi/as string in this app.
 */

import type { Intent } from './assistant'

const ALIASES: readonly [Intent, readonly string[]][] = [
  ['EMERGENCY', ['emergency', 'help', 'sos', 'accident', 'police', 'ambulance', '112', 'injured', 'hurt', 'bleeding',
    'आपात', 'मदद', 'दुर्घटना', 'पुलिस', 'एम्बुलेंस', 'घायल', 'madad', 'durghatna',
    'জৰুৰী', 'সহায়', 'দুৰ্ঘটনা', 'আৰক্ষী', 'এম্বুলেন্স']],
  ['VEHICLE_ISSUE', ['truck', 'tyre', 'tire', 'puncture', 'breakdown', 'broke', 'engine', 'brake', 'mechanic', 'repair', 'fuel', 'diesel',
    'ट्रक', 'टायर', 'पंचर', 'खराब', 'इंजन', 'ब्रेक', 'मैकेनिक', 'डीज़ल', 'gaadi', 'gadi', 'kharab',
    'ট্ৰাক', 'টায়াৰ', 'পাংচাৰ', 'বেয়া', 'ইঞ্জিন', 'ব্ৰেক', 'মেকানিক', 'ডিজেল']],
  ['LANDSLIDE', ['landslide', 'slide', 'rockfall', 'mudslide', 'slip',
    'भूस्खलन', 'चट्टान', 'bhuskhalan', 'pahad', 'pahaad',
    'ভূমিস্খলন', 'শিল']],
  ['WEATHER', ['weather', 'rain', 'raining', 'monsoon', 'storm', 'wind', 'fog', 'flood',
    'मौसम', 'बारिश', 'बरसात', 'तूफान', 'हवा', 'कोहरा', 'बाढ़', 'mausam', 'barish', 'baarish', 'toofan',
    'বতৰ', 'বৰষুণ', 'ধুমুহা', 'বতাহ', 'কুঁৱলী', 'বানপানী']],
  ['TERRAIN', ['terrain', 'hill', 'hilly', 'steep', 'slope', 'gradient', 'climb', 'mountain', 'ghat', 'elevation',
    'पहाड़ी', 'ढलान', 'चढ़ाई', 'घाट', 'chadhai', 'dhalan',
    'পাহাৰ', 'ঢাল', 'ওপৰলৈ']],
  ['ROUTE_RISK', ['risk', 'risky', 'safe', 'safety', 'danger', 'dangerous', 'hazard', 'condition', 'conditions',
    'खतरा', 'जोखिम', 'सुरक्षित', 'khatra', 'jokhim', 'surakshit',
    'বিপদ', 'আশংকা', 'সুৰক্ষিত', 'নিৰাপদ']],
  ['NEXT_STOP', ['stop', 'next stop', 'delivery', 'deliver', 'unload', 'drop', 'destination', 'where next', 'kahan',
    'पड़ाव', 'डिलीवरी', 'अगला', 'उतारना', 'agla', 'delivery kahan',
    'ষ্টপ', 'পিছৰ', 'ডেলিভাৰী', 'নমোৱা']],
  ['BREAK', ['break', 'rest', 'tired', 'sleep', 'sleepy', 'fatigue', 'pause',
    'आराम', 'थका', 'नींद', 'ब्रेक', 'aaram', 'thaka', 'neend',
    'জিৰণি', 'ভাগৰ', 'টোপনি']],
  ['CONNECTIVITY', ['online', 'offline', 'network', 'signal', 'internet', 'connection', 'connected', 'gps',
    'नेटवर्क', 'सिग्नल', 'इंटरनेट', 'ऑनलाइन', 'जीपीएस',
    'নেটৱৰ্ক', 'ছিগনেল', 'ইণ্টাৰনেট', 'অনলাইন']],
  ['TRANSLATE', ['translate', 'translation', 'speak', 'say', 'language', 'talk', 'phrase', 'how do i say',
    'अनुवाद', 'भाषा', 'बोलना', 'कैसे कहें', 'anuvad', 'bhasha', 'kaise kahe',
    'অনুবাদ', 'ভাষা', 'কেনেকৈ কওঁ']],
  ['MY_ROUTE', ['route', 'road', 'way', 'progress', 'how far', 'remaining', 'distance', 'km', 'eta', 'arrive', 'reach',
    'रास्ता', 'सड़क', 'कितना दूर', 'दूरी', 'बाकी', 'पहुँच', 'rasta', 'kitna door', 'doori',
    'পথ', 'ৰাস্তা', 'কিমান দূৰ', 'দূৰত্ব', 'বাকী']],
  ['MY_TRIP', ['trip', 'job', 'assignment', 'assigned', 'load', 'cargo', 'shipment', 'status', 'truck number', 'what am i carrying',
    'यात्रा', 'ट्रिप', 'काम', 'माल', 'सामान', 'स्थिति', 'safar', 'maal', 'saman',
    'যাত্ৰা', 'ট্ৰিপ', 'কাম', 'মাল', 'অৱস্থা']],
]

/** Lower-case, punctuation stripped, whitespace collapsed. Letters AND combining
 *  marks kept - Devanagari and Bengali vowel signs are marks, and dropping them
 *  turns every word into a different word. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyIntent(text: string): Intent {
  const norm = ` ${normalise(text)} `
  if (norm.trim() === '') return 'UNKNOWN'
  for (const [intent, aliases] of ALIASES) {
    for (const alias of aliases) {
      // Whole-word for Latin aliases, so "restaurant" is not a BREAK and
      // "slide" does not fire inside "slideshow"; substring for scripts where
      // word boundaries carry suffixes.
      const isLatin = /^[a-z0-9 ]+$/.test(alias)
      if (isLatin ? norm.includes(` ${alias} `) : norm.includes(alias)) return intent
    }
  }
  return 'UNKNOWN'
}
