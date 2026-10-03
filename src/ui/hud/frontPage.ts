// The final edition of the Courier: from a game's chronicle, its headline, its lead
// paragraph, its turning points and the reader's fate. Pure logic (no Svelte store, no
// i18n store): every line is an i18n key with parameters, rendered with the `t` given.
// French copy never puts a country name where it would need an article: the name is a
// label ("Italie : la chute"), in parentheses or after a colon; the prose says "la
// nation victorieuse".
import { SAMPLE_TICKS, type EdPlayer, type Edition, type Fact } from '../game/chronicle';
import type { LocalizedName } from '../../core/map/gamemap';

type At = [number, number];

export type Param =
  | string
  | number
  /** A country (its name). */
  | { p: number }
  /** A game-clock time (absolute tick, shown since the start of play). */
  | { clock: number }
  /** A duration in words ("14 min"). */
  | { span: number }
  /** A share 0..1, shown in percent (without the sign). */
  | { pct: number }
  /** A rank: "3e" / "3rd". */
  | { ord: number }
  /** A number, grouped by locale. */
  | { num: number }
  /** Countries joined: "France, Spain and Italy". */
  | { list: number[] }
  /** A team's name ("Équipe 2", "Les humains"). */
  | { team: number }
  /** A localized name (the map's). */
  | { loc: LocalizedName }
  /** Another line, rendered. */
  | { line: Line };

export interface Line {
  key: string;
  params?: Record<string, Param>;
}

export interface Tx {
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Name of a country the edition does not know (tribes). */
  name: (id: number) => string;
  lang: 'fr' | 'en';
}

const line = (key: string, params?: Record<string, Param>): Line => (params ? { key, params } : { key });

// ------------------------------------------------------------------ basics
export function clockText(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 10));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ordinal(n: number, lang: 'fr' | 'en'): string {
  // A nation is feminine in French: 1re, 2e…
  if (lang === 'fr') return n === 1 ? '1re' : `${n}e`;
  const s = new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n);
  return `${n}${{ one: 'st', two: 'nd', few: 'rd' }[s as 'one'] ?? 'th'}`;
}

export function pctText(share: number, lang: 'fr' | 'en'): string {
  const v = Math.max(0, share * 100);
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
    maximumFractionDigits: v > 0 && v < 10 ? 1 : 0,
  }).format(v);
}

const playerOf = (ed: Edition, id: number): EdPlayer | undefined => ed.roster.find((r) => r.id === id);

export function nameOf(ed: Edition, id: number, tx: Tx): string {
  const r = playerOf(ed, id);
  return r ? r.name[tx.lang] || r.name.en : tx.name(id);
}

function param(ed: Edition, v: Param, tx: Tx): string | number {
  if (typeof v !== 'object') return v;
  if ('p' in v) return nameOf(ed, v.p, tx);
  if ('clock' in v) return clockText(v.clock - ed.startTick);
  if ('span' in v) {
    const s = Math.max(0, Math.round(v.span / 10));
    return s >= 60 ? tx.t('news.min', { n: Math.round(s / 60) }) : tx.t('news.sec', { n: s });
  }
  if ('pct' in v) return pctText(v.pct, tx.lang);
  if ('ord' in v) return ordinal(v.ord, tx.lang);
  if ('num' in v) return new Intl.NumberFormat(tx.lang === 'fr' ? 'fr-FR' : 'en-US').format(v.num);
  if ('list' in v)
    return new Intl.ListFormat(tx.lang === 'fr' ? 'fr-FR' : 'en-GB', { type: 'conjunction' }).format(
      v.list.map((id) => nameOf(ed, id, tx)),
    );
  if ('team' in v) return teamName(ed, v.team, tx);
  if ('loc' in v) return v.loc[tx.lang] || v.loc.en;
  return render(ed, v.line, tx);
}

/** "Équipe 2", or "Les humains" / "Les nations" in Humans vs nations. */
export function teamName(ed: Edition, team: number, tx: Tx): string {
  const which = ed.mode === 'humansVsNations' ? (team === 1 ? 'humans' : 'nations') : 'n';
  return tx.t(`front.team.${which}`, { n: team });
}

/** A line in the reader's language. */
export function render(ed: Edition, l: Line, tx: Tx): string {
  if (!l.params) return tx.t(l.key);
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(l.params)) out[k] = param(ed, v, tx);
  return tx.t(l.key, out);
}

// ----------------------------------------------------------------- shares
/** Team games: shares add up by team (an entity is -team); otherwise each country (its id). */
export const teamMode = (ed: Edition) =>
  ed.mode === 'teams' || ed.mode === 'humansVsNations' || ed.roster.some((r) => r.team > 0);

export const entityOf = (ed: Edition, r: EdPlayer) => (teamMode(ed) && r.team > 0 ? -r.team : r.id);

export const winnerEntity = (ed: Edition) => (teamMode(ed) && ed.winnerTeam > 0 ? -ed.winnerTeam : ed.winner);

/** Share of each entity at sample k. */
export function entityShares(ed: Edition, k: number): Map<number, number> {
  const m = new Map<number, number>();
  const s = ed.shares[k];
  if (!s) return m;
  ed.roster.forEach((r, i) => {
    const e = entityOf(ed, r);
    m.set(e, (m.get(e) ?? 0) + (s[i] ?? 0));
  });
  return m;
}

/** Share of one country at each sample. */
export const shareSeries = (ed: Edition, id: number): number[] => {
  const i = ed.roster.findIndex((r) => r.id === id);
  return ed.shares.map((s) => (i >= 0 ? (s[i] ?? 0) : 0));
};

/** Share of one entity (country or -team) at each sample. */
export const entitySeries = (ed: Edition, entity: number): number[] =>
  ed.shares.map((_, k) => entityShares(ed, k).get(entity) ?? 0);

function leaderAt(ed: Edition, k: number): number {
  let best = 0;
  let who = 0;
  for (const [e, s] of entityShares(ed, k))
    if (s > best) {
      best = s;
      who = e;
    }
  return who;
}

export function finalShare(ed: Edition, entity: number): number {
  return entityShares(ed, ed.shares.length - 1).get(entity) ?? 0;
}

/** Highest share of a country and the sample where it was reached. */
export function peakOf(ed: Edition, id: number): { share: number; k: number } {
  let share = 0;
  let k = -1;
  shareSeries(ed, id).forEach((v, i) => {
    if (v > share) {
      share = v;
      k = i;
    }
  });
  return { share, k };
}

export interface Lead {
  /** Sample from which the winner leads until the end, and its tick. */
  k: number;
  tick: number;
  /** In the lead from the first two minutes on. */
  wire: boolean;
  /** Took the lead for good only in the second half of the game. */
  comeback: boolean;
  /** Entity in the lead just before (0: none). */
  prev: number;
  share: number;
}

/** When the winner took the lead for good (null: never led at a sample). */
export function leadInfo(ed: Edition): Lead | null {
  if ((ed.winner <= 0 && ed.winnerTeam <= 0) || !ed.ticks.length) return null;
  const win = winnerEntity(ed);
  let since = -1;
  for (let k = ed.ticks.length - 1; k >= 0; k--) {
    if (leaderAt(ed, k) !== win) break;
    since = k;
  }
  // Never in the lead, or only at the very end (the leader just fell or gave up): no story.
  if (since < 0 || (since === ed.ticks.length - 1 && since > 0)) return null;
  const dur = Math.max(1, ed.endTick - ed.startTick);
  let early = ed.ticks.findIndex((t) => t - ed.startTick >= 1200);
  if (early < 0) early = ed.ticks.length - 1;
  const tick = ed.ticks[since]!;
  return {
    k: since,
    tick,
    wire: since <= early,
    comeback: since > early && dur >= 6000 && tick - ed.startTick > dur * 0.5,
    prev: since > 0 ? leaderAt(ed, since - 1) : 0,
    share: entityShares(ed, since).get(win) ?? 0,
  };
}

// --------------------------------------------------------------- headline
export type HeadKind =
  | 'blitz'
  | 'reign'
  | 'comeback'
  | 'attrition'
  | 'domination'
  | 'lastStanding'
  | 'team'
  | 'forfeit'
  | 'finalBlow'
  | 'points'
  | 'none';

export type Kicker = 'territory' | 'lastStanding' | 'team' | 'forfeit' | 'defeat' | 'points' | 'none';

type FactOf<K extends Fact['k']> = Extract<Fact, { k: K }>;
const factsOf = <K extends Fact['k']>(ed: Edition, k: K): FactOf<K>[] =>
  ed.facts.filter((f): f is FactOf<K> => f.k === k);

const viewerFall = (ed: Edition) =>
  ed.viewer > 0 ? factsOf(ed, 'fall').find((f) => f.player === ed.viewer) : undefined;

const minutes = (ed: Edition) => (ed.endTick - ed.startTick) / 600;

/** Which headline the game deserves. */
export function headKind(ed: Edition, lead: Lead | null = leadInfo(ed)): HeadKind {
  if (ed.winner <= 0 && ed.winnerTeam <= 0) return 'none';
  if (teamMode(ed) && ed.winnerTeam > 0) return 'team';
  if (ed.reason === 'lastStanding') return 'lastStanding';
  if (ed.reason === 'humansEliminated') {
    const fall = viewerFall(ed);
    if (fall && ed.viewer !== ed.winner)
      return fall.cause === 'surrender' ? 'forfeit' : fall.by === ed.winner ? 'finalBlow' : 'points';
    return 'points';
  }
  if (lead?.comeback) return 'comeback';
  if (minutes(ed) < 15) return 'blitz';
  if (lead?.wire) return 'reign';
  if (minutes(ed) >= 45) return 'attrition';
  return 'domination';
}

/** How the game ended, as the reader saw it (the line above the headline). */
export function kickerOf(ed: Edition, kind: HeadKind): Kicker {
  const fall = viewerFall(ed);
  if (ed.reason === 'humansEliminated' && fall && ed.viewer !== ed.winner)
    return fall.cause === 'surrender' ? 'forfeit' : 'defeat';
  if (kind === 'none') return 'none';
  if (kind === 'team') return 'team';
  if (ed.reason === 'lastStanding') return 'lastStanding';
  if (ed.reason === 'humansEliminated') return 'points';
  return ed.reason === 'territory' ? 'territory' : 'none';
}

export interface Headline {
  kind: HeadKind;
  kicker: Line;
  title: Line;
  deck: Line;
}

const rivalsOf = (ed: Edition) =>
  ed.roster.filter((r) => r.id !== ed.winner && !(ed.winnerTeam > 0 && r.team === ed.winnerTeam)).length;

export function headline(ed: Edition, lead: Lead | null = leadInfo(ed)): Headline {
  const kind = headKind(ed, lead);
  const win = winnerEntity(ed);
  const share = { pct: finalShare(ed, win) };
  const duration = { span: ed.endTick - ed.startTick };
  const winner = { p: ed.winner };
  const title =
    kind === 'none'
      ? line('front.title.none')
      : kind === 'team'
        ? line('front.title.team', { team: { team: ed.winnerTeam } })
        : line(`front.title.${kind}`, { winner });
  let deck: Line;
  const fall = viewerFall(ed);
  if (kind === 'none') deck = line('front.deck.none', { duration });
  else if (kind === 'team')
    deck = line('front.deck.team', {
      list: { list: ed.roster.filter((r) => r.team === ed.winnerTeam).map((r) => r.id) },
      share,
    });
  else if (kind === 'lastStanding') {
    const n = rivalsOf(ed);
    deck = line(n === 1 ? 'front.deck.lastStandingOne' : 'front.deck.lastStanding', { n, duration });
  } else if (ed.reason === 'humansEliminated' && fall && ed.viewer !== ed.winner) {
    const when = { clock: fall.tick };
    deck =
      fall.cause === 'surrender'
        ? line('front.deck.forfeit', { clock: when, share })
        : fall.by > 0
          ? line('front.deck.defeatBy', { clock: when, by: { p: fall.by } })
          : line('front.deck.defeat', { clock: when });
  } else if (ed.reason === 'humansEliminated') deck = line('front.deck.points', { share });
  else if (ed.reason === 'territory')
    deck = line('front.deck.territory', { share, threshold: Math.round(ed.threshold), duration });
  else deck = line('front.deck.none', { duration });
  return { kind, kicker: line(`front.kicker.${kickerOf(ed, kind)}`), title, deck };
}

// ---------------------------------------------------------- lead paragraph
const falls = (ed: Edition) => factsOf(ed, 'fall');

/** Final ranking of the countries: standing ones by share, then the fallen, last to fall first. */
export function ranking(ed: Edition): EdPlayer[] {
  const last = ed.shares.length - 1;
  const share = (r: EdPlayer) => ed.shares[last]?.[ed.roster.indexOf(r)] ?? 0;
  return ed.roster
    .slice()
    .sort(
      (a, b) =>
        (a.fellAt < 0 ? 0 : 1) - (b.fellAt < 0 ? 0 : 1) ||
        share(b) - share(a) ||
        b.fellAt - a.fellAt ||
        a.id - b.id,
    );
}

export function leadParagraph(ed: Edition, lead: Lead | null = leadInfo(ed)): Line[] {
  const out: Line[] = [];
  const kind = headKind(ed, lead);
  const win = winnerEntity(ed);
  const base = { duration: { span: ed.endTick - ed.startTick }, map: { loc: ed.mapName } };
  const share = { pct: finalShare(ed, win) };
  const fall = viewerFall(ed);
  if (kind === 'none') out.push(line('front.lead.none', base));
  else if (kind === 'team') out.push(line('front.lead.team', { ...base, share }));
  else if (kind === 'lastStanding')
    out.push(line('front.lead.lastStanding', { ...base, n: ed.roster.length }));
  else if (ed.reason === 'humansEliminated' && fall && ed.viewer !== ed.winner)
    out.push(
      line(fall.cause === 'surrender' ? 'front.lead.forfeit' : 'front.lead.defeat', { ...base, share }),
    );
  else if (ed.reason === 'humansEliminated') out.push(line('front.lead.points', { ...base, share }));
  else if (ed.reason === 'territory')
    out.push(line('front.lead.territory', { ...base, share, threshold: Math.round(ed.threshold) }));
  else out.push(line('front.lead.none', base));
  // The race for first place (countries only: a team's lead is told by its share).
  if (lead && !teamMode(ed) && kind !== 'none') {
    if (lead.comeback) out.push(line('front.lead.comeback', { clock: { clock: lead.tick } }));
    else if (lead.wire)
      out.push(
        lead.tick - ed.startTick < 1200
          ? line('front.lead.wireStart')
          : line('front.lead.wire', { clock: { clock: lead.tick } }),
      );
    else out.push(line('front.lead.took', { clock: { clock: lead.tick } }));
  }
  const fs = falls(ed).filter((f) => f.player !== ed.viewer || ed.viewer <= 0);
  if (fs.length === 0) out.push(line('front.lead.fallsNone'));
  else if (fs.length === 1)
    out.push(line('front.lead.fallsOne', { name: { p: fs[0]!.player }, clock: { clock: fs[0]!.tick } }));
  else
    out.push(
      line('front.lead.fallsMany', {
        n: fs.length,
        name: { p: fs[0]!.player },
        clock: { clock: fs[0]!.tick },
      }),
    );
  const nukes = factsOf(ed, 'nuke');
  const firstNuke = nukes.length ? Math.min(...nukes.map((f) => f.tick)) : -1;
  if (ed.counts.nukes === 1) out.push(line('front.lead.nukesOne', { clock: { clock: firstNuke } }));
  else if (ed.counts.nukes > 1)
    out.push(line('front.lead.nukesMany', { n: ed.counts.nukes, clock: { clock: firstNuke } }));
  if (ed.counts.betrayals === 1) out.push(line('front.lead.betrayalsOne'));
  else if (ed.counts.betrayals > 1) out.push(line('front.lead.betrayalsMany', { n: ed.counts.betrayals }));
  // The reader's own result.
  const me = playerOf(ed, ed.viewer);
  if (me) {
    const peak = peakOf(ed, me.id);
    const at = { clock: ed.ticks[Math.max(0, peak.k)] ?? ed.startTick };
    const won = ed.winner === me.id || (ed.winnerTeam > 0 && me.team === ed.winnerTeam);
    // A peak under half a percent is no peak.
    const peaked = peak.share >= 0.005;
    if (won && peaked) out.push(line('front.lead.youWon', { peak: { pct: peak.share }, clock: at }));
    else if (!won) {
      const rank = ranking(ed).indexOf(me) + 1;
      out.push(
        line(peaked ? 'front.lead.youRank' : 'front.lead.youRankOnly', {
          rank: { ord: rank },
          n: ed.roster.length,
          peak: { pct: peak.share },
          clock: at,
        }),
      );
    }
  }
  return out;
}

// --------------------------------------------------------- turning points
export type TurningKind =
  'fall' | 'betrayal' | 'alliance' | 'nuke' | 'worldEvent' | 'lead' | 'offensive' | 'end';

export interface Turning {
  kind: TurningKind;
  tick: number;
  weight: number;
  /** Countries pictured (flags). */
  flags: number[];
  /** Where to look in the replay. */
  at?: At;
  /** A world event's press photo (its id: pressPhotos.ts). */
  photo?: string;
  title: Line;
  deck: Line;
}

/** Most turning points of one kind on the front page. */
const CAPS: Partial<Record<TurningKind, number>> = {
  fall: 4,
  betrayal: 2,
  alliance: 2,
  nuke: 2,
  worldEvent: 2,
  offensive: 1,
  lead: 1,
};

export interface Offensive {
  from: number;
  to: number;
  start: number;
  end: number;
  cells: number;
}

/** Land taken from one country by another over consecutive samples, the largest first. */
export function offensives(ed: Edition): Offensive[] {
  const runs: Offensive[] = [];
  const open = new Map<string, Offensive>();
  for (const tr of ed.transfers) {
    const key = `${tr.from}>${tr.to}`;
    const run = open.get(key);
    if (run && tr.tick - run.end <= SAMPLE_TICKS * 2) {
      run.end = tr.tick;
      run.cells += tr.cells;
    } else {
      const r = { from: tr.from, to: tr.to, start: tr.tick - SAMPLE_TICKS, end: tr.tick, cells: tr.cells };
      open.set(key, r);
      runs.push(r);
    }
  }
  return runs.sort((a, b) => b.cells - a.cells);
}

function posAt(ed: Edition, id: number, tick: number): At | undefined {
  const i = ed.roster.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  let k = ed.ticks.findIndex((t) => t >= tick);
  if (k < 0) k = ed.ticks.length - 1;
  for (let j = k; j >= 0; j--) {
    const p = ed.pos[j];
    if (p && (p[i * 2] ?? -1) >= 0) return [p[i * 2]!, p[i * 2 + 1]!];
  }
  return undefined;
}

export function turningPoints(ed: Edition, lead: Lead | null = leadInfo(ed), max = 8): Turning[] {
  const cands: Turning[] = [];
  const win = ed.winner;
  const big = new Set(
    ed.roster
      .map((r) => ({ id: r.id, peak: peakOf(ed, r.id).share }))
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 4)
      .map((x) => x.id),
  );
  const near = (id: number) => id === win || id === ed.viewer;
  const betrayals = factsOf(ed, 'betrayal');
  let firstNuke = true;
  const nukeFacts = factsOf(ed, 'nuke').sort((a, b) => a.tick - b.tick);
  const seenKinds = new Set<number>();
  for (const f of ed.facts) {
    switch (f.k) {
      case 'fall': {
        const peak = peakOf(ed, f.player).share;
        const weight =
          40 +
          160 * peak +
          (near(f.player) || near(f.by) ? 20 : 0) +
          (f.player === ed.viewer ? 40 : 0) +
          (f.cause === 'surrender' || f.cause === 'nuked' ? 10 : 0);
        const deck =
          f.cause === 'nuked' && f.by <= 0
            ? line('news.fall.deck.nukedUnknown')
            : f.cause === 'conquered' && f.by <= 0
              ? line('front.point.fallAlone')
              : line(`news.fall.deck.${f.cause}`, { by: { p: f.by } });
        cands.push({
          kind: 'fall',
          tick: f.tick,
          weight,
          flags: f.by > 0 ? [f.player, f.by] : [f.player],
          ...(f.at ? { at: f.at } : {}),
          title: line(`news.fall.title.${f.cause}`, { name: { p: f.player } }),
          deck,
        });
        break;
      }
      case 'betrayal':
        cands.push({
          kind: 'betrayal',
          tick: f.tick,
          weight: 55 + (near(f.traitor) || near(f.victim) ? 25 : 0),
          flags: [f.traitor, f.victim],
          ...(f.at ? { at: f.at } : {}),
          title: line('front.point.betrayal', { traitor: { p: f.traitor }, victim: { p: f.victim } }),
          deck: line('front.point.betrayalDeck', { traitor: { p: f.traitor }, victim: { p: f.victim } }),
        });
        break;
      case 'alliance': {
        const mine = f.a === ed.viewer || f.b === ed.viewer;
        const matters = mine || near(f.a) || near(f.b) || (big.has(f.a) && big.has(f.b));
        if (!matters) break;
        const broken = betrayals.find(
          (b) =>
            b.tick > f.tick &&
            ((b.traitor === f.a && b.victim === f.b) || (b.traitor === f.b && b.victim === f.a)),
        );
        cands.push({
          kind: 'alliance',
          tick: f.tick,
          weight: 30 + (mine ? 15 : 0) + (near(f.a) || near(f.b) ? 10 : 0) + (broken ? 10 : 0),
          flags: [f.a, f.b],
          ...(f.at ? { at: f.at } : {}),
          title: line('front.point.alliance', { a: { p: f.a }, b: { p: f.b } }),
          deck: broken
            ? line('front.point.allianceBroken', { clock: { clock: broken.tick } })
            : line('front.point.allianceDeck'),
        });
        break;
      }
      case 'worldEvent':
        cands.push({
          kind: 'worldEvent',
          tick: f.tick,
          weight: 40,
          flags: [],
          photo: f.id,
          title: line(`worldEvent.${f.id}.title`),
          deck: line(`worldEvent.${f.id}.fx`),
        });
        break;
      default:
        break;
    }
  }
  // Missiles: the first of each kind (the very first nuclear strike weighs the most).
  for (const f of nukeFacts) {
    if (seenKinds.has(f.kind)) continue;
    seenKinds.add(f.kind);
    const kind = ['atom', 'hydrogen', 'mirv'][f.kind] ?? 'atom';
    cands.push({
      kind: 'nuke',
      tick: f.tick,
      weight: firstNuke ? 70 : 50,
      flags: f.victim > 0 && f.victim !== f.owner ? [f.owner, f.victim] : [f.owner],
      at: f.at,
      title: line(`front.point.nuke.${kind}`, { owner: { p: f.owner } }),
      deck:
        f.victim > 0 && f.victim !== f.owner
          ? line('front.point.nukeTarget', { victim: { p: f.victim } })
          : line(firstNuke ? 'front.point.nukeTaboo' : 'front.point.nukeWild'),
    });
    firstNuke = false;
  }
  // The winner's lead.
  const winE = winnerEntity(ed);
  if (lead && winE !== 0) {
    const who: Record<string, Param> =
      teamMode(ed) && ed.winnerTeam > 0 ? { team: { team: ed.winnerTeam } } : { winner: { p: win } };
    const prev = lead.prev > 0 && lead.prev !== winE ? lead.prev : 0;
    cands.push({
      kind: 'lead',
      tick: lead.tick,
      weight: lead.comeback ? 95 : lead.wire ? 45 : 85,
      flags: win > 0 ? [win] : [],
      ...(win > 0 && posAt(ed, win, lead.tick) ? { at: posAt(ed, win, lead.tick)! } : {}),
      title: line(teamMode(ed) && ed.winnerTeam > 0 ? 'front.point.leadTeam' : 'front.point.lead', who),
      deck: lead.wire
        ? line('front.point.leadWire', { share: { pct: lead.share } })
        : prev
          ? line('front.point.leadOver', { share: { pct: lead.share }, prev: { p: prev } })
          : line('front.point.leadDeck', { share: { pct: lead.share } }),
    });
  }
  // The largest offensive (at least 2 % of the map's land).
  const off = offensives(ed)[0];
  if (off && off.cells / ed.landCells >= 0.02) {
    const share = off.cells / ed.landCells;
    const at = posAt(ed, off.from, off.start);
    cands.push({
      kind: 'offensive',
      tick: Math.max(ed.startTick, off.start),
      weight: 50 + 600 * share,
      flags: [off.to, off.from],
      ...(at ? { at } : {}),
      title: line('front.point.offensive', { to: { p: off.to } }),
      deck: line('front.point.offensiveDeck', {
        share: { pct: share },
        span: { span: off.end - off.start },
        from: { p: off.from },
      }),
    });
  }
  // Keep the heaviest (a few of each kind), then tell them in order.
  const count = new Map<TurningKind, number>();
  const kept = cands
    .sort((a, b) => b.weight - a.weight || a.tick - b.tick)
    .filter((c) => {
      const n = count.get(c.kind) ?? 0;
      if (n >= (CAPS[c.kind] ?? max)) return false;
      count.set(c.kind, n + 1);
      return true;
    })
    .slice(0, Math.max(0, max - 1))
    .sort((a, b) => a.tick - b.tick);
  // The end, always last.
  const endAt = win > 0 ? posAt(ed, win, ed.endTick) : undefined;
  kept.push({
    kind: 'end',
    tick: ed.endTick,
    weight: Infinity,
    flags: win > 0 ? [win] : [],
    ...(endAt ? { at: endAt } : {}),
    title: line('front.point.end'),
    deck:
      win <= 0 && ed.winnerTeam <= 0
        ? line('front.point.endNone')
        : teamMode(ed) && ed.winnerTeam > 0
          ? line('front.point.endWinner', { winner: { team: ed.winnerTeam } })
          : line('front.point.endWinner', { winner: { p: win } }),
  });
  return kept;
}

// ------------------------------------------------------------- the reader
export interface FateRow {
  label: string;
  value: Line;
  tick?: number;
  at?: At;
}

export interface Fate {
  won: boolean;
  status: Line;
  detail: Line | null;
  rows: FateRow[];
}

export function fateOf(ed: Edition): Fate | null {
  const me = playerOf(ed, ed.viewer);
  if (!me) return null;
  const won = ed.winner === me.id || (ed.winnerTeam > 0 && me.team === ed.winnerTeam);
  const rank = ranking(ed).indexOf(me) + 1;
  const n = ed.roster.length;
  const fall = viewerFall(ed);
  const status = won
    ? line('front.fate.won')
    : fall
      ? line(fall.cause === 'surrender' ? 'front.fate.surrendered' : 'front.fate.fell', {
          clock: { clock: fall.tick },
        })
      : line('front.fate.standing');
  const detail = line('front.fate.rank', { rank: { ord: rank }, n });
  const rows: FateRow[] = [];
  const peak = peakOf(ed, me.id);
  if (peak.k >= 0 && peak.share >= 0.005) {
    const tick = ed.ticks[peak.k]!;
    const at = posAt(ed, me.id, tick);
    rows.push({
      label: 'front.fate.peak',
      value: line('front.fate.peakValue', { share: { pct: peak.share }, clock: { clock: tick } }),
      tick,
      ...(at ? { at } : {}),
    });
  }
  const city = factsOf(ed, 'city').find((f) => f.owner === me.id);
  if (city)
    rows.push({
      label: 'front.fate.firstCity',
      value: line('front.fate.at', { clock: { clock: city.tick } }),
      tick: city.tick,
      at: city.at,
    });
  const ally = factsOf(ed, 'alliance').find((f) => f.a === me.id || f.b === me.id);
  if (ally)
    rows.push({
      label: 'front.fate.firstAlliance',
      value: line('front.fate.with', {
        name: { p: ally.a === me.id ? ally.b : ally.a },
        clock: { clock: ally.tick },
      }),
      tick: ally.tick,
      ...(ally.at ? { at: ally.at } : {}),
    });
  const nuke = factsOf(ed, 'nuke').find((f) => f.owner === me.id);
  if (nuke)
    rows.push({
      label: 'front.fate.firstNuke',
      value: line('front.fate.at', { clock: { clock: nuke.tick } }),
      tick: nuke.tick,
      at: nuke.at,
    });
  const kills = falls(ed).filter((f) => f.by === me.id);
  if (kills.length)
    rows.push({
      label: 'front.fate.kills',
      value: line('front.fate.num', { n: kills.length }),
      tick: kills[0]!.tick,
      ...(kills[0]!.at ? { at: kills[0]!.at } : {}),
    });
  const betrayed = factsOf(ed, 'betrayal').find((f) => f.victim === me.id);
  if (betrayed)
    rows.push({
      label: 'front.fate.betrayedBy',
      value: line('front.fate.with', { name: { p: betrayed.traitor }, clock: { clock: betrayed.tick } }),
      tick: betrayed.tick,
      ...(betrayed.at ? { at: betrayed.at } : {}),
    });
  if (ed.stats && ed.stats.tilesConquered > 0)
    rows.push({
      label: 'front.fate.conquered',
      value: line('front.fate.num', { n: { num: ed.stats.tilesConquered } }),
    });
  return { won, status, detail, rows: rows.slice(0, 6) };
}

// ------------------------------------------------------------------ chart
export interface ChartSeries {
  /** Country id (or -team). */
  key: number;
  label: string;
  color: string;
  /** Share of the usable land at each sample. */
  values: number[];
  /** Printed in its ink and labelled (the winner, the reader); the others are faint. */
  strong: boolean;
}

// ------------------------------------------------------------------- maps
/**
 * Which maps to print side by side: `count` moments evenly spread over the game, from
 * the first minutes (the very start, a blank map of capitals, says little) to the end.
 */
export function pickMaps(ed: Edition, count: number): number[] {
  const skip = Math.max(600, 0.1 * (ed.endTick - ed.startTick));
  let from = ed.maps.findIndex((m) => m.tick - ed.startTick >= skip);
  if (from < 0) from = 0;
  if (ed.maps.length - from < 2) from = Math.max(0, ed.maps.length - 2);
  const n = ed.maps.length - from;
  if (n <= count) return ed.maps.slice(from).map((_, k) => from + k);
  const t0 = ed.maps[from]!.tick;
  const t1 = ed.maps.at(-1)!.tick;
  const out = new Set<number>();
  for (let j = 0; j < count; j++) {
    const target = t0 + ((t1 - t0) * j) / (count - 1);
    let best = -1;
    let gap = Infinity;
    ed.maps.forEach((m, k) => {
      if (k < from || out.has(k)) return;
      const d = Math.abs(m.tick - target);
      if (d < gap) {
        gap = d;
        best = k;
      }
    });
    if (best >= 0) out.add(best);
  }
  return [...out].sort((a, b) => a - b);
}

/** Is the game long enough for a front page of its own (shown before the results)? */
export const worthPrinting = (ed: Edition | null) => !!ed && ed.ticks.length >= 4 && ed.maps.length >= 2;
