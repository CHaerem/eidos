# CLAUDE.md

## Prosjekt
**Eidos** — Generisk rammeverk for 3D-modellering av boliger fra plantegninger.
Config-drevet arkitektur: alt romspesifikt i `apartment.json`, ikke i kode.
Første bolig: Vibes gate 20B, 5. etasje (loft), Oslo.

## Hovedvisjon
Eidos skal bli et rammeverk der nye boliger kan modelleres ved å:
1. Gi inn plantegning (bilde/PDF) eller finn.no-lenke
2. AI (Claude Vision) parser plantegningen til `apartment.json`
3. Menneske og AI finjusterer modellen iterativt
4. Resultat: nøyaktig 3D-modell med møbler, materialer og VR-støtte

**Arkitekturprinsipp**: All romgeometri skal være config-drevet. Ingen hardkoding av romstørrelser, veggposisjoner eller takgeometri i JS-kode. Nye moduler skal følge dette prinsippet.

## Teknisk stack
- Modulær ES-modul-arkitektur (`js/` med 9 moduler + entry point)
- Three.js v0.162.0 via CDN importmap (native ES modules, ingen bundler)
- OBJ-modell lastes med OBJLoader — skala og posisjon fra config
- Leilighetskonfig i `config/apartment.json` — komplett boligbeskrivelse
- Python HTTP-server på port 8765 for preview (konfigurert i `.claude/launch.json`)
- Norsk UI

## Modulstruktur
| Modul | Ansvar |
|-------|--------|
| `js/state.js` | Delt mutable state (scene, kamera, møbler, simulator) |
| `js/scene.js` | Three.js setup, lys, kontroller, visninger, animate-loop |
| `js/room.js` | OBJ-lasting, takgeometri, CEIL-konstanter, `ceilAt()` |
| `js/room-details.js` | Vinduer, dørkarmer, fotlister (config-drevet) |
| `js/furniture.js` | FURNITURE_CATALOG + custom builders (Besta, Soderhamn, Cana) |
| `js/interaction.js` | Drag-and-drop, raycasting, seleksjon, snap-to-wall, tastatur |
| `js/simulator.js` | Svingformler, simulator-gruppe, klaringsberegninger |
| `js/ui.js` | Sidebar-rendering, seksjon-toggle |
| `js/main.js` | Entry point — kaller init i rekkefølge |

## apartment.json skjema
```json
{
  "name": "Boligens navn",
  "objPath": "modell.obj",
  "objScale": 0.1,
  "objYShift": 1.22,
  "ceiling": {
    "windowZ": -2.50, "backZ": 2.50,
    "hemskantDist": 3.10,
    "ceilWindow": 2.214, "ceilHemskant": 3.822,
    "ceilUnderHems": 2.25, "hemsDepth": 1.90,
    "roomMinX": -4.38, "roomMaxX": 4.38
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
  "baseboard": { "height": 0.08, "depth": 0.012, "color": "0xF0F0F0" }
}
```

## Hva er generisk vs hardkodet

| Aspekt | Status | Fil |
|--------|--------|-----|
| OBJ-lasting + skalering | ✅ Config | room.js |
| Takgeometri (skråtak) | ⚠️ Loft-spesifikt | room.js (`ceilAt()`) |
| Vinduer/dører/fotlister | ✅ Config | room-details.js |
| Veggdata | ✅ Config | apartment.json |
| Møbelkatalog | ✅ Generisk | furniture.js |
| Snap-to-wall grenser | ⚠️ Leser CEIL | interaction.js |
| Kameraposisjoner | ⚠️ Hardkodet | scene.js |
| UI slider-ranges | ⚠️ Hardkodet | ui.js |
| Simulator retning | ⚠️ Hardkodet | simulator.js |

**Neste steg**: Flytt ⚠️-elementene til config for full generisk støtte.

## OBJ-koordinatsystem
Etter skalering og Y-shift (fra config):
- **X**: bredde (negativ = venstre, positiv = høyre)
- **Y**: høyde (0 = gulv)
- **Z**: dybde (negativ = vindusvegg, positiv = bakvegg)

For Vibes Gate 20B: X: -4.46 til 4.46, Y: 0 til 2.44, Z: -2.58 til 2.58

## Pipeline for nye boliger
1. **Skaff plantegning** (bilde, PDF, eller finn.no-lenke)
2. **Generer apartment.json** — manuelt eller via Claude Vision
3. **Skaff/lag OBJ-modell** (valgfritt — kan bygges fra veggdata)
4. **Kjor analyze_openings.py** — finn vindus/dør-åpninger i OBJ
5. **Finjuster** — iterer på apartment.json med AI-hjelp
6. **Legg til møbler** — bruk FURNITURE_CATALOG eller lag nye

## Svingformler (js/simulator.js)
- `swingHeight(h, c)` — maks klubbhodehøyde
- `swingRadius(h, c)` — horisontal svingradius (arm + klubblengde)
- `backswingOffset(c)` — offset bak golfer
- `ceilAt(z)` — takhøyde ved Z-posisjon (js/room.js)

## Konvensjoner
- Alle mål i meter
- Alt romspesifikt i `config/apartment.json`, ikke hardkodet i JS
- `window.*`-funksjoner brukes for HTML onclick-attributter
- Nye moduler skal være config-drevne fra start
- OBJ mesh-navn (WholeFloor, ExternalWalls, etc.) brukes for materialvalg

## Kjøre lokalt
```bash
cd /Users/christopherhaerem/Privat/GolfSim
python3 -m http.server 8765
# Åpne http://localhost:8765/index.html
```
