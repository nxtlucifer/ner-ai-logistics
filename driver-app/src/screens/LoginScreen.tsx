/**
 * Driver sign-in, laid out on driver_01: a full-bleed road photo, the
 * language pill top-right, the shield mark and wordmark centred over the sky,
 * a frosted card with the two fields and Sign In, and three decorative
 * statements over the road.
 *
 * WHAT THE REFERENCE HAS THAT THIS DOES NOT, ON PURPOSE:
 *   - No "Forgot password?". Dispatch manages driver passwords; there is no
 *     reset flow, and a link shaped like one is a lie. The help line under
 *     Sign In says what actually happens.
 *   - No "+91 ▾" dropdown and no number in the field. The prefix is a fixed
 *     label, and the placeholder describes the field instead of showing a
 *     real or demo number.
 *   - No figures in the trust row: they are statements, not metrics.
 *
 * ONE login for every role: a manager types an e-mail into the same field,
 * and the +91 label steps aside for it.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '../auth/AuthProvider'
import { normalizeAndValidatePhone } from '../auth/phone'
import { categorizeAuthError, type UserFacingError } from '../auth/authErrors'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { APP_LANGUAGES } from '../i18n/appLanguage'
import { LanguageSheet } from '../i18n/LanguageSheet'
import { Banner } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { PHOTOS } from '../components/photoCredits'
import { gradient } from '../components/scenic'
import { TOUCH_TARGET } from '../theme'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'

/** The photo's ridge line, as a share of the file's height (1080 x 1920),
 *  and where it should land on screen: just under the brand block.
 *  ponytail: one hand-measured focal point for one photo; swap the photo,
 *  re-measure. */
const PHOTO_RIDGE = 0.34
const RIDGE_AT = 224

/** Decorative value statements (audit s15 #15): no numbers, not buttons. */
const TRUST: { icon: IconName; label: string; accent: boolean }[] = [
  { icon: 'shield', label: 'Safer Deliveries', accent: true },
  { icon: 'truck', label: 'Smarter Logistics', accent: false },
  { icon: 'users', label: 'Stronger India', accent: true },
]

export default function LoginScreen() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const tx = useT()
  const { login } = useAuth()
  const { language, t } = useAppLanguage()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState<UserFacingError | null>(null)
  const [langSheetOpen, setLangSheetOpen] = useState(false)
  // The focus ring is drawn on the rounded well, not on the bare input
  // inside it (the browser's own ring was a square box around the text).
  const [focused, setFocused] = useState<'phone' | 'password' | null>(null)
  const activeLanguage = APP_LANGUAGES.find((l) => l.code === language)
  // Cover the screen, anchored at the photo's foot, and grow it until the
  // ridge sits under the wordmark. A plain cover left the top third of a
  // tall phone as blown-out sky (grey slab in Dark); on 360 x 640 the ridge
  // already sits there, so nothing grows.
  const { width, height } = useWindowDimensions()
  const photoH = Math.max(height, (width * 16) / 9, (height - RIDGE_AT) / (1 - PHOTO_RIDGE))
  const photoW = (photoH * 9) / 16

  // Real-time phone validation
  const phoneValidation = useMemo(() => {
    if (!phone) return { isValid: false, error: undefined, normalized: '' }
    return normalizeAndValidatePhone(phone)
  }, [phone])

  const isFormValid = phoneValidation.isValid && password.trim().length > 0
  const submitOff = !isFormValid || isSubmitting

  async function handleSubmit() {
    if (isSubmitting || !isFormValid) return
    setIsSubmitting(true)
    setAuthError(null)

    try {
      // Pass normalized 10-digit phone and trimmed password
      await login(phoneValidation.normalized, password.trim())
    } catch (err) {
      setAuthError(categorizeAuthError(err))
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <View style={styles.root}>
      {/* The photo carries no information: hidden from screen readers. Dark
          veils it in neutral black; both themes darken the foot, where the
          trust row's light text sits. Never baked into the file. */}
      <Image
        source={PHOTOS.login.source()}
        style={{ position: 'absolute', bottom: 0, left: (width - photoW) / 2, width: photoW, height: photoH }}
        resizeMode="cover"
        accessible={false}
      />
      <View style={[styles.fill, styles.passThrough, { backgroundColor: COLORS.imageDim }]} />
      <View
        style={[
          styles.fill,
          styles.passThrough,
          gradient(
            `linear-gradient(180deg, ${COLORS.imageTopVeil} 0%, ${COLORS.imageTopVeil} 30%, transparent 48%, ` +
              `transparent 55%, ${COLORS.imageScrim} 86%, ${COLORS.imageScrim} 100%)`,
          ),
        ]}
      />

      <SafeAreaView style={styles.safe}>
        {/* Fixed above the scroll, so neither scrolls away on a short screen:
            the language pill top-right, and the Photo credits control
            top-left over the plain sky (at 360 x 640 it used to sit below the
            fold). The pill comes first in reading order; row-reverse puts it
            right. */}
        <View style={styles.topBar}>
          {/* The first control on the screen: a driver who cannot read
              English finds the language before anything else. The sheet
              holds search, recent and A-Z. */}
          <Pressable
            onPress={() => setLangSheetOpen(true)}
            style={styles.langSelector}
            accessibilityRole="button"
            accessibilityLabel={`Language: ${activeLanguage?.label ?? 'English'}. Opens language chooser`}
          >
            <Icon name="globe" size={18} color={COLORS.text} />
            <Text style={styles.langSelectorLabel}>
              {activeLanguage?.nativeLabel ?? 'English'}
            </Text>
            <Icon name="chevron-down" size={18} color={COLORS.textMuted} />
          </Pressable>
        </View>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ONE brand mark for both products: brand/mark.svg rendered to
                assets, the same file as the launcher icon. */}
            <View style={styles.brand}>
              <Image source={require('../../assets/brand-mark.png')} style={styles.logo} accessibilityLabel="RASTA AI" />
              <Text style={styles.wordmark} accessibilityRole="header">
                RASTA <Text style={styles.wordmarkAi}>AI</Text>
              </Text>
              <Text style={styles.subline}>NER LOGISTICS</Text>
            </View>

            <View style={styles.card}>
              {authError ? (
                <View style={styles.errorContainer}>
                  <Banner tone="bad" title={authError.title} detail={authError.detail} />
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>{t('login_phone_label')}</Text>
              <View
                style={[
                  styles.well,
                  phone.length > 0 && !phoneValidation.isValid && styles.wellError,
                  focused === 'phone' && styles.wellFocus,
                  focused === 'phone' && phone.length > 0 && !phoneValidation.isValid && styles.wellFocusError,
                ]}
              >
                <Icon name="phone" size={18} color={COLORS.text} />
                {/* A fixed label, not a country picker: it is not pressable. */}
                {phone.includes('@') ? null : (
                  <View style={styles.prefix}>
                    <Text style={styles.prefixText}>+91</Text>
                  </View>
                )}
                {phone.includes('@') ? null : <View style={styles.wellDivider} />}
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={(text) => {
                    setPhone(text)
                    if (authError) setAuthError(null)
                  }}
                  onFocus={() => setFocused('phone')}
                  onBlur={() => setFocused(null)}
                  placeholder={t('login_phone_placeholder')}
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="email-address"
                  autoComplete="tel"
                  editable={!isSubmitting}
                  maxLength={phone.includes('@') ? 120 : 16}
                  accessibilityLabel={t('login_phone_label')}
                />
              </View>
              {phone.length > 0 && !phoneValidation.isValid ? (
                <Text style={styles.inlineErrorText}>
                  {phoneValidation.error ?? 'Enter a valid 10-digit number'}
                </Text>
              ) : null}

              <Text style={[styles.fieldLabel, styles.fieldLabelNext]}>{t('login_pin_label')}</Text>
              <View style={[styles.well, focused === 'password' && styles.wellFocus]}>
                <Icon name="lock" size={18} color={COLORS.text} />
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text)
                    if (authError) setAuthError(null)
                  }}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder={t('login_pin_placeholder')}
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry={!showPassword}
                  returnKeyType="go"
                  onSubmitEditing={() => void handleSubmit()}
                  editable={!isSubmitting}
                  accessibilityLabel={t('login_pin_label')}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eye}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={20} color={COLORS.text} />
                </Pressable>
              </View>

              {/* Disabled look: the forest CTA at half strength (audit s16.3
                  #12), so the page keeps its one strong action. The logic is
                  unchanged: nothing is sent until both fields are complete,
                  and `isSubmitting` is the double-submit guard. */}
              <Pressable
                style={({ pressed }) => [
                  styles.submit,
                  submitOff && styles.submitOff,
                  pressed && !submitOff && styles.submitPressed,
                ]}
                onPress={handleSubmit}
                disabled={submitOff}
                accessibilityRole="button"
                accessibilityState={{ disabled: submitOff, busy: isSubmitting }}
                aria-disabled={submitOff}
                testID="login-submit"
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={COLORS.onPrimary} />
                ) : null}
                <Text style={styles.submitLabel}>
                  {isSubmitting ? t('login_submitting') : t('login_submit')}
                </Text>
                {isSubmitting ? null : <Icon name="arrow-right" size={20} color={COLORS.onPrimary} />}
              </Pressable>

              {/* Where the reference has "Forgot password?": the honest form
                  of it, which costs no tap. */}
              <Text style={styles.help}>
                {tx('Need access? Contact your fleet manager — driver accounts and passwords are managed by dispatch.')}
              </Text>
            </View>

            <View style={styles.spacer} />

            <View
              style={styles.trustRow}
              accessible
              accessibilityLabel={TRUST.map((item) => tx(item.label)).join('. ')}
            >
              {TRUST.map((item, i) => (
                <View key={item.label} style={styles.trustCell}>
                  {i > 0 ? <View style={styles.trustDivider} /> : null}
                  <Icon name={item.icon} size={24} color={item.accent ? COLORS.onPhotoAccent : COLORS.onPhoto} />
                  <Text style={styles.trustText}>{tx(item.label)}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <LanguageSheet open={langSheetOpen} onClose={() => setLangSheetOpen(false)} />
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  root: { flex: 1, backgroundColor: COLORS.bg, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  passThrough: { pointerEvents: 'none' },
  safe: { flex: 1 },
  flex: { flex: 1 },

  // Proportions from driver_01 at 450 x 800 CSS: pill at 14, mark 70-145,
  // wordmark 155-195, card from 225 at 74% of the width, trust row at 90%.
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  langSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    backgroundColor: COLORS.glass,
  },
  langSelectorLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },

  brand: { alignItems: 'center', marginTop: 4 },
  logo: { width: 76, height: 76, borderRadius: 18 },
  wordmark: { color: COLORS.text, fontSize: 28, fontWeight: '800', letterSpacing: 0.5, marginTop: 8 },
  wordmarkAi: { color: COLORS.brand },
  subline: { color: COLORS.brand, fontSize: 11, fontWeight: '700', letterSpacing: 3.5, marginTop: 2 },

  card: {
    width: '100%',
    maxWidth: 340,
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    backgroundColor: COLORS.glass,
    // Web only (react-native-web): the frost behind the card. Native draws
    // the same translucent card without the blur.
    backdropFilter: 'blur(14px)',
  },
  errorContainer: { marginBottom: 14 },
  fieldLabel: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 5,
  },
  fieldLabelNext: { marginTop: 12 },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 50,
    paddingLeft: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    backgroundColor: COLORS.glassWell,
  },
  wellError: { borderColor: COLORS.danger },
  wellFocus: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: COLORS.accent, outlineOffset: 1 },
  wellFocusError: { outlineColor: COLORS.danger },
  prefix: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  prefixText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  wellDivider: { width: 1, height: 22, backgroundColor: COLORS.borderStrong },
  input: {
    flex: 1,
    // A flex item's default minimum is its content, and a long placeholder
    // pushed the eye off a 320 dp screen. Zero lets the field shrink.
    minWidth: 0,
    minHeight: 48,
    paddingLeft: 4,
    paddingRight: 8,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    // The well draws the focus ring (wellFocus); web's own ring on the bare
    // input is switched off. A native TextInput draws none.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as object) : null),
  },
  inlineErrorText: { color: COLORS.danger, fontSize: 12, marginTop: 5, fontWeight: '600' },
  eye: { width: TOUCH_TARGET, minHeight: 48, alignItems: 'center', justifyContent: 'center' },

  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    // The 48 dp floor, not the app's 52: driver_01's CTA is 46.
    minHeight: 48,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  submitOff: { opacity: 0.5, backgroundColor: COLORS.primaryDisabled },
  submitPressed: { backgroundColor: COLORS.primaryHover },
  submitLabel: { color: COLORS.onPrimary, fontSize: 16, fontWeight: '700' },
  help: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 6 },

  spacer: { flexGrow: 1, minHeight: 20 },
  trustRow: { flexDirection: 'row', width: '100%', maxWidth: 380, alignItems: 'flex-start' },
  trustCell: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  trustDivider: { position: 'absolute', left: 0, top: 6, bottom: 2, width: 1, backgroundColor: COLORS.onPhoto, opacity: 0.35 },
  trustText: { color: COLORS.onPhoto, fontSize: 11, fontWeight: '600', lineHeight: 15, textAlign: 'center', maxWidth: 66 },
}))
