/** Shared driver-app UI primitives. */

import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { ApiError, NetworkError } from '../api/client'
import { COLORS, TOUCH_TARGET } from '../theme'

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
  variant?: 'primary' | 'secondary'
}) {
  // `busy` disables too - the double-submit guard. On a flaky mobile network a
  // driver will tap twice, and a duplicate verify must never be sent.
  const isOff = disabled || busy
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy }}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        pressed && !isOff && styles.buttonPressed,
        isOff && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={COLORS.text} />
      ) : (
        <Text style={styles.buttonLabel}>{label}</Text>
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
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.faint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        style={styles.input}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  )
}

export function Banner({
  tone,
  title,
  detail,
}: {
  tone: 'ok' | 'bad' | 'warn'
  title: string
  detail?: string
}) {
  const toneStyle = {
    ok: { bg: COLORS.okBg, border: COLORS.ok, text: COLORS.ok },
    bad: { bg: COLORS.badBg, border: COLORS.badBorder, text: COLORS.bad },
    warn: { bg: COLORS.warnBg, border: COLORS.warnBorder, text: COLORS.warn },
  }[tone]

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: toneStyle.bg, borderColor: toneStyle.border },
      ]}
    >
      <Text style={[styles.bannerTitle, { color: toneStyle.text }]}>{title}</Text>
      {detail ? <Text style={styles.bannerDetail}>{detail}</Text> : null}
    </View>
  )
}

/** Turns an exception into something a driver can act on. */
export function errorMessage(error: unknown): { title: string; detail: string } {
  if (error instanceof NetworkError) {
    return {
      title: 'No connection',
      detail:
        'Cannot reach the server. Check your signal and try again - nothing was sent.',
    }
  }
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
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={COLORS.muted} />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  )
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 20,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonPressed: { backgroundColor: COLORS.accentPressed },
  buttonDisabled: { backgroundColor: COLORS.disabled },
  buttonLabel: { color: COLORS.text, fontSize: 16, fontWeight: '700' },

  field: { marginBottom: 16 },
  fieldLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: '#020617',
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 16,
  },
  fieldHint: { color: COLORS.faint, fontSize: 12, marginTop: 6 },

  banner: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 16 },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  bannerDetail: { color: COLORS.muted, fontSize: 13, marginTop: 6, lineHeight: 19 },

  loading: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingLabel: { color: COLORS.muted, fontSize: 14 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 16,
  },
  rowLabel: { color: COLORS.muted, fontSize: 14 },
  rowValue: { color: COLORS.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
})
