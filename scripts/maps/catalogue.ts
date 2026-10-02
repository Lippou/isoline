// Data for the regional real-world maps added in 1.2 (consumed by build-maps.ts):
// frame, curated sub-national nations, hand-drawn relief where Natural Earth has
// none, and the short lobby descriptions of every shipped map.
import type { LocalizedName } from '../../src/core/map/gamemap';

/** A nation placed by hand (historic region, or a real country whose label point is off-frame). */
export interface ExtraNation {
  fr: string;
  en: string;
  lon: number;
  lat: number;
  /** ISO code (flag-icons naming, lower case): real flag and national colour. */
  iso?: string;
  /** Lobby priority (countries weigh sqrt(population) + 400). Default 2500. */
  weight?: number;
}

/** A relief line rasterised into the mountain / hill masks before synthesis. */
export interface ReliefLine {
  kind: 'mountains' | 'hills';
  /** Approximate width of the range in km. */
  km: number;
  pts: [number, number][];
}

export interface RegionDef {
  id: string;
  name: LocalizedName;
  /** Equirectangular frame: [lonMin, lonMax, latMin, latMax]. */
  box: [number, number, number, number];
  width: number;
  riverRank: number;
  maxNations: number;
  /** Natural Earth countries to drop (lower-case ISO code or English NAME). */
  exclude?: string[];
  extras: ExtraNation[];
  relief?: ReliefLine[];
  /** Ridged valley texture inside highlands (≈ 0.15–0.3). */
  rugged?: number;
  /** Synth moisture shift (negative = fewer forests). */
  moistureBias?: number;
}

const M = (km: number, ...pts: [number, number][]): ReliefLine => ({ kind: 'mountains', km, pts });
const H = (km: number, ...pts: [number, number][]): ReliefLine => ({ kind: 'hills', km, pts });

export const REGIONS: RegionDef[] = [
  {
    id: 'british-isles',
    name: { fr: 'Îles Britanniques', en: 'British Isles' },
    box: [-11, 3, 47.8, 61],
    width: 1100,
    riverRank: 10,
    maxNations: 30,
    rugged: 0.25,
    moistureBias: -0.12,
    exclude: ['gb'], // replaced by the home nations and historic regions
    extras: [
      { fr: 'Angleterre', en: 'England', lon: -0.6, lat: 51.6, iso: 'gb-eng', weight: 9000 },
      { fr: 'France', en: 'France', lon: -0.5, lat: 48.9, iso: 'fr', weight: 8000 },
      { fr: 'Écosse', en: 'Scotland', lon: -3.6, lat: 56.3, iso: 'gb-sct', weight: 5000 },
      { fr: 'Pays de Galles', en: 'Wales', lon: -3.6, lat: 52.3, iso: 'gb-wls', weight: 4000 },
      { fr: 'Irlande du Nord', en: 'Northern Ireland', lon: -6.7, lat: 54.6, iso: 'gb-nir', weight: 3500 },
      { fr: 'Bretagne', en: 'Brittany', lon: -3.0, lat: 48.25, weight: 3000 },
      { fr: 'Wessex', en: 'Wessex', lon: -2.2, lat: 51.0, weight: 2600 },
      { fr: 'Mercie', en: 'Mercia', lon: -1.9, lat: 52.7, weight: 2600 },
      { fr: 'Northumbrie', en: 'Northumbria', lon: -1.9, lat: 55.0, weight: 2500 },
      { fr: 'Yorkshire', en: 'Yorkshire', lon: -1.2, lat: 53.95, weight: 2500 },
      { fr: 'Munster', en: 'Munster', lon: -8.7, lat: 52.3, weight: 2400 },
      { fr: 'Est-Anglie', en: 'East Anglia', lon: 1.0, lat: 52.5, weight: 2400 },
      { fr: 'Highlands', en: 'Highlands', lon: -4.8, lat: 57.3, weight: 2400 },
      { fr: 'Strathclyde', en: 'Strathclyde', lon: -4.6, lat: 55.6, weight: 2300 },
      { fr: 'Connacht', en: 'Connacht', lon: -9.0, lat: 53.7, weight: 2200 },
      { fr: 'Cumbrie', en: 'Cumbria', lon: -3.0, lat: 54.5, weight: 2200 },
      { fr: 'Kent', en: 'Kent', lon: 0.8, lat: 51.2, weight: 2200 },
      { fr: 'Grampian', en: 'Grampian', lon: -2.8, lat: 57.1, weight: 2100 },
      { fr: 'Cornouailles', en: 'Cornwall', lon: -4.8, lat: 50.45, weight: 2000 },
      { fr: 'Ulster', en: 'Ulster', lon: -7.9, lat: 54.9, weight: 2000 },
      { fr: 'Picardie', en: 'Picardy', lon: 2.2, lat: 49.9, weight: 2000 },
      { fr: 'Hébrides', en: 'Hebrides', lon: -6.7, lat: 58.0, weight: 1500 },
      { fr: 'Orcades', en: 'Orkney', lon: -3.1, lat: 59.0, weight: 1200 },
      { fr: 'Shetland', en: 'Shetland', lon: -1.3, lat: 60.3, weight: 1200 },
    ],
    relief: [
      H(40, [-2.3, 55.1], [-2.2, 54.4], [-2.0, 53.6], [-1.8, 53.0]), // Pennines
      H(45, [-4.9, 55.1], [-3.6, 55.4], [-2.5, 55.5]), // Southern Uplands
      M(55, [-5.3, 58.4], [-5.2, 57.6], [-5.0, 57.0]), // North-West Highlands
      M(55, [-5.3, 56.7], [-4.2, 56.85], [-3.0, 57.05]), // Grampians
      M(25, [-3.9, 57.1], [-3.4, 57.1]), // Cairngorms
      M(25, [-4.1, 53.1], [-3.8, 52.9]), // Snowdonia
      H(25, [-3.8, 51.88], [-3.2, 51.9]), // Brecon Beacons
      H(25, [-1.2, 54.4], [-0.7, 54.35]), // North York Moors
      M(18, [-9.8, 53.55], [-9.5, 53.5]), // Connemara
      H(25, [-8.2, 54.95], [-7.9, 55.1]), // Donegal
      M(14, [-3.3, 54.6], [-2.9, 54.4]), // Lake District
      H(18, [-4.1, 50.65], [-3.8, 50.55]), // Dartmoor
      H(20, [-6.5, 53.2], [-6.4, 52.8]), // Wicklow
      M(16, [-9.9, 52.0], [-9.5, 51.95]), // MacGillycuddy's Reeks
      H(16, [-6.2, 54.2], [-5.9, 54.15]), // Mournes
    ],
  },
  {
    id: 'scandinavia',
    name: { fr: 'Scandinavie & Baltique', en: 'Scandinavia & Baltic' },
    box: [4, 32, 53.5, 71.3],
    width: 1250,
    riverRank: 9,
    maxNations: 30,
    rugged: 0.25,
    extras: [
      { fr: 'Russie', en: 'Russia', lon: 30.5, lat: 59.4, iso: 'ru', weight: 9500 },
      { fr: 'Allemagne', en: 'Germany', lon: 10.5, lat: 54.0, iso: 'de', weight: 9000 },
      { fr: 'Pologne', en: 'Poland', lon: 17.8, lat: 54.1, iso: 'pl', weight: 6500 },
      { fr: 'Svealand', en: 'Svealand', lon: 16.3, lat: 59.6, weight: 3000 },
      { fr: 'Götaland', en: 'Götaland', lon: 13.8, lat: 57.8, weight: 2600 },
      { fr: 'Trøndelag', en: 'Trøndelag', lon: 11.0, lat: 63.5, weight: 2200 },
      { fr: 'Vestland', en: 'Vestland', lon: 6.6, lat: 60.8, weight: 2200 },
      { fr: 'Norrland', en: 'Norrland', lon: 17.0, lat: 63.5, weight: 2200 },
      { fr: 'Scanie', en: 'Scania', lon: 13.5, lat: 55.9, weight: 2200 },
      { fr: 'Carélie', en: 'Karelia', lon: 31.3, lat: 63.8, weight: 2200 },
      { fr: 'Prusse', en: 'Prussia', lon: 21.0, lat: 54.65, weight: 2200 },
      { fr: 'Laponie', en: 'Lapland', lon: 25.5, lat: 68.0, weight: 2000 },
      { fr: 'Ostrobotnie', en: 'Ostrobothnia', lon: 23.0, lat: 63.0, weight: 2000 },
      { fr: 'Tavastie', en: 'Tavastia', lon: 24.3, lat: 61.2, weight: 2000 },
      { fr: 'Seeland', en: 'Zealand', lon: 11.9, lat: 55.5, weight: 2000 },
      { fr: 'Hålogaland', en: 'Hålogaland', lon: 15.5, lat: 67.4, weight: 1800 },
      { fr: 'Finnmark', en: 'Finnmark', lon: 25.0, lat: 70.0, weight: 1800 },
      { fr: 'Courlande', en: 'Courland', lon: 22.0, lat: 56.9, weight: 1800 },
      { fr: 'Gotland', en: 'Gotland', lon: 18.5, lat: 57.45, weight: 1500 },
    ],
    relief: [
      H(60, [13.8, 57.6], [15.0, 57.2]), // South Swedish highlands
      H(40, [27.5, 66.5], [29.0, 67.5]), // Salla fells
      H(30, [21.5, 69.2], [23.0, 69.6]), // Lyngen
    ],
  },
  {
    id: 'balkans',
    name: { fr: 'Balkans', en: 'Balkans' },
    box: [13, 30, 34.7, 48.3],
    width: 1450,
    riverRank: 9,
    maxNations: 34,
    rugged: 0.22,
    extras: [
      { fr: 'Turquie', en: 'Turkey', lon: 28.3, lat: 39.3, iso: 'tr', weight: 8500 },
      { fr: 'Italie', en: 'Italy', lon: 16.3, lat: 40.7, iso: 'it', weight: 8000 },
      { fr: 'Ukraine', en: 'Ukraine', lon: 29.6, lat: 45.9, iso: 'ua', weight: 5000 },
      { fr: 'Transylvanie', en: 'Transylvania', lon: 23.9, lat: 46.6, weight: 2600 },
      { fr: 'Valachie', en: 'Wallachia', lon: 25.5, lat: 44.4, weight: 2600 },
      { fr: 'Sicile', en: 'Sicily', lon: 14.3, lat: 37.5, weight: 2500 },
      { fr: 'Moldavie', en: 'Moldavia', lon: 26.9, lat: 47.2, weight: 2400 },
      { fr: 'Dalmatie', en: 'Dalmatia', lon: 16.4, lat: 43.6, weight: 2200 },
      { fr: 'Crète', en: 'Crete', lon: 24.9, lat: 35.25, weight: 2200 },
      { fr: 'Péloponnèse', en: 'Peloponnese', lon: 22.2, lat: 37.5, weight: 2200 },
      { fr: 'Thrace', en: 'Thrace', lon: 26.2, lat: 41.2, weight: 2200 },
      { fr: 'Dobroudja', en: 'Dobruja', lon: 28.3, lat: 44.3, weight: 2000 },
      { fr: 'Banat', en: 'Banat', lon: 21.2, lat: 45.6, weight: 1800 },
      { fr: 'Transdanubie', en: 'Transdanubia', lon: 17.6, lat: 46.7, weight: 1800 },
      { fr: 'Istrie', en: 'Istria', lon: 13.9, lat: 45.25, weight: 1800 },
      { fr: 'Calabre', en: 'Calabria', lon: 16.4, lat: 39.0, weight: 1800 },
      { fr: 'Bithynie', en: 'Bithynia', lon: 29.4, lat: 40.2, weight: 1800 },
    ],
    relief: [
      M(40, [23.4, 41.75], [24.4, 41.6], [25.5, 41.5]), // Rhodopes
      M(30, [23.3, 42.2], [23.6, 42.0]), // Rila
      M(24, [23.6, 35.3], [24.2, 35.25], [24.8, 35.15], [25.5, 35.1]), // Cretan ranges
      M(18, [22.1, 37.9], [22.3, 37.2]), // Taygetos / Arcadia
      H(40, [27.6, 39.6], [29.2, 39.9]), // Anatolian uplands
    ],
  },
  {
    id: 'middle-east',
    name: { fr: 'Moyen-Orient', en: 'Middle East' },
    box: [25, 63, 11, 42.5],
    width: 1550,
    riverRank: 7,
    maxNations: 40,
    rugged: 0.15,
    exclude: ['N. Cyprus'],
    extras: [
      { fr: 'Éthiopie', en: 'Ethiopia', lon: 38.8, lat: 12.6, iso: 'et', weight: 6000 },
      { fr: 'Grèce', en: 'Greece', lon: 25.6, lat: 35.2, iso: 'gr', weight: 3000 },
      { fr: 'Hedjaz', en: 'Hejaz', lon: 39.6, lat: 22.5, weight: 2800 },
      { fr: 'Fars', en: 'Fars', lon: 52.5, lat: 29.6, weight: 2600 },
      { fr: 'Ionie', en: 'Ionia', lon: 27.8, lat: 38.3, weight: 2600 },
      { fr: 'Haute-Égypte', en: 'Upper Egypt', lon: 32.7, lat: 25.5, weight: 2600 },
      { fr: 'Khorassan', en: 'Khorasan', lon: 59.0, lat: 35.6, weight: 2400 },
      { fr: 'Cilicie', en: 'Cilicia', lon: 35.3, lat: 37.0, weight: 2200 },
      { fr: 'Pont', en: 'Pontus', lon: 37.5, lat: 40.7, weight: 2200 },
      { fr: 'Hadramaout', en: 'Hadhramaut', lon: 49.0, lat: 15.9, weight: 2200 },
      { fr: 'Bassora', en: 'Basra', lon: 47.0, lat: 30.8, weight: 2000 },
      { fr: 'Nubie', en: 'Nubia', lon: 32.0, lat: 20.5, weight: 1800 },
      { fr: 'Sinaï', en: 'Sinai', lon: 33.8, lat: 29.4, weight: 1800 },
    ],
  },
  {
    id: 'india',
    name: { fr: 'Sous-continent indien', en: 'Indian Subcontinent' },
    box: [58, 98, 5, 37.5],
    width: 1500,
    riverRank: 7,
    maxNations: 30,
    rugged: 0.12,
    exclude: ['Siachen Glacier'],
    extras: [
      { fr: 'Chine', en: 'China', lon: 88.5, lat: 31.0, iso: 'cn', weight: 8000 },
      { fr: 'Iran', en: 'Iran', lon: 60.0, lat: 29.5, iso: 'ir', weight: 6000 },
      { fr: 'Pendjab', en: 'Punjab', lon: 75.6, lat: 30.9, weight: 3200 },
      { fr: 'Rajputana', en: 'Rajputana', lon: 73.8, lat: 26.6, weight: 3000 },
      { fr: 'Marathes', en: 'Maratha', lon: 75.5, lat: 19.4, weight: 3000 },
      { fr: 'Gujarat', en: 'Gujarat', lon: 71.6, lat: 22.6, weight: 2800 },
      { fr: 'Deccan', en: 'Deccan', lon: 78.5, lat: 17.2, weight: 2800 },
      { fr: 'Bengale', en: 'Bengal', lon: 87.8, lat: 23.0, weight: 2800 },
      { fr: 'Awadh', en: 'Awadh', lon: 81.0, lat: 26.8, weight: 2800 },
      { fr: 'Sind', en: 'Sindh', lon: 68.6, lat: 26.0, weight: 2600 },
      { fr: 'Bihar', en: 'Bihar', lon: 85.8, lat: 25.6, weight: 2600 },
      { fr: 'Mysore', en: 'Mysore', lon: 76.4, lat: 13.3, weight: 2400 },
      { fr: 'Coromandel', en: 'Coromandel', lon: 79.0, lat: 11.3, weight: 2400 },
      { fr: 'Kalinga', en: 'Kalinga', lon: 84.4, lat: 20.6, weight: 2400 },
      { fr: 'Malabar', en: 'Malabar', lon: 76.2, lat: 10.3, weight: 2200 },
      { fr: 'Assam', en: 'Assam', lon: 93.0, lat: 26.3, weight: 2000 },
      { fr: 'Arakan', en: 'Arakan', lon: 93.8, lat: 19.8, weight: 1800 },
    ],
  },
  {
    id: 'east-asia',
    name: { fr: 'Japon & Corée', en: 'Japan & Korea' },
    box: [117, 146, 30, 46.5],
    width: 1600,
    riverRank: 8,
    maxNations: 24,
    rugged: 0.2,
    extras: [
      { fr: 'Chine', en: 'China', lon: 117.8, lat: 38.6, iso: 'cn', weight: 12000 },
      { fr: 'Russie', en: 'Russia', lon: 133.5, lat: 44.6, iso: 'ru', weight: 9000 },
      { fr: 'Shandong', en: 'Shandong', lon: 118.6, lat: 36.3, weight: 3000 },
      { fr: 'Mandchourie', en: 'Manchuria', lon: 126.5, lat: 45.2, weight: 3000 },
      { fr: 'Jiangsu', en: 'Jiangsu', lon: 119.6, lat: 33.0, weight: 2800 },
      { fr: 'Kantō', en: 'Kantō', lon: 139.6, lat: 36.0, weight: 2800 },
      { fr: 'Kansai', en: 'Kansai', lon: 135.6, lat: 34.8, weight: 2800 },
      { fr: 'Liaodong', en: 'Liaodong', lon: 122.8, lat: 41.0, weight: 2600 },
      { fr: 'Hokkaidō', en: 'Hokkaidō', lon: 142.8, lat: 43.4, weight: 2600 },
      { fr: 'Tōhoku', en: 'Tōhoku', lon: 140.9, lat: 39.5, weight: 2600 },
      { fr: 'Kyūshū', en: 'Kyūshū', lon: 130.8, lat: 32.7, weight: 2600 },
      { fr: 'Chūgoku', en: 'Chūgoku', lon: 132.6, lat: 34.8, weight: 2400 },
      { fr: 'Shikoku', en: 'Shikoku', lon: 133.5, lat: 33.6, weight: 2200 },
      { fr: 'Jilin', en: 'Jilin', lon: 126.0, lat: 43.3, weight: 1800 },
      { fr: 'Hamgyong', en: 'Hamgyong', lon: 129.3, lat: 41.4, weight: 1800 },
      { fr: 'Jeolla', en: 'Jeolla', lon: 127.0, lat: 35.1, weight: 1800 },
    ],
    relief: [
      M(85, [137.6, 36.9], [137.7, 36.3], [138.0, 35.6]), // Japanese Alps
      M(65, [140.9, 41.0], [140.8, 39.5], [140.4, 38.0], [140.0, 37.2]), // Ōu
      M(65, [138.6, 37.1], [139.4, 36.9], [139.9, 37.6]), // Echigo
      M(55, [142.7, 43.6], [142.7, 43.0], [143.1, 42.3]), // Hidaka
      H(75, [131.5, 34.4], [133.0, 35.0], [134.6, 35.1]), // Chūgoku
      M(55, [132.8, 33.6], [134.0, 33.85]), // Shikoku
      H(65, [135.8, 34.3], [136.0, 33.9]), // Kii
      M(55, [131.0, 32.9], [131.2, 32.1]), // Kyūshū
      M(75, [128.5, 38.5], [128.9, 37.5], [129.0, 36.5], [128.3, 35.5]), // Taebaek
      H(75, [127.0, 35.9], [127.7, 35.4]), // Sobaek
      M(75, [126.8, 41.2], [127.2, 40.1]), // Nangnim
      M(85, [127.5, 42.6], [128.1, 42.0], [129.0, 41.8]), // Changbai / Paektu
      H(65, [117.4, 36.4], [118.6, 36.1], [120.5, 36.8]), // Shandong hills
      H(85, [124.0, 40.6], [125.0, 41.6]), // Liaodong hills
    ],
  },
  {
    id: 'southeast-asia',
    name: { fr: 'Asie du Sud-Est', en: 'Southeast Asia' },
    box: [92, 141, -11, 25.5],
    width: 1750,
    riverRank: 7,
    maxNations: 32,
    rugged: 0.12,
    exclude: ['mo', 'hk', 'pw', 'Indian Ocean Ter.'],
    extras: [
      { fr: 'Chine', en: 'China', lon: 112.5, lat: 23.3, iso: 'cn', weight: 12000 },
      { fr: 'Java', en: 'Java', lon: 110.2, lat: -7.4, weight: 4000 },
      { fr: 'Malaya', en: 'Malaya', lon: 102.2, lat: 4.0, weight: 3200 },
      { fr: 'Kalimantan', en: 'Kalimantan', lon: 113.6, lat: -1.2, weight: 3000 },
      { fr: 'Luçon', en: 'Luzon', lon: 121.1, lat: 16.2, weight: 3000 },
      { fr: 'Célèbes', en: 'Sulawesi', lon: 120.5, lat: -2.2, weight: 2600 },
      { fr: 'Mindanao', en: 'Mindanao', lon: 125.0, lat: 7.6, weight: 2600 },
      { fr: 'Yunnan', en: 'Yunnan', lon: 101.5, lat: 24.3, weight: 2600 },
      { fr: 'Cochinchine', en: 'Cochinchina', lon: 106.0, lat: 10.9, weight: 2600 },
      { fr: 'Annam', en: 'Annam', lon: 108.0, lat: 14.6, weight: 2400 },
      { fr: 'Papouasie', en: 'Papua', lon: 138.5, lat: -4.2, weight: 2400 },
      { fr: 'Guangxi', en: 'Guangxi', lon: 108.3, lat: 23.0, weight: 2200 },
      { fr: 'Hainan', en: 'Hainan', lon: 109.7, lat: 19.2, weight: 2000 },
      { fr: 'Lanna', en: 'Lanna', lon: 99.2, lat: 18.9, weight: 2000 },
      { fr: 'Aceh', en: 'Aceh', lon: 96.9, lat: 4.4, weight: 1800 },
      { fr: 'Moluques', en: 'Moluccas', lon: 129.0, lat: -3.2, weight: 1600 },
      { fr: 'Petites îles de la Sonde', en: 'Lesser Sunda Islands', lon: 117.5, lat: -8.6, weight: 1600 },
      { fr: 'Tenasserim', en: 'Tenasserim', lon: 98.8, lat: 13.0, weight: 1600 },
      { fr: 'Sabah', en: 'Sabah', lon: 117.0, lat: 5.5, weight: 1600 },
    ],
    relief: [
      M(65, [121.5, 24.8], [121.1, 23.6], [120.8, 22.6]), // Taiwan Central Range
      M(65, [120.9, 17.9], [121.0, 16.4]), // Cordillera Central (Luzon)
      H(55, [122.1, 17.6], [121.6, 15.4]), // Sierra Madre (Luzon)
      M(70, [125.0, 8.6], [125.3, 7.0]), // Mindanao
      M(65, [116.5, 6.0], [116.0, 5.0], [115.5, 4.0]), // Crocker / Kinabalu
      M(80, [113.0, 1.0], [114.5, 0.6], [116.0, 1.6]), // Müller range
      M(65, [120.0, -1.4], [120.5, -2.8], [121.5, -3.6]), // Sulawesi
      H(50, [106.8, -6.95], [108.5, -7.15], [110.4, -7.5], [112.9, -7.9], [114.0, -8.0]), // Javan volcanoes
      H(65, [101.6, 5.5], [101.7, 4.0], [102.2, 3.0]), // Titiwangsa
      H(55, [109.5, 19.0], [109.7, 18.7]), // Hainan
    ],
  },
  {
    id: 'caribbean',
    name: { fr: 'Caraïbes', en: 'Caribbean' },
    box: [-100, -59, 7, 31],
    width: 1800,
    riverRank: 8,
    maxNations: 34,
    rugged: 0.15,
    // Micro-territories (a handful of tiles each at this scale).
    exclude: ['mf', 'sx', 'bl', 'ai', 'ms', 'vg', 'vi', 'ky', 'tc', 'aw', 'cw'],
    extras: [
      { fr: 'États-Unis', en: 'United States', lon: -90.5, lat: 30.6, iso: 'us', weight: 15000 },
      { fr: 'Mexique', en: 'Mexico', lon: -99.1, lat: 19.4, iso: 'mx', weight: 11000 },
      { fr: 'Colombie', en: 'Colombia', lon: -74.8, lat: 9.2, iso: 'co', weight: 7000 },
      { fr: 'Floride', en: 'Florida', lon: -81.6, lat: 28.4, weight: 2800 },
      { fr: 'Texas', en: 'Texas', lon: -97.0, lat: 29.6, weight: 2600 },
      { fr: 'Yucatán', en: 'Yucatán', lon: -89.0, lat: 20.3, weight: 2600 },
      { fr: 'La Havane', en: 'Havana', lon: -82.4, lat: 22.9, weight: 2200 },
      { fr: 'Tamaulipas', en: 'Tamaulipas', lon: -98.5, lat: 24.0, weight: 2000 },
      { fr: 'Oaxaca', en: 'Oaxaca', lon: -96.7, lat: 17.0, weight: 2000 },
      { fr: 'Oriente', en: 'Oriente', lon: -76.3, lat: 20.3, weight: 1800 },
      // Abaco (the Natural Earth label point) is too small at this scale: Andros instead.
      { fr: 'Bahamas', en: 'Bahamas', lon: -78.0, lat: 24.4, iso: 'bs', weight: 1000 },
    ],
    relief: [
      M(
        70,
        [-91.5, 15.0],
        [-89.5, 14.3],
        [-87.0, 13.9],
        [-85.6, 12.6],
        [-84.6, 10.6],
        [-83.2, 9.2],
        [-82.2, 8.7],
      ), // Central American cordillera
      M(40, [-77.3, 20.0], [-76.0, 20.05]), // Sierra Maestra
      M(55, [-72.6, 19.2], [-71.0, 18.95], [-70.3, 18.75]), // Cordillera Central (Hispaniola)
      H(30, [-76.9, 18.1], [-76.4, 18.0]), // Blue Mountains
      H(30, [-67.0, 18.15], [-65.9, 18.15]), // Cordillera Central (Puerto Rico)
      M(50, [-68.5, 10.3], [-66.5, 10.4], [-64.0, 10.3]), // Venezuelan coastal range
      M(50, [-73.9, 10.9], [-73.4, 10.8]), // Sierra Nevada de Santa Marta
      H(40, [-83.9, 22.6], [-83.2, 22.7]), // Sierra de los Órganos
    ],
  },
];

/** Short lobby descriptions (written to index.json as `desc`). */
export const DESCRIPTIONS: Record<string, LocalizedName> = {
  world: { fr: 'La planète entière et ses cent nations.', en: 'The whole planet and its hundred nations.' },
  'world-giant': {
    fr: 'Le monde en très haute résolution, pour les longues parties.',
    en: 'The world in very high resolution, for long games.',
  },
  europe: {
    fr: 'Un continent dense et morcelé : chaque frontière est un front.',
    en: 'A dense, fragmented continent: every border is a front line.',
  },
  'north-america': {
    fr: "De l'Arctique aux Caraïbes : grandes plaines et isthme de Panama.",
    en: 'From the Arctic to the Caribbean: great plains and the Panama isthmus.',
  },
  'south-america': {
    fr: "L'Amazonie, les Andes et un continent presque insulaire.",
    en: 'The Amazon, the Andes and an almost insular continent.',
  },
  africa: {
    fr: 'Déserts, savanes et forêts : soixante nations sur un bloc continental.',
    en: 'Deserts, savannas and forests: sixty nations on one continental block.',
  },
  asia: {
    fr: "Le plus vaste continent, de l'Oural au Pacifique.",
    en: 'The largest continent, from the Urals to the Pacific.',
  },
  oceania: {
    fr: 'Îles et archipels : ici, tout se joue en mer.',
    en: 'Islands and archipelagos: everything is decided at sea.',
  },
  mediterranean: {
    fr: 'Le berceau des empires, entre trois continents.',
    en: 'The cradle of empires, between three continents.',
  },
  'black-sea': {
    fr: 'Une mer fermée, deux détroits et la steppe.',
    en: 'An enclosed sea, two straits and the steppe.',
  },
  pangaea: {
    fr: 'Un supercontinent unique : guerre terrestre totale.',
    en: 'A single supercontinent: all-out land war.',
  },
  archipelago: {
    fr: "Des centaines d'îles : la marine est reine.",
    en: 'Hundreds of islands: the navy rules.',
  },
  'two-lakes': {
    fr: 'Un continent percé de deux mers intérieures.',
    en: 'A continent pierced by two inland seas.',
  },
  labyrinth: {
    fr: 'Couloirs, murs et canaux : un casse-tête tactique.',
    en: 'Corridors, walls and canals: a tactical puzzle.',
  },
  'british-isles': {
    fr: 'Angleterre, Écosse, Irlande et la Manche : îles, détroits et highlands.',
    en: 'England, Scotland, Ireland and the Channel: islands, straits and highlands.',
  },
  scandinavia: {
    fr: 'Fjords, taïga et Baltique : une guerre de détroits dans le froid.',
    en: 'Fjords, taiga and the Baltic: a war of straits in the cold.',
  },
  balkans: {
    fr: "Alpes dinariques, Carpates et îles égéennes : la poudrière de l'Europe.",
    en: "Dinaric Alps, Carpathians and Aegean isles: Europe's powder keg.",
  },
  'middle-east': {
    fr: "Déserts d'Arabie, Mésopotamie et détroits stratégiques : Suez, Ormuz, Bab-el-Mandeb.",
    en: 'Arabian deserts, Mesopotamia and strategic straits: Suez, Hormuz, Bab-el-Mandeb.',
  },
  india: {
    fr: "Un sous-continent adossé à l'Himalaya, des royaumes du Deccan au Bengale.",
    en: 'A subcontinent backed by the Himalayas, from the Deccan kingdoms to Bengal.',
  },
  'east-asia': {
    fr: 'Japon, Corée et Chine du Nord autour de la mer du Japon.',
    en: 'Japan, Korea and northern China around the Sea of Japan.',
  },
  'southeast-asia': {
    fr: "Péninsules et milliers d'îles : l'Insulinde se conquiert par la mer.",
    en: 'Peninsulas and thousands of islands: the Indies are won at sea.',
  },
  caribbean: {
    fr: "L'isthme centraméricain et un chapelet d'îles autour de la mer des Caraïbes.",
    en: 'The Central American isthmus and a string of islands around the Caribbean Sea.',
  },
  'twin-continents': {
    fr: 'Deux continents rivaux reliés par un unique isthme.',
    en: 'Two rival continents joined by a single isthmus.',
  },
  fjords: {
    fr: 'Une côte glacée lacérée de fjords, un mur de montagnes et ses cols.',
    en: 'An icy coast slashed by fjords, a wall of mountains and its passes.',
  },
  ring: {
    fr: "Un anneau de terres autour d'une mer intérieure, coupé de trois détroits.",
    en: 'A ring of land around an inner sea, cut by three straits.',
  },
};
