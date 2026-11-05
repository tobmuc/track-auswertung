# Design – „Gelände zuerst“

Die Karte und das 3D-Gelände tragen die Seite, die Oberfläche tritt zurück. Diese Datei hält die Regeln
fest, damit neue Teile (auch von KI-Assistenten gebaute) nicht in den üblichen App-Baukasten-Look
zurückfallen. Hintergrund: [docs/UI-UX-Review.md](docs/UI-UX-Review.md), Abschnitt „Warum die Oberfläche
nach KI aussieht“.

## Farben (aus dem Gelände)

| Token | Wert | Rolle |
|---|---|---|
| `--ground` | `#1b2421` | Seitengrund: beschatteter Wald |
| `--ground-2` / `--ground-3` | `#232e2a` / `#2b3833` | leicht erhöhte Flächen (Menü, Balken-Hintergrund) |
| `--rule` | `#34423d` | Haarlinien zwischen Abschnitten und Zeilen |
| `--control-line` | `#6f8279` | Rahmen von Bedienelementen (≥ 3:1) |
| `--snow` | `#f1f0ea` | Text |
| `--lichen` | `#aab4ab` | Nebentext, Beschriftungen (7,4:1) |
| `--lift` | `#f0c24b` | Sonne/Thermik: **eine** Hauptaktion je Ansicht, Steigen in Diagrammen |
| `--sky` | `#8ccbe6` | Links, Fokus, Sinken, Linkskreise |

Farbe trägt Bedeutung: Gelb = Steigen/Hauptaktion, Blau = Luft/Sinken/Links. Keine weiteren Akzentfarben
in der Oberfläche. Die Kartenspur behält ihre Phasenfarben (sie sind Daten, nicht Dekoration).

## Schrift

*Archivo Variable* (lokal gebündelt, `@fontsource-variable/archivo`), eine Familie für alles.
Überschriften und grosse Zahlen mit Breitenachse (`'wdth' 118–125`), Fliesstext normal.
Skala: 13 / 15 / 18 / 24 / 40 px (`--fs-1` … `--fs-5`). Zahlen immer tabellarisch.

## Layout

```
┌ Kopfleiste: Name · Flug-Auswahl · Track laden · DE/EN ────────────┐
│████████████ Karte über die volle Breite ████████████████████████│
│ Titel (40 px, auf dem Gelände)                                   │
│ Datum, Zeiten, Schirm                                            │
│ 80,80 km   96,96 P   4h 17m   4'073 m     ← Anzeige, keine Kacheln│
└──────────────────────────────────────────────────────────────────┘
  Werkzeuge (Sportart, Wertung, 3D-Video)               max. 1120 px
  Höhenprofil
  ── Haarlinie ── Abschnitt „Flug“: Definitionslisten in Spalten
  ── Haarlinie ── Tabellen ohne Rahmen
```

## Regeln

- Labels in normaler Schreibweise. **Keine** Grossbuchstaben-Eyebrows, keine gesperrte Schrift.
- Keine Mittelpunkt-Ketten („A · B · C“) – Kommas oder eigene Zeilen.
- Kein einzelnes farbiges Wort in Überschriften.
- Keine Emoji in der Oberfläche; Symbole als schlichte Linien-SVG in `currentColor`.
- Abschnitte trennen durch Abstand und Haarlinie, nicht durch Karten mit Rahmen und Radius.
  Ein Rahmen nur, wo etwas wirklich schwebt (Menü, Consent-Dialog).
- Diagramme: eine Akzent-Serie (Gelb), Rest neutral; Sinken in Blau. Keine Regenbogen-Skalen ausser auf
  der Karte, wo die Farbe den Messwert codiert.
- Bewegung nur als Antwort auf eine Aktion; keine einfliegenden Abschnitte.
- Qualitätsboden: sichtbarer Fokus, 44-px-Touchziele, kein Querscrollen bei 375 px, Kontraste AA.
