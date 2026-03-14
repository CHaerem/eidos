# GolfSim – 3D Stue- og Golfsimulator Planlegger

Interaktiv 3D-planlegger for Vibes gate 20B, 5. etasje (loft). Visualiserer rommet med skråtak og lar deg plassere en golfsimulator med klaringsberegninger.

## Funksjoner

- 3D-modell av leiligheten (OBJ) med korrekt skråtak
- Golfsimulator med slagskjerm, matte og svingbue
- Justerbar golferhøyde, klubbvalg og slagretning
- Klaringsberegninger (tak, hemskant, sider)
- Flere visningsvinkler (ovenfra, 3D, front, side)

## Kjør lokalt

```bash
cd /path/to/GolfSim
python3 -m http.server 8765
```

Åpne `http://localhost:8765/golfsim-3d.html` i nettleseren.

## Filer

| Fil | Beskrivelse |
|-----|-------------|
| `golfsim-3d.html` | Hovedapplikasjon – 3D golfsim-planlegger |
| `obj-viewer.html` | Enkel OBJ-viewer for inspeksjon av 3D-modellen |
| `Vibes Gate 20 - Ground Floor.obj` | 3D-modell av bygningen |

## Teknologi

- [Three.js](https://threejs.org/) v0.162.0 (ES modules)
- OBJLoader, OrbitControls
- Vanilla HTML/JS – ingen build-steg
