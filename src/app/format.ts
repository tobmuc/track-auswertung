import type { Sport } from '../core';
import { reactive, watch } from 'vue';
import { locale } from './i18n';

/**
 * Clock times in local time at the launch site (default) or in UTC, as varios and IGC files record them.
 * Applies to the dashboard, the review and the video overlay.
 */
function loadUtc(): boolean {
  try {
    return localStorage.getItem('clock-utc') === '1';
  } catch {
    return false;
  }
}
export const timeSettings = reactive({ utc: loadUtc() });
watch(() => timeSettings.utc, (u) => {
  try {
    localStorage.setItem('clock-utc', u ? '1' : '0');
  } catch {
    /* private mode */
  }
});

/** Offset of a time zone at a moment, e.g. "UTC+6" or "UTC+5:30" */
export function utcOffset(timeZone: string, t: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(t);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return name.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC±0');
}

const nf = (d: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });

export const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '–' : nf(d).format(v));
export const km = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${num(v, d)} km`);
export const m = (v: number | null | undefined) => (v == null ? '–' : `${num(v)} m`);
export const msl = (v: number | null | undefined) => (v == null ? '–' : `${num(v)} ${locale() === 'de-CH' ? 'm ü. M.' : 'm MSL'}`);
export const signed = (v: number, unit: string, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)} ${unit}`;
export const vario = (v: number | null | undefined) => (v == null ? '–' : signed(v, 'm/s', 1));
export const kmh = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${num(v, d)} km/h`);
export const glide = (v: number | null | undefined) => (v == null ? '–' : `1 : ${num(v, 1)}`);
export const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)} %` : '–');

export function dur(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '–';
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
}

export function clock(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: timeSettings.utc ? 'UTC' : timeZone }).format(t);
}

export function dateLong(t: number | string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(t));
}

export const SPORT_LABEL: Record<Sport, string> = {
  paragliding: 'Gleitschirm',
  hikefly: 'Hike & Fly',
  hanggliding: 'Hängegleiter',
  hiking: 'Wandern / Outdoor',
};

export const SCORE_LABEL: Record<string, string> = {
  od: 'Freie Strecke',
  tri: 'Flaches Dreieck',
  fai: 'FAI-Dreieck',
  oar: 'Out & Return',
};
