# Roadmap – Auswertungen und Features

Stand 05.11.2026. Grundlage: eigene Flugdaten-Analyse, die Methodenseiten von steiglinie.eu
(„Berechnung & Datenqualität“, „Kreisform, Radius & Durchmesser“, „Tagesverlauf & Zentrieren“,
„XC-Effizienz · MacCready“, „Gleitstrecken vergleichen“, „Gleiten: persönliche Referenz“, „Talquerung“,
„Flugtechnik“), die Funktionsseiten von tracktale.io und Open-Source-Projekte auf GitHub.

Leitplanke bleibt: **alles läuft lokal im Browser**, ohne Konto und Server. Funktionen, die einen Server
brauchen (Gruppen, Forum, Live-Planung, Konten, KI-Berichte), sind bewusst nicht dabei.

---

## 1. Neu in diesem Stand: Fahrt durch die Luft und Beschleuniger

**Prinzip – Winddreieck:** GPS liefert die Geschwindigkeit über Grund als Vektor. Der Wind kommt aus den
Thermikkreisen (Kreis-Fit der Grundgeschwindigkeiten, wie im Vario). Für jeden Punkt im Geradeausflug gilt

```
Fahrt durch die Luft = | v_Grund − v_Wind |        (Vektoren, gemittelt über 10 s)
Wind entlang der Strecke = v_Wind · Richtung_Grund  (+ Rückenwind, − Gegenwind)
```

Das ist genauer als „Grundgeschwindigkeit minus Wind“, weil es auch Seitenwind richtig behandelt.

| Kennzahl | Definition |
|---|---|
| Trimmfahrt (geschätzt) | unteres Drittel (33. Perzentil) der Fahrt im Geradeausflug |
| Beschleunigt | Fahrt ≥ Trimm + 6 km/h, mindestens 20 s am Stück; Einbrüche bis 6 s werden überbrückt, Kreisen beendet eine Phase |
| Max. Fahrt (20 s) | höchster 20-s-Mittelwert |
| Beschleunigt bei Gegen-/Rückenwind | Anteil beschleunigter Zeit, wenn der Wind entlang der Strecke < −5 bzw. > +5 km/h ist |
| Gleitstrecken | neue Spalten „Fahrt Luft“ (orange = beschleunigt) und „Wind ±“ |

**Dein Flug vom 17.09.:** Trimm 41 km/h, max. 68 km/h. Beschleunigt 59 min, das sind 36 % des
Geradeausflugs, in 34 Phasen. Bei Gegenwind 42 % beschleunigt, bei Rückenwind 23 %. Das ist richtiges
Sollfahrt-Verhalten. Die Werte passen zu einem Zweileiner wie dem OXA3.

**Grenzen:** Der Wind stammt aus der zeitlich nächsten Thermik, oft in anderer Höhe. Bei Windscherung
oder langer Talquerung kann er abweichen. Steigende oder sinkende Luft ändert die Fahrt nicht, wohl aber
das Sinken. Deshalb wird nur die Fahrt bewertet, nicht das Sinken. Ein echtes Vario mit Staudruck-Sensor
(TAS im IGC, I-Record `TAS`) wäre genauer; das lässt sich ergänzen (siehe 3).

## 2. Weitere Ableitungen: Wie gut wurde geflogen?

Was sich aus einem IGC zusätzlich sicher oder mit Vorsicht ableiten lässt. Sortiert nach Aussagekraft.

| Auswertung | Was es zeigt | Berechnung | Aussagekraft |
|---|---|---|---|
| **Netto-Variometer (Luftmasse)** | wo die Luft stieg oder sank, auch im Geradeausflug | Vario − Polaren-Sinken bei der aktuellen Fahrt; Polare aus Trimm-/Beschleunigt-Punkten des Fluges geschätzt | hoch, mit eigener Polare |
| **Sollfahrt / MacCready-Abgleich** | ob die Fahrt zum nächsten Bart passte | geflogene Fahrt je Gleitstrecke gegen MC-Geschwindigkeit für das Steigen des nächsten Barts | mittel – steiglinie warnt zu Recht: Kontext fehlt |
| **Thermik-Ausstieg** | zu lange im schwachen Teil oben gekurbelt? | Steigen der letzten 2 Kreise vs. bestes 60-s-Steigen der Thermik; Zeit unter 50 % | hoch |
| **Durchflogene Steigzonen** | ausgelassene Bärte | Geradeausflug mit Netto-Steigen > 1 m/s über ≥ 15 s ohne Einkreisen | mittel |
| **Suchzeit** | Zeit zwischen Gleitende und zentriertem Kreisen | Kreisbeginn bis Zentriert (schon da) + Geradeaus-Suchmuster (S-Kurven) davor | mittel |
| **Kreis-Konstanz** | sauberes, gleichmässiges Kurbeln | Streuung von Radius und Kreiszeit je Thermik; Achsenverhältnis der Form (Mittelpunkte überlagert, Drift abgezogen) | hoch |
| **Richtungswechsel im Bart** | Umstellen der Kreisrichtung | Wechsel links↔rechts innerhalb einer Thermik | hoch (reine Zählung) |
| **Höhenband-Nutzung** | in welchem Teil zwischen Gelände und Basis geflogen | Anteil Zeit im oberen/mittleren/unteren Drittel zwischen AGL 0 und Wolkenbasis | hoch |
| **Low Saves** | Retten aus tiefer Lage | Minimum AGL < 300 m, danach > 500 m Höhengewinn | hoch |
| **Kursumweg** | wie direkt zwischen den Thermiken | geflogene Strecke / Luftlinie je Gleitstrecke | hoch |
| **XC-Schnitt** | Reisegeschwindigkeit | Wertungsstrecke / Zeit vom ersten Wendepunkt bis zum letzten | hoch |
| **Talquerungen** | längste Querungen mit Gegen-/Rückenwind | Gleitstrecke mit grösstem Geländeabfall darunter; Wind aus Kreisen oder Open-Meteo in Flughöhe | hoch |
| **Steilspirale** | Sinkwerte und Ausleitung (SIV) | anhaltendes Sinken ≥ 7 m/s innerhalb einer Umdrehung (steiglinie-Vorgabe), Drehrate > 60°/s | mittel – nur Bewegung, kein Schirmzustand |
| **Schnelle Acht / Wingover** | Figurenzeit | zwei gegenläufige Vollkreise; Wingover nur als Beobachtung | niedrig |
| **Start und Landung** | Startlauf, Landevolte | Bodengeschwindigkeit/Vario vor dem Abheben; Kurven und Sinken in den letzten 3 min | mittel |

## 3. Hilfreiche Open-Source-Projekte

| Projekt | Lizenz | Nutzen für uns |
|---|---|---|
| [XCSoar/XCSoar](https://github.com/XCSoar/XCSoar) (C++, aktiv) | GPL-2.0 | Referenz für Wind: `src/Computer/Wind/CirclingWind.cpp` (Wind aus Kreisen) und `WindEKF.cpp` (Kalman-Filter aus Fahrt + GPS, funktioniert auch im Geradeausflug), dazu Polare/MacCready. **GPL:** nur Verfahren nachbauen, keinen Code übernehmen. |
| [LK8000/LK8000](https://github.com/LK8000/LK8000) (C++, aktiv) | GPL-2.0 | Thermik-Historie, Windberechnung, Gleitrechner – ebenfalls nur als Referenz. |
| [marcin-osowski/igc_lib](https://github.com/marcin-osowski/igc_lib) (Python) | MIT | Thermik-/Gleiterkennung per Hidden-Markov-Modell (Viterbi) – robuster als feste Schwellen; frei übernehmbar. |
| [Turbo87/igc-parser](https://github.com/Turbo87/igc-parser) (TypeScript) | MIT | Vollständiger IGC-Parser inkl. I-Record-Erweiterungen (z. B. `TAS`, `IAS`, Beschleunigung) – für Varios mit Staudruck-Sensor. |
| [vicb/flyXC](https://github.com/vicb/flyXC) (TypeScript) | MIT | Lufträume, Planungs- und 3D-Ansichten im Web; Vorlage für Luftraum-Layer. |
| [glide-rs/aeroscore-rs](https://github.com/glide-rs/aeroscore-rs) (Rust) | MIT | OLC-/Wertungsalgorithmen, schnell (WASM möglich). |
| [skylines-project/skylines](https://github.com/skylines-project/skylines) | AGPL-3.0 | Flugphasen, Leistungsstatistik – nur als Ideenquelle. |
| [mmomtchev/igc-xc-score](https://github.com/mmomtchev/igc-xc-score) | LGPL | ist bereits für die XC-Wertung eingebaut. |

**Empfehlung:** Wind-EKF nach dem XCSoar-Verfahren selbst implementieren. Damit wird der Wind auch auf
langen Gleitstrecken nachgeführt, und Fahrt und Beschleuniger werden genauer.

## 4. Was steiglinie und tracktale anders machen

| Idee | Quelle | Übernehmen? |
|---|---|---|
| Kreisformen mit überlagerten Mittelpunkten, Drift abgezogen, Achsenverhältnis | steiglinie | ja – ergänzt „Thermik & Kreisformen“ |
| Kennzahlen als **Median** statt Mittelwert, Datenmenge immer anzeigen | steiglinie | ja – robuster |
| Zentrieren als 30-s-Fenster mit ≥ 70 % Kurbelzeit und Steigen in 2 von 3 Teilfenstern | steiglinie | als Alternative prüfen (heute: 80 % des besten Kreises) |
| Tagesverlauf stündlich + Höhenbänder 100/200/500 m wählbar | steiglinie | ja, kleine Erweiterung |
| Persönliche Polare aus ≥ 10 Flügen (nach Korner), Vergleich neuer Flüge | steiglinie | ja, sobald es ein Flugbuch gibt |
| Gleitvergleich: gemeinsame Abschnitte (≤ 300 m, ≤ 15 min Versatz) zweier Piloten | steiglinie | ja |
| Talquerung mit Polare und Windprognose planen | steiglinie | später (Planung) |
| „Wie weit komme ich?“ – erreichbare Fläche aus geflogener Gleitzahl + Wind | tracktale | ja, im 3D-Video |
| Transparente Overlays (PNG) für Videoschnitt | tracktale | ja |
| Instagram-Karten, Saison-Rückblick als Reel | tracktale | ja |
| Ausrüstung mit Erinnerung „Retter packen“ | tracktale | später |
| Saison nach XContest (1.10.–30.9.) | tracktale | für Jahresübersicht |

## 5. Feature-Roadmap, priorisiert

Bewertet nach **wie oft es genutzt wird** (jeder Flug / regelmässig / gelegentlich) und **Mehrwert**
(1–5). Aufwand: S < 1 Tag, M 1–3 Tage, L > 3 Tage.

### Jetzt (hoher Nutzen bei jedem Flug)

| # | Feature | Nutzung | Wert | Aufwand | Warum |
|---|---|---|---|---|---|
| 1 | **Sicherung & Wiederherstellen** (JSON/ZIP aller Flüge) | regelmässig | 5 | S | Alles liegt nur im Browser – ein gelöschter Cache löscht alle Flüge |
| 2 | **Flugbuch**: Liste mit Filter (Jahr, Schirm, Startplatz), Jahres-/Saisonsummen, CSV | jeder Besuch | 5 | M | Ab 10 Flügen ist die Seitenleiste unbrauchbar |
| 3 | **Story-Karte teilen** (9:16-PNG: Karte, Spur, 4 Kennzahlen) | jeder Flug | 5 | S | Schneller als das Video, ideal für WhatsApp/Instagram |
| 4 | **Demo-Flug per Klick** (anonymisierte IGC) | erster Besuch | 4 | S | Neue Besucher sehen sofort alles |
| 5 | **Abschnitt wählen** (Beginn/Ende auf Profil/Karte) mit Kennzahlen | häufig | 4 | M | Basis für Talquerung, SIV, Vergleich |
| 6 | **Thermik-Ausstieg & Low Saves** in der Zusammenfassung | jeder Flug | 4 | S | Direkt lernrelevant |

### Als Nächstes (stärkt die Analyse)

| # | Feature | Nutzung | Wert | Aufwand |
|---|---|---|---|---|
| 7 | Wind-EKF (Wind auch im Geradeausflug) → genauere Fahrt | jeder Flug | 4 | M |
| 8 | Netto-Vario: Luftmassen-Steigen als Farbe auf Karte und Profil | jeder Flug | 4 | M |
| 9 | Synchroner Replay mehrerer Flüge auf der 2D-Karte (Tempo 1–120×) | gelegentlich | 4 | M |
| 10 | Gleitvergleich zweier Piloten (gemeinsame Abschnitte) | gelegentlich | 4 | M |
| 11 | Talquerungen mit Wind (Open-Meteo-Höhenwind zum Flugzeitpunkt) | jeder XC | 4 | M |
| 12 | Kreisformen: überlagerte Form, Achsenverhältnis, Median | jeder Flug | 3 | S |
| 13 | Notizen pro Flug | regelmässig | 3 | S |
| 14 | „Wie weit komme ich?“ im 3D-Video | jeder Flug | 3 | M |

### Später

| # | Feature | Nutzung | Wert | Aufwand |
|---|---|---|---|---|
| 15 | Persönliche Polare aus vielen Flügen, neue Flüge daran messen | selten | 4 | L |
| 16 | Saison-Rückblick (Karte aller Flüge, Reel) | 1×/Jahr | 4 | M |
| 17 | SIV: Steilspirale/schnelle Acht erkennen, Sinkverlauf | selten | 3 | M |
| 18 | Transparente Overlays für Videoschnitt | gelegentlich | 3 | M |
| 19 | Lufträume auf der Karte (OpenAIP) | gelegentlich | 3 | M |
| 20 | Ausrüstung + Retter-Erinnerung | selten | 2 | S |
| 21 | TAS-/IAS-Daten aus dem IGC nutzen, falls vorhanden | selten | 2 | S |

### Bewusst nicht

Gruppen, Forum, Live-Routenplanung, Konten, Vereinswertung, KI-Berichte – brauchen einen Server und
widersprechen „alles bleibt auf deinem Gerät“.

## 6. Namensvorschläge

„Track-Auswertung“ beschreibt, aber verkauft nicht. Kriterien: kurz, in Deutsch und Englisch sprechbar,
nach Fliegen klingend, nicht zu nah an „steiglinie“ oder „tracktale“.

| Name | Idee | Claim |
|---|---|---|
| **Bartlog** | „Bart“ = Thermik in der Pilotensprache + Log(buch) | *Jeder Bart erzählt was.* |
| **Liftlab** | Lift (Aufwind) + Labor; international | *Your flight, analysed in 3D.* |
| **Kurbelwerk** | „kurbeln“ = Thermik kreisen; Werk = Werkstatt | *Wo deine Kreise besser werden.* |
| **Thermalytics** | Thermal + Analytics | *Understand every climb.* |
| **Cumulog** | Cumulus + Log | *Vom Bart bis zur Basis.* |
| **Basislager** | Wolkenbasis + Lager (Ort der Nachbesprechung) | *Nach dem Flug ist vor dem Flug.* |
| **Flugfaden** | der rote Faden des Flugs, die Spur | *Dein Flug, Faden für Faden.* |
| **Aufwindkino** | Auswertung + 3D-Video | *Dein Flug auf der grossen Leinwand.* |
| **Spiralwerk** | Kreise, Spirale, Technik | *Technik sichtbar machen.* |
| **SoarScope** | Soaring + Scope (genau hinsehen) | *See your flight.* |

**Favoriten:** **Bartlog** (deutschsprachige Piloten verstehen es sofort, kurz, gut als Domain/App-Name)
und **Liftlab** (international, betont die Analyse). Vor der Entscheidung prüfen: Domain (.app/.io/.ch),
Instagram-Handle, Markenregister (DPMA/EUIPO), GitHub-Name.

## 7. Aus den tracktale-Screenshots (Referenz)

- **Reichweite des aktuellen Gleitflugs** als Fläche im Gelände („Reichweite 1:10.6 · dieser Gleitflug“).
- **Wanderer-Figur** im Hike-Teil statt Schirm, Spur in Grün; Phasen-Badge „Wanderung“/„Flug“ mit Uhrzeit.
- **Foto-Pins** an der Stelle, wo das Bild aufgenommen wurde (EXIF-GPS, lokal gelesen).
- **Bodenbedeckung** (ESA WorldCover: Wald, Fels, Gletscher, Seen) statt Satellitenbild als ruhige Kartenbasis.
- **Kennzahlen-Leiste**: 3–4 Werte, Einheit klein neben der Zahl, je nach Phase andere Werte
  (Wandern: Höhe, Aufstieg, unterwegs; Flug: Höhe, über Grund, Vario, Gleitzahl).
