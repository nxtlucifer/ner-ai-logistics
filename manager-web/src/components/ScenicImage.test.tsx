// @vitest-environment jsdom
/**
 * Photographs are licensed, so every one is credited where it is shown and in
 * one list; the list is the attribution document, not a second copy of it.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PHOTOS } from '../imageCredits'
import { ProfileMenu } from './ProfileMenu'
import { ImageCreditsDialog, ScenicImage } from './ScenicImage'

afterEach(cleanup)

const ROOT = join(__dirname, '..', '..')
const DOC = readFileSync(join(ROOT, '..', 'docs', 'REDESIGN_IMAGE_ATTRIBUTION.md'), 'utf8')

describe('ScenicImage', () => {
  it('fetches the hero first and every other photo lazily, at the width it needs', () => {
    const { container } = render(
      <>
        <ScenicImage photo={PHOTOS.cherrapunji} sizes="61vw" priority />
        <ScenicImage photo={PHOTOS.khasiTruck} sizes="320px" />
      </>,
    )
    const [hero, card] = [...container.querySelectorAll('img')]
    expect(hero.getAttribute('loading')).toBe('eager')
    expect(hero.getAttribute('fetchpriority')).toBe('high')
    expect(hero.getAttribute('srcset')).toBe(
      '/assets/redesign/ner-cherrapunji-road-960.webp 960w, /assets/redesign/ner-cherrapunji-road-1440.webp 1440w, /assets/redesign/ner-cherrapunji-road-1920.webp 1920w',
    )
    expect(hero.getAttribute('sizes')).toBe('61vw')
    expect(card.getAttribute('loading')).toBe('lazy')
    // A photo never carries information.
    expect([hero.getAttribute('alt'), card.getAttribute('alt')]).toEqual(['', ''])
    // AVIF first, the same widths and slot; the WebP img is the fallback.
    const source = hero.parentElement!.querySelector('source')!
    expect(hero.parentElement!.tagName).toBe('PICTURE')
    expect(source.getAttribute('type')).toBe('image/avif')
    expect(source.getAttribute('srcset')).toBe(hero.getAttribute('srcset')!.replaceAll('.webp', '.avif'))
    expect(source.getAttribute('sizes')).toBe('61vw')
    // Only the hero is preloaded, and as the AVIF the <source> picks, typed so
    // a browser without AVIF skips it: never a second copy of the photo.
    const preloads = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')]
    expect(preloads.map((l) => [l.getAttribute('imagesrcset'), l.getAttribute('imagesizes'), l.getAttribute('type'), l.getAttribute('fetchpriority')])).toEqual([
      [source.getAttribute('srcset'), '61vw', 'image/avif', 'high'],
    ])
  })

  it('with a media query, preloads only where it applies and never fetches eagerly', () => {
    // The login panel is display:none below 1024 and the region photo is below
    // a phone's fold: an eager img would still be downloaded there.
    const { container } = render(
      <ScenicImage photo={PHOTOS.mawkdok} sizes="100vw" priority media="(min-width: 1024px)" />,
    )
    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('fetchpriority')).toBe('auto')
    const avif = img.parentElement!.querySelector('source')!.getAttribute('srcset')
    const link = document.head.querySelector(`link[rel="preload"][imagesrcset="${avif}"]`)
    expect(link?.getAttribute('media')).toBe('(min-width: 1024px)')
    expect(link?.getAttribute('type')).toBe('image/avif')
  })

  it('draws the scrim from a token, never a colour of its own', () => {
    const { container } = render(<ScenicImage photo={PHOTOS.cherrapunji} sizes="100vw" scrim="side" />)
    expect(container.innerHTML).toContain('var(--image-scrim-side)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i)
  })

  it('credits the photo on the image, linking to its Commons page', () => {
    render(<ScenicImage photo={PHOTOS.mawkdok} sizes="100vw" />)
    const link = screen.getByRole('link', { name: /Photo: Sanjibroy56 · CC BY-SA 4.0/ })
    expect(link.getAttribute('href')).toBe(PHOTOS.mawkdok.page)
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})

describe('image credits', () => {
  it('match the attribution document, row for row', () => {
    for (const photo of Object.values(PHOTOS)) {
      const row = DOC.split('\n').find((line) => line.includes(`manager-web/public/assets/redesign/${photo.base}-`))
      expect(row, photo.base).toBeTruthy()
      expect(row).toContain(`| ${photo.author} |`)
      expect(row).toContain(`| ${photo.licence} |`)
      expect(row).toContain(`(${photo.page})`)
      for (const w of photo.widths) {
        expect(row).toContain(`${photo.base}-${w}.webp`)
        expect(row).toContain(`${photo.base}-${w}.avif`)
      }
    }
  })

  it('cover every photograph the console ships, in both formats', () => {
    const shipped = readdirSync(join(ROOT, 'public', 'assets', 'redesign')).sort()
    const listed = Object.values(PHOTOS)
      .flatMap((p) => p.widths.flatMap((w) => [`${p.base}-${w}.webp`, `${p.base}-${w}.avif`]))
      .sort()
    expect(listed).toEqual(shipped)
  })

  it('list every photo with author, licence and source, and close on Escape', () => {
    const onClose = vi.fn()
    render(<ImageCreditsDialog onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Image credits' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    for (const photo of Object.values(PHOTOS)) {
      expect(dialog.textContent).toContain(photo.author)
      expect(screen.getAllByRole('link', { name: photo.licence }).some((a) => a.getAttribute('href') === photo.licenceUrl)).toBe(true)
    }
    expect(screen.getAllByRole('link', { name: 'Wikimedia Commons' })).toHaveLength(Object.keys(PHOTOS).length)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close image credits' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('are reachable from the account menu, which gives focus back to the avatar', async () => {
    const user = userEvent.setup()
    render(<ProfileMenu name="Regional Head" role="Regional head" onSignOut={() => {}} />)
    const trigger = screen.getByRole('button', { name: /Account menu/ })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Image credits' }))
    expect(screen.getByRole('dialog', { name: 'Image credits' })).toBeTruthy()
    // The menu closed behind it.
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Close image credits' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
