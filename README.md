# Eidos — 3D Leilighetsplanlegger

Interaktiv 3D-planlegger for leiligheter. Visualiserer rommet med korrekt geometri og lar deg plassere møbler, golfsimulator og annet inventar med drag-and-drop.

Første leilighet: Vibes gate 20B, 5. etasje (loft), Oslo.

## Funksjoner

- 3D-modell av leiligheten (OBJ) med korrekt skråtak
- Møbelkatalog med detaljerte 3D-modeller (BESTÅ, Söderhamn, Bolia Cana + Frame TV)
- Drag-and-drop plassering med snap-to-wall
- Rotasjonsknapper (0°/90°/180°/270°) og tastatursnarveier
- Golfsimulator med svingbue og klaringsberegninger
- Flere visningsvinkler (ovenfra, 3D, front, side)
- Leilighetskonfig via JSON — gjenbrukbart for andre bygg

## Kjør lokalt

```bash
python3 -m http.server 8765
```

Åpne `http://localhost:8765/index.html` i nettleseren.

## Prosjektstruktur

| Fil/Mappe | Beskrivelse |
|-----------|-------------|
| `index.html` | Hovedapplikasjon — HTML-shell med sidebar og importmap |
| `js/main.js` | Entry point — initialiserer alle moduler |
| `js/state.js` | Delt state (scene, kamera, møbler, simulator) |
| `js/scene.js` | Three.js scene, renderer, lys, kontroller, visninger |
| `js/room.js` | OBJ-lasting, takgeometri, romkonstanter |
| `js/furniture.js` | Møbelkatalog og 3D-modellbyggere |
| `js/interaction.js` | Drag-and-drop, raycasting, seleksjon, tastatur |
| `js/simulator.js` | Golfsimulator, svingformler, klaringer |
| `js/ui.js` | Sidebar-kontroller og møbelliste |
| `config/apartment.json` | Leilighetskonfigurasjon (romgrenser, tak, OBJ-sti) |
| `golfsim-3d.html` | Legacy — original monolittisk versjon |

## Teknologi

- [Three.js](https://threejs.org/) v0.162.0 (native ES modules via importmap)
- OBJLoader, OrbitControls
- Vanilla HTML/JS — ingen build-steg
- Python HTTP-server for lokal utvikling

## Veikart

- [ ] PBR-materialer og skygger
- [ ] Vinduer, dørkarmer, fotlister
- [ ] WebXR/VR-støtte (Meta Quest 3)
- [ ] Gjenbrukbart konfig-system for andre leiligheter
