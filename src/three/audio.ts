/**
 * Soundtrack for the flight video, rendered offline so preview and MP4 sound the same:
 *  - vario tones from the climb rate, modelled on common vario tone schemes (beeps rising in pitch
 *    and rate with climb, a continuous low tone in strong sink, silence in between)
 *  - generated background music in a few styles: composed here, so free of third-party rights (GEMA-free)
 *  - or the user's own audio file
 */
import type { Plan } from './director';
import { lerpAt, type Model } from './model';

export type MusicStyle = 'none' | 'ambient' | 'cinematic' | 'chill' | 'file';

export interface SoundOptions {
  music: MusicStyle;
  musicVolume: number;
  vario: boolean;
  varioVolume: number;
  /** climb rate (m/s) from which the vario beeps */
  climbThreshold: number;
  /** sink rate (m/s, negative) below which the sink tone sounds */
  sinkThreshold: number;
  /** decoded own audio file, for music = 'file' */
  file?: AudioBuffer | null;
}

const RATE = 48000;

/** Vario frequency and beep rate for a climb rate (m/s) */
export function varioTone(v: number, o: Pick<SoundOptions, 'climbThreshold' | 'sinkThreshold'>): { hz: number; beepsPerS: number } | null {
  if (v >= o.climbThreshold) {
    const c = Math.min(v, 8);
    return { hz: 580 + 165 * c, beepsPerS: Math.min(9, 1.6 + 1.25 * c) };
  }
  if (v <= o.sinkThreshold) {
    const s = Math.max(v, -10);
    return { hz: Math.max(160, 360 + 22 * s), beepsPerS: 0 };
  }
  return null;
}

/** Vario samples (mono) for the whole plan */
function varioSamples(m: Model, plan: Plan, o: SoundOptions): Float32Array<ArrayBuffer> {
  const n = Math.ceil((plan.frames.length / plan.fps) * RATE);
  const out = new Float32Array(n);
  const vario = m.res.timeline.vario;
  const spf = RATE / plan.fps;
  let vs = 0; // smoothed climb rate
  let phase = 0; // oscillator phase (cycles)
  let beep = 0; // beep cycle phase
  let env = 0;
  const kSmooth = 1 - Math.exp(-1 / (0.12 * RATE));
  const attack = 1 / (0.004 * RATE);
  const release = 1 / (0.01 * RATE);
  for (let i = 0; i < n; i++) {
    const f = Math.min(plan.frames.length - 1, i / spf);
    const fr = plan.frames[Math.floor(f)];
    const k = Math.round(fr.fi);
    const active = fr.phase === 'play' && !m.isHike[k];
    const v = active ? lerpAt(vario, fr.fi) : 0;
    vs += (v - vs) * kSmooth;
    const tone = active ? varioTone(vs, o) : null;
    let gate = 0;
    let hz = 600;
    if (tone) {
      hz = tone.hz;
      if (tone.beepsPerS > 0) {
        beep += tone.beepsPerS / RATE;
        const p = beep % 1;
        // shorter beeps in strong lift, as on most varios
        gate = p < (vs > 3 ? 0.42 : 0.5) ? 1 : 0;
        hz *= 1 + 0.04 * p; // slight chirp within the beep
      } else {
        gate = 1;
        hz *= 1 + 0.015 * Math.sin((2 * Math.PI * i) / (RATE * 0.9)); // sink tone wobbles a little
      }
    }
    env += gate > env ? Math.min(gate - env, attack) : -Math.min(env - gate, release);
    phase += hz / RATE;
    const ph = 2 * Math.PI * phase;
    // beeper timbre: sine plus a little odd harmonic
    out[i] = env * (Math.sin(ph) + 0.22 * Math.sin(3 * ph) + 0.08 * Math.sin(5 * ph)) * 0.55;
  }
  return out;
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** Simple decaying-noise impulse response for a soft hall */
function reverb(ctx: BaseAudioContext, seconds: number): ConvolverNode {
  const len = Math.floor(seconds * ctx.sampleRate);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = rnd() * (1 - i / len) ** 3;
  }
  const c = ctx.createConvolver();
  c.buffer = ir;
  return c;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 777;
  for (let i = 0; i < d.length; i++) d[i] = ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return b;
}

/** Soft pad: detuned saws through a lowpass, slow attack and release */
function pad(ctx: BaseAudioContext, out: AudioNode, notes: number[], t0: number, dur: number, level: number, cutoff: number) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  lp.Q.value = 0.4;
  g.connect(lp).connect(out);
  const a = Math.min(2.5, dur * 0.35);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + a);
  g.gain.setValueAtTime(level, t0 + dur - 0.2);
  g.gain.linearRampToValueAtTime(0, t0 + dur + 2.5);
  for (const n of notes) {
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 2.6);
    }
  }
}

/** Plucked / e-piano like note: sine with a quickly decaying octave */
function pluck(ctx: BaseAudioContext, out: AudioNode, note: number, t0: number, level: number, decay = 1.2, type: OscillatorType = 'sine') {
  const g = ctx.createGain();
  g.connect(out);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  for (const [mult, lv] of [[1, 1], [2, 0.35], [3, 0.12]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midi(note) * mult;
    const og = ctx.createGain();
    og.gain.value = lv;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }
}

function kick(ctx: BaseAudioContext, out: AudioNode, t0: number, level: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(110, t0);
  o.frequency.exponentialRampToValueAtTime(42, t0 + 0.18);
  g.gain.setValueAtTime(level, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + 0.4);
}

function hat(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, level: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  s.connect(hp).connect(g).connect(out);
  // fixed offset into the noise keeps the rendering deterministic
  s.start(t0, (t0 * 7.31) % 0.5, 0.08);
}

/** Composes background music of the given style into `out`; deterministic per style */
function compose(ctx: BaseAudioContext, out: AudioNode, style: Exclude<MusicStyle, 'none' | 'file'>, dur: number) {
  const wet = reverb(ctx, style === 'chill' ? 1.8 : 3.8);
  const wetGain = ctx.createGain();
  wetGain.gain.value = style === 'chill' ? 0.25 : 0.55;
  wet.connect(wetGain).connect(out);
  const bus = ctx.createGain();
  bus.connect(out);
  bus.connect(wet);

  if (style === 'ambient') {
    // A minor – F – C – G, open voicings, 8 s per chord, sparse high bells
    const chords = [[57, 64, 71, 72], [53, 60, 67, 69], [48, 55, 64, 67], [55, 62, 66, 71]];
    const len = 8;
    for (let t = 0, k = 0; t < dur; t += len, k++) {
      const ch = chords[k % chords.length];
      pad(ctx, bus, ch, t, len, 0.05, 1100);
      pad(ctx, bus, [ch[0] - 12], t, len, 0.06, 300);
      for (let b = 0; b < 3; b++) pluck(ctx, bus, ch[(k + b) % ch.length] + 12, t + 1.5 + b * 2.2, 0.05, 3, 'sine');
    }
  } else if (style === 'cinematic') {
    // D minor – Bb – F – C, 6 s per chord, low drone, pulsing eighths, hits on chord changes
    const chords = [[50, 57, 62, 65], [46, 53, 58, 62], [53, 57, 60, 65], [48, 55, 60, 64]];
    const len = 6;
    const bpm = 100;
    const eighth = 30 / bpm;
    pad(ctx, bus, [38], 0, dur, 0.07, 220);
    for (let t = 0, k = 0; t < dur; t += len, k++) {
      const ch = chords[k % chords.length];
      pad(ctx, bus, ch, t, len, 0.045 * Math.min(1.6, 1 + t / dur), 1400 + 1200 * (t / dur));
      pluck(ctx, bus, ch[0] - 24, t, 0.35, 1.8, 'sine');
      for (let e = t; e < Math.min(dur, t + len); e += eighth) {
        pluck(ctx, bus, ch[Math.round((e - t) / eighth) % 2 === 0 ? 0 : 1] + 12, e, 0.06, 0.28, 'triangle');
      }
    }
  } else {
    // chill: 84 bpm, e-piano chords, bass, soft kick and hats
    const bpm = 84;
    const beat = 60 / bpm;
    const noise = noiseBuffer(ctx);
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]];
    for (let bar = 0, t = 0; t < dur; bar++, t += beat * 4) {
      const ch = chords[bar % chords.length];
      for (const at of [0, 2.5]) for (const nn of ch) pluck(ctx, bus, nn, t + at * beat, 0.05, 1.6);
      pluck(ctx, bus, ch[0] - 24, t, 0.22, beat * 2, 'sine');
      pluck(ctx, bus, ch[0] - 24, t + 2 * beat, 0.18, beat * 1.5, 'sine');
      kick(ctx, bus, t, 0.5);
      kick(ctx, bus, t + 2 * beat, 0.4);
      for (let e = 0; e < 8; e++) hat(ctx, bus, noise, t + (e * beat) / 2, e % 2 ? 0.05 : 0.08);
    }
  }
}

/** Renders the complete soundtrack for the plan (stereo, 48 kHz) */
export async function renderSoundtrack(m: Model, plan: Plan, o: SoundOptions): Promise<AudioBuffer> {
  const dur = plan.frames.length / plan.fps;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * RATE), RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);

  // music bus with fade in/out
  const music = ctx.createGain();
  music.gain.setValueAtTime(0, 0);
  music.gain.linearRampToValueAtTime(o.musicVolume, 1.5);
  music.gain.setValueAtTime(o.musicVolume, Math.max(1.5, dur - 3));
  music.gain.linearRampToValueAtTime(0, dur);
  music.connect(master);
  if (o.music === 'file' && o.file) {
    const s = ctx.createBufferSource();
    s.buffer = o.file;
    s.loop = o.file.duration < dur;
    s.connect(music);
    s.start(0);
  } else if (o.music !== 'none' && o.music !== 'file') {
    compose(ctx, music, o.music, dur);
  }

  if (o.vario) {
    const samples = varioSamples(m, plan, o);
    const buf = ctx.createBuffer(1, samples.length, RATE);
    buf.copyToChannel(samples, 0);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = o.varioVolume;
    s.connect(g).connect(master);
    s.start(0);
  }
  return ctx.startRendering();
}

/** Decodes a user audio file (mp3, wav, ogg, m4a …) */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, RATE, RATE);
  return ctx.decodeAudioData(await file.arrayBuffer());
}

/** Plays a rendered soundtrack from an offset (preview) */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  play(buf: AudioBuffer, offsetS: number) {
    this.stop();
    this.ctx ??= new AudioContext({ sampleRate: RATE });
    void this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.ctx.destination);
    s.start(0, Math.max(0, Math.min(buf.duration - 0.01, offsetS)));
    this.src = s;
  }
  stop() {
    try {
      this.src?.stop();
    } catch {
      /* already stopped */
    }
    this.src = null;
  }
  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
