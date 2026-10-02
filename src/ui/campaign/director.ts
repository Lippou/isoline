// Drives a campaign mission / the tutorial: briefing (game paused), a step-by-step
// guide that stays until each step is accomplished, objective progress meters,
// map markers and the advisor's voice.
import type { GameController } from '../game/controller';
import type { GameEvent } from '../../core/game/events';
import { hud, toast } from '../stores/game.svelte';
import { t } from '../i18n/i18n.svelte';
import { MISSIONS, TUTORIAL_STEPS, type GuideStep, type Mission, type MissionCtx } from './missions';
import { recordMission } from '../stores/profile.svelte';
import { settings, saveSettings } from '../stores/settings.svelte';
import { audio } from '../../audio/audio';
import { N } from '../../core/game/constants';

export class CampaignDirector {
  private mission: Mission | null;
  private memory: Record<string, number> = {};
  private steps: GuideStep[];
  private step = -1;
  private finished = false;
  private bonusDone = false;
  private lastCam = '';
  private started = false;

  constructor(
    private readonly ctl: GameController,
    id: string,
  ) {
    this.mission = MISSIONS.find((m) => m.id === id) ?? null;
    this.steps = this.mission ? this.mission.guide : TUTORIAL_STEPS;
  }

  /** Shows the briefing (the game waits) — begin() starts the guide. */
  start(): void {
    const m = this.mission;
    const key = m ? `campaign.${m.id}` : 'tutorial';
    hud.briefing = {
      title: t(`${key}.title`),
      text: t(`${key}.brief`),
      objectives: m ? [t(m.main.key)] : [t('tutorial.goal')],
      bonus: m ? t(m.bonus.key) : '',
      tips: m ? [t(`${key}.tip1`), t(`${key}.tip2`)] : [t('tutorial.tip1'), t('tutorial.tip2')],
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
    this.refreshObjectives(this.ctx([]));
    this.advance();
  }

  stop(): void {
    audio.stopVoice();
    this.ctl.renderer.overlay.guideMarker = null;
  }

  private ctx(events: GameEvent[]): MissionCtx {
    const s = this.ctl.session.state;
    return {
      tick: s.phase === 'playing' && s.world ? s.tick - s.world.startTick : 0,
      local: s.local,
      players: s.playerList,
      world: s.world,
      me: this.ctl.session.viewer,
      events,
      memory: this.memory,
      usefulLand: s.world?.usefulLand ?? 1,
      phase: s.phase,
    };
  }

  tick(_tick: number, events: GameEvent[]): void {
    if (this.finished || !this.started) return;
    const me = this.ctl.session.viewer;
    for (const e of events) {
      if (e.k === 'eliminated' && e.by === me) this.memory.eliminated = (this.memory.eliminated ?? 0) + 1;
      if (e.k === 'nukeLaunch' && e.owner === me && e.kind === N.Hydrogen)
        this.memory.hbomb = (this.memory.hbomb ?? 0) + 1;
      if (e.k === 'loot' && e.owner === me) this.memory.loot = (this.memory.loot ?? 0) + e.amount;
    }
    if ((this.ctl.session.state.local?.boats ?? 0) > 0) this.memory.landing = 1;
    // Camera / ratio usage for the tutorial.
    const cam = this.ctl.renderer?.camera;
    if (cam) {
      const key = `${Math.round(cam.cx / 20)}:${Math.round(cam.cy / 20)}:${Math.round(Math.log(cam.zoom) * 4)}`;
      if (this.lastCam && key !== this.lastCam) this.memory.cameraMoved = 1;
      this.lastCam = key;
    }
    if (Math.abs(hud.attackRatio - 0.2) > 0.01) this.memory.ratioChanged = 1;
    const c = this.ctx(events);
    // Guide: move on as soon as the current step is accomplished (steps may chain).
    let guard = 0;
    while (this.step < this.steps.length && this.steps[this.step]!.done(c) && guard++ < this.steps.length) {
      audio.ui('confirm');
      this.advance();
    }
    const cur = this.steps[this.step];
    this.ctl.renderer.overlay.guideMarker = cur?.marker?.(c) ?? null;
    this.refreshObjectives(c);
    if (this.mission) this.evalMission(c);
    else if (this.step >= this.steps.length - 1 && !this.finished) {
      settings.game.tutorialDone = true;
      saveSettings();
      this.finished = true;
    }
  }

  private advance(): void {
    this.step = Math.min(this.steps.length - 1, this.step + 1);
    const s = this.steps[this.step]!;
    hud.guide = {
      index: this.step + 1,
      total: this.steps.length,
      text: t(s.key),
      speaker: t('campaign.advisor'),
    };
    audio.voice(s.key);
  }

  private refreshObjectives(c: MissionCtx): void {
    const m = this.mission;
    if (!m) {
      hud.objectives = this.steps.slice(0, -1).map((s, k) => ({
        text: t(`${s.key}.short`),
        done: k < this.step,
        bonus: false,
      }));
      return;
    }
    hud.objectives = [
      { text: t(m.main.key), done: m.main.check(c), bonus: false, progress: m.main.progress?.(c) },
      { text: t(m.bonus.key), done: this.bonusDone, bonus: true, progress: m.bonus.progress?.(c) },
    ];
  }

  private evalMission(c: MissionCtx): void {
    const m = this.mission!;
    if (!this.bonusDone && m.bonus.check(c)) {
      this.bonusDone = true;
      toast(t('campaign.bonusDone'), 'good');
    }
    if (m.main.fail?.(c)) {
      this.end(0);
      return;
    }
    if (m.main.check(c)) {
      const stars = 1 + (c.tick <= m.parTicks ? 1 : 0) + (this.bonusDone ? 1 : 0);
      this.end(stars);
    }
  }

  private end(stars: number): void {
    this.finished = true;
    const m = this.mission!;
    void recordMission(m.id, stars);
    hud.guide = {
      index: this.steps.length,
      total: this.steps.length,
      text: stars > 0 ? t(m.outro) : t('campaign.failed'),
      speaker: t('campaign.advisor'),
    };
    audio.voice(stars > 0 ? m.outro : 'campaign.failed');
    this.ctl.renderer.overlay.guideMarker = null;
    audio.setScene(stars > 0 ? 'victory' : 'defeat');
    void this.ctl.session.finalStats().then((stats) => {
      hud.end = {
        stats: { ...stats, reason: stars > 0 ? `mission:${stars}` : 'mission:0' },
        won: stars > 0,
        replaySaved: false,
      };
    });
  }
}
