/**
 * MY DETAILS - the driver's own record, documents and the truck's insurance.
 *
 * Real values only, from `/api/driver/me/profile`: name, phone, a short driver
 * id, the assigned truck and whether it is verified, the emergency contact
 * when the record has one, and the document rows with their numbers MASKED
 * (the full number never reaches the phone). Photos and files go through
 * `files/pick.ts` and the private files API; a missing photo is initials.
 *
 * Nothing here claims a government or insurer verification. A document's
 * status is derived from its expiry date and whether a file is attached, and
 * its pill follows the hue rule: green only for Valid, amber for expiring or
 * missing, red for expired, neutral for unknown - UNKNOWN is never green.
 *
 * LAYOUT (Phase B3; no own reference, so the driver system): More's photo in
 * a compact hero with the way back to More and the GPS chip, then one card per
 * block. The emergency contact stays read-only (Safety's Emergency contact
 * tool lands here).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { api, type DocumentRead, type DriverProfile } from '../api/client'
import { LIMITS, autoFormat, checkDates } from './documentDates'
import { Banner, Button, Field, Loading, errorMessage } from '../components/ui'
import { PHOTOS } from '../components/photoCredits'
import { HeroBack, ScreenHero, StatusPill, type Tone } from '../components/scenic'
import { pickDocument, pickPhoto, upload } from '../files/pick'
import { setProfilePhotoUrl } from '../files/profilePhoto'
import { useAuthImage } from '../files/useAuthImage'
import { useT } from '../i18n/tx'
import { TOUCH_TARGET } from '../theme'
import { makeStyles } from '../theme-context'

const DOC_TYPES = [
  ['DRIVING_LICENCE', 'Driving Licence'],
  ['GOVERNMENT_ID', 'Government ID'],
  ['OTHER', 'Other'],
] as const
const STATUS_WORD: Record<string, string> = { VALID: 'Valid', EXPIRING_SOON: 'Expiring soon', EXPIRED: 'Expired', MISSING: 'Missing', UNKNOWN: 'Unknown' }
const STATUS_TONE: Record<string, Tone> = { VALID: 'action', EXPIRING_SOON: 'caution', MISSING: 'caution', EXPIRED: 'emergency' }
const TYPE_LABEL: Record<string, string> = { DRIVING_LICENCE: 'Driving Licence', GOVERNMENT_ID: 'Government ID', OTHER: 'Other', INSURANCE: 'Insurance' }

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MyDetailsScreen({ onBack, status }: { onBack: () => void; status?: ReactNode }) {
  const styles = useStyles()
  const t = useT()
  const [profile, setProfile] = useState<DriverProfile | null>(null)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<null | { kind: 'DRIVER_DOCUMENT' | 'TRUCK_DOCUMENT' }>(null)
  const photoUri = useAuthImage(profile?.photo_url)

  const load = useCallback(async () => {
    try {
      const next = await api.myProfile()
      setProfile(next)
      setProfilePhotoUrl(next.photo_url)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function changePhoto(source: 'camera' | 'library') {
    setBusy('photo')
    try {
      const file = await pickPhoto(source)
      if (file) {
        await upload(file, 'PROFILE_PHOTO')
        await load()
      }
    } catch (e) {
      setError({ title: t('Upload requires connection'), detail: errorMessage(e).detail })
    } finally {
      setBusy(null)
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heroBleed}>
        <ScreenHero
          photo={PHOTOS.more}
          title={t('My Details')}
          subtitle={t('Profile, documents and insurance')}
          status={status}
          // The Light/Dark chip the shell header gave this screen (B3D-R01).
          themeChip="icon"
          compact
          height={176}
          overlap={14}
          creditAt="bottom"
          leading={<HeroBack label="Back to More" text={t('More')} onPress={onBack} />}
        />
      </View>
      {profile === null && error === null ? (
        <View style={styles.card}><Loading label="…" /></View>
      ) : null}
      {error ? <Banner tone="bad" title={error.title} detail={error.detail} style={styles.flush} /> : null}
      {profile ? (
        <>
          <View style={styles.card} testID="details-profile">
            <View style={styles.avatarRow}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatar} accessibilityLabel="Profile photo" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarText}>{initials(profile.full_name)}</Text></View>
              )}
              <View style={styles.avatarText2}>
                <Text style={styles.name}>{profile.full_name}</Text>
                <Text style={styles.sub}>{t('Driver ID')} · {profile.id.slice(0, 8).toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.btnRow}>
              <View style={styles.btnCell}><Button label={t('Camera')} variant="secondary" busy={busy === 'photo'} onPress={() => void changePhoto('camera')} /></View>
              <View style={styles.btnCell}><Button label={t('Gallery')} variant="secondary" busy={busy === 'photo'} onPress={() => void changePhoto('library')} /></View>
            </View>
            <Row label={t('Phone')} value={profile.phone} />
            <Row label={t('Truck')} value={profile.truck_registration ? `${profile.truck_registration} · ${profile.truck_verified ? t('verified') : t('not verified')}` : t('No truck assigned')} />
            <Row label={t('Emergency contact')} value={profile.emergency_contact_name ? `${profile.emergency_contact_name} · ${profile.emergency_contact_phone ?? ''}` : t('Not provided')} />
          </View>

          <DocList
            title={t('Documents')}
            empty={t('No documents yet')}
            rows={profile.documents}
            addLabel={t('Add document')}
            onAdd={() => setForm({ kind: 'DRIVER_DOCUMENT' })}
          />
          {form?.kind === 'DRIVER_DOCUMENT' ? (
            <DocForm kind="DRIVER_DOCUMENT" onDone={() => { setForm(null); void load() }} onCancel={() => setForm(null)} />
          ) : null}
          <DocList
            title={t('Insurance')}
            empty={t('No insurance on file')}
            rows={profile.insurance}
            addLabel={t('Add insurance')}
            onAdd={profile.truck_registration ? () => setForm({ kind: 'TRUCK_DOCUMENT' }) : undefined}
          />
          {form?.kind === 'TRUCK_DOCUMENT' ? (
            <DocForm kind="TRUCK_DOCUMENT" onDone={() => { setForm(null); void load() }} onCancel={() => setForm(null)} />
          ) : null}
          <Text style={[styles.sub, styles.foot]} testID="documents-disclaimer">
            {t('Status comes from the expiry date and the attached file. Nothing here is checked with a government or an insurer.')}
          </Text>
        </>
      ) : null}
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useStyles()
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  )
}

function DocList({ title, empty, rows, addLabel, onAdd }: { title: string; empty: string; rows: DocumentRead[]; addLabel: string; onAdd?: () => void }) {
  const styles = useStyles()
  const t = useT()
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      {rows.length === 0 ? <Text style={styles.sub}>{empty}</Text> : null}
      {rows.map((d) => (
        <View key={d.id} style={styles.doc} testID={`doc-${d.doc_type}`}>
          <View style={styles.docText}>
            <Text style={styles.docTitle}>{t(TYPE_LABEL[d.doc_type] ?? d.doc_type.replace(/_/g, ' '))}</Text>
            <Text style={styles.sub}>{d.number_masked ?? '—'}{d.expires_on ? ` · ${t('Valid till')} ${fmtDate(d.expires_on)}` : ''}</Text>
          </View>
          <StatusPill text={t(STATUS_WORD[d.status] ?? d.status.replace(/_/g, ' '))} tone={STATUS_TONE[d.status] ?? 'neutral'} />
        </View>
      ))}
      {onAdd ? <View style={styles.cardAction}><Button label={addLabel} variant="secondary" onPress={onAdd} /></View> : null}
    </View>
  )
}

function DocForm({ kind, onDone, onCancel }: { kind: 'DRIVER_DOCUMENT' | 'TRUCK_DOCUMENT'; onDone: () => void; onCancel: () => void }) {
  const styles = useStyles()
  const t = useT()
  const [type, setType] = useState<string>(kind === 'TRUCK_DOCUMENT' ? 'INSURANCE' : 'DRIVING_LICENCE')
  const [number, setNumber] = useState('')
  const [issued, setIssued] = useState('')
  const [expires, setExpires] = useState('')
  const [file, setFile] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)

  async function attach() {
    setBusy('file')
    try {
      const picked = await pickDocument()
      if (picked) {
        const stored = await upload(picked, kind)
        setFile({ id: stored.id, name: stored.content_type })
      }
    } catch (e) {
      setError({ title: t('Upload requires connection'), detail: errorMessage(e).detail })
    } finally {
      setBusy(null)
    }
  }

  const problems = checkDates(issued, expires)
  const hasProblem = Object.keys(problems).length > 0

  async function save() {
    setBusy('save')
    setError(null)
    try {
      const body = { doc_type: type, doc_number: number.trim() || undefined, issued_on: issued.trim() || undefined, expires_on: expires.trim() || undefined, file_id: file?.id }
      if (kind === 'TRUCK_DOCUMENT') await api.addTruckDocument(body)
      else await api.addDocument(body)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={styles.card} testID="doc-form">
      <Text style={styles.cardTitle} accessibilityRole="header">{kind === 'TRUCK_DOCUMENT' ? t('Add Insurance') : t('Add Document')}</Text>
      {kind === 'DRIVER_DOCUMENT' ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {DOC_TYPES.map(([k, label]) => (
            <Pressable key={k} onPress={() => setType(k)} accessibilityRole="radio" accessibilityState={{ selected: type === k }} aria-checked={type === k} style={[styles.chip, type === k && styles.chipOn]}>
              <Text style={[styles.chipText, type === k && styles.chipTextOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Field
        label={kind === 'TRUCK_DOCUMENT' ? t('Policy number') : t('Document number')}
        value={number}
        onChangeText={setNumber}
        maxLength={LIMITS.number}
        autoCapitalize="characters"
      />
      {/* The keypad stays numeric and `autoFormat` supplies the hyphens,
          because an Android numeric keypad has none - the form was asking
          for a format it would not let the driver type. */}
      <Field
        label={`${t('Issue date')} (YYYY-MM-DD)`}
        value={issued}
        onChangeText={(v) => setIssued(autoFormat(v))}
        placeholder="2024-01-31"
        keyboardType="numeric"
        maxLength={LIMITS.date}
        error={problems.issued}
      />
      <Field
        label={`${t('Expiry date')} (YYYY-MM-DD)`}
        value={expires}
        onChangeText={(v) => setExpires(autoFormat(v))}
        placeholder="2028-01-31"
        keyboardType="numeric"
        maxLength={LIMITS.date}
        error={problems.expires}
      />
      <Button label={file ? `${t('Photo uploaded')} · ${file.name}` : t('Attach image or PDF')} variant="secondary" busy={busy === 'file'} onPress={() => void attach()} />
      {/* The form's own failure, as a line in this card - not a banner boxed
          inside it. */}
      {error ? (
        <Text style={styles.formError} accessibilityRole="alert">{t(error.title)} · {t(error.detail)}</Text>
      ) : null}
      <View style={styles.btnRow}>
        <View style={styles.btnCell}><Button label={t('Cancel')} variant="secondary" onPress={onCancel} /></View>
        <View style={styles.btnCell}><Button label={t('Save')} busy={busy === 'save'} disabled={hasProblem} onPress={() => void save()} /></View>
      </View>
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  page: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: 13, paddingBottom: 32, gap: 10, width: '100%', maxWidth: 700, alignSelf: 'center' },
  heroBleed: { marginHorizontal: -13, marginBottom: -24 },
  // Banner's own 16 dp foot, on a page spaced by `gap`.
  flush: { marginBottom: 0 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  cardAction: { marginTop: 2 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.surfaceSoft },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.discNeutral },
  avatarText: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  avatarText2: { flex: 1, minWidth: 0 },
  name: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  foot: { paddingHorizontal: 4 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnCell: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  rowLabel: { color: COLORS.textMuted, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  docText: { flex: 1, minWidth: 0 },
  docTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  formError: { color: COLORS.danger, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: COLORS.borderStrong, minHeight: TOUCH_TARGET - 4, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: COLORS.onPrimary },
}))
