# Eidos — 3D Boligmodellering fra Plantegninger

> *Eidos* (gresk: εἶδος) — form, idé. Den ideelle formen av noe, sett med sinnets øye.

Et generisk rammeverk for å bygge nøyaktige 3D-modeller av boliger — fra plantegning til interaktiv modell med møbler, materialer og VR-støtte.

## Visjon

Eidos er et **config-drevet rammeverk** for 3D-modellering av boliger. Målet er at hvem som helst skal kunne gå fra en plantegning til en komplett, interaktiv 3D-modell:

1. **Plantegning inn, 3D-modell ut** — Generer `apartment.json` fra plantegninger (manuelt eller med AI)
2. **Iterativt samarbeid** — Menneske og AI finjusterer modellen sammen: "flytt døren 20cm til venstre", "legg til vindu her"
3. **Ultrarealistisk rendering** — PBR-materialer, skygger, arkitektoniske detaljer (vinduer, dørkarmer, fotlister)
4. **VR-utforskning** — Gå gjennom boligen med Meta Quest 3
5. **Auto-generering** — Fra finn.no-lenke eller boligbilder via Claude Vision til ferdig modell

Første bolig: Vibes gate 20B, 5. og 6. etasje (loft) med takterrasse, Oslo.

## Hvordan det fungerer

```
Plantegning (PDF/bilde)
    ↓
apartment.json            ← Manuelt eller AI-generert
    ↓                       (vegger, vinduer, dører, tak, møbler)
Eidos 3D-motor            ← Three.js med PBR-rendering
    ↓
Interaktiv 3D-modell      ← Drag-and-drop møbler, snap-to-wall
    ↓
VR-utforskning            ← Meta Quest 3 (WebXR)
```

**Alt er drevet av én JSON-fil** (`apartment.json`). Bytt fil — bytt bolig. Filen beskriver:
- Romgeometri (vegger, tak, gulv)
- Vinduer og dører (posisjon, størrelse)
- OBJ-modell (valgfri — for eksisterende 3D-modeller)
- Arkitektoniske detaljer (fotlister, karmer)

## Pipeline: finn.no → 3D-modell

```
finn.no-lenke
    ↓
1. Hent plantegning + interiørbilder
    ↓
2. Plantegning → romgeometri (vegger, vinduer, dører)
    ↓
3. Bilder → taktyper per rom (skråtak vs flat himling)
   • Sjekk etasjen over: "åpent ned" = skråtak, rom over = flat tak
   • Verifiser med interiørfoto per rom
    ↓
4. Generer apartment.json med per-rom takzoner
    ↓
5. Menneske + AI finjusterer i 3D-preview
    ↓
Nøyaktig 3D-modell med møbler
```

> **Status**: Trinn 1-5 er demonstrert manuelt med Vibes gate 20B. Målet er full automatisering via Claude Vision.

## Progresjon

| Fase | Status | Beskrivelse |
|------|--------|-------------|
| 1. Modularisering | ✅ Ferdig | Monolitt → 9 ES-moduler + leilighetskonfig JSON |
| 2. PBR + Skygger | ✅ Ferdig | MeshStandardMaterial, shadow mapping, tone mapping, bedre belysning |
| 3. Romdetaljer | ✅ Ferdig | Vinduer, dørkarmer, fotlister, ugjennomsiktig tak |
| 4. Generisk rammeverk | ✅ Ferdig | Config-drevet rombygging, per-rom takzoner, rooms-definisjon |
| 5. Kalibrering | ✅ Ferdig | Tikhonov solver, dimensjonslinjer i 3D, undo/redo |
| 6. Flereetasjer | ✅ Ferdig | 6. etasje, takterrasse, trapp, synlighets-toggles |
| 7. MCP + AI-verktøy | ✅ Ferdig | MCP-server, protrusjoner, element CRUD |
| 8. AI-pipeline | 🔄 Pågår | Claude Vision analyserer finn.no-bilder → taktyper per rom |
| 9. WebXR/VR | 🔲 Planlagt | Meta Quest 3, teleportering, controller-interaksjon |

## Funksjoner

- 3D-modell av leiligheten (OBJ) med korrekt skråtak og ugjennomsiktig tak
- Flereetasjes støtte: 5. etasje, 6. etasje (hems/kontor), takterrasse
- Vinduer med glass, karmer, sprosser og vinduskarmer
- Dørkarmer ved innvendige åpninger
- Fotlister langs vegger (perimeter + innervegger)
- Veggprotrusjoner (bjelker, innrykk, pipe-sjakter)
- PBR-materialer med skygger og ACES filmic tone mapping
- Møbelkatalog med detaljerte 3D-modeller (BESTÅ, Söderhamn, Bolia Cana + Frame TV)
- Drag-and-drop plassering med snap-to-wall
- Rotasjonsknapper (0°/90°/180°/270°) og tastatursnarveier (R, Delete)
- Golfsimulator med svingbue og klaringsberegninger
- Synlighets-toggles: skjul/vis etasjer og vegger per rom (rombasert)
- Kompakt enhetlig glasspanel (ingen tabs) med collapsible seksjoner
- Kameravisning med aktiv-state (ovenfra, 3D, front, side)
- Tikhonov-regularisert kalibrering med kompakte rom-kort og interaktive dimensjonslinjer
- Undo/redo (⌘Z / ⌘⇧Z) med visuell historikk-tidslinje, jump-to og 3D-diff
- MCP-server for AI-assistert modellmanipulering (vinduer, dører, vegger, protrusjoner)
- Dynamisk cache-busting dev-server (filendringer reflekteres ved refresh)
- Leilighetskonfig via JSON — gjenbrukbart for andre bygg

## Kjør lokalt

```bash
python3 server.py
```

Åpne `http://localhost:8765/index.html` i nettleseren. Dev-serveren har dynamisk cache-busting — filendringer reflekteres automatisk ved refresh.

## Prosjektstruktur

```
eidos/
  index.html              Hovedapplikasjon (HTML + CSS + importmap)
  js/
    main.js               Entry point — initialiserer alle moduler
    state.js              Delt state (scene, kamera, møbler, simulator)
    scene.js              Three.js scene, renderer, lys, kontroller
    room.js               OBJ-lasting, takgeometri, overetasje, terrasse, trapp
    room-details.js       Vinduer, dørkarmer, fotlister, protrusjoner
    room-focus.js         Dynamisk geometri-skjuling ved rom-navigasjon
    furniture.js          Møbelkatalog og 3D-modellbyggere
    interaction.js        Drag-and-drop, raycasting, seleksjon
    simulator.js          Golfsimulator, svingformler, klaringer
    solver.js             Tikhonov-regularisert kalibrerings-solver
    dimensions.js         Interaktive dimensjonslinjer i 3D
    history.js            Undo/redo med config-snapshot stack
    history-diff.js       3D visuell diff mellom config-snapshots
    eidos-api.js          Browser API for AI-assistert manipulering
    ui.js                 Enhetlig glasspanel, kalibrering, synlighets-toggles
  config/
    apartment.json        Leilighetskonfigurasjon (komplett boligbeskrivelse)
  server.py               Dev-server med dynamisk cache-busting for ES-moduler
  mcp_server.py           MCP-server for AI-verktøy (les/skriv config, CRUD elementer)
  tests/                  Vitest enhetstester (84 tester: solver, history, config-elements, diff)
```

## Teknologi

- [Three.js](https://threejs.org/) v0.162.0 (native ES modules via importmap)
- PBR-rendering med PCFSoftShadowMap og ACES filmic tone mapping
- Vanilla HTML/JS — ingen build-steg, ingen avhengigheter
- Python HTTP-server for lokal utvikling
