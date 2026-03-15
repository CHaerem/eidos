# CLAUDE.md

## Prosjekt
**Eidos** — 3D leilighetsplanlegger med møbelplassering, golfsimulator og fremtidig VR-støtte.
Første leilighet: Vibes gate 20B, 5. etasje (loft), Oslo.

## Teknisk stack
- Modulær ES-modul-arkitektur (`js/` med 7 moduler + entry point)
- Three.js v0.162.0 via CDN importmap (native ES modules, ingen bundler)
- OBJ-modell (`Vibes Gate 20 - Ground Floor.obj`) lastes med OBJLoader — skala 1 enhet = 0.1m
- Leilighetskonfig i `config/apartment.json` — romgrenser, tak, OBJ-sti
- Python HTTP-server på port 8765 for preview (konfigurert i `.claude/launch.json`)
- Norsk UI

## Modulstruktur
| Modul | Ansvar |
|-------|--------|
| `js/state.js` | Delt mutable state (scene, kamera, møbler, simulator) |
| `js/scene.js` | Three.js setup, lys, kontroller, visninger, animate-loop |
| `js/room.js` | OBJ-lasting, takgeometri, CEIL-konstanter, `ceilAt()` |
| `js/furniture.js` | FURNITURE_CATALOG + custom builders (Bestå, Söderhamn, Cana) |
| `js/interaction.js` | Drag-and-drop, raycasting, seleksjon, snap-to-wall, tastatur |
| `js/simulator.js` | Svingformler, simulator-gruppe, klaringsberegninger |
| `js/ui.js` | Sidebar-rendering, seksjon-toggle |
| `js/main.js` | Entry point — kaller init i rekkefølge |

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

## Svingformler (js/simulator.js)
- `swingHeight(h, c)` — maks klubbhodehøyde
- `swingRadius(h, c)` — horisontal svingradius (arm + klubblengde)
- `backswingOffset(c)` — offset bak golfer
- `ceilAt(z)` — takhøyde ved Z-posisjon (js/room.js)

## Konvensjoner
- Alle mål i meter
- Klubblengder i meter (driver=1.143, 7-jern=0.940, wedge=0.889)
- Golfsim slår "mot vindu" (negativ Z) eller "langs rommet" (positiv X)
- `window.*`-funksjoner brukes for HTML onclick-attributter

## Kjøre lokalt
```bash
cd /Users/christopherhaerem/Privat/GolfSim
python3 -m http.server 8765
# Åpne http://localhost:8765/index.html
```
