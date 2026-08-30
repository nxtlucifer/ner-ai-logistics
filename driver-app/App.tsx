/**
 * NER Driver App.
 *
 * Two screens: sign in, and your current assignment. Nothing else is real yet,
 * so nothing else is shown. GPS, trips and safety check-ins arrive in P5.
 */

import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet, View } from 'react-native'

import { AuthProvider, useAuth } from './src/auth/AuthProvider'
import { Loading } from './src/components/ui'
import AssignmentScreen from './src/screens/AssignmentScreen'
import LoginScreen from './src/screens/LoginScreen'
import { COLORS } from './src/theme'

function Gate() {
  const { driver, isInitialising } = useAuth()

  // Distinct from "signed out": showing the login form during the silent
  // refresh would flash it every time a driver reopens the app.
  if (isInitialising) {
    return (
      <SafeAreaView style={styles.centre}>
        <Loading label="Signing you in…" />
      </SafeAreaView>
    )
  }

  return driver ? <AssignmentScreen /> : <LoginScreen />
}

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  centre: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },
})
