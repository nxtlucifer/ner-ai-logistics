/**
 * NER Driver App.
 *
 * Three screens: sign in, your truck, your trip. Nothing else is real yet, so
 * nothing else is shown.
 */

import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'

import { AuthProvider, useAuth } from './src/auth/AuthProvider'
import { Button, Loading } from './src/components/ui'
import AssignmentScreen from './src/screens/AssignmentScreen'
import LoginScreen from './src/screens/LoginScreen'
import TripScreen from './src/screens/TripScreen'
import { COLORS, TOUCH_TARGET } from './src/theme'

type Tab = 'trip' | 'truck'

function Signed() {
  const { driver, logout } = useAuth()
  // Trip first: once a driver has checked their truck, the trip is what they
  // open the app for.
  const [tab, setTab] = useState<Tab>('trip')

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>
            {driver?.full_name ?? 'Driver'}
          </Text>
          <Text style={styles.licence}>{driver?.licence_number}</Text>
        </View>
        <Button label="Sign out" variant="secondary" onPress={() => void logout()} />
      </View>

      <View style={styles.tabs}>
        {(['trip', 'truck'] as Tab[]).map((value) => (
          <Pressable
            key={value}
            onPress={() => setTab(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            style={[styles.tab, tab === value && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === value && styles.tabLabelActive]}>
              {value === 'trip' ? 'Trip' : 'Truck'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.flex}>
        {tab === 'trip' ? <TripScreen /> : <AssignmentScreen />}
      </View>
    </SafeAreaView>
  )
}

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

  return driver ? <Signed /> : <LoginScreen />
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
  flex: { flex: 1, backgroundColor: COLORS.bg },
  centre: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  headerText: { flexShrink: 1 },
  name: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  licence: { color: COLORS.faint, fontSize: 12, marginTop: 2 },

  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  tab: {
    minHeight: TOUCH_TARGET - 12,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.card, borderColor: COLORS.accent },
  tabLabel: { color: COLORS.muted, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: COLORS.text },
})
