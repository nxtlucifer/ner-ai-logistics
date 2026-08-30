import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { API_BASE_URL } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Banner, Button, Field, errorMessage } from '../components/ui'
import { COLORS } from '../theme'

export default function LoginScreen() {
  const { login } = useAuth()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)

  async function handleSubmit() {
    if (isSubmitting) return // double-submit guard
    setIsSubmitting(true)
    setError(null)
    try {
      await login(phone.trim(), password)
    } catch (err) {
      setError(errorMessage(err))
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
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>NER Driver</Text>
        <Text style={styles.subtitle}>Sign in with your phone number</Text>

        {error ? (
          <Banner tone="bad" title={error.title} detail={error.detail} />
        ) : null}

        <View style={styles.card}>
          <Field
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            placeholder="9435012345"
            keyboardType="phone-pad"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={() => void handleSubmit()}
          />
          <Button
            label={isSubmitting ? 'Signing in…' : 'Sign in'}
            onPress={handleSubmit}
            busy={isSubmitting}
            disabled={!phone.trim() || !password}
          />
        </View>

        <Text style={styles.footer}>
          Your manager creates your account. If you cannot sign in, ask them to
          check your phone number.
        </Text>
        <Text style={styles.server}>{API_BASE_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { padding: 24, paddingTop: 72 },
  title: { color: COLORS.text, fontSize: 30, fontWeight: '800' },
  subtitle: { color: COLORS.muted, fontSize: 15, marginTop: 6, marginBottom: 28 },
  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 20,
  },
  footer: {
    color: COLORS.faint,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 28,
  },
  server: { color: COLORS.faint, fontSize: 11, marginTop: 16 },
})
