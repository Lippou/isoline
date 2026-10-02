// Drives a campaign mission (the campaign is also the game's tutorial): briefing (game
// paused), a step-by-step guide that stays until each step is accomplished (a step that
// asks to build something waits, with a progress bar, until it can be afforded), one-off
// contextual hints, objective progress meters, map markers and the advisor's voice. The
// end goes through the game's own end flow (GameController.endMission: front page, results).
import type { GameController } from '../game/controller';
import type { GameEvent } from '../../core/game/events';
import { hud, toast } from '../stores/game.svelte';
import { t } from '../i18n/i18n.svelte';
import {
  HINTS,
  MISSIONS,
  evaluate,
  missionResult,
  observe,
  shortfall,
  starsFor,
  type Mission,
  type MissionCtx,
} from './missions';
import { audio } from '../../audio/audio';
import { profile } from '../stores/profile.svelte';
import { UNIT_STRIDE } from '../../engine/protocol';
import { U } from '../../core/units/unit';

/** How long a hint stays on screen before the current step comes back (ms). */
const HINT_MS = 14_000;
/** Least time between two hints (ms). */
const HINT_GAP_MS = 25_000;

export class CampaignDirector {
  readonly mission: Mission;
  private memory: Record<string, number> = {};
  private reached: boolean[];
  private step = -1;
  private finished = false;
  private bonusDone = false;
  private lastCam = '';
  private started = false;
  /** Whether the current step was waiting for gold at the last tick. */
  private saving = false;
  private hintsShown = new Set<string>();
  private hint: { key: string; until: number } | null = null;
  private lastHintAt = -Infinity;
  /** What hud.guide shows (a closed guide only comes back when this changes). */
  private shown = '';

  constructor(
    private readonly ctl: GameController,
    mission: Mission,
  ) {
    this.mission = mission;
    this.reached = mission.objectives.map(() => false);
  }

  static for(ctl: GameController, id: string): CampaignDirector | null {
    const m = MISSIONS.find((x) => x.id === id);
    return m ? new CampaignDirector(ctl, m) : null;
  }

  /** Shows the briefing (the game waits) — begin() starts the guide. */
  start(): void {
    const m = this.mission;
    const key = `campaign.${m.id}`;
    hud.briefing = {
      title: t(`${key}.title`),
      text: t(`${key}.brief`),
      objectives: m.objectives.map((o) => t(o.key)),
      bonus: t(m.bonus.key),
      tips: [t(`${key}.tip1`), t(`${key}.tip2`)],
    };
    if (!this.ctl.session.paused) this.ctl.togglePause();
    audio.voice(`${key}.brief`);
  }

  begin(): void {
    if (this.started) return;
    this.started = true;
    hud.briefing = null;
    audio.stopVoice();
    if (this.ctl.session.paused) this.ctl.togglePause();
    const c = this.ctx([]);
    this.refreshObjectives(c);
    this.advance(c);
  }

  stop(): void {
    audio.stopVoice();
    this.ctl.renderer.overlay.guideMarker = null;
  }

  private ctx(events: GameEvent[]): MissionCtx {
    const s = this.ctl.session.state;
    const me = this.ctl.session.viewer;
    let warships = 0;
    for (let k = 0; k < s.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      if (s.units[o + 1] === U.Warship && s.units[o + 2] === me) warships++;
    }
    return {
      tick: s.phase === 'playing' && s.world ? s.tick - s.world.startTick : 0,
      local: s.local,
      players: s.playerList,
      world: s.world,
      me,
      events,
      memory: this.memory,
      usefulLand: s.world?.usefulLand ?? 1,
      phase: s.phase,
      warships,
    };
  }

  tick(_tick: number, events: GameEvent[]): void {
    if (this.finished || !this.started) return;
    const c = this.ctx(events);
    observe(c);
    this.watchInterface();
    // Guide: move on as soon as the current step is accomplished (steps may chain).
    const steps = this.mission.guide;
    let guard = 0;
    while (this.step < steps.length - 1 && steps[this.step]!.done(c) && guard++ < steps.length) {
      audio.ui('confirm');
      this.advance(c);
    }
    this.pickHint(c);
    this.showGuide(c);
    const cur = steps[this.step];
    this.ctl.renderer.overlay.guideMarker = cur?.marker?.(c) ?? null;
    this.refreshObjectives(c);
    this.evalMission(c);
  }

  /** The sim ended the game by itself (doomsday mode): the mission ends with it. */
  gameOver(): void {
    if (this.finished) return;
    const c = this.ctx([]);
    const won = evaluate(this.mission, c, this.reached) === 'won';
    this.end(won ? starsFor(this.mission, c, this.bonusDone || this.mission.bonus.check(c)) : 0);
  }

  /** Camera moves, the attack ratio and the trade window, for the steps that teach them. */
  private watchInterface(): void {
    const cam = this.ctl.renderer?.camera;
    if (cam) {
      const key = `${Math.round(cam.cx / 20)}:${Math.round(cam.cy / 20)}:${Math.round(Math.log(cam.zoom) * 4)}`;
      if (this.lastCam && key !== this.lastCam) this.memory.camMoves = (this.memory.camMoves ?? 0) + 1;
      this.lastCam = key;
    }
    if (Math.abs(hud.attackRatio - 0.2) > 0.01) this.memory.ratioChanged = 1;
    if (hud.panels.trade) this.memory.tradeOpened = 1;
  }

  private advance(c: MissionCtx): void {
    this.step = Math.min(this.mission.guide.length - 1, this.step + 1);
    this.memory.stepAt = c.tick;
    this.memory.stepCam = this.memory.camMoves ?? 0;
    const s = this.mission.guide[this.step]!;
    this.hint = null; // a new step comes first
    this.saving = !!shortfall(s, c);
    // A step that cannot be afforded yet speaks once the gold is there.
    if (!this.saving) audio.voice(s.key);
    this.showGuide(c);
  }

  /** One-off advice when its situation first arises (never over the first step). */
  private pickHint(c: MissionCtx): void {
    const now = performance.now();
    if (this.hint && now >= this.hint.until) this.hint = null;
    if (this.hint || this.step < 1 || c.phase !== 'playing' || now - this.lastHintAt < HINT_GAP_MS) return;
    const h = HINTS.find((x) => !this.hintsShown.has(x.key) && x.when(c));
    if (!h) return;
    this.hintsShown.add(h.key);
    this.hint = { key: h.key, until: now + HINT_MS };
    this.lastHintAt = now;
    audio.ui('open');
    audio.voice(h.key);
  }

  private showGuide(c: MissionCtx): void {
    const steps = this.mission.guide;
    const s = steps[this.step];
    if (!s) return;
    const speaker = t('campaign.advisor');
    if (this.hint) {
      const sig = `hint:${this.hint.key}`;
      if (sig !== this.shown) {
        this.shown = sig;
        hud.guide = {
          index: this.step + 1,
          total: steps.length,
          text: t(this.hint.key),
          speaker,
          hint: true,
        };
      }
      return;
    }
    const need = shortfall(s, c);
    if (this.saving && !need) audio.voice(s.key); // the gold is there: the order now
    this.saving = !!need;
    const sig = `step:${this.step}:${need ? 'need' : 'go'}`;
    // A guide the player closed comes back with the next step (or the next hint) only.
    if (sig !== this.shown || (hud.guide && need)) {
      this.shown = sig;
      hud.guide = {
        index: this.step + 1,
        total: steps.length,
        text: t(s.key),
        speaker,
        ...(need ? { need } : {}),
      };
    }
  }

  private refreshObjectives(c: MissionCtx): void {
    const m = this.mission;
    hud.objectives = [
      ...m.objectives.map((o, k) => {
        const done = this.reached[k] || o.check(c);
        return { text: t(o.key), done, bonus: false, ...(o.progress ? { progress: o.progress(c) } : {}) };
      }),
      {
        text: t(m.bonus.key),
        done: this.bonusDone,
        bonus: true,
        ...(m.bonus.progress ? { progress: m.bonus.progress(c) } : {}),
      },
    ];
  }

  private evalMission(c: MissionCtx): void {
    const m = this.mission;
    if (!this.bonusDone && m.bonus.check(c)) {
      this.bonusDone = true;
      toast(t('campaign.bonusDone'), 'good');
    }
    const outcome = evaluate(m, c, this.reached);
    if (outcome === 'lost') this.end(0);
    else if (outcome === 'won') this.end(starsFor(m, c, this.bonusDone));
  }

  private end(stars: number): void {
    if (this.finished) return;
    this.finished = true;
    const m = this.mission;
    this.hint = null;
    hud.guide = {
      index: m.guide.length,
      total: m.guide.length,
      text: stars > 0 ? t(m.outro) : t('campaign.failed'),
      speaker: t('campaign.advisor'),
    };
    audio.voice(stars > 0 ? m.outro : 'campaign.failed');
    this.ctl.renderer.overlay.guideMarker = null;
    // The controller records the stars (profile) and opens the mission communiqué.
    const best = profile.campaign[m.id] ?? 0;
    const c = this.ctx([]);
    const result = missionResult(m, c, { reached: this.reached, bonusDone: this.bonusDone, stars, best }, t);
    void this.ctl.endMission(result);
  }
}
