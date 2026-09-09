/**
 * Driver App UI Multi-Language System.
 *
 * Supported UI Languages:
 *   - English ('en')
 *   - Hindi ('hi' - हिन्दी)
 *   - Gujarati ('gu' - ગુજરાતી)
 *   - Assamese ('as' - অসমীয়া)
 *   - Bengali ('bn' - বাংলা)
 *
 * Persists chosen language in AsyncStorage under `@ner_driver_app_language`.
 * Rules:
 *   - Translates navigation tabs, trip statuses, safety labels, AI labels, buttons, and login prompts.
 *   - Invariant: Do NOT translate addresses, truck registrations, or route codes.
 *   - Fallback to English if key missing.
 */

export type AppLanguage = 'en' | 'hi' | 'gu' | 'as' | 'bn'

export interface AppLanguageOption {
  code: AppLanguage
  label: string
  nativeLabel: string
}

export const APP_LANGUAGES: AppLanguageOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી' },
  { code: 'as', label: 'Assamese', nativeLabel: 'অসমীয়া' },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
]

export const APP_LANGUAGE_CODES: readonly AppLanguage[] = ['en', 'hi', 'gu', 'as', 'bn'] as const

export const STORAGE_KEY = '@ner_driver_app_language'

export type TranslationKey =
  // Nav
  | 'nav_navigate'
  | 'nav_trip'
  | 'nav_safety'
  | 'nav_ai'
  // Login
  | 'login_title'
  | 'login_subtitle'
  | 'login_phone_label'
  | 'login_phone_placeholder'
  | 'login_pin_label'
  | 'login_pin_placeholder'
  | 'login_submit'
  | 'login_forgot'
  | 'login_submitting'
  // Buttons
  | 'btn_sign_out'
  | 'btn_start_trip'
  | 'btn_arrive'
  | 'btn_complete_stop'
  | 'btn_complete_trip'
  | 'btn_verify_truck'
  | 'btn_copy'
  | 'btn_speak'
  | 'btn_clear'
  | 'btn_cancel'
  // Trip Statuses
  | 'status_assigned'
  | 'status_in_progress'
  | 'status_delivered'
  | 'status_cancelled'
  // Safety
  | 'safety_emergency_title'
  | 'safety_police'
  | 'safety_ambulance'
  | 'safety_highway'
  | 'safety_break_title'
  | 'safety_log_break'
  // AI
  | 'ai_assistant_title'
  | 'ai_submode_ask'
  | 'ai_submode_translate'
  | 'ai_submode_risk'
  | 'ai_submode_safety'
  // Common
  | 'common_online'
  | 'common_offline'
  | 'common_change_language'

export const TRANSLATIONS: Record<AppLanguage, Record<TranslationKey, string>> = {
  en: {
    nav_navigate: 'Navigate',
    nav_trip: 'Trip',
    nav_safety: 'Safety',
    nav_ai: 'AI Assistant',

    login_title: 'Welcome back',
    login_subtitle: 'Secure access to your assigned vehicle and trips.',
    login_phone_label: 'Mobile number',
    login_phone_placeholder: '10-digit mobile number',
    login_pin_label: 'Password',
    login_pin_placeholder: 'Enter your password',
    login_submit: 'Sign In',
    login_submitting: 'Signing in…',
    login_forgot: 'Forgot password?',

    btn_sign_out: 'Sign Out',
    btn_start_trip: 'Start Trip',
    btn_arrive: 'Arrive at Stop',
    btn_complete_stop: 'Complete Stop',
    btn_complete_trip: 'Complete Trip',
    btn_verify_truck: 'Verify Truck',
    btn_copy: 'Copy',
    btn_speak: 'Speak',
    btn_clear: 'Clear',
    btn_cancel: 'Cancel',

    status_assigned: 'Assigned',
    status_in_progress: 'In Progress',
    status_delivered: 'Delivered',
    status_cancelled: 'Cancelled',

    safety_emergency_title: 'Emergency Contacts',
    safety_police: 'National Emergency (112)',
    safety_ambulance: 'Ambulance (108)',
    safety_highway: 'Highway Helpline (1033)',
    safety_break_title: 'Fatigue Management',
    safety_log_break: 'Log 30-Min Break',

    ai_assistant_title: 'Terrain Command Assistant',
    ai_submode_ask: 'Ask AI',
    ai_submode_translate: 'Translate',
    ai_submode_risk: 'Route Risk',
    ai_submode_safety: 'Weather / Safety',

    common_online: 'Online',
    common_offline: 'Offline',
    common_change_language: 'Language',
  },

  hi: {
    nav_navigate: 'नेविगेट',
    nav_trip: 'ट्रिप',
    nav_safety: 'सुरक्षा',
    nav_ai: 'एआई सहायक',

    login_title: 'वापस स्वागत है',
    login_subtitle: 'अपने वाहन और ट्रिप तक सुरक्षित पहुँच।',
    login_phone_label: 'पंजीकृत मोबाइल नंबर',
    login_phone_placeholder: '10 अंकों का मोबाइल नंबर',
    login_pin_label: 'ड्राइवर पिन / पासवर्ड',
    login_pin_placeholder: 'अपना सुरक्षा पिन दर्ज करें',
    login_submit: 'वाहन में साइन इन करें',
    login_submitting: 'साइन इन हो रहा है…',
    login_forgot: 'पासवर्ड भूल गए?',

    btn_sign_out: 'साइन आउट',
    btn_start_trip: 'ट्रिप शुरू करें',
    btn_arrive: 'स्टॉप पर पहुंचें',
    btn_complete_stop: 'स्टॉप पूरा करें',
    btn_complete_trip: 'ट्रिप समाप्त करें',
    btn_verify_truck: 'ट्रक सत्यापित करें',
    btn_copy: 'कॉपी',
    btn_speak: 'बोलें',
    btn_clear: 'हटाएं',
    btn_cancel: 'रद्द करें',

    status_assigned: 'आवंटित',
    status_in_progress: 'प्रगति पर',
    status_delivered: 'वितरित',
    status_cancelled: 'रद्द',

    safety_emergency_title: 'आपातकालीन संपर्क',
    safety_police: 'राष्ट्रीय आपातकाल (112)',
    safety_ambulance: 'एम्बुलेंस (108)',
    safety_highway: 'हाईवे हेल्पलाइन (1033)',
    safety_break_title: 'थकान प्रबंधन',
    safety_log_break: '30-मिनट का ब्रेक दर्ज करें',

    ai_assistant_title: 'टेरेन कमांड सहायक',
    ai_submode_ask: 'एआई से पूछें',
    ai_submode_translate: 'अनुवाद',
    ai_submode_risk: 'मार्ग जोखिम',
    ai_submode_safety: 'मौसम / सुरक्षा',

    common_online: 'ऑनलाइन',
    common_offline: 'ऑफलाइन',
    common_change_language: 'भाषा',
  },

  gu: {
    nav_navigate: 'નેવિગેટ',
    nav_trip: 'ટ્રિપ',
    nav_safety: 'સુરક્ષા',
    nav_ai: 'AI સહાયક',

    login_title: 'પાછા સ્વાગત છે',
    login_subtitle: 'તમારા વાહન અને ટ્રિપ સુધી સુરક્ષિત પ્રવેશ.',
    login_phone_label: 'નોંધાયેલ મોબાઈલ નંબર',
    login_phone_placeholder: '10 અંકનો મોબાઈલ નંબર',
    login_pin_label: 'ડ્રાઇવર પિન / પાસવર્ડ',
    login_pin_placeholder: 'તમારો સુરક્ષા પિન દાખલ કરો',
    login_submit: 'વાહનમાં સાઇન ઇન કરો',
    login_submitting: 'સાઇન ઇન થઈ રહ્યું છે…',
    login_forgot: 'પાસવર્ડ ભૂલી ગયા?',

    btn_sign_out: 'સાઇન આઉટ',
    btn_start_trip: 'ટ્રિપ શરૂ કરો',
    btn_arrive: 'સ્ટોપ પર પહોંચો',
    btn_complete_stop: 'સ્ટોપ પૂર્ણ કરો',
    btn_complete_trip: 'ટ્રિપ પૂર્ણ કરો',
    btn_verify_truck: 'ટ્રક ચકાસો',
    btn_copy: 'કૉપિ',
    btn_speak: 'બોલો',
    btn_clear: 'સાફ કરો',
    btn_cancel: 'રદ કરો',

    status_assigned: 'સોંપાયેલ',
    status_in_progress: 'ચાલુ છે',
    status_delivered: 'પહોંચાડાયેલ',
    status_cancelled: 'રદ',

    safety_emergency_title: 'કટોકટી સંપર્કો',
    safety_police: 'રાષ્ટ્રીય કટોકટી (112)',
    safety_ambulance: 'એમ્બ્યુલન્સ (108)',
    safety_highway: 'હાઇવે હેલ્પલાઇન (1033)',
    safety_break_title: 'થાક વ્યવસ્થાપન',
    safety_log_break: '30-મિનિટનો બ્રેક નોંધો',

    ai_assistant_title: 'ટેરેન કમાન્ડ સહાયક',
    ai_submode_ask: 'AI ને પૂછો',
    ai_submode_translate: 'અનુવાદ',
    ai_submode_risk: 'રૂટ જોખમ',
    ai_submode_safety: 'હવામાન / સુરક્ષા',

    common_online: 'ઓનલાઇન',
    common_offline: 'ઓફલાઇન',
    common_change_language: 'ભાષા',
  },

  as: {
    nav_navigate: 'নেভিগেট',
    nav_trip: 'ট্ৰিপ',
    nav_safety: 'সুৰক্ষা',
    nav_ai: 'AI সহায়ক',

    login_title: 'পুনৰ স্বাগতম',
    login_subtitle: 'আপোনাৰ বাহন আৰু ট্ৰিপলৈ সুৰক্ষিত প্ৰৱেশ।',
    login_phone_label: 'পঞ্জীয়নভুক্ত মোবাইল নম্বৰ',
    login_phone_placeholder: '১০ টা অংকৰ মোবাইল নম্বৰ',
    login_pin_label: 'চালক পিন / পাছৱৰ্ড',
    login_pin_placeholder: 'আপোনাৰ সুৰক্ষা পিন দিয়ক',
    login_submit: 'বাহনত ছাইন ইন কৰক',
    login_submitting: 'ছাইন ইন হৈ আছে…',
    login_forgot: 'পাছৱৰ্ড পাহৰিছে?',

    btn_sign_out: 'ছাইন আউট',
    btn_start_trip: 'ট্ৰিপ আৰম্ভ কৰক',
    btn_arrive: 'ষ্টপত উপস্থিত হওক',
    btn_complete_stop: 'ষ্টপ সম্পূৰ্ণ কৰক',
    btn_complete_trip: 'ট্ৰিপ সমাপ্ত কৰক',
    btn_verify_truck: 'ট্ৰাক পৰীক্ষা কৰক',
    btn_copy: 'কপি',
    btn_speak: 'কওক',
    btn_clear: 'মচক',
    btn_cancel: 'বাতিল কৰক',

    status_assigned: 'নিয়োজিত',
    status_in_progress: 'চলমান',
    status_delivered: 'বিতৰিত',
    status_cancelled: 'বাতিল',

    safety_emergency_title: 'জৰুৰীকালীন যোগাযোগ',
    safety_police: 'ৰাষ্ট্ৰীয় জৰুৰীকালীন (112)',
    safety_ambulance: 'এম্বুলেন্স (108)',
    safety_highway: 'ৰাজপথ হেল্পলাইন (1033)',
    safety_break_title: 'ক্লান্তি ব্যৱস্থাপনা',
    safety_log_break: '৩০-মিনিটৰ জিৰণি দিয়ক',

    ai_assistant_title: 'টেৰেইন কমাণ্ড সহায়ক',
    ai_submode_ask: 'AI ক সোধক',
    ai_submode_translate: 'অনুবাদ',
    ai_submode_risk: 'পথৰ বিপদ',
    ai_submode_safety: 'বতৰ / সুৰক্ষা',

    common_online: 'অনলাইন',
    common_offline: 'অফলাইন',
    common_change_language: 'ভাষা',
  },

  bn: {
    nav_navigate: 'নেভিগেট',
    nav_trip: 'ট্রিপ',
    nav_safety: 'সুরক্ষা',
    nav_ai: 'AI সহায়ক',

    login_title: 'আবার স্বাগতম',
    login_subtitle: 'আপনার যানবাহন ও ট্রিপে নিরাপদ প্রবেশ।',
    login_phone_label: 'নিবন্ধিত মোবাইল নম্বর',
    login_phone_placeholder: '১০ অঙ্কের মোবাইল নম্বর',
    login_pin_label: 'ড্রাইভার পিন / পাসওয়ার্ড',
    login_pin_placeholder: 'আপনার নিরাপত্তা পিন লিখুন',
    login_submit: 'গাড়িতে সাইন ইন করুন',
    login_submitting: 'সাইন ইন হচ্ছে…',
    login_forgot: 'পাসওয়ার্ড ভুলে গেছেন?',

    btn_sign_out: 'সাইন আউট',
    btn_start_trip: 'ট্রিপ শুরু করুন',
    btn_arrive: 'স্টপে পৌঁছান',
    btn_complete_stop: 'স্টপ সম্পন্ন করুন',
    btn_complete_trip: 'ট্রিপ সমাপ্ত করুন',
    btn_verify_truck: 'ট্রাক যাচাই করুন',
    btn_copy: 'কপি',
    btn_speak: 'বলুন',
    btn_clear: 'মুছে ফেলুন',
    btn_cancel: 'বাতিল',

    status_assigned: 'বরাদ্দকৃত',
    status_in_progress: 'চলমান',
    status_delivered: 'বিতরণ সম্পন্ন',
    status_cancelled: 'বাতিল',

    safety_emergency_title: 'জরুরি যোগাযোগ',
    safety_police: 'জাতীয় জরুরি (112)',
    safety_ambulance: 'অ্যাম্বুলেন্স (108)',
    safety_highway: 'হাইওয়ে হেল্পলাইন (1033)',
    safety_break_title: 'ক্লান্তি ব্যবস্থাপনা',
    safety_log_break: '৩০ মিনিটের বিরতি লিখুন',

    ai_assistant_title: 'টেরেন কমান্ড সহকারী',
    ai_submode_ask: 'AI কে জিজ্ঞাসা করুন',
    ai_submode_translate: 'অনুবাদ',
    ai_submode_risk: 'রুটের ঝুঁকি',
    ai_submode_safety: 'আবহাওয়া / সুরক্ষা',

    common_online: 'অনলাইন',
    common_offline: 'অফলাইন',
    common_change_language: 'ভাষা',
  },
}

/** Translate string with English fallback */
export function t(lang: AppLanguage, key: TranslationKey): string {
  const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.en
  return dict[key] ?? TRANSLATIONS.en[key] ?? key
}

/** Validate if code is supported */
export function isAppLanguage(code: string | null | undefined): code is AppLanguage {
  return APP_LANGUAGE_CODES.includes(code as AppLanguage)
}
