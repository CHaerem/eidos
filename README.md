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

Første bolig: Vibes gate 20B, 5. etasje (loft), Oslo.

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
| 4. Generisk rammeverk | 🔄 Pågår | Config-drevet rombygging, per-rom takzoner, rooms-definisjon |
| 5. AI-pipeline | 🔄 Pågår | Claude Vision analyserer finn.no-bilder → taktyper per rom |
| 6. WebXR/VR | 🔲 Planlagt | Meta Quest 3, teleportering, controller-interaksjon |

## Funksjoner

- 3D-modell av leiligheten (OBJ) med korrekt skråtak og ugjennomsiktig tak
- Vinduer med glass, karmer, sprosser og vinduskarmer
- Dørkarmer ved innvendige åpninger
- Fotlister langs vegger (perimeter + innervegger)
- PBR-materialer med skygger og ACES filmic tone mapping
- Møbelkatalog med detaljerte 3D-modeller (BESTÅ, Söderhamn, Bolia Cana + Frame TV)
- Drag-and-drop plassering med snap-to-wall
- Rotasjonsknapper (0°/90°/180°/270°) og tastatursnarveier (R, Delete)
- Golfsimulator med svingbue og klaringsberegninger
- Flere visningsvinkler (ovenfra, 3D, front, side)
- Leilighetskonfig via JSON — gjenbrukbart for andre bygg

## Kjør lokalt

```bash
python3 -m http.server 8765
```

Åpne `http://localhost:8765/index.html` i nettleseren.

## Prosjektstruktur

```
eidos/
  index.html              Hovedapplikasjon (HTML + CSS + importmap)
  js/
    main.js               Entry point — initialiserer alle moduler
    state.js              Delt state (scene, kamera, møbler, simulator)
    scene.js              Three.js scene, renderer, lys, kontroller
    room.js               OBJ-lasting, takgeometri, romkonstanter
    room-details.js       Vinduer, dørkarmer, fotlister
    furniture.js          Møbelkatalog og 3D-modellbyggere
    interaction.js        Drag-and-drop, raycasting, seleksjon
    simulator.js          Golfsimulator, svingformler, klaringer
    ui.js                 Sidebar-kontroller og møbelliste
  config/
    apartment.json        Leilighetskonfigurasjon (romgrenser, tak, vegger, vinduer, dører)
  textures/               Teksturer (fase 2+)
```

## Teknologi

- [Three.js](https://threejs.org/) v0.162.0 (native ES modules via importmap)
- PBR-rendering med PCFSoftShadowMap og ACES filmic tone mapping
- Vanilla HTML/JS — ingen build-steg, ingen avhengigheter
- Python HTTP-server for lokal utvikling
