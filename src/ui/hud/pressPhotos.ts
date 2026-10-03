// The Courier's press photos: one real photograph per world event, printed in the paper's
// ink (scripts/press/build-photos.ts downloads them from Wikimedia Commons, checks their
// licence, crops them to 3:2 and prints them in duotone). Credits: CREDITS.md.
import type { WorldEventId } from '../../core/rules/features';

export interface PressPhoto {
  /** File name on Wikimedia Commons (without "File:"). */
  file: string;
  /** Credit line, as printed under the photo. */
  author: string;
  /** Licence short name as Commons gives it ("Public domain" is printed in the reader's language). */
  licence: 'Public domain' | 'CC0' | 'CC BY 2.0' | 'CC BY 4.0';
  licenceUrl: string;
  /** The Commons file page. */
  source: string;
  /** The 3:2 frame cut from the original: left, top and width as fractions of the original. */
  crop: [x: number, y: number, w: number];
  /** Print: levels clipped at these percentiles, then a gamma (< 1 lightens). */
  gamma?: number;
  /** Red ink kept as the magenta spot colour (0..1): the boards "in the red". */
  spot?: number;
}

/** Processed size (3:2), served from public/press/. */
export const PRESS_W = 768;
export const PRESS_H = 512;

export const PRESS_PHOTOS: Record<WorldEventId, PressPhoto> = {
  crisis: {
    file: 'Electronic stock board in Yaesu, Tokyo 2007.jpg',
    author: 'nappa',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Electronic_stock_board_in_Yaesu,_Tokyo_2007.jpg',
    crop: [0, 0.08, 0.89],
    gamma: 1.35,
    spot: 1,
  },
  pandemic: {
    file: 'Connecticut National Guard sets up federal medical station equipment at Southern Connecticut State University (8).jpg',
    author: 'Steven Tucker / U.S. Air National Guard',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-National_Guard',
    source:
      'https://commons.wikimedia.org/wiki/File:Connecticut_National_Guard_sets_up_federal_medical_station_equipment_at_Southern_Connecticut_State_University_(8).jpg',
    crop: [0.19, 0.42, 0.62],
    gamma: 0.95,
  },
  boom: {
    file: 'Container crane @ Container terminal @ Harbour Tour @ Spido @ Rotterdam (30530447836).jpg',
    author: 'Guilhem Vellut',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    source:
      'https://commons.wikimedia.org/wiki/File:Container_crane_@_Container_terminal_@_Harbour_Tour_@_Spido_@_Rotterdam_(30530447836).jpg',
    crop: [0, 0, 1],
    gamma: 1.1,
  },
  solarStorm: {
    file: '220305-F-EI268-1046 - Arctic sky illuminates Patriot (Image 1 of 2).jpg',
    author: 'Joseph Leveille / U.S. Air Force',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-Air_Force',
    source:
      'https://commons.wikimedia.org/wiki/File:220305-F-EI268-1046_-_Arctic_sky_illuminates_Patriot_(Image_1_of_2).jpg',
    crop: [0.02, 0, 0.96],
    gamma: 0.8,
  },
  peaceSummit: {
    file: 'United Nations Headquarters - Security Council chamber, angled view (cropped).jpg',
    author: 'Jdforrester',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source:
      'https://commons.wikimedia.org/wiki/File:United_Nations_Headquarters_-_Security_Council_chamber,_angled_view_(cropped).jpg',
    crop: [0.19, 0.43, 0.51],
    gamma: 1,
  },
};

/** Where the printed photo of an event is served (relative: the isoline:// app root or Vite). */
export const pressPhotoUrl = (id: WorldEventId) => `./press/${id}.webp`;

export const hasPressPhoto = (id: string): id is WorldEventId => Object.hasOwn(PRESS_PHOTOS, id);
