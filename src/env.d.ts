/// <reference types="vite/client" />
declare module 'tz-lookup' {
  export default function tzlookup(lat: number, lon: number): string;
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
