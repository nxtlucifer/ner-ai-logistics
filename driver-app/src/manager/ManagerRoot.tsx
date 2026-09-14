/**
 * The manager's shell on the phone - mobile-first, not the desktop console
 * squeezed. Five tabs over the SAME API contracts the web console uses
 * (api/manager.ts): Overview, Trips, Map, Fleet, More. Every action here is a
 * permission the server granted AND a state that allows it; the server still
 * decides. "View as driver" stays on the web console - this is not that.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ApiError } from '../api/client'
import { managerApi, type FleetTrip, type MgrDriver, type MgrReroute, type MgrRisk, type MgrRoute, type MgrTrip, type MgrTripDetail, type MgrTruck, type ProviderRow } from '../api/manager'
import { useAuth } from '../auth/AuthProvider'
import { Icon, type IconName } from '../components/icons'
import { Banner, Button, Loading, Row } from '../components/ui'
import { useAuthImage } from '../files/useAuthImage'
import { LanguageSheet } from '../i18n/LanguageSheet'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { translateReasonCode } from '../i18n/reasonCodes'
import { resolveLanguage } from '../i18n/language'
import { useT } from '../i18n/tx'
import DriverRouteMap from '../map/DriverRouteMap'
import { makeStyles, useTheme } from '../theme-context'

type Tab = 'overview' | 'trips' | 'map' | 'fleet' | 'more'
const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: 'overview', label: 'Overview', icon: 'grid' },
  { value: 'trips', label: 'Trips', icon: 'truck' },
  { value: 'map', label: 'Map', icon: 'map' },
  { value: 'fleet', label: 'Fleet', icon: 'users' },
  { value: 'more', label: 'More', icon: 'more-horizontal' },
]
const OPEN = new Set(['DRAFT', 'ASSIGNED', 'VERIFICATION_PENDING', 'MANAGER_REVIEW', 'ACTIVE', 'DELAYED', 'INCIDENT'])
const MOVING = new Set(['ACTIVE', 'DELAYED', 'INCIDENT'])

/** One fetch, one error string, one reload. No cache: a manager's screen must be current. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const run = useCallback(async () => {
    setBusy(true)
    try {
      setData(await load())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { void run() }, [run])
  return { data, error, busy, reload: run }
}

export default function ManagerRoot() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const [tab, setTab] = useState<Tab>('overview')
  const [tripId, setTripId] = useState<string | null>(null)
  const openTrip = (id: string) => { setTripId(id); setTab('trips') }
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.brand}>RASTA AI · {t('Manager')}</Text>
      </View>
      <View style={styles.body}>
        {tab === 'overview' ? <Overview onOpenTrip={openTrip} /> : null}
        {tab === 'trips' ? (tripId ? <TripDetail id={tripId} onBack={() => setTripId(null)} onMap={() => setTab('map')} /> : <Trips onOpen={openTrip} />) : null}
        {tab === 'map' ? <FleetMap tripId={tripId} onPick={setTripId} /> : null}
        {tab === 'fleet' ? <Fleet /> : null}
        {tab === 'more' ? <More /> : null}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((it) => {
          const on = it.value === tab
          return (
            <Pressable key={it.value} style={styles.tab} onPress={() => setTab(it.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`mgr-tab-${it.value}`}>
              <Icon name={it.icon} size={20} color={on ? COLORS.accent : COLORS.muted} />
              <Text style={[styles.tabLabel, on && { color: COLORS.accent }]}>{t(it.label)}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ---- Overview ---------------------------------------------------------------
function Overview({ onOpenTrip }: { onOpenTrip: (id: string) => void }) {
  const styles = useStyles()
  const t = useT()
  const { data, error, busy, reload } = useLoad(async () => {
    const [trips, drivers, trucks, providers] = await Promise.all([managerApi.listTrips(), managerApi.listDrivers(), managerApi.listTrucks(), managerApi.providers()])
    return { trips: trips.items, drivers: drivers.items, trucks: trucks.items, providers: providers.providers }
  }, [])
  if (busy && !data) return <Loading label="Loading fleet" />
  if (!data) return <Banner tone="bad" title="Could not load" detail={error ?? ''} />
  const active = data.trips.filter((x) => MOVING.has(x.status))
  const review = data.trips.filter((x) => x.status === 'MANAGER_REVIEW' || (x.status === 'DRAFT' && !x.selected_route_id))
  const warnings = data.providers.find((p) => p.provider === 'NDMA_SACHET')
  const unhealthy = data.providers.filter((p) => p.state === 'FAILED' || p.state === 'RATE_LIMITED')
  const stat = (n: number, label: string) => (
    <View style={styles.stat} key={label}><Text style={styles.statN}>{n}</Text><Text style={styles.statL}>{t(label)}</Text></View>
  )
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} />}>
      <View style={styles.statRow}>
        {stat(active.length, 'Active trips')}
        {stat(data.drivers.filter((d) => d.status === 'AVAILABLE').length, 'Drivers available')}
        {stat(data.trucks.filter((x) => x.status === 'AVAILABLE').length, 'Trucks available')}
        {stat(review.length, 'Routes needing review')}
      </View>
      <Text style={styles.section}>{t('Current warnings').toUpperCase()}</Text>
      <Row label="NDMA SACHET" value={warnings ? `${warnings.state} · ${warnings.freshness}` : t('Unknown')} />
      <Text style={styles.section}>{t('Data health').toUpperCase()}</Text>
      <Row label={t('Providers')} value={`${data.providers.length - unhealthy.length}/${data.providers.length} ${t('healthy')}`} />
      {unhealthy.map((p) => <Row key={p.provider} label={p.provider} value={`${p.state}${p.last_error ? ` · ${p.last_error}` : ''}`} />)}
      <Text style={styles.section}>{t('Open trips').toUpperCase()}</Text>
      {data.trips.filter((x) => OPEN.has(x.status)).map((x) => <TripRow key={x.id} trip={x} onPress={() => onOpenTrip(x.id)} />)}
    </ScrollView>
  )
}

function TripRow({ trip, onPress }: { trip: MgrTrip; onPress: () => void }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" testID={`mgr-trip-${trip.trip_code}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{trip.trip_code}</Text>
        <Text style={styles.rowSub}>{t(trip.status)} · {trip.selected_route_id ? t('route selected') : t('no route')}</Text>
      </View>
      <Icon name="chevron-right" color={COLORS.faint} size={20} />
    </Pressable>
  )
}

// ---- Trips ------------------------------------------------------------------
function Trips({ onOpen }: { onOpen: (id: string) => void }) {
  const styles = useStyles()
  const { data, error, busy, reload } = useLoad(() => managerApi.listTrips(), [])
  if (busy && !data) return <Loading label="Loading trips" />
  if (!data) return <Banner tone="bad" title="Could not load" detail={error ?? ''} />
  const sorted = [...data.items].sort((a, b) => Number(OPEN.has(b.status)) - Number(OPEN.has(a.status)))
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} />}>
      {sorted.map((x) => <TripRow key={x.id} trip={x} onPress={() => onOpen(x.id)} />)}
    </ScrollView>
  )
}

function TripDetail({ id, onBack, onMap }: { id: string; onBack: () => void; onMap: () => void }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const { can } = useAuth()
  const [note, setNote] = useState<string | null>(null)
  const { data, error, busy, reload } = useLoad(async () => {
    const trip = await managerApi.getTrip(id)
    const [routes, drivers, trucks] = await Promise.all([managerApi.routes(id), managerApi.listDrivers(), managerApi.listTrucks()])
    const current = routes.find((r) => r.id === trip.selected_route_id) ?? routes.find((r) => r.is_current) ?? null
    const risk = current ? await managerApi.risk(id, current.id).catch(() => null) : null
    const reroute = MOVING.has(trip.status) ? await managerApi.reroute(id).catch(() => null) : null
    return { trip, routes, current, risk, reroute, driver: drivers.items.find((d) => d.id === trip.driver_id) ?? null, truck: trucks.items.find((x) => x.id === trip.truck_id) ?? null }
  }, [id])
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setNote(null)
    try { await fn(); setNote(`${label}: ${t('done')}`); await reload() } catch (e) { setNote(e instanceof ApiError ? e.message : t('Could not do that')) }
  }
  if (busy && !data) return <Loading label="Loading trip" />
  if (!data) return <Banner tone="bad" title="Could not load" detail={error ?? ''} />
  const { trip, current, risk, reroute, driver, truck } = data
  const proposal = reroute?.outcome === 'PROPOSE' && reroute.proposed_route_id && reroute.selected_route_id ? reroute : null
  const lang = resolveLanguage()
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to trips"><Icon name="chevron-left" color={COLORS.text} size={22} /><Text style={styles.backText}>{t('Trips')}</Text></Pressable>
      <Text style={styles.title}>{trip.trip_code}</Text>
      <Row label={t('Status')} value={t(trip.status)} />
      <Row label={t('Driver')} value={driver?.full_name ?? '—'} />
      <Row label={t('Truck')} value={truck?.registration_number ?? '—'} />
      <Row label={t('Route')} value={current ? `${current.kind} · ${current.distance_km ?? '?'} km · ${current.state}` : t('no route')} />
      <Row label={t('Stops')} value={`${trip.stops.filter((s) => s.status === 'COMPLETED').length} / ${trip.stops.length}`} />
      <Text style={styles.section}>{t('Risk decision').toUpperCase()}</Text>
      {risk ? (
        <>
          <Row label={t('Decision')} value={risk.decision ? t(risk.decision) : '—'} />
          <Row label={t('Band')} value={`${risk.band} · ${risk.score}`} />
          {risk.reason_codes.map((c) => <Text key={c} style={styles.code}>• {translateReasonCode(c, lang)}</Text>)}
          {risk.unavailable.length ? <Text style={styles.muted}>{t('Unknown')}: {risk.unavailable.join(', ')}</Text> : null}
        </>
      ) : <Text style={styles.muted}>{t('Route risk not assessed')}</Text>}
      {note ? <Banner tone="ok" title={note} /> : null}
      <View style={styles.actions}>
        <Button label={t('Map')} onPress={onMap} />
        {can('trip:dispatch') && trip.status === 'DRAFT' && trip.selected_route_id ? <Button label={t('Dispatch')} onPress={() => act(t('Dispatch'), () => managerApi.dispatch(trip.id))} /> : null}
        {can('trip:dispatch') && proposal ? <Button label={t('Approve reroute')} onPress={() => act(t('Approve reroute'), () => managerApi.acceptReroute(trip.id, proposal.selected_route_id!, proposal.proposed_route_id!))} /> : null}
      </View>
    </ScrollView>
  )
}

// ---- Map --------------------------------------------------------------------
function FleetMap({ tripId, onPick }: { tripId: string | null; onPick: (id: string) => void }) {
  const styles = useStyles()
  const t = useT()
  const fleet = useLoad(() => managerApi.activeFleet(), [])
  const picked = tripId ?? fleet.data?.trips[0]?.trip_id ?? null
  const route = useLoad(async () => {
    if (!picked) return null
    const routes = await managerApi.routes(picked)
    const current = routes.find((r) => r.is_current) ?? routes[0] ?? null
    const risk = current ? await managerApi.risk(picked, current.id).catch(() => null) : null
    return { current, risk }
  }, [picked])
  const truck = fleet.data?.trips.find((x) => x.trip_id === picked) ?? null
  const points = useMemo(() => route.data?.current?.geometry ?? [], [route.data])
  if (fleet.busy && !fleet.data) return <Loading label="Loading fleet" />
  const pos = truck?.position ?? null
  const ageS = pos ? Math.max(0, (Date.now() - Date.parse(pos.recorded_at)) / 1000) : null
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ gap: 8, padding: 10 }}>
        {(fleet.data?.trips ?? []).map((x: FleetTrip) => (
          <Pressable key={x.trip_id} onPress={() => onPick(x.trip_id)} style={[styles.chip, x.trip_id === picked && styles.chipOn]} accessibilityRole="button">
            <Text style={styles.chipText}>{x.trip_code} · {x.driver_name}</Text>
          </Pressable>
        ))}
        {!fleet.data?.trips.length ? <Text style={styles.muted}>{t('No trip under way')}</Text> : null}
      </ScrollView>
      <View style={{ flex: 1 }}>
        <DriverRouteMap
          routeId={route.data?.current?.id ?? null}
          points={points}
          backupPoints={[]}
          showBackup={false}
          stops={[]}
          position={pos ? [pos.lat, pos.lon] : null}
          positionKind={pos ? (truck?.freshness === 'FRESH' ? 'LIVE' : 'LAST_KNOWN') : null}
          positionSource="GPS"
          accuracyM={pos?.accuracy_m ?? null}
          positionAgeSeconds={ageS}
        />
      </View>
      <View style={styles.evidence}>
        <Text style={styles.section}>{t('Evidence').toUpperCase()}</Text>
        {route.data?.risk ? route.data.risk.reason_codes.slice(0, 6).map((c) => <Text key={c} style={styles.code}>• {translateReasonCode(c, resolveLanguage())}</Text>) : <Text style={styles.muted}>{t('Route risk not assessed')}</Text>}
      </View>
    </View>
  )
}

// ---- Fleet ------------------------------------------------------------------
function Photo({ url, initials }: { url: string | null | undefined; initials: string }) {
  const styles = useStyles()
  const src = useAuthImage(url)
  return src ? <Image source={{ uri: src }} style={styles.avatar} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
}

function Fleet() {
  const styles = useStyles()
  const t = useT()
  const { data, error, busy, reload } = useLoad(async () => {
    const [d, k] = await Promise.all([managerApi.listDrivers(), managerApi.listTrucks()])
    return { drivers: d.items, trucks: k.items }
  }, [])
  if (busy && !data) return <Loading label="Loading fleet" />
  if (!data) return <Banner tone="bad" title="Could not load" detail={error ?? ''} />
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} />}>
      <Text style={styles.section}>{t('Drivers').toUpperCase()}</Text>
      {data.drivers.map((d: MgrDriver) => (
        <View key={d.id} style={styles.row}>
          <Photo url={d.photo_url} initials={d.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2)} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{d.full_name}</Text><Text style={styles.rowSub}>{t(d.status)}{d.login_is_active ? '' : ` · ${t('login inactive')}`}</Text></View>
        </View>
      ))}
      <Text style={styles.section}>{t('Trucks').toUpperCase()}</Text>
      {data.trucks.map((k: MgrTruck) => (
        <View key={k.id} style={styles.row}>
          <Photo url={k.photo_url} initials={k.registration_number.slice(0, 2)} />
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{k.registration_number}</Text><Text style={styles.rowSub}>{k.truck_type ?? ''} · {t(k.status)}</Text></View>
        </View>
      ))}
    </ScrollView>
  )
}

// ---- More -------------------------------------------------------------------
function More() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const { user, logout } = useAuth()
  const { language } = useAppLanguage()
  const [langOpen, setLangOpen] = useState(false)
  const health = useLoad(async () => {
    const [p, r] = await Promise.all([managerApi.providers(), managerApi.ready().catch(() => ({ status: 'unreachable' }))])
    return { providers: p.providers, ready: r.status }
  }, [])
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>{t('Account').toUpperCase()}</Text>
      <Row label={t('Name')} value={user?.display_name ?? ''} />
      <Row label={t('Role')} value={user?.role ?? ''} />
      <Row label={t('Email')} value={user?.email ?? user?.phone ?? ''} />
      <Text style={styles.section}>{t('System status').toUpperCase()}</Text>
      <Row label={t('API')} value={health.data?.ready ?? '…'} />
      <Text style={styles.section}>{t('Provider health').toUpperCase()}</Text>
      {(health.data?.providers ?? []).map((p: ProviderRow) => <Row key={p.provider} label={p.provider} value={`${p.state} · ${p.freshness}`} />)}
      <Text style={styles.section}>{t('Language').toUpperCase()}</Text>
      <Pressable style={styles.row} onPress={() => setLangOpen(true)} accessibilityRole="button" accessibilityLabel="Opens language chooser">
        <Icon name="globe" color={COLORS.muted} />
        <Text style={[styles.rowTitle, { flex: 1 }]}>{t('Language')} · {language}</Text>
        <Icon name="chevron-right" color={COLORS.faint} size={20} />
      </Pressable>
      <LanguageSheet open={langOpen} onClose={() => setLangOpen(false)} />
      <Pressable style={[styles.row, { marginTop: 16 }]} onPress={() => void logout()} accessibilityRole="button" testID="mgr-logout">
        <Icon name="log-out" color={COLORS.bad} size={20} />
        <Text style={[styles.rowTitle, { color: COLORS.bad }]}>{t('Sign Out')}</Text>
      </Pressable>
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  brand: { color: COLORS.text, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  body: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 6 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.card },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2, minHeight: 56, justifyContent: 'center' },
  tabLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  section: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 14, marginBottom: 4 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: COLORS.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  statN: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  statL: { color: COLORS.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, minHeight: 56 },
  rowTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  backText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  code: { color: COLORS.text, fontSize: 13, lineHeight: 19 },
  muted: { color: COLORS.muted, fontSize: 13 },
  actions: { gap: 10, marginTop: 14 },
  chips: { flexGrow: 0, backgroundColor: COLORS.card },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.sunken },
  chipOn: { borderColor: COLORS.accent, backgroundColor: COLORS.card },
  chipText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  evidence: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.card, maxHeight: 170 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.sunken, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.text, fontWeight: '800', fontSize: 13 },
}))
