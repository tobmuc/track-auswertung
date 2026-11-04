/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** GA4 measurement ID (G-…) for the hosted build; unset = no analytics */
  readonly VITE_GA_ID?: string;
}
declare module 'tz-lookup' {
  export default function tzlookup(lat: number, lon: number): string;
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
