/**
 * The driver's current assignment, and truck verification.
 *
 * There is no map, no tracking indicator and no GPS status here. None of that
 * exists yet, and a decorative version would be indistinguishable from a
 * working one - which is exactly the sort of thing that gets believed.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { api, type CurrentAssignment } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Banner, Button, Field, Loading, Row, errorMessage } from '../components/ui'
import { COLORS } from '../theme'

type Status = 'loading' | 'ready' | 'error'

interface ParsedReadings {
  odometerKm?: string
  fuelPct?: number
  error?: { title: string; detail: string }
}

/**
 * Validate the two numeric fields before anything is sent.
 *
 * Blank means "not reported", which is legitimate. Anything present must be a
 * real number in range, because the alternative is a verification record that
 * looks complete and is not.
 */
function parseReadings(input: { odometer: string; fuel: string }): ParsedReadings {
  const out: ParsedReadings = {}

  const odometer = input.odometer.trim()
  if (odometer) {
    const value = Number(odometer)
    if (!Number.isFinite(value) || value < 0) {
      return {
        error: {
          title: 'Check the odometer',
          detail: 'Enter the kilometres shown on the dial, digits only.',
        },
      }
    }
    // Sent as a string: the column is NUMERIC(10,1) and a float round-trip
    // would be the one place money-and-measurement precision quietly degrades.
    out.odometerKm = odometer
  }

  const fuel = input.fuel.trim()
  if (fuel) {
    const value = Number(fuel)
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return {
        error: {
          title: 'Check the fuel level',
          detail: 'Enter a whole percentage between 0 and 100.',
        },
      }
    }
    out.fuelPct = value
  }

  return out
}

export default function AssignmentScreen() {
  const { driver, logout } = useAuth()

  const [status, setStatus] = useState<Status>('loading')
  const [assignment, setAssignment] = useState<CurrentAssignment | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [registration, setRegistration] = useState('')
  const [odometer, setOdometer] = useState('')
  const [fuel, setFuel] = useState('')
  const [damage, setDamage] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [verifyError, setVerifyError] = useState<{
    title: string
    detail: string
  } | null>(null)
  const [justVerified, setJustVerified] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await api.myAssignment()
      setAssignment(result)
      setLoadError(null)
      setStatus('ready')
    } catch (err) {
      setLoadError(err)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onPullToRefresh() {
    setIsRefreshing(true)
    await load()
    setIsRefreshing(false)
  }

  async function handleVerify() {
    if (isSubmitting || !assignment) return // double-submit guard

    // Checked here rather than left to the server. `Number('abc')` is NaN, and
    // JSON.stringify turns NaN into null - so a typo would reach the backend as
    // "no reading given" and be recorded as a completed check with a blank
    // odometer. The fuel field is also an integer server-side, and Android's
    // numeric keypad happily offers a decimal point.
    const readings = parseReadings({ odometer, fuel })
    if (readings.error) {
      setVerifyError(readings.error)
      return
    }

    setIsSubmitting(true)
    setVerifyError(null)
    try {
      const result = await api.verifyAssignment({
        // Sending the id we are showing lets the server reject a stale screen
        // rather than verifying a truck the manager has since reassigned.
        assignment_id: assignment.id,
        reported_registration: registration.trim() || undefined,
        reported_odometer_km: readings.odometerKm,
        reported_fuel_level_pct: readings.fuelPct,
        reported_damage_notes: damage.trim() || undefined,
      })
      setAssignment(result.assignment)
      setJustVerified(true)
    } catch (err) {
      setVerifyError(errorMessage(err))
      // A conflict usually means the assignment moved underneath us; reload so
      // the driver is looking at the truth rather than a stale screen.
      void load()
    } finally {
      setIsSubmitting(false)
    }
  }

  const verified = assignment?.verified_at != null

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onPullToRefresh}
            tintColor={COLORS.muted}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.name}>{driver?.full_name ?? 'Driver'}</Text>
            <Text style={styles.licence}>{driver?.licence_number}</Text>
          </View>
          <Button label="Sign out" variant="secondary" onPress={() => void logout()} />
        </View>

        {status === 'loading' ? (
          <Loading label="Loading your assignment…" />
        ) : status === 'error' ? (
          <>
            <Banner {...errorMessage(loadError)} tone="bad" />
            <Button label="Try again" onPress={() => void load()} />
          </>
        ) : assignment === null ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No truck assigned</Text>
            <Text style={styles.emptyBody}>
              Your manager has not assigned you a truck yet. Pull down to refresh.
            </Text>
          </View>
        ) : (
          <>
            {justVerified ? (
              <Banner
                tone="ok"
                title="Truck verified"
                detail={
                  assignment.mismatch_flagged
                    ? 'The registration you entered does not match our records. Your manager has been notified — you can continue.'
                    : 'Your manager can see that you have checked this truck.'
                }
              />
            ) : null}

            {assignment.mismatch_flagged && !justVerified ? (
              <Banner
                tone="warn"
                title="Awaiting manager review"
                detail="The registration you reported did not match. Your manager is checking it."
              />
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your truck</Text>
              <Text style={styles.registration}>
                {assignment.truck.registration_number}
              </Text>
              <Row
                label="Type"
                value={
                  [assignment.truck.make, assignment.truck.model]
                    .filter(Boolean)
                    .join(' ') ||
                  assignment.truck.truck_type ||
                  '—'
                }
              />
              <Row
                label="Capacity"
                value={`${Number(assignment.truck.max_capacity_kg).toLocaleString()} kg`}
              />
              <Row
                label="Assigned"
                value={new Date(assignment.assigned_at).toLocaleString()}
              />
              <Row
                label="Verified"
                value={
                  verified
                    ? new Date(assignment.verified_at as string).toLocaleString()
                    : 'Not yet'
                }
              />
            </View>

            {verifyError ? (
              <Banner tone="bad" {...verifyError} />
            ) : null}

            {verified ? null : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Check the truck</Text>
                <Text style={styles.help}>
                  Enter what you can see on the vehicle. If the registration does
                  not match, you can still continue — your manager will review it.
                </Text>
                <Field
                  label="Registration on the truck"
                  value={registration}
                  onChangeText={setRegistration}
                  placeholder={assignment.truck.registration_number}
                  autoCapitalize="characters"
                />
                <Field
                  label="Odometer (km)"
                  value={odometer}
                  onChangeText={setOdometer}
                  keyboardType="numeric"
                />
                <Field
                  label="Fuel level (%)"
                  value={fuel}
                  onChangeText={setFuel}
                  keyboardType="numeric"
                />
                <Field
                  label="Visible damage"
                  value={damage}
                  onChangeText={setDamage}
                  placeholder="Leave blank if none"
                  autoCapitalize="none"
                  returnKeyType="go"
                  onSubmitEditing={() => void handleVerify()}
                />
                <Button
                  label={isSubmitting ? 'Sending…' : 'Confirm this truck'}
                  onPress={handleVerify}
                  busy={isSubmitting}
                />
              </View>
            )}

            <Text style={styles.note}>
              Location is not being shared. Trip tracking is not part of this
              build.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { padding: 20, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 12,
  },
  headerText: { flexShrink: 1 },
  name: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  licence: { color: COLORS.faint, fontSize: 12, marginTop: 2 },

  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  registration: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 6,
    marginBottom: 10,
  },
  help: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginVertical: 12 },

  empty: { alignItems: 'center', paddingVertical: 56 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  emptyBody: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    maxWidth: 300,
  },

  note: { color: COLORS.faint, fontSize: 12, marginTop: 24, lineHeight: 18 },
})
