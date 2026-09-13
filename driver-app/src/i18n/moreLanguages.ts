/**
 * Core-key DRAFTS for the scheduled languages beyond hi/gu/as/bn: the tabs,
 * login, trip buttons, statuses, emergency numbers and the assistant chips.
 * Every other key falls back to English (t() in appLanguage.ts), visibly.
 *
 * STATUS: DRAFT - drafted by the team, NOT reviewed by native speakers.
 * Languages absent here (Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri,
 * Sanskrit, Santali, Sindhi) are selectable and render English: their row in
 * the language sheet says so ("English fallback"). A wrong draft in a script
 * nobody on the team reads is worse than honest English.
 */

import type { AppLanguage, TranslationKey } from './appLanguage'

type Core = Partial<Record<TranslationKey, string>>

export const MORE_TRANSLATIONS: Partial<Record<AppLanguage, Core>> = {
  ta: {
    nav_navigate: 'வழிகாட்டு', nav_trip: 'பயணம்', nav_safety: 'பாதுகாப்பு', nav_ai: 'AI உதவியாளர்', nav_more: 'மேலும்',
    login_title: 'மீண்டும் வரவேற்கிறோம்', login_subtitle: 'கடினமான பாதைகளில் பாதுகாப்பான போக்குவரத்து.', login_phone_label: 'மொபைல் எண்', login_pin_label: 'கடவுச்சொல்', login_submit: 'உள்நுழை', login_submitting: 'உள்நுழைகிறது…',
    btn_sign_out: 'வெளியேறு', btn_start_trip: 'பயணத்தைத் தொடங்கு', btn_arrive: 'நிறுத்தத்தை அடைந்தேன்', btn_complete_stop: 'நிறுத்தம் முடிந்தது', btn_complete_trip: 'பயணம் முடிந்தது', btn_verify_truck: 'லாரியைச் சரிபார்', btn_copy: 'நகலெடு', btn_speak: 'பேசு', btn_cancel: 'ரத்து',
    status_assigned: 'ஒதுக்கப்பட்டது', status_in_progress: 'நடைபெறுகிறது', status_delivered: 'வழங்கப்பட்டது', status_cancelled: 'ரத்து செய்யப்பட்டது',
    safety_emergency_title: 'அவசர தொடர்புகள்', safety_police: 'தேசிய அவசர எண் (112)', safety_ambulance: 'ஆம்புலன்ஸ் (108)',
    common_online: 'ஆன்லைன்', common_offline: 'ஆஃப்லைன்', common_change_language: 'மொழி',
    ask_health: 'எனக்கு உடல்நிலை சரியில்லை', ask_emergency: 'அவசர உதவி', ask_weather: 'முன்னால் வானிலை', ask_route: 'என் பாதை', ask_placeholder: 'இந்தப் பயணம் பற்றி எதையும் கேளுங்கள்…',
  },
  te: {
    nav_navigate: 'నావిగేట్', nav_trip: 'ప్రయాణం', nav_safety: 'భద్రత', nav_ai: 'AI సహాయకుడు', nav_more: 'మరిన్ని',
    login_title: 'తిరిగి స్వాగతం', login_subtitle: 'కష్టమైన మార్గాల్లో సురక్షిత రవాణా.', login_phone_label: 'మొబైల్ నంబర్', login_pin_label: 'పాస్‌వర్డ్', login_submit: 'సైన్ ఇన్', login_submitting: 'సైన్ ఇన్ అవుతోంది…',
    btn_sign_out: 'సైన్ అవుట్', btn_start_trip: 'ప్రయాణం ప్రారంభించు', btn_arrive: 'స్టాప్‌కు చేరుకున్నాను', btn_complete_stop: 'స్టాప్ పూర్తి', btn_complete_trip: 'ప్రయాణం పూర్తి', btn_verify_truck: 'ట్రక్ ధృవీకరించు', btn_copy: 'కాపీ', btn_speak: 'మాట్లాడు', btn_cancel: 'రద్దు',
    status_assigned: 'కేటాయించబడింది', status_in_progress: 'ప్రగతిలో ఉంది', status_delivered: 'డెలివరీ అయింది', status_cancelled: 'రద్దు చేయబడింది',
    safety_emergency_title: 'అత్యవసర సంప్రదింపులు', safety_police: 'జాతీయ అత్యవసర నంబర్ (112)', safety_ambulance: 'అంబులెన్స్ (108)',
    common_online: 'ఆన్‌లైన్', common_offline: 'ఆఫ్‌లైన్', common_change_language: 'భాష',
    ask_health: 'నాకు ఆరోగ్యం బాగోలేదు', ask_emergency: 'అత్యవసర సహాయం', ask_weather: 'ముందున్న వాతావరణం', ask_route: 'నా మార్గం', ask_placeholder: 'ఈ ప్రయాణం గురించి ఏదైనా అడగండి…',
  },
  kn: {
    nav_navigate: 'ನ್ಯಾವಿಗೇಟ್', nav_trip: 'ಪ್ರಯಾಣ', nav_safety: 'ಸುರಕ್ಷತೆ', nav_ai: 'AI ಸಹಾಯಕ', nav_more: 'ಇನ್ನಷ್ಟು',
    login_title: 'ಮತ್ತೆ ಸ್ವಾಗತ', login_subtitle: 'ಕಠಿಣ ಮಾರ್ಗಗಳಲ್ಲಿ ಸುರಕ್ಷಿತ ಸಾಗಣೆ.', login_phone_label: 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ', login_pin_label: 'ಪಾಸ್‌ವರ್ಡ್', login_submit: 'ಸೈನ್ ಇನ್', login_submitting: 'ಸೈನ್ ಇನ್ ಆಗುತ್ತಿದೆ…',
    btn_sign_out: 'ಸೈನ್ ಔಟ್', btn_start_trip: 'ಪ್ರಯಾಣ ಆರಂಭಿಸಿ', btn_arrive: 'ನಿಲುಗಡೆ ತಲುಪಿದೆ', btn_complete_stop: 'ನಿಲುಗಡೆ ಪೂರ್ಣ', btn_complete_trip: 'ಪ್ರಯಾಣ ಪೂರ್ಣ', btn_verify_truck: 'ಟ್ರಕ್ ಪರಿಶೀಲಿಸಿ', btn_copy: 'ನಕಲಿಸಿ', btn_speak: 'ಮಾತನಾಡಿ', btn_cancel: 'ರದ್ದು',
    status_assigned: 'ನಿಯೋಜಿಸಲಾಗಿದೆ', status_in_progress: 'ಪ್ರಗತಿಯಲ್ಲಿದೆ', status_delivered: 'ತಲುಪಿಸಲಾಗಿದೆ', status_cancelled: 'ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ',
    safety_emergency_title: 'ತುರ್ತು ಸಂಪರ್ಕಗಳು', safety_police: 'ರಾಷ್ಟ್ರೀಯ ತುರ್ತು ಸಂಖ್ಯೆ (112)', safety_ambulance: 'ಆಂಬ್ಯುಲೆನ್ಸ್ (108)',
    common_online: 'ಆನ್‌ಲೈನ್', common_offline: 'ಆಫ್‌ಲೈನ್', common_change_language: 'ಭಾಷೆ',
    ask_health: 'ನನಗೆ ಆರೋಗ್ಯ ಸರಿಯಿಲ್ಲ', ask_emergency: 'ತುರ್ತು ಸಹಾಯ', ask_weather: 'ಮುಂದಿನ ಹವಾಮಾನ', ask_route: 'ನನ್ನ ಮಾರ್ಗ', ask_placeholder: 'ಈ ಪ್ರಯಾಣದ ಬಗ್ಗೆ ಏನನ್ನಾದರೂ ಕೇಳಿ…',
  },
  ml: {
    nav_navigate: 'നാവിഗേറ്റ്', nav_trip: 'യാത്ര', nav_safety: 'സുരക്ഷ', nav_ai: 'AI സഹായി', nav_more: 'കൂടുതൽ',
    login_title: 'വീണ്ടും സ്വാഗതം', login_subtitle: 'ദുർഘട പാതകളിൽ സുരക്ഷിത ചരക്കുനീക്കം.', login_phone_label: 'മൊബൈൽ നമ്പർ', login_pin_label: 'പാസ്‌വേഡ്', login_submit: 'സൈൻ ഇൻ', login_submitting: 'സൈൻ ഇൻ ചെയ്യുന്നു…',
    btn_sign_out: 'സൈൻ ഔട്ട്', btn_start_trip: 'യാത്ര തുടങ്ങുക', btn_arrive: 'സ്റ്റോപ്പിൽ എത്തി', btn_complete_stop: 'സ്റ്റോപ്പ് പൂർത്തിയായി', btn_complete_trip: 'യാത്ര പൂർത്തിയായി', btn_verify_truck: 'ട്രക്ക് പരിശോധിക്കുക', btn_copy: 'പകർത്തുക', btn_speak: 'സംസാരിക്കുക', btn_cancel: 'റദ്ദാക്കുക',
    status_assigned: 'നിയോഗിച്ചു', status_in_progress: 'പുരോഗമിക്കുന്നു', status_delivered: 'എത്തിച്ചു', status_cancelled: 'റദ്ദാക്കി',
    safety_emergency_title: 'അടിയന്തര ബന്ധങ്ങൾ', safety_police: 'ദേശീയ അടിയന്തര നമ്പർ (112)', safety_ambulance: 'ആംബുലൻസ് (108)',
    common_online: 'ഓൺലൈൻ', common_offline: 'ഓഫ്‌ലൈൻ', common_change_language: 'ഭാഷ',
    ask_health: 'എനിക്ക് സുഖമില്ല', ask_emergency: 'അടിയന്തര സഹായം', ask_weather: 'മുന്നിലെ കാലാവസ്ഥ', ask_route: 'എന്റെ റൂട്ട്', ask_placeholder: 'ഈ യാത്രയെക്കുറിച്ച് എന്തും ചോദിക്കൂ…',
  },
  mr: {
    nav_navigate: 'नेव्हिगेट', nav_trip: 'प्रवास', nav_safety: 'सुरक्षा', nav_ai: 'AI सहाय्यक', nav_more: 'अधिक',
    login_title: 'पुन्हा स्वागत', login_subtitle: 'कठीण मार्गांवर सुरक्षित वाहतूक.', login_phone_label: 'मोबाइल नंबर', login_pin_label: 'पासवर्ड', login_submit: 'साइन इन', login_submitting: 'साइन इन होत आहे…',
    btn_sign_out: 'साइन आउट', btn_start_trip: 'प्रवास सुरू करा', btn_arrive: 'थांब्यावर पोहोचलो', btn_complete_stop: 'थांबा पूर्ण', btn_complete_trip: 'प्रवास पूर्ण', btn_verify_truck: 'ट्रक तपासा', btn_copy: 'कॉपी', btn_speak: 'बोला', btn_cancel: 'रद्द',
    status_assigned: 'नेमून दिले', status_in_progress: 'सुरू आहे', status_delivered: 'पोहोचवले', status_cancelled: 'रद्द केले',
    safety_emergency_title: 'आपत्कालीन संपर्क', safety_police: 'राष्ट्रीय आपत्कालीन क्रमांक (112)', safety_ambulance: 'रुग्णवाहिका (108)',
    common_online: 'ऑनलाइन', common_offline: 'ऑफलाइन', common_change_language: 'भाषा',
    ask_health: 'मला बरे वाटत नाही', ask_emergency: 'आपत्कालीन मदत', ask_weather: 'पुढील हवामान', ask_route: 'माझा मार्ग', ask_placeholder: 'या प्रवासाबद्दल काहीही विचारा…',
  },
  pa: {
    nav_navigate: 'ਨੈਵੀਗੇਟ', nav_trip: 'ਸਫ਼ਰ', nav_safety: 'ਸੁਰੱਖਿਆ', nav_ai: 'AI ਸਹਾਇਕ', nav_more: 'ਹੋਰ',
    login_title: 'ਜੀ ਆਇਆਂ ਨੂੰ', login_subtitle: 'ਔਖੇ ਰਾਹਾਂ ’ਤੇ ਸੁਰੱਖਿਅਤ ਢੋਆ-ਢੁਆਈ।', login_phone_label: 'ਮੋਬਾਈਲ ਨੰਬਰ', login_pin_label: 'ਪਾਸਵਰਡ', login_submit: 'ਸਾਈਨ ਇਨ', login_submitting: 'ਸਾਈਨ ਇਨ ਹੋ ਰਿਹਾ ਹੈ…',
    btn_sign_out: 'ਸਾਈਨ ਆਊਟ', btn_start_trip: 'ਸਫ਼ਰ ਸ਼ੁਰੂ ਕਰੋ', btn_arrive: 'ਸਟਾਪ ’ਤੇ ਪਹੁੰਚ ਗਿਆ', btn_complete_stop: 'ਸਟਾਪ ਪੂਰਾ', btn_complete_trip: 'ਸਫ਼ਰ ਪੂਰਾ', btn_verify_truck: 'ਟਰੱਕ ਦੀ ਜਾਂਚ ਕਰੋ', btn_copy: 'ਕਾਪੀ', btn_speak: 'ਬੋਲੋ', btn_cancel: 'ਰੱਦ ਕਰੋ',
    status_assigned: 'ਸੌਂਪਿਆ ਗਿਆ', status_in_progress: 'ਜਾਰੀ ਹੈ', status_delivered: 'ਪਹੁੰਚਾ ਦਿੱਤਾ', status_cancelled: 'ਰੱਦ ਕੀਤਾ',
    safety_emergency_title: 'ਐਮਰਜੈਂਸੀ ਸੰਪਰਕ', safety_police: 'ਰਾਸ਼ਟਰੀ ਐਮਰਜੈਂਸੀ (112)', safety_ambulance: 'ਐਂਬੂਲੈਂਸ (108)',
    common_online: 'ਆਨਲਾਈਨ', common_offline: 'ਆਫ਼ਲਾਈਨ', common_change_language: 'ਭਾਸ਼ਾ',
    ask_health: 'ਮੇਰੀ ਤਬੀਅਤ ਠੀਕ ਨਹੀਂ', ask_emergency: 'ਐਮਰਜੈਂਸੀ ਮਦਦ', ask_weather: 'ਅੱਗੇ ਮੌਸਮ', ask_route: 'ਮੇਰਾ ਰਸਤਾ', ask_placeholder: 'ਇਸ ਸਫ਼ਰ ਬਾਰੇ ਕੁਝ ਵੀ ਪੁੱਛੋ…',
  },
  or: {
    nav_navigate: 'ନେଭିଗେଟ୍', nav_trip: 'ଯାତ୍ରା', nav_safety: 'ସୁରକ୍ଷା', nav_ai: 'AI ସହାୟକ', nav_more: 'ଅଧିକ',
    login_title: 'ପୁଣି ସ୍ୱାଗତ', login_subtitle: 'କଠିନ ପଥରେ ସୁରକ୍ଷିତ ପରିବହନ।', login_phone_label: 'ମୋବାଇଲ୍ ନମ୍ବର', login_pin_label: 'ପାସୱାର୍ଡ', login_submit: 'ସାଇନ୍ ଇନ୍', login_submitting: 'ସାଇନ୍ ଇନ୍ ହେଉଛି…',
    btn_sign_out: 'ସାଇନ୍ ଆଉଟ୍', btn_start_trip: 'ଯାତ୍ରା ଆରମ୍ଭ କରନ୍ତୁ', btn_arrive: 'ଷ୍ଟପ୍‌ରେ ପହଞ୍ଚିଲି', btn_complete_stop: 'ଷ୍ଟପ୍ ସମ୍ପୂର୍ଣ୍ଣ', btn_complete_trip: 'ଯାତ୍ରା ସମ୍ପୂର୍ଣ୍ଣ', btn_verify_truck: 'ଟ୍ରକ୍ ଯାଞ୍ଚ କରନ୍ତୁ', btn_copy: 'କପି', btn_speak: 'କୁହନ୍ତୁ', btn_cancel: 'ବାତିଲ୍',
    status_assigned: 'ନ୍ୟସ୍ତ', status_in_progress: 'ଚାଲୁଛି', status_delivered: 'ପହଞ୍ଚାଇ ଦିଆଗଲା', status_cancelled: 'ବାତିଲ୍ ହେଲା',
    safety_emergency_title: 'ଜରୁରୀ ଯୋଗାଯୋଗ', safety_police: 'ଜାତୀୟ ଜରୁରୀ ନମ୍ବର (112)', safety_ambulance: 'ଆମ୍ବୁଲାନ୍ସ (108)',
    common_online: 'ଅନଲାଇନ୍', common_offline: 'ଅଫଲାଇନ୍', common_change_language: 'ଭାଷା',
    ask_health: 'ମୋର ଦେହ ଭଲ ଲାଗୁନାହିଁ', ask_emergency: 'ଜରୁରୀ ସାହାଯ୍ୟ', ask_weather: 'ଆଗରେ ପାଣିପାଗ', ask_route: 'ମୋ ରାସ୍ତା', ask_placeholder: 'ଏହି ଯାତ୍ରା ବିଷୟରେ କିଛି ପଚାରନ୍ତୁ…',
  },
  ur: {
    nav_navigate: 'نیویگیٹ', nav_trip: 'سفر', nav_safety: 'حفاظت', nav_ai: 'AI معاون', nav_more: 'مزید',
    login_title: 'خوش آمدید', login_subtitle: 'مشکل راستوں پر محفوظ ترسیل۔', login_phone_label: 'موبائل نمبر', login_pin_label: 'پاس ورڈ', login_submit: 'سائن ان', login_submitting: 'سائن ان ہو رہا ہے…',
    btn_sign_out: 'سائن آؤٹ', btn_start_trip: 'سفر شروع کریں', btn_arrive: 'اسٹاپ پر پہنچ گیا', btn_complete_stop: 'اسٹاپ مکمل', btn_complete_trip: 'سفر مکمل', btn_verify_truck: 'ٹرک کی تصدیق کریں', btn_copy: 'کاپی', btn_speak: 'بولیں', btn_cancel: 'منسوخ',
    status_assigned: 'تفویض شدہ', status_in_progress: 'جاری ہے', status_delivered: 'پہنچا دیا گیا', status_cancelled: 'منسوخ شدہ',
    safety_emergency_title: 'ہنگامی رابطے', safety_police: 'قومی ہنگامی نمبر (112)', safety_ambulance: 'ایمبولینس (108)',
    common_online: 'آن لائن', common_offline: 'آف لائن', common_change_language: 'زبان',
    ask_health: 'میری طبیعت ٹھیک نہیں', ask_emergency: 'ہنگامی مدد', ask_weather: 'آگے موسم', ask_route: 'میرا راستہ', ask_placeholder: 'اس سفر کے بارے میں کچھ بھی پوچھیں…',
  },
  ne: {
    nav_navigate: 'नेभिगेट', nav_trip: 'यात्रा', nav_safety: 'सुरक्षा', nav_ai: 'AI सहायक', nav_more: 'थप',
    login_title: 'फेरि स्वागत छ', login_subtitle: 'कठिन बाटोहरूमा सुरक्षित ढुवानी।', login_phone_label: 'मोबाइल नम्बर', login_pin_label: 'पासवर्ड', login_submit: 'साइन इन', login_submitting: 'साइन इन हुँदैछ…',
    btn_sign_out: 'साइन आउट', btn_start_trip: 'यात्रा सुरु गर्नुहोस्', btn_arrive: 'स्टपमा पुगें', btn_complete_stop: 'स्टप पूरा', btn_complete_trip: 'यात्रा पूरा', btn_verify_truck: 'ट्रक जाँच गर्नुहोस्', btn_copy: 'कपी', btn_speak: 'बोल्नुहोस्', btn_cancel: 'रद्द',
    status_assigned: 'तोकिएको', status_in_progress: 'चलिरहेको', status_delivered: 'पुर्‍याइयो', status_cancelled: 'रद्द गरियो',
    safety_emergency_title: 'आपतकालीन सम्पर्क', safety_police: 'राष्ट्रिय आपतकालीन नम्बर (112)', safety_ambulance: 'एम्बुलेन्स (108)',
    common_online: 'अनलाइन', common_offline: 'अफलाइन', common_change_language: 'भाषा',
    ask_health: 'मलाई सन्चो छैन', ask_emergency: 'आपतकालीन सहायता', ask_weather: 'अगाडिको मौसम', ask_route: 'मेरो बाटो', ask_placeholder: 'यो यात्राबारे जे पनि सोध्नुहोस्…',
  },
}
