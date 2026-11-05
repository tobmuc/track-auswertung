import { compass } from '../core/geo';
import { clock, dur, num, SCORE_LABEL } from '../app/format';
import { locale, t as tr } from '../app/i18n';
import { bestGlide, maxWind, thermalGain } from '../app/summary';
import type { Frame, Plan } from './director';
import { lerpAt, windAt, type Model } from './model';
import { companionFi, type Companion } from './companions';
import { irradiance, sunPosition, sunTime, sunVector, type SunSettings } from './sun';

export interface HudOptions {
  title: string;
  enabled: boolean;
  decisions: boolean;
  profile: boolean;
  /** opacity of the dark panels behind the overlays, 0..1 */
  panelOpacity: number;
  /** sun panel (position, irradiance on the slope below) when sun.info is set */
  sun?: SunSettings;
  /** cloud base m MSL at a main-flight time */
  cloudBase?: ((t: number) => number) | null;
  /** further pilots, listed with colour and altitude */
  companions?: Companion[];
}

const ACCENT = '#ff8a3d';

/** set per frame from HudOptions.panelOpacity */
let panelAlpha = 0.72;

function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.fillStyle = `rgba(13,17,23,${panelAlpha})`;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function varioCss(v: number) {
  return v > 0.3 ? '#9ccc65' : v < -1.5 ? '#64b5f6' : '#ffffff';
}

/** Cached small altitude profile for the bottom strip */
const profileCache = new WeakMap<Model, { w: number; h: number; img: OffscreenCanvas }>();
function profileImage(m: Model, w: number, h: number): OffscreenCanvas {
  const c = profileCache.get(m);
  if (c && c.w === w && c.h === h) return c.img;
  const img = new OffscreenCanvas(w, h);
  const g = img.getContext('2d')!;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.n; i++) { lo = Math.min(lo, m.ground[i], m.alt[i]); hi = Math.max(hi, m.alt[i]); }
  const t = m.res.timeline.t;
  const X = (i: number) => ((t[i] - t[0]) / (t[m.n - 1] - t[0])) * w;
  const Y = (a: number) => h - ((a - lo) / (hi - lo)) * h * 0.92;
  g.fillStyle = 'rgba(120,100,80,.55)';
  g.beginPath();
  g.moveTo(0, h);
  for (let i = 0; i < m.n; i += 4) g.lineTo(X(i), Y(m.ground[i]));
  g.lineTo(w, h);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.9)';
  g.lineWidth = Math.max(1, h / 40);
  g.beginPath();
  for (let i = 0; i < m.n; i += 2) (i ? g.lineTo(X(i), Y(m.alt[i])) : g.moveTo(X(i), Y(m.alt[i])));
  g.stroke();
  profileCache.set(m, { w, h, img });
  return img;
}

/** 0..1 with soft start and end */
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export function drawHud(g: CanvasRenderingContext2D, W: number, H: number, m: Model, plan: Plan, frameNo: number, o: HudOptions) {
  if (!o.enabled) return;
  panelAlpha = o.panelOpacity;
  const fr: Frame = plan.frames[frameNo];
  const S = Math.min(W, H) / 1080; // scale relative to 1080p short side
  const pad = 40 * S;
  const tz = m.res.timeZone;
  const tl = m.res.timeline;
  const fi = fr.fi;
  const i = Math.round(fi);
  const t = lerpAt(tl.t, fi);
  g.save();
  g.textBaseline = 'alphabetic';

  // --- title (top left)
  const titleAlpha = fr.phase === 'intro' ? 1 : fr.phase === 'outro' ? 0 : Math.max(0.0, 1 - (frameNo - plan.frames.findIndex((f) => f.phase === 'play')) / (plan.fps * 3));
  if (titleAlpha > 0) {
    g.globalAlpha = titleAlpha;
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 12 * S;
    g.font = `800 ${64 * S}px system-ui, sans-serif`;
    g.fillText(o.title, pad, pad + 60 * S, W - pad * 2);
    g.font = `500 ${30 * S}px system-ui, sans-serif`;
    g.fillStyle = ACCENT;
    g.fillText(new Intl.DateTimeFormat(locale(), { dateStyle: 'long', timeZone: tz }).format(tl.t[0]), pad, pad + 105 * S);
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }

  if (fr.phase === 'play') {
    const hike = !!m.isHike[i];
    const alt = lerpAt(m.alt, fi);
    const agl = lerpAt(m.agl, fi);
    const vario = lerpAt(tl.vario, fi);
    const speed = lerpAt(tl.speed, fi);

    // --- data bar (bottom)
    const items: [string, string, string?][] = [
      [tr('Zeit'), clock(t, tz)],
      [tr('Höhe'), `${num(alt)} m`],
      hike ? [tr('Steigen'), `${vario >= 0 ? '+' : '−'}${num(Math.abs(vario * 3600))} m/h`] : [tr('Vario'), `${vario >= 0 ? '+' : '−'}${num(Math.abs(vario), 1)} m/s`, varioCss(vario)],
      hike ? [tr('Speed'), `${num(speed, 1)} km/h`] : [tr('Über Grund'), `${num(agl)} m`, agl < 150 ? '#ff6b5e' : undefined],
      // while turning, the speed cell shows the bank angle the glider model is flying with
      Math.abs(lerpAt(m.bank, fi)) >= 0.14 && !hike
        ? [tr('Querlage'), `${num(Math.abs(lerpAt(m.bank, fi)) * (180 / Math.PI))}° ${lerpAt(m.bank, fi) > 0 ? tr('rechts') : tr('links')}`]
        : [tr('Speed'), `${num(speed)} km/h`],
      [tr('Strecke'), `${num(lerpAt(m.dist, fi), 1)} km`],
    ];
    const shown = hike ? items.filter((_, k) => k !== 4) : items;
    const cols = W > H ? shown.length : 3;
    const rows = Math.ceil(shown.length / cols);
    const profH = o.profile ? 90 * S : 0;
    const cellW = (W - pad * 2) / cols;
    const cellH = 86 * S;
    const barH = rows * cellH + profH + 24 * S;
    const barY = H - pad - barH;
    panel(g, pad, barY, W - pad * 2, barH, 18 * S);
    shown.forEach(([label, value, color], k) => {
      const cx = pad + (k % cols) * cellW + 22 * S;
      const cy = barY + Math.floor(k / cols) * cellH + 14 * S;
      g.fillStyle = '#8b98a8';
      g.font = `600 ${20 * S}px system-ui, sans-serif`;
      g.fillText(label.toUpperCase(), cx, cy + 22 * S);
      g.fillStyle = color ?? '#fff';
      g.font = `700 ${40 * S}px system-ui, sans-serif`;
      g.fillText(value, cx, cy + 66 * S);
    });
    if (o.profile) {
      const px = pad + 20 * S;
      const pw = W - pad * 2 - 40 * S;
      const py = barY + rows * cellH + 14 * S;
      g.drawImage(profileImage(m, Math.round(pw), Math.round(profH - 10 * S)), px, py);
      const x = px + ((t - tl.t[0]) / (tl.t[m.n - 1] - tl.t[0])) * pw;
      g.fillStyle = ACCENT;
      g.fillRect(x - 1.5 * S, py, 3 * S, profH - 10 * S);
    }

    // --- wind rose (top right)
    const w = windAt(m, t);
    if (w && !hike) {
      const r = 62 * S;
      const cx = W - pad - r;
      const cy = pad + r + 10 * S;
      panel(g, cx - r - 14 * S, cy - r - 14 * S, r * 2 + 28 * S, r * 2 + 74 * S, 18 * S);
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 2 * S;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#8b98a8';
      g.font = `700 ${18 * S}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText('N', cx, cy - r + 22 * S);
      // arrow shows where the wind blows to
      const a = ((w.fromDeg + 180) % 360) * (Math.PI / 180);
      const dx = Math.sin(a), dy = -Math.cos(a);
      g.strokeStyle = '#4fc3f7';
      g.fillStyle = '#4fc3f7';
      g.lineWidth = 6 * S;
      g.beginPath(); g.moveTo(cx - dx * r * 0.65, cy - dy * r * 0.65); g.lineTo(cx + dx * r * 0.45, cy + dy * r * 0.45); g.stroke();
      g.beginPath();
      g.moveTo(cx + dx * r * 0.75, cy + dy * r * 0.75);
      g.lineTo(cx + dx * r * 0.35 - dy * r * 0.25, cy + dy * r * 0.35 + dx * r * 0.25);
      g.lineTo(cx + dx * r * 0.35 + dy * r * 0.25, cy + dy * r * 0.35 - dx * r * 0.25);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `700 ${24 * S}px system-ui, sans-serif`;
      g.fillText(`${compass(w.fromDeg)} ${num(w.speedKmh)} km/h`, cx, cy + r + 32 * S);
      g.fillStyle = '#8b98a8';
      g.font = `500 ${18 * S}px system-ui, sans-serif`;
      g.fillText(`${tr('auf')} ${num(w.alt)} m`, cx, cy + r + 54 * S);
      g.textAlign = 'left';
    }

    // --- sun and cloud base (bottom right, just above the data bar: at the top it covered the glider)
    if (!hike && (o.sun?.info || o.cloudBase)) sunPanel(g, W, barY - 16 * S, pad, S, m, fi, t, o);

    // --- further pilots (left, below the decision panel)
    if (o.companions?.length) {
      const rows = [{ name: tr('Ich'), color: ACCENT, alt: alt as number | null }];
      for (const c of o.companions) {
        const cfi = companionFi(c, t);
        rows.push({ name: c.name, color: c.color, alt: cfi == null ? null : lerpAt(c.model.alt, cfi) });
      }
      const lh = 40 * S;
      const bw = 360 * S;
      const by = (W > H ? pad : pad + 150 * S) + (o.decisions ? 124 * S : 0);
      panel(g, pad, by, bw, rows.length * lh + 20 * S, 16 * S);
      rows.forEach((r, k) => {
        const y = by + 10 * S + k * lh + lh * 0.7;
        g.fillStyle = r.color;
        g.beginPath(); g.arc(pad + 26 * S, y - 9 * S, 9 * S, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff';
        g.font = `600 ${24 * S}px system-ui, sans-serif`;
        g.fillText(r.name, pad + 46 * S, y, bw * 0.55);
        g.textAlign = 'right';
        g.fillStyle = r.alt == null ? '#8b98a8' : '#fff';
        g.fillText(r.alt == null ? '–' : `${num(r.alt)} m`, pad + bw - 18 * S, y);
        g.textAlign = 'left';
      });
    }

    // --- decisions: current thermal, exit, glide search
    if (o.decisions) {
      let msg: { head: string; body: string; color: string } | null = null;
      // frame at which the current message started: it fades and slides in from there
      let since = -1;
      const k = m.thermals.findIndex((th) => fi >= th.entry && fi <= th.end);
      if (k >= 0) {
        since = plan.thermalEnter[k];
        const th = m.thermals[k];
        const gain = lerpAt(m.alt, fi) - th.baseAlt;
        const secs = (t - tl.t[th.start]) / 1000;
        msg = { head: `${tr('Thermik')} ${k + 1}`, body: `${gain >= 0 ? '+' : '−'}${num(Math.abs(gain))} m · Ø ${num(secs > 20 ? gain / secs : 0, 1)} m/s`, color: '#ffb300' };
      } else {
        const last = m.thermals.map((th, j) => ({ th, j })).filter(({ th }) => th.end < fi).pop();
        if (last) {
          const exitFrame = plan.thermalExit[last.j];
          if (exitFrame >= 0 && frameNo - exitFrame < plan.fps * 3) {
            since = exitFrame;
            const weak = last.th.exitClimb < last.th.avgClimb * 0.5;
            msg = {
              head: tr('Thermik verlassen'),
              body: `${tr('bei')} ${last.th.exitClimb >= 0 ? '+' : '−'}${num(Math.abs(last.th.exitClimb), 1)} m/s (Ø ${num(last.th.avgClimb, 1)})${weak ? `, ${tr('Bart war schwach')}` : ''}`,
              color: weak ? '#9ccc65' : '#ffca28',
            };
          } else {
            const lost = m.alt[last.th.end] - lerpAt(m.alt, fi);
            const dist = lerpAt(m.dist, fi) - m.dist[last.th.end];
            // running glide ratio since leaving the thermal (once there is enough distance to be meaningful)
            since = exitFrame >= 0 ? exitFrame + plan.fps * 3 : -1;
            const gz = lost > 20 && dist > 0.3 ? ` · ${tr('GZ')} 1:${num((dist * 1000) / lost, 1)}` : '';
            msg = {
              head: tr('Gleiten / Suche'),
              body: `${dur((t - tl.t[last.th.end]) / 1000)} · ${num(dist, 1)} km · ${lost >= 0 ? '−' : '+'}${num(Math.abs(lost))} m${gz}`,
              color: '#4fc3f7',
            };
          }
        }
      }
      if (msg && !hike) {
        const bw = 520 * S;
        const by = W > H ? pad : pad + 150 * S;
        const a = since >= 0 ? smooth((frameNo - since) / (plan.fps * 0.6)) : 1;
        g.save();
        g.globalAlpha = a;
        g.translate(-(1 - a) * 40 * S, 0);
        panel(g, pad, by, bw, 104 * S, 16 * S);
        g.fillStyle = msg.color;
        g.fillRect(pad, by, 8 * S, 104 * S);
        g.font = `700 ${22 * S}px system-ui, sans-serif`;
        g.fillText(msg.head.toUpperCase(), pad + 26 * S, by + 38 * S);
        g.fillStyle = '#fff';
        g.font = `600 ${32 * S}px system-ui, sans-serif`;
        g.fillText(msg.body, pad + 26 * S, by + 82 * S, bw - 40 * S);
        g.restore();
      }
    }

    // --- caption for the best thermal of the flight, fades in and out over its first seconds
    if (fr.phase === 'play' && m.thermals.length) {
      let best = 0;
      m.thermals.forEach((th, j) => { if (th.avgClimb > m.thermals[best].avgClimb) best = j; });
      const f0 = plan.thermalEnter[best];
      const show = plan.fps * 4.5;
      const d = frameNo - f0 - plan.fps * 0.8;
      if (f0 >= 0 && d >= 0 && d < show) {
        const a = Math.min(smooth(d / (plan.fps * 0.6)), smooth((show - d) / (plan.fps * 0.8)));
        const value = `Ø +${num(m.thermals[best].avgClimb, 1)} m/s`;
        const label = `${tr('Dein bestes Steigen')}: `;
        const fs = (W > H ? 46 : 40) * S;
        g.save();
        g.globalAlpha = a;
        g.font = `800 ${fs}px system-ui, sans-serif`;
        const w1 = g.measureText(label).width;
        const w2 = g.measureText(value).width;
        const bw = Math.min(W - pad * 2, w1 + w2 + 64 * S);
        const bh = fs * 1.7;
        const bx = (W - bw) / 2;
        const by = H * (W > H ? 0.62 : 0.6) + (1 - a) * 24 * S;
        panel(g, bx, by, bw, bh, bh / 2);
        g.textBaseline = 'middle';
        g.fillStyle = '#fff';
        g.fillText(label, bx + 32 * S, by + bh / 2);
        g.fillStyle = '#ff9f43';
        g.fillText(value, bx + 32 * S + w1, by + bh / 2);
        g.restore();
      }
    }
  }

  // --- outro summary
  if (fr.phase === 'outro') {
    const a = Math.min(1, fr.u * 3);
    g.globalAlpha = a;
    const rows = summaryRows(m);
    // two columns in landscape when there is a lot to show
    const cols = W > H && rows.length > 7 ? 2 : 1;
    const perCol = Math.ceil(rows.length / cols);
    const bw = Math.min(W - pad * 2, (cols === 2 ? 1500 : 760) * S);
    // shrink line height so everything fits on screen
    const lh = Math.min(60 * S, (H - pad * 2 - 130 * S) / perCol);
    const fs = Math.min(1, lh / (60 * S));
    const bh = 110 * S + perCol * lh;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    const colW = bw / cols;
    panel(g, bx, by, bw, bh, 22 * S);
    g.fillStyle = '#fff';
    g.font = `800 ${46 * S}px system-ui, sans-serif`;
    g.fillText(o.title, bx + 36 * S, by + 70 * S, bw - 72 * S);
    rows.forEach(([l, v], k) => {
      const cx = bx + Math.floor(k / perCol) * colW;
      const y = by + 130 * S + (k % perCol) * lh;
      g.fillStyle = '#8b98a8';
      g.font = `600 ${26 * S * fs}px system-ui, sans-serif`;
      g.fillText(l, cx + 36 * S, y, colW * 0.5);
      g.fillStyle = '#fff';
      g.font = `700 ${32 * S * fs}px system-ui, sans-serif`;
      g.textAlign = 'right';
      g.fillText(v, cx + colW - 36 * S, y, colW * 0.48);
      g.textAlign = 'left';
    });
    g.globalAlpha = 1;
  }
  g.restore();
}

/**
 * Sun position as a small sky plot (zenith in the centre, horizon on the ring, north up),
 * time of day, elevation, clear-sky irradiance on flat ground and on the slope below the pilot,
 * and the cloud base with the pilot's distance to it.
 */
function sunPanel(g: CanvasRenderingContext2D, W: number, bottom: number, pad: number, S: number, m: Model, fi: number, t: number, o: HudOptions) {
  const lines: [string, string?][] = [];
  const bw = 300 * S;
  const x = W - pad - bw;
  let plotH = 0;
  let sun: { azimuth: number; elevation: number } | null = null;
  if (o.sun?.info) {
    const ts = sunTime(t, o.sun);
    const T = m.terrain;
    sun = sunPosition(ts, T.frame.lat0, T.frame.lon0);
    const v = sunVector(sun.azimuth, sun.elevation);
    // slope below the pilot from the terrain gradient
    const px = lerpAt(m.x, fi), pz = lerpAt(m.z, fi), d = 60;
    const gx = (T.heightAt(px + d, pz) - T.heightAt(px - d, pz)) / (2 * d);
    const gz = (T.heightAt(px, pz + d) - T.heightAt(px, pz - d)) / (2 * d);
    const nl = Math.hypot(gx, 1, gz);
    const cosInc = (-gx * v[0] + v[1] - gz * v[2]) / nl;
    const slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    const facing = ((Math.atan2(-gx, gz) * 180) / Math.PI + 360) % 360;
    const shifted = o.sun.hourOffset !== 0 || !!o.sun.date;
    lines.push([`${tr('Sonne')} ${clock(ts, m.res.timeZone)}${shifted ? ' *' : ''}`, '#ffd54f']);
    lines.push([`${num(Math.max(0, sun.elevation))}° · ${compass(sun.azimuth)} ${num(sun.azimuth)}°`]);
    lines.push([`${tr('Flach')} ${num(irradiance(sun.elevation, Math.sin((sun.elevation * Math.PI) / 180)))} W/m²`]);
    if (slope >= 5) lines.push([`${tr('Hang')} ${num(slope)}° ${compass(facing)}: ${num(irradiance(sun.elevation, cosInc))} W/m²`, cosInc > Math.sin((sun.elevation * Math.PI) / 180) ? '#ffca28' : '#90a4ae']);
    plotH = 120 * S;
  }
  if (o.cloudBase) {
    const base = o.cloudBase(t);
    const gap = base - lerpAt(m.alt, fi);
    lines.push([`${tr('Basis')} ${num(base)} m`, '#e3f2fd']);
    // the pilot climbs towards the base: show the distance still to go (never negative)
    lines.push([`${tr('Abstand zur Basis')} ${num(Math.max(0, gap))} m`, '#8b98a8']);
  }
  const lh = 32 * S;
  const bh = plotH + lines.length * lh + 22 * S;
  const y = bottom - bh;
  panel(g, x, y, bw, bh, 18 * S);
  if (sun) {
    const r = 50 * S;
    const cx = x + bw / 2, cy = y + 14 * S + r;
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 2 * S;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * (2 / 3), 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#8b98a8';
    g.font = `700 ${16 * S}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText('N', cx, cy - r - 2 * S);
    const rr = r * Math.min(1.08, (90 - sun.elevation) / 90);
    const a = (sun.azimuth * Math.PI) / 180;
    g.fillStyle = sun.elevation > 0 ? '#ffd54f' : '#607d8b';
    g.shadowColor = '#ffb300';
    g.shadowBlur = sun.elevation > 0 ? 14 * S : 0;
    g.beginPath(); g.arc(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr, 10 * S, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.textAlign = 'left';
  }
  lines.forEach(([text, color], k) => {
    g.fillStyle = color ?? '#fff';
    g.font = `${k === 0 ? 700 : 600} ${22 * S}px system-ui, sans-serif`;
    g.fillText(text, x + 18 * S, y + plotH + 12 * S + (k + 1) * lh - 8 * S, bw - 36 * S);
  });
}

/** Final statistics shown at the end of the video */
export function summaryRows(m: Model): [string, string][] {
  const f = m.res.flight;
  const sc = m.res.score?.best;
  const h = m.res.hike;
  const rows: [string, string][] = [];
  if (sc) rows.push([tr(SCORE_LABEL[sc.code] ?? sc.type), `${num(sc.distanceKm, 1)} km · ${num(sc.points, 1)} P`]);
  if (f) {
    rows.push(
      [tr('Airtime'), dur(f.airtimeS)],
      [tr('Max. Höhe'), `${num(f.maxAlt)} m`],
      [tr('Max. Überhöhung Start'), `${num(f.maxGainAboveLaunch)} m`],
      [tr('Erkurbelte Höhe'), `+${num(thermalGain(f.thermals))} m`],
      [tr('Bestes Steigen (30 s)'), `+${num(f.bestClimb30s, 1)} m/s`],
      [tr('Stärkstes Sinken (30 s)'), `${num(f.worstSink30s, 1)} m/s`],
    );
    const best = bestGlide(m.glides);
    if (best) rows.push([tr('Bestes Gleiten'), `1:${num(best.ratio!, 1)} · ${num(best.distanceKm, 1)} km`]);
    if (f.timeCirclingS > 0) {
      const l = Math.round((f.circlingLeftS / f.timeCirclingS) * 100);
      rows.push([tr('Kreisen links | rechts'), `${l} % | ${100 - l} %`]);
    }
    const w = maxWind(f.thermals);
    if (w) rows.push([tr('Max. Wind'), `${compass(w.fromDeg)} ${num(w.speedKmh)} km/h`]);
    rows.push([tr('Tracklänge'), `${num(f.trackLengthKm, 1)} km`], [tr('Ø Speed'), `${num(f.avgSpeedKmh, 1)} km/h`]);
    if (f.thermals.length) rows.push([tr('Thermiken'), `${f.thermals.length} · Ø +${num(f.avgClimbInThermals ?? 0, 1)} m/s`]);
  }
  if (h) rows.push([tr('Aufstieg zu Fuss'), `+${num(h.gain)} m · ${dur(h.durationS)}`]);
  return rows;
}
