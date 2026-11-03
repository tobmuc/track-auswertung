# Track-Auswertung

Lokale Auswertung von IGC- und GPX-Tracks (Gleitschirm, Hike & Fly, Hängegleiter, Wandern) mit Statistik, XC-Scoring, Karte, Höhenprofil und 3D-Flugvideo.

## Starten

**Windows:** `start.bat` doppelklicken. Beim ersten Start werden die Abhängigkeiten installiert, danach öffnet sich der Browser auf http://localhost:5173. Zum Beenden das Konsolenfenster schliessen.

Voraussetzung: [Node.js](https://nodejs.org) (LTS).

Manuell:

```bash
npm install
npm run dev
```

## Weitere Befehle

| Befehl | Zweck |
|---|---|
| `npm test` | Tests |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm run score -- <datei.igc>` | XC-Scoring einer Datei auf der Kommandozeile |

Alle Daten bleiben lokal im Browser (IndexedDB). Karten- und Höhenkacheln werden aus dem Internet geladen und zwischengespeichert.
