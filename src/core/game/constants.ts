// Every tunable gameplay number lives here (mirrored in GAME_DESIGN.md).
// 1 tick = 100 ms (10 ticks per second).

export const TICKS_PER_SECOND = 10;
export const sec = (s: number) => Math.round(s * TICKS_PER_SECOND);
export const min = (m: number) => sec(m * 60);

// ---------------------------------------------------------------- spawn
export const SPAWN_RADIUS = 8;
export const SPAWN_IMMUNITY_TICKS = sec(60);
export const START_TROOPS = { human: 25_000, nation: 25_000, tribe: 9_000 } as const;
export const START_GOLD = { human: 0, nation: 0, tribe: 0 } as const;

// ---------------------------------------------------------- population
export const POP_BASE = 100_000;
export const POP_PER_CITY_LEVEL = 250_000;
/** Territory bonus = TERRITORY_K × usefulTiles ^ TERRITORY_EXP (decreasing marginal value). */
export const TERRITORY_K = 4_000;
export const TERRITORY_EXP = 0.55;
/** Growth per tick at the optimum, as a fraction of the cap. */
export const GROWTH_MAX = 0.0036;
/** Optimum troops/cap ratio (bell curve peak). */
export const GROWTH_PEAK = 0.42;
export const GROWTH_SIGMA_LOW = 0.34;
export const GROWTH_SIGMA_HIGH = 0.3;
/** Fraction of the population that may move between troops/workers per tick. */
export const REBALANCE_RATE = 0.004;
export const DEFAULT_TROOP_RATIO = 0.6;
/** Large-empire defence malus: starts above this many tiles… */
export const BIG_EMPIRE_TILES = 60_000;
/** …reaches this maximum (attackers lose this much less) … */
export const BIG_EMPIRE_MAX_MALUS = 0.45;
/** …at this many tiles above the threshold. */
export const BIG_EMPIRE_SPAN = 400_000;

// ------------------------------------------------------------------ gold
export const BASE_INCOME = { human: 1_000, nation: 500, tribe: 0 } as const; // per second
export const WORKER_INCOME = 0.012; // gold per worker per second
export const MAX_GOLD = 2_000_000_000;

// ---------------------------------------------------------------- combat
export const DEFAULT_ATTACK_RATIO = 0.2;
/** Troops lost per wilderness tile at mag 80. */
export const WILD_LOSS = 12;
/** Base loss per enemy tile at mag 80, plus density term. */
export const ENEMY_LOSS_BASE = 20;
export const ENEMY_LOSS_DENSITY = 1.6;
/** Defender troops killed per lost tile, as a multiple of its density. */
export const DEFENDER_LOSS_DENSITY = 0.8;
/** Conquest budget per tick = ATTACK_RATE × sqrt(troops) (× 0.4 against players). */
export const ATTACK_RATE = 0.36;
export const ATTACK_RATE_VS_PLAYER = 0.42;
export const ATTACK_MIN_BUDGET = 1.2;
/** Numerical superiority: losses ×(1 − SUPERIORITY_GAIN × clamp(ratio − 1, 0, 1)). */
export const SUPERIORITY_GAIN = 0.35;
/** Inferiority: losses ×(1 + INFERIORITY_PENALTY × (1 − ratio)) when ratio < 1. */
export const INFERIORITY_PENALTY = 0.5;
export const CANCEL_PENALTY = 0.1;
export const MAX_ATTACKS_PER_PLAYER = 12;

// ----------------------------------------------------------- defence post
export const DEFENSE_POST_RANGE = 30;
export const DEFENSE_POST_MAG = 5;
export const DEFENSE_POST_SPEED = 3;

// ---------------------------------------------------------------- traitor
export const TRAITOR_DEBUFF_TICKS = 300;
export const TRAITOR_DEFENSE_MULT = 0.5;
export const TRAITOR_SPEED_MULT = 0.8;
export const TRAITOR_MARK_TICKS = min(5);
export const TRAITOR_EMBARGO_TICKS = min(5);
export const ALLIANCE_TICKS = 3_000;
export const ALLIANCE_RENEW_WINDOW = sec(30);
export const ALLIANCE_REQUEST_TTL = sec(20);
export const INACTIVE_TICKS = sec(60);

// -------------------------------------------------------------- buildings
export const enum B {
  City = 0,
  Port = 1,
  Factory = 2,
  DefensePost = 3,
  Silo = 4,
  Sam = 5,
  Radar = 6,
  Airfield = 7,
}
export const BUILDING_COUNT = 8;
export const BUILDING_KEYS = [
  'city',
  'port',
  'factory',
  'defensePost',
  'silo',
  'sam',
  'radar',
  'airfield',
] as const;
export const BUILD_TICKS = [20, 50, 20, 50, 100, 300, 40, 80] as const;
/** What happens to a building when its tile is captured. */
export const CAPTURE_TRANSFER = [true, true, true, false, true, true, false, true] as const;
export const DEMOLISH_REFUND = 0.25;
export const STATION_TYPES: readonly number[] = [B.City, B.Port, B.Factory];
export const RADAR_RANGE = 60;
export const MIN_BUILDING_SPACING = 4;

// ------------------------------------------------------------------ ships
export const TRANSPORT_SPEED = 1.5;
export const MAX_TRANSPORTS = 4;
export const WARSHIP_COSTS = [250_000, 500_000, 1_000_000] as const;
export const WARSHIP_HP = 1_000;
export const WARSHIP_DAMAGE = 250;
export const WARSHIP_RANGE = 130;
export const WARSHIP_ENGAGE_RANGE = 45;
export const WARSHIP_FIRE_TICKS = 18;
export const WARSHIP_SPEED = 1.2;
export const SHELL_SPEED = 9;
export const WARSHIP_PATROL_RADIUS = 40;
export const WARSHIP_REPAIR = 3; // hp per tick near a friendly port
export const WARSHIP_REPAIR_RANGE = 20;
export const VETERANCY_KILLS = [2, 5, 9] as const;
export const VETERANCY_BONUS = 0.2;
export const TRANSPORT_HP = 300;
export const MERCHANT_HP = 200;
export const MERCHANT_SPEED = 1.0;
/** Base spawn interval of merchant ships per port (ticks) at level 1. */
export const MERCHANT_INTERVAL = 420;
export const MERCHANT_DAMPING = 150; // global merchant count halving the frequency
export const TRADE_BASE = 3_000;
export const TRADE_PER_TILE = 55;
export const TRADE_LEVEL_BONUS = 0.25;
export const PIRACY_RANGE = 4;

// ------------------------------------------------------------------ rails
export const RAIL_CONNECT_RANGE = 110;
export const RAIL_MAX_SEGMENT = 155;
export const RAIL_MIN_GAP = 15;
export const TRAIN_SPEED = 2;
export const TRAIN_SATURATION_MID = 500;
export const TRAIN_PAY_OWN = 10_000;
export const TRAIN_PAY_OTHER = 25_000;
export const TRAIN_PAY_ALLY = 35_000;
export const TRAIN_PAY_DECAY_FROM = 10;
export const TRAIN_PAY_DECAY = 5_000;
export const TRAIN_PAY_FLOOR = 5_000;
export const TRAIN_HOST_SHARE = 0.4;
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
export const NUKE_RADIUS = [12, 80, 0, 12] as const;
export const NUKE_FALLOUT_RADIUS = [30, 100, 0, 18] as const;
export const NUKE_SPEED = 10;
export const MIRV_WARHEADS: readonly [number, number] = [8, 12];
export const MIRV_SPREAD = 70;
export const MIRV_SPLIT_AT = 0.72;
export const SILO_RELOAD_TICKS = 150;
export const SILO_MIRV_COOLDOWN = 900;
export const MAX_NUKE_BATCH = 50;
export const SAM_COSTS = [1_500_000, 3_000_000] as const;
export const SAM_COOLDOWN = 90;
export const SAM_INTERCEPTOR_SPEED = 22;
export const samRange = (level: number) => 150 - 480 / (level + 5);
export const DECONTAMINATION_TICKS = min(10);
export const NUKE_TROOP_KILL = 1.4;

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

// ------------------------------------------------------------------ misc
export const HISTORY_EVERY = 50;
export const HASH_EVERY = 50;
export const DOOMSDAY_GRACE = min(10);
export const DOOMSDAY_STEP = min(2);
export const DOOMSDAY_FFA = [2, 4, 7, 11, 17, 25, 35] as const;
export const DOOMSDAY_TEAMS = [5, 10, 16, 24, 33, 45, 60] as const;
export const OVERTIME_START = min(30);
export const OVERTIME_STEP = min(5);
export const OVERTIME_THRESHOLDS = [80, 70, 60, 50] as const;
export const BATTLE_ROYALE_STEP = min(3);
export const GENERAL_COOLDOWN = min(5);
export const COUNCIL_PERIOD = min(10);
export const COUNCIL_VOTE_TICKS = sec(30);
export const EVENT_MIN = min(4);
export const EVENT_MAX = min(6);
export const DAY_LENGTH = min(8);
