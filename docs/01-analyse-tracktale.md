# Analyse Tracktale.io – Funktionsumfang & Klon-Plan (lokal)

Stand: 2026-11-02 · Quellen: Landingpage, Demo (`/demo/?lang=en`), öffentliche Aktivitätsseite (`/a/Wt5yBrSsZF`), Seite zum 3D-Video.

> Ziel ist eine **eigene, lokale Umsetzung derselben Funktionen**, kein Kopieren von Code, Design oder Assets.
> Tracktale ist proprietär (Code steht inline im HTML, ohne Lizenz). Wir bauen die Logik auf offenen Bibliotheken neu.

---

## 1. Funktionsumfang (beobachtet)

### 1.1 Import
- IGC (Vario, SeeYou Navigator, XContest) und GPX (Uhr/Handy, Wandern, Trailrunning, Bike, Skitour)
- Sportarten: Paragliding, Hike & Fly, Hängegleiter, Wandern
- Hike & Fly: Aufstieg und Flug als **zwei Tracks** in einer Aktivität
- Erkennen von Aufzeichnungslücken („No recording for 30 min – walked, +189 m counted“)
- Zeitzone aus der Position (Bibliothek `tz-lookup`)
- EXIF aus Fotos (Aufnahmezeit, GPS) → Foto erscheint am richtigen Punkt im Track

### 1.2 Aktivitätsseite / Dashboard
- Kopf: Titel (umbenennen), Sportart, Datum, Route „Start → Landeplatz“
- KPI-Kacheln: XC-Distanz, Airtime, maximale Höhe, Aufstieg zu Fuß
- 2D-Track-Karte, eingefärbt nach Modus (Aufstieg/Abstieg/flach/Pause, Steigen in m/h, Geschwindigkeit)
- Höhenprofil über die Zeit mit derselben Farbcodierung und Legende (Vario-Skala −2,5 … +4,5 m/s)
- Diagramme: Anteile beim Wandern (Aufstieg/Abstieg/flach/Pause), Anteile in der Luft, Kreise links/rechts (Anzahl und Zeit)
- **Hike-Statistik:** Distanz, Höhengewinn, Gesamtzeit, Durchschnittsgeschwindigkeit, Abstieg, höchster/tiefster Punkt, Start-/Endhöhe, aufgezeichnete Zeit, Zeit in Bewegung, Pausen, Ø Aufstieg m/h
- **Flug-Statistik:**
  - Distanz: freie Strecke, FAI-Dreieck, flaches Dreieck / XC-Distanz, offene Distanz, Tracklänge, Start→Landung, XContest-Punkte
  - Höhe: min, Start, Landung, max. Überhöhung über dem Start, Gesamtsteigen, Gesamtsinken
  - Geschwindigkeit & Gleiten: Ø und max. Speed, Ø Gleitzahl (in Gleitphasen), beste Gleitzahl (60 s)
  - Vario: bestes Steigen (30 s), stärkstes Sinken (30 s), Ø Steigen in der Thermik
  - Zeit: Kreisen, Steigen in der Thermik, nicht Kreisen, in starkem Sinken (< −2 m/s)
  - Kreisen: Kreise links/rechts, Anteil links/rechts, Anzahl Thermiken, Ø Zeit pro Kreis, **Wind aus der Kreisdrift** (z. B. NW 4 km/h)
- Freie Inhalte: Fotos, Ausrüstung (Gear-Bibliothek), Wetter, „Key Moment“ (Situation / Problem / Risiko / Entscheidung / Lehre), Notizen, Wendepunkte, Start- und Landeplatz-Details

### 1.3 Social-Media-Grafiken (Canvas-Rendering, Export als PNG)
| Vorlage | Format |
|---|---|
| Post (Foto + Track + Zahlen) | 1:1, 4:5, 3:4, 16:9 |
| Story | 9:16 |
| Reel / TikTok / Short | 9:16 mit Sicherheitszonen |
| Foto-Post (Polaroid auf unscharfem Foto, max. 3 Zahlen) | wie Post |
| Instagram-Karussell (Panorama läuft über alle Slides, letzte Slide = Call-to-Action) | 4:5 / 3:4 / 1:1 |
| TikTok-Karussell | 9:16 |
| Instagram-Grid (ein Foto auf 3, 6 oder 9 Kacheln) | 3×N |

Editor-Optionen: Layout (Track in der Mitte / alles unten), Hintergrund (Foto / Farbe / transparent), Fotoauswahl, Zuschnitt (Zoom/Position), Abdunkeln für Lesbarkeit, Akzentfarbe, Titel und Untertitel, **jede Kennzahl einzeln ein-/ausblendbar**, Flug-/Hike-Track, Ortsnamen auf dem Track, Höhenprofil, Sprache des Exports (EN/DE/FR/IT/ES), Duplizieren/Löschen.

### 1.4 Video-Overlays (transparente PNG, HD / Full HD / 4K / 8K, einzeln oder als ZIP)
Titel/Kapitel · Flugdaten · Standortkarte („wo ist das?“: Landesumriss mit Punkt) · Hike · Startplatz · Bedingungen · Key Moment · Wendepunkt · Routenübersicht (Zeitleiste) · Landeplatz · Ausrüstung · Karte (Track + Marker + Profil) · Mini-Map (Ecke, „du bist hier“ zu einem gewählten Zeitpunkt) · Bauchbinde (Lower Third) · Flugstatistik · Flugzusammenfassung · YouTube-Endscreen · Foto-Karten.
Jeweils als Vollbild oder als Overlay in der Ecke. Designs: Dark und Glass.

### 1.5 Öffentliche Aktivitätsseite (Share-Link)
Hero mit Satellitenkarte, Track, Foto-Pins und KPIs. Danach alle Karten in der Reihenfolge des Tages. Auf dem Handy als Story zum Scrollen, am Desktop als Storyboard, Sprechblasen an Fotos. Open-Graph-Vorschau für WhatsApp/Instagram, `noindex`, jederzeit abschaltbar.

### 1.6 3D-Flugvideo (Rendering im Browser)
Reliefmodell aus DEM-Kacheln (Gips-Optik, Höhenlinien, Wald/Fels/Gletscher/Seen, Sonnenstand vom Flugtag) · Thermiksäulen mit Steigwert und Höhengewinn · Windpfeil und Windrose · Entscheidungsanalyse (wann die Thermik verlassen wurde, Suchzeit) · Vorhang für die Höhe über Grund (rot < 150 m) · Erreichbarkeitsfläche mit aktueller Gleitzahl und Wind · Foto-Pins mit Kameraflug · Smart-Highlights · Formate 9:16 und 16:9, 30 s bis 3 min · Export als MP4 über WebCodecs + mp4-muxer.

### 1.7 Sonstiges
Konto, Pläne Gratis/Pro (Wasserzeichen, Auflösungslimit), Stripe, XContest-Import, Ausrüstungsbibliothek, PWA, 5 Sprachen.

---

## 2. Technische Erkenntnisse aus der Demo
- **Vanilla-JS-SPA**, ein Inline-Bundle (~1,5 MB), Hash-Routing (`#/activity/1/social`, `#/activity/1/card/<id>`, `#/activity/1/video`)
- Rendering aller Karten über **Canvas 2D** (keine Kartenbibliothek wie Leaflet oder MapLibre geladen)
- Kartenkacheln: EOX **Sentinel-2 cloudless** und **Esri World Imagery**
- Höhenmodell: **AWS Terrarium Elevation Tiles** (`s3.amazonaws.com/elevation-tiles-prod/terrarium/`)
- Landesumrisse: `world-atlas@2.0.2/countries-50m.json` (TopoJSON)
- Zeitzone: `photostructure/tz-lookup`
- 3D-Video: WebGL (eigener Renderer bzw. three.js) + **WebCodecs `VideoEncoder` + `Vanilagy/mp4-muxer`**
- Demo-Zustand im `localStorage`

## 3. Open-Source-Bausteine für den Klon
| Bereich | Repo / Paket | Hinweis |
|---|---|---|
| IGC-Parser | `igc-parser` (Turbo87) | MIT |
| GPX-Parser | `@tmcw/togeojson` oder eigener Parser | |
| XC-Scoring (frei, flach/FAI-Dreieck, Punkte) | [mmomtchev/igc-xc-score](https://github.com/mmomtchev/igc-xc-score) | **LGPL-3.0**, XContest-Regeln eingebaut |
| Thermik-/Gleitanalyse | [pokle/glidecomp](https://awesome.ecosyste.ms/projects/github.com%2Fpokle%2Fglidecomp) (TS, MIT), `libigc` (Python) | als Referenz für Algorithmen |
| 3D-Replay | `ilyabo/flight-replay`, MapLibre GL + Terrain, [maplibre-gl-video-export](https://github.com/bjperson/maplibre-gl-video-export) | |
| Video-Encoding | `mp4-muxer` / `mediabunny` + WebCodecs | |
| Zeitzone | `tz-lookup` | |
| EXIF | `exifr` | |
| ZIP-Export | `fflate` / `jszip` | |
| Länderumrisse | `world-atlas` + `topojson-client` | |

Selbst zu bauen: Wind aus der Kreisdrift, Kreis-/Thermik-Segmentierung, Hike-Modi, Kartenvorlagen-Engine.

---

## 4. Architekturvorschlag (lokal)
- **Frontend:** Vite + TypeScript (Vue 3 oder Svelte), Canvas-2D-Renderer für Karten und Overlays, MapLibre für interaktive Karten und 3D
- **Analyse-Kern:** eigenes TS-Paket `track-core` (Parser → Segmentierung → Statistik → Scoring), testbar mit echten IGC-Dateien
- **Speicher:** IndexedDB (Dexie) im Browser. Optional ein kleines lokales Backend (Node/Fastify + SQLite), falls die Share-Seiten im LAN oder als statischer Export gebraucht werden
- **Kartenkacheln:** online mit Cache (Service Worker) oder vorab heruntergeladene MBTiles/PMTiles für echten Offline-Betrieb
- **Auslieferung:** PWA, oder Tauri/Electron als Desktop-App

## 5. Vorgeschlagene Ausbaustufen
1. **MVP:** Import IGC/GPX → Statistik-Dashboard, 2D-Karte und Profil, Hike & Fly mit zwei Tracks, lokale Speicherung
2. **Grafiken:** Post, Story, Karussell, Grid + Overlay-Karten, PNG/ZIP-Export, Editor mit Feldauswahl
3. **Inhalte:** Fotos mit EXIF, Ausrüstung, Key Moments, Wendepunkte, Start-/Landeplatz
4. **Share:** statische HTML-Aktivitätsseite (Story/Storyboard) als Export
5. **3D-Video:** Terrain, Thermiksäulen, Wind, Höhe über Grund, MP4-Export

---

## 6. Entscheidungen (abgestimmt am 2026-11-02)
- **Umfang Phase 1:** MVP-Analyse **und** 3D-Flugvideo. Social-Grafiken, Overlays und Share-Seite kommen später.
- **Plattform:** lokale Web-App (Vite + TypeScript, localhost, IndexedDB), später als PWA
- **Karten/DEM:** online laden, lokal cachen (Service Worker / Cache API)
- **Sportarten:** Paragliding/Hike & Fly, Hängegleiter, Wandern/Trail/Bike/Ski

### Umsetzungsreihenfolge Phase 1
1. Projektgerüst (Vite + TS + Vue 3, Vitest), Ordner `packages/track-core` + `app`
2. `track-core`: IGC/GPX-Parser, Glättung, Start-/Landeerkennung, Hike/Flug-Trennung, Lückenbehandlung
3. Statistik: Hike-Kennzahlen, Flug-Kennzahlen, Kreis-/Thermik-Segmentierung, Wind aus Drift
4. XC-Scoring über `igc-xc-score` (XContest-Regeln, PG und HG)
5. UI: Import, Aktivitätsliste, Dashboard mit KPIs, 2D-Karte (MapLibre, Satellit), Höhenprofil mit Farbmodi, Diagramme
6. 3D: MapLibre-Terrain (Terrarium-DEM), Track-Animation, Thermiksäulen, Windpfeil, Höhe-über-Grund-Vorhang, Erreichbarkeit
7. Videoexport: Kamerapfad und Highlights, WebCodecs + mp4-muxer, 9:16 / 16:9, 30 s bis 3 min

---

## 7. Stand der Umsetzung (2026-11-02)
- Läuft: `npm install`, dann `npm run dev` → http://localhost:5173 · Tests: `npm test`
- `src/core`: IGC/GPX-Parser, Flugerkennung, Hike/Flug-Trennung, Kreis- und Thermikerkennung, Wind aus den Kreisen (Kreisfit der Geschwindigkeitsvektoren), Hike-Statistik mit Pausen und Lücken, XC-Scoring (igc-xc-score, alle Disziplinen)
- `src/app/worker.ts`: Analyse im Web Worker, Zeitzone aus der Position (tz-lookup)
- UI: Aktivitätsliste (IndexedDB), KPIs, MapLibre-Karte (Satellit/Topo/Strasse, 3D-Gelände), Höhenprofil (Phasen/Steigen/Speed) mit Hover-Kopplung zur Karte, Wertungsauswahl, Statistikgruppen, Thermik-Tabelle, Service Worker als Kachel-Cache
- Referenzflug 17.09.2026 (Kirgistan): flaches Dreieck **80,80 km** (XContest: 80,62 km, Δ 0,2 %), 96,96 P
- Offen: 3D-Flugvideo (Phase 1, Teil 2), Fotos/Gear/Key Moments, Social-Grafiken, Overlays, Share-Seite

## 8. 3D-Flugvideo (2026-11-02)
- Route `#/a/<id>/3d`, Button „3D-Video“ in der Aktivität
- `src/three/terrain.ts`: Gelände aus Terrarium-DEM + Esri-Satellit als Mosaik, lokales Metersystem, bis 384² Vertices
- `src/three/scene.ts`: Satellit oder Gips-Relief mit Höhenlinien (Shader), Sonnenstand vom Flugtag, vario-gefärbter Track (wird nach und nach aufgedeckt) + blasse Gesamtroute, Vorhang für die Höhe über Grund (rot < 150 m), Thermiksäulen mit Steigwert/Höhengewinn, Windpfeil, Pilot mit Lotlinie, Dunst gegen sichtbare Geländeränder
- `src/three/director.ts`: Zeitraffer mit Smart-Highlights (Start, Top-3-Thermiken, höchster Punkt, Landung langsamer, Aufstieg schneller), Verfolgerkamera mit geglätteter Flugrichtung, beim Kreisen seitlich, Sichtlinie zum Piloten freigehalten, Intro-Überblick → Verfolgung → Outro-Orbit
- `src/three/hud.ts`: Titel, Datenleiste (Zeit, Höhe, Vario, Höhe über Grund, Speed, Strecke) mit Mini-Profil, Windrose, Entscheidungen (Thermik n, Thermik verlassen bei x m/s vs. Ø, Gleiten/Suche mit Zeit/Distanz/Höhenverlust), Abschluss-Karte mit Kennzahlen
- `src/three/render.ts`: MP4-Export (H.264) über WebCodecs + mp4-muxer, 9:16 oder 16:9, HD/Full HD, 30–180 s, Bild für Bild deterministisch
- Gemessen im Browser-Fenster der App: 30 s HD in < 25 s; der Encoder (~50 ms/Frame) ist der Engpass, nicht das Rendering (~4 ms/Frame)
- Noch offen: Erreichbarkeitsfläche (Gleitwinkel + Wind), Foto-Pins, freie Kamera / Bild-im-Bild, 4K

## 9. Kartenquellen (2026-11-02)
- 3D-Gelände: Auswahl Satellit (Esri), Satellit + Beschriftung (Esri Reference: Strassen, Grenzen, Orte), Sentinel-2 cloudless 2023 (EOX, CC BY-NC-SA), OpenTopoMap, OpenStreetMap, Gips-Relief
- Höhenmodell und Kartentextur werden getrennt geladen (`loadTerrain` / `loadTexture`), ein Kartenwechsel lädt nur die Textur; geladene Texturen bleiben im Speicher
- 2D-Karte: zusätzlich Sentinel-2 und zuschaltbare Beschriftung; Umschalten vor dem Laden der Karte ist abgefangen

## 10. Gleitschirm-Modell im 3D-Video (2026-11-02)
- `src/three/glider.ts`: prozeduraler Schirm (gewölbte Kappe mit 36 Zellen, Profil, Streifen, Pfeilung, Leinen mit Kaskade, Tragegurte, Pilot im Liegegurtzeug mit Helm)
- Ausrichtung pro Punkt aus dem Track (`attitude` in `model.ts`): Kurs aus ±3 s, Schräglage aus der koordinierten Kurve tan φ = v·ω/g, geglättet ±4 s, max. ±55°
- Grösse einstellbar (Regler „Grösse Gleitschirm“), nie kleiner als in echt; beim Aufstieg zu Fuss weiterhin Punkt
- Behoben: Entfalten des Kurswinkels lieferte nach der ersten vollen Drehung falsche Kurvenraten

## 11. Gleitzahl, Thermik-Drift, Höhe über Grund (2026-11-03)
- **Gleitstrecken** (`Glide` in `src/core/flight.ts`): jede nicht kreisende Phase ≥ 30 s und ≥ 300 m mit Distanz, Höhenverlust, Gleitzahl über Grund und **Gleitzahl gegenüber Luft** (Bodenvektor minus Wind aus den nächsten Kreisen, Schritt für Schritt). Dashboard: Tabelle „Gleitstrecken“ (sortierbar), 3D: Label „GZ 1:x“ auf Gleitstrecken ab 2 km, HUD „Gleiten / Suche“ mit laufender Gleitzahl seit Thermik-Ausstieg
- **Thermik-Drift**: Mittelpunkt jedes vollen Kreises = zeitgewichteter Mittelwert der Positionen über eine Umdrehung (bei zentrischem Kreisen hebt sich die Bewegung relativ zur Luft auf). Die Mittelpunkte (`Thermal.core`) zeichnen die geneigte Thermik nach; Wind aus ihrer Verschiebung über die Zeit (Kleinste Quadrate, `Thermal.drift`). Dashboard: Spalten „Wind (Drift)“ und „Versatz“ (unterster → oberster Kreis). 3D: Trichter folgt dem Kern, weisse Punkte = Kreismittelpunkte, gestrichelte Senkrechte ab Basis zeigt den Versatz
- Referenzflug: Drift-Wind und Kreisfit-Wind weichen im Median < 8 km/h (Vektor) voneinander ab; Wind NW → Kerne versetzt nach SE
- **Höhe über Grund** (`src/app/ground.ts`): Quelle wählbar im Dashboard, gilt auch fürs 3D-Video
  - Terrain Tiles (AWS, Standard, ohne Key)
  - OpenTopography Global DEM API (COP30, NASADEM, SRTM GL1/GL3, AW3D30, COP90), eigener API-Key; geladen als GeoTIFF in 0,25°-Kacheln nur entlang des Tracks, gespeichert in IndexedDB (`dem`). PixelIsPoint-Raster werden um ½ Zelle korrigiert
  - eigene DEM-Dateien: `.asc` (ESRI ASCII Grid), `.hgt` (SRTM), `.tif` (GeoTIFF in WGS84), gespeichert in IndexedDB (`demFiles`)
  - Punkte ausserhalb der gewählten Quelle → Terrain Tiles
  - Statistik: min./max./Ø über Grund, Zeit < 150 m (ohne erste/letzte Minute), Gelände Start/Landeplatz, Abweichung Track–Boden bei der Landung; Höhenprofil zeigt das Gelände, Tooltip die Höhe über Grund
  - 3D: Geländemodell bleibt Terrarium, Höhe über Grund im HUD und rote Vorhangfarbe kommen aus der gewählten Quelle

## 12. Schirm-Modelle (2026-11-03)
- `src/three/gliderDesigns.ts`: Presets nach Fotos des Piloten: Advance Omega X-Alps 3 (63 Zellen, Streckung 6,95; weiss, rotes Band über die Spannweite mit grüner Linie), Ozone Zeolite GT in Farbe ALPW (vorne und Flügelenden dunkelblau, hinterer Teil der Mitte weiss, Grenze mit hellblauem und lila Streifen, zur Hinterkante an den Enden auslaufend), Ozone Zeolite 2 GT (neongelb, Band hinter der Eintrittskante in Petrol mit Magenta-Abschnitten), Standard orange; Gurtzeug gelbgrün, Helm blau
- Zellenzahl und Streckung formen die Kappe; Muster (Mitte/Enden, vorne/hinten, Chevron, Streifen, Band mit Linie, Vorne/Enden mit Kurvenstreifen, Band in Abschnitten) und acht Farben sind im 3D-Video einstellbar und werden im Browser gespeichert (`PRESET_VERSION` erhöhen, wenn sich Presets ändern)
- Logos sind nicht nachgebildet; Vorschau dreht sich live im Einstellungsfeld (`GliderPreview.vue`)

## 13. Abschlussstatistik und Sprache (2026-11-03)
- Abschlussstatistik im Video (`summaryRows` in `src/three/hud.ts`): Wertung, Airtime, max. Höhe, max. Überhöhung über Start, erkurbelte Höhe (Summe aller Thermik-Gewinne), bestes Steigen/Sinken (30 s), bestes Gleiten (Gleitzahl + Strecke), Kreisen links | rechts in %, max. Wind mit Richtung, Tracklänge, Ø Speed, Thermiken, Aufstieg zu Fuss. Querformat zweispaltig, Hochformat einspaltig mit angepasster Zeilenhöhe
- `src/app/summary.ts` (Dashboard und Video gleich): bestes Gleiten nur aus Gleitstrecken ≥ 1,5 km mit ≥ 100 m Höhenverlust (sonst Werte wie 1:150 im Steigen); max. Wind nur aus Thermiken mit ≥ 4 Kreisen (Kreisfit aus 2 Kreisen lieferte Ausreisser bis 34 km/h bei Median 7 km/h)
- Sprache DE/EN (`src/app/i18n.ts`, Umschalter in der Seitenleiste, im Browser gespeichert): Dashboard-Statistik, Tabellen, Höhenprofil, Video-Einblendungen und 3D-Labels; Zahlen- und Datumsformat folgen der Sprache (de-CH / en-GB). Einstellungs- und Bedienelemente bleiben deutsch

## 14. Video: POIs, Glühwürmchen, Schirm-Dynamik, Partikel, Ton, Kamera (2026-11-03)
- **POIs** (`src/app/pois.ts`): Gipfel, Hütten, Pässe, Seen, Orte aus Wikidata (SPARQL, Bekanntheit = Anzahl Wikipedia-Artikel, Namen DE/EN), Ausweichquelle OpenStreetMap/Overpass; im Browser gespeichert (IndexedDB `pois`). Google Places nicht genutzt (kostenpflichtiger Key, Speichern der Daten untersagt). Auswahl: max. 14, nach Bekanntheit, Höhe und Nähe zum Track, mit Mindestabstand. Darstellung: senkrechter Stab (600 m) mit Namen und Höhe in Grossbuchstaben, blendet in der Ferne aus
- **Glühwürmchen**: Pilot als leuchtender, flackernder Punkt mit Leuchtspur der letzten ~4 % des Flugs (additiv); wählbar Schirm / Glühwürmchen / beides
- **Schirm-Dynamik** (`model.ts`, `scene.ts`): Nicken aus Änderung von Steigen und Speed (Einflug in Thermik: Schirm bleibt zurück, Ausflug: Vorschiessen), gedämpftes Wackeln nach jedem Thermik-Ausgang, stärker bei Seitenwind; Lage über Videobilder geglättet
- **Partikel** (`src/three/particles.ts`): Strömungslinien wie bei Windy in starken Thermiken (≥ 1,2 m/s, spiralförmig entlang des versetzten Kerns) und bei Steigen im Geradeausflug (≥ 30 s, ≥ 0,6 m/s; mit dem Wind und aufwärts), Bewegung in Videozeit
- **Ton** (`src/three/audio.ts`): Vario-Töne nach Steigen (Piepsen, Tonhöhe und Takt steigen mit dem Steigen) und Sinken (Dauerton), Schwellen einstellbar; Musik in drei Stilen (Ambient, Cinematic, Chill), im Code komponiert und damit frei von Rechten Dritter; oder eigene Audiodatei. Startsound beim Abheben (eigene Komposition: vier aufsteigende Glockentöne C6–E6–G6–C7 in 0,27 s mit Ausklang, im ersten Videobild in der Luft). Offline gerendert (OfflineAudioContext), in der Vorschau synchron abgespielt, im MP4 als AAC (Fallback Opus)
- **Kamera** (`director.ts`): Blickrichtung aus ±4 s Videozeit, höchstens 18°/s, Änderungen unter 12° ignoriert, weicher Übergang beim Kreisen. Gemessen (Flug 17.10.2025, 60 s): Drehrate Median 2,5°/s, 95 % unter 20°/s, 1 Richtungswechsel
- **Deckkraft**: Regler für die Einblendungen (Panels) und den 3D-Windpfeil (Standard 60 %)
