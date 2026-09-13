/**
 * A private `/api/files/{id}` image as a data URI.
 *
 * `<Image source={{ uri, headers }}>` looked right but the Android image
 * pipeline reached the server WITHOUT the Authorization header (401 in the
 * server log, a grey circle on the phone). Fetching the bytes ourselves with
 * the bearer and handing the Image a data URI is the version that works on
 * every platform; the files are at most a few hundred KB.
 */

import { useEffect, useState } from 'react'

import { API_BASE_URL, authHeaders } from '../api/client'

// Same file, same bytes: the header and My details share one download.
const cache = new Map<string, string>()

export function useAuthImage(url: string | null | undefined): string | null {
  const [uri, setUri] = useState<string | null>(() => (url ? cache.get(url) ?? null : null))
  useEffect(() => {
    if (!url) {
      setUri(null)
      return
    }
    const hit = cache.get(url)
    if (hit) {
      setUri(hit)
      return
    }
    let alive = true
    fetch(`${API_BASE_URL}${url}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(blob)
          }),
      )
      .then((dataUri) => { cache.set(url, dataUri); if (alive) setUri(dataUri) })
      .catch(() => { if (alive) setUri(null) })
    return () => { alive = false }
  }, [url])
  return uri
}
