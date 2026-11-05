import { createApp } from 'vue';
import 'maplibre-gl/dist/maplibre-gl.css';
// self-hosted, so no request goes to Google Fonts
import '@fontsource-variable/archivo/wdth.css';
import './style.css';
import App from './ui/App.vue';
import './app/analytics';

createApp(App).mount('#app');

// Tile cache (map + elevation tiles), see public/sw.js
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
