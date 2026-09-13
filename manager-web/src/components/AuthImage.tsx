/**
 * An <img> for a PRIVATE file: `/api/files/{id}` needs the bearer token, and
 * an <img src> cannot carry one, so the bytes are fetched with auth and
 * shown from an object URL. A missing or refused file renders the fallback
 * (initials for a driver, a truck glyph for a vehicle) and never a broken
 * image or a stretched layout.
 */

import { Truck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { API_BASE_URL, getAccessToken } from '../api/client'

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
}

export default function AuthImage({ src, alt, fallback, className, label }: {
  src: string | null | undefined
  alt: string
  /** Initials for a person; omit for a vehicle and a truck glyph is drawn. */
  fallback?: ReactNode
  className?: string
  /** Shown under the image so a reference photo is never mistaken for evidence. */
  label?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!src) { setUrl(null); return }
    let alive = true
    let objectUrl: string | null = null
    const token = getAccessToken()
    fetch(`${API_BASE_URL}${src}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => { if (alive) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } })
      .catch(() => { if (alive) setUrl(null) })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src])
  const box = className ?? 'h-10 w-10 rounded-full'
  return (
    <span className="inline-flex flex-col items-center gap-0.5" data-testid="auth-image">
      {url ? (
        <img src={url} alt={alt} className={`${box} shrink-0 object-cover bg-soft`} />
      ) : (
        <span aria-label={alt} className={`${box} shrink-0 inline-flex items-center justify-center bg-soft text-[11px] font-bold text-muted`}>{fallback ?? <Truck className="h-4 w-4" aria-hidden="true" />}</span>
      )}
      {label && url ? <span className="text-[9px] uppercase tracking-wide text-muted">{label}</span> : null}
    </span>
  )
}
