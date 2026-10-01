/** A marker's on-screen box, and how much its label matters. */
export interface LabelBox {
  id: string
  /** Higher is placed first: the selected truck, then LIVE, STALE, NO CONTACT. */
  priority: number
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Which marker labels to fold down to their dot so that no two overlap
 * (MAP-1): at region zoom a NO CONTACT name at the Guwahati depot covered the
 * only LIVE truck. Labels are placed most important first; one that would
 * cover a label already placed is dropped. Its dot stays at the true position,
 * with the name still in its accessible label.
 */
export function labelsToHide(boxes: LabelBox[]): Set<string> {
  const placed: LabelBox[] = []
  const hidden = new Set<string>()
  for (const b of [...boxes].sort((a, c) => c.priority - a.priority)) {
    const covers = placed.some((p) => b.left < p.right && p.left < b.right && b.top < p.bottom && p.top < b.bottom)
    if (covers) hidden.add(b.id)
    else placed.push(b)
  }
  return hidden
}
