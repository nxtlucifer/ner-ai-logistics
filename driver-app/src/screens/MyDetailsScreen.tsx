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
 * status is derived from its expiry date and whether a file is attached.
 */

import { useCallback, useEffect, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { API_BASE_URL, api, authHeaders, type DocumentRead, type DriverProfile } from '../api/client'
import { Banner, Button, Field, Loading, errorMessage } from '../components/ui'
import { pickDocument, pickPhoto, upload } from '../files/pick'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'

const DOC_TYPES = [
  ['DRIVING_LICENCE', 'Driving Licence'],
  ['GOVERNMENT_ID', 'Government ID'],
  ['OTHER', 'Other'],
] as const

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MyDetailsScreen({ onBack }: { onBack: () => void }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const [profile, setProfile] = useState<DriverProfile | null>(null)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<null | { kind: 'DRIVER_DOCUMENT' | 'TRUCK_DOCUMENT' }>(null)

  const load = useCallback(async () => {
    try {
      setProfile(await api.myProfile())
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

  if (profile === null && error === null) return <Loading label="…" />

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}><Text style={styles.backGlyph}>‹</Text></Pressable>
        <Text style={styles.title}>{t('My details')}</Text>
      </View>
      {error ? <Banner tone="bad" title={error.title} detail={error.detail} /> : null}
      {profile ? (
        <>
          <View style={styles.card}>
            <View style={styles.avatarRow}>
              {profile.photo_url ? (
                <Image source={{ uri: `${API_BASE_URL}${profile.photo_url}`, headers: authHeaders() }} style={styles.avatar} accessibilityLabel="Profile photo" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarText}>{initials(profile.full_name)}</Text></View>
              )}
              <View style={styles.avatarText2}>
                <Text style={styles.name}>{profile.full_name}</Text>
                <Text style={styles.sub}>{t('Driver ID')} · {profile.id.slice(0, 8).toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.btnRow}>
              <View style={styles.btnCell}><Button label={t('Take photo')} variant="secondary" busy={busy === 'photo'} onPress={() => void changePhoto('camera')} /></View>
              <View style={styles.btnCell}><Button label={t('Choose image')} variant="secondary" busy={busy === 'photo'} onPress={() => void changePhoto('library')} /></View>
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
          <DocList
            title={t('Insurance')}
            empty={t('No insurance on file')}
            rows={profile.insurance}
            addLabel={t('Add insurance')}
            onAdd={profile.truck_registration ? () => setForm({ kind: 'TRUCK_DOCUMENT' }) : undefined}
          />
          {form ? (
            <DocForm
              kind={form.kind}
              onDone={() => { setForm(null); void load() }}
              onCancel={() => setForm(null)}
            />
          ) : null}
          <Text style={[styles.sub, styles.foot]} testID="documents-disclaimer">
            Status comes from the expiry date and the attached file. Nothing here is checked with a government or an insurer.
          </Text>
        </>
      ) : null}
      <View style={{ height: 24, backgroundColor: COLORS.bg }} />
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
      <Text style={styles.section}>{title.toUpperCase()}</Text>
      {rows.length === 0 ? <Text style={styles.sub}>{empty}</Text> : null}
      {rows.map((d) => (
        <View key={d.id} style={styles.doc} testID={`doc-${d.doc_type}`}>
          <View style={styles.docText}>
            <Text style={styles.docTitle}>{t(DOC_TYPES.find(([k]) => k === d.doc_type)?.[1] ?? d.doc_type.replace(/_/g, ' '))}</Text>
            <Text style={styles.sub}>{d.number_masked ?? '—'}{d.expires_on ? ` · ${t('Valid until')} ${fmtDate(d.expires_on)}` : ''}</Text>
          </View>
          <Text style={[styles.status, d.status === 'EXPIRED' && styles.statusBad, d.status === 'EXPIRING_SOON' && styles.statusWarn]}>{d.status.replace(/_/g, ' ')}</Text>
        </View>
      ))}
      {onAdd ? <Button label={addLabel} variant="secondary" onPress={onAdd} /> : null}
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
      <Text style={styles.section}>{(kind === 'TRUCK_DOCUMENT' ? t('Add insurance') : t('Add document')).toUpperCase()}</Text>
      {kind === 'DRIVER_DOCUMENT' ? (
        <View style={styles.chips}>
          {DOC_TYPES.map(([k, label]) => (
            <Pressable key={k} onPress={() => setType(k)} accessibilityRole="button" accessibilityState={{ selected: type === k }} style={[styles.chip, type === k && styles.chipOn]}>
              <Text style={[styles.chipText, type === k && styles.chipTextOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Field label={kind === 'TRUCK_DOCUMENT' ? t('Policy number') : t('Document number')} value={number} onChangeText={setNumber} />
      <Field label={`${t('Issue date')} (YYYY-MM-DD)`} value={issued} onChangeText={setIssued} placeholder="2024-01-31" keyboardType="numeric" />
      <Field label={`${t('Expiry date')} (YYYY-MM-DD)`} value={expires} onChangeText={setExpires} placeholder="2028-01-31" keyboardType="numeric" />
      <Button label={file ? `${t('Photo uploaded')} · ${file.name}` : t('Attach image or PDF')} variant="secondary" busy={busy === 'file'} onPress={() => void attach()} />
      {error ? <Banner tone="bad" title={error.title} detail={error.detail} /> : null}
      <View style={styles.btnRow}>
        <View style={styles.btnCell}><Button label={t('Cancel')} variant="secondary" onPress={onCancel} /></View>
        <View style={styles.btnCell}><Button label={t('Save')} busy={busy === 'save'} onPress={() => void save()} /></View>
      </View>
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  content: { padding: 16, paddingBottom: 32, gap: 12, backgroundColor: COLORS.bg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  card: { backgroundColor: COLORS.raised, borderRadius: 14, padding: 14, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.dim },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.dim },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.accent },
  avatarText: { color: COLORS.onAccent, fontSize: 22, fontWeight: '800' },
  avatarText2: { flex: 1, minWidth: 0 },
  name: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  sub: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  foot: { paddingHorizontal: 4 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnCell: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.dim },
  rowLabel: { color: COLORS.muted, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  section: { color: COLORS.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.dim },
  docText: { flex: 1, minWidth: 0 },
  docTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  status: { color: COLORS.ok, fontSize: 11, fontWeight: '800' },
  statusWarn: { color: COLORS.warn },
  statusBad: { color: COLORS.bad },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.dim, minHeight: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: COLORS.onAccent },
}))
