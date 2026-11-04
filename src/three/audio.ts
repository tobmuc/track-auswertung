/**
 * Soundtrack for the flight video, rendered offline so preview and MP4 sound the same:
 *  - vario tones from the climb rate, modelled on common vario tone schemes (beeps rising in pitch
 *    and rate with climb, a continuous low tone in strong sink, silence in between)
 *  - generated background music in a few styles: composed here, so free of third-party rights (GEMA-free)
 *  - or the user's own audio file
 */
import type { Plan } from './director';
import { lerpAt, type Model } from './model';

export type MusicStyle = 'none' | 'ambient' | 'cinematic' | 'chill' | 'synthwave' | 'lofi' | 'house' | 'dnb' | 'file';

export interface SoundOptions {
  music: MusicStyle;
  musicVolume: number;
  vario: boolean;
  varioVolume: number;
  /** climb rate (m/s) from which the vario beeps */
  climbThreshold: number;
  /** sink rate (m/s, negative) below which the sink tone sounds */
  sinkThreshold: number;
  /** short rising chime at the moment of launch */
  startPing: boolean;
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

/** Snare: band-passed noise burst plus a short tonal body */
function snare(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, level: number, tone = 1800, decay = 0.18) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = tone;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  s.connect(bp).connect(g).connect(out);
  s.start(t0, (t0 * 3.17) % 0.5, decay + 0.02);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, t0);
  o.frequency.exponentialRampToValueAtTime(150, t0 + 0.08);
  const og = ctx.createGain();
  og.gain.setValueAtTime(level * 0.6, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
  o.connect(og).connect(out);
  o.start(t0);
  o.stop(t0 + 0.12);
}

/** Clap: three quick noise bursts and a short tail */
function clap(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, level: number) {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1200;
  bp.Q.value = 1.2;
  bp.connect(out);
  [0, 0.011, 0.023].forEach((dt, k) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const g = ctx.createGain();
    const t = t0 + dt;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (k === 2 ? 0.16 : 0.012));
    s.connect(g).connect(bp);
    s.start(t, ((t0 + dt) * 5.71) % 0.5, 0.2);
  });
}

/** Synth note: oscillator through a lowpass whose cutoff opens and closes with each note */
function synth(ctx: BaseAudioContext, out: AudioNode, note: number, t0: number, dur: number, level: number, cutoff: number, type: OscillatorType = 'sawtooth', detune = 0) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(cutoff * 3, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff), t0 + Math.min(dur, 0.25));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + 0.006);
  g.gain.setValueAtTime(level, t0 + dur * 0.8);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  lp.connect(g).connect(out);
  for (const d of detune ? [-detune, detune] : [0]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midi(note);
    o.detune.value = d;
    o.connect(lp);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
}

/** Sidechain feel: the bus ducks on every kick and swells back within the beat */
function duck(g: GainNode, kicks: number[], beat: number, depth: number) {
  for (const t of kicks) {
    g.gain.setValueAtTime(1 - depth, t);
    g.gain.linearRampToValueAtTime(1, t + beat * 0.7);
  }
}

/** Vinyl crackle: sparse clicks plus low hiss, for the lo-fi style */
function crackle(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, dur: number) {
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2500;
  const hg = ctx.createGain();
  hg.gain.value = 0.012;
  hiss.connect(lp).connect(hg).connect(out);
  hiss.start(0);
  hiss.stop(dur + 3);
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < dur; t += 0.05 + rnd() * 0.35) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03 + 0.05 * rnd(), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.004);
    s.connect(g).connect(out);
    s.start(t, rnd() * 0.9, 0.01);
  }
}

/** Composes background music of the given style into `out`; deterministic per style */
/** Output level per style, so all of them sound about equally loud (measured RMS ≈ 0.035 at volume 0.6) */
const STYLE_LEVEL: Partial<Record<MusicStyle, number>> = { synthwave: 0.55, house: 0.65, dnb: 0.38 };

function compose(ctx: BaseAudioContext, out: AudioNode, style: Exclude<MusicStyle, 'none' | 'file'>, dur: number) {
  const level = ctx.createGain();
  level.gain.value = STYLE_LEVEL[style] ?? 1;
  level.connect(out);
  out = level;
  const dry = style === 'chill' || style === 'lofi' || style === 'house';
  const wet = reverb(ctx, dry ? 1.8 : style === 'synthwave' ? 2.8 : 3.8);
  const wetGain = ctx.createGain();
  wetGain.gain.value = dry ? 0.25 : style === 'dnb' || style === 'synthwave' ? 0.4 : 0.55;
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
  } else if (style === 'synthwave') {
    // 100 bpm, A minor – F – C – G: saw pads, 16th arpeggio opening up over the flight,
    // driving eighth bass, big snare on 2 and 4; drums enter after two bars
    const beat = 60 / 100;
    const noise = noiseBuffer(ctx);
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    for (let bar = 0, t = 0; t < dur; bar++, t += beat * 4) {
      const ch = chords[bar % chords.length];
      const u = t / dur;
      pad(ctx, bus, ch.map((n) => n + 12), t, beat * 4, 0.035, 1600 + 1400 * u);
      for (let e = 0; e < 16; e++) {
        synth(ctx, bus, ch[e % 3] + (e % 6 < 3 ? 24 : 12), t + (e * beat) / 4, beat / 4.5, 0.035, 900 + 2200 * u, 'square');
      }
      for (let e = 0; e < 8; e++) synth(ctx, bus, ch[0] - 12, t + (e * beat) / 2, beat / 2.2, 0.12, 300 + 200 * u, 'sawtooth', 8);
      if (bar < 2) continue;
      for (let b = 0; b < 4; b++) {
        kick(ctx, bus, t + b * beat, 0.5);
        hat(ctx, bus, noise, t + b * beat + beat / 2, 0.06);
      }
      snare(ctx, wet, noise, t + beat, 0.35, 1500, 0.25);
      snare(ctx, wet, noise, t + 3 * beat, 0.35, 1500, 0.25);
      snare(ctx, bus, noise, t + beat, 0.2);
      snare(ctx, bus, noise, t + 3 * beat, 0.2);
    }
  } else if (style === 'lofi') {
    // 74 bpm lo-fi hip-hop: jazzy ninth chords on a wobbly e-piano, swung hats, boom-bap drums,
    // everything dulled through a lowpass, vinyl crackle on top
    const beat = 60 / 74;
    const swing = beat * 0.16;
    const noise = noiseBuffer(ctx);
    const dull = ctx.createBiquadFilter();
    dull.type = 'lowpass';
    dull.frequency.value = 3200;
    dull.connect(bus);
    crackle(ctx, out, noise, dur);
    // Dm9 – G13 – Cmaj9 – A7(b9)
    const chords = [[50, 53, 57, 60, 64], [43, 53, 59, 64, 65], [48, 52, 55, 59, 62], [45, 55, 58, 61, 64]];
    for (let bar = 0, t = 0; t < dur; bar++, t += beat * 4) {
      const ch = chords[bar % chords.length];
      ch.slice(1).forEach((nn, k) => pluck(ctx, dull, nn, t + k * 0.018, 0.045, beat * 3.2));
      pluck(ctx, dull, ch[1] + 12, t + beat * 2.5 + swing, 0.03, beat);
      pluck(ctx, dull, ch[0] - 12, t, 0.25, beat * 1.8);
      pluck(ctx, dull, ch[0] - 12, t + beat * 2.5 + swing, 0.18, beat);
      if (bar < 1) continue;
      kick(ctx, dull, t, 0.55);
      kick(ctx, dull, t + beat * 1.5 + swing, 0.35);
      kick(ctx, dull, t + beat * 2.5 + swing, 0.45);
      snare(ctx, dull, noise, t + beat, 0.22, 1400, 0.16);
      snare(ctx, dull, noise, t + beat * 3, 0.22, 1400, 0.16);
      for (let e = 0; e < 8; e++) hat(ctx, dull, noise, t + (e * beat) / 2 + (e % 2 ? swing : 0), e % 2 ? 0.035 : 0.06);
    }
  } else if (style === 'house') {
    // 122 bpm deep house: four-on-the-floor, offbeat open hats, clap on 2 and 4,
    // minor-seventh stabs on the offbeats that duck under the kick, rolling offbeat bass
    const beat = 60 / 122;
    const noise = noiseBuffer(ctx);
    const pump = ctx.createGain();
    pump.connect(bus);
    const kicks: number[] = [];
    // Am7 – Dm7 – Fmaj7 – Em7, two bars each
    const chords = [[57, 60, 64, 67], [50, 53, 57, 60], [53, 57, 60, 64], [52, 55, 59, 62]];
    for (let bar = 0, t = 0; t < dur; bar++, t += beat * 4) {
      const ch = chords[Math.floor(bar / 2) % chords.length];
      const u = t / dur;
      pad(ctx, pump, ch, t, beat * 4, 0.025, 900 + 900 * u);
      for (let b = 0; b < 4; b++) {
        const off = t + b * beat + beat / 2;
        for (const nn of ch) synth(ctx, pump, nn + 12, off, beat * 0.3, 0.022, 1200 + 1800 * u, 'sawtooth');
        synth(ctx, pump, ch[0] - 24 + (b === 3 ? 7 : 0), off, beat * 0.4, 0.2, 260, 'sawtooth');
      }
      if (bar < 2) continue;
      for (let b = 0; b < 4; b++) {
        kick(ctx, bus, t + b * beat, 0.6);
        kicks.push(t + b * beat);
        hat(ctx, bus, noise, t + b * beat + beat / 2, 0.09);
        for (const q of [0.25, 0.75]) hat(ctx, bus, noise, t + (b + q) * beat, 0.025);
      }
      clap(ctx, bus, noise, t + beat, 0.25);
      clap(ctx, bus, noise, t + 3 * beat, 0.25);
    }
    duck(pump, kicks, beat, 0.6);
  } else if (style === 'dnb') {
    // 172 bpm liquid drum & bass: two-step break, rolling sixteenth hats, deep sub bass,
    // airy pads and bright piano notes over a half-time harmony
    const beat = 60 / 172;
    const noise = noiseBuffer(ctx);
    // Fmaj7 – Em7 – Dm9 – Cmaj7, two bars each
    const chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 64], [48, 52, 55, 59]];
    for (let bar = 0, t = 0; t < dur; bar++, t += beat * 4) {
      const ch = chords[Math.floor(bar / 2) % chords.length];
      if (bar % 2 === 0) {
        pad(ctx, bus, ch.map((n) => n + 12), t, beat * 8, 0.03, 2200);
        synth(ctx, bus, ch[0] - 24, t, beat * 7.6, 0.22, 140, 'sine');
      }
      for (const [k, at] of [[0, 0], [2, 1.5], [3, 3]] as const) pluck(ctx, bus, ch[k] + 24, t + at * beat, 0.04, 1.4);
      if (bar < 4) {
        for (let e = 0; e < 8; e++) hat(ctx, bus, noise, t + (e * beat) / 2, 0.03);
        continue;
      }
      kick(ctx, bus, t, 0.55);
      kick(ctx, bus, t + beat * 2.5, 0.45);
      snare(ctx, bus, noise, t + beat, 0.3, 1900, 0.15);
      snare(ctx, bus, noise, t + beat * 3, 0.3, 1900, 0.15);
      snare(ctx, bus, noise, t + beat * 3.75, 0.08, 2200, 0.08);
      for (let e = 0; e < 16; e++) hat(ctx, bus, noise, t + (e * beat) / 4, e % 4 === 2 ? 0.07 : 0.035);
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

/**
 * Launch chime: three quick rising pings (a major triad going up an octave) with a soft bell tail,
 * the classic "you are airborne" signal of flight instruments. Our own composition.
 */
function startPing(ctx: BaseAudioContext, out: AudioNode, t0: number, level: number) {
  const notes = [84, 88, 91, 96]; // C6 E6 G6 C7
  notes.forEach((n, k) => {
    const t = t0 + k * 0.09;
    const g = ctx.createGain();
    g.connect(out);
    const peak = level * (k === notes.length - 1 ? 1 : 0.75);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (k === notes.length - 1 ? 0.9 : 0.16));
    // bell-like: fundamental plus a slightly inharmonic overtone
    for (const [mult, lv] of [[1, 1], [2.76, 0.18]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = midi(n) * mult;
      const og = ctx.createGain();
      og.gain.value = lv;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1);
    }
  });
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

  if (o.startPing) {
    // first video frame at which the pilot is airborne
    const f = plan.frames.findIndex((fr) => fr.phase === 'play' && fr.fi >= m.launchIdx);
    if (f >= 0) startPing(ctx, master, f / plan.fps, Math.min(0.5, 0.2 + 0.4 * o.varioVolume));
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
