/**
 * The photographs this console ships, and who took them.
 *
 * One entry per photograph, copied from docs/REDESIGN_IMAGE_ATTRIBUTION.md
 * (components/ScenicImage.test.tsx holds the two in step, and fails when a
 * file lands in public/assets/redesign without an entry here). No photo carries a
 * credit control (company showcase, 1 Oct 2026): the account menu's "Legal &
 * attributions" lists every photo with its author, licence and Commons page.
 *
 * Files are cropped, resized WebP under /assets/redesign/<base>-<width>.webp,
 * each with an AVIF of the same crop beside it (<base>-<width>.avif, PERF-3):
 * a browser that decodes AVIF takes it, every other one the WebP. The scrims
 * drawn over them are CSS, never baked in, so one file serves both themes.
 */

export interface Photo {
  subject: string
  author: string
  licence: string
  licenceUrl: string
  /** The Wikimedia Commons file page. */
  page: string
  base: string
  /** Shipped widths, smallest first. */
  widths: readonly number[]
}

const BY_SA_4 = { licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }
const BY_SA_2 = { licence: 'CC BY-SA 2.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/2.0/' }

export const PHOTOS = {
  mawkdok: {
    subject: 'Mawkdok Dympep valley, Shillong–Cherrapunjee highway',
    author: 'Sanjibroy56',
    ...BY_SA_4,
    page: 'https://commons.wikimedia.org/wiki/File:Mawkdok_Dympep_Valley_,Shillong-Cherrapunjee_Highway,_Cherrapunjee,_India.jpg',
    base: 'ner-mawkdok-valley',
    // Every file q72 (PERF-3): 1280 is 125 KB, 1600 is 178 KB, inside the
    // 180 KB hero budget (audit 10.4). No 2560 (PERF-8): 462 KB for a
    // background under a scrim; a 2560 screen draws the 1920 file.
    widths: [1280, 1600, 1920],
  },
  cherrapunji: {
    subject: 'Cherrapunji mountain road, Meghalaya',
    author: 'JANENDER SINGH',
    ...BY_SA_4,
    page: 'https://commons.wikimedia.org/wiki/File:CHERRAPUNJI_ROADS_ON_BEAUTIFUL_MOUNTAINS.jpg',
    base: 'ner-cherrapunji-road',
    // q72, as every hero here (PERF-3): 1440 is 130 KB, was 173.
    widths: [960, 1440, 1920],
  },
  // The Overview's scenic card: a goods truck on a hill road, as the
  // reference card has. A 2.79:1 panorama; the truck is in its right third.
  khasiTruck: {
    subject: 'A decorated goods truck on a road in the East Khasi Hills, Meghalaya',
    author: 'Ashwin Kumar',
    ...BY_SA_2,
    page: 'https://commons.wikimedia.org/wiki/File:Meghalaya_(7344207970).jpg',
    base: 'ner-khasi-truck',
    widths: [800, 1280],
  },
} as const satisfies Record<string, Photo>

/** Both formats hold the same crop at every width (optimize_assets.py). */
export type PhotoFormat = 'webp' | 'avif'

export const photoSrc = (photo: Photo, width: number, format: PhotoFormat = 'webp'): string =>
  `/assets/redesign/${photo.base}-${width}.${format}`

export const photoSrcSet = (photo: Photo, format: PhotoFormat = 'webp'): string =>
  photo.widths.map((w) => `${photoSrc(photo, w, format)} ${w}w`).join(', ')
