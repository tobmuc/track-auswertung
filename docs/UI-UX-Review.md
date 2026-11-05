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
