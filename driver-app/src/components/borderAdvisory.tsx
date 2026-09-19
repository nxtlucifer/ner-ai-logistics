/**
 * The border-advisory banner (owner decision 2, 29 Sep 2026).
 *
 * Border status is DATA from an official source, never code: this file names
 * no country and decides nothing about any boundary. It only words what the
 * server sent. Nothing sent -> nothing shown; NORMAL -> nothing shown; an
 * UNKNOWN or unrecognised status says it is not confirmed and never reads as
 * clear. Calm on purpose: amber caution, not the red of an emergency.
 */
import type { BorderAdvisory } from '../api/client'
import { useT } from '../i18n/tx'
import { Banner } from './ui'

const FALLBACK: Record<string, { title: string; detail: string }> = {
  ADVISORY: {
    title: 'Border advisory',
    detail: 'There is an official border advisory for this road. Follow dispatch instructions.',
  },
  RESTRICTED: {
    title: 'Border restriction',
    detail: 'Official border restrictions apply on this road. Follow dispatch instructions.',
  },
  UNKNOWN: {
    title: 'Border status not confirmed',
    detail: 'There is no current official border status for this road. This does not mean it is clear.',
  },
}

/** The banner's words, or null when there is nothing to say. The server's
 *  own message wins over the fallback; UNKNOWN keeps its fixed wording so a
 *  message can never turn "not confirmed" into "clear". */
export function borderAdvisoryCopy(
  advisory: BorderAdvisory | null | undefined,
): { title: string; detail: string; source: string | null } | null {
  if (!advisory || advisory.status === 'NORMAL') return null
  const known = advisory.status === 'ADVISORY' || advisory.status === 'RESTRICTED'
  const copy = FALLBACK[known ? advisory.status : 'UNKNOWN']
  const message = known ? advisory.message?.trim() : ''
  return { title: copy.title, detail: message || copy.detail, source: advisory.source?.trim() || null }
}

export function BorderAdvisoryBanner({ advisory }: { advisory: BorderAdvisory | null | undefined }) {
  const t = useT()
  const copy = borderAdvisoryCopy(advisory)
  if (!copy) return null
  const detail = copy.source ? `${t(copy.detail)} · ${t('Source')}: ${copy.source}` : copy.detail
  return <Banner tone="warn" title={copy.title} detail={detail} style={{ marginBottom: 0 }} />
}
