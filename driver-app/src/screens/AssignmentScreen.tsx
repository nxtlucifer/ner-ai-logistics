/**
 * The driver's current assignment, and truck verification.
 *
 * Checking the truck is a prerequisite for driving it: the backend refuses to
 * start a trip on an unverified assignment, so this screen is the gate the Trip
 * tab reports as blocked.
 *
 * Deliberately no map. Position belongs to a trip, not to an assignment; the
 * hero's GPS chip is the Trip tab's tracker state (the shell's), so it says
 * "Not tracking" here until a trip runs - nothing is shared from this screen.
 *
 * LAYOUT (Phase B3; no own reference, so the driver system): a compact photo
 * hero with the way back to Trip and the GPS chip, then one card for the truck
 * (with the four steps) and one for the check itself. A banner is never boxed
 * inside a card.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Image,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native'

import { api, type CurrentAssignment } from '../api/client'
import { pickPhoto, upload } from '../files/pick'
import { useAuthImage } from '../files/useAuthImage'
import { Icon } from '../components/icons'
import { PHOTOS } from '../components/photoCredits'
import { HeroBack, IconDisc, ScreenHero } from '../components/scenic'
import { useT } from '../i18n/tx'
import { Banner, Button, Field, Loading, Row, errorMessage } from '../components/ui'
import FuelGauge, { type FuelPct } from '../components/FuelGauge'
import { makeStyles, useTheme } from '../theme-context'

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
function parseReadings(input: { odometer: string; fuelPct: FuelPct | null }): ParsedReadings {
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

  // Fuel is no longer typed, so there is nothing to validate: the gauge can
  // only produce one of its own marks. The check that used to live here was
  // guarding against a free-text box that no longer exists.
  if (input.fuelPct !== null) out.fuelPct = input.fuelPct

  return out
}

export default function AssignmentScreen({ onBack, status }: { onBack?: () => void; status?: ReactNode } = {}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const [loadState, setLoadState] = useState<Status>('loading')
  const [assignment, setAssignment] = useState<CurrentAssignment | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [registration, setRegistration] = useState('')
  const [odometer, setOdometer] = useState('')
  //: null until the driver says. Never defaulted to 0 - "empty"
  //: and "not reported" are different facts about a truck.
  const [fuelPct, setFuelPct] = useState<FuelPct | null>(null)
  const [damage, setDamage] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [verifyError, setVerifyError] = useState<{
    title: string
    detail: string
  } | null>(null)
  const [justVerified, setJustVerified] = useState(false)
  // TRUCK PHOTO. Captured on the phone, uploaded to the private files API,
  // attached to this assignment by the server; the verify button is offered
  // only once it is there. A photo already on the assignment (uploaded
  // earlier, or on a reload) counts - the server is the record.
  const [photo, setPhoto] = useState<{ uri: string; uploaded: boolean } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const t = useT()
  const serverPhoto = useAuthImage(assignment?.verification_photo_url)

  async function takePhoto(source: 'camera' | 'library') {
    setPhotoBusy(true)
    setVerifyError(null)
    try {
      const file = await pickPhoto(source)
      if (!file) return
      setPhoto({ uri: file.uri, uploaded: false })
      await upload(file, 'TRUCK_VERIFICATION')
      setPhoto({ uri: file.uri, uploaded: true })
    } catch (err) {
      setPhoto(null)
      setVerifyError({ title: t('Upload requires connection'), detail: errorMessage(err).detail })
    } finally {
      setPhotoBusy(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const result = await api.myAssignment()
      setAssignment(result)
      setLoadError(null)
      setLoadState('ready')
    } catch (err) {
      setLoadError(err)
      setLoadState('error')
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
    const readings = parseReadings({ odometer, fuelPct })
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
  const photoReady = Boolean(photo?.uploaded || assignment?.verification_photo_url)
  const plateReady = registration.trim().length > 0

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onPullToRefresh}
          tintColor={COLORS.textMuted}
        />
      }
    >
      <View style={styles.heroBleed}>
        <ScreenHero
          photo={PHOTOS.login}
          title={t('Truck Check')}
          subtitle={t('Photo, plate and readings')}
          status={status}
          // The Light/Dark chip the shell header gave this screen (B3D-R01).
          themeChip="icon"
          compact
          height={176}
          overlap={14}
          creditAt="bottom"
          leading={onBack ? (
            <HeroBack
              label="Back to trip"
              text={t('Trip')}
              // The old link's "— checked" cue, kept as a check mark once the
              // truck is verified (B3D-R08).
              mark={verified ? 'check-circle' : undefined}
              onPress={onBack}
            />
          ) : null}
        />
      </View>

      {loadState === 'loading' ? (
        <View style={styles.card}>
          <Loading label="Loading your assignment…" />
        </View>
      ) : loadState === 'error' ? (
        <>
          <Banner {...errorMessage(loadError)} tone="bad" style={styles.flush} />
          <Button label="Try again" onPress={() => void load()} />
        </>
      ) : assignment === null ? (
        <View style={[styles.card, styles.empty]}>
          <IconDisc icon="truck" size={56} />
          <Text style={styles.emptyTitle}>{t('No truck assigned')}</Text>
          <Text style={styles.emptyBody}>
            {t('Your manager has not assigned you a truck yet. Pull down to refresh.')}
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
              style={styles.flush}
            />
          ) : null}

          {assignment.mismatch_flagged && !justVerified ? (
            <Banner
              tone="warn"
              title="Awaiting manager review"
              detail="The registration you reported did not match. Your manager is checking it."
              style={styles.flush}
            />
          ) : null}

          <View style={styles.card} testID="truck-card">
            {/* Four steps, state carried by icon + label + colour. */}
            <View style={styles.steps} accessibilityRole="progressbar">
              {([
                ['Truck', true],
                ['Photo', photoReady],
                ['Plate', verified || plateReady],
                ['Confirm', verified],
              ] as Array<[string, boolean]>).map(([label, done], i, all) => {
                const current = !done && all.slice(0, i).every(([, d]) => d)
                return (
                  <View key={label} style={styles.step}>
                    <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotNow]}>
                      {done ? <Icon name="check" size={13} color={COLORS.onPrimary} /> : <Text style={[styles.stepNum, current && styles.stepNumNow]}>{i + 1}</Text>}
                    </View>
                    <Text style={[styles.stepLabel, (done || current) && styles.stepLabelOn]} numberOfLines={1}>{t(label)}</Text>
                  </View>
                )
              })}
            </View>

            <View style={styles.truckHead}>
              <IconDisc icon="truck" tone={verified ? 'action' : 'neutral'} size={44} />
              <View style={styles.truckHeadText}>
                <Text style={styles.cardTitle}>{t('Your Truck')}</Text>
                <Text style={styles.registration}>
                  {assignment.truck.registration_number}
                </Text>
              </View>
            </View>
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
              label="Verified"
              value={
                verified
                  ? new Date(assignment.verified_at as string).toLocaleDateString()
                  : t('Not yet')
              }
            />
          </View>

          {verifyError ? (
            <Banner tone="bad" {...verifyError} style={styles.flush} />
          ) : null}

          {verified ? null : (
            <View style={styles.card} testID="truck-check">
              <Text style={styles.cardTitle}>{t('Check the Truck')}</Text>
              <Text style={styles.help}>
                {t('Enter what you can see on the vehicle. If the registration does not match, you can still continue — your manager will review it.')}
              </Text>
              <Text style={styles.fieldLabel}>{t('Truck photo')}</Text>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel="Truck photo" testID="truck-photo" />
              ) : serverPhoto ? (
                <Image source={{ uri: serverPhoto }} style={styles.photo} accessibilityLabel="Truck photo" testID="truck-photo" />
              ) : null}
              <View style={styles.photoRow}>
                <View style={styles.photoCell}><Button label={t('Camera')} variant="secondary" busy={photoBusy} onPress={() => void takePhoto('camera')} /></View>
                <View style={styles.photoCell}><Button label={t('Gallery')} variant="secondary" busy={photoBusy} onPress={() => void takePhoto('library')} /></View>
              </View>
              <Text style={styles.help}>
                {photoReady ? t('Photo uploaded') : t('Take a photo of the truck before you verify.')}
              </Text>
              <Field
                label={t('Registration on the truck')}
                value={registration}
                onChangeText={setRegistration}
                // Never the expected plate: the check is that the driver
                // reads it off the truck, and grey text to copy made the
                // check a formality (B3D-R07). The server compares.
                placeholder="As painted on the truck"
                autoCapitalize="characters"
              />
              <Field
                label="Odometer (km)"
                value={odometer}
                onChangeText={setOdometer}
                keyboardType="numeric"
              />
              {/* ISSUE 2. Was a box asking for "a whole percentage
                  between 0 and 100" - a number no truck displays, so the
                  driver invented one and it was stored as though measured.
                  The dial offers the marks a real gauge has. Still driver
                  reported, and labelled as such. */}
              <View style={styles.fuelBlock}>
                <Text style={styles.fuelLabel}>{t('Fuel level')}</Text>
                <FuelGauge
                  value={fuelPct}
                  onChange={(pct) => setFuelPct(pct)}
                  disabled={isSubmitting}
                />
                <Text style={styles.fuelHint}>
                  {t('Match the needle to the gauge in your cab. Driver reported — there is no sensor.')}
                </Text>
              </View>
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
                label={isSubmitting ? '…' : t('Verify truck')}
                onPress={handleVerify}
                busy={isSubmitting}
                disabled={!photoReady || !plateReady}
              />
              {/* A disabled Verify says why, next to it. */}
              {!photoReady || !plateReady ? (
                <Text style={styles.reasonLine}>
                  {photoReady ? t('Type the registration you can see on the truck.') : t('Take a photo of the truck before you verify.')}
                </Text>
              ) : null}
            </View>
          )}

          <Text style={styles.note}>
            {t(verified
              ? 'This truck is checked. Location is shared only while a trip is running — see the Trip tab.'
              : 'Check this truck before you can start a trip. Location is not being shared.')}
          </Text>
        </>
      )}
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  page: { flex: 1, backgroundColor: COLORS.bg },
  pageContent: { paddingHorizontal: 13, paddingBottom: 32, gap: 10, width: '100%', maxWidth: 700, alignSelf: 'center' },
  // Full-bleed hero; the first card rides 18 dp up over its foot.
  heroBleed: { marginHorizontal: -13, marginBottom: -24 },
  // Banner's own 16 dp foot, on a page spaced by `gap`.
  flush: { marginBottom: 0 },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
  },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  truckHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, marginBottom: 4 },
  truckHeadText: { flex: 1, minWidth: 0 },
  registration: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  fuelBlock: { marginBottom: 16, gap: 10, alignItems: 'center' },
  fuelLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', alignSelf: 'flex-start' },
  fuelHint: { color: COLORS.textFaint, fontSize: 12, textAlign: 'center' },
  help: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginVertical: 12 },
  fieldLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', marginTop: 4 },
  photo: { width: '100%', height: 180, borderRadius: 12, backgroundColor: COLORS.surfaceSoft, marginTop: 8 },
  photoRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  photoCell: { flex: 1, minWidth: 0 },
  reasonLine: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  steps: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 4 },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: COLORS.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  stepDotDone: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  stepDotNow: { borderColor: COLORS.accent },
  stepNum: { color: COLORS.textFaint, fontSize: 12, fontWeight: '800' },
  stepNumNow: { color: COLORS.accent },
  stepLabel: { color: COLORS.textFaint, fontSize: 11, fontWeight: '700' },
  stepLabelOn: { color: COLORS.text },

  empty: { alignItems: 'center', paddingVertical: 24 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginTop: 12 },
  emptyBody: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    maxWidth: 300,
  },

  note: { color: COLORS.textFaint, fontSize: 12, marginTop: 8, lineHeight: 18, paddingHorizontal: 4 },
}))
