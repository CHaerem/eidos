# Eidos — 3D Leilighetsplanlegger

> *Eidos* (gresk: εἶδος) — form, idé. Den ideelle formen av noe, sett med sinnets øye.

Se den ideelle versjonen av rommet ditt før det eksisterer. Planlegg møblering, test plasseringer, diskuter feng shui — og utforsk leiligheten i VR.

## Visjon

Eidos er en interaktiv 3D-planlegger som lar deg visualisere og planlegge innredningen av en leilighet. Prosjektet har fire ambisjoner:

1. **Ultrarealistisk 3D-modell** — PBR-materialer, skygger, arkitektoniske detaljer
2. **AI-assistert planlegging** — Diskuter planløsninger og feng shui med Claude
3. **VR-utforskning** — Gå gjennom leiligheten med Meta Quest 3
4. **Gjenbrukbart rammeverk** — Bytt ut én JSON-fil for å modellere en ny leilighet

Første leilighet: Vibes gate 20B, 5. etasje (loft), Oslo.

## Progresjon

| Fase | Status | Beskrivelse |
|------|--------|-------------|
| 1. Modularisering | ✅ Ferdig | Monolitt → 8 ES-moduler + leilighetskonfig JSON |
| 2. PBR + Skygger | ✅ Ferdig | MeshStandardMaterial, shadow mapping, tone mapping, bedre belysning |
| 3. Romdetaljer | ✅ Ferdig | Vinduer, dørkarmer, fotlister, ugjennomsiktig tak |
| 4. WebXR/VR | 🔲 Planlagt | Meta Quest 3, teleportering, controller-interaksjon |
| 5. Konfig-system | 🔲 Planlagt | Data-drevet rombygger, URL-parameter for leilighetsvalg |

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
