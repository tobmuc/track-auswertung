# Track-Auswertung

**Flüge auswerten und als 3D-Video teilen – direkt im Browser, ohne Anmeldung.**

IGC-Datei vom Vario oder GPX von Uhr/Handy hineinziehen: Du bekommst Statistik, XC-Wertung, Karte und
Höhenprofil, und mit einem Klick ein 3D-Flugvideo als MP4 für Instagram, YouTube & Co.
Für Gleitschirm, Hike & Fly, Hängegleiter und Wandern.

👉 **Online nutzen: https://tobmuc.github.io/track-auswertung/**

Deine Tracks bleiben auf deinem Gerät: Sie werden im Browser gespeichert und nirgendwohin hochgeladen.

<p align="center">
  <img src="docs/images/demo-flug.gif" width="100%" alt="Animiertes Demo: 81-km-XC-Flug als 3D-Video mit Thermiken, Wolken, Sonnen-Panel und Datenleiste">
</p>
<p align="center"><em>Demo: ein 81-km-Streckenflug (4 h 17 min) als 30-Sekunden-Video, hier im Zeitraffer</em></p>

<p align="center">
  <img src="docs/images/portrait-thermik.webp" width="32%" alt="3D-Video im Hochformat: Thermikschlauch mit Auslöser am Boden, Wolke und Sonnenstand">
  &nbsp;
  <img src="docs/images/portrait-schatten.webp" width="32%" alt="3D-Video im Hochformat: Gleitschirm mit Schatten am Hang, Gipfelbeschriftung und Einstrahlung">
</p>
<p align="center"><em>Hochformat 9:16 für Reels und Stories</em></p>

![3D-Video im Querformat: Thermik mit Cumulus, Thermik-Auslöser, Gleitzahl und Datenleiste](docs/images/landscape-thermik-wolke.jpg)
<p align="center"><em>Querformat 16:9 für YouTube</em></p>

---

## So geht's

1. **Track laden** – IGC oder GPX auf die Seite ziehen oder auf „+ Neue Aktivität“ klicken.
   Für Hike & Fly den Aufstieg (GPX) und den Flug (IGC) zusammen auswählen.
2. **Auswertung ansehen** – Kennzahlen, Karte, Höhenprofil, Thermiken und Gleitstrecken.
3. **3D-Video** klicken – Format, Länge, Karte, Schirm und Musik wählen, in der Vorschau abspielen.
4. **Video erstellen** – das MP4 wird Bild für Bild in deinem Browser gerendert und kann gespeichert werden.

Am besten in Chrome oder Edge (für den Video-Export, Safari ab Version 17 geht auch).

---

## Auswertung (Dashboard)

![Dashboard mit Reliefkarte, XC-Wertung, Höhenprofil und Flugphasen](docs/images/dashboard-relief.jpg)

**Kennzahlen**
- XC-Distanz und Punkte nach XContest, FFVL, FAI oder XC League – freie Strecke, flaches Dreieck und
  FAI-Dreieck werden optimal berechnet und auf der Karte eingezeichnet
- Airtime, Start- und Landezeit, max. Höhe, Überhöhung über dem Start, Tracklänge, Ø und max. Speed
- Hike & Fly: Aufstieg zu Fuss, Zeit, Höhenmeter, Pausen

**Thermik und Gleiten**
- Alle Thermiken mit Höhengewinn, Ø Steigen, Basis → Top, Kreisen links/rechts und Ø Zeit pro Kreis
- Versatz des Thermikkerns vom untersten zum obersten Kreis – zeigt, wie stark der Wind den Bart versetzt
- Wind aus den Kreisen und aus der Drift der Kreismittelpunkte
- Gleitstrecken mit Gleitzahl über Grund und in der Luft (ohne Windeinfluss)
- Zeit in der Luft nach Phasen: Kreisen, Steigen, Gleiten, starkes Sinken

**Thermik & Kreisformen**
- Jeder Vollkreis einzeln vermessen: Durchmesser relativ zur Luft (Wind herausgerechnet), Kreiszeit,
  berechnete Querlage und Steigen
- Verteilung der Steigwerte, Kreisdurchmesser gegen Steigen (mit dem Durchmesser, der am besten stieg),
  Steigen nach Höhenband und nach Tageszeit
- **Zentrieren:** Steigen Kreis für Kreis ab dem Einflug und die Zeit, bis 80 % des besten Steigens erreicht sind –
  pro Thermik und im Schnitt
- Jedes Diagramm als PNG speichern, zum Teilen oder für die Trainerbesprechung

**Fahrt durch die Luft**
- Fahrt gegenüber der Luft aus dem Winddreieck (Grundgeschwindigkeit minus Wind aus den Kreisen)
- Geschätzte Trimmfahrt, höchste Fahrt, Zeit und Phasen im **beschleunigten Flug**
- Beschleunigt bei Gegen- und Rückenwind – zeigt, ob du nach Sollfahrt fliegst
- Gleitstrecken mit Fahrt durch die Luft und Wind entlang der Strecke

**Karte**
- Satellit, Sentinel-2, Topo, Strasse und **Relief** (Höhenfarben mit Schummerung, Seen, Flüsse,
  Strassen und Grenzen – ähnlich der XContest-Reliefkarte, aber aus offenen Daten)
- Beschriftungen und 3D-Gelände zuschaltbar, Spur nach Phasen, Steigen oder Speed eingefärbt

**Höhenprofil**
- Höhe und Gelände darunter, eingefärbt nach Phasen, Steigen oder Speed; Maus über Profil oder Karte
  zeigt die Stelle im jeweils anderen
- Höhe über Grund aus genauen Geländemodellen (OpenTopography oder eigene DEM-Dateien)

---

## 3D-Flugvideo

![3D-Video, Übersicht zu Beginn mit Reliefkarte und Gipfelnamen](docs/images/landscape-relief-uebersicht.jpg)

**Bild und Kamera**
- 9:16 (Reel/Story) oder 16:9 (YouTube), Full HD oder HD, 30 bis 180 Sekunden
- Ruhige Verfolgerkamera, die schnellen Zeitraffern folgt; Intro-Überflug und Abschluss-Übersicht
- Smart-Highlights: Start, stärkste Thermiken, höchster Punkt und Landung laufen langsamer
- Karte wählbar (Satellit, Sentinel-2, Topo, OSM, Relief, Gips-Relief), Überhöhung und Kameradistanz einstellbar

**Gleitschirm**
- Schirm-Modelle mit eigenen Farben und Mustern (Zellen, Streckung, 4 Farben, Gurtzeug, Helm)
- Schirm neigt sich in Kurven, nickt beim Einflug in Thermik und schaukelt beim Verlassen
- Alternativ als „Glühwürmchen“ – Lichtpunkt mit Leuchtspur

**Mehrere Piloten**
- Weitere Flüge im selben Gebiet zuschalten, jeder mit eigener Spurfarbe, eigenem Schirm und Namensschild
- Gleichzeitig geflogene Flüge laufen synchron, sonst werden sie am Start ausgerichtet
- Pilotenliste mit aktueller Höhe im Bild

**Lern-Ebenen**
- Thermikschläuche mit Steigwert, versetzt entlang der Kreismittelpunkte
- **Thermik-Auslöser:** die Thermik-Achse bis zum Boden verlängert, mit Höhe und Hangneigung
- Gleitzahl auf längeren Gleitstrecken
- Luftströmung (Partikel) in starken Thermiken
- **Verblassende Spur:** die Flugspur löst sich nach einstellbarer Zeit auf, die Thermikkreise bleiben stehen
- Fläche „Höhe über Grund“ (rot unter 150 m), Windpfeil, Gipfel, Hütten und Orte mit Infotafel
- Entscheidungen im Bild: aktuelle Thermik, „Thermik verlassen“ mit Steigwert, Gleiten/Suche mit Gleitzahl

**Sonne und Wolken**
- Sonnenstand über die Flugzeit, **Schattenwurf** von Schirm und Bergen
- Tageszeit verschieben oder anderes Datum wählen – wie sähe der Flug im Juni um 10 Uhr aus?
- Sonnen-Panel: Sonnenhöhe und -richtung, Einstrahlung auf flachem Boden und auf dem Hang unter dir
- **Wolkenbasis** aus Temperatur und Taupunkt des Flugtags (Open-Meteo-Archiv, Faustformel 125 m × Spread),
  alternativ aus dem Flug geschätzt oder von Hand; Abstand zur Basis im Bild
- **Cumulus-Wolken** über den Thermiken, die wachsen, während du kreist

**Ton**
- GEMA-freie Musik, im Browser erzeugt: Ambient, Cinematic, Chill, Lo-Fi Hip-Hop, Synthwave,
  Deep House, Liquid Drum & Bass – oder eigene Musikdatei
- Vario-Töne nach Steigen und Sinken mit einstellbaren Schwellen, Startsound beim Abheben

---

## Datenschutz

- Tracks, Auswertungen und Einstellungen liegen nur im Speicher deines Browsers (IndexedDB).
  Löschst du die Browserdaten, sind sie weg – die Originaldateien behältst du ja.
- Aus dem Internet geladen werden nur Karten- und Höhenkacheln, Orte (Wikidata/OpenStreetMap),
  Gewässer und Strassen für die Reliefkarte (OpenStreetMap) und die Temperaturen für die Wolkenbasis
  (Open-Meteo). Dafür wird der Kartenausschnitt bzw. der Startort übermittelt, nie der Track.
- Die Online-Version nutzt Google Analytics nur, wenn du im Banner zustimmst. Ändern kannst du das jederzeit
  über „Statistik-Einstellungen“ unten in der Seitenleiste.

## Quellen

Gelände: Terrain Tiles (AWS) · Karten: Esri, Sentinel-2 cloudless (EOX), OpenTopoMap, © OpenStreetMap ·
Orte: Wikidata · Wetter: Open-Meteo · XC-Wertung: igc-xc-score

---

Weitere Ideen und Prioritäten: [docs/ROADMAP.md](docs/ROADMAP.md) · UI-Prüfung: [docs/UI-UX-Review.md](docs/UI-UX-Review.md)

## Für Entwickler

### Lokal starten

**Windows:** `start.bat` doppelklicken. Beim ersten Start werden die Abhängigkeiten installiert, danach öffnet
sich der Browser auf http://localhost:5173. Zum Beenden das Konsolenfenster schliessen.

Voraussetzung: [Node.js](https://nodejs.org) (LTS). Manuell:

```bash
npm install
npm run dev
```

| Befehl | Zweck |
|---|---|
| `npm test` | Tests |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm run score -- <datei.igc>` | XC-Scoring einer Datei auf der Kommandozeile |

Lokal gespeicherte Flüge gehören zur Adresse, unter der die App läuft: `localhost:5173` und die Online-Version
haben getrennte Speicher.

### Online-Version (GitHub Pages)

Die App liegt unter https://tobmuc.github.io/track-auswertung/. Derzeit wird sie aus dem Branch `gh-pages`
ausgeliefert, der den Inhalt von `dist/` enthält: neu bauen und den Inhalt von `dist/` (plus eine leere
`.nojekyll`) als neuen Commit auf `gh-pages` pushen.

Automatisch bei jedem Push geht es mit dem Workflow `.github/workflows/pages.yml` (baut, testet, veröffentlicht).
Er ist vorbereitet, aber noch nicht im Repo: Workflow-Dateien lassen sich nur mit der GitHub-Berechtigung
`workflow` hochladen (`gh auth refresh -h github.com -s workflow`). Danach die Datei committen und unter
*Settings → Pages* die Quelle auf „GitHub Actions“ stellen.

Welche Version online ist, steht in der Fusszeile: `v0.4.0, Build 16, 1a2b3c4, 05.11.2026`
(Version aus `package.json`, Build = Anzahl Commits, Commit-Kürzel, Build-Datum; ein `+` hinter dem Commit heisst:
mit nicht committeten Änderungen gebaut). Ein Klick öffnet den Commit auf GitHub.

Lokal testen wie auf Pages: `npm run build`, dann `npx vite preview --base /track-auswertung/`.

Google Analytics (GA4, Mess-ID in `.env.production`) ist nur im gebauten Online-Stand aktiv und lädt erst nach
Zustimmung im Banner. Ohne `VITE_GA_ID` wird ohne Analytics gebaut.
