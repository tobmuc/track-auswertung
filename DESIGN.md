# Design: „Gelände zuerst“

Die Karte und das 3D-Gelände tragen die Seite, die Oberfläche tritt zurück. Diese Datei hält die Regeln
fest, damit neue Teile (auch von KI-Assistenten gebaute) nicht in den üblichen App-Baukasten-Look
zurückfallen. Grundlage ist der Skill [design-taste](https://github.com/h3nryprod01/design-taste)
(v2.1.0); Hintergrund und Befunde: [docs/UI-UX-Review.md](docs/UI-UX-Review.md).

## Design Read

> Reading this as: Werkzeug (Flugauswertung) mit kleiner Startseite, für Gleitschirm-, Hike-&-Fly- und
> Drachenpiloten, mit einer ruhigen, dunklen Gelände- und Instrumentensprache, auf eigenem Token-System
> mit Archivo (kein offizielles Design-System).

| Fläche | Modus | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY |
|---|---|---|---|---|
| Dashboard, 3D-Video, Diagramme | Operate | 4 | 3 | 6 |
| Startseite (erster Bildschirm) | Persuade, zurückhaltend | 6 | 4 | 3 |

Ein festes dunkles Thema statt Hell/Dunkel: Piloten schauen Satellitengelände und 3D-Video an, oft abends
nach dem Flug; ein dunkler Rahmen in der Farbe von beschattetem Wald lässt die Bilder wirken.

## Farben (aus dem Gelände)

| Token | Wert | Rolle |
|---|---|---|
| `--ground` | `#1b2421` | Seitengrund: beschatteter Wald |
| `--ground-2` / `--ground-3` | `#232e2a` / `#2b3833` | zweite Ebene (Menü, Einstellungen, ausgewählte Zeile) |
| `--rule` | `#34423d` | Haarlinien zwischen Abschnitten und Zeilen |
| `--control-line` | `#6f8279` | Rahmen von Bedienelementen (≥ 3:1) |
| `--snow` | `#f1f0ea` | Text (nie reines Weiss) |
| `--lichen` | `#aab4ab` | Nebentext, Beschriftungen (7,4:1) |
| `--lift` | `#f0c24b` | Sonne/Thermik: **eine** Hauptaktion je Ansicht, Auswahl, Steigen in Diagrammen |
| `--sky` | `#8ccbe6` | Links, Fokus, Sinken, Linkskreise |
| `--night` | `#0d1311` | hinter Video und 3D (nie reines Schwarz) |

Farbe trägt Bedeutung: Gelb = Steigen/Hauptaktion, Blau = Luft/Sinken/Links. Keine weiteren Akzentfarben
in der Oberfläche. Die Kartenspur behält ihre Phasenfarben (sie sind Daten, nicht Dekoration).

## Schrift

*Archivo Variable* (lokal gebündelt, `@fontsource-variable/archivo`), eine Familie für alles.
Überschriften und grosse Zahlen mit Breitenachse (`'wdth' 118-125`), Fliesstext normal. Zahlen immer
tabellarisch.

| Token | Grösse | Einsatz |
|---|---|---|
| `--fs-1` | 13 px | Beschriftungen, Tabellen, Hinweise (nichts kleiner) |
| `--fs-2` | 16 px | Fliesstext, Buttons |
| `--fs-3` | 19 px | Lead, h3, Fieldset-Titel |
| `--fs-4` | 23 px | h2 |
| `--fs-5` | 28 px | Messwerte (Anzeige auf der Karte, Kreis-Kennzahlen) |
| `--fs-display` | 36-48 px, fliessend | Überschrift der Startseite und Flugtitel auf der Karte |

Feste Stufen im Verhältnis von etwa 1,2 (Operate). Gewichte: 400 Text, 500 Beschriftungen und Buttons,
600 Überschriften und Messwerte. Zeilenhöhe 1,55 im Text, 1,15 in Überschriften, `text-wrap: balance`.

## Layout

```
┌ Kopfleiste (56 px, opak, Haarlinie): Name, Flug-Auswahl, Track laden, DE/EN ┐
│ Startseite: erster Bildschirm (100dvh - Kopfleiste)                         │
│   links Text (5 von 12 Spalten): Hinweis, h1, Unterzeile, Track laden       │
│   rechts Demo-Video (7 Spalten)        Handy: Text zuerst, Video darunter   │
│ ── Haarlinie ── Was die Auswertung zeigt (2 Spalten)  |  Deine Flüge        │
│                                                                             │
│ Flug: Karte, Titel und Anzeige auf dem Gelände                              │
│   Werkzeuge (Sportart, Wertung, Zeitzone, 3D-Video erstellen)               │
│   Höhenprofil, Abschnitte mit Definitionslisten, Tabellen ohne Rahmen       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Bedienelemente

- Buttons: Höhe 36 px, Hauptaktion 40 px (Startseite 48 px), auf Touch-Geräten mindestens 44 px. Radius
  6 px für Bedienelemente, 8 px für Flächen (eine weiche Radius-Skala).
- Genau ein gelber Button je Ansicht. Auf der Startseite ist das „Track laden“ im ersten Bildschirm, im
  Flug „3D-Video erstellen“ bzw. „Video erstellen“; „Track laden“ in der Kopfleiste ist dann normal.
- Hover nur mit Maus (`hover: hover` und `pointer: fine`): Rahmen wird hell, die Hauptaktion dunkelt um
  14 % zum Grund ab. Klick: `scale(0.97)`. Übergänge 150 ms mit `cubic-bezier(0.23, 1, 0.32, 1)`, nie
  `transition: all`. Bei reduzierter Bewegung nur Farbwechsel.
- Fokus: 2 px Ring in `--sky`, 2 px Abstand, nur bei Tastatur (`:focus-visible`).
- Links: dezente Unterstreichung, beim Hover voll.
- Ebenen als Tokens: `--z-scrim` 25, `--z-sticky` 30, `--z-dropdown` 40, `--z-fullscreen` 50,
  `--z-overlay` 90, `--z-modal` 100.

## Regeln

- Labels in normaler Schreibweise. **Keine** Grossbuchstaben-Eyebrows, keine gesperrte Schrift.
- Keine Gedankenstriche (U+2013, U+2014) im sichtbaren Text: Kommas, Doppelpunkte, Klammern; Zeit- und
  Zahlenbereiche mit Bindestrich („12:21-16:38“), fehlende Werte als „-“.
- Keine Mittelpunkt-Ketten („A · B · C“): Kommas oder eigene Zeilen.
- Kein einzelnes farbiges Wort in Überschriften.
- Keine Emoji und keine selbstgezeichneten Icons in der Oberfläche. Pfeile im Menü als CSS-Winkel.
- Keine farbigen Seitenstreifen an Listen, Karten oder Hinweisen; Auswahl über eine getönte Fläche.
- Abschnitte trennen durch Abstand und Haarlinie, nicht durch Karten mit Rahmen und Radius.
  Ein Rahmen nur, wo etwas wirklich schwebt (Menü, Consent-Dialog) oder eine zweite Ebene ist
  (Einstellungen des Videos). Schatten höchstens 8 px Unschärfe.
- Buttons heissen nach Verb und Ding („Track laden“, „Flug löschen“, „PNG speichern“).
- Startseite: Überschrift höchstens zwei Zeilen, Unterzeile höchstens 20 Wörter mit einer echten Zahl,
  Hauptaktion ohne Scrollen sichtbar, keine Bildunterschrift am Video, keine Zeile unter dem Button.
- Diagramme: eine Akzent-Serie (Gelb), Rest neutral; Sinken in Blau. Keine Regenbogen-Skalen ausser auf
  der Karte, wo die Farbe den Messwert codiert.
- Bewegung nur als Antwort auf eine Aktion; keine einfliegenden Abschnitte.
- Qualitätsboden: sichtbarer Fokus, 44-px-Touchziele, kein Querscrollen bei 375 px, Kontraste AA.
