import { reactive, watch } from 'vue';

/**
 * Glider look for the 3D video: planform (cells, aspect ratio) plus a colour pattern.
 * Presets are approximations of the pilot's own wings; every colour can be changed in the UI.
 */
export type GliderPattern =
  /** colour A in the centre, B towards the tips */
  | 'center'
  /** A at the leading half, B at the trailing half, split line swept back towards the tips */
  | 'split'
  /** A base with a V-shaped band in B pointing forward */
  | 'chevron'
  /** A base with B bands every few cells */
  | 'stripes'
  /** A base with a spanwise band in B behind the leading edge, followed by a thin line in C */
  | 'band'
  /**
   * B at the front and the tips, A only on the trailing part of the centre; the border curves back
   * to the trailing edge towards the tips and is lined with a stripe in C and one in D
   */
  | 'swoosh'
  /** A base with a spanwise band behind the leading edge, alternating C and B segments across the span */
  | 'segments';

export interface GliderDesign {
  name: string;
  cells: number;
  /** flat aspect ratio; higher = narrower chord */
  aspect: number;
  pattern: GliderPattern;
  /** main top colour */
  a: string;
  /** pattern colour */
  b: string;
  /** accent colour (thin line of the band and swoosh patterns) */
  c: string;
  /** second accent colour (swoosh pattern) */
  d: string;
  leadingEdge: string;
  bottom: string;
  harness: string;
  helmet: string;
}

export const GLIDER_PRESETS = {
  omegaXAlps3: {
    // 63 cells, aspect 6.95 (manufacturer data); design from the pilot's photo:
    // white wing, red spanwise band with a green line behind it, white underside
    name: 'Advance Omega X-Alps 3',
    cells: 63,
    aspect: 6.95,
    pattern: 'band',
    a: '#f3f4f2',
    b: '#d9262f',
    c: '#0f7a5a',
    d: '#0f7a5a',
    leadingEdge: '#f3f4f2',
    bottom: '#e4e6e4',
    harness: '#c6e02a',
    helmet: '#2b8fd6',
  },
  zeoliteGT: {
    // colour "ALPW" (from the pilot's photo and Ozone's colour chart): navy front and tips,
    // white trailing centre, light-blue and lilac stripes along the border; planform approximate
    name: 'Ozone Zeolite GT (blau/weiss)',
    cells: 66,
    aspect: 6.6,
    pattern: 'swoosh',
    a: '#eef0f2',
    b: '#1f4466',
    c: '#2ba3e3',
    d: '#a35cc9',
    leadingEdge: '#1f4466',
    bottom: '#eef0f3',
    harness: '#c6e02a',
    helmet: '#2b8fd6',
  },
  zeolite2GT: {
    // from the pilot's photo: neon-yellow wing, band behind the leading edge in teal segments
    // with magenta blocks; planform approximate
    name: 'Ozone Zeolite 2 GT (neongelb)',
    cells: 68,
    aspect: 6.6,
    pattern: 'segments',
    a: '#d7f01e',
    b: '#d9246e',
    c: '#1f8c86',
    d: '#1f8c86',
    leadingEdge: '#d7f01e',
    bottom: '#cfe31f',
    harness: '#c6e02a',
    helmet: '#2b8fd6',
  },
  classic: {
    name: 'Standard (orange)',
    cells: 36,
    aspect: 5.3,
    pattern: 'stripes',
    a: '#ff7a1a',
    b: '#ffffff',
    c: '#ffffff',
    d: '#ffffff',
    leadingEdge: '#1d2633',
    bottom: '#b3550f',
    harness: '#20262e',
    helmet: '#f4f4f4',
  },
} satisfies Record<string, GliderDesign>;

export type GliderPresetId = keyof typeof GLIDER_PRESETS;

export const PATTERN_LABEL: Record<GliderPattern, string> = {
  center: 'Mitte / Flügelenden',
  split: 'Vorne / hinten geteilt',
  chevron: 'Pfeil (Chevron)',
  stripes: 'Streifen',
  band: 'Band mit Linie',
  swoosh: 'Vorne/Enden mit Kurvenstreifen',
  segments: 'Band in Abschnitten',
};

const STORE_KEY = 'glider-design';
/** bump when presets change, so edits saved against old presets don't hide the new ones */
const PRESET_VERSION = 5;
function load(): { preset: GliderPresetId; designs: Record<GliderPresetId, GliderDesign> } {
  const d = { preset: 'omegaXAlps3' as GliderPresetId, designs: structuredClone(GLIDER_PRESETS) as Record<GliderPresetId, GliderDesign> };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (s.preset in GLIDER_PRESETS) d.preset = s.preset;
    if (s.version !== PRESET_VERSION) return d;
    for (const k of Object.keys(GLIDER_PRESETS) as GliderPresetId[]) if (s.designs?.[k]) d.designs[k] = { ...d.designs[k], ...s.designs[k] };
  } catch {
    /* defaults */
  }
  return d;
}

/** Selected glider and per-preset colour edits, remembered in this browser */
export const gliderChoice = reactive(load());
watch(gliderChoice, (s) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, version: PRESET_VERSION }));
  } catch {
    /* private mode */
  }
}, { deep: true });

export function resetDesign(id: GliderPresetId) {
  gliderChoice.designs[id] = structuredClone(GLIDER_PRESETS[id]);
}

/**
 * Top-surface colour key at span position s ∈ [-1, 1] and chord position c ∈ [0, 1] (leading → trailing).
 * Returns the colour slot; the leading edge band is handled by the caller.
 */
export function patternAt(d: GliderDesign, s: number, c: number, cell: number): 'a' | 'b' | 'c' | 'd' {
  const u = Math.abs(s);
  switch (d.pattern) {
    case 'center':
      return u < 0.62 ? 'a' : 'b';
    case 'split':
      // split line at 55 % chord in the centre, moving forward to 25 % at the tips
      return c < 0.55 - 0.3 * u * u ? 'a' : 'b';
    case 'chevron': {
      const band = 0.35 + 0.45 * u;
      return c > band && c < band + 0.18 ? 'b' : 'a';
    }
    case 'stripes':
      return u > 0.82 || (cell % 6 === 0 && u < 0.6) ? 'b' : 'a';
    case 'band':
      return c < 0.26 ? 'b' : c < 0.33 ? 'c' : 'a';
    case 'swoosh': {
      // border at 38 % chord in the centre, reaching the trailing edge at 80 % of the half span
      const border = 0.38 + 0.62 * (u / 0.8) ** 2;
      return c < border ? 'b' : c < border + 0.035 ? 'c' : c < border + 0.07 ? 'd' : 'a';
    }
    case 'segments': {
      if (c < 0.13 || c > 0.27) return 'a';
      // teal in the centre, magenta blocks at ~30 % and ~75 % of the half span, teal tips
      return (u > 0.22 && u < 0.38) || (u > 0.68 && u < 0.84) ? 'b' : 'c';
    }
  }
}
