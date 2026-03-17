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
- Modulaer ES-modul-arkitektur (`js/` med 13 moduler + entry point)
- Three.js v0.162.0 via CDN importmap (native ES modules, ingen bundler)
- OBJ-modell lastes med OBJLoader — skala og posisjon fra config
- Leilighetskonfig i `config/apartment.json` — komplett boligbeskrivelse
- Python HTTP-server pa port 8765 for preview (konfigurert i `.claude/launch.json`)
- Vitest for enhetstester (`npm test`)
- Norsk UI

## Modulstruktur
| Modul | Ansvar |
|-------|--------|
| `js/state.js` | Delt mutable state (scene, kamera, mobler, simulator, apartmentConfig) |
| `js/scene.js` | Three.js setup, lys, kontroller, visninger (config-drevet), animate-loop, flyToRoom |
| `js/room.js` | OBJ-lasting, takzoner (`ceilAt(x,z)` per-zone), CEIL + BOUNDS |
| `js/room-details.js` | Vinduer, dorkarmer, fotlister, veggprotrusjoner (config-drevet) |
| `js/furniture.js` | FURNITURE_CATALOG + custom builders (Besta, Soderhamn, Cana) |
| `js/interaction.js` | Drag-and-drop, raycasting, seleksjon, snap-to-wall (BOUNDS), tastatur, undo/redo-snarvei |
| `js/simulator.js` | Svingformler, simulator-gruppe, klaringsberegninger (BOUNDS) |
| `js/solver.js` | Tikhonov-regularisert least-squares solver for veggposisjoner og takhøyder |
| `js/dimensions.js` | Interaktive dimensjonslinjer i 3D-viewporten, klikk-til-edit |
| `js/room-focus.js` | Dynamisk skjuling av geometri ved rom-navigasjon (vegg/gulv/tak) |
| `js/history.js` | Undo/redo med config-snapshot stack (maks 50 nivåer) |
| `js/eidos-api.js` | Browser API for AI-assistert modellmanipulering (`window.eidos.*`) |
| `js/ui.js` | Sidebar-rendering, kalibreringspanel, synlighets-toggles (etasjer/vegger per rom) |
| `js/main.js` | Entry point — kaller init i rekkefolge |

## Kjerneabstraksjoner

### BOUNDS (room.js)
Generisk romgrense brukt av alle moduler:
```js
export const BOUNDS = { minX, maxX, minZ, maxZ, floorY };
```
Populeres fra `config.bounds` eller `config.walls.exterior`. Erstatter direkte bruk av CEIL for vegg-grenser.

### ceilAt(x, z) (room.js)
Zone-basert takhoydefunksjon. Sjekker hvilken takzone punktet (x,z) er i og returnerer korrekt hoyde.
- Stotter `ceilAt(x, z)` (full) og `ceilAt(z)` (legacy, bruker x=0)
- Zone-typer: `"flat"` (uniform hoyde) og `"slope"` (lineaer interpolasjon)
- Fallback til `defaultHeight` hvis ingen zone matcher

### Takzoner (ceiling.zones i config)
Hver zone har bounds (minX/maxX/minZ/maxZ) og type-spesifikke parametere:
- `"flat"`: `{ height }` — fast takhoyde (5.etg tak under 6.etg gulv)
- `"slope"`: `{ slopeStartZ, slopeEndZ, startHeight, endHeight }` — lineaert skratak
- **First match wins**: flat-zoner sjekkes forst, slope er fallback for "apent ned"
- Flat-zoner rendres IKKE som geometri nar `upperFloor` finnes (handled av buildUpperFloor)

### upperFloor (room.js)
Config for 6. etasje / overetasje. Bygger gulvplan, vegger, rekkverk og trapp:
- `floorY`: gulvhoyde (2.25m)
- `areas[]`: gulvflater med bounds — rendres med DoubleSide, cutout for trappeapning
- `stairwell`: spiral trapp config (centerX/Z, radius, numSteps, totalRotationDeg, startAngleDeg, bounds)
- `walls[]`: kantvegg/rekkverk — `type: "solid"` (vegg til tak) eller `type: "railing"` (balustre + topprail)
- OBJ InnerSide-meshes som overlapper med `stairwell.bounds` skjules automatisk
- Gable/yttervegg over floorY bygges automatisk fra exterior bounds og roof slope

### CEIL (room.js)
Legacy takkonstanter, populert automatisk fra zones. Brukes av simulator (hemskantZ) og room-details (windowZ).

### Solver (solver.js)
Tikhonov-regularisert least-squares solver som finner optimale veggposisjoner og takhøyder fra målinger.
- **13 ukjente**: 5 veggposisjoner + 5 veggtykkelser + floorY + slopeStart + slopeEnd
- **Adjacency**: `buildAdjacency()` mapper rom-dimensjoner til vegg/yttervegg-grenser
- **Priors**: wallPositionWeight (0.1), wallThicknessWeight (10.0), heightWeight (1.0)
- **Koblede høyder**: Alle flat-rom deler `floorY` (= upperFloor.floorY), slope-rom har `slopeStart`/`slopeEnd`
- `applyToConfig()` oppdaterer config etter solving (vegger, rom-bounds, takhøyder)
- Measurements format: `{ room: "garderobe", dim: "width|depth|height|height_low|height_high", value: 2.20 }`

### Dimensjonslinjer (dimensions.js)
Interaktive arkitektoniske mållinjer i 3D-viewporten:
- `showDimensions(roomId, floor)` — viser bredde/dybde/høyde-linjer for valgt rom
- Blå labels = estimert verdi, grønne = målt verdi
- Dobbeltklikk på label åpner floating input → lagrer → solver → rebuild
- THREE.Sprite + CanvasTexture for labels, THREE.Line med depthTest:false for linjer

### Room Focus (room-focus.js)
Dynamisk skjuling av blokkerende geometri når kameraet flyr til et rom:
- 5. etasje-rom: skjuler `UpperFloor`-gruppen (etasjegulvet over)
- 6. etasje-rom: skjuler `Ceiling`-gruppen (taket)
- Skjuler ExternalWalls-meshes på kamerasiden (approach-retning)
- Gjenopprettes ved nytt rom-valg eller kameravisning-bytte

### History (history.js)
Undo/redo for config-endringer via deep-copy snapshots:
- `pushSnapshot()` kalles før hver brukerhandling (kalibrering, dimensjonsredigering, API-kall)
- `undo(rebuildFn)` / `redo(rebuildFn)` — bytter config og rebuilder
- Maks 50 nivåer, nye handlinger invaliderer redo-stacken
- Tastatursnarvei: ⌘Z (angre), ⌘⇧Z (gjør om)

### Eidos API (eidos-api.js)
Browser-API eksponert som `window.eidos.*` for AI-assistert modellmanipulering:
- `getConfig(path)` / `updateConfig(path, value)` — les/skriv config
- `rebuild()` — full geometri-rebuild fra config
- `addMeasurement()` / `removeMeasurement()` / `solve()` — kalibrering
- `undo()` / `redo()` — historikk
- `showDimensions()` / `hideDimensions()` — dimensjonslinjer
- `setRoomFocus()` / `clearRoomFocus()` — geometri-skjuling
- `getRooms()` / `getWindows()` / `getWalls()` / `getBounds()` — spørringer

## apartment.json skjema
```json
{
  "name": "Boligens navn",
  "objPath": "modell.obj",
  "objScale": 0.1,
  "objYShift": 1.22,
  "ceiling": {
    "defaultHeight": 2.50,
    "zones": [
      {
        "id": "under-kontor", "type": "flat",
        "bounds": { "minX": -4.38, "maxX": -0.77, "minZ": -2.50, "maxZ": 2.50 },
        "height": 2.25,
        "note": "Flat-zoner sjekkes FORST (first match wins). 5.etg tak under 6.etg gulv"
      },
      {
        "id": "under-hems", "type": "flat",
        "bounds": { "minX": -0.77, "maxX": 4.38, "minZ": 0.60, "maxZ": 2.50 },
        "height": 2.25
      },
      {
        "id": "roof", "type": "slope",
        "bounds": { "minX": -4.38, "maxX": 4.38, "minZ": -2.50, "maxZ": 2.50 },
        "slopeStartZ": -2.50, "slopeEndZ": 2.50,
        "startHeight": 2.214, "endHeight": 4.81,
        "note": "Kontinuerlig takflate — fallback for 'apent ned' omrader"
      }
    ]
  },
  "upperFloor": {
    "floorY": 2.25,
    "areas": [
      { "id": "kontor-floor", "bounds": { "minX": -4.38, "maxX": -0.77, "minZ": -2.50, "maxZ": 2.50 } },
      { "id": "hems-floor", "bounds": { "minX": -0.77, "maxX": 4.38, "minZ": 0.60, "maxZ": 2.50 } }
    ],
    "stairwell": {
      "type": "spiral",
      "centerX": -0.30, "centerZ": 0.30, "radius": 0.75,
      "numSteps": 14, "totalRotationDeg": 270, "startAngleDeg": -90,
      "bounds": { "minX": -1.05, "maxX": 0.45, "minZ": -0.45, "maxZ": 1.05 },
      "note": "Spiral staircase — config-drevet. bounds brukes til gulv-cutout og OBJ-filtrering"
    },
    "walls": [
      { "id": "w1", "type": "solid|railing", "axis": "x|z", "pos": 0, "fromZ|fromX": 0, "toZ|toX": 0, "railHeight": 1.0 }
    ],
    "rooms": [
      { "id": "kontor", "name": "Kontor", "bounds": {} }
    ]
  },
  "bounds": { "minX": -4.38, "maxX": 4.38, "minZ": -2.50, "maxZ": 2.50, "floorY": 0 },
  "walls": {
    "exterior": { "minX": 0, "maxX": 0, "minZ": 0, "maxZ": 0, "thickness": 0.08 },
    "interior": [
      { "id": "A", "axis": "x|z", "pos": 0, "from": 0, "to": 0 }
    ],
    "column": { "minX": 0, "maxX": 0, "minZ": 0, "maxZ": 0 },
    "protrusions": [
      { "id": "P1", "bounds": { "minX": 0, "maxX": 0, "minZ": 0, "maxZ": 0 }, "height": 0, "fromY": 0, "note": "" }
    ]
  },
  "terrace": {
    "floorY": 2.70,
    "bounds": { "minX": 0, "maxX": 0, "minZ": 0, "maxZ": 0 },
    "walls": [
      { "id": "t1", "type": "railing", "axis": "x|z", "pos": 0, "fromX|fromZ": 0, "toX|toZ": 0, "railHeight": 1.0 }
    ],
    "steps": { "count": 2, "riseTotal": 0.45, "bounds": {} }
  },
  "rooms": [
    { "id": "stue", "name": "Stue", "bounds": {}, "ceilingType": "slope|flat", "note": "" }
  ],
  "windows": [
    { "id": "W1", "wall": "south|west|north|east", "x1": 0, "x2": 0, "sillHeight": 1.0, "topHeight": 2.2 }
  ],
  "doors": [
    { "id": "D1", "wall": "id", "pos": 0, "axis": "x|z", "from": 0, "to": 0, "height": 2.0 }
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
| 6. etasje (gulv/trapp/rekkverk) | ✅ Config (`upperFloor`) | room.js |
| Spiraltrapp | ✅ Config (center, radius, steps, rotation) | room.js |
| Vinduer/dorer/fotlister | ✅ Config | room-details.js |
| Veggdata | ✅ Config | apartment.json |
| Mobelkatalog | ✅ Generisk | furniture.js |
| Romgrenser (BOUNDS) | ✅ Config | room.js |
| Snap-to-wall grenser | ✅ BOUNDS | interaction.js |
| Kameraposisjoner | ✅ Beregnet fra BOUNDS | scene.js |
| UI slider-ranges | ✅ Beregnet fra BOUNDS | ui.js |
| Simulator retning/grenser | ✅ BOUNDS + config | simulator.js |
| OBJ clipping (overetasje) | ✅ Auto fra upperFloor.floorY | room.js |
| Kalibrering (solver) | ✅ Tikhonov least-squares | solver.js |
| Dimensjonslinjer (3D) | ✅ Interaktive, klikk-til-edit | dimensions.js |
| Veggprotrusjoner | ✅ Config (`walls.protrusions`) | room-details.js |
| Terrasse | ✅ Config (`terrace`) | room.js |
| Geometri-skjuling | ✅ Auto per rom-fokus | room-focus.js |
| Synlighets-toggles | ✅ Etasjer + vegger per rom | ui.js |
| Undo/redo | ✅ Config-snapshot stack | history.js |
| AI-API | ✅ window.eidos.* | eidos-api.js |
| MCP-server | ✅ Config CRUD, solver, element-mgmt | mcp_server.py |

## OBJ-koordinatsystem
Etter skalering og Y-shift (fra config):
- **X**: bredde (negativ = venstre, positiv = hoyre)
- **Y**: hoyde (0 = gulv)
- **Z**: dybde (negativ = vindusvegg, positiv = bakvegg)

For Vibes Gate 20B: X: -4.46 til 4.46, Y: 0 til 2.44, Z: -2.58 til 2.58

## Pipeline for nye boliger

### Trinn 1: Datainnhenting fra finn.no-annonse
Gitt en finn.no-lenke, hent:
- **Plantegning(er)**: Finn floor plan-bildene (typisk bilde 2-4 i annonsen)
- **Interiorfotod**: Last ned alle bilder for taktype-analyse
- **Salgsoppgave/tilstandsrapport** (PDF): Inneholder takhøyder, himling-info

### Trinn 2: Plantegning → romgeometri
Fra plantegning-bildet, ekstraher:
- **Romnavn og dimensjoner** (stue, soverom, bad, kjokken, entre, etc.)
- **Veggposisjoner** og tykkelser
- **Vinduer og dorer** med plasseringer
- **Etasjeplan** (loft: hems, "apent ned", kontor, etc.)

Map rommal til et koordinatsystem (X = bredde, Z = dybde, Y = hoyde).

### Trinn 3: Bilder → taktyper per rom (Claude Vision)
For hver rom, analyser interiorfoto og bestem:

| Signal i bilde | Taktype | Config |
|----------------|---------|--------|
| Synlig skraning fra vindu oppover | `slope` | `slopeStartZ`, `slopeEndZ`, `startHeight`, `endHeight` |
| Flat hvit himling, jevn hoyde | `flat` | `height` |
| Synlig hems/galleri over rommet | `flat` (under hems) | `height` = hemsgulv-hoyde |
| Etasje over (kontor, soverom) | `flat` (under etasje) | `height` = gulv-hoyde over |
| "Apent ned" pa etasjen over | `slope` (dobbelhoyde) | Skratak fortsetter opp |

**Nokkelinnsikt**: I loft-leiligheter er det ofte IKKE skratak over hele bredden.
Sjekk 6. etasje plantegning for a se hva som er over hvert rom:
- "Apent ned" → rommet under har skratak (slope)
- Rom (kontor, hems) → rommet under har flat tak (etasjegulv = tak)

### Trinn 4: Takzoner i ceiling.zones
Opprett en takzone per distinkt omrade:
- En `slope`-zone for omrader med skratak
- En `flat`-zone per omrade med flat himling
- Zonene ma dekke hele leilighetens bounds uten hull

Verifiser med `ceilAt(x, z)` at alle rom-hjorner gir korrekt takhoyde.

### Trinn 5: Generer apartment.json
Kombiner all data til en komplett config med:
- `ceiling.zones` (per-rom takdata)
- `rooms` (rom-definisjon med bounds og ceilingType)
- `walls` (ytre + indre vegger)
- `windows`, `doors`, `baseboard`
- `bounds` (total romgrense)

### Trinn 6: Finjuster iterativt
- Start 3D-preview og sammenlign med interiorfoto
- Juster vegg-posisjoner, tak-hoyder, vindus-plasseringer
- Legg til mobler fra FURNITURE_CATALOG

### Fremtidig automatisering
Denne pipelinen gjores na manuelt med Claude, men malet er:
1. `finn_url → fetch bilder + plantegning automatisk`
2. `Claude Vision → apartment.json (forstegangs-generering)`
3. `Menneske + AI → iterativ finjustering i 3D-preview`

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

## Tester
```bash
npm test          # Kjor alle tester (vitest)
npx vitest        # Watch-modus
```
Testfiler i `tests/`:
- `history.test.js` — Undo/redo snapshot-logikk (10 tester)
- `solver.test.js` — Constraint solver, adjacency, height unknowns (10 tester)

## Kjore lokalt
```bash
cd /Users/christopherhaerem/Privat/GolfSim
python3 -m http.server 8765
# Apne http://localhost:8765/index.html
```
