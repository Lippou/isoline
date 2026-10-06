// The game's icon vocabulary: one semantic name → one Lucide glyph (ISC licence).
// Used by the <Icon> component (UI) and rasterised into textures for the map.
import {
  Anchor,
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  Ban,
  BarChart3,
  Bomb,
  BookOpen,
  Building2,
  Castle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock,
  Coins,
  Crosshair,
  Crown,
  Dices,
  Download,
  Eye,
  Factory,
  FastForward,
  Flag,
  FlaskConical,
  Gift,
  Globe,
  Handshake,
  HandFist,
  Info,
  Key,
  Landmark,
  Lock,
  LogOut,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Menu,
  Microscope,
  MessageSquare,
  Minimize2,
  Minus,
  Mountain,
  Network,
  Pause,
  Pencil,
  Plane,
  Play,
  Plus,
  Radar,
  Radiation,
  RefreshCw,
  Repeat,
  Rewind,
  Rocket,
  Save,
  ScrollText,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  Ship,
  Skull,
  Sparkles,
  Star,
  Swords,
  Target,
  TrainFront,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Undo2,
  Unlink,
  Upload,
  User,
  Users,
  Volume2,
  Wheat,
  X,
  Zap,
  Droplet,
  Gem,
  Atom,
  Hourglass,
  Sailboat,
  Siren,
  Sword,
  Mail,
  Moon,
  ArrowUpDown,
  ArrowRightLeft,
  Newspaper,
  TrendingDown,
  Biohazard,
  Activity,
  Tornado,
  Snowflake,
  Fuel,
  Megaphone,
  Hammer,
  TrainTrack,
  Lightbulb,
  HardHat,
  Medal,
  Sun,
  CloudLightning,
  CloudFog,
  Route,
  Camera,
  EyeOff,
  Type,
  Spline,
  SunMoon,
  HeartHandshake,
  Gamepad2,
  type IconNode,
} from 'lucide';

// Diplomatic status glyphs drawn for the map labels (Lucide shapes, modified).
const SHIELD =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';
/** A volcano: a cone with its crater and a plume of ash (the eruption, a world event). */
const Volcano: IconNode = [
  ['path', { d: 'M2 21 8.5 11h7L22 21Z' }],
  ['path', { d: 'M10.5 14.5 12 13l1.5 1.5' }],
  ['path', { d: 'M12 9V7' }],
  ['path', { d: 'M9.5 7.5C8 7 7.5 5 9 4c.5-1.5 2.5-2 3.5-1 1.5-.5 3 .5 3 2 1.5.5 1.5 2.5 0 3' }],
];

const BrokenShield: IconNode = [
  ['path', { d: SHIELD }],
  ['path', { d: 'm12.3 2.6-1.8 5.2 3.2 3.2-2.6 4 1.1 6.6' }],
];
const NoTrade: IconNode = [
  ['line', { x1: '12', x2: '12', y1: '2', y2: '22' }],
  ['path', { d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }],
  ['path', { d: 'm3 3 18 18' }],
];
// (Centred in the 24-unit box: the arcs used to sit 2.5 units low / high.)
const ArcUp: IconNode = [
  ['path', { d: 'M3 16.5C6 2.5 18 2.5 21 16.5' }],
  ['circle', { cx: '3', cy: '16.5', r: '1.5' }],
  ['path', { d: 'm17.5 13.5 3.5 3 1.5-4.3' }],
];
const ArcDown: IconNode = [
  ['path', { d: 'M3 7.5c3 14 15 14 18 0' }],
  ['circle', { cx: '3', cy: '7.5', r: '1.5' }],
  ['path', { d: 'm17.5 10.5 3.5-3 1.5 4.3' }],
];

// Front lines (1.18, « un logo plus compréhensible »): a shield standing on the line it
// holds (defensive), a broad arrow launched from its line (offensive).
const LineDefense: IconNode = [
  ['path', { d: 'M2 21h20' }],
  ['path', { d: 'M12 18c-3.5-1.4-6-3.8-6-7.5V5.5L12 3l6 2.5v5c0 3.7-2.5 6.1-6 7.5Z' }],
  ['path', { d: 'M12 7v7' }],
];
const LineOffense: IconNode = [
  ['path', { d: 'M2 21h20' }],
  ['path', { d: 'M9.5 18v-7H6l6-8 6 8h-3.5v7Z' }],
];

export const ICONS = {
  // resources & stats
  gold: Coins,
  troops: Swords,
  population: Users,
  territory: MapIcon,
  income: TrendingUp,
  time: Clock,
  hourglass: Hourglass,
  // buildings
  city: Building2,
  port: Anchor,
  factory: Factory,
  defensePost: Castle,
  lineDefense: LineDefense,
  lineOffense: LineOffense,
  silo: Rocket,
  sam: Crosshair,
  radar: Radar,
  airfield: Plane,
  lab: Microscope,
  // units & weapons
  warship: Ship,
  transport: Sailboat,
  train: TrainFront,
  nuke: Radiation,
  bomb: Bomb,
  // diplomacy
  alliance: Handshake,
  betrayal: Unlink,
  embargo: Ban,
  gift: Gift,
  war: Swords,
  surrender: Flag,
  diplomacy: Flag,
  renew: Repeat,
  council: Landmark,
  leader: Crown,
  /** The seat of government (map: a paper star in the owner's ring). */
  capital: Star,
  eliminated: Skull,
  traitor: ShieldAlert,
  immune: Shield,
  ceasefire: Handshake,
  // features
  tech: FlaskConical,
  event: Zap,
  trade: ArrowRightLeft,
  news: Newspaper,
  // world events
  crisis: TrendingDown,
  pandemic: Biohazard,
  solarStorm: Sun,
  earthquake: Activity,
  volcano: Volcano,
  hurricane: Tornado,
  harshWinter: Snowflake,
  oilShock: Fuel,
  mutiny: Megaphone,
  armsRace: Hammer,
  railStrike: TrainTrack,
  breakthrough: Lightbulb,
  publicWorks: HardHat,
  worldGames: Medal,
  // weather and trade lanes on the map
  storm: CloudLightning,
  fogBank: CloudFog,
  tradeRoutes: Route,
  general: Star,
  oil: Droplet,
  fertile: Wheat,
  metals: Gem,
  uranium: Atom,
  terrain: Mountain,
  fog: Eye,
  loyalty: Users,
  siren: Siren,
  // ui
  menu: Menu,
  settings: Settings,
  chat: MessageSquare,
  stats: BarChart3,
  log: ScrollText,
  help: CircleHelp,
  info: Info,
  warning: TriangleAlert,
  close: X,
  check: Check,
  /** An order that cannot go through (the build cursor's reason). */
  blocked: Ban,
  plus: Plus,
  minus: Minus,
  back: ArrowLeft,
  next: ArrowRight,
  upgrade: ArrowUpCircle,
  undo: Undo2,
  play: Play,
  pause: Pause,
  forward: FastForward,
  rewind: Rewind,
  lock: Lock,
  key: Key,
  star: Star,
  trophy: Trophy,
  user: User,
  users: Users,
  network: Network,
  globe: Globe,
  dice: Dices,
  search: Search,
  flag: Flag,
  edit: Pencil,
  trash: Trash2,
  save: Save,
  download: Download,
  upload: Upload,
  refresh: RefreshCw,
  target: Target,
  pin: MapPin,
  eye: Eye,
  send: Send,
  book: BookOpen,
  sound: Volume2,
  quit: LogOut,
  expand: Maximize2,
  collapse: Minimize2,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  dot: Circle,
  sparkles: Sparkles,
  // diplomacy on the map
  crown: Crown,
  sword: Sword,
  mail: Mail,
  inactive: Moon,
  brokenShield: BrokenShield,
  noTrade: NoTrade,
  /** Revolutions (rules/revolution.ts): the raised fist, on the map and in the hover card. */
  revolt: HandFist,
  // missile launch
  arcUp: ArcUp,
  arcDown: ArcDown,
  flip: ArrowUpDown,
  // what a nation thinks of you
  opinion: HeartHandshake,
  // replays: take over from here
  takeover: Gamepad2,
  // photo mode
  camera: Camera,
  eyeOff: EyeOff,
  labels: Type,
  borders: Spline,
  dayNight: SunMoon,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Inner SVG markup of an icon (24×24 viewBox, stroke = currentColor). */
export function iconMarkup(name: IconName): string {
  return (ICONS[name] as IconNode)
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs as Record<string, string | number>)
        .map(([k, v]) => `${k}="${esc(String(v))}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
}

/** A standalone SVG document for an icon (used to rasterise map textures). */
export function iconSvg(name: IconName, color = '#ffffff', strokeWidth = 2, size = 24): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    iconMarkup(name) +
    '</svg>'
  );
}

/** Icon of each building type, in B order. */
export const BUILDING_ICONS: readonly IconName[] = [
  'city',
  'port',
  'factory',
  'defensePost',
  'silo',
  'sam',
  'radar',
  'airfield',
  'lab',
];

/**
 * Tactical map signals (Alt + click): an icon and a short label, shown to the
 * targeted player. The index is the value carried by the 'emoji' command.
 */
export const SIGNALS: readonly { icon: IconName; key: string }[] = [
  { icon: 'war', key: 'attack' },
  { icon: 'immune', key: 'defend' },
  { icon: 'siren', key: 'help' },
  { icon: 'alliance', key: 'alliance' },
  { icon: 'target', key: 'target' },
  { icon: 'eye', key: 'watch' },
  { icon: 'gold', key: 'gold' },
  { icon: 'nuke', key: 'nuke' },
  { icon: 'check', key: 'yes' },
  { icon: 'close', key: 'no' },
  { icon: 'undo', key: 'retreat' },
  { icon: 'warning', key: 'danger' },
  { icon: 'betrayal', key: 'betrayal' },
  { icon: 'transport', key: 'landing' },
  { icon: 'pin', key: 'here' },
  { icon: 'surrender', key: 'peace' },
];
