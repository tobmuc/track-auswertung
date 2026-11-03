@echo off
rem Startet die Track-Auswertung lokal und oeffnet sie im Browser.
rem Doppelklick genuegt. Beenden: dieses Fenster schliessen oder Strg+C.
setlocal
cd /d "%~dp0"
title Track-Auswertung

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte installieren: https://nodejs.org  ^(LTS-Version^), danach erneut starten.
  pause
  exit /b 1
)

rem Laeuft die App schon? Dann nur den Browser oeffnen.
curl -s -o nul http://localhost:5173/ 2>nul
if not errorlevel 1 (
  echo Track-Auswertung laeuft bereits - oeffne den Browser.
  start "" http://localhost:5173/
  exit /b 0
)

if not exist "node_modules\" (
  echo Erster Start: installiere Abhaengigkeiten ...
  call npm install
  if errorlevel 1 (
    echo npm install ist fehlgeschlagen.
    pause
    exit /b 1
  )
)

echo.
echo  Track-Auswertung startet auf http://localhost:5173
echo  Der Browser oeffnet sich gleich. Zum Beenden dieses Fenster schliessen.
echo.
call npm run dev -- --open
pause
