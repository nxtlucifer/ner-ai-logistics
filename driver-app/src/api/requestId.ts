/** One id per emergency. RFC 4122 v4 either way: the server's `request_id`
 *  is a UUID (anything else is a 422 on every press), and Hermes has no
 *  `crypto.randomUUID`. Same fallback as the tracker's `randomId`. */
export function makeRequestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  return g.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
