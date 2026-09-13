/**
 * Local intent classifier - keyword matching, nothing learned.
 *
 * Typed or spoken text becomes one of the assistant's intents by matching
 * normalised words against alias lists. No model, no network, no score: the
 * first intent whose alias appears wins, in the priority order below (a
 * health red flag before everything, then emergency, then health - because
 * "chest pain, help" is a call-112 question before it is anything else).
 *
 * UNKNOWN is a real answer. Text that matches nothing is told what the
 * assistant can do rather than guessed at - a wrong confident answer at a
 * roadside is worse than "I can help with…" - and, when the phone is online,
 * it is the one case handed to the online model to EXPLAIN (never decide).
 *
 * ONE engine, many languages: aliases cover English, Hindi, Gujarati,
 * Assamese, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Punjabi,
 * Odia, Urdu and Nepali plus common romanised Hindi ("mausam", "chakkar")
 * because that is how drivers type. Every language is matched regardless of
 * the app setting, so a Hindi speaker typing in Latin letters still lands.
 * TRANSLATION REVIEW STATUS: hi/gu/as/bn aliases are unreviewed by a native
 * speaker, like every other non-English string in this app.
 */

import type { Intent } from './assistant'

const ALIASES: readonly [Intent, readonly string[]][] = [
  // Red flags: stop, call 112/108. Matched before EMERGENCY so "chest pain
  // help" opens the urgent card with the call button, not the topic list.
  ['HEALTH_URGENT', ['chest pain', 'chest tight', 'heart attack', 'cannot breathe', "can't breathe", 'breathing difficulty', 'difficulty breathing', 'short of breath', 'breathless',
    'fainted', 'fainting', 'passed out', 'unconscious', 'collapsed', 'stroke', 'face drooping', 'slurred', 'one side numb', 'arm numb', 'seizure', 'fits',
    'heavy bleeding', 'bleeding a lot', 'severe injury', 'broken bone', 'fracture',
    'सीने में दर्द', 'छाती में दर्द', 'साँस नहीं', 'सांस नहीं', 'सांस लेने में', 'बेहोश', 'दौरा', 'लकवा', 'बहुत खून', 'हड्डी टूट', 'seene me dard', 'chhati me dard', 'saans nahi', 'behosh', 'dil ka daura',
    'છાતીમાં દુખાવો', 'શ્વાસ નથી', 'શ્વાસ લેવામાં', 'બેભાન', 'લકવો', 'ખૂબ લોહી', 'હાડકું તૂટ',
    'বুকৰ বিষ', 'উশাহ ল', 'অচেতন', 'পক্ষাঘাত', 'বহুত তেজ',
    'বুকে ব্যথা', 'শ্বাস নিতে', 'অজ্ঞান', 'স্ট্রোক', 'অনেক রক্ত', 'হাড় ভেঙে',
    // ta/te/kn/ml/mr/pa/or/ur/ne (drafts, unreviewed)
    'மார்பு வலி', 'மூச்சு விட', 'மயக்கம் அடைந்', 'ரத்தம் அதிகம்',
    'ఛాతీ నొప్పి', 'ఊపిరి ఆడట', 'స్పృహ తప్ప', 'రక్తం ఎక్కువ',
    'ಎದೆ ನೋವು', 'ಉಸಿರಾಟ', 'ಪ್ರಜ್ಞೆ ತಪ್ಪ', 'ರಕ್ತ ಹೆಚ್ಚು',
    'നെഞ്ചുവേദന', 'നെഞ്ച് വേദന', 'ശ്വാസം മുട്ട', 'ബോധം പോ', 'രക്തം കൂടുതൽ',
    'छातीत दुखत', 'श्वास घेता येत नाही', 'बेशुद्ध', 'खूप रक्त',
    'ਛਾਤੀ ਵਿੱਚ ਦਰਦ', 'ਸਾਹ ਨਹੀਂ', 'ਬੇਹੋਸ਼', 'ਬਹੁਤ ਖੂਨ',
    'ଛାତି ଯନ୍ତ୍ରଣା', 'ନିଶ୍ୱାସ ନେଇ', 'ଅଚେତ', 'ବହୁତ ରକ୍ତ',
    'سینے میں درد', 'سانس نہیں', 'بے ہوش', 'بہت خون',
    'छाती दुख', 'सास फेर्न', 'बेहोस', 'धेरै रगत',
  ]],

  ['EMERGENCY', ['emergency', 'help', 'sos', 'accident', 'police', 'ambulance', '112', '108', 'injured', 'hurt', 'bleeding',
    'आपात', 'मदद', 'दुर्घटना', 'पुलिस', 'एम्बुलेंस', 'घायल', 'madad', 'durghatna',
    'કટોકટી', 'મદદ', 'અકસ્માત', 'પોલીસ', 'એમ્બ્યુલન્સ', 'ઘાયલ',
    'জৰুৰী', 'সহায়', 'দুৰ্ঘটনা', 'আৰক্ষী', 'এম্বুলেন্স',
    'জরুরি', 'সাহায্য', 'দুর্ঘটনা', 'পুলিশ', 'অ্যাম্বুলেন্স', 'আহত',
    'அவசரம்', 'உதவி', 'விபத்து', 'காவல்', 'ஆம்புலன்ஸ்',
    'అత్యవసర', 'సహాయం', 'ప్రమాదం', 'పోలీస్', 'అంబులెన్స్',
    'ತುರ್ತು', 'ಸಹಾಯ', 'ಅಪಘಾತ', 'ಪೊಲೀಸ್', 'ಆಂಬ್ಯುಲೆನ್ಸ್',
    'അടിയന്തര', 'സഹായം', 'അപകടം', 'പോലീസ്', 'ആംബുലൻസ്',
    'आपत्कालीन', 'मदत', 'अपघात', 'पोलीस', 'रुग्णवाहिका',
    'ਐਮਰਜੈਂਸੀ', 'ਮਦਦ', 'ਹਾਦਸਾ', 'ਪੁਲਿਸ', 'ਐਂਬੂਲੈਂਸ',
    'ଜରୁରୀ', 'ସାହାଯ୍ୟ', 'ଦୁର୍ଘଟଣା', 'ପୋଲିସ', 'ଆମ୍ବୁଲାନ୍ସ',
    'ہنگامی', 'مدد', 'حادثہ', 'پولیس', 'ایمبولینس',
    'आपतकाल', 'मद्दत', 'प्रहरी', 'एम्बुलेन्स',
  ]],

  // Not feeling well: stop, rest, water, medical help if it does not pass.
  ['HEALTH', ['dizzy', 'dizziness', 'giddy', 'headache', 'head ache', 'vomit', 'vomiting', 'nausea', 'weak', 'weakness', 'fever', 'feverish', 'dehydrated', 'dehydration', 'thirsty',
    'unwell', 'not well', 'feel sick', 'feeling sick', 'ill', 'stomach pain', 'stomach ache', 'sick', 'medical', 'doctor', 'hospital', 'clinic', 'medicine', 'blurred', 'exhausted', 'drowsy', 'sleepy', 'fatigue',
    'चक्कर', 'सिर दर्द', 'सिरदर्द', 'उल्टी', 'कमज़ोरी', 'कमजोरी', 'बुखार', 'प्यास', 'तबीयत', 'बीमार', 'पेट दर्द', 'डॉक्टर', 'अस्पताल', 'दवा', 'नींद आ रही', 'थकान', 'chakkar', 'sir dard', 'ulti', 'kamzori', 'bukhar', 'tabiyat', 'bimar', 'pet dard', 'doctor', 'aspatal', 'dawai', 'neend aa rahi', 'thakan',
    'ચક્કર', 'માથું દુખે', 'માથાનો દુખાવો', 'ઉલટી', 'નબળાઈ', 'તાવ', 'તરસ', 'તબિયત', 'બીમાર', 'પેટમાં દુખાવો', 'ડૉક્ટર', 'હોસ્પિટલ', 'દવા', 'ઊંઘ આવે', 'થાક',
    'মূৰ ঘূৰ', 'মূৰৰ বিষ', 'বমি', 'দুৰ্বল', 'জ্বৰ', 'অসুস্থ', 'পেটৰ বিষ', 'ডাক্তৰ', 'চিকিৎসালয়', 'ঔষধ', 'টোপনি আহিছে', 'ভাগৰ',
    'মাথা ঘোর', 'মাথা ব্যথা', 'বমি', 'দুর্বল', 'জ্বর', 'অসুস্থ', 'পেটে ব্যথা', 'ডাক্তার', 'হাসপাতাল', 'ওষুধ', 'ঘুম পাচ্ছে', 'ক্লান্ত',
    'தலைசுற்றல்', 'தலைவலி', 'வாந்தி', 'காய்ச்சல்', 'உடல்நிலை', 'சோர்வு', 'தூக்கம்', 'மருத்துவ',
    'తల తిరుగు', 'తలనొప్పి', 'వాంతి', 'జ్వరం', 'ఆరోగ్యం', 'నీరసం', 'నిద్ర', 'డాక్టర్',
    'ತಲೆ ಸುತ್ತು', 'ತಲೆನೋವು', 'ವಾಂತಿ', 'ಜ್ವರ', 'ಆರೋಗ್ಯ', 'ಆಯಾಸ', 'ನಿದ್ದೆ', 'ವೈದ್ಯ',
    'തലകറക്കം', 'തലവേദന', 'ഛർദ്ദി', 'പനി', 'സുഖമില്ല', 'ക്ഷീണം', 'ഉറക്കം', 'ഡോക്ടർ',
    'डोकेदुखी', 'उलटी', 'ताप', 'बरे वाटत नाही', 'थकवा', 'झोप',
    'ਚੱਕਰ', 'ਸਿਰ ਦਰਦ', 'ਉਲਟੀ', 'ਬੁਖਾਰ', 'ਤਬੀਅਤ', 'ਥਕਾਵਟ', 'ਨੀਂਦ', 'ਡਾਕਟਰ',
    'ମୁଣ୍ଡ ବୁଲ', 'ମୁଣ୍ଡ ବିନ୍ଧ', 'ବାନ୍ତି', 'ଜ୍ୱର', 'ଦେହ ଭଲ', 'ଥକା', 'ନିଦ', 'ଡାକ୍ତର',
    'چکر', 'سر درد', 'الٹی', 'بخار', 'طبیعت', 'تھکاوٹ', 'نیند', 'ڈاکٹر',
    'रिंगटा', 'टाउको दुख', 'बान्ता', 'ज्वरो', 'सन्चो छैन', 'थकाइ', 'निद्रा',
  ]],

  ['WARNING', ['warning', 'warnings', 'alert', 'alerts', 'ndma', 'sachet', 'earthquake', 'quake', 'tremor', 'fire', 'wildfire', 'incident', 'closure', 'closed', 'blocked',
    'चेतावनी', 'अलर्ट', 'भूकंप', 'आग', 'बंद', 'chetavani', 'bhukamp', 'aag', 'band',
    'ચેતવણી', 'ભૂકંપ', 'આગ', 'બંધ',
    'সতৰ্কবাণী', 'ভূমিকম্প', 'জুই', 'বন্ধ',
    'সতর্কতা', 'ভূমিকম্প', 'আগুন', 'বন্ধ',
    'எச்சரிக்கை', 'நிலநடுக்கம்', 'தீ', 'హెచ్చరిక', 'భూకంపం', 'మంట', 'ಎಚ್ಚರಿಕೆ', 'ಭೂಕಂಪ', 'ಬೆಂಕಿ', 'മുന്നറിയിപ്പ്', 'ഭൂകമ്പം', 'തീ',
    'इशारा', 'भूकंप', 'आग', 'ਚੇਤਾਵਨੀ', 'ਭੂਚਾਲ', 'ਅੱਗ', 'ଚେତାବନୀ', 'ଭୂକମ୍ପ', 'ନିଆଁ', 'انتباہ', 'زلزلہ', 'آگ', 'चेतावनी', 'भूकम्प', 'आगो']],
  ['TRAFFIC', ['traffic', 'jam', 'congestion', 'congested', 'queue', 'slow road',
    'ट्रैफिक', 'जाम', 'jam', 'traffic', 'ટ્રાફિક', 'જામ', 'ট্ৰাফিক', 'জাম', 'ট্রাফিক', 'জ্যাম',
    'போக்குவரத்து', 'நெரிசல்', 'ట్రాఫిక్', 'ಟ್ರಾಫಿಕ್', 'ഗതാഗതക്കുരുക്ക്', 'ട്രാഫിക്', 'वाहतूक', 'ਟ੍ਰੈਫਿਕ', 'ଟ୍ରାଫିକ', 'ٹریفک', 'ट्राफिक']],
  ['VEHICLE_ISSUE', ['truck', 'tyre', 'tire', 'puncture', 'breakdown', 'broke', 'engine', 'brake', 'mechanic', 'repair', 'fuel', 'diesel',
    'ट्रक', 'टायर', 'पंचर', 'खराब', 'इंजन', 'ब्रेक', 'मैकेनिक', 'डीज़ल', 'gaadi', 'gadi', 'kharab',
    'ટ્રક', 'ટાયર', 'પંચર', 'બગડ', 'એન્જિન', 'બ્રેક', 'મિકેનિક', 'ડીઝલ',
    'ট্ৰাক', 'টায়াৰ', 'পাংচাৰ', 'বেয়া', 'ইঞ্জিন', 'ব্ৰেক', 'মেকানিক', 'ডিজেল',
    'ট্রাক', 'টায়ার', 'পাংচার', 'খারাপ', 'ইঞ্জিন', 'ব্রেক', 'মেকানিক', 'ডিজেল']],
  ['LANDSLIDE', ['landslide', 'slide', 'rockfall', 'mudslide', 'slip',
    'भूस्खलन', 'चट्टान', 'bhuskhalan', 'pahad', 'pahaad',
    'ભૂસ્ખલન', 'ખડક',
    'ভূমিস্খলন', 'শিল',
    'ভূমিধস', 'পাথর',
    'நிலச்சரிவு', 'பாறை',
    'కొండచరియ', 'రాళ్లు',
    'ಭೂಕುಸಿತ', 'ಬಂಡೆ',
    'ഉരുൾപൊട്ടൽ', 'മണ്ണിടിച്ചിൽ', 'പാറ',
    'दरड',
    'ਢਿੱਗਾਂ', 'ਜ਼ਮੀਨ ਖਿਸਕ', 'ਚੱਟਾਨ',
    'ଭୂସ୍ଖଳନ', 'ପଥର',
    'لینڈ سلائیڈ', 'مٹی کا تودہ', 'چٹان',
    'पहिरो', 'ढुंगा',
  ]],

  ['WEATHER', ['weather', 'rain', 'raining', 'monsoon', 'storm', 'wind', 'fog', 'flood',
    'मौसम', 'बारिश', 'बरसात', 'तूफान', 'हवा', 'कोहरा', 'बाढ़', 'mausam', 'barish', 'baarish', 'toofan',
    'હવામાન', 'વરસાદ', 'તોફાન', 'પવન', 'ધુમ્મસ', 'પૂર',
    'বতৰ', 'বৰষুণ', 'ধুমুহা', 'বতাহ', 'কুঁৱলী', 'বানপানী',
    'আবহাওয়া', 'বৃষ্টি', 'ঝড়', 'বাতাস', 'কুয়াশা', 'বন্যা',
    'வானிலை', 'மழை', 'புயல்', 'மூடுபனி', 'வெள்ளம்',
    'వాతావరణం', 'వర్షం', 'తుఫాను', 'పొగమంచు', 'వరద',
    'ಹವಾಮಾನ', 'ಮಳೆ', 'ಬಿರುಗಾಳಿ', 'ಮಂಜು', 'ಪ್ರವಾಹ',
    'കാലാവസ്ഥ', 'മഴ', 'കൊടുങ്കാറ്റ്', 'മൂടൽമഞ്ഞ്', 'വെള്ളപ്പൊക്കം',
    'हवामान', 'पाऊस', 'वादळ', 'धुके', 'पूर',
    'ਮੌਸਮ', 'ਬਾਰਿਸ਼', 'ਮੀਂਹ', 'ਤੂਫ਼ਾਨ', 'ਧੁੰਦ', 'ਹੜ੍ਹ',
    'ପାଣିପାଗ', 'ବର୍ଷା', 'ଝଡ଼', 'କୁହୁଡ଼ି', 'ବନ୍ୟା',
    'موسم', 'بارش', 'طوفان', 'دھند', 'سیلاب',
    'पानी पर', 'वर्षा', 'आँधी', 'कुहिरो', 'बाढी',
  ]],

  ['TERRAIN', ['terrain', 'hill', 'hilly', 'steep', 'slope', 'gradient', 'climb', 'mountain', 'ghat', 'elevation',
    'पहाड़ी', 'ढलान', 'चढ़ाई', 'घाट', 'chadhai', 'dhalan',
    'પહાડી', 'ઢાળ', 'ચઢાણ', 'ઘાટ',
    'পাহাৰ', 'ঢাল', 'ওপৰলৈ',
    'পাহাড়', 'ঢালু', 'চড়াই']],
  ['ROUTE_RISK', ['risk', 'risky', 'safe', 'safety', 'danger', 'dangerous', 'hazard', 'condition', 'conditions',
    'खतरा', 'जोखिम', 'सुरक्षित', 'khatra', 'jokhim', 'surakshit',
    'જોખમ', 'ખતરો', 'સુરક્ષિત',
    'বিপদ', 'আশংকা', 'সুৰক্ষিত', 'নিৰাপদ',
    'ঝুঁকি', 'বিপজ্জনক', 'নিরাপদ']],
  ['NEXT_STOP', ['stop', 'next stop', 'delivery', 'deliver', 'unload', 'drop', 'destination', 'where next', 'kahan',
    'पड़ाव', 'डिलीवरी', 'अगला', 'उतारना', 'agla', 'delivery kahan',
    'સ્ટોપ', 'ડિલિવરી', 'આગળ', 'ઉતારવા',
    'ষ্টপ', 'পিছৰ', 'ডেলিভাৰী', 'নমোৱা',
    'স্টপ', 'পরের', 'ডেলিভারি', 'নামানো']],
  ['BREAK', ['break', 'rest', 'tired', 'pause',
    'आराम', 'थका', 'ब्रेक', 'aaram', 'thaka', 'neend',
    'આરામ', 'થાક્યો', 'બ્રેક',
    'জিৰণি', 'বিৰতি',
    'বিশ্রাম', 'বিরতি', 'ক্লান্ত']],
  ['CONNECTIVITY', ['online', 'offline', 'network', 'signal', 'internet', 'connection', 'connected', 'gps',
    'नेटवर्क', 'सिग्नल', 'इंटरनेट', 'ऑनलाइन', 'जीपीएस',
    'નેટવર્ક', 'સિગ્નલ', 'ઇન્ટરનેટ', 'ઓનલાઇન',
    'নেটৱৰ্ক', 'ছিগনেল', 'ইণ্টাৰনেট', 'অনলাইন',
    'নেটওয়ার্ক', 'সিগন্যাল', 'ইন্টারনেট', 'অনলাইন']],
  ['TRANSLATE', ['translate', 'translation', 'speak', 'say', 'language', 'talk', 'phrase', 'how do i say',
    'अनुवाद', 'भाषा', 'बोलना', 'कैसे कहें', 'anuvad', 'bhasha', 'kaise kahe',
    'અનુવાદ', 'ભાષા', 'કેવી રીતે કહેવું',
    'অনুবাদ', 'ভাষা', 'কেনেকৈ কওঁ',
    'অনুবাদ', 'ভাষা', 'কীভাবে বলব']],
  ['MY_ROUTE', ['route', 'road', 'way', 'progress', 'how far', 'remaining', 'distance', 'km', 'eta', 'arrive', 'reach',
    'रास्ता', 'सड़क', 'कितना दूर', 'दूरी', 'बाकी', 'पहुँच', 'rasta', 'kitna door', 'doori',
    'રસ્તો', 'માર્ગ', 'કેટલું દૂર', 'અંતર', 'બાકી', 'પહોંચ',
    'পথ', 'ৰাস্তা', 'কিমান দূৰ', 'দূৰত্ব', 'বাকী',
    'রাস্তা', 'কত দূর', 'দূরত্ব', 'বাকি', 'পৌঁছ']],
  ['MY_TRIP', ['trip', 'job', 'assignment', 'assigned', 'load', 'cargo', 'shipment', 'status', 'truck number', 'what am i carrying',
    'यात्रा', 'ट्रिप', 'काम', 'माल', 'सामान', 'स्थिति', 'safar', 'maal', 'saman',
    'ટ્રિપ', 'યાત્રા', 'કામ', 'માલ', 'સામાન', 'સ્થિતિ',
    'যাত্ৰা', 'ট্ৰিপ', 'কাম', 'মাল', 'অৱস্থা',
    'ট্রিপ', 'যাত্রা', 'কাজ', 'মাল', 'অবস্থা']],
]

/** Lower-case, punctuation stripped, whitespace collapsed. Letters AND combining
 *  marks kept - Devanagari and Bengali vowel signs are marks, and dropping them
 *  turns every word into a different word. */
export function normalise(text: string): string {
  return text
    .normalize('NFC')
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
      const isLatin = /^[a-z0-9 ']+$/.test(alias)
      if (isLatin ? norm.includes(` ${alias.replace(/'/g, ' ').replace(/\s+/g, ' ').trim()} `) : norm.includes(alias)) return intent
    }
  }
  return 'UNKNOWN'
}
