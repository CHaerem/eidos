# CLAUDE.md

## Prosjekt
**Eidos** — Generisk rammeverk for 3D-modellering av boliger fra plantegninger.
Config-drevet arkitektur: alt romspesifikt i `apartment.json`, ikke i kode.
Forste bolig: Vibes gate 20B, 5. etasje (loft), Oslo.

## Hovedvisjon
Eidos skal bli et rammeverk der nye boliger kan modelleres ved a:
1. Gi inn plantegning (bilde/PDF) eller finn.no-lenke
2. AI (Claude Vision) parser plantegningen til `apartment.json`
3. Menneske og AI finjusterer modellen iterativt
4. Resultat: noyaktig 3D-modell med mobler, materialer og VR-stotte

**Arkitekturprinsipp**: All romgeometri skal vaere config-drevet. Ingen hardkoding av romstorrelser, veggposisjoner eller takgeometri i JS-kode. Nye moduler skal folge dette prinsippet.

## Teknisk stack
- Modulaer ES-modul-arkitektur (`js/` med 9 moduler + entry point)
- Three.js v0.162.0 via CDN importmap (native ES modules, ingen bundler)
- OBJ-modell lastes med OBJLoader — skala og posisjon fra config
- Leilighetskonfig i `config/apartment.json` — komplett boligbeskrivelse
- Python HTTP-server pa port 8765 for preview (konfigurert i `.claude/launch.json`)
- Norsk UI

## Modulstruktur
| Modul | Ansvar |
|-------|--------|
| `js/state.js` | Delt mutable state (scene, kamera, mobler, simulator, apartmentConfig) |
| `js/scene.js` | Three.js setup, lys, kontroller, visninger (config-drevet), animate-loop |
| `js/room.js` | OBJ-lasting, takgeometri (`ceilAt()` stotter flat/slope), CEIL + BOUNDS |
| `js/room-details.js` | Vinduer, dorkarmer, fotlister (config-drevet) |
| `js/furniture.js` | FURNITURE_CATALOG + custom builders (Besta, Soderhamn, Cana) |
| `js/interaction.js` | Drag-and-drop, raycasting, seleksjon, snap-to-wall (BOUNDS), tastatur |
| `js/simulator.js` | Svingformler, simulator-gruppe, klaringsberegninger (BOUNDS) |
| `js/ui.js` | Sidebar-rendering, seksjon-toggle, dynamiske slider-ranges |
| `js/main.js` | Entry point — kaller init i rekkefolge |

## Kjerneabstraksjoner

### BOUNDS (room.js)
Generisk romgrense brukt av alle moduler:
```js
export const BOUNDS = { minX, maxX, minZ, maxZ, floorY };
```
Populeres fra `config.bounds` eller `config.walls.exterior`. Erstatter direkte bruk av CEIL for vegg-grenser.

### ceilAt(z) (room.js)
Config-drevet takhoydefunksjon. Stotter:
- `"type": "flat"` — uniform hoyde, krever `"height"`
- `"type": "slope"` — loft-stil med skratak + hemskant (default for bakoverkompatibilitet)

### CEIL (room.js)
Loft-spesifikke takkonstanter (hemskant, skratakvinkler). Brukes av simulator for klaringsberegning.

## apartment.json skjema
```json
{
  "name": "Boligens navn",
  "objPath": "modell.obj",
  "objScale": 0.1,
  "objYShift": 1.22,
  "ceiling": {
    "type": "slope|flat",
    "height": 2.50,
    "windowZ": -2.50, "backZ": 2.50,
    "hemskantDist": 3.10,
    "ceilWindow": 2.214, "ceilHemskant": 3.822,
    "ceilUnderHems": 2.25, "hemsDepth": 1.90,
    "roomMinX": -4.38, "roomMaxX": 4.38
  },
  "bounds": {
    "minX": -4.38, "maxX": 4.38,
    "minZ": -2.50, "maxZ": 2.50,
    "floorY": 0
  },
  "walls": {
    "exterior": { "minX", "maxX", "minZ", "maxZ", "thickness" },
    "interior": [
      { "id": "A", "axis": "x|z", "pos": 0, "from": 0, "to": 0 }
    ],
    "column": { "minX", "maxX", "minZ", "maxZ" }
  },
  "windows": [
    { "id": "W1", "wall": "south|west|north|east", "x1|z1", "x2|z2", "sillHeight", "topHeight" }
  ],
  "doors": [
    { "id": "D1", "wall": "id", "pos", "axis": "x|z", "from", "to", "height" }
  ],
  "baseboard": { "height": 0.08, "depth": 0.012, "color": "0xF0F0F0" },
  "simulator": { "hitDirection": "negZ", "screenDistance": 0.3 }
}
```

## Hva er generisk vs hardkodet

| Aspekt | Status | Fil |
|--------|--------|-----|
| OBJ-lasting + skalering | ✅ Config | room.js |
| Takgeometri | ✅ Config (`type: flat/slope`) | room.js |
| Vinduer/dorer/fotlister | ✅ Config | room-details.js |
| Veggdata | ✅ Config | apartment.json |
| Mobelkatalog | ✅ Generisk | furniture.js |
| Romgrenser (BOUNDS) | ✅ Config | room.js |
| Snap-to-wall grenser | ✅ BOUNDS | interaction.js |
| Kameraposisjoner | ✅ Beregnet fra BOUNDS | scene.js |
| UI slider-ranges | ✅ Beregnet fra BOUNDS | ui.js |
| Simulator retning/grenser | ✅ BOUNDS + config | simulator.js |

## OBJ-koordinatsystem
Etter skalering og Y-shift (fra config):
- **X**: bredde (negativ = venstre, positiv = hoyre)
- **Y**: hoyde (0 = gulv)
- **Z**: dybde (negativ = vindusvegg, positiv = bakvegg)

For Vibes Gate 20B: X: -4.46 til 4.46, Y: 0 til 2.44, Z: -2.58 til 2.58

## Pipeline for nye boliger
1. **Skaff plantegning** (bilde, PDF, eller finn.no-lenke)
2. **Generer apartment.json** — manuelt eller via Claude Vision
3. **Skaff/lag OBJ-modell** (valgfritt — kan bygges fra veggdata)
4. **Kjor analyze_openings.py** — finn vindus/dor-apninger i OBJ
5. **Finjuster** — iterer pa apartment.json med AI-hjelp
6. **Legg til mobler** — bruk FURNITURE_CATALOG eller lag nye

## Svingformler (js/simulator.js)
- `swingHeight(h, c)` — maks klubbhodehoyde
- `swingRadius(h, c)` — horisontal svingradius (arm + klubblengde)
- `backswingOffset(c)` — offset bak golfer
- `ceilAt(z)` — takhoyde ved Z-posisjon (js/room.js)

## Konvensjoner
- Alle mal i meter
- Alt romspesifikt i `config/apartment.json`, ikke hardkodet i JS
- `window.*`-funksjoner brukes for HTML onclick-attributter
- Nye moduler skal vaere config-drevne fra start
- OBJ mesh-navn (WholeFloor, ExternalWalls, etc.) brukes for materialvalg
- `BOUNDS` for romgrenser, `CEIL` kun for loft-spesifikk takinfo

## Kjore lokalt
```bash
cd /Users/christopherhaerem/Privat/GolfSim
python3 -m http.server 8765
# Apne http://localhost:8765/index.html
```
