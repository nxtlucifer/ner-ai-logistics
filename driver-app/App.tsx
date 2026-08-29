/**
 * NER Driver App - development build shell.
 *
 * Foundation phase. No trip, GPS, camera or safety feature exists yet - see
 * docs/DEVELOPMENT_ROADMAP.md. Everything shown is real state read from the
 * backend.
 *
 * NOTE: this screen requests NO permissions. Location permission is requested in
 * phase P5, together with the rationale screen required by docs/SECURITY.md
 * section 3. Asking before there is a trip to track would be asking for access
 * we have no use for yet.
 */

import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { API_BASE_URL } from './src/api/client'
import {
  useBackendStatus,
  type ConnectionStatus,
  type DependencyStatus,
} from './src/hooks/useBackendStatus'

const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  muted: '#94a3b8',
  faint: '#64748b',
  ok: '#34d399',
  bad: '#f87171',
  pending: '#fbbf24',
  unknown: '#94a3b8',
  accentBg: '#451a03',
  accentText: '#fcd34d',
  errorBg: '#450a0a',
  errorBorder: '#7f1d1d',
  errorText: '#fca5a5',
}

function connectionLabel(s: ConnectionStatus): { text: string; color: string } {
  switch (s) {
    case 'connected':
      return { text: 'Connected', color: COLORS.ok }
    case 'disconnected':
      return { text: 'Disconnected', color: COLORS.bad }
    case 'checking':
      return { text: 'Checking…', color: COLORS.pending }
  }
}

function dependencyLabel(s: DependencyStatus): { text: string; color: string } {
  switch (s) {
    case 'ready':
      return { text: 'Ready', color: COLORS.ok }
    case 'not_ready':
      return { text: 'Not Ready', color: COLORS.bad }
    case 'checking':
      return { text: 'Checking…', color: COLORS.pending }
    case 'unknown':
      // Backend unreachable, so the database was never observed.
      return { text: 'Unknown', color: COLORS.unknown }
  }
}

interface RowProps {
  label: string
  value: string
  color: string
  detail?: string | null
}

function StatusRow({ label, value, color, detail }: RowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? (
          <Text style={styles.rowDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.rowValue, { color }]}>{value}</Text>
      </View>
    </View>
  )
}

export default function App() {
  const status = useBackendStatus()
  const connection = connectionLabel(status.connection)
  const database = dependencyLabel(status.database)

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>NER Driver App</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>DEVELOPMENT BUILD</Text>
        </View>

        <Text style={styles.intro}>
          Foundation phase. No trip or tracking features are implemented yet —
          the values below are read live from the backend.
        </Text>

        <View style={styles.card}>
          <StatusRow
            label="Backend connection"
            value={connection.text}
            color={connection.color}
            detail={API_BASE_URL}
          />
          <StatusRow
            label="Database"
            value={database.text}
            color={database.color}
            detail={status.databaseDetail}
          />
        </View>

        {status.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Connection error</Text>
            <Text style={styles.errorBody}>{status.error}</Text>
            <Text style={styles.errorHint}>
              On a physical phone the backend must be reachable on your LAN IP,
              not localhost, and Windows Firewall must allow inbound port 8000.
              See README.md.
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {status.lastCheckedAt
              ? `Last checked ${status.lastCheckedAt.toLocaleTimeString()}`
              : 'Not yet checked'}
          </Text>
          <Pressable
            onPress={status.refresh}
            disabled={status.isRefreshing}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              status.isRefreshing && styles.buttonDisabled,
            ]}
          >
            {status.isRefreshing ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <Text style={styles.buttonText}>Refresh</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.note}>
          No location or camera permission is requested at this stage.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { padding: 24, paddingTop: 48 },
  title: { fontSize: 28, fontWeight: '700', color: COLORS.text },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.accentBg,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.accentText,
  },
  intro: { marginTop: 16, fontSize: 14, lineHeight: 21, color: COLORS.muted },
  card: {
    marginTop: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  rowLeft: { flexShrink: 1 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  rowDetail: { marginTop: 4, fontSize: 11, color: COLORS.faint },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 999 },
  rowValue: { fontSize: 14, fontWeight: '700' },
  errorBox: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    backgroundColor: COLORS.errorBg,
    padding: 14,
  },
  errorTitle: { fontSize: 13, fontWeight: '700', color: COLORS.errorText },
  errorBody: { marginTop: 4, fontSize: 12, color: COLORS.errorText },
  errorHint: { marginTop: 8, fontSize: 11, lineHeight: 16, color: COLORS.muted },
  footer: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 12, color: COLORS.faint },
  button: {
    minWidth: 92,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  buttonPressed: { backgroundColor: COLORS.card },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  note: { marginTop: 32, fontSize: 11, lineHeight: 17, color: COLORS.faint },
})
