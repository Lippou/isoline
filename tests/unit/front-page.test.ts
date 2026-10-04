// The final edition of the Courier: the chronicle recorded on the client, then the
// headline, the turning points and the reader's fate written from it.
import { describe, expect, it } from 'vitest';
import fr from '../../src/ui/i18n/fr.json';
import en from '../../src/ui/i18n/en.json';
import {
  Chronicle,
  MAX_MAPS,
  SAMPLE_TICKS,
  type ChronicleSource,
  type EdPlayer,
  type Edition,
  type Fact,
  type Transfer,
} from '../../src/ui/game/chronicle';
import {
  fateOf,
  headKind,
  headline,
  kickerOf,
  leadInfo,
  leadParagraph,
  offensives,
  pickMaps,
  render,
  turningPoints,
  type Line,
  type Tx,
} from '../../src/ui/hud/frontPage';
import type { PlayerView } from '../../src/engine/protocol';
import type { FinalStats } from '../../src/engine/protocol';
import type { GameMode } from '../../src/core/game/config';

// ------------------------------------------------------------------ i18n
type Dict = Record<string, string>;
function flatten(o: unknown, p = '', out: Dict = {}): Dict {
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}
const DICTS = { fr: flatten(fr), en: flatten(en) };
const used = new Set<string>();
function tx(lang: 'fr' | 'en'): Tx {
  return {
    lang,
    name: (id) => `#${id}`,
    t: (key, params) => {
      used.add(key);
      const s = DICTS[lang][key];
      if (s === undefined) throw new Error(`missing ${lang} key ${key}`);
      return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
    },
  };
}

// --------------------------------------------------------- edition builder
const NAMES: Record<number, [string, string]> = {
  1: ['Ilse', 'Ilse'],
  2: ['Italie', 'Italy'],
  3: ['Turquie', 'Turkey'],
  4: ['Grèce', 'Greece'],
  5: ['Égypte', 'Egypt'],
};
const START = 600;

function roster(ids: number[], teams: Record<number, number> = {}): EdPlayer[] {
  return ids.map((id) => ({
    id,
    name: { fr: NAMES[id]![0], en: NAMES[id]![1] },
    kind: id === 1 ? 'human' : 'nation',
    team: teams[id] ?? 0,
    color: id,
    flagSeed: id,
    iso: '',
    fellAt: -1,
  }));
}

function edition(o: {
  minutes: number;
  shares: Record<number, number[]>;
  winner: number;
  reason: string;
  viewer?: number;
  winnerTeam?: number;
  teams?: Record<number, number>;
  mode?: GameMode;
  facts?: Fact[];
  transfers?: Transfer[];
}): Edition {
  const ids = Object.keys(o.shares).map(Number);
  const n = o.shares[ids[0]!]!.length;
  const end = START + o.minutes * 600;
  const ticks = Array.from({ length: n }, (_, k) => Math.round(START + ((end - START) * k) / (n - 1)));
  const r = roster(ids, o.teams);
  for (const f of o.facts ?? []) if (f.k === 'fall') r.find((p) => p.id === f.player)!.fellAt = f.tick;
  return {
    mapId: 'mediterranean',
    mapName: { fr: 'Méditerranée', en: 'Mediterranean' },
    w: 4,
    h: 2,
    land: new Uint8Array(8).fill(1),
    landCells: 1000,
    startTick: START,
    endTick: end,
    date: 0,
    mode: o.mode ?? (o.teams ? 'teams' : 'ffa'),
    threshold: 80,
    reason: o.reason,
    winner: o.winner,
    winnerTeam: o.winnerTeam ?? 0,
    viewer: o.viewer ?? 1,
    roster: r,
    ticks,
    shares: ticks.map((_, k) => Float32Array.from(ids.map((id) => o.shares[id]![k]!))),
    pos: ticks.map(() => Int16Array.from(ids.flatMap((id) => [id * 10, id * 5]))),
    maps: ticks.map((tick) => ({ tick, data: new Uint8Array(8) })),
    facts: o.facts ?? [],
    transfers: o.transfers ?? [],
    counts: { nukes: 0, betrayals: 0, alliances: 0 },
  };
}

const ramp = (from: number, to: number, n = 11) =>
  Array.from({ length: n }, (_, k) => from + ((to - from) * k) / (n - 1));

// ---------------------------------------------------------------- headline
describe('front page headline', () => {
  it('a quick domination is a lightning war', () => {
    const ed = edition({
      minutes: 12,
      shares: { 1: ramp(0.02, 0.05), 3: ramp(0.03, 0.82), 2: ramp(0.05, 0.08) },
      winner: 3,
      reason: 'territory',
    });
    expect(headKind(ed)).toBe('blitz');
    expect(render(ed, headline(ed).title, tx('fr'))).toBe('Turquie : la guerre éclair');
    expect(render(ed, headline(ed).title, tx('en'))).toBe('Turkey wins the lightning war');
    expect(kickerOf(ed, 'blitz')).toBe('territory');
  });

  it('leading from the start in a long game is a reign; late lead is a comeback', () => {
    const reign = edition({
      minutes: 30,
      shares: { 1: ramp(0.02, 0.05), 3: ramp(0.1, 0.81), 2: ramp(0.05, 0.08) },
      winner: 3,
      reason: 'territory',
    });
    expect(leadInfo(reign)).toMatchObject({ k: 0, wire: true, comeback: false });
    expect(headKind(reign)).toBe('reign');
    const comeback = edition({
      minutes: 30,
      // Italy leads until two thirds of the game, then Turkey overtakes it.
      shares: {
        1: ramp(0.02, 0.05),
        2: [0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.5, 0.45, 0.3, 0.1, 0.0],
        3: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.81],
      },
      winner: 3,
      reason: 'territory',
    });
    const lead = leadInfo(comeback)!;
    expect(lead.k).toBe(7);
    expect(lead.comeback).toBe(true);
    expect(lead.prev).toBe(2);
    expect(headKind(comeback)).toBe('comeback');
  });

  it('a long game without a clear leader is a war of attrition', () => {
    const ed = edition({
      minutes: 50,
      shares: {
        1: ramp(0.02, 0.05),
        2: [0.1, 0.3, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        3: [0.05, 0.2, 0.2, 0.2, 0.2, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8],
      },
      winner: 3,
      reason: 'territory',
    });
    expect(headKind(ed)).toBe('attrition');
  });

  it('the reader surrendered: victory by forfeit, kicker "capitulation"', () => {
    const ed = edition({
      minutes: 20,
      shares: { 1: [0.05, 0.1, 0.12, 0.1, 0.0], 3: ramp(0.05, 0.4, 5), 2: ramp(0.05, 0.2, 5) },
      winner: 3,
      reason: 'humansEliminated',
      facts: [{ k: 'fall', tick: START + 12000, player: 1, by: 0, cause: 'surrender' }],
    });
    const h = headline(ed);
    expect(h.kind).toBe('forfeit');
    expect(h.kicker.key).toBe('front.kicker.forfeit');
    expect(render(ed, h.deck, tx('fr'))).toContain('20:00');
  });

  it('the reader was conquered by the winner: the final blow; by someone else: on points', () => {
    const base = {
      minutes: 20,
      shares: { 1: [0.05, 0.1, 0.12, 0.1, 0.0], 3: ramp(0.05, 0.4, 5), 2: ramp(0.05, 0.2, 5) },
      winner: 3,
      reason: 'humansEliminated',
    };
    const blow = edition({
      ...base,
      facts: [{ k: 'fall', tick: START + 12000, player: 1, by: 3, cause: 'conquered' }],
    });
    expect(headKind(blow)).toBe('finalBlow');
    expect(kickerOf(blow, 'finalBlow')).toBe('defeat');
    expect(render(blow, headline(blow).deck, tx('fr'))).toBe(
      'Vos dernières terres tombent à 20:00. Coup de grâce : Turquie.',
    );
    const points = edition({
      ...base,
      facts: [{ k: 'fall', tick: START + 12000, player: 1, by: 2, cause: 'conquered' }],
    });
    expect(headKind(points)).toBe('points');
    // A spectator only sees the leader win on points.
    expect(headKind({ ...points, viewer: -1, facts: [] })).toBe('points');
  });

  it('last nation standing, team victory, no winner', () => {
    const last = edition({
      minutes: 25,
      shares: { 1: ramp(0.1, 0), 2: ramp(0.1, 0), 3: ramp(0.1, 0.6) },
      winner: 3,
      reason: 'lastStanding',
      viewer: -1,
    });
    expect(headKind(last)).toBe('lastStanding');
    expect(render(last, headline(last).deck, tx('en'))).toBe('Its 2 rivals all fell within 25 min.');
    const team = edition({
      minutes: 25,
      shares: { 1: ramp(0.1, 0.3), 2: ramp(0.1, 0.45), 3: ramp(0.1, 0.1), 4: ramp(0.1, 0.05) },
      teams: { 1: 1, 2: 1, 3: 2, 4: 2 },
      winner: 2,
      winnerTeam: 1,
      reason: 'territory',
    });
    expect(headKind(team)).toBe('team');
    expect(render(team, headline(team).title, tx('fr'))).toBe('Équipe 1 : la victoire en équipe');
    expect(render(team, headline(team).deck, tx('en'))).toBe(
      'Members: Ilse and Italy. Together, 75% of the usable land.',
    );
    const none = edition({ minutes: 5, shares: { 1: ramp(0.1, 0.1) }, winner: -1, reason: '' });
    expect(headKind(none)).toBe('none');
  });

  it('the timed modes end at midnight or with the last zone', () => {
    for (const reason of ['midnight', 'lastZone'] as const) {
      const ed = edition({
        minutes: 38,
        shares: { 1: ramp(0.1, 0.2), 2: ramp(0.1, 0.35), 3: ramp(0.1, 0.1) },
        winner: 2,
        reason,
        viewer: -1,
      });
      expect(headKind(ed)).toBe(reason);
      expect(kickerOf(ed, headKind(ed))).toBe(reason);
      for (const lang of ['fr', 'en'] as const) {
        const h = headline(ed);
        for (const l of [h.kicker, h.title, h.deck, ...leadParagraph(ed)])
          expect(render(ed, l, tx(lang))).not.toMatch(/[{}]|front\./);
      }
    }
    const mid = edition({
      minutes: 38,
      shares: { 1: ramp(0.1, 0.2), 2: ramp(0.1, 0.35) },
      winner: 2,
      reason: 'midnight',
      viewer: -1,
    });
    expect(render(mid, headline(mid).deck, tx('en'))).toBe(
      'When the doomsday clock struck midnight, after 38 min of play, the winner held 35% of the usable land.',
    );
  });
});

// --------------------------------------------------------- turning points
describe('turning points', () => {
  const falls: Fact[] = [2, 4, 5].map((player, k) => ({
    k: 'fall',
    tick: START + 3000 * (k + 1),
    player,
    by: 3,
    cause: 'conquered',
  }));
  const ed = edition({
    minutes: 30,
    shares: {
      1: ramp(0.05, 0.12),
      2: [0.1, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      3: ramp(0.1, 0.8),
      4: [0.1, 0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0],
      5: [0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0, 0, 0, 0],
    },
    winner: 3,
    reason: 'territory',
    facts: [
      ...falls,
      { k: 'alliance', tick: START + 600, a: 1, b: 3 },
      { k: 'alliance', tick: START + 700, a: 4, b: 5 },
      { k: 'betrayal', tick: START + 9000, traitor: 3, victim: 1 },
      { k: 'nuke', tick: START + 6000, owner: 3, kind: 0, victim: 4, at: [10, 10] },
      { k: 'nuke', tick: START + 7000, owner: 3, kind: 0, victim: 5, at: [12, 10] },
      { k: 'worldEvent', tick: START + 4000, id: 'pandemic' },
      { k: 'city', tick: START + 300, owner: 1, at: [3, 4] },
    ],
    transfers: [
      { tick: START + 2400, from: 2, to: 3, cells: 40 },
      { tick: START + 2700, from: 2, to: 3, cells: 30 },
      { tick: START + 9000, from: 4, to: 3, cells: 25 },
    ],
  });

  it('merges consecutive transfers into one offensive', () => {
    const off = offensives(ed);
    expect(off[0]).toMatchObject({ from: 2, to: 3, cells: 70, start: START + 2400 - SAMPLE_TICKS });
  });

  it('keeps the heaviest moments, in order, the end last', () => {
    const pts = turningPoints(ed);
    const more = turningPoints(ed, undefined, 12);
    expect(pts.length).toBeLessThanOrEqual(8);
    expect(pts.at(-1)!.kind).toBe('end');
    for (let k = 1; k < pts.length; k++) expect(pts[k]!.tick).toBeGreaterThanOrEqual(pts[k - 1]!.tick);
    const kinds = pts.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'fall').length).toBeLessThanOrEqual(4);
    // The first nuclear strike only (the second A-bomb is not news).
    expect(kinds.filter((k) => k === 'nuke').length).toBe(1);
    expect(kinds).toContain('offensive');
    expect(kinds).toContain('betrayal');
    // Two small countries' alliance does not matter; the reader's does.
    const alliances = more.filter((p) => p.kind === 'alliance');
    expect(alliances.length).toBe(1);
    expect(alliances.every((p) => p.flags.includes(1))).toBe(true);
    // The reader's alliance was betrayed later: its deck says so.
    expect(alliances[0]!.deck.key).toBe('front.point.allianceBroken');
  });

  it('a short list when the game was short', () => {
    const short = edition({ minutes: 2, shares: { 1: ramp(0.1, 0.2, 3) }, winner: -1, reason: '' });
    const pts = turningPoints(short);
    expect(pts.map((p) => p.kind)).toEqual(['end']);
    expect(pts[0]!.deck.key).toBe('front.point.endNone');
  });

  it('the reader fate: status, rank and milestones', () => {
    const fate = fateOf(ed)!;
    expect(fate.won).toBe(false);
    expect(fate.status.key).toBe('front.fate.standing');
    expect(render(ed, fate.detail!, tx('fr'))).toBe('Classement final : 2e sur 5');
    const labels = fate.rows.map((r) => r.label);
    expect(labels).toEqual([
      'front.fate.peak',
      'front.fate.firstCity',
      'front.fate.firstAlliance',
      'front.fate.betrayedBy',
    ]);
    expect(fate.rows.every((r) => r.tick !== undefined)).toBe(true);
    expect(fateOf({ ...ed, viewer: -1 })).toBeNull();
  });

  it('every line exists in both languages and reads without placeholders', () => {
    const lines: Line[] = [];
    const h = headline(ed);
    lines.push(h.kicker, h.title, h.deck, ...leadParagraph(ed));
    for (const p of turningPoints(ed)) lines.push(p.title, p.deck);
    for (const r of fateOf(ed)!.rows) lines.push(r.value, { key: r.label });
    for (const lang of ['fr', 'en'] as const)
      for (const l of lines) {
        const s = render(ed, l, tx(lang));
        expect(s).not.toMatch(/[{}]|undefined|NaN/);
      }
    // The French lead never puts a country name where it would need an article.
    const lead = leadParagraph(ed)
      .map((l) => render(ed, l, tx('fr')))
      .join(' ');
    expect(lead).toContain('« Méditerranée »'.replace(/ /g, ' '));
    expect(lead).not.toMatch(/(de|à|par) (Turquie|Italie|Grèce|Égypte)\b/);
  });
});

describe('maps on the page', () => {
  it('picks moments evenly spread over the game, from the first minutes to the end', () => {
    const ed = edition({ minutes: 40, shares: { 1: ramp(0, 1, 41) }, winner: 1, reason: 'territory' });
    // The blank start is skipped: from 10 % of the game (4 min) to the end.
    expect(pickMaps(ed, 5)).toEqual([4, 13, 22, 31, 40]);
    expect(pickMaps({ ...ed, maps: ed.maps.slice(0, 3) }, 5)).toEqual([0, 1, 2]);
  });
});

// --------------------------------------------------------------- recorder
function view(id: number, o: Partial<PlayerView> = {}): PlayerView {
  return {
    id,
    name: { fr: `P${id}`, en: `P${id}` },
    kind: 'nation',
    team: 0,
    color: id,
    flagSeed: id,
    iso: '',
    alive: true,
    spawned: true,
    tiles: 0,
    usefulTiles: 0,
    troops: 0,
    gold: 0,
    traitor: false,
    traitorFor: 0,
    inactive: false,
    immune: false,
    allies: [],
    personality: 'expansionist',
    general: 'blitz',
    label: [10, 10, 5],
    bigMalus: 0,
    samBonus: 0,
    ...o,
  } as PlayerView;
}

function source(w: number, h: number): ChronicleSource {
  const players = [view(1, { kind: 'human' }), view(2), view(3, { kind: 'tribe' })];
  return {
    width: w,
    height: h,
    tick: 0,
    phase: 'spawn',
    terrain: new Uint8Array(w * h).fill(4),
    owner: new Uint16Array(w * h),
    playerList: players,
    players: new Map(players.map((p) => [p.id, p])),
    world: { startTick: 100, usefulLand: w * h, threshold: 80 } as ChronicleSource['world'],
    meta: { id: 'test', name: { fr: 'Test', en: 'Test' } },
  };
}

function stats(st: ChronicleSource): FinalStats {
  return {
    players: st.playerList
      .filter((p) => p.kind !== 'tribe')
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        color: p.color,
        flagSeed: p.flagSeed,
        iso: p.iso,
        team: 0,
        alive: p.alive,
        tiles: 0,
        stats: {} as never,
        history: [],
        eliminatedTick: -1,
      })),
    tick: st.tick,
    startTick: 100,
    winner: 1,
    winnerTeam: 0,
    reason: 'territory',
  };
}

describe('chronicle', () => {
  it('samples shares every 30 s and keeps small maps (palette indices, tribes apart)', () => {
    const st = source(480, 240);
    const c = new Chronicle(st, 1);
    expect([c.w, c.h]).toEqual([240, 120]);
    expect(c.landCells).toBe(240 * 120);
    // Left half to player 1, a strip to the tribe, nothing to player 2.
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 480; x++) st.owner[y * 480 + x] = x < 240 ? 1 : x < 260 ? 3 : 0;
    st.phase = 'playing';
    for (let tick = 100; tick <= 100 + SAMPLE_TICKS * 3; tick += 10) {
      st.tick = tick;
      (st.players.get(1) as { usefulTiles: number }).usefulTiles = 480 * 120;
      c.tick(st, []);
    }
    const ed = c.close(st, stats(st), 'ffa', 0)!;
    expect(ed.ticks).toEqual([100, 400, 700, 1000]);
    expect(ed.roster.map((r) => r.id)).toEqual([1, 2]);
    expect(ed.shares[0]![0]).toBeCloseTo(0.5);
    const map = ed.maps.at(-1)!.data;
    expect(map[0]).toBe(1); // player 1 → roster index 0 + 1
    expect(map[125]).toBe(255); // the tribe's strip
    expect(map[200]).toBe(0); // free land
  });

  it('records who took land from whom, and the falls with their author', () => {
    const st = source(40, 20);
    const c = new Chronicle(st, 1);
    st.owner.fill(2);
    st.phase = 'playing';
    st.tick = 100;
    c.tick(st, []);
    // Player 1 takes the whole map; a missile of player 1 razes the rest of player 2.
    st.owner.fill(1);
    st.tick = 400;
    c.tick(st, [
      {
        k: 'nukeLaunch',
        id: 1,
        owner: 1,
        kind: 0,
        sx: 0,
        sy: 0,
        tx: 5,
        ty: 5,
        impact: 395,
        threatened: [2],
      },
      { k: 'eliminated', player: 2, by: 0, cause: 'nuked' },
    ]);
    const ed = c.close(st, stats(st), 'ffa', 0)!;
    expect(ed.transfers[0]).toMatchObject({ from: 2, to: 1 });
    expect(ed.facts.find((f) => f.k === 'fall')).toMatchObject({ player: 2, by: 1, cause: 'nuked' });
    expect(ed.facts.find((f) => f.k === 'nuke')).toMatchObject({ owner: 1, kind: 0 });
    expect(ed.counts.nukes).toBe(1);
    expect(ed.roster.find((r) => r.id === 2)!.fellAt).toBe(400);
  });

  it('thins its maps beyond the limit and starts over when a replay is rewound', () => {
    const st = source(40, 20);
    const c = new Chronicle(st, 1);
    st.phase = 'playing';
    const samples = MAX_MAPS * 3;
    for (let k = 0; k < samples; k++) {
      st.tick = 100 + k * SAMPLE_TICKS;
      c.tick(st, []);
    }
    const ed = c.close(st, stats(st), 'ffa', 0)!;
    expect(ed.maps.length).toBeLessThanOrEqual(MAX_MAPS + 1);
    expect(ed.maps[0]!.tick).toBe(100);
    expect(ed.maps.at(-1)!.tick).toBe(st.tick);
    expect(ed.ticks.length).toBe(samples);
    // A replay goes back in time: the chronicle forgets the future.
    st.tick = 700;
    c.tick(st, []);
    expect(c.close(st, stats(st), 'ffa', 0)!.ticks).toEqual([700]);
  });

  it('nothing to print when the game ended during the spawn phase', () => {
    const st = source(40, 20);
    const c = new Chronicle(st, 1);
    st.tick = 50;
    c.tick(st, []);
    expect(c.close(st, stats(st), 'ffa', 0)).toBeNull();
  });
});

describe('lead at the very end', () => {
  it('is no story: the leader just gave up', () => {
    const ed = edition({
      minutes: 6,
      shares: { 1: [0.05, 0.15, 0.25, 0.25, 0], 3: [0.05, 0.1, 0.15, 0.18, 0.18] },
      winner: 3,
      reason: 'humansEliminated',
      facts: [{ k: 'fall', tick: START + 3600, player: 1, by: 0, cause: 'surrender' }],
    });
    expect(leadInfo(ed)).toBeNull();
    expect(turningPoints(ed).some((p) => p.kind === 'lead')).toBe(false);
    expect(leadParagraph(ed).some((l) => l.key.startsWith('front.lead.took'))).toBe(false);
  });
});
