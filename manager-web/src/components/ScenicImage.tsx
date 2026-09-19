/**
 * Photographs, their scrims and their credits.
 *
 * ScenicImage         a responsive photo (srcset, lazy unless it is the page's
 *                     hero) under a scrim token, with a Photo credits control.
 * PhotoCreditsButton  the small (i) in a corner of the photo. It opens the
 *                     full list; no credit text is drawn over the design
 *                     (owner decision 5, docs/REDESIGN_IMAGE_ATTRIBUTION.md).
 * ImageCreditsDialog  the full list: every photo, its author, licence and
 *                     source link. Also opened from the account menu.
 *
 * A photo never carries information: it is `alt=""`, and nothing on it may be
 * the only place a fact appears. The scrim is a token (`--image-scrim`, forest
 * in Light, neutral black in Dark), so components never ask which theme is on.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal, preload } from 'react-dom'
import { Info, X } from 'lucide-react'

import { PHOTOS, photoSrc, photoSrcSet, type Photo } from '../imageCredits'
import { wrapTab } from './focusTrap'

export function ScenicImage({
  photo,
  sizes,
  priority = false,
  media,
  position = '50% 50%',
  scrim = 'bottom',
  className = 'relative',
  creditClassName = 'bottom-2 right-2',
  creditLabel,
  children,
}: {
  photo: Photo
  /** The rendered width, for the browser's srcset choice (e.g. "61vw"). */
  sizes: string
  /** The page's largest paint: preloaded and fetched first. Everything else is lazy. */
  priority?: boolean
  /** Where the photo is the hero only above a breakpoint (hidden, or below
   *  the fold, on a phone): preloaded only where this matches, and lazy, so a
   *  phone never downloads a photo it does not show. */
  media?: string
  /** CSS object-position: where the photo's focal point sits. */
  position?: string
  /** Which scrim token: `bottom` darkens towards the foot, `side` from the left. */
  scrim?: 'bottom' | 'side' | 'none'
  /** Positioning included: `relative` unless the caller places it (absolute). */
  className?: string
  /** Which corner the Photo credits control sits in. */
  creditClassName?: string
  /** For a photo outside every landmark (the sign-in steps): the control is
   *  put in a named complementary landmark, so it is found by landmark as
   *  well as by Tab (A11Y-7). */
  creditLabel?: string
  /** Overlays and content drawn above the scrim. */
  children?: ReactNode
}) {
  const srcSet = photoSrcSet(photo)
  // AVIF first (PERF-3): the same crop at the same widths, about a fifth
  // lighter at equal SSIM. The preload names the AVIF set with its type, so
  // the browser that takes the <source> reuses the preloaded file, and one
  // without AVIF skips the preload and fetches the WebP once.
  const avifSet = photoSrcSet(photo, 'avif')
  if (priority) {
    preload(photoSrc(photo, photo.widths[0], 'avif'), {
      as: 'image',
      type: 'image/avif',
      imageSrcSet: avifSet,
      imageSizes: sizes,
      fetchPriority: 'high',
      media,
    })
  }
  // With `media`, the preload does the early fetch where it applies; the
  // img stays lazy so a display:none panel is never fetched.
  const eager = priority && !media
  return (
    <div className={`overflow-hidden ${className}`}>
      <picture>
        <source type="image/avif" srcSet={avifSet} sizes={sizes} />
        <img
          src={photoSrc(photo, photo.widths[0])}
          srcSet={srcSet}
          sizes={sizes}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          // A photo that is not the page's hero yields to its data (PERF-2).
          fetchPriority={eager ? 'high' : priority ? 'auto' : 'low'}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: position }}
        />
      </picture>
      {scrim === 'none' ? null : (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: scrim === 'side' ? 'var(--image-scrim-side)' : 'var(--image-scrim)' }}
        />
      )}
      {children}
      {creditLabel ? (
        <aside aria-label={creditLabel} className={`absolute z-10 ${creditClassName}`}>
          <PhotoCreditsButton />
        </aside>
      ) : (
        <PhotoCreditsButton className={`absolute z-10 ${creditClassName}`} />
      )}
    </div>
  )
}

/** The Photo credits control: a 28px (i) on the photo that opens the full
 *  list and gives focus back when it closes. An icon, not a caption, so no
 *  credit text overlaps a headline, a map or a control; the attribution the
 *  licences require is one press away (owner decision 5). White on the 60%
 *  black disc is at least 5.7:1 over any photo. */
export function PhotoCreditsButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Photo credits"
        aria-haspopup="dialog"
        title="Photo credits"
        className={`on-image-focus grid size-7 place-items-center rounded-full bg-[var(--image-credit-bg)] text-on-image hover:bg-black/80 ${className}`}
      >
        <Info className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <ImageCreditsDialog
          onClose={() => {
            setOpen(false)
            trigger.current?.focus()
          }}
        />
      ) : null}
    </>
  )
}

export function ImageCreditsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => close.current?.focus(), [])
  // Portalled to <body>: the triggers sit inside a photo's clipped box and
  // inside the topbar's stacking context (account menu).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-credits-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        } else wrapTab(e)
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--overlay)] p-4"
    >
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface-raised p-5 text-left shadow-[var(--shadow-float)]">
        <div className="flex items-start justify-between gap-3">
          <h2 id="image-credits-title" className="text-base font-semibold text-ink">
            Image credits
          </h2>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close image credits"
            className="grid size-9 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-soft hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-3 space-y-3">
          {Object.values(PHOTOS).map((photo) => (
            <li key={photo.base} className="rounded-[var(--radius-control)] border border-line p-3 text-[13px] leading-snug">
              <p className="font-semibold text-ink">{photo.subject}</p>
              <p className="mt-0.5 text-muted">
                Photo by {photo.author} ·{' '}
                <a href={photo.licenceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">
                  {photo.licence}
                </a>{' '}
                ·{' '}
                <a href={photo.page} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">
                  Wikimedia Commons
                </a>
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Each photograph was cropped, resized and re-encoded as WebP and AVIF, and a scrim is drawn over it on
          screen. Files adapted from CC BY-SA originals are released under the original's licence.
        </p>
      </div>
    </div>,
    document.body,
  )
}
