/**
 * Shared driver-app UI primitives.
 *
 * Every visible string these take (`label`, `title`, `detail`, `hint`,
 * `placeholder`) goes through `useT()` HERE, so a screen that writes
 * `<Button label="Try again" />` is localised without touching the screen:
 * the English is the key, a translation renders when i18n/tx.ts has one, and
 * the English itself otherwise. Already-translated text passes through
 * unchanged (there is no phrase keyed on it).
 */

import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { ApiError, NetworkError } from '../api/client'
import { useT } from '../i18n/tx'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  variant = 'primary',
}: {
  label: string
  onPress: () => void
  busy?: boolean
  disabled?: boolean
  /** `danger`: the red fill for a confirm that raises an emergency. */
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const ink = variant === 'secondary' ? COLORS.text : variant === 'danger' ? COLORS.onFill : COLORS.onPrimary
  // `busy` disables too - the double-submit guard. On a flaky mobile network a
  // driver will tap twice, and a duplicate verify must never be sent.
  const isOff = disabled || busy
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy }}
      // react-native-web reads the aria-* form; native reads both.
      aria-disabled={isOff}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && !isOff && (variant === 'secondary' ? { backgroundColor: COLORS.surfaceSoft } : variant === 'danger' ? styles.buttonDangerPressed : styles.buttonPressed),
        // Audit s16.3 #12: the same button at 50%, not a different pale one,
        // so "not yet" reads as this action, waiting. The screen shows why.
        isOff && !busy && (variant === 'primary' ? styles.buttonDisabled : styles.buttonOff),
      ]}
    >
      {busy ? (
        // The spinner takes the LABEL's colour, not always the light one. On
        // the mint primary a #F5F8F6 spinner is 2.1:1 — a driver watching to
        // see whether their tap registered gets a blank green box.
        <ActivityIndicator color={ink} />
      ) : (
        <Text style={[styles.buttonLabel, { color: ink }]}>{t(label)}</Text>
      )}
    </Pressable>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType,
  hint,
  autoCapitalize = 'none',
  onSubmitEditing,
  returnKeyType,
  multiline = false,
  maxLength,
  error,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'numeric' | 'phone-pad'
  hint?: string
  autoCapitalize?: 'none' | 'characters'
  /** Submit from the keyboard - drivers should not have to dismiss it first. */
  onSubmitEditing?: () => void
  returnKeyType?: 'go' | 'done' | 'next'
  /** A sentence rather than a value - an emergency reason, a note. */
  multiline?: boolean
  /** Mirrors the server's own limit. The backend is still authoritative;
   *  this stops a driver typing 900 characters only to be refused. */
  maxLength?: number
  /** What is wrong with the current value, shown under the field. The
   *  server still validates; this is so a typo is caught where it was made
   *  rather than reported back as a failed request. */
  error?: string
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{t(label)}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder === undefined ? undefined : t(placeholder)}
        placeholderTextColor={COLORS.textFaint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        multiline={multiline}
        maxLength={maxLength}
        style={[styles.input, multiline && styles.inputMultiline, error ? styles.inputBad : null]}
      />
      {error ? (
        <Text style={styles.fieldError} accessibilityLiveRegion="polite">
          {t(error)}
        </Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{t(hint)}</Text>
      ) : null}
    </View>
  )
}

export function Banner({
  tone,
  title,
  detail,
  style,
}: {
  tone: 'ok' | 'bad' | 'warn'
  title: string
  detail?: string
  /** A page that spaces its children with `gap` passes `{ marginBottom: 0 }`. */
  style?: StyleProp<ViewStyle>
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const toneStyle = {
    ok: { bg: COLORS.successSoft, border: COLORS.success, text: COLORS.success },
    bad: { bg: COLORS.dangerSoft, border: COLORS.dangerBorder, text: COLORS.danger },
    warn: { bg: COLORS.warningSoft, border: COLORS.warningBorder, text: COLORS.warning },
  }[tone]

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: toneStyle.bg, borderColor: toneStyle.border },
        style,
      ]}
    >
      <Text style={[styles.bannerTitle, { color: toneStyle.text }]}>{t(title)}</Text>
      {detail ? <Text style={styles.bannerDetail}>{t(detail)}</Text> : null}
    </View>
  )
}

/** Geography and route-hold codes (backend contract, 29 Sep 2026), read by
 *  CODE before the status: an OUTSIDE_SUPPORTED_COUNTRY 422 is not "check
 *  your entries", and a GEOGRAPHY_UNAVAILABLE 503 is not a server fault the
 *  driver caused. Calm wording: none of these is an emergency, and none
 *  names a country - the server decides what is inside, not this table. */
export const CODE_MESSAGES: Record<string, { title: string; detail: string }> = {
  OUTSIDE_SUPPORTED_COUNTRY: {
    title: 'Outside the supported country',
    detail: 'This location is outside the currently supported country.',
  },
  BORDER_AMBIGUOUS: {
    title: 'Location not confirmed yet',
    detail: 'This point is close to the international boundary, so it cannot be confirmed yet. Wait for a clearer GPS fix, or ask dispatch.',
  },
  GEOGRAPHY_UNAVAILABLE: {
    title: 'Location check unavailable',
    detail: 'Locations cannot be checked right now. Try again in a few minutes.',
  },
  HOLD_AND_REVIEW: {
    title: 'Route on hold',
    detail: 'Dispatch is reviewing the route for this trip. Wait for their instruction before you drive it.',
  },
}

/** Turns an exception into something a driver can act on. */
export function errorMessage(error: unknown): { title: string; detail: string } {
  if (error instanceof NetworkError) {
    return {
      title: 'No connection',
      detail:
        'Cannot confirm the server response. Check your signal and refresh the trip before retrying.',
    }
  }
  // By code first, whichever transport raised it: the REST ApiError or the
  // Supabase transport's plain Error with `.code` (supabaseApi.rethrow).
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(CODE_MESSAGES, code)) return CODE_MESSAGES[code]
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { title: 'Signed out', detail: 'Please sign in again.' }
    }
    if (error.status === 403) {
      return { title: 'Not allowed', detail: error.message }
    }
    if (error.status === 404) {
      // Generic on purpose. This message reaches trip, stop and location
      // actions as well as verification, and "nothing to verify" is confusing
      // copy for a driver who just tried to finish a stop.
      return { title: 'Nothing to do', detail: error.message }
    }
    if (error.status === 409) {
      return { title: 'Cannot do that now', detail: error.message }
    }
    if (error.status === 422) {
      return { title: 'Check your entries', detail: error.message }
    }
    return { title: 'Server problem', detail: error.message }
  }
  return { title: 'Something went wrong', detail: 'Please try again.' }
}

export function Loading({ label }: { label: string }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={COLORS.textMuted} />
      <Text style={styles.loadingLabel}>{t(label)}</Text>
    </View>
  )
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  const styles = useStyles()
  const t = useT()
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{t(label)}</Text>
      <Text style={styles.rowValue}>{typeof value === 'string' ? t(value) : value}</Text>
    </View>
  )
}

/**
 * A deliberate second tap before something that cannot be undone.
 *
 * WHY THIS EXISTS
 *
 * "Arrived" and "Delivered" were one tap each. A phone in a jacket pocket on
 * a hill road registers taps the driver did not make, and the first anyone
 * knew of it was a trip marked delivered outside the consignee's gate. The
 * cost of a wrong tap is asymmetric - an accidental arrival is a false
 * record in someone's audit trail, a deliberate one costs a second - so the
 * second tap is the right trade in exactly these places and nowhere else.
 *
 * WHAT IT IS NOT
 *
 * Not a general "are you sure?" wrapper. Put it on an irreversible action
 * with a real consequence and nothing else; a confirmation on every button
 * teaches drivers to dismiss confirmations.
 *
 * `detail` says what will actually happen, in the driver's language. A modal
 * that only says "Are you sure?" transfers no information and is dismissed
 * as fast as the button it guards.
 */
export function ConfirmSheet({
  visible,
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  tone = 'normal',
  confirmDisabled = false,
  children,
}: {
  visible: boolean
  title: string
  detail: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  /** `danger` for something that ends or interrupts a job. */
  tone?: 'normal' | 'danger'
  /** The confirmation is not ready (a reason too short): the button shows
   *  it at 50% with aria-disabled, and `children` say why. */
  confirmDisabled?: boolean
  /** Extra input the confirmation itself requires - a mandatory reason. */
  children?: ReactNode
}) {
  const styles = useStyles()
  const t = useT()
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's back button must cancel, never confirm.
      onRequestClose={onCancel}
    >
      <View style={styles.confirmBackdrop}>
        <View style={styles.confirmSheet} accessibilityViewIsModal accessibilityRole="alert">
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.confirmTitle}>{t(title)}</Text>
            <Text style={styles.confirmDetail}>{t(detail)}</Text>
            {children}
          </ScrollView>
          <View style={styles.confirmActions}>
            <View style={styles.confirmAction}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
            </View>
            <View style={styles.confirmAction}>
              <Button
                label={confirmLabel}
                onPress={onConfirm}
                busy={busy}
                disabled={confirmDisabled}
                variant={tone === 'danger' ? 'danger' : 'primary'}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const useStyles = makeStyles((COLORS) => ({
  button: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonPressed: { backgroundColor: COLORS.primaryHover },
  buttonDisabled: { opacity: 0.5, backgroundColor: COLORS.primaryDisabled },
  buttonOff: { opacity: 0.5 },
  // dangerStrong, the red that carries white (onFill) in both themes.
  buttonDanger: { backgroundColor: COLORS.dangerStrong },
  buttonDangerPressed: { opacity: 0.85 },
  buttonLabel: { color: COLORS.text, fontSize: 16, fontWeight: '700' },

  confirmBackdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  confirmSheet: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    maxHeight: '80%',
    gap: 16,
  },
  confirmTitle: { color: COLORS.text, fontSize: 19, fontWeight: '800' },
  confirmDetail: { color: COLORS.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 },
  confirmActions: { flexDirection: 'row', gap: 12 },
  confirmAction: { flex: 1 },

  field: { marginBottom: 16 },
  fieldLabel: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    // `borderStrong` and a sunken well, not `border` on a card: a box you may
    // type into has to look different from a box you may only read. On `surface`
    // the old input was the same colour as the panel behind it, so the field
    // was located entirely by its 1px hairline.
    borderColor: COLORS.borderStrong,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceSunken,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  inputBad: {
    borderColor: COLORS.danger,
  },
  fieldError: {
    color: COLORS.danger,
    fontSize: 12,
    marginTop: 4,
  },
  fieldHint: { color: COLORS.textFaint, fontSize: 12, marginTop: 6 },

  banner: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  bannerDetail: { color: COLORS.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 },

  loading: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingLabel: { color: COLORS.textMuted, fontSize: 14 },

  // The divider above each row, not below: below, the last row's hairline
  // sat a padding away from its card's own border - a double line at the
  // foot of every card (B3D-R11).
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 16,
  },
  rowLabel: { color: COLORS.textMuted, fontSize: 14 },
  rowValue: { color: COLORS.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
}))
