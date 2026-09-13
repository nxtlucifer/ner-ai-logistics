/**
 * Localise a visible English string, with an EXPLICIT English fallback.
 *
 * `t(lang, key)` in appLanguage.ts is the typed table for the screens that
 * were built with keys. Everything else on screen was English literals, and
 * the honest way to put them under localisation without inventing a key
 * per sentence is to key on the English itself: `tx(lang, 'No active trip')`.
 * A phrase with a translation renders it; a phrase without one renders the
 * English it was given - by design, visibly, never a blank or a code.
 *
 * LOCALE STATUS - do not overclaim:
 *   en  VERIFIED          the source language
 *   hi  PARTIAL           drafted here, NOT reviewed by a native speaker
 *   as  PARTIAL           drafted here, NOT reviewed by a native speaker
 *   gu  FALLBACK_ENGLISH  only the 57 typed keys have Gujarati; phrases fall back
 *   bn  FALLBACK_ENGLISH  only the 57 typed keys have Bengali; phrases fall back
 */

import type { AppLanguage } from './appLanguage'
import { useAppLanguage } from './AppLanguageProvider'

export type LocaleStatus = 'VERIFIED' | 'PARTIAL' | 'FALLBACK_ENGLISH'
export const LOCALE_STATUS: Record<AppLanguage, LocaleStatus> = {
  en: 'VERIFIED', hi: 'PARTIAL', as: 'PARTIAL', gu: 'FALLBACK_ENGLISH', bn: 'FALLBACK_ENGLISH',
}

type Phrase = Partial<Record<Exclude<AppLanguage, 'en'>, string>>

/** English -> translations. Absent = English fallback. */
export const PHRASES: Record<string, Phrase> = {
  // Trip page
  'No active trip': { hi: 'कोई सक्रिय ट्रिप नहीं', as: 'কোনো সক্ৰিয় ট্ৰিপ নাই' },
  'You are available for assignment. Your next assigned trip will appear here automatically.': {
    hi: 'आप असाइनमेंट के लिए उपलब्ध हैं। आपकी अगली ट्रिप यहाँ अपने आप दिखेगी।',
    as: 'আপুনি এছাইনমেণ্টৰ বাবে উপলব্ধ। আপোনাৰ পৰৱৰ্তী ট্ৰিপ ইয়াত নিজে দেখা যাব।',
  },
  'Open map': { hi: 'नक्शा खोलें', as: 'মানচিত্ৰ খোলক' },
  'Check again': { hi: 'फिर से देखें', as: 'পুনৰ চাওক' },
  'You': { hi: 'आप', as: 'আপুনি' },
  'Driver': { hi: 'ड्राइवर', as: 'চালক' },
  'Truck': { hi: 'ट्रक', as: 'ট্ৰাক' },
  'Connection': { hi: 'कनेक्शन', as: 'সংযোগ' },
  'Last sync': { hi: 'आख़िरी सिंक', as: 'শেষ ছিংক' },
  'Connected': { hi: 'जुड़ा हुआ', as: 'সংযুক্ত' },
  'Reconnecting — showing last sync': { hi: 'फिर से जुड़ रहा है — आख़िरी सिंक दिखा रहा है', as: 'পুনৰ সংযোগ হৈছে — শেষ ছিংক দেখুৱাইছে' },
  'No truck assigned': { hi: 'कोई ट्रक असाइन नहीं', as: 'কোনো ট্ৰাক এছাইন কৰা নাই' },
  'verified': { hi: 'सत्यापित', as: 'সত্যাপিত' },
  'not verified': { hi: 'असत्यापित', as: 'সত্যাপন কৰা নাই' },
  'Check the truck': { hi: 'ट्रक जाँचें', as: 'ট্ৰাক পৰীক্ষা কৰক' },
  'Emergency numbers': { hi: 'आपातकालीन नंबर', as: 'জৰুৰীকালীন নম্বৰ' },
  'Tap to open the dialler': { hi: 'डायलर खोलने के लिए टैप करें', as: 'ডায়েলাৰ খুলিবলৈ টিপক' },
  'New trip request': { hi: 'नई ट्रिप का अनुरोध', as: 'নতুন ট্ৰিপৰ অনুৰোধ' },
  'Accept trip': { hi: 'ट्रिप स्वीकार करें', as: 'ট্ৰিপ গ্ৰহণ কৰক' },
  'Accepted': { hi: 'स्वीकृत', as: 'গৃহীত' },
  'Start trip': { hi: 'ट्रिप शुरू करें', as: 'ট্ৰিপ আৰম্ভ কৰক' },
  'Resume navigation': { hi: 'नेविगेशन जारी रखें', as: 'নেভিগেছন পুনৰ আৰম্ভ কৰক' },
  'Complete trip': { hi: 'ट्रिप पूरी करें', as: 'ট্ৰিপ সম্পূৰ্ণ কৰক' },
  'Cannot start yet': { hi: 'अभी शुरू नहीं कर सकते', as: 'এতিয়াই আৰম্ভ কৰিব নোৱাৰি' },
  'CURRENT TRIP': { hi: 'वर्तमान ट्रिप', as: 'বৰ্তমান ট্ৰিপ' },
  'PICKUP': { hi: 'पिकअप', as: 'পিকআপ' },
  'DESTINATION': { hi: 'गंतव्य', as: 'গন্তব্য' },
  'ROUTE': { hi: 'मार्ग', as: 'পথ' },
  'REMAINING': { hi: 'शेष', as: 'বাকী' },
  'Unavailable': { hi: 'उपलब्ध नहीं', as: 'উপলব্ধ নহয়' },
  'Loading your trip…': { hi: 'आपकी ट्रिप लोड हो रही है…', as: 'আপোনাৰ ট্ৰিপ ল\'ড হৈ আছে…' },
  'Try again': { hi: 'फिर कोशिश करें', as: 'পুনৰ চেষ্টা কৰক' },
  'Not up to date': { hi: 'अद्यतन नहीं', as: 'আপডেট নহয়' },
  'Trip complete': { hi: 'ट्रिप पूरी', as: 'ট্ৰিপ সম্পূৰ্ণ' },
  'Off the planned route': { hi: 'योजना बनाए मार्ग से बाहर', as: 'পৰিকল্পিত পথৰ বাহিৰত' },
  // Map page
  'Browsing the map': { hi: 'नक्शा देख रहे हैं', as: 'মানচিত্ৰ চাই আছে' },
  'No trip right now · search, terrain and SOS still work': { hi: 'अभी कोई ट्रिप नहीं · खोज, भूभाग और SOS काम करते हैं', as: 'এতিয়া কোনো ট্ৰিপ নাই · সন্ধান, ভূখণ্ড আৰু SOS কাম কৰে' },
  'Route not selected': { hi: 'मार्ग चुना नहीं गया', as: 'পথ বাছনি কৰা নাই' },
  'Your manager assigns the road first': { hi: 'पहले आपका मैनेजर सड़क तय करता है', as: 'প্ৰথমে আপোনাৰ মেনেজাৰে পথ নিৰ্ধাৰণ কৰে' },
  'Re-centre': { hi: 'केंद्र में लाएँ', as: 'কেন্দ্ৰলৈ আনক' },
  'Allow location': { hi: 'लोकेशन की अनुमति दें', as: 'অৱস্থানৰ অনুমতি দিয়ক' },
  'No GPS fix': { hi: 'GPS फिक्स नहीं', as: 'GPS ফিক্স নাই' },
  'SERVICES': { hi: 'सेवाएँ', as: 'সেৱা' },
  'HIDE': { hi: 'छिपाएँ', as: 'লুকুৱাওক' },
  'DETAILS': { hi: 'विवरण', as: 'বিৱৰণ' },
  'duration': { hi: 'अवधि', as: 'সময়সীমা' },
  'remaining': { hi: 'शेष', as: 'বাকী' },
  'arrival': { hi: 'आगमन', as: 'আগমন' },
  'no route': { hi: 'कोई मार्ग नहीं', as: 'পথ নাই' },
  'no trip': { hi: 'कोई ट्रिप नहीं', as: 'ট্ৰিপ নাই' },
  'location': { hi: 'लोकेशन', as: 'অৱস্থান' },
  'Emergency': { hi: 'आपातकाल', as: 'জৰুৰীকালীন' },
  'Tapping a number opens your dialler. You still press call.': { hi: 'नंबर टैप करने से डायलर खुलता है। कॉल आप ही दबाते हैं।', as: 'নম্বৰ টিপিলে ডায়েলাৰ খোলে। কল আপুনিয়ে টিপিব।' },
  'Cancel': { hi: 'रद्द करें', as: 'বাতিল কৰক' },
  'Roadside services': { hi: 'सड़क किनारे सेवाएँ', as: 'পথৰ কাষৰ সেৱা' },
  'Evidence': { hi: 'प्रमाण', as: 'প্ৰমাণ' },
  // Truck check
  'Your truck': { hi: 'आपका ट्रक', as: 'আপোনাৰ ট্ৰাক' },
  'Registration on the truck': { hi: 'ट्रक पर लिखा रजिस्ट्रेशन', as: 'ট্ৰাকত থকা ৰেজিষ্ট্ৰেচন' },
  'Truck photo': { hi: 'ट्रक की फोटो', as: 'ট্ৰাকৰ ফটো' },
  'Take photo': { hi: 'फोटो लें', as: 'ফটো তোলক' },
  'Choose image': { hi: 'इमेज चुनें', as: 'ছবি বাছক' },
  'Photo uploaded': { hi: 'फोटो अपलोड हो गई', as: 'ফটো আপল\'ড হ\'ল' },
  'Take a photo of the truck before you verify.': { hi: 'सत्यापन से पहले ट्रक की फोटो लें।', as: 'সত্যাপনৰ আগতে ট্ৰাকৰ ফটো তোলক।' },
  'Truck verified': { hi: 'ट्रक सत्यापित', as: 'ট্ৰাক সত্যাপিত' },
  'Upload requires connection': { hi: 'अपलोड के लिए कनेक्शन चाहिए', as: 'আপল\'ডৰ বাবে সংযোগ লাগে' },
  // More / My details
  'My details': { hi: 'मेरा विवरण', as: 'মোৰ বিৱৰণ' },
  'Profile, documents and insurance': { hi: 'प्रोफ़ाइल, दस्तावेज़ और बीमा', as: 'প্ৰ\'ফাইল, নথি আৰু বীমা' },
  'Documents': { hi: 'दस्तावेज़', as: 'নথিপত্ৰ' },
  'Insurance': { hi: 'बीमा', as: 'বীমা' },
  'Add document': { hi: 'दस्तावेज़ जोड़ें', as: 'নথি যোগ কৰক' },
  'Add insurance': { hi: 'बीमा जोड़ें', as: 'বীমা যোগ কৰক' },
  'Driving Licence': { hi: 'ड्राइविंग लाइसेंस', as: 'ড্ৰাইভিং লাইচেন্স' },
  'Government ID': { hi: 'सरकारी पहचान पत्र', as: 'চৰকাৰী পৰিচয়পত্ৰ' },
  'Other': { hi: 'अन्य', as: 'অন্য' },
  'Document number': { hi: 'दस्तावेज़ संख्या', as: 'নথিৰ নম্বৰ' },
  'Policy number': { hi: 'पॉलिसी संख्या', as: 'পলিচি নম্বৰ' },
  'Issue date': { hi: 'जारी करने की तारीख', as: 'জাৰি কৰা তাৰিখ' },
  'Expiry date': { hi: 'समाप्ति तिथि', as: 'ম্যাদ শেষ হোৱাৰ তাৰিখ' },
  'Valid until': { hi: 'तक मान्य', as: 'লৈকে বৈধ' },
  'Save': { hi: 'सहेजें', as: 'সংৰক্ষণ কৰক' },
  'Phone': { hi: 'फ़ोन', as: 'ফ\'ন' },
  'Driver ID': { hi: 'ड्राइवर आईडी', as: 'চালক আইডি' },
  'Emergency contact': { hi: 'आपातकालीन संपर्क', as: 'জৰুৰীকালীন যোগাযোগ' },
  'Change photo': { hi: 'फोटो बदलें', as: 'ফটো সলনি কৰক' },
  'Not provided': { hi: 'नहीं दिया गया', as: 'দিয়া হোৱা নাই' },
  'No documents yet': { hi: 'अभी कोई दस्तावेज़ नहीं', as: 'এতিয়ালৈকে কোনো নথি নাই' },
  'No insurance on file': { hi: 'कोई बीमा दर्ज नहीं', as: 'কোনো বীমা নথিভুক্ত নাই' },
  'Attach image or PDF': { hi: 'इमेज या PDF जोड़ें', as: 'ছবি বা PDF সংলগ্ন কৰক' },
  'Language': { hi: 'भाषा', as: 'ভাষা' },
  // Login
  'Secure driver access': { hi: 'सुरक्षित ड्राइवर पहुँच', as: 'সুৰক্ষিত চালক প্ৰৱেশ' },
  'Need access? Contact your fleet manager — driver accounts and passwords are managed by dispatch.': { hi: 'पहुँच चाहिए? अपने फ्लीट मैनेजर से संपर्क करें — ड्राइवर खाते और पासवर्ड डिस्पैच द्वारा संभाले जाते हैं।', as: 'প্ৰৱেশ লাগে? আপোনাৰ ফ্লীট মেনেজাৰৰ সৈতে যোগাযোগ কৰক — চালকৰ একাউণ্ট আৰু পাছৱৰ্ড ডিচপেচে পৰিচালনা কৰে।' },
  'Theme': { hi: 'थीम', as: 'থীম' },
}

export function tx(lang: AppLanguage, en: string): string {
  if (lang === 'en') return en
  return PHRASES[en]?.[lang] ?? en
}

/** `const t = useT(); t('No active trip')` - the app language, English fallback. */
export function useT(): (en: string) => string {
  const { language } = useAppLanguage()
  return (en) => tx(language, en)
}
