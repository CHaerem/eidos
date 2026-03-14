# CLAUDE.md

## Prosjekt
3D romplanlegger for golfsimulator-installasjon i loftsleilighet (5. etasje), Vibes gate 20B, Oslo.

## Teknisk stack
- Én HTML-fil (`golfsim-3d.html`) med Three.js via CDN (ES module importmap, three@0.162.0)
- OBJ-modell (`Vibes Gate 20 - Ground Floor.obj`) lastes med OBJLoader — skala 1 enhet = 0.1m
- Python HTTP-server på port 8765 for preview (konfigurert i `.claude/launch.json`)
- Norsk UI

## OBJ-koordinatsystem
Etter skalering (×0.1) og Y-shift (+1.22 for gulv=0):
- **X**: -4.46 til 4.46 (bredde ~8.9m)
- **Y**: 0 til 2.44 (høyde)
- **Z**: -2.58 til 2.58 (dybde ~5.2m)
- Vindusvegg er ved Z ≈ -2.50 (min Z)
- Stue-arealet: X fra ~0.7 til 4.38, Z fra -2.50 til 2.50

## 5. etasje spesifikk geometri
OBJ-en er fra 1. etasje. Skråtak legges til programmatisk:
- Tak ved vindu: 2.214m
- Tak ved hemskant (3.10m fra vindu): 3.822m
- Flat tak under hems: 2.25m

## Svingformler
- `swingHeight(h, c)` — maks klubbhodehøyde
- `swingRadius(h, c)` — horisontal svingradius (arm + klubblengde)
- `backswingOffset(c)` — offset bak golfer
- `ceilAt(z)` — takhøyde ved Z-posisjon

## Konvensjoner
- Alle mål i meter
- Klubblengder i meter (driver=1.143, 7-jern=0.940, wedge=0.889)
- Golfsim slår "mot vindu" (negativ Z) eller "langs rommet" (positiv X)

## Kjøre lokalt
```bash
cd /Users/christopherhaerem/Privat/GolfSim
python3 -m http.server 8765
# Åpne http://localhost:8765/golfsim-3d.html
```
