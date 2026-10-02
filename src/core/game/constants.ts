// Every tunable gameplay number lives here (mirrored in GAME_DESIGN.md).
// 1 tick = 100 ms (10 ticks per second).

export const TICKS_PER_SECOND = 10;
export const sec = (s: number) => Math.round(s * TICKS_PER_SECOND);
export const min = (m: number) => sec(m * 60);

// ---------------------------------------------------------------- spawn
/**
 * OpenFront's spawn footprint, for humans, nations and tribes alike: the land tiles whose
 * offset from the clicked tile, shifted by half a tile, (dx + ½, dy + ½), lies within this
 * radius — an 8 × 8 disc of 52 tiles.
 */
export const SPAWN_RADIUS = 4;
export const SPAWN_IMMUNITY_TICKS = sec(60);
/**
 * Nations start with START_TROOPS.nation × DIFFICULTY[…].troops. Half of OpenFront's
 * 25,000 / 25,000 / 10,000 (play-test: far too many troops, far too fast).
 */
export const START_TROOPS = { human: 12_500, nation: 12_500, tribe: 5_000 } as const;
export const START_GOLD = { human: 0, nation: 0, tribe: 60_000 } as const;
/** Gold a tribe adds to its treasury per second (looted tile by tile when conquered). */
export const TRIBE_INCOME = 500;

// --------------------------------------------------------------- troops
/**
 * maxTroops = 2 × (usefulTiles ^ TROOPS_TILE_EXP × TROOPS_TILE_K + TROOPS_BASE)
 *           + TROOPS_PER_CITY_LEVEL × (levels of completed cities).
 * OpenFront's formula with smaller terms (OpenFront: 50,000 / 1,000 / 250,000): with its
 * values, AI leaders reached 13–19 M troops at 20 min, 17 M for a play-tester. An Isoline
 * tile covers ~2.5 OpenFront tiles (Europe: 0.93 M land tiles vs 2.35 M), so the same
 * geography yields 2.5^0.6 ≈ 1.7× fewer land troops but costs 2.5× fewer tiles to take:
 * 1,000 × 1.7 / 2.5 ≈ 700 would match OpenFront's army-to-land ratio.
 */
export const TROOPS_BASE = 25_000;
export const TROOPS_TILE_K = 800;
export const TROOPS_TILE_EXP = 0.6;
export const TROOPS_PER_CITY_LEVEL = 60_000;
/** Tribes hold a third of that maximum. */
export const TRIBE_TROOPS_DIVISOR = 3;
/**
 * Regeneration per tick = (TROOP_REGEN_BASE + troops ^ TROOP_REGEN_EXP / TROOP_REGEN_DIV) × (1 − troops / max).
 * OpenFront divides by 4; Isoline by 5 (growth −20 % on top of the smaller armies).
 */
export const TROOP_REGEN_BASE = 10;
export const TROOP_REGEN_EXP = 0.73;
export const TROOP_REGEN_DIV = 5;
export const TRIBE_REGEN_MULT = 0.5;

// ------------------------------------------------------------------ gold
/** Flat gold per tick (× the lobby gold multiplier): 1,000/s for humans and nations, 500/s for tribes. */
export const GOLD_PER_TICK = { human: 100, nation: 100, tribe: TRIBE_INCOME / TICKS_PER_SECOND } as const;
export const MAX_GOLD = 2_000_000_000;

// ---------------------------------------------------------------- combat
// Ported from OpenFront's AttackExecution and attackLogic. r = defender's troops (its
// whole army) / troops left in the attack; each terrain gives a mag (losses) and a tile
// cost (slowness): 80 / 16.5 plains, 100 / 20 hills, 120 / 25 mountains (terrain.ts).
/** Share of the troops sent by a click (OpenFront's attackAmount: troops / 5). */
export const DEFAULT_ATTACK_RATIO = 0.2;
/** Wilderness: the attacker loses mag / 5 per tile (tribes: mag / 10). */
export const WILD_LOSS_DIV = 5;
export const WILD_LOSS_DIV_TRIBE = 10;
/**
 * Against a player: loss = mag × clamp(r, LOSS_RATIO_MIN, LOSS_RATIO_MAX)
 * × (ATTACKER_LOSS_BASE × big-territory bonuses + ATTACKER_LOSS_PER_DENSITY × defender troops per tile).
 * The defender loses its troops per tile for every tile it loses.
 */
export const ATTACKER_LOSS_BASE = 0.463;
export const ATTACKER_LOSS_PER_DENSITY = 0.0039;
export const LOSS_RATIO_MIN = 0.6;
export const LOSS_RATIO_MAX = 2;
/** A tribe defending against a nation or a human: mag × 0.7 (OpenFront's bot defender). */
export const TRIBE_DEFENDER_LOSS_MULT = 0.7;
/**
 * Big territories are cheaper and faster to attack from and into (late games stay
 * dynamic): bonus = 1 − depth × sigmoid(ln tiles, 2.5, ln 300,000), i.e. ×1 for small
 * countries down to ×(1 − depth) for huge ones.
 */
export const LARGE_TERRITORY_MIDPOINT = 300_000;
export const LARGE_TERRITORY_STEEPNESS = 2.5;
export const LARGE_ATTACKER_DEPTH = 0.7;
export const LARGE_DEFENDER_DEPTH = 0.3;
export const LARGE_ATTACKER_SPEED_DEPTH = 0.73;
/**
 * Tick budget (OpenFront): every tick an attack takes the tiles of its front in order
 * until the fractions of the tick they cost add up to 1. Border size = target tiles on
 * the attack's front + 0…BORDER_JITTER − 1. Against a player a tile costs
 *   clamp(r, SPEED_RATIO_MIN, SPEED_RATIO_MAX) × clamp(r / HOPELESS_RATIO, 1, HOPELESS_MAX) / SPEED_COST_DIVISOR
 *   × tile cost × bonus(attacker, LARGE_ATTACKER_SPEED_DEPTH) × bonus(defender, LARGE_DEFENDER_DEPTH) / border size,
 * i.e. about 5 rows of plains a second at parity, 6.3 from 1.22:1 up, 0.7 when outnumbered 7.5:1.
 */
export const SPEED_COST_DIVISOR = 8.55;
export const SPEED_RATIO_MIN = 0.82;
export const SPEED_RATIO_MAX = 7.5;
export const HOPELESS_RATIO = 20;
export const HOPELESS_MAX = 50;
export const BORDER_JITTER = 5;
/**
 * Wilderness (OpenFront's terra nullius): a tile costs
 * clamp(TERRA_NULLIUS_COST_SCALE × tile cost / troops, 5, 100) / (TERRA_NULLIUS_BUDGET × border size),
 * i.e. 4 rows of plains a second from 6,600 troops, slower for smaller pushes.
 */
export const TERRA_NULLIUS_COST_SCALE = 2_000;
export const TERRA_NULLIUS_MIN_COST = 5;
export const TERRA_NULLIUS_MAX_COST = 100;
export const TERRA_NULLIUS_BUDGET = 2;
/** Fallout on a tile: mag and tile cost × (5 − 2 × share of the land under fallout). */
export const FALLOUT_COMBAT_MULT = 5;
export const FALLOUT_COMBAT_SLOPE = 2;
/** A country cut below this many tiles by an attack is annexed whole (OpenFront). */
export const ANNEX_TILES = 100;
/**
 * Cancelling an attack (OpenFront's retreat): it halts for RETREAT_DELAY_TICKS, then
 * its troops come home, RETREAT_MALUS of them lost against a player (none from the
 * wilderness). A transport ordered back loses the same share on landing at home.
 */
export const RETREAT_DELAY_TICKS = 20;
export const RETREAT_MALUS = 0.25;
export const MAX_ATTACKS_PER_PLAYER = 12;
/** Wilderness is attacked when the clicked tile is linked to your land by unowned land within this Manhattan distance. */
export const WILD_REACH = 200;
/** Relation of a country towards its attacker, by difficulty (OpenFront: −60 / −70 / −80 / −100). */
export const ATTACK_RELATION = { easy: -60, normal: -70, hard: -80, impossible: -100 } as const;

// ----------------------------------------------------------- defence post
export const DEFENSE_POST_RANGE = 30;
export const DEFENSE_POST_MAG = 5;
export const DEFENSE_POST_SPEED = 3;

// ---------------------------------------------------------------- traitor
/**
 * Breaking an alliance (or attacking an ally) marks the traitor for 30 s (OpenFront's
 * traitorDuration); meanwhile attacks against it lose ×0.5 and its tiles cost ×0.8.
 */
export const TRAITOR_DEBUFF_TICKS = 300;
export const TRAITOR_DEFENSE_MULT = 0.5;
export const TRAITOR_SPEED_MULT = 0.8;
export const TRAITOR_MARK_TICKS = sec(30);
export const TRAITOR_EMBARGO_TICKS = min(5);
/**
 * Relations (OpenFront, −100 … 100, easing back to 0 by RELATION_DECAY a tick): the
 * betrayed country −100 towards the traitor, every other neighbour of the traitor −40.
 * Below 0 a nation refuses alliances; below −50 it is hostile.
 */
export const RELATION_BETRAYED = -100;
export const RELATION_TRAITOR_NEIGHBOR = -40;
export const RELATION_DECAY = 0.05;
export const RELATION_HOSTILE = -50;
/** Attacking another country makes the defender stop trading with the attacker for 5 min. */
export const TEMP_EMBARGO_TICKS = min(5);
export const ALLIANCE_TICKS = 3_000;
export const ALLIANCE_RENEW_WINDOW = sec(30);
export const ALLIANCE_REQUEST_TTL = sec(20);
export const INACTIVE_TICKS = sec(60);

// -------------------------------------------------------------- buildings
/**
 * Prices depend on n = Σ min(levels owned, levels ever built) over the listed types
 * (see buildings.ts). Cities, and ports + factories (one shared n), cost
 * min(CITY_COST_CAP, CITY_COST_BASE × 2^n): 125k, 250k, 500k, then 1M.
 */
export const CITY_COST_BASE = 125_000;
export const CITY_COST_CAP = 1_000_000;
/** Defence posts: min(cap, step × (n + 1)). */
export const DEFENSE_POST_COST_STEP = 50_000;
export const DEFENSE_POST_COST_CAP = 250_000;
export const SILO_COST = 1_000_000;
export const RADAR_COST = 300_000;
export const AIRFIELD_COST = 800_000;
/**
 * Research centres (Isoline's own, tech tree on): min(LAB_COST_CAP, LAB_COST_BASE × 2^n),
 * n over research centre levels — 250k, 500k, 1M, then 2M: research competes with
 * cities, ports and the army for gold. Each completed level yields RESEARCH_PER_LAB_LEVEL
 * points a second (rules/tech.ts).
 */
export const LAB_COST_BASE = 250_000;
export const LAB_COST_CAP = 2_000_000;
export const enum B {
  City = 0,
  Port = 1,
  Factory = 2,
  DefensePost = 3,
  Silo = 4,
  Sam = 5,
  Radar = 6,
  Airfield = 7,
  Lab = 8,
}
export const BUILDING_COUNT = 9;
export const BUILDING_KEYS = [
  'city',
  'port',
  'factory',
  'defensePost',
  'silo',
  'sam',
  'radar',
  'airfield',
  'lab',
] as const;
export const BUILD_TICKS = [20, 50, 20, 50, 100, 300, 40, 80, 60] as const;
/** What happens to a building when its tile is captured. */
export const CAPTURE_TRANSFER = [true, true, true, false, true, true, false, true, true] as const;
export const DEMOLISH_REFUND = 0.25;
export const STATION_TYPES: readonly number[] = [B.City, B.Port, B.Factory];
export const RADAR_RANGE = 60;
/** Minimum Euclidean distance between two structures (tiles). */
export const MIN_BUILDING_SPACING = 15;

// ------------------------------------------------------------------ ships
/**
 * Ships move like OpenFront's, one tile of a 4-connected water route per tick at speed 1:
 * a leg between two waypoints costs |dx| + |dy| steps (1 tile/tick on an axis-aligned
 * course, 0.71 on a diagonal one). Speeds are in such steps per tick.
 */
export const TRANSPORT_SPEED = 1;
/**
 * Isoline: ships sail up navigable rivers (rivers flowing into a sea or a lake) at this
 * fraction of their speed — inland invasions are possible, but slow and telegraphed.
 */
export const RIVER_SAIL_SPEED = 0.6;
/** Transports at sea per player, retreating ones included (OpenFront's boatMaxNumber). */
export const MAX_TRANSPORTS = 3;
/** A transport carries at least this many troops (the share of the attack slider). */
export const TRANSPORT_MIN_TROOPS = 50;
/** Warship price = min(cap, step × (n + 1)), n = min(warships owned, warships ever built). */
export const WARSHIP_COST_STEP = 250_000;
export const WARSHIP_COST_CAP = 1_000_000;
export const WARSHIP_HP = 1_000;
export const WARSHIP_DAMAGE = 250;
/**
 * Targeting radius around the warship (transports, warships). OpenFront's 130 tiles
 * scaled to Isoline's maps, drawn about 0.7× as fine for the same geography
 * (land tiles, Isoline vs OpenFront: Europe 0.93 M vs 2.35 M, Black Sea 0.67 M vs 1.17 M).
 */
export const WARSHIP_RANGE = 90;
/** One shell every 3 s (OpenFront fires faster; play-testers found the volleys too quick). */
export const WARSHIP_FIRE_TICKS = 30;
export const WARSHIP_SPEED = 1;
/** A warship hunting down a merchant takes two steps a tick (OpenFront). */
export const WARSHIP_HUNT_SPEED = 2;
/** Tiles a tick (homing): slower than OpenFront so shells can be followed by eye, still faster than any ship. */
export const SHELL_SPEED = 3;
/**
 * Patrol zone (OpenFront's 100, same scaling): waypoints are drawn in the square
 * ± WARSHIP_PATROL_RANGE / 2 around the patrol point, and merchants are only hunted
 * within WARSHIP_PATROL_RANGE of it.
 */
export const WARSHIP_PATROL_RANGE = 70;
/**
 * Repairs (OpenFront): WARSHIP_PASSIVE_HEAL hp a tick within WARSHIP_PASSIVE_HEAL_RANGE of
 * one of your ports (OpenFront's 150, same scaling). Below WARSHIP_RETREAT_HP of its max
 * hp a warship breaks off — it no longer fires but can still be shot — and sails to your
 * nearest port on its sea (switching to one at under WARSHIP_PORT_SWITCH of the squared
 * distance, or to a free one when its port is full). Within WARSHIP_DOCK_RANGE of the port
 * it docks (one ship per port level; docked ships cannot be targeted) and heals a further
 * WARSHIP_PORT_HEAL_PER_LEVEL hp a tick per port level, shared by the docked ships, until
 * full; then it resumes its patrol. A move order cancels the retreat and blocks it for
 * WARSHIP_MANUAL_LOCK_TICKS.
 */
export const WARSHIP_PASSIVE_HEAL = 1;
export const WARSHIP_PASSIVE_HEAL_RANGE = 105;
/** Half its hp (OpenFront breaks off at 75 %; play-testers found ships left at the first shell). */
export const WARSHIP_RETREAT_HP = 0.5;
export const WARSHIP_DOCK_RANGE = 5;
export const WARSHIP_PORT_HEAL_PER_LEVEL = 5;
export const WARSHIP_PORT_SWITCH = 0.75;
export const WARSHIP_MANUAL_LOCK_TICKS = 50;
/**
 * A port's radius of action (tiles): warships are built inside it, and it is drawn on
 * the map when placing or hovering a port.
 */
export const PORT_RANGE = 60;
export const PORT_RANGE_PER_LEVEL = 10;
export const portRange = (level: number) => PORT_RANGE + PORT_RANGE_PER_LEVEL * Math.max(0, level - 1);
export const VETERANCY_KILLS = [2, 5, 9] as const;
export const VETERANCY_BONUS = 0.2;
export const TRANSPORT_HP = 300;
export const MERCHANT_HP = 200;
export const MERCHANT_SPEED = 1;
/**
 * Every TRADE_ROLL_TICKS a port rolls once per level; a roll launches a merchant
 * with probability 1 / max(1, ⌊TRADE_SPAWN_RATE / (failed rolls + 1) / saturation⌋).
 */
export const TRADE_ROLL_TICKS = 10;
export const TRADE_SPAWN_RATE = 100;
/**
 * Cargo value = TRADE_SIGMOID_GOLD / (1 + e^(−TRADE_SIGMOID_K × (d − TRADE_SHORT_RANGE))) + TRADE_PER_TILE × d:
 * half of OpenFront's 75,000 and 50 (trade and trains made most of the gold, far too much of it).
 */
export const TRADE_SIGMOID_GOLD = 37_500;
export const TRADE_SIGMOID_K = 0.03;
export const TRADE_PER_TILE = 25;
/** Ports closer than this (Manhattan tiles) get no proximity / friendship bonus as destinations. */
export const TRADE_SHORT_RANGE = 300;
export const PIRACY_RANGE = 4;

// ------------------------------------------------------------------ rails
export const RAIL_CONNECT_RANGE = 110;
export const RAIL_MAX_SEGMENT = 155;
export const RAIL_MIN_GAP = 15;
export const TRAIN_SPEED = 2;
/**
 * Every tick a factory rolls once per level; a roll launches a train with probability
 * 1 / max(1, ⌊(owner's factory levels + TRAIN_SPAWN_BASE) × TRAIN_SPAWN_MULT / saturation⌋).
 */
export const TRAIN_SPAWN_BASE = 10;
export const TRAIN_SPAWN_MULT = 15;
export const TRAIN_SPAWN_COOLDOWN = 10;
/** A train weighs this many units in the world saturation (engine + 5 cars + tail). */
export const TRAIN_UNITS = 7;
/**
 * Paid at every city/port stop (train owner AND station owner when they differ): half of
 * OpenFront's 10,000 / 25,000 / 35,000, like its decay and floor below (5,000 each).
 */
export const TRAIN_PAY_OWN = 5_000;
export const TRAIN_PAY_OTHER = 12_500;
export const TRAIN_PAY_ALLY = 17_500;
/** From the (TRAIN_PAY_DECAY_FROM + 1)-th paying stop on, every stop pays TRAIN_PAY_DECAY less. */
export const TRAIN_PAY_DECAY_FROM = 10;
export const TRAIN_PAY_DECAY = 2_500;
export const TRAIN_PAY_FLOOR = 2_500;
export const TRAIN_MAX_STOPS = 16;

// ------------------------------------------------------------------ nukes
export const enum N {
  Atom = 0,
  Hydrogen = 1,
  Mirv = 2,
  MirvWarhead = 3,
}
export const NUKE_COST = [750_000, 5_000_000, 25_000_000, 0] as const;
export const MIRV_COST_STEP = 15_000_000;
/** Inner radius: every tile is destroyed. Outer radius: half the tiles are, units and buildings die. */
export const NUKE_RADIUS = [12, 80, 0, 12] as const;
export const NUKE_FALLOUT_RADIUS = [30, 100, 0, 18] as const;
/** Flight speed in tiles per tick along the arc (A, H, MIRV carrier, MIRV warhead). */
export const NUKE_SPEED = [10, 10, 15, 22] as const;
export const NUKE_MIN_FLIGHT = 10;
/**
 * SAMs can only reach a missile within this distance of its launch point or of its target:
 * OpenFront's 150 at Isoline's map scale (×0.7, like the warship and SAM ranges).
 */
export const NUKE_TARGETABLE_RANGE = 105;
/** MIRV: the carrier climbs to a separation point, then warheads rain on the target's land. */
export const MIRV_MAX_WARHEADS = 350;
export const MIRV_RANGE = 1_500;
export const MIRV_MIN_SPREAD = 55; // Manhattan distance between two warhead targets
export const MIRV_SPLIT_HEIGHT = 500;
export const MIRV_FLIGHT_TICKS = 14; // carrier flight time is normalised around this
/** Every silo tube (one per level) reloads for this long after a launch. */
export const SILO_RELOAD_TICKS = 90;
export const MAX_NUKE_BATCH = 50;
export const SAM_COSTS = [1_500_000, 3_000_000] as const;
/** Every SAM missile (one per level) reloads for this long after a shot. */
export const SAM_COOLDOWN = 90;
export const SAM_INTERCEPTOR_SPEED = 12;
/**
 * SAM reach: OpenFront's 150 − 480 / (level + 5) scaled to Isoline's maps, drawn about
 * 0.7× as fine for the same geography (see WARSHIP_RANGE): 49 tiles at level 1, 71 at
 * level 5, 105 at most.
 */
export const SAM_RANGE_SCALE = 0.7;
export const samRange = (level: number) => SAM_RANGE_SCALE * (150 - 480 / (level + 5));
export const DECONTAMINATION_TICKS = min(10);
/** A/H bombs: troops × ((tiles − lost) / tiles) ^ NUKE_TROOP_EXP for every player hit. */
export const NUKE_TROOP_EXP = 5;
/** MIRV warheads drain troops towards this fraction of the troop cap. */
export const WARHEAD_TROOP_FLOOR = 0.03;
export const WARHEAD_TROOP_LOSS = 500;
/** Nuking an ally breaks the alliance when the blast weighs more than this many of its tiles. */
export const NUKE_BETRAYAL_TILES = 100;

// ------------------------------------------------------------------ air
export const enum A {
  Fighter = 0,
  Bomber = 1,
  Recon = 2,
}
export const AIR_COST = [400_000, 900_000, 150_000] as const;
export const AIR_SPEED = [4, 2.6, 5] as const;
export const AIR_HP = [400, 700, 150] as const;
export const FIGHTER_RANGE = 90;
export const BOMBER_RADIUS = 6;
export const BOMBER_KILL = 0.35;
export const RECON_RADIUS = 40;
export const RECON_TICKS = sec(40);
export const AIRFIELD_CAPACITY = 4;

// --------------------------------------------------------------- loyalty
export const LOYALTY_CONQUERED = 70;
export const LOYALTY_MAX = 255;
export const LOYALTY_GAIN_PERIOD = 6; // full map sweep chunks
export const LOYALTY_SECESSION_THRESHOLD = 60;
export const LOYALTY_CHECK_TICKS = sec(15);
export const LOYALTY_STABILISE_RANGE = 25;

// --------------------------------------------------------------- capital
// Isoline's own (OpenFront has no capital): every human and nation governs from its
// spawn tile; losing that tile (land attack, landing, annexation, nuke) costs a moment
// of disorganisation, and the country picks a new seat itself (nations: automatically).
/** Disorganisation after losing the capital (ticks). */
export const CAPITAL_DISORG_TICKS = sec(60);
/** Meanwhile: troop growth, passive gold income and attack speed × these factors. */
export const CAPITAL_DISORG_GROWTH = 0.75;
export const CAPITAL_DISORG_GOLD = 0.75;
export const CAPITAL_DISORG_SPEED = 0.8;
/** Still without a capital once the disorganisation is over: passive gold × this. */
export const CAPITAL_NONE_GOLD = 0.9;
/** Share of the loser's treasury kept in the capital: seized by its conqueror, burnt by a nuke. */
export const CAPITAL_LOOT = 0.1;
/** A capital stands more than this many tiles (square rings) from any foreign land, allies excepted. */
export const CAPITAL_FRONT_GAP = 5;
/** Moving a capital one still holds: once per this delay (re-establishing a lost one is immediate). */
export const CAPITAL_MOVE_COOLDOWN = min(5);
/** Nations re-establish a lost capital this long after the fall (then retry every 5 s if no spot fits). */
export const CAPITAL_AI_DELAY = sec(10);

// ------------------------------------------------------------------ misc
export const HISTORY_EVERY = 50;
export const HASH_EVERY = 50;
export const DOOMSDAY_GRACE = min(10);
export const DOOMSDAY_STEP = min(2);
export const DOOMSDAY_FFA = [2, 4, 7, 11, 17, 25, 35] as const;
export const DOOMSDAY_TEAMS = [5, 10, 16, 24, 33, 45, 60] as const;
export const OVERTIME_START = min(30);
export const OVERTIME_STEP = min(5);
export const OVERTIME_THRESHOLDS = [80, 70, 60, 50, 45, 40, 35] as const;
export const BATTLE_ROYALE_STEP = min(3);
export const GENERAL_COOLDOWN = min(5);
export const COUNCIL_PERIOD = min(10);
export const COUNCIL_VOTE_TICKS = sec(30);
export const EVENT_MIN = min(4);
export const EVENT_MAX = min(6);
export const DAY_LENGTH = min(8);
