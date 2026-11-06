# UI/UX-Review – Track-Auswertung

Stand 05.11.2026, Version 0.2.0 (Build 13). Vorgehen nach dem Skill
[ui-ux-review](https://github.com/escapeboy/claude-code-kit/blob/master/01-global-optimization/skills/ui-ux-review/SKILL.md):
Designsystem, Komponenten, Responsive, Barrierefreiheit (WCAG 2.2), Interaktion.
Geprüft im Code und im Browser: Desktop 1254 px und Handy 375 × 812 px, Flug vom 17.09.2026 geladen.

Die Spalte **Status** sagt, was mit diesem Commit schon behoben ist.

## Designsystem

| Bereich | Befund |
|---|---|
| Farben | Tokens in `src/style.css:1-16` (`--bg`, `--panel`, `--panel-2`, `--line`, `--text`, `--muted`, `--accent` Orange, `--accent-2` Blau). Konsistent genutzt. Diagramme setzen die Werte als Konstanten (`ThermalCircles.vue:11-15`), passend zu den Tokens. |
| Kontrast Text | Gut. `--text` auf Panel 14,7:1, `--muted` auf Panel 5,9:1, auf Panel-2 5,3:1, Orange-Button 8,1:1. Alles über WCAG AA 4,5:1. |
| Kontrast Bedienelemente | Rahmen `--line` auf Panel nur **1,37:1**, Eingabefelder und Buttons sind kaum als solche erkennbar (WCAG 1.4.11 AA verlangt 3:1). |
| Typografie | 14 verschiedene Schriftgrössen (11–28 px plus `clamp` im Hero). Häufig: 12 px (18×), 13 px (10×), 14 px (9×). Keine Skala definiert. |
| Abstände | Frei gewählt (8/10/12/14/16/18/20/24 px). Keine Spacing-Tokens. |
| Komponenten | Buttons global gestylt, Panels als `.panel`. Diagramme als Canvas in `ProfileChart.vue` und `ThermalCircles.vue` mit doppelter Achsen-Logik (`niceStep` in beiden). |

## Befunde nach Priorität

### Kritisch

| # | Datei | Problem | Wirkung | WCAG | Status |
|---|---|---|---|---|---|
| K1 | `ActivityView.vue` Tabelle „Stärkste Thermiken“ | Tabelle 518 px breit ohne Scroll-Container. Die ganze Seite wird auf dem Handy 555 px breit und wackelt seitlich. | Auf jedem Handy kaputtes Layout. | 1.4.10 Reflow (AA) | ✅ eigener Scroll-Container |
| K2 | `App.vue` Seitenleiste mobil | Seitenleiste mit Aktivitätenliste und Fusszeile schiebt den Inhalt um 450 px nach unten. Auf dem Handy sieht man nach dem Öffnen einer Aktivität erst einmal keine Auswertung. | Nutzer meinen, es lädt nichts. | – | ✅ Liste auf dem Handy einklappbar, zu, sobald eine Aktivität offen ist; Inhalt beginnt bei 162 px |

### Hoch

| # | Datei | Problem | WCAG | Status |
|---|---|---|---|---|
| H1 | `style.css` | Kein sichtbarer Tastaturfokus; `ActivityView.vue:437` entfernt die Outline des Titelfelds sogar ausdrücklich. | 2.4.7 Focus Visible (AA) | ✅ globales `:focus-visible` (blauer Rahmen) |
| H2 | `style.css` | Rahmen der Bedienelemente 1,37:1. | 1.4.11 Non-text Contrast (AA) | ✅ `--control-line` 3,1:1 |
| H3 | `ActivityView.vue:288`, `VideoView.vue:570` | `<a><button>`: Button im Link. Zwei Tab-Stopps, Screenreader melden Unsinn. | 4.1.2 Name, Role, Value (A) | ✅ Link mit Button-Stil (`.btn`) |
| H4 | `App.vue` Ablagefläche „Track laden“ | `div` mit Klick, nicht per Tastatur erreichbar. | 2.1.1 Keyboard (A) | ✅ `role="button"`, `tabindex`, Enter/Leertaste |
| H5 | Touch-Ziele | DE/EN 29 × 20 px, Kartenknöpfe 27 px, Sortierknöpfe 25 px, PNG 22 px. | 2.5.8 Target Size (AA, min. 24 px; Empfehlung 44 px) | ✅ auf Touch-Geräten mind. 44 px |
| H6 | `index.html:2` | `lang="de"` fest, auch wenn Englisch gewählt ist. | 3.1.1 Language of Page (A) | ✅ folgt der Sprachwahl |

### Mittel

| # | Datei | Problem | WCAG | Status |
|---|---|---|---|---|
| M1 | `ActivityView.vue` Kopf | Keine `h1` auf der Aktivitätsseite (Titel ist ein Eingabefeld); Titelfeld und Sportart-Auswahl ohne Beschriftung. | 1.3.1 Info and Relationships (A), 4.1.2 (A) | ✅ unsichtbare `h1`, `aria-label` |
| M2 | Diagramme (Canvas) | Höhenprofil und Kreisdiagramme ohne Textalternative. | 1.1.1 Non-text Content (A) | ✅ `role="img"` mit Beschreibung. Offen: Datentabelle als Alternative |
| M3 | KPI-Kacheln mobil | Eine Kachel pro Zeile, 4 Kacheln füllen den ganzen Bildschirm. | – | ✅ 2 Spalten |
| M4 | Fehlerseite „Aktivität nicht gefunden“ | Sackgasse ohne Weg zurück; Fehler wird nicht angesagt. | 4.1.3 Status Messages (AA) | ✅ `role="alert"` + „Zur Startseite“ |
| M5 | Titel mobil | Titel abgeschnitten („… September 202“). | – | ✅ volle Breite, 20 px |
| M6 | Löschen | `confirm()` des Browsers (`ActivityView.vue:79`): nicht übersetzbar, sieht fremd aus, kein Rückgängig. | – | offen: eigener Dialog oder „Rückgängig“-Toast |
| M7 | Hover-Kopplung | Profil ↔ Karte ↔ Tabellenzeilen nur per Maus (`@mouseenter`). Auf Touch und per Tastatur fehlt die Verknüpfung. | 2.1.1 (A) | offen: Tippen/Fokus wählt Zeitpunkt |
| M8 | Lange Seite | Dashboard auf dem Handy ~6800 px lang, keine Sprungmarken. | 2.4.1 Bypass Blocks (A) | offen: Inhaltsnavigation (Karte · Flug · Thermik · Gleiten) |

### Niedrig

| # | Problem | Status |
|---|---|---|
| N1 | 14 Schriftgrössen ohne Skala; Spacing frei. Vorschlag: Tokens `--fs-xs 12 / sm 13 / md 14 / lg 18 / xl 26`, `--sp-1 4 … --sp-6 24`. | offen |
| N2 | Doppelte Diagramm-Hilfen (`niceStep`, Achsen) in zwei Komponenten. | offen: `ui/chart.ts` |
| N3 | Ladezustand „Analysiere Track …“ nur Text; bei 4 h Flug bis 10 s auf dem Handy. | offen: Fortschrittsbalken / Skeleton |
| N4 | Aktivitätenliste ohne Suche/Filter; bei vielen Flügen unübersichtlich. | offen, siehe Roadmap „Flugbuch“ |
| N5 | `aria-expanded` des Listen-Knopfs steht auf dem Desktop auch auf „false“ (Liste ist dort immer sichtbar). | offen, kosmetisch |

## Responsive

- Breakpoint: nur `max-width: 800px` (`App.vue`, `ActivityView.vue`), dazu 1000 px im Hero. Desktop-first.
- Nach den Korrekturen: kein horizontales Scrollen mehr bei 375 px (gemessen: Seitenbreite 375 = Fensterbreite).
- Tabellen scrollen in ihren Panels; Spaltenköpfe der Gleitstrecken bleiben oben stehen.
- 3D-Video-Ansicht: Vorschau und Steuerung untereinander, Umschalter Schirm/Glühwürmchen erreichbar (frühere Prüfung).

## Zusammenfassung

| | Gefunden | Behoben in diesem Commit |
|---|---|---|
| Kritisch | 2 | 2 |
| Hoch | 6 | 6 |
| Mittel | 8 | 5 |
| Niedrig | 5 | 0 |

## Nächste Schritte

1. **Sofort (erledigt):** K1–K2, H1–H6, M1–M5.
2. **Als Nächstes:** M7 Touch-Auswahl auf Profil/Karte, M8 Sprungnavigation, M6 eigener Löschen-Dialog mit Rückgängig.
3. **Aufräumen:** N1 Typo-/Spacing-Tokens, N2 gemeinsames Chart-Modul, N3 Ladeanzeige.

---

## Warum die Oberfläche „nach KI“ aussieht

Abgeglichen mit den Regeln aus Anthropics Skill
[frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), dem
Datenvisualisierungs-Kapitel aus [Nutlope/hallmark](https://github.com/Nutlope/hallmark) und
[pbakaus/impeccable](https://github.com/pbakaus/impeccable). Jede dieser Quellen nennt typische
Erkennungsmerkmale generierter Oberflächen. Bei uns treffen fast alle zu:

| Merkmal („Tell“) | Wo bei uns |
|---|---|
| Fast-schwarzer Hintergrund mit **einer** grellen Akzentfarbe | `#0d1117` (das GitHub-Dark-Grau) + Orange `#ff8a3d`, `style.css:2-8` |
| Grossgeschriebene, gesperrte Mini-Labels über jedem Block | `.label` (11 px, uppercase, 0.06em) `style.css:32`, auf allen KPI-Kacheln und Gruppen |
| Eyebrow über der Überschrift, mit Mittelpunkten verbunden | „GLEITSCHIRM · HIKE & FLY · DRACHEN“ im Hero; Meta-Zeilen „Flug 12:21–16:38 · OXA3 · Asia/Bishkek“ |
| Ein Wort der Überschrift farbig hervorgehoben | „Dein Flug in 3D. **In einer Minute.**“ (orange) |
| Emoji-Chips als Feature-Liste | 🏆 🌀 🎬 🪂 ☀️ 🔒 im Hero |
| Alles in gleich runden Karten (12 px) mit gleichem Rahmen | `.panel`, KPI-Kacheln, Diagrammboxen, Chips – keine Hierarchie |
| KPI-Konfetti | vier gleich grosse Zahlenkacheln oben, fünf weitere bei Kreisformen |
| Regenbogen-Farben in Diagrammen | Vario-Skala mit 8 Farbtönen in Histogramm, Höhenbändern, Tageszeit |
| Pulsierender „Live“-Punkt ohne Live-Daten | Beschriftung des Demo-Videos |
| Systemschrift / Inter ohne bewusste Wahl | `style.css:13` |

## Was nicht nach KI aussieht: Richtung aus dem Thema

Die Vorschläge der Skills laufen auf dasselbe hinaus: **Gestaltung aus dem Gegenstand ableiten**, nicht aus
einem App-Baukasten. Beim Gleitschirmfliegen heisst das: Gelände, Karte, Luft, Instrumente. Die zwei
tracktale-Screenshots zeigen das gut: Das Gelände trägt das Bild, die Zahlen sitzen ruhig darüber, die
Einheiten sind klein und neben der Zahl, kein Chrom drumherum.

Drei mögliche Richtungen (nur eine wählen und konsequent umsetzen):

1. **Landeskarte.** Heller Grund wie eine topografische Karte (kein Creme-Ton, sondern kühles Kartenweiss),
   Höhenlinien als Hintergrundtextur, Gewässerblau und Waldgrün als Funktionsfarben, Spur in Rot wie ein
   eingezeichneter Wanderweg. Schrift: eine Grotesk mit Kartencharakter (z. B. *Frutiger*-artig, frei:
   *Source Sans 3* oder *Public Sans*). Zahlen tabellarisch.
2. **Cockpit / Instrument.** Dunkel bleibt, aber als Instrument: Ziffern gross und schmal (z. B. *Barlow
   Condensed*), Skalen statt Karten, Farbe nur mit Bedeutung (Steigen grün, Sinken rot/blau wie im Vario),
   keine Kacheln, sondern Instrumentenzeilen mit feinen Linien.
3. **Gelände zuerst.** Die Karte bzw. das 3D-Gelände füllt die Seite, Kennzahlen liegen als ruhige,
   halbtransparente Leiste darauf (wie in den tracktale-Screenshots), Details klappen als Blatt von unten
   auf. Am nächsten an der 3D-Video-Ästhetik der App.

Gemeinsam für alle drei:
- Labels in normaler Schreibweise, keine Grossbuchstaben-Eyebrows, keine Mittelpunkt-Ketten.
- Eine Schriftfamilie bewusst wählen, klare Grössenskala (5 Stufen).
- Unterschiedliche Formen für unterschiedliche Inhalte: Kennzahlen als Zeile, nicht als Kachelwand; Tabellen
  ohne Kartenrahmen; nur die Karte bekommt einen Rahmen.
- Diagramme mit einer Akzent-Serie, Rest neutral (hallmark: „one series that argues“).
- Emoji raus aus der Oberfläche; wenn Symbole, dann eigene, schlichte Linien-Icons.
- Animation nur, wo der Nutzer etwas auslöst.

## Weitere Skill-Repos zum Thema

| Repo | Sterne | Lizenz | Kern |
|---|---|---|---|
| [anthropics/skills – frontend-design](https://github.com/anthropics/skills) | 188 k | eigene | Liste der häufigsten KI-Merkmale, Zwei-Schritt-Plan (Tokens → Kritik → Bau) |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | 103 k | Apache-2.0 | Befehle `critique`, `audit`, `polish`, „AI slop“-Erkennung, Qualitätsboden |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 110 k | MIT | Art Direction mit Referenzbildern und Browser-Check statt Standardmuster |
| [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | 48 k | – | Anti-Slop-Skill; starkes Kapitel zu Diagrammen und Dark Mode |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 145 k | MIT | Stil-/Paletten-/Schrift-Datenbank nach Branche |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 126 k | MIT | DESIGN.md-Vorlagen echter Marken als Ausgangspunkt |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | 54 k | MIT | Feinschliff für Interaktion und Animation |
| [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | 4 k | MIT | Kleine Details, die eine Oberfläche hochwertig wirken lassen |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | 1 k | MIT | Prüfliste für Web-Oberflächen (Fokus, Formulare, Zahlen, Ladezustände) |

## Überarbeitung nach dem Skill design-taste (v0.7.0)

Grundlage: [h3nryprod01/design-taste](https://github.com/h3nryprod01/design-taste) v2.1.0 (SKILL.md und
`reference/*.md`). Design Read und Regler stehen in [DESIGN.md](../DESIGN.md). Modus: Operate für Dashboard
und 3D-Video, Persuade (zurückhaltend) für den ersten Bildschirm der Startseite. Redesign-Art: bewahren
(Navigation, Begriffe, Rechtstexte und Consent unverändert).

| Vorher | Nachher | Warum |
|---|---|---|
| Startseite: Video-Bühne 72vh mit Text auf Verlauf, Ablagefläche schaut unten herein | Erster Bildschirm genau 100dvh minus Kopfleiste, Text links, Video rechts, darunter Haarlinie und ruhiger Abschnitt | Hero füllt den Bildschirm, nichts vom nächsten Abschnitt ragt hinein; keine Schrift über bewegtem Bild |
| h1 „Dein Flug, wie er war.“ | „Flüge auswerten und als 3D-Video teilen“ mit Hinweis „Für Gleitschirm, Hike & Fly und Drachen“ | Überschrift nennt, was es ist, der Hinweis für wen; kein Slogan |
| Unterzeile 40 Wörter plus Bildunterschrift „Im Video: …“ | Unterzeile 20 Wörter mit der Zahl „81 km Streckenflug in 30 Sekunden“ | Persuade: höchstens 20 Wörter, keine Captions an Bildern |
| Hauptaktion nur in der Kopfleiste und in einer gestrichelten Ablagefläche | Ein Button „Track laden“ im ersten Bildschirm; Kopfleiste ohne zweiten Aufruf; Ablegen auf der ganzen Seite bleibt | Hauptaktion ohne Scrollen sichtbar, kein doppelter Aufruf |
| Gewichte 400 bis 750 gemischt | 400 / 500 / 600 als Tokens | Hierarchie aus Grösse und wenig Gewichtsstufen |
| Skala 13/15/18/24/40, h3 so gross wie Text, Einzelwerte 10, 12, 34 px | Feste Stufen 13/16/19/23/28 und eine fliessende Display-Grösse | Operate: feste Stufen im Verhältnis 1,2, nichts unter 13 px |
| Buttons 27-34 px, Hover hellt auf, kein Klick-Feedback | 36 px, Hauptaktion 40 px (Startseite 48), Touch 44 px; Hover nur mit Maus, Klick `scale(0.97)`, 150 ms ease-out | Alle Zustände sichtbar, Bewegung kurz und nur als Rückmeldung |
| Kopfleiste halbtransparent mit Blur | Opak mit Haarlinie | Ruhige Navigation, kein Glas-Effekt |
| Gedankenstriche als Platzhalter und in Zeitspannen („12:21–16:38“, „–“) | Bindestrich („12:21-16:38“, „-“) | Keine U+2013/U+2014 im sichtbaren Text |
| Emoji in den Darstellungsknöpfen (🪂, ✨) und „⤓ PNG“ | Nur Text: „Schirm“, „Glühwürmchen“, „Beides“, „PNG speichern“ | Keine Emoji, Buttons als Verb und Ding |
| Gezeichneter Pfeil (SVG) im Flug-Menü, Seitenstreifen am gewählten Flug | CSS-Winkel; gewählter Flug mit getönter Fläche und gelbem Titel | Keine selbstgezeichneten Icons, keine Seitenstreifen |
| „Löschen“ | „Flug löschen“ | Verb und Ding |
| `#000`/`#fff` an Video-Rahmen und Kartenmarken | `--night` `#0d1311`, `--snow` | Kein reines Schwarz oder Weiss |
| Zahlen-z-index (25, 30, 40, 50, 90, 100) im Code verteilt | Tokens `--z-*` | Semantische Ebenen statt Zauberzahlen |

### Pre-Flight

Das Prüfskript des Skills (`scripts/preflight.mjs`) lag nicht vor; geprüft wurde von Hand im Browser bei
1440, 1024, 768 und 375 px sowie per Messung im DOM.

| Punkt | Ergebnis |
|---|---|
| Modus, Design Read, Regler erklärt | ja, DESIGN.md |
| Keine U+2013/U+2014 im sichtbaren Text | 0 Treffer im Dashboard (`document.body.innerText`) und im Quelltext ausserhalb von Kommentaren |
| Thema, Akzent und Radius festgelegt | ein dunkles Thema mit Begründung, ein Akzent, Radius 6/8 px |
| Kontrast AA | Text 7,4:1 und mehr, Button-Text auf Gelb dunkel |
| Typo-Disziplin | Hero-Überschrift 2 Zeilen bei 1440, 1024, 768 (1 Zeile) und 375 px; keine Button-Beschriftung bricht um |
| Bewegung | nur Farbe und Klick, 150 ms, reduziert ohne Transform |
| Responsive | Startseite einspaltig unter 1024 px, kein Querscrollen bei 375 px, Hero mit `dvh` |
| Zustände | Hover, Fokus, Klick, deaktiviert, Laden („Analysiere …“) vorhanden |
| Keine falschen Bilder | echtes Demo-Video, keine Platzhalter; Logo bleibt als Marke |
| Keine KI-Merkmale | keine Grossbuchstaben-Eyebrows, keine Emoji, keine Seitenstreifen, keine Glas-Kopfleiste |

### Bewusste Abweichungen

- Die Kartenknöpfe über der Karte bleiben auf dem Desktop kompakter als 44 px (Touch-Geräte: 44 px).
- Die Anzeige auf der Karte (Titel und Messwerte über einem Verlauf) bleibt: Operate erlaubt Schrift über
  Bildern mit Hinterlegung, und die Karte ist hier das Werkzeug.
- Kein heller Modus: ein festes dunkles Thema, begründet in DESIGN.md.
- Dichte Definitionslisten mit Haarlinie je Zeile im Dashboard sind für Operate richtig; die Persuade-Regel
  gegen Linien in Spezifikationstabellen gilt dort nicht.
- Texte im 3D-Video (HUD auf dem Canvas) folgen den Regeln für fehlende Werte, ihre Gestaltung ist Teil
  des Videos und wurde nicht neu gesetzt.
