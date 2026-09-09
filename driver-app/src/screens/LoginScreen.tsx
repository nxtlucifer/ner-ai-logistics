import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { useAuth } from '../auth/AuthProvider'
import { normalizeAndValidatePhone } from '../auth/phone'
import { categorizeAuthError, type UserFacingError } from '../auth/authErrors'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { APP_LANGUAGES } from '../i18n/appLanguage'
import { Banner } from '../components/ui'
import { COLORS } from '../theme'

export default function LoginScreen() {
  const { login } = useAuth()
  const { language, setLanguage, t } = useAppLanguage()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState<UserFacingError | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  // Real-time phone validation
  const phoneValidation = useMemo(() => {
    if (!phone) return { isValid: false, error: undefined, normalized: '' }
    return normalizeAndValidatePhone(phone)
  }, [phone])

  const isFormValid = phoneValidation.isValid && password.trim().length > 0

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

  function handleForgotPassword() {
    Alert.alert(
      'Reset Driver Password',
      'Driver accounts are managed by fleet dispatch. Please contact your depot manager or dispatch to reset your password.',
      [{ text: 'OK' }],
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Mountain Branding Header */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logoBadge}>
              {/* Drawn, not typed. "▲▲" rendered as an emoji on some Android
                  builds and as a serif glyph on others, so the brand mark
                  changed shape by device. Two rotated squares are identical
                  everywhere and need no font. */}
              <View style={styles.logoPeakBack} />
              <View style={styles.logoPeakFront} />
            </View>
            <View style={styles.brandTextGroup}>
              <Text style={styles.orgTag}>NER LOGISTICS</Text>
              <Text style={styles.motto}>MOVE · CONNECT · DELIVER</Text>
            </View>
          </View>

          <Text style={styles.title}>DRIVER</Text>
          {/* LOCALISED, because the rest of this screen is.
              These two lines were hardcoded English while every field label
              below them translated, so a driver who picked Assamese got a
              half-translated sign-in - on the first screen of a product whose
              whole claim is regional accessibility. The keys already existed
              and were unused, carrying stale copy ("Terrain Command Industrial
              Edition"); they now carry what is actually on screen.

              One support line, not two: "Safe routes. Connected fleet." and
              "Sign in to continue your journey" said the same thing twice and
              pushed the phone field down a 390pt screen. */}
          <Text style={styles.welcomeTitle}>{t('login_title')}</Text>
          <Text style={styles.subtitle}>{t('login_subtitle')}</Text>
        </View>

        {/* Categorized Safe Error Banner */}
        {authError ? (
          <View style={styles.errorContainer}>
            <Banner tone="bad" title={authError.title} detail={authError.detail} />
          </View>
        ) : null}

        {/* Language Selection Row */}
        <View style={styles.langSelectorRow}>
          {APP_LANGUAGES.map((opt) => (
            <Pressable
              key={opt.code}
              onPress={() => void setLanguage(opt.code)}
              style={[
                styles.langChip,
                language === opt.code && styles.langChipActive,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: language === opt.code }}
              accessibilityLabel={`Select ${opt.label}`}
            >
              <Text
                style={[
                  styles.langChipText,
                  language === opt.code && styles.langChipTextActive,
                ]}
              >
                {opt.nativeLabel}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Main Login Card */}
        <View style={styles.card}>
          {/* Phone Field */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('login_phone_label')}</Text>
            <View
              style={[
                styles.phoneInputRow,
                phone.length > 0 && !phoneValidation.isValid && styles.inputErrorBorder,
              ]}
            >
              {/* No flag emoji. Android renders 🇮🇳 as the letters "IN" in a box
                  on most builds anyway, which is what this now says on purpose
                  and identically on every device. */}
              <View style={styles.countryCodeBadge}>
                <Text style={styles.countryCodeText}>+91</Text>
                <View style={styles.badgeDivider} />
              </View>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(text) => {
                  setPhone(text)
                  if (authError) setAuthError(null)
                }}
                placeholder="94300 00777"
                placeholderTextColor={COLORS.faint}
                keyboardType="phone-pad"
                autoComplete="tel"
                editable={!isSubmitting}
                maxLength={16}
              />
            </View>
            {phone.length > 0 && !phoneValidation.isValid ? (
              <Text style={styles.inlineErrorText}>
                {phoneValidation.error ?? 'Enter a valid 10-digit number'}
              </Text>
            ) : null}
          </View>

          {/* Password Field */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('login_pin_label')}</Text>
            <View style={styles.passwordInputRow}>
              <View style={styles.lockIconBadge}>
                {/* Drawn padlock: shackle arc over a body. Two Views, no font,
                    no emoji colour-scheme surprises across Android versions. */}
                <View style={styles.lockShackle} />
                <View style={styles.lockBody} />
              </View>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={(text) => {
                  setPassword(text)
                  if (authError) setAuthError(null)
                }}
                placeholder={t('login_pin_placeholder')}
                placeholderTextColor={COLORS.faint}
                secureTextEntry={!showPassword}
                returnKeyType="go"
                onSubmitEditing={() => void handleSubmit()}
                editable={!isSubmitting}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.visibilityButton}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                {/* A word, not an eye. The two eye emoji differ by a single
                    variation selector - 👁️ vs 👁️‍🗨️ - which most Android fonts
                    render identically, so the control gave no feedback about
                    which state it was in. This says which state it is in. */}
                <Text style={styles.visibilityText}>
                  {showPassword ? 'HIDE' : 'SHOW'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/*
            "REMEMBER ME" WAS REMOVED, NOT RESTYLED.

            It was a checkbox, checked by default, whose value nothing read:
            `rememberMe` never reached `login()`, was never persisted, and
            changed no behaviour at all. It also promised something the app
            already does unconditionally - `supabaseClient` sets
            `persistSession: true` on native with keystore-backed storage, so a
            driver stays signed in across a force-close whether the box is
            ticked or not.

            Implementing it for real would mean either storing the raw password
            or making the session deliberately WORSE when unticked. Neither is
            worth doing for a single-user work phone, so the honest move is to
            delete the control rather than wire a checkbox to a lie.
          */}
          <View style={styles.optionsRow}>
            <Pressable
              onPress={handleForgotPassword}
              style={styles.forgotBtn}
              accessibilityRole="button"
              accessibilityHint="Explains how to get your password reset"
            >
              <Text style={styles.forgotText}>{t('login_forgot')}</Text>
            </Pressable>
          </View>

          {/* Submit Button */}
          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              (!isFormValid || isSubmitting) && styles.submitButtonDisabled,
              pressed && isFormValid && !isSubmitting && styles.submitButtonPressed,
            ]}
            onPress={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.submitButtonLabel}>{t('login_submitting').toUpperCase()}</Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text style={styles.submitButtonLabel}>{t('login_submit')}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Footer */}
        <View style={styles.footerSection}>
          <View style={styles.secureRow}>
            <View style={styles.secureDot} />
            <Text style={styles.secureBadge}>Secure driver access</Text>
          </View>
          <Text style={styles.footer}>
            Your manager creates your account. If you cannot sign in, ask them to check your
            assigned phone number.
          </Text>
          <Text style={styles.mottoFooter}>Safe Routes. Stronger India.</Text>
        </View>

        {/* Diagnostics: strictly DEV-ONLY. Omitted in release APK */}
        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <View style={styles.devSection}>
            <Pressable
              onPress={() => setShowDiagnostics((v) => !v)}
              accessibilityRole="button"
              style={styles.diagnosticsToggle}
            >
              <Text style={styles.diagnosticsLabel}>
                {showDiagnostics ? 'Hide debug details' : 'Debug connection details'}
              </Text>
            </Pressable>
            {showDiagnostics ? (
              <Text style={styles.server} testID="api-origin">
                Diagnostics: Debug Environment
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0B1016' },
  container: {
    paddingHorizontal: 22,
    paddingTop: 36,
    paddingBottom: 32,
    justifyContent: 'center',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  header: { marginBottom: 20 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  // The brand peaks, drawn as two rotated squares clipped by logoBadge's
  // overflow:hidden. Aqua behind, blue in front - the two brand colours, in the
  // same relationship they have on the manager sign-in mark.
  logoPeakBack: {
    position: 'absolute',
    right: 6,
    bottom: 9,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.aqua,
  },
  logoPeakFront: {
    position: 'absolute',
    left: 5,
    bottom: 9,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.accent,
  },
  // Padlock: an arc of border for the shackle, a filled body under it.
  lockShackle: {
    width: 10,
    height: 7,
    borderWidth: 1.6,
    borderBottomWidth: 0,
    borderColor: COLORS.muted,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    marginBottom: -1,
  },
  lockBody: {
    width: 14,
    height: 10,
    borderRadius: 2.5,
    backgroundColor: COLORS.muted,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  secureDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.ok,
  },

  logoBadge: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  brandTextGroup: {
    flexDirection: 'column',
  },
  orgTag: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  motto: {
    color: COLORS.aqua,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 1,
  },
  title: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  welcomeTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 4,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  errorContainer: {
    marginBottom: 16,
  },
  // A single row. Wrapping five pills onto two lines pushed the phone field
  // down and made the selector look like a tag cloud rather than a control.
  langSelectorRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    marginBottom: 16,
  },
  langChip: {
    flexShrink: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  // Selection is BLUE, not green. Green is the primary action colour in this
  // system (the Sign In bar) and it also means "verified / safe" on the safety
  // screens. Spending it on "which language is selected" made the language
  // picker compete with the CTA directly below it and diluted the one colour
  // the driver most needs to read correctly.
  langChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#132A4D',
  },
  langChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  langChipTextActive: {
    color: '#93B4FF',
    fontWeight: '800',
  },
  // A floating panel, so 18. Heavy drop shadow removed: on a #0B1016 ground it
  // rendered as a smudge rather than elevation.
  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 20,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1016',
    overflow: 'hidden',
  },
  inputErrorBorder: {
    borderColor: '#EF4444',
  },
  countryCodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    height: '100%',
    gap: 6,
  },
  countryCodeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  badgeDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#334155',
    marginLeft: 4,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  inlineErrorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 5,
    fontWeight: '500',
  },
  passwordInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1016',
  },
  lockIconBadge: {
    paddingLeft: 14,
    paddingRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 8,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  visibilityButton: {
    paddingHorizontal: 16,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visibilityText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Was space-between, for the two controls this row used to hold. With only
    // the forgot-password link left, that pinned it to the left margin where it
    // read as a stray label; flex-end puts it under the password field it
    // refers to.
    justifyContent: 'flex-end',
    marginBottom: 18,
    marginTop: 2,
  },
  forgotBtn: {
    paddingVertical: 4,
  },
  forgotText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
  },
  // Radius 12, not 28. A full pill on a 56pt bar reads as a consumer app; the
  // rest of this product uses 10-12. The green glow (shadowRadius 10 at 0.35
  // opacity, in the button's own colour) was a permanent halo - the design
  // system forbids constant glow, and on an OLED dash mount at night it bloomed.
  submitButton: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: COLORS.ok,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  submitButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  submitButtonDisabled: {
    backgroundColor: '#334155',
    shadowOpacity: 0,
    elevation: 0,
    opacity: 0.6,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1E293B',
  },
  dividerText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  biometricsButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  biometricsIcon: {
    fontSize: 18,
  },
  biometricsText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '700',
  },
  footerSection: {
    marginTop: 24,
    alignItems: 'center',
    gap: 6,
  },
  secureBadge: {
    color: COLORS.ok,
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  mottoFooter: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  devSection: {
    marginTop: 20,
    alignItems: 'center',
  },
  diagnosticsToggle: {
    minHeight: 44,
    justifyContent: 'center',
  },
  diagnosticsLabel: {
    color: '#475569',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  server: {
    color: '#475569',
    fontSize: 11,
    marginTop: 6,
  },
})
