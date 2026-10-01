// Drives a campaign mission / the tutorial: dialogues, objective tracking, stars.
import type { GameController } from '../game/controller';
import type { GameEvent } from '../../core/game/events';
import { hud, toast } from '../stores/game.svelte';
import { t } from '../i18n/i18n.svelte';
import { MISSIONS, TUTORIAL_STEPS, type Mission, type MissionCtx } from './missions';
import { recordMission } from '../stores/profile.svelte';
import { settings, saveSettings } from '../stores/settings.svelte';
import { audio } from '../../audio/audio';
import { N } from '../../core/game/constants';

export class CampaignDirector {
  private mission: Mission | null;
  private memory: Record<string, number> = {};
  private dialogue: string[] = [];
  private dialogueTimer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private finished = false;
  private bonusDone = false;
  private lastCam = '';

  constructor(
    private readonly ctl: GameController,
    id: string,
  ) {
    this.mission = MISSIONS.find((m) => m.id === id) ?? null;
  }

  start(): void {
    if (this.mission) {
      this.dialogue = [...this.mission.intro];
      hud.objectives = [
        { text: t(this.mission.main.key), done: false },
        { text: `★ ${t(this.mission.bonus.key)}`, done: false },
      ];
    } else {
      this.dialogue = [];
      this.showTutorialStep();
    }
    this.nextLine();
    this.dialogueTimer = setInterval(() => this.nextLine(), 7000);
  }

  stop(): void {
    if (this.dialogueTimer) clearInterval(this.dialogueTimer);
  }

  private nextLine(): void {
    const line = this.dialogue.shift();
    if (line) hud.dialogue = { speaker: t('campaign.advisor'), text: t(line) };
    else if (this.mission) hud.dialogue = null;
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
    };
  }

  tick(_tick: number, events: GameEvent[]): void {
    if (this.finished) return;
    const me = this.ctl.session.viewer;
    for (const e of events) {
      if (e.k === 'eliminated' && e.by === me) this.memory.eliminated = (this.memory.eliminated ?? 0) + 1;
      if (e.k === 'nukeLaunch' && e.owner === me && e.kind === N.Hydrogen)
        this.memory.hbomb = (this.memory.hbomb ?? 0) + 1;
    }
    // Camera / ratio usage for the tutorial.
    const cam = this.ctl.renderer?.camera;
    if (cam) {
      const key = `${Math.round(cam.cx / 20)}:${Math.round(cam.cy / 20)}:${Math.round(Math.log(cam.zoom) * 4)}`;
      if (this.lastCam && key !== this.lastCam) this.memory.cameraMoved = 1;
      this.lastCam = key;
    }
    if (Math.abs(hud.attackRatio - 0.2) > 0.01) this.memory.ratioChanged = 1;
    const c = this.ctx(events);
    if (this.mission) this.evalMission(c);
    else this.evalTutorial(c);
  }

  private evalMission(c: MissionCtx): void {
    const m = this.mission!;
    if (!this.bonusDone && m.bonus.check(c)) {
      this.bonusDone = true;
      hud.objectives = hud.objectives.map((o, k) => (k === 1 ? { ...o, done: true } : o));
      toast(t('campaign.bonusDone'), 'good');
    }
    if (m.main.fail?.(c)) {
      this.end(0);
      return;
    }
    if (m.main.check(c)) {
      hud.objectives = hud.objectives.map((o, k) => (k === 0 ? { ...o, done: true } : o));
      const stars = 1 + (c.tick <= m.parTicks ? 1 : 0) + (this.bonusDone ? 1 : 0);
      this.end(stars);
    }
  }

  private end(stars: number): void {
    this.finished = true;
    const m = this.mission!;
    void recordMission(m.id, stars);
    hud.dialogue = { speaker: t('campaign.advisor'), text: stars > 0 ? t(m.outro) : t('campaign.failed') };
    audio.setScene(stars > 0 ? 'victory' : 'defeat');
    void this.ctl.session.finalStats().then((stats) => {
      hud.end = {
        stats: { ...stats, reason: stars > 0 ? `mission:${stars}` : 'mission:0' },
        won: stars > 0,
        replaySaved: false,
      };
    });
  }

  private showTutorialStep(): void {
    const step = TUTORIAL_STEPS[this.step]!;
    hud.dialogue = { speaker: t('campaign.advisor'), text: t(step.key) };
    hud.objectives = TUTORIAL_STEPS.slice(0, -1).map((s, k) => ({
      text: t(`${s.key}.short`),
      done: k < this.step,
    }));
  }

  private evalTutorial(c: MissionCtx): void {
    const step = TUTORIAL_STEPS[this.step];
    if (!step) return;
    if (step.done(c)) {
      this.step++;
      audio.ui('confirm');
      if (this.step >= TUTORIAL_STEPS.length - 1) {
        this.showTutorialStep();
        settings.game.tutorialDone = true;
        saveSettings();
        this.finished = true;
        return;
      }
      this.showTutorialStep();
    }
  }
}
