// Audio engine: real recorded sound effects (CC0), an adaptive orchestral score
// (crossfaded between calm, tension and war moods) and the campaign narration.
// Files live in public/audio (see scripts/audio/*) and are loaded on demand.

export type Sfx =
  | 'coin'
  | 'coinSmall'
  | 'conquest'
  | 'torn'
  | 'stamp'
  | 'rejected'
  | 'tribeFall'
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
  | 'allyOffer'
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
  allyOffer: 'paper',
  torn: 'torn',
  stamp: 'stamp',
  rejected: 'rejected',
  tribeFall: 'tribeFall',
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
// Generous: repeated sounds quickly become irritating.
const THROTTLE: Partial<Record<Sfx | UiSound, number>> = {
  coin: 3000,
  coinSmall: 3000,
  conquest: 4000,
  attack: 3000,
  build: 1200,
  train: 20000,
  cannon: 1500,
  intercept: 1000,
  blast: 800,
  explosionSmall: 800,
  sunk: 1500,
  click: 40,
  confirm: 150,
  open: 200,
  error: 600,
  alliance: 1500,
  allyOffer: 2500,
  torn: 1500,
  stamp: 1500,
  rejected: 1500,
  tribeFall: 2500,
  siren: 4000,
  launch: 150,
  explosionMirv: 250,
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

/** Seconds before a piece ends at which the next one starts fading in (no silence, no seam). */
const HANDOFF_SECONDS = 5;

class MusicDeck {
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
  /** The hand-off to the next piece has been triggered for the current track. */
  handedOff = false;
  /** Bumped at each new track: a stale "pause after the fade" timer leaves it alone. */
  generation = 0;
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
  /** No new crossfade before this time (performance.now()): overlapping fades cut tracks. */
  private fadingUntil = 0;
  /** A change asked for during a crossfade, played once that fade is over. */
  private pending: { track: string; seconds: number } | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
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
    for (const d of this.decks) {
      d.el.addEventListener('timeupdate', () => this.onTimeUpdate(d));
      d.el.addEventListener('ended', () => this.onTrackEnded(d));
    }
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

  /**
   * The game modes' signals, synthesised (no recording fits them): a clock's dry tick
   * ('tick'), a small hand bell for a doomsday milestone ('bell'), a deep tower bell at
   * midnight ('toll'), and a soft two-note chime when the next battle royale zone is
   * announced ('ping'). Quiet by design: they mark time, they do not alarm.
   */
  chime(kind: 'tick' | 'bell' | 'toll' | 'ping', vol = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const gap = kind === 'tick' ? 120 : 600;
    if (now - (this.lastPlay.get(`chime-${kind}`) ?? -1e9) < gap) return;
    this.lastPlay.set(`chime-${kind}`, now);
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.sfxBus);
    /** A decaying sine partial. */
    const partial = (freq: number, amp: number, decay: number, at = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(amp, t0 + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + decay);
      o.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + decay + 0.05);
    };
    if (kind === 'tick') {
      // A short burst of filtered noise: the escapement of a wall clock.
      const len = Math.floor(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400;
      f.Q.value = 4;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      src.connect(f).connect(g).connect(out);
      src.start(t0);
    } else if (kind === 'bell') {
      // Inharmonic partials of a small bell.
      for (const [r, a, d] of [
        [1, 0.22, 1.6],
        [2.4, 0.12, 1.1],
        [3.0, 0.08, 0.8],
        [4.5, 0.05, 0.5],
      ] as const)
        partial(660 * r, a, d);
    } else if (kind === 'toll') {
      for (const [r, a, d] of [
        [0.5, 0.25, 3.2],
        [1, 0.2, 2.6],
        [1.19, 0.1, 2.0],
        [2.0, 0.08, 1.4],
        [2.74, 0.05, 1.0],
      ] as const)
        partial(220 * r, a, d);
    } else {
      partial(880, 0.12, 0.7);
      partial(1175, 0.1, 0.9, 0.14);
    }
  }

  // -------------------------------------------------------------------- music
  setScene(scene: Scene): void {
    const same = scene === this.scene && this.mood !== null;
    this.scene = scene;
    if (!this.ctx) return;
    // Already there: the piece goes on (menus changing page, a game resuming).
    if (same) return;
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
    // Hysteresis: a mood is entered above one threshold and left below a lower one,
    // so a front that flickers does not toss the music back and forth.
    const i = this.intensity;
    const cur = this.mood;
    const want: Mood =
      i > 0.6 || (cur === 'war' && i > 0.4)
        ? 'war'
        : i > 0.3 || (cur === 'tension' && i > 0.15)
          ? 'tension'
          : 'calm';
    const now = performance.now();
    if (want !== this.wantMood) {
      this.wantMood = want;
      this.wantSince = now;
    }
    // Escalate to war quickly; anything else waits until the piece has had its time.
    const escalate = want === 'war' && cur !== 'war';
    const stable = now - this.wantSince > (escalate ? 4000 : 20000);
    const played = now - this.moodSince > (escalate ? 12000 : 60000);
    if (want !== cur && stable && played && now > this.fadingUntil) this.switchMood(want);
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
    this.crossfadeTo(this.nextTrack(mood), mood === 'victory' || mood === 'defeat' ? 1.5 : 5);
  }

  /**
   * Fades the playing piece out while `track` fades in on the other deck. Only two
   * pieces ever sound together: a change asked for during a fade waits for its end
   * (the latest request wins), so no piece is ever cut off in the middle of a fade.
   */
  private crossfadeTo(track: string, seconds: number): void {
    const wait = this.fadingUntil - performance.now();
    if (wait > 0) {
      this.pending = { track, seconds };
      if (!this.pendingTimer)
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          const p = this.pending;
          this.pending = null;
          if (p && this.mood) this.crossfadeTo(p.track, p.seconds);
        }, wait + 50);
      return;
    }
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.fadingUntil = performance.now() + seconds * 1000 + 200;
    const out = this.decks[this.active]!;
    const into = this.decks[1 - this.active]!;
    this.active = 1 - this.active;
    out.gain.gain.cancelScheduledValues(t);
    out.gain.gain.setValueAtTime(out.gain.gain.value, t);
    out.gain.gain.linearRampToValueAtTime(0, t + seconds);
    const gen = out.generation;
    setTimeout(
      () => {
        if (this.decks[this.active] !== out && out.generation === gen) out.el.pause();
      },
      seconds * 1000 + 100,
    );
    into.generation++;
    into.el.src = `${BASE}/music/${track}.ogg`;
    into.el.loop = false; // pieces chain by crossfading (native looping leaves a seam)
    into.handedOff = false;
    into.el.currentTime = 0;
    void into.el.play().catch(() => undefined);
    into.gain.gain.cancelScheduledValues(t);
    into.gain.gain.setValueAtTime(0, t);
    into.gain.gain.linearRampToValueAtTime(1, t + seconds);
  }

  /** A few seconds before the end of the playing piece, the next one fades in over it. */
  private onTimeUpdate(deck: MusicDeck): void {
    if (this.decks[this.active] !== deck || deck.handedOff || !this.mood) return;
    const left = deck.el.duration - deck.el.currentTime;
    if (!Number.isFinite(left) || left > HANDOFF_SECONDS) return;
    deck.handedOff = true;
    this.continueMood(HANDOFF_SECONDS);
  }

  /** Fallback if a piece ends without a hand-off (very short file, missed event). */
  private onTrackEnded(deck: MusicDeck): void {
    if (this.decks[this.active] !== deck || deck.handedOff || !this.mood) return;
    deck.handedOff = true;
    this.continueMood(2);
  }

  /** Same mood, next piece (victory and defeat give way to calm music). */
  private continueMood(seconds: number): void {
    const mood = this.mood === 'victory' || this.mood === 'defeat' ? 'calm' : this.mood!;
    this.mood = mood;
    this.crossfadeTo(this.nextTrack(mood), seconds);
  }

  private fadeAll(): void {
    if (!this.ctx) return;
    this.pending = null;
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
