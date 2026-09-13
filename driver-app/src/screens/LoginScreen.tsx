import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'

export default function LoginScreen() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const { login } = useAuth()
  const { language, setLanguage, t } = useAppLanguage()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState<UserFacingError | null>(null)
  const [langSheetOpen, setLangSheetOpen] = useState(false)
  const activeLanguage = APP_LANGUAGES.find((l) => l.code === language)

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
        {/* HERO. Drawn, not photographed: this repo ships no photography, and
            inventing a stock Northeast highway shot would put a picture of a
            road we do not operate behind a sign-in. Three stacked ridge
            silhouettes over the deep ground read as terrain at a glance and
            cost no asset, no bundle weight and no licence. To use a real
            photo later, wrap this View in <ImageBackground> - the card below
            already floats over it. */}
        <View style={styles.hero}>
          <View style={[styles.ridge, styles.ridgeBack]} />
          <View style={[styles.ridge, styles.ridgeMid]} />
          <View style={[styles.ridge, styles.ridgeFront]} />
        </View>

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
              <Text style={styles.motto}>MOVE SAFER · GO FURTHER</Text>
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

        {/* One control, not five. A row of chips cannot hold the languages
            this product intends to support - at five it already filled the
            width on a 360pt screen, and every added language would shrink the
            others below the touch target. The sheet scales; the row did not.
            No search box: with five options a filter field is more chrome than
            the list it filters. Add one past ~8 languages. */}
        <Pressable
          onPress={() => setLangSheetOpen(true)}
          style={styles.langSelector}
          accessibilityRole="button"
          accessibilityLabel={`Language: ${activeLanguage?.label ?? 'English'}. Opens language chooser`}
        >
          <Text style={styles.langSelectorLabel}>
            {activeLanguage?.nativeLabel ?? 'English'}
          </Text>
          <Text style={styles.langSelectorChevron}>▾</Text>
        </Pressable>

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
                <ActivityIndicator size="small" color={COLORS.onAccent} />
                <Text style={[styles.submitButtonLabel, styles.submitButtonLabelOff]}>
                  {t('login_submitting').toUpperCase()}
                </Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.submitButtonLabel,
                    !isFormValid && styles.submitButtonLabelOff,
                  ]}
                >
                  {t('login_submit')}
                </Text>
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
          {/* This is what the removed "Forgot password?" link actually did:
              it opened an alert saying dispatch manages passwords. A link
              shaped like a reset flow, which was not one. The sentence is the
              honest form of it, and it costs no tap. */}
          <Text style={styles.footer}>
            Need access? Contact your fleet manager — driver accounts and
            passwords are managed by dispatch.
          </Text>
          <Text style={styles.mottoFooter}>Safe Routes. Stronger India.</Text>
        </View>

        {/* THE DIAGNOSTICS TOGGLE WAS REMOVED, not merely hidden.
            `__DEV__` is true for Expo web and for every debug build, so
            "Debug connection details" was sitting on the sign-in screen of the
            build used to demo this product. Connection diagnostics belong to
            whoever is running the server, and that person has the server. */}

      </ScrollView>

      {/* Bottom sheet. RN's own Modal - no sheet dependency for a list of five.
          `transparent` + a pressable scrim gives tap-outside-to-close, and
          onRequestClose wires the Android back button, which a custom overlay
          would silently drop. */}
      <Modal
        visible={langSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLangSheetOpen(false)}
      >
        {/* flex-end wrapper + absolutely-filled scrim. A scrim with `flex: 1`
            as a Modal's first child consumed the whole height and pushed the
            sheet off the bottom of the screen. */}
        <View style={styles.sheetRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close language chooser"
            onPress={() => setLangSheetOpen(false)}
          />
          <View style={styles.sheet}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>{t('common_change_language')}</Text>
          {APP_LANGUAGES.map((opt) => {
            const selected = opt.code === language
            return (
              <Pressable
                key={opt.code}
                onPress={() => {
                  void setLanguage(opt.code)
                  setLangSheetOpen(false)
                }}
                style={[styles.sheetRow, selected && styles.sheetRowActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={styles.sheetRowText}>
                  <Text style={styles.sheetNative}>{opt.nativeLabel}</Text>
                  <Text style={styles.sheetLatin}>{opt.label}</Text>
                </View>
                {/* A tick, not colour alone: the selected row must survive a
                    colour-vision deficiency and a sunlit windscreen. */}
                {selected ? <Text style={styles.sheetTick}>✓</Text> : null}
              </Pressable>
            )
            })}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  flex: { flex: 1, backgroundColor: COLORS.bg },

  // Hero occupies the top third and sits BEHIND the brand block, which is why
  // it is absolutely positioned rather than a sibling in flow.
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 250,
    // No background and no clipping. Painting the hero a different shade drew
    // a hard seam across the login card; clipping rotated squares drew the
    // same seam a second way, as a flat cut through the peaks. Real triangles
    // need neither - they end in a point on their own.
    backgroundColor: 'transparent',
  },
  // Border-triangles, the same trick the logo mark already uses (see
  // logoPeakBack/Front): transparent left and right borders over a coloured
  // bottom border. Self-contained silhouettes, so nothing has to be clipped
  // and no horizontal edge can appear where a container ends.
  // Bases are STAGGERED on purpose. Aligned at one baseline the three
  // silhouettes merged into a single unbroken horizontal edge running the full
  // width of the screen and straight past the login card - a box edge, not a
  // horizon. Different baselines break it into layered hills. Fills sit only a
  // few steps off the page ground for the same reason: at higher contrast this
  // stops being a backdrop and starts competing with the form.
  //
  // FROM THE PALETTE, NOT HARD-CODED. These were three night hexes that never
  // got a day value, so in Day mode near-black hills were drawn straight
  // through 'Welcome back' - dark shape under dark heading. Three tokens that
  // are distinct steps in BOTH palettes keep the layering and keep the
  // heading readable either way.
  ridge: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ridgeBack: {
    bottom: 34,
    left: -30,
    borderLeftWidth: 130,
    borderRightWidth: 130,
    borderBottomWidth: 150,
    borderBottomColor: COLORS.border,
  },
  ridgeMid: {
    bottom: 0,
    left: 150,
    borderLeftWidth: 160,
    borderRightWidth: 160,
    borderBottomWidth: 190,
    borderBottomColor: COLORS.borderStrong,
  },
  ridgeFront: {
    bottom: 58,
    left: 60,
    borderLeftWidth: 110,
    borderRightWidth: 110,
    borderBottomWidth: 120,
    borderBottomColor: COLORS.sunken,
  },
  langSelector: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.raised,
    marginBottom: 16,
  },
  langSelectorLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  langSelectorChevron: { color: COLORS.muted, fontSize: 13, fontWeight: '800' },

  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,17,22,0.72)' },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
    marginBottom: 14,
  },
  sheetTitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sheetRowActive: { backgroundColor: COLORS.routeBg, borderColor: COLORS.route },
  sheetRowText: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexShrink: 1 },
  sheetNative: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  sheetLatin: { color: COLORS.faint, fontSize: 13 },
  sheetTick: { color: COLORS.routeOn, fontSize: 16, fontWeight: '900' },
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
  // overflow:hidden. Brand mint behind, route blue in front - the ridge and the
  // corridor through it, in the same relationship they have on the manager
  // sign-in mark. The front peak must NOT be `accent`: that is the Sign In
  // button's colour eight points below, and a logo in the CTA colour reads as
  // a second button.
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
    borderBottomColor: COLORS.route,
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
    color: COLORS.text,
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
    color: COLORS.faint,
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
  // Selection is BLUE, not green. Green is the primary action colour in this
  // system (the Sign In bar) and it also means "verified / safe" on the safety
  // screens. Spending it on "which language is selected" made the language
  // picker compete with the CTA directly below it and diluted the one colour
  // the driver most needs to read correctly.
  // A floating panel, so Terrain's sheet radius of 20. Heavy drop shadow
  // removed: on a charcoal ground it rendered as a smudge, not elevation.
  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    padding: 20,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    color: COLORS.muted,
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
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    backgroundColor: COLORS.sunken,
    overflow: 'hidden',
  },
  inputErrorBorder: {
    borderColor: COLORS.bad,
  },
  countryCodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.raised,
    paddingHorizontal: 12,
    height: '100%',
    gap: 6,
  },
  countryCodeText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  badgeDivider: {
    width: 1,
    height: 20,
    backgroundColor: COLORS.borderStrong,
    marginLeft: 4,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  inlineErrorText: {
    color: COLORS.bad,
    fontSize: 12,
    marginTop: 5,
    fontWeight: '500',
  },
  passwordInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    backgroundColor: COLORS.sunken,
  },
  lockIconBadge: {
    paddingLeft: 14,
    paddingRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordInput: {
    flex: 1,
    // A flex item's default minimum is its content, and a long placeholder
    // pushed the SHOW toggle off a 320 dp screen. Zero lets the field shrink.
    minWidth: 0,
    paddingHorizontal: 8,
    color: COLORS.text,
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
  // Radius 12, not 28. A full pill on a 56pt bar reads as a consumer app; the
  // rest of this product uses 10-12. The green glow (shadowRadius 10 at 0.35
  // opacity, in the button's own colour) was a permanent halo - the design
  // system forbids constant glow, and on an OLED dash mount at night it bloomed.
  submitButton: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  submitButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.disabled,
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
  // `onAccent` is the DARK label Terrain's night action requires - 9.2:1 on
  // the mint fill. It is only correct while that fill is mint: on the disabled
  // charcoal it is 1.3:1, i.e. an invisible button. The submitting state uses
  // the same off-label because that fill is disabled too.
  submitButtonLabelOff: {
    color: COLORS.muted,
  },
  submitButtonLabel: {
    color: COLORS.onAccent,
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
    backgroundColor: COLORS.border,
  },
  dividerText: {
    color: COLORS.faint,
    fontSize: 12,
    fontWeight: '600',
  },
  biometricsButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.sunken,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  biometricsIcon: {
    fontSize: 18,
  },
  biometricsText: {
    color: COLORS.muted,
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
    color: COLORS.faint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  mottoFooter: {
    color: COLORS.dim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginTop: 4,
  },
}))
