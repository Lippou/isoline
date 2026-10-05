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
  earthquake: {
    file: '1985 Mexico Earthquake - Nuevo Leon building 2.jpg',
    author: 'United States Geological Survey',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-USGS',
    source: 'https://commons.wikimedia.org/wiki/File:1985_Mexico_Earthquake_-_Nuevo_Leon_building_2.jpg',
    crop: [0.01, 0, 0.98],
    gamma: 1,
  },
  volcano: {
    file: 'MSH80 eruption mount st helens 05-18-80.jpg',
    author: 'Austin Post / USGS',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-Interior-USGS',
    source: 'https://commons.wikimedia.org/wiki/File:MSH80_eruption_mount_st_helens_05-18-80.jpg',
    crop: [0, 0.3, 1],
    gamma: 1.1,
  },
  hurricane: {
    file: "US Navy 050709-N-0000B-005 Hurricane Dennis batters palm trees and floods parts of Naval Air Station (NAS) Key West's Truman Annex.jpg",
    author: 'Jim Brooks / U.S. Navy',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-Navy',
    source:
      'https://commons.wikimedia.org/wiki/File:US_Navy_050709-N-0000B-005_Hurricane_Dennis_batters_palm_trees_and_floods_parts_of_Naval_Air_Station_(NAS)_Key_West%27s_Truman_Annex.jpg',
    crop: [0.005, 0, 0.99],
    gamma: 1.35,
  },
  harshWinter: {
    file: 'JR65 Talvisodassa - Paluu rintamalta Kuhmosta.jpg',
    author: 'Unknown author / SA-kuva',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:JR65_Talvisodassa_-_Paluu_rintamalta_Kuhmosta.jpg',
    crop: [0, 0.02, 1],
    gamma: 1.25,
  },
  oilShock: {
    file: 'Oil pumpjack in the Permian Basin.jpg',
    author: 'Quintin Soloviev',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Oil_pumpjack_in_the_Permian_Basin.jpg',
    crop: [0, 0.08, 0.8],
    gamma: 1,
  },
  mutiny: {
    file: 'Petrograd. Soldiers on horseback and trams in Nevsky Prospekt. LCCN2011647896 (cropped).jpg',
    author: 'Pringle, James Maxwell / Library of Congress',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-old-70-1923',
    source:
      'https://commons.wikimedia.org/wiki/File:Petrograd._Soldiers_on_horseback_and_trams_in_Nevsky_Prospekt._LCCN2011647896_(cropped).jpg',
    crop: [0.08, 0, 0.845],
    gamma: 1,
  },
  armsRace: {
    file: 'Titan Missile (41980404201).jpg',
    author: 'Mike McBey',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Titan_Missile_(41980404201).jpg',
    crop: [0, 0.05, 1],
    gamma: 1,
  },
  railStrike: {
    file: 'Striking railroad men LOC npcc.06846.jpg',
    author: 'National Photo Company / Library of Congress',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-National_Photo_Company',
    source: 'https://commons.wikimedia.org/wiki/File:Striking_railroad_men_LOC_npcc.06846.jpg',
    crop: [0.02, 0.12, 0.92],
    gamma: 1,
  },
  breakthrough: {
    file: 'Microscope (1).jpg',
    author: 'Unknown photographer / National Cancer Institute',
    licence: 'Public domain',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-HHS-NIH',
    source: 'https://commons.wikimedia.org/wiki/File:Microscope_(1).jpg',
    crop: [0, 0, 1],
    gamma: 1,
  },
  publicWorks: {
    file: 'Empire State Building MET DP106404.jpg',
    author: 'Lewis Hine / The Metropolitan Museum of Art',
    licence: 'CC0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Empire_State_Building_MET_DP106404.jpg',
    crop: [0.04, 0.08, 0.92],
    gamma: 1,
  },
  worldGames: {
    file: '2010 Opening Ceremony - France entering.jpg',
    author: 'Jude Freeman',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    source: 'https://commons.wikimedia.org/wiki/File:2010_Opening_Ceremony_-_France_entering.jpg',
    crop: [0.1, 0.1, 0.8],
    gamma: 1.2,
  },
};

/** Where the printed photo of an event is served (relative: the isoline:// app root or Vite). */
export const pressPhotoUrl = (id: WorldEventId) => `./press/${id}.webp`;

export const hasPressPhoto = (id: string): id is WorldEventId => Object.hasOwn(PRESS_PHOTOS, id);
