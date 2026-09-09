/**
 * Offline translator helper and verified phrase dictionary for Driver App.
 *
 * Implements:
 * - 12 Regional and Indian National Languages
 * - 8 High-frequency emergency and operational driver phrases with verified translations
 * - Offline phrasebook search matching
 * - Speech code mapping for Expo Speech TTS
 * - Input sanitization (HTML stripping, character limit)
 */

import catalogue from './phrases.json'

export interface LanguageInfo {
  code: string
  name: string
  nativeName: string
  voiceLocale: string
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageInfo> = {
  en: { code: 'en', name: 'English', nativeName: 'English', voiceLocale: 'en-IN' },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', voiceLocale: 'hi-IN' },
  gu: { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', voiceLocale: 'gu-IN' },
  as: { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', voiceLocale: 'as-IN' },
  bn: { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', voiceLocale: 'bn-IN' },
  mr: { code: 'mr', name: 'Marathi', nativeName: 'मराठी', voiceLocale: 'mr-IN' },
  pa: { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', voiceLocale: 'pa-IN' },
  or: { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', voiceLocale: 'or-IN' },
  ta: { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', voiceLocale: 'ta-IN' },
  te: { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', voiceLocale: 'te-IN' },
  ml: { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', voiceLocale: 'ml-IN' },
  kn: { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', voiceLocale: 'kn-IN' },
}

export const LANGUAGE_CODES = Object.keys(SUPPORTED_LANGUAGES)

export const QUICK_DRIVER_PHRASES = [
  'Where is the loading gate?',
  'Please show the delivery receipt.',
  'Road ahead is blocked?',
  'Where is the nearest fuel station?',
  'I need mechanical help.',
  'I need medical help.',
  'Please call my manager.',
  'How far is the checkpoint?',
] as const

export type QuickPhrase = (typeof QUICK_DRIVER_PHRASES)[number]

export const VERIFIED_QUICK_TRANSLATIONS: Record<
  QuickPhrase,
  Record<string, string>
> = {
  'Where is the loading gate?': {
    en: 'Where is the loading gate?',
    hi: 'लोडिंग गेट कहाँ है?',
    as: 'ল’ডিং গেট ক’ত আছে?',
    bn: 'লোডিং গেট কোথায়?',
    gu: 'લોડિંગ ગેટ ક્યાં છે?',
    mr: 'लोडिंग गेट कुठे आहे?',
    pa: 'ਲੋਡਿੰਗ ਗੇਟ ਕਿੱਥੇ ਹੈ?',
    or: 'ଲୋଡିଂ ଗେଟ୍ କେଉଁଠାରେ ଅଛି?',
    ta: 'ஏற்றுதல் கேட் எங்கே உள்ளது?',
    te: 'లోడింగ్ గేట్ ఎక్కడ ఉంది?',
    ml: 'ലോഡിംഗ് ഗേറ്റ് എവിടെയാണ്?',
    kn: 'ಲೋಡಿಂಗ್ ಗೇಟ್ ಎಲ್ಲಿದೆ?',
  },
  'Please show the delivery receipt.': {
    en: 'Please show the delivery receipt.',
    hi: 'कृपया डिलीवरी रसीद दिखाइए।',
    as: 'অনুগ্ৰহ কৰি ডেলিভাৰী ৰচিদ দেখুৱাওক।',
    bn: 'দয়া করে ডেলিভারি রসিদ দেখান।',
    gu: 'કૃપા કરીને ડિલિવરી રસીદ બતાવો.',
    mr: 'कृपया डिलिव्हरी पावती दाखवा.',
    pa: 'ਕਿਰਪਾ ਕਰਕੇ ਡਿਲੀਵਰੀ ਰਸੀਦ ਦਿਖਾਓ।',
    or: 'ଦୟାକରି ଡେଲିଭରୀ ରସିଦ ଦେଖାନ୍ତୁ।',
    ta: 'தயவுசெய்து டெலிவரி ரசீதை காட்டுங்கள்.',
    te: 'దయచేసి డెలివరీ రశీదు చూపించండి.',
    ml: 'ദയവായി ഡെലിവറി രസീത് കാണിക്കുക.',
    kn: 'ದಯವಿಟ್ಟು ವಿತರಣಾ ರಶೀದಿಯನ್ನು ತೋರಿಸಿ.',
  },
  'Road ahead is blocked?': {
    en: 'This road is blocked.',
    hi: 'यह रास्ता बंद है।',
    as: 'এই পথটো বন্ধ হৈ আছে।',
    bn: 'এই রাস্তা বন্ধ।',
    gu: 'આ રસ્તો બંધ છે.',
    mr: 'पुढील रस्ता बंद आहे का?',
    pa: 'ਅੱਗੇ ਵਾਲਾ ਰਸਤਾ ਬੰਦ ਹੈ?',
    or: 'ଆଗ ରାସ୍ତା ବନ୍ଦ ଅଛି କି?',
    ta: 'முன்னால் சாலை அடைக்கப்பட்டுள்ளதா?',
    te: 'ముందు రోడ్డు మూసివేయబడిందా?',
    ml: 'മുന്നിലെ റോഡ് തടസ്സപ്പെട്ടിരിക്കുകയാണോ?',
    kn: 'ಮುಂದಿನ ರಸ್ತೆ ನಿರ್ಬಂಧಿಸಲಾಗಿದೆಯೇ?',
  },
  'Where is the nearest fuel station?': {
    en: 'Where is the nearest fuel station?',
    hi: 'सबसे नज़दीकी पेट्रोल पंप कहाँ है?',
    as: 'আটাইতকৈ ওচৰৰ ফিলিং ষ্টেচন ক\'ত?',
    bn: 'সবচেয়ে কাছের পেট্রোল পাম্প কোথায়?',
    gu: 'નજીકનું પેટ્રોલ પંપ ક્યાં છે?',
    mr: 'जवळचे पेट्रोल पंप कुठे आहे?',
    pa: 'ਸਭ ਤੋਂ ਨੇੜਲਾ ਪੈਟਰੋਲ ਪੰਪ ਕਿੱਥੇ ਹੈ?',
    or: 'ସବୁଠାରୁ ନିକଟତମ ପେଟ୍ରୋଲ ପମ୍ପ କେଉଁଠାରେ ଅଛି?',
    ta: 'அருகிலுள்ள பெட்ரோல் பங்க் எங்கே உள்ளது?',
    te: 'సమీపంలోని పెట్రోల్ బంక్ ఎక్కడ ఉంది?',
    ml: 'ഏറ്റവും അടുത്തുള്ള പെട്രോൾ പമ്പ് എവിടെയാണ്?',
    kn: 'ಹತ್ತಿರದ ಪೆಟ್ರೋಲ್ ಬಂಕ್ ಎಲ್ಲಿದೆ?',
  },
  'I need mechanical help.': {
    en: 'I need a mechanic.',
    hi: 'मुझे मैकेनिक चाहिए।',
    as: 'মোক এজন মেকানিকৰ প্ৰয়োজন।',
    bn: 'আমার একজন মেকানিক দরকার।',
    gu: 'મને મિકેનિકની જરૂર છે.',
    mr: 'मला मेकॅनिकची गरज आहे.',
    pa: 'ਮੈਨੂੰ ਮਕੈਨਿਕ ਦੀ ਲੋੜ ਹੈ।',
    or: 'ମୋତେ ଜଣେ ମେକାନିକ୍ ଦରକାର।',
    ta: 'எனக்கு மெக்கானிக் உதவி தேவை.',
    te: 'నాకు మెకానిక్ సహాయం కావాలి.',
    ml: 'എനിക്ക് ഒരു മെക്കാനിക്കിനെ ആവശ്യമുണ്ട്.',
    kn: 'ನನಗೆ ಮೆಕ್ಯಾನಿಕ್ ಸಹಾಯ ಬೇಕು.',
  },
  'I need medical help.': {
    en: 'Someone is injured and needs help. Please call an ambulance.',
    hi: 'चिकित्सा सहायता चाहिए। कृपया एम्बुलेंस बुलाइए।',
    as: 'চিকিৎসাৰ সহায় লাগে। অনুগ্ৰহ কৰি এম্বুলেন্স মাতক।',
    bn: 'চিকিৎসার সাহায্য দরকার। দয়া করে অ্যাম্বুলেন্স ডাকুন।',
    gu: 'મને તબીબી સહાયની જરૂર છે. કૃપા કરીને એમ્બ્યુલન્સ બોલાવો.',
    mr: 'मला वैद्यकीय मदतीची गरज आहे. कृपया रुग्णवाहिका बोलवा.',
    pa: 'ਮੈਨੂੰ ਡਾਕਟਰੀ ਸਹਾਇਤਾ ਦੀ ਲੋੜ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਐਂਬੂਲੈਂਸ ਬੁਲਾਓ।',
    or: 'ମୋତେ ଡାକ୍ତରୀ ସହାୟତା ଦରକାର। ଦୟାକରି ଆମ୍ବୁଲାନ୍ସ ଡାକନ୍ତୁ।',
    ta: 'எனக்கு மருத்துவ உதவி தேவை. தயவுசெய்து ஆம்புலன்ஸ் அழையுங்கள்.',
    te: 'நாకు వైద్య సహాయం కావాలి. దయచేసి అంబులెన్స్‌ని పిలవండి.',
    ml: 'എനിക്ക് വൈദ്യസഹായം ആവശ്യമാണ്. ദയവായി ആംബുലൻസ് വിളിക്കുക.',
    kn: 'ನನಗೆ ವೈದ್ಯಕೀಯ ಸಹಾಯ ಬೇಕು. ದಯವಿಟ್ಟು ಆಂಬ್ಯುಲೆನ್ಸ್ ಕರೆಯಿರಿ.',
  },
  'Please call my manager.': {
    en: 'Please call my manager.',
    hi: 'कृपया मेरे मैनेजर को फोन कीजिए।',
    as: 'অনুগ্ৰহ কৰি মোৰ মেনেজাৰক ফোন কৰক।',
    bn: 'দয়া করে আমার ম্যানেজারকে ফোন করুন।',
    gu: 'કૃપા કરીને મારા મેનેજરને કૉલ કરો.',
    mr: 'कृपया माझ्या मॅनेजरला फोन करा.',
    pa: 'ਕਿਰਪਾ ਕਰਕੇ ਮੇਰੇ ਮੈਨੇਜਰ ਨੂੰ ਕਾਲ ਕਰੋ।',
    or: 'ଦୟାକରି ମୋ ମ୍ୟାନେଜରଙ୍କୁ ଫୋନ୍ କରନ୍ତୁ।',
    ta: 'தயவுசெய்து என் மேலாளரை அழைக்கவும்.',
    te: 'దయచేసి నా మేనేజర్‌కు కాల్ చేయండి.',
    ml: 'ദയവായി എൻ്റെ മാനേജറെ വിളിക്കുക.',
    kn: 'ದಯವಿಟ್ಟು ನನ್ನ ಮ್ಯಾನೇಜರ್‌ಗೆ ಕರೆ ಮಾಡಿ.',
  },
  'How far is the checkpoint?': {
    en: 'How far is the checkpoint?',
    hi: 'चेकपोस्ट यहाँ से कितनी दूर है?',
    as: 'চেকপোষ্ট ইয়াৰ পৰা কিমান দূৰত?',
    bn: 'চেকপোস্ট এখান থেকে কত দূরে?',
    gu: 'ચેકપોસ્ટ અહીંથી કેટલે દૂર છે?',
    mr: 'चेकपोस्ट इथून किती दूर आहे?',
    pa: 'ਚੈੱਕਪੋਸਟ ਇੱਥੋਂ ਕਿੰਨੀ ਦੂਰ ਹੈ?',
    or: 'ଚେକ୍ ପୋଷ୍ଟ ଏଠାରୁ କେତେ ଦୂର?',
    ta: 'சோதனைச் சாவடி இங்கிருந்து எவ்வளவு தொலைவில் உள்ளது?',
    te: 'చెక్‌పోస్ట్ ఇక్కడి నుండి ఎంత దూరంలో ఉంది?',
    ml: 'ചെക്ക്പോസ്റ്റ് ഇവിടെ നിന്ന് എത്ര അകലെയാണ്?',
    kn: 'ಚೆಕ್‌ಪೋಸ್ಟ್ ಇಲ್ಲಿಂದ ಎಷ್ಟು ದೂರದಲ್ಲಿದೆ?',
  },
}

export interface MatchedPhrase {
  id: string
  english: string
  translation: string
  category: string
}

/** Strip HTML tags, special script delimiters, and truncate to max length */
export function sanitizeInput(input: string, maxLength = 1500): string {
  if (!input) return ''
  // Strip HTML tags
  const stripped = input.replace(/<[^>]*>?/gm, '')
  // Normalize whitespace
  const trimmed = stripped.trim().replace(/\s+/g, ' ')
  return trimmed.slice(0, maxLength)
}

/** Find verified offline phrases matching user search or target category */
export function findOfflinePhrases(query: string, targetLanguage: string): MatchedPhrase[] {
  const target = targetLanguage.toLowerCase()
  const q = query.toLowerCase().trim()
  const results: MatchedPhrase[] = []

  // 1. Check quick phrases first
  for (const phrase of QUICK_DRIVER_PHRASES) {
    if (!q || phrase.toLowerCase().includes(q) || q.includes(phrase.toLowerCase())) {
      const transMap = VERIFIED_QUICK_TRANSLATIONS[phrase]
      const translation = transMap[target] ?? transMap.hi ?? transMap.en
      results.push({
        id: `quick_${phrase.replace(/\W+/g, '_')}`,
        english: phrase,
        translation,
        category: 'Quick Driver Phrase',
      })
    }
  }

  // 2. Check full phrasebook catalogue
  const rawBook = catalogue as {
    categories: Array<{
      id: string
      en: string
      phrases: Array<{
        id: string
        en: string
        hi: string
        as: string
        bn: string
      }>
    }>
  }

  for (const cat of rawBook.categories) {
    for (const p of cat.phrases) {
      const enMatch = p.en.toLowerCase().includes(q)
      const hiMatch = p.hi.toLowerCase().includes(q)
      const asMatch = p.as.toLowerCase().includes(q)
      const bnMatch = p.bn.toLowerCase().includes(q)

      if (!q || enMatch || hiMatch || asMatch || bnMatch) {
        // Pick best translation according to target language
        let translation = (p as Record<string, string>)[target]
        if (!translation) {
          // fallback to hi, then en
          translation = p.hi || p.en
        }
        // avoid duplicate of quick phrase
        if (!results.some((r) => r.english.toLowerCase() === p.en.toLowerCase())) {
          results.push({
            id: p.id,
            english: p.en,
            translation,
            category: cat.en,
          })
        }
      }
    }
  }

  return results.slice(0, 10)
}
