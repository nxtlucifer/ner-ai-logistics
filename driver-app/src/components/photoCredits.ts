/**
 * Every photograph the driver app ships, and who to thank for it.
 *
 * ONE source for the on-photo credit and the More -> Image credits list, copied
 * from docs/REDESIGN_IMAGE_ATTRIBUTION.md (the licence was read on each file
 * page before download). `photoCredits.test.ts` holds each entry to that
 * document and to the files in assets/redesign, so a photo cannot be added,
 * swapped or re-credited here without the document agreeing.
 *
 * `source` is a thunk: Metro bundles the file from the static require, and a
 * test that only reads the credits never loads an image.
 */

export type PhotoKey = 'login' | 'more' | 'navigate' | 'safety' | 'strip'

export interface PhotoCredit {
  file: string
  subject: string
  author: string
  licence: 'CC BY 2.0' | 'CC BY 4.0' | 'CC BY-SA 2.0' | 'CC BY-SA 4.0'
  /** The Wikimedia Commons file page: author, licence and the original. */
  page: string
  source: () => number
}

export const LICENCE_URL: Record<PhotoCredit['licence'], string> = {
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
}

export const PHOTOS: Record<PhotoKey, PhotoCredit> = {
  login: {
    file: 'driver-login-cherrapunji-road.webp',
    subject: 'Cherrapunji mountain road, Meghalaya',
    author: 'JANENDER SINGH',
    licence: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:CHERRAPUNJI_ROADS_ON_BEAUTIFUL_MOUNTAINS.jpg',
    source: () => require('../../assets/redesign/driver-login-cherrapunji-road.webp'),
  },
  more: {
    file: 'driver-more-laitmawsiang.webp',
    subject: 'Laitmawsiang ridges, Meghalaya',
    author: 'Rajesh Dutta',
    licence: 'CC BY 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Nature_Scenic_Landscape_Meghalaya_Laitmawsiang_India_July_2011.jpg',
    source: () => require('../../assets/redesign/driver-more-laitmawsiang.webp'),
  },
  navigate: {
    file: 'driver-navigate-mayodia-road.webp',
    subject: 'Mountain road to Mayodia Pass, Arunachal Pradesh',
    author: 'Jyoti Chiring',
    licence: 'CC BY 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Mountain_road_leading_to_Mayodia_Pass,_Arunachal_Pradesh.jpg',
    source: () => require('../../assets/redesign/driver-navigate-mayodia-road.webp'),
  },
  // A goods truck, not a landscape: the Safety tab is about the driver's own
  // road. Replaced the Sela Pass photo, whose only vehicle was a utility van.
  safety: {
    file: 'driver-safety-khasi-truck.webp',
    subject: 'A decorated goods truck on a road in the East Khasi Hills, Meghalaya',
    author: 'Ashwin Kumar',
    licence: 'CC BY-SA 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Meghalaya_(7344207970).jpg',
    source: () => require('../../assets/redesign/driver-safety-khasi-truck.webp'),
  },
  strip: {
    file: 'driver-strip-barapani-lake.webp',
    subject: 'Barapani (Umiam) lake, Shillong',
    author: 'Rajesh Dutta',
    licence: 'CC BY 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Landscape_Meghalaya_Barapani_Shillong_India.jpg',
    source: () => require('../../assets/redesign/driver-strip-barapani-lake.webp'),
  },
}
