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

// ------------------------------------------------------------ front lines
/**
 * Front lines (rules/lines.ts, GAME_DESIGN.md §6.6) replace the defence post, at the
 * player's request: a line drawn on your own land and garrisoned with troops (the attack
 * ratio), never gold, facing one side (its back bare). Troops on lines come off the troop
 * ceiling until taken down.
 * - Length (1.19): a line needs LINE_MIN_DENSITY × the country's troops per tile on each of
 *   its tiles; drawn longer than its troops allow, it stops there.
 * - Defensive: laid in LINE_DEFENSE_SETUP ticks. Within LINE_REACH tiles in front, attacks
 *   coming head-on are slowed (tile cost up to ×LINE_DEFENSE_SPEED). Its own tiles stand
 *   by the balance of forces (1.19): the attack's troops per front tile against the line's
 *   garrison per tile (R); a head-on push loses the attacker LINE_CLASH × 3 / R of the
 *   garrison's worth for every LINE_CLASH × the push's force the line loses (3 to 1 at even
 *   forces, 1 to 1 at 3 to 1); past LINE_BREAK_RATIO to 1 the tile falls. Turned — the
 *   enemy holding land LINE_TURN_DEPTH tiles behind LINE_TURN_SHARE of it — it shatters,
 *   its troops lost.
 * - Offensive (1.22): laid on the border with one country, dug in after LINE_OFFENSE_SETUP
 *   ticks; its troops then go over the top from it, losing ×(1 − LINE_OFFENSE_LOSS) and
 *   advancing ×LINE_OFFENSE_SPEED, towards the tile its arrow points at: a frontier tile
 *   waits LINE_AIM_PULL × its distance to that tile (in plains tiles' worth of time) before
 *   its turn — the front heads that way rather than spreading evenly.
 * Both act in full while their troops per tile reach LINE_FULL_DENSITY × the country's.
 */
export const LINE_REACH = 12;
export const LINE_OFFENSE_REACH = 16;
export const LINE_DEFENSE_SPEED = 3;
/**
 * 1.24 (the player's design): the assault's bonuses split by its arrow — within
 * LINE_ARROW_HALF tiles of the arrow (from the line to its head), losses ×(1 −
 * LINE_OFFENSE_LOSS) and speed ×LINE_OFFENSE_SPEED; along the rest of the line's front, losses
 * ×(1 − LINE_FRONT_LOSS) only. All of it × the charge: launched before its LINE_OFFENSE_SETUP
 * are up, the line carries the share of them it has waited. A defensive line digs in for
 * LINE_DEFENSE_PREP after it is laid; prepared, it slows what comes at it ×LINE_DEFENSE_PREP_MULT.
 */
export const LINE_OFFENSE_LOSS = 0.5;
export const LINE_OFFENSE_SPEED = 1.5;
export const LINE_FRONT_LOSS = 0.2;
export const LINE_ARROW_HALF = 5;
export const LINE_DEFENSE_PREP = 100;
export const LINE_DEFENSE_PREP_MULT = 2;
export const LINE_OFFENSE_SETUP = 300;
export const LINE_AIM_PULL = 0.6;
export const LINE_DEFENSE_SETUP = 0;
export const LINE_BREAK_RATIO = 3;
export const LINE_CLASH = 0.1;
export const LINE_MIN_DENSITY = 2;
export const LINE_FULL_DENSITY = 4;
export const LINE_TURN_SHARE = 0.25;
export const LINE_TURN_DEPTH = 3;
/** Lines a player may hold at once; tiles of one line; points a drawing may have. */
export const LINE_MAX_PER_PLAYER = 8;
export const LINE_MAX_TILES = 400;
export const LINE_MIN_TILES = 3;
export const LINE_MAX_POINTS = 24;

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
/**
 * Isoline's goodwill (OpenFront has none besides gifts): while a condition holds, the
 * relation climbs by `rate` a second (net of the decay) up to `ceiling` — an alliance,
 * one that has lasted past its first term (ALLIANCE_TICKS), trade between the two in
 * the last TRADE_WARMTH_WINDOW ticks, a common enemy (both fighting the same country).
 * Ceilings do not add up: the highest condition holding wins.
 */
export const WARMTH = {
  ally: { rate: 0.5, ceiling: 40 },
  longAlly: { rate: 0.5, ceiling: 60 },
  trade: { rate: 0.25, ceiling: 25 },
  enemy: { rate: 0.25, ceiling: 25 },
} as const;
export const TRADE_WARMTH_WINDOW = 600;
/**
 * Gifts (OpenFront's DonateGold/TroopExecution): +5 per chunk of gold (by difficulty,
 * growing by one chunk every 5 minutes of play), at most +100; troops: +50 once the gift
 * reaches a random share of the recipient's troop ceiling (1/divisor, between the two).
 */
export const GIFT_GOLD_CHUNK = { easy: 2_500, normal: 5_000, hard: 12_500, impossible: 25_000 } as const;
export const GIFT_TROOP_DIVISORS = {
  easy: [13, 11],
  normal: [11, 9],
  hard: [9, 7],
  impossible: [7, 5],
} as const;
export const GIFT_TROOP_RELATION = 50;
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
export const SILO_COST = 1_000_000;
export const RADAR_COST = 300_000;
export const AIRFIELD_COST = 800_000;
/**
 * Research centres (Isoline's own, tech tree on): min(LAB_COST_CAP, LAB_COST_BASE × 2^n),
 * n over research centre levels — 250k, 500k, 1M, 2M, 4M, then 5M: research competes with
 * cities, ports and the army for gold. Each completed level yields RESEARCH_PER_LAB_LEVEL
 * points a second (rules/tech.ts).
 */
export const LAB_COST_BASE = 250_000;
export const LAB_COST_CAP = 5_000_000;
export const enum B {
  City = 0,
  Port = 1,
  Factory = 2,
  /** Retired in 1.17 (front lines replaced it): never built; the slot keeps the tables aligned. */
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
/**
 * Isoline's capture rule (the player's request: OpenFront hands captured buildings over
 * intact, and an attack-only game snowballed on the cities it took). A building taken by
 * conquest is looted — an upgrade under way is lost, then half of its levels, rounded down
 * (a level-1 or level-2 building keeps one) — and occupied for CAPTURE_OCCUPATION_TICKS:
 * out of service (no troop ceiling, no trade, no trains, no research, no launches) until
 * the countdown ends. GAME_DESIGN.md §6.4.
 */
export const CAPTURE_OCCUPATION_TICKS = sec(60);
/** Demolition: a quarter of the gold invested comes back, once the building is down. */
export const DEMOLISH_REFUND = 0.25;
/**
 * A demolition takes the type's construction time (Megaprojects included), never less than
 * this (1.16; it was instant before).
 */
export const DEMOLISH_MIN_TICKS = sec(5);
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
 * Isoline's trade capacity (1.11; OpenFront has none: its only brake is the world fleet,
 * so whoever held the most ports took a growing share of a world trade that no longer
 * grew, up to 300–370k gold/s on the World map at 40 min). A player's P completed port
 * levels trade like P × (1 + K) / (P + K) levels, K = TRADE_CAPACITY_KNEE: one port as
 * before, 3 like 2, 10 like 3.1, never more than K + 1 = 4. Outbound, a successful launch
 * roll sails with probability (1 + K) / (P + K); inbound, a port weighs as a destination
 * its level × (1 + K) / (P + K).
 */
export const TRADE_CAPACITY_KNEE = 3;
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
/**
 * A factory's reach (OpenFront's trainStationMaxRange is 110 of its tiles). Halved from 110
 * in 1.11: an Isoline tile is ~1.6 OpenFront tiles across, so 110 reached ~175 OpenFront
 * tiles and one factory joined a whole region's cities (play-test: « beaucoup trop grand »).
 * The longest rail is reach × √2 (OpenFront's railroadMaxSize).
 */
export const RAIL_CONNECT_RANGE = 55;
export const RAIL_MAX_SEGMENT = 78;
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
 * 0.7× as fine for the same geography (see WARSHIP_RANGE), then halved at every level
 * (1.15, deliberate deviation: « le champ de zone du SAM, on peut le diviser par deux.
 * Déjà au niveau 1 »): 24.5 tiles at level 1, 35.7 at level 5, 52.5 at most. The
 * research bonuses (techSam) are halved alike.
 */
export const SAM_RANGE_SCALE = 0.7 * 0.5;
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
// Isoline's own (GAME_DESIGN.md §11): every plane has one job. Bombers knock levels off
// buildings, fighters rule the sky, reconnaissance gives intelligence on a zone, airfields
// scramble interceptors, radars warn and guide them — all of it with or without the fog.
export const enum A {
  Fighter = 0,
  Bomber = 1,
  Recon = 2,
}
export const AIR_COST = [300_000, 450_000, 100_000] as const;
export const AIR_SPEED = [4, 2.6, 5] as const;
export const AIR_HP = [400, 600, 150] as const;
/** Planes in flight per airfield level (scrambled interceptors apart). */
export const AIRFIELD_CAPACITY = 4;
/** A fighter patrols (and chases) within this distance of its airfield. */
export const FIGHTER_RANGE = 90;
export const FIGHTER_PATROL_TICKS = sec(60);
/** A fighter engages what comes within this distance of it… */
export const FIGHTER_SIGHT = 30;
/** …and deals this much damage a tick once within FIGHTER_CONTACT tiles of it. */
export const FIGHTER_DAMAGE = 100;
export const FIGHTER_CONTACT = 3;
/**
 * Every airfield level keeps one interceptor on alert (free), rearmed SCRAMBLE_REARM after
 * it took off. It scrambles at a hostile bomber or reconnaissance plane within FIGHTER_RANGE
 * that is detected: within SCRAMBLE_SIGHT of the airfield, or inside friendly radar
 * coverage. It gives up after SCRAMBLE_TICKS.
 */
export const SCRAMBLE_SIGHT = 50;
export const SCRAMBLE_REARM = sec(30);
export const SCRAMBLE_TICKS = sec(30);
/** Bombers reach this far from their airfield. */
export const BOMBER_RANGE = 300;
/** A bomber hits the hostile structure nearest the aim point within this distance. */
export const BOMBER_SNAP = 12;
/** Rails and trains within this radius of the impact are cut / destroyed. */
export const BOMBER_RADIUS = 6;
/** Levels a hit knocks off (a level-1 building is destroyed)… */
export const BOMBER_LEVELS = 1;
/** …and inside one of the bomber owner's reconnaissance zones. */
export const BOMBER_LEVELS_SPOTTED = 2;
/**
 * Bombers against ships (1.16, the player's request: « avec le bombardier, ce serait bien
 * qu'on puisse aussi détruire des bateaux »): aimed at sea, a bomber locks on the hostile
 * ship (warship, transport, trade ship) nearest the aim point within BOMBER_SHIP_SNAP and
 * follows it; its bombs hit every hostile ship within BOMBER_SHIP_RADIUS of the drop for
 * BOMBER_SHIP_DAMAGE hp (twice that inside one of the bomber owner's reconnaissance zones):
 * a transport (300 hp) or a trade ship (200) goes down, a warship (1,000) loses 60 % and
 * breaks off to its port; two bombers sink it.
 */
export const BOMBER_SHIP_SNAP = 8;
export const BOMBER_SHIP_RADIUS = 3;
export const BOMBER_SHIP_DAMAGE = 600;
export const RECON_RANGE = 400;
export const RECON_RADIUS = 40;
export const RECON_TICKS = sec(40);
/** Inside one of your reconnaissance zones, your land attacks lose this share of their usual losses. */
export const RECON_LOSS_MULT = 0.75;
/** Radar coverage: RADAR_RANGE + RADAR_RANGE_PER_LEVEL per level above the first. */
export const RADAR_RANGE_PER_LEVEL = 20;
export const radarRange = (level: number) => RADAR_RANGE + RADAR_RANGE_PER_LEVEL * Math.max(0, level - 1);

// --------------------------------------------------------------- loyalty
/** Below the secession threshold (60): a fresh conquest stays at risk ~24 s (one sweep near a city). */
export const LOYALTY_CONQUERED = 45;
export const LOYALTY_MAX = 255;
/** Loyalty of land settled during play (wilderness), or taken back from rebels who seceded from us. */
export const LOYALTY_SETTLED = 200;
export const LOYALTY_GAIN_PERIOD = 6; // full map sweep chunks
export const LOYALTY_SECESSION_THRESHOLD = 60;
export const LOYALTY_CHECK_TICKS = sec(15);
export const LOYALTY_STABILISE_RANGE = 25;

// ------------------------------------------------------------ revolutions
// Isoline's own world rule (1.14, GAME_DESIGN.md §6.5; OpenFront has none): a country far
// ahead of everyone else now and then sees a distant region rise up. The rebels are a tribe
// without gold: putting them down pays nothing, it only costs time and troops.
/** Ticks between two draws (counted from the start of the match). */
export const REVOLUTION_CHECK_TICKS = sec(10);
/** No revolution before this point of the match. */
export const REVOLUTION_GRACE = min(5);
/** The leader must hold this share of the useful land… */
export const REVOLUTION_MIN_SHARE = 0.2;
/** …and this many times the land of the largest country outside its team. */
export const REVOLUTION_MIN_LEAD = 1.6;
/** Chance per draw: base at the bar, up to base + extra at full pressure (see revolution.ts). */
export const REVOLUTION_CHANCE_BASE = 0.03;
export const REVOLUTION_CHANCE_EXTRA = 0.1;
/** Between two revolutions of the same country, counted from the outbreak. */
export const REVOLUTION_COOLDOWN = min(6);
/** A revolution not put down by then runs out of steam: its land rejoins its country. */
export const REVOLUTION_TICKS = min(4);
/** Share of the country's land that rises up (a coherent region), with its bounds in tiles. */
export const REVOLUTION_LAND = 0.06;
export const REVOLUTION_MIN_TILES = 120;
export const REVOLUTION_MAX_TILES = 25_000;
/** No revolution within this many tiles of the capital. */
export const REVOLUTION_CAPITAL_SAFE = 40;
/** The region's garrison (country's troops per tile × its tiles) defects to the rebels… */
export const REVOLUTION_TROOPS = 1;
/** …never more than this share of the country's army… */
export const REVOLUTION_TROOPS_MAX = 0.25;
/** …and the locals join them: the rebels start with the garrison × this. */
export const REVOLUTION_LEVY = 1.5;
/**
 * Guerrilla (1.16, the player's request: « un soulèvement ne doit pas être si facile à
 * récupérer »): attacks into rebel land lose this many times their usual troops (the mag of
 * the terrain, like a defence post's ×5)…
 */
export const REVOLUTION_GUERRILLA_MAG = 3;
/** …and their former country, whose garrison the people hide from, this much again… */
export const REVOLUTION_GUERRILLA_HOME = 1.5;
/** …and every tile takes this many times longer to take (like a defence post's ×3). */
export const REVOLUTION_GUERRILLA_SPEED = 3;
/** Barricades: right after the outbreak, both multipliers are this much higher for a while. */
export const REVOLUTION_BARRICADE_TICKS = sec(75);
export const REVOLUTION_BARRICADE_MULT = 2;
/**
 * Contagion: a revolt still holding REVOLUTION_SPREAD_HOLD of the land it has raised spreads
 * into its country, REVOLUTION_SPREAD_FIRST after the outbreak then every
 * REVOLUTION_SPREAD_EVERY: REVOLUTION_SPREAD_LAND × its first region joins it (never near
 * the capital), with its garrison.
 */
export const REVOLUTION_SPREAD_FIRST = sec(90);
export const REVOLUTION_SPREAD_EVERY = sec(60);
export const REVOLUTION_SPREAD_HOLD = 0.5;
export const REVOLUTION_SPREAD_LAND = 0.25;
/**
 * Levy: the rebels raise troops from the region's people at a country's pace (a tribe's
 * is halved), up to this many times their troops per tile at the outbreak, on the land they
 * hold (at least a tribe's ceiling): losses refill, a revolt left alone doubles its army.
 */
export const REVOLUTION_LEVY_CAP = 2;
/** Chance per think (4–7 s) that the rebels push into their former country's land. */
export const REVOLUTION_PUSH_CHANCE = 0.25;
/** Colour index of the rebels' ink (render/colors.ts): tribes use -1. */
export const REBEL_COLOR = -2;

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
/**
 * Moving a capital one still holds (1.18, the player's request): 1 M gold, and the same
 * disorganisation as losing it (CAPITAL_DISORG_TICKS). Re-establishing a lost one is free.
 */
export const CAPITAL_MOVE_COST = 1_000_000;
/** Nations re-establish a lost capital this long after the fall (then retry every 5 s if no spot fits). */
export const CAPITAL_AI_DELAY = sec(10);

// ------------------------------------------------------------------ misc
export const HISTORY_EVERY = 50;
export const HASH_EVERY = 50;
export const OVERTIME_START = min(30);
export const OVERTIME_STEP = min(5);
export const OVERTIME_THRESHOLDS = [80, 70, 60, 50, 45, 40, 35] as const;

// --------------------------------------------------------- battle royale
// (GAME_DESIGN.md §14.1) A safe zone closing step by step on random points.
/** The first closing starts this long after the start (the first zone is announced at once). */
export const ROYALE_FIRST = min(5);
/** From the end of a closing to the start of the next: the next zone is shown all along. */
export const ROYALE_WAIT = min(3);
/** A closing: the circle slides and shrinks to the announced zone over this time… */
export const ROYALE_CLOSE = sec(45);
/** …then one last sweep of the map with the final circle (ticks). */
export const ROYALE_SWEEP = 30;
/** Each zone's radius is the previous one's × this. */
export const ROYALE_SHRINK = 0.8;
/** The last zone's radius, as a share of the map's short side. */
export const ROYALE_MIN = 0.08;
/** After the last zone has closed: the largest country in it wins this long after. */
export const ROYALE_FINAL = min(3);
/** Centres tried for each new zone; one is drawn among those holding ≥ this share of the best's land. */
export const ROYALE_CANDIDATES = 10;
export const ROYALE_LAND_KEEP = 0.75;

// -------------------------------------------------------- doomsday clock
// (GAME_DESIGN.md §14.2) Midnight ends the game. The clock is counted in "clock units":
// one tick of play is one unit, a clock second is DOOM_UNIT units (5 s of play).
export const DOOM_UNIT = 50;
/** Clock seconds from the start (twelve minutes to midnight) to midnight. */
export const DOOM_MIDNIGHT = 720;
/** Milestones (clock seconds gone): arms race, rationing, survival of the strongest, last minute. */
export const DOOM_STAGES = [120, 300, 480, 660] as const;
/** Clock seconds each happening pushes the clock by (a negative one pulls it back). */
export const DOOM_PUSH = {
  atom: 3,
  hydrogen: 10,
  mirv: 30,
  fall: 6,
  betrayal: 6,
  crisis: 15,
  peace: -30,
  council: -20,
  // 1.16's world events: an arms race brings midnight nearer, the World Games push it back.
  rearm: 10,
  games: -15,
} as const;
/** Arms race: bombs cost this much less. */
export const DOOM_NUKE_DISCOUNT = 0.35;
/** Rationing: passive income (base and deposits) × this. */
export const DOOM_RATION = 0.6;
/** Survival of the strongest: share of the useful land (%) under which troops melt; [from 11:56, last minute]. */
export const DOOM_SURVIVAL_FFA = [3, 5] as const;
export const DOOM_SURVIVAL_TEAMS = [10, 15] as const;
export const COUNCIL_PERIOD = min(10);
export const COUNCIL_VOTE_TICKS = sec(30);
export const EVENT_MIN = min(4);
export const EVENT_MAX = min(6);
export const DAY_LENGTH = min(8);
