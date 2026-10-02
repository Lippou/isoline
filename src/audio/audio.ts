// Audio engine: real recorded sound effects (CC0), an adaptive orchestral score
// (crossfaded between calm, tension and war moods) and the campaign narration.
// Files live in public/audio (see scripts/audio/*) and are loaded on demand.

export type Sfx =
  | 'coin'
  | 'coinSmall'
  | 'conquest'
  | 'attack'
  | 'build'
  | 'siren'
  | 'launch'
  | 'explosionA'
  | 'explosionH'
  | 'explosionMirv'
  | 'explosionSmall'
  | 'blast'
  | 'intercept'
  | 'cannon'
  | 'sunk'
  | 'horn'
  | 'train'
  | 'alliance'
  | 'allianceEnd'
  | 'betrayal'
  | 'event'
  | 'victory'
  | 'defeat'
  | 'eliminated'
  | 'warHorn';

export type UiSound = 'click' | 'hover' | 'confirm' | 'error' | 'open';
export type Scene = 'silent' | 'menu' | 'game' | 'victory' | 'defeat';
type Mood = 'menu' | 'calm' | 'tension' | 'war' | 'victory' | 'defeat';

/** Sound name → file (several game events share a recording). */
const FILE: Record<Sfx | UiSound, string | null> = {
  coin: 'coin',
  coinSmall: 'coinSmall',
  conquest: 'conquest',
  attack: 'attack',
  build: 'build',
  siren: 'siren',
  launch: 'launch',
  explosionA: 'explosionA',
  explosionH: 'explosionH',
  explosionMirv: 'explosionA',
  explosionSmall: 'explosionSmall',
  blast: 'explosionSmall',
  intercept: 'intercept',
  cannon: 'cannon',
  sunk: 'sunk',
  horn: 'horn',
  train: 'train',
  alliance: 'alliance',
  allianceEnd: 'paper',
  betrayal: 'betrayal',
  event: 'event',
  victory: 'victory',
  defeat: 'defeat',
  eliminated: 'eliminated',
  warHorn: 'warHorn',
  click: 'click',
  hover: null,
  confirm: 'confirm',
  error: 'error',
  open: 'open',
};

/** Minimum delay between two plays of the same sound (ms). */
const THROTTLE: Partial<Record<Sfx | UiSound, number>> = {
  coin: 350,
  coinSmall: 350,
  conquest: 1500,
  attack: 600,
  build: 400,
  train: 8000,
  cannon: 150,
  intercept: 200,
  blast: 120,
  explosionSmall: 120,
  sunk: 300,
  click: 40,
};

const PLAYLISTS: Record<Mood, string[]> = {
  menu: ['menu'],
  calm: ['calm1', 'calm2', 'calm3'],
  tension: ['tension1', 'tension2'],
  war: ['war1', 'war2', 'war3', 'war4'],
  victory: ['victory'],
  defeat: ['defeat'],
};

const BASE = './audio';

class MusicDeck {
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
  constructor(ctx: AudioContext, out: AudioNode) {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(this.el);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.gain).connect(out);
  }
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private decks: MusicDeck[] = [];
  private active = 0;
  private scene: Scene = 'silent';
  private mood: Mood | null = null;
  private moodSince = 0;
  private wantMood: Mood = 'calm';
  private wantSince = 0;
  private trackIdx: Record<string, number> = {};
  private intensity = 0;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.6 };
  private focusMul = 1;
  private lastPlay = new Map<string, number>();
  private ducked = false;
  private voiceEl: HTMLAudioElement | null = null;
  muteUnfocused = true;
  /** Language of the campaign narration and whether it plays. */
  voiceLang = 'fr';
  voiceOn = true;
  voiceVolume = 0.9;

  /** Must be called from a user gesture at least once (autoplay policy). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    for (const b of [this.musicBus, this.sfxBus, this.uiBus]) b.connect(this.master);
    this.decks = [new MusicDeck(ctx, this.musicBus), new MusicDeck(ctx, this.musicBus)];
    for (const d of this.decks) d.el.addEventListener('ended', () => this.onTrackEnded(d));
    this.applyVolumes();
    window.addEventListener('blur', () => this.setFocus(false));
    window.addEventListener('focus', () => this.setFocus(true));
    // Preload the short sounds so the first explosion is not late.
    for (const f of new Set(Object.values(FILE))) if (f) void this.buffer(f);
    setInterval(() => this.updateMood(), 1000);
    if (this.scene !== 'silent') this.setScene(this.scene);
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(`${BASE}/sfx/${file}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(file, p);
    }
    return p;
  }

  setVolumes(v: {
    master: number;
    music: number;
    sfx: number;
    ui: number;
    voice?: number;
    voiceOn?: boolean;
    muteUnfocused: boolean;
  }): void {
    this.volumes = { master: v.master, music: v.music, sfx: v.sfx, ui: v.ui };
    this.voiceVolume = v.voice ?? 0.9;
    this.voiceOn = v.voiceOn ?? true;
    if (this.voiceEl) this.voiceEl.volume = Math.max(0, Math.min(1, v.master * this.voiceVolume));
    this.muteUnfocused = v.muteUnfocused;
    this.applyVolumes();
  }

  private setFocus(on: boolean): void {
    this.focusMul = on || !this.muteUnfocused ? 1 : 0.15;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master * this.focusMul, t, 0.1);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.7 * (this.ducked ? 0.3 : 1), t, 0.3);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.uiBus.gain.setTargetAtTime(this.volumes.ui * 0.8, t, 0.05);
  }

  // ------------------------------------------------------------------ effects
  private play(name: Sfx | UiSound, bus: GainNode, vol: number, vary: boolean): void {
    if (!this.ctx) return;
    const file = FILE[name];
    if (!file) return;
    const now = performance.now();
    const gap = THROTTLE[name] ?? 60;
    if (now - (this.lastPlay.get(name) ?? -1e9) < gap) return;
    this.lastPlay.set(name, now);
    void this.buffer(file).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      // Slight random pitch/level variation: repeated sounds do not feel mechanical.
      if (vary) src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const g = this.ctx.createGain();
      g.gain.value = vol * (vary ? 0.9 + Math.random() * 0.2 : 1);
      src.connect(g).connect(bus);
      src.start();
    });
  }

  sfx(name: Sfx, vol = 1): void {
    this.play(name, this.sfxBus, vol, !['victory', 'defeat', 'alliance', 'betrayal', 'siren'].includes(name));
  }

  ui(name: UiSound): void {
    this.play(name, this.uiBus, 0.8, true);
  }

  // -------------------------------------------------------------------- music
  setScene(scene: Scene): void {
    this.scene = scene;
    if (!this.ctx) return;
    const mood: Mood | null =
      scene === 'menu'
        ? 'menu'
        : scene === 'victory'
          ? 'victory'
          : scene === 'defeat'
            ? 'defeat'
            : scene === 'game'
              ? 'calm'
              : null;
    if (mood === null) this.fadeAll();
    else this.switchMood(mood);
  }

  /** 0 = peace … 1 = total war (fronts, nuclear alerts). */
  setIntensity(v: number): void {
    this.intensity = v;
  }

  private updateMood(): void {
    if (this.scene !== 'game') return;
    const want: Mood = this.intensity > 0.55 ? 'war' : this.intensity > 0.22 ? 'tension' : 'calm';
    const now = performance.now();
    if (want !== this.wantMood) {
      this.wantMood = want;
      this.wantSince = now;
    }
    // Escalate quickly, calm down slowly; never cut a track that just started.
    const stable = now - this.wantSince > (want === 'war' ? 3000 : 15000);
    const played = now - this.moodSince > 25000;
    if (want !== this.mood && stable && played) this.switchMood(want);
  }

  private nextTrack(mood: Mood): string {
    const list = PLAYLISTS[mood];
    const k = (this.trackIdx[mood] ?? Math.floor(Math.random() * list.length)) % list.length;
    this.trackIdx[mood] = k + 1;
    return list[k]!;
  }

  private switchMood(mood: Mood): void {
    if (!this.ctx) return;
    this.mood = mood;
    this.moodSince = performance.now();
    this.crossfadeTo(this.nextTrack(mood), mood === 'victory' || mood === 'defeat' ? 1.5 : 4);
  }

  private crossfadeTo(track: string, seconds: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.decks[this.active]!;
    const into = this.decks[1 - this.active]!;
    this.active = 1 - this.active;
    out.gain.gain.cancelScheduledValues(t);
    out.gain.gain.setValueAtTime(out.gain.gain.value, t);
    out.gain.gain.linearRampToValueAtTime(0, t + seconds);
    const old = out.el;
    setTimeout(
      () => {
        if (this.decks[this.active] !== out) old.pause();
      },
      seconds * 1000 + 100,
    );
    into.el.src = `${BASE}/music/${track}.ogg`;
    into.el.loop = this.mood === 'menu';
    into.el.currentTime = 0;
    void into.el.play().catch(() => undefined);
    into.gain.gain.cancelScheduledValues(t);
    into.gain.gain.setValueAtTime(0, t);
    into.gain.gain.linearRampToValueAtTime(1, t + seconds);
  }

  private onTrackEnded(deck: MusicDeck): void {
    if (this.decks[this.active] !== deck || !this.mood) return;
    // Same mood, next piece (victory/defeat fall back to calm music).
    const mood = this.mood === 'victory' || this.mood === 'defeat' ? 'calm' : this.mood;
    this.mood = mood;
    this.crossfadeTo(this.nextTrack(mood), 2);
  }

  private fadeAll(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const d of this.decks) {
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setValueAtTime(d.gain.gain.value, t);
      d.gain.gain.linearRampToValueAtTime(0, t + 1.5);
    }
    this.mood = null;
  }

  // -------------------------------------------------------------------- voice
  /** Campaign advisor narration (pre-recorded files; silently skipped if missing). */
  voice(key: string): void {
    this.stopVoice();
    if (!this.voiceOn || !key) return;
    const el = new Audio(`./voice/${this.voiceLang}/${key}.mp3`);
    el.volume = Math.max(0, Math.min(1, this.volumes.master * this.voiceVolume * this.focusMul));
    this.voiceEl = el;
    this.duck(true);
    el.onended = () => this.duck(false);
    el.onerror = () => this.duck(false);
    void el.play().catch(() => this.duck(false));
  }

  stopVoice(): void {
    if (this.voiceEl) {
      this.voiceEl.pause();
      this.voiceEl = null;
    }
    this.duck(false);
  }

  /** Lowers the music while the advisor speaks. */
  private duck(on: boolean): void {
    this.ducked = on;
    this.applyVolumes();
  }
}

export const audio = new AudioEngine();
