// Procedural audio (Web Audio API): generative music with intensity layers and
// synthesised sound effects. No sample files — everything is synthesised live.

export type Sfx =
  | 'coin'
  | 'conquest'
  | 'build'
  | 'siren'
  | 'launch'
  | 'explosionA'
  | 'explosionH'
  | 'explosionMirv'
  | 'blast'
  | 'intercept'
  | 'cannon'
  | 'sunk'
  | 'train'
  | 'alliance'
  | 'betrayal'
  | 'event'
  | 'victory'
  | 'defeat';
export type UiSound = 'click' | 'hover' | 'confirm' | 'error' | 'open';
export type Scene = 'silent' | 'menu' | 'game' | 'victory' | 'defeat';

// D dorian-ish progressions (semitones from the root) for calm / tension / war.
const ROOT = 50; // D3
const PROGRESSIONS = {
  calm: [
    [0, 7, 14, 17],
    [-2, 5, 12, 17],
    [3, 10, 15, 19],
    [-4, 3, 10, 15],
  ],
  tension: [
    [0, 7, 15, 18],
    [1, 8, 13, 16],
    [-2, 5, 13, 17],
    [-1, 6, 13, 18],
  ],
  war: [
    [0, 7, 12, 15],
    [-2, 5, 10, 13],
    [-4, 3, 8, 15],
    [-5, 2, 10, 14],
  ],
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private layers!: { calm: GainNode; tension: GainNode; war: GainNode };
  private noise!: AudioBuffer;
  private scene: Scene = 'silent';
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.6 };
  private focusMul = 1;
  private lastSfx = new Map<string, number>();
  muteUnfocused = true;

  /** Must be called from a user gesture at least once (autoplay policy). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    // Gentle global reverb for space.
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.6);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.28;
    verb.connect(verbGain).connect(this.master);
    for (const b of [this.musicBus, this.sfxBus, this.uiBus]) {
      b.connect(this.master);
    }
    this.musicBus.connect(verb);
    this.sfxBus.connect(verb);
    this.layers = { calm: ctx.createGain(), tension: ctx.createGain(), war: ctx.createGain() };
    for (const g of Object.values(this.layers)) {
      g.gain.value = 0;
      g.connect(this.musicBus);
    }
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    window.addEventListener('blur', () => this.setFocus(false));
    window.addEventListener('focus', () => this.setFocus(true));
    this.timer = setInterval(() => this.schedule(), 50);
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  setVolumes(v: { master: number; music: number; sfx: number; ui: number; muteUnfocused: boolean }): void {
    this.volumes = { master: v.master, music: v.music, sfx: v.sfx, ui: v.ui };
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
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.uiBus.gain.setTargetAtTime(this.volumes.ui * 0.7, t, 0.05);
  }

  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.step = 0;
    if (!this.ctx) return;
    if (scene === 'victory' || scene === 'defeat') this.theme(scene);
    this.setIntensity(this.intensity);
  }

  /** 0 calm … 1 full war; crossfades the three in-game layers. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inGame = this.scene === 'game';
    const menu = this.scene === 'menu';
    const calm = menu ? 1 : inGame ? Math.max(0, 1 - this.intensity * 1.6) : 0;
    const tension = inGame ? Math.max(0, 1 - Math.abs(this.intensity - 0.45) * 2.6) : 0;
    const war = inGame ? Math.max(0, (this.intensity - 0.5) * 2) : 0;
    this.layers.calm.gain.setTargetAtTime(calm, t, 1.5);
    this.layers.tension.gain.setTargetAtTime(tension, t, 1.5);
    this.layers.war.gain.setTargetAtTime(war, t, 1.0);
  }

  // ------------------------------------------------------------- music
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.scene === 'silent' || this.scene === 'victory' || this.scene === 'defeat') return;
    const bpm = this.scene === 'menu' ? 68 : 76 + this.intensity * 30;
    const stepDur = 60 / bpm / 2; // eighth notes
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.4) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private playStep(step: number, time: number, dur: number): void {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const prog = (k: keyof typeof PROGRESSIONS) => PROGRESSIONS[k][bar % 4]!;
    // Pads on bar start for each layer.
    if (inBar === 0) {
      this.pad(prog('calm'), time, dur * 16, this.layers.calm, 0.05, 'triangle', 900);
      this.pad(prog('tension'), time, dur * 16, this.layers.tension, 0.045, 'sawtooth', 700);
      this.pad(prog('war'), time, dur * 16, this.layers.war, 0.04, 'sawtooth', 1200);
    }
    // Calm: sparse bell arpeggio (pentatonic, deterministic pattern).
    const arp = [0, 2, 3, 1, 2, 0, 3, 2];
    if (inBar % 4 === 0 || (this.scene === 'menu' && inBar % 2 === 0)) {
      const notes = prog('calm');
      const n = notes[arp[((step / 2) % 8) | 0]! % notes.length]! + 24;
      this.bell(ROOT + n, time, 1.8, this.layers.calm, 0.05);
    }
    // Tension: pulsing low ostinato.
    if (inBar % 2 === 0)
      this.pluck(ROOT - 12 + prog('tension')[0]!, time, dur * 1.6, this.layers.tension, 0.08);
    if (inBar % 4 === 2) this.pluck(ROOT + prog('tension')[2]!, time, dur, this.layers.tension, 0.04);
    // War: drums + driving bass.
    if (inBar % 4 === 0) this.kick(time, this.layers.war, 0.5);
    if (inBar % 8 === 4) this.snare(time, this.layers.war, 0.22);
    if (inBar % 2 === 1) this.hat(time, this.layers.war, 0.06);
    this.pluck(
      ROOT - 24 + prog('war')[inBar % 8 < 4 ? 0 : 1]!,
      time,
      dur * 0.9,
      this.layers.war,
      0.09,
      'sawtooth',
    );
  }

  private pad(
    notes: number[],
    time: number,
    dur: number,
    out: AudioNode,
    vol: number,
    type: OscillatorType,
    cutoff: number,
  ): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + dur * 0.25);
    g.gain.linearRampToValueAtTime(vol * 0.8, time + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, time + dur * 1.05);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.6;
    g.connect(f).connect(out);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(ROOT + n);
        o.detune.value = det;
        o.connect(g);
        o.start(time);
        o.stop(time + dur * 1.1);
      }
    }
  }

  private bell(note: number, time: number, dur: number, out: AudioNode, vol: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    g.connect(out);
    for (const [ratio, amp] of [
      [1, 1],
      [2.01, 0.35],
      [3.98, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(note) * ratio;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(time);
      o.stop(time + dur);
    }
  }

  private pluck(
    note: number,
    time: number,
    dur: number,
    out: AudioNode,
    vol: number,
    type: OscillatorType = 'triangle',
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, time);
    f.frequency.exponentialRampToValueAtTime(300, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f).connect(g).connect(out);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  private kick(time: number, out: AudioNode, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, time);
    o.frequency.exponentialRampToValueAtTime(40, time + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
    o.connect(g).connect(out);
    o.start(time);
    o.stop(time + 0.32);
  }

  private noiseHit(
    time: number,
    out: AudioNode,
    vol: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f).connect(g).connect(out);
    src.start(time, Math.random() * 1.5);
    src.stop(time + dur + 0.05);
  }

  private snare(time: number, out: AudioNode, vol: number): void {
    this.noiseHit(time, out, vol, 0.18, 'bandpass', 1800, 0.8);
  }

  private hat(time: number, out: AudioNode, vol: number): void {
    this.noiseHit(time, out, vol, 0.05, 'highpass', 7000);
  }

  private theme(kind: 'victory' | 'defeat'): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const seq = kind === 'victory' ? [0, 4, 7, 12, 16, 19, 24] : [12, 10, 7, 3, 2, 0, -5];
    seq.forEach((n, k) =>
      this.bell(ROOT + 12 + n, t + k * (kind === 'victory' ? 0.18 : 0.32), 2.4, this.musicBus, 0.09),
    );
    this.pad(
      kind === 'victory' ? [0, 4, 7, 12] : [0, 3, 7, 10],
      t + seq.length * 0.2,
      5,
      this.musicBus,
      0.06,
      'triangle',
      1400,
    );
    for (const g of Object.values(this.layers)) g.gain.setTargetAtTime(0, t, 0.5);
  }

  // --------------------------------------------------------------- sfx
  sfx(name: Sfx, vol = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const last = this.lastSfx.get(name) ?? 0;
    if (now - last < (name === 'train' || name === 'conquest' ? 400 : 60)) return;
    this.lastSfx.set(name, now);
    const t = ctx.currentTime + 0.01;
    const out = this.sfxBus;
    switch (name) {
      case 'conquest':
        this.pluck(ROOT + 24 + [0, 3, 7][Math.floor(Math.random() * 3)]!, t, 0.25, out, 0.05 * vol);
        break;
      case 'build':
        this.noiseHit(t, out, 0.25 * vol, 0.08, 'bandpass', 900, 3);
        this.noiseHit(t + 0.11, out, 0.2 * vol, 0.08, 'bandpass', 1300, 3);
        this.bell(ROOT + 31, t + 0.2, 0.6, out, 0.04 * vol);
        break;
      case 'siren': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.9;
        const lg = ctx.createGain();
        lg.gain.value = 180;
        lfo.connect(lg).connect(o.frequency);
        o.frequency.value = 560;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.2);
        g.gain.linearRampToValueAtTime(0, t + 2.6);
        o.connect(f).connect(g).connect(out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 2.7);
        lfo.stop(t + 2.7);
        break;
      }
      case 'launch': {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(2600, t + 1.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        src.connect(f).connect(g).connect(out);
        src.start(t);
        src.stop(t + 1.7);
        break;
      }
      case 'explosionA':
      case 'explosionH':
      case 'explosionMirv': {
        const big = name === 'explosionH' ? 1.6 : name === 'explosionMirv' ? 0.8 : 1;
        this.kick(t, out, 0.9 * vol);
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(3000, t);
        f.frequency.exponentialRampToValueAtTime(120, t + 2.5 * big);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.7 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3 * big);
        src.connect(f).connect(g).connect(out);
        src.start(t);
        src.stop(t + 3.2 * big);
        const sub = ctx.createOscillator();
        sub.frequency.setValueAtTime(55, t);
        sub.frequency.exponentialRampToValueAtTime(25, t + 2 * big);
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.6 * vol, t);
        sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 * big);
        sub.connect(sg).connect(out);
        sub.start(t);
        sub.stop(t + 2.3 * big);
        break;
      }
      case 'blast':
        this.kick(t, out, 0.4 * vol);
        this.noiseHit(t, out, 0.3 * vol, 0.5, 'lowpass', 900);
        break;
      case 'intercept': {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(2400, t);
        o.frequency.exponentialRampToValueAtTime(300, t + 0.35);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.42);
        this.noiseHit(t + 0.3, out, 0.3 * vol, 0.4, 'lowpass', 1500);
        break;
      }
      case 'cannon':
        this.noiseHit(t, out, 0.3 * vol, 0.25, 'lowpass', 600);
        break;
      case 'sunk':
        this.kick(t, out, 0.3 * vol);
        for (let k = 0; k < 4; k++) this.bell(ROOT - 12 + k * 3, t + 0.1 + k * 0.08, 0.25, out, 0.02 * vol);
        break;
      case 'coin':
        for (let k = 0; k < 3; k++) this.bell(ROOT + 24 + k * 5, t + k * 0.05, 0.18, out, 0.03 * vol);
        break;
      case 'train':
        for (let k = 0; k < 4; k++)
          this.noiseHit(t + k * 0.12, out, 0.08 * vol, 0.06, 'bandpass', 500 + (k % 2) * 200, 2);
        break;
      case 'alliance':
        [0, 4, 7, 12].forEach((n, k) => this.bell(ROOT + 12 + n, t + k * 0.06, 1.4, out, 0.05 * vol));
        break;
      case 'betrayal':
        this.pad([0, 1, 6], t, 1.2, out, 0.08 * vol, 'sawtooth', 2000);
        break;
      case 'event':
        this.bell(ROOT - 12, t, 3.5, out, 0.12 * vol);
        this.bell(ROOT - 5, t + 0.02, 3, out, 0.06 * vol);
        break;
      case 'victory':
        this.theme('victory');
        break;
      case 'defeat':
        this.theme('defeat');
        break;
    }
  }

  ui(name: UiSound): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const out = this.uiBus;
    const blip = (freq: number, dur: number, vol: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    switch (name) {
      case 'click':
        blip(880, 0.05, 0.06);
        break;
      case 'hover':
        blip(1320, 0.03, 0.02);
        break;
      case 'confirm':
        blip(660, 0.07, 0.06);
        setTimeout(() => this.ui('click'), 60);
        break;
      case 'error':
        blip(150, 0.18, 0.08, 'square');
        break;
      case 'open':
        blip(520, 0.09, 0.04, 'triangle');
        break;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
