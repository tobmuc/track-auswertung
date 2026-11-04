/**
 * Google Analytics 4 for the hosted version (GitHub Pages), opt-in only:
 * nothing is loaded and no cookie is set before the visitor agrees in the banner.
 * The measurement ID comes from VITE_GA_ID at build time; without it (and in dev) analytics is off.
 * Activity ids are removed from page paths: tracks never leave the browser, only which view is open.
 */
import { reactive, watch } from 'vue';

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;
export const analyticsAvailable = !!GA_ID && import.meta.env.PROD;

type Choice = 'granted' | 'denied' | null;
const KEY = 'analytics-consent';

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export const consent = reactive<{ choice: Choice }>({ choice: analyticsAvailable ? read() : 'denied' });

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer: unknown[]; gtag?: Gtag }
}

let loaded = false;

/** "#/a/12/3d" → "/3d", "#/a/12" → "/activity", "#/" → "/" */
function pagePath(): string {
  const h = location.hash;
  if (/^#\/a\/\d+\/3d/.test(h)) return '/3d';
  if (/^#\/a\/\d+/.test(h)) return '/activity';
  return '/';
}

function pageView() {
  const base = `${location.origin}${location.pathname.replace(/\/$/, '')}`;
  window.gtag?.('event', 'page_view', { page_path: pagePath(), page_location: `${base}${pagePath()}`, page_title: document.title });
}

function load() {
  if (loaded || !GA_ID) return;
  loaded = true;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js expects the arguments object itself
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  // page views are sent by hand: the app changes views through the URL hash
  window.gtag('config', GA_ID, { send_page_view: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  pageView();
  window.addEventListener('hashchange', pageView);
}

/** Stops sending and removes the GA cookies after consent was withdrawn */
function unload() {
  if (!GA_ID) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = true;
  window.removeEventListener('hashchange', pageView);
  loaded = false;
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name.startsWith('_ga')) {
      for (const domain of ['', `; domain=${location.hostname}`, `; domain=.${location.hostname}`]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
      }
    }
  }
}

export function setConsent(choice: 'granted' | 'denied') {
  consent.choice = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: ask again next time */
  }
}

/** Reopens the banner (link in the sidebar) */
export function resetConsent() {
  consent.choice = null;
}

/** Custom event, e.g. track('video_export', { format: '9:16' }); dropped without consent */
export function track(name: string, params: Record<string, unknown> = {}) {
  if (loaded) window.gtag?.('event', name, params);
}

watch(() => consent.choice, (c) => {
  if (!analyticsAvailable) return;
  if (c === 'granted') load();
  else if (loaded) unload();
}, { immediate: true });
