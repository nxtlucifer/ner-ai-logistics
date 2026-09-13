// Vitest stand-in for @expo/vector-icons: the real package resolves its font
// modules through Metro, which Vite cannot follow. A glyph is a labelled span.
import { createElement } from 'react'

export function Feather({ name, size, color }: { name: string; size?: number; color?: string }) {
  return createElement('span', { 'data-icon': name, style: { fontSize: size, color } })
}
export default { Feather }
