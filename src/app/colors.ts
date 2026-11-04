export type ColorMode = 'mode' | 'vario' | 'speed';

export const MODE_COLORS = [
  '#8bc34a', // 0 hike up
  '#29b6f6', // 1 hike down
  '#cfd8dc', // 2 hike flat
  '#6d7a86', // 3 break
  '#ffb300', // 4 circling
  '#66bb6a', // 5 climb (straight)
  '#26c6da', // 6 glide
  '#5c6bc0', // 7 strong sink
];

export const MODE_LABELS = ['Aufstieg', 'Abstieg', 'Flach', 'Pause', 'Kreisen', 'Steigen', 'Gleiten', 'Starkes Sinken'];

/** Diverging vario scale (m/s) */
export const VARIO_STOPS: [number, string][] = [
  [-3, '#3949ab'],
  [-1.5, '#1e88e5'],
  [-0.5, '#26c6da'],
  [0, '#9ccc65'],
  [0.5, '#d4e157'],
  [1.5, '#ffca28'],
  [2.5, '#fb8c00'],
  [4, '#e53935'],
];

export const SPEED_STOPS: [number, string][] = [
  [0, '#263238'],
  [5, '#455a64'],
  [15, '#00838f'],
  [30, '#26a69a'],
  [45, '#d4e157'],
  [60, '#ffa726'],
  [80, '#ef5350'],
];

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function scale(stops: [number, string][], v: number): string {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const f = (v - a) / (b - a);
      const x = hexToRgb(ca);
      const y = hexToRgb(cb);
      return `rgb(${x.map((c, k) => Math.round(c + (y[k] - c) * f)).join(',')})`;
    }
  }
  return stops[stops.length - 1][1];
}

/** Buckets keep the number of map line features small: equal bucket → same feature */
export function colorBucket(mode: ColorMode, m: number, vario: number, speed: number, isHike: boolean): string {
  if (mode === 'mode') return MODE_COLORS[m];
  if (mode === 'vario') {
    // walkers climb slowly: show m/h on the same scale stretched (600 m/h ≈ +2.5)
    const v = isHike ? vario * 3600 / 240 : vario;
    return scale(VARIO_STOPS, Math.round(v * 4) / 4);
  }
  return scale(SPEED_STOPS, Math.round(speed / 2.5) * 2.5);
}

/** Colour for a climb rate (m/s) on the vario scale */
export const varioColor = (v: number) => scale(VARIO_STOPS, v);
