import { createApp } from 'vue';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import App from './ui/App.vue';

createApp(App).mount('#app');

// Tile cache (map + elevation tiles), see public/sw.js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
