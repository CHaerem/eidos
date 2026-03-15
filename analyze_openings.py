#!/usr/bin/env python3
"""
Analyze OBJ model to find window and door openings.

Parses the OBJ file, applies scale (0.1) and Y-shift (+1.22),
then finds gaps in wall geometry that correspond to windows and doors.
"""

from collections import defaultdict

OBJ_PATH = "Vibes Gate 20 - Ground Floor.obj"
SCALE = 0.1
Y_SHIFT = 1.22  # After scaling, shift Y so floor = 0

# Interior wall definitions from config (in final meters)
INTERIOR_WALLS = {
    "Wall A (vert)": {"axis": "x", "pos": -2.769, "range_axis": "z", "range": (1.341, 2.502)},
    "Wall B (vert)": {"axis": "x", "pos": -1.946, "range_axis": "z", "range": (-2.500, -0.471)},
    "Wall C (vert)": {"axis": "x", "pos": 0.718, "range_axis": "z", "range": (0.821, 2.499)},
    "Wall D (horiz)": {"axis": "z", "pos": -0.471, "range_axis": "x", "range": (-4.378, -1.946)},
    "Wall E (horiz)": {"axis": "z", "pos": 0.821, "range_axis": "x", "range": (-1.993, 0.718)},
}


def parse_obj(path):
    """Parse OBJ file and return objects with their vertices and faces."""
    objects = []
    current_obj = None
    all_vertices = []

    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('o '):
                name = line[2:].strip()
                current_obj = {"name": name, "vertex_indices": [], "faces": []}
                objects.append(current_obj)
            elif line.startswith('v '):
                parts = line.split()
                x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                all_vertices.append((x, y, z))
                if current_obj is not None:
                    current_obj["vertex_indices"].append(len(all_vertices))
            elif line.startswith('f ') and current_obj is not None:
                parts = line.split()[1:]
                face_verts = []
                for p in parts:
                    vi = int(p.split('/')[0])
                    face_verts.append(vi)
                current_obj["faces"].append(face_verts)

    return objects, all_vertices


def transform_vertex(v):
    """Apply scale and Y-shift to raw OBJ vertex."""
    x, y, z = v
    return (x * SCALE, y * SCALE + Y_SHIFT, z * SCALE)


def analyze_south_wall_windows(objects, all_vertices):
    """
    Analyze the south wall to find window openings.

    Strategy: The south wall faces span from floor to ceiling. Where there
    are windows, the geometry has:
    - Sill faces: Y from 0 to ~1.0m (below window)
    - Header faces: Y from ~2.2m to 2.44m (above window)
    - Mullion faces: full height but narrow (between window panes)

    Window openings are where there are NO faces in the Y range 1.0 to 2.2m.
    """
    print("=" * 70)
    print("SOUTH/WINDOW WALL — WINDOW OPENINGS")
    print("=" * 70)

    # Collect all south wall faces from ExternalWalls and InnerSide
    south_faces = []
    for obj in objects:
        if "ExternalWalls" not in obj["name"]:
            continue
        for face_indices in obj["faces"]:
            transformed = [transform_vertex(all_vertices[vi - 1]) for vi in face_indices]
            z_vals = [v[2] for v in transformed]
            if all(-2.70 < z < -2.40 for z in z_vals):
                xs = [v[0] for v in transformed]
                ys = [v[1] for v in transformed]
                south_faces.append({
                    "x_min": min(xs), "x_max": max(xs),
                    "y_min": min(ys), "y_max": max(ys),
                    "width": max(xs) - min(xs),
                    "height": max(ys) - min(ys),
                })

    # Classify faces
    # Full height (floor to ceiling or near): solid wall segments / mullions
    # Sill (Y: 0 to ~1.0): below window
    # Header (Y: ~2.2 to 2.44): above window
    # Mid-height (Y: ~1.0 to ~2.2): between sill and header = wall between windows (mullions)

    wall_x_min = min(f["x_min"] for f in south_faces)
    wall_x_max = max(f["x_max"] for f in south_faces)

    print(f"\n  South wall X range: {wall_x_min:.3f}m to {wall_x_max:.3f}m")
    print(f"  Total faces: {len(south_faces)}")

    # Find faces that only exist in the mid-height zone (1.0 to 2.2m)
    # These are mullions between window panes
    mid_faces = [f for f in south_faces
                 if f["y_min"] >= 0.9 and f["y_max"] <= 2.3
                 and f["y_min"] < 1.5 and f["y_max"] > 1.5]

    print(f"\n  Mid-height faces (mullions, Y spans 1.0-2.2 zone):")
    for f in sorted(mid_faces, key=lambda x: x["x_min"]):
        print(f"    X: [{f['x_min']:.3f}, {f['x_max']:.3f}] Y: [{f['y_min']:.3f}, {f['y_max']:.3f}]")

    # Now find where the glass is: look at the mid-height zone (Y: 1.0 to 2.2)
    # and find X ranges NOT covered by any face
    # Build coverage in mid zone
    mid_coverage = []
    for f in south_faces:
        # Does this face cover any of the mid zone?
        if f["y_max"] > 1.0 and f["y_min"] < 2.2:
            mid_coverage.append((f["x_min"], f["x_max"]))

    # Merge overlapping coverage
    mid_coverage.sort()
    merged = [list(mid_coverage[0])]
    for s, e in mid_coverage[1:]:
        if s <= merged[-1][1] + 0.01:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])

    print(f"\n  Mid-height coverage (merged):")
    for s, e in merged:
        print(f"    X: [{s:.3f}, {e:.3f}] (width: {e-s:.3f}m)")

    # The "window openings" are the gaps in mid-height coverage
    # But actually for this model, the wall geometry COVERS the window area too
    # with sill and header faces. We need a different approach.

    # Better approach: Find where wall is NOT full-height
    # Scan along X and determine wall coverage pattern at each position

    print("\n  --- Window structure analysis ---")

    # Look at full-height faces (covering floor to near-ceiling): these are solid wall
    full_height = [f for f in south_faces if f["height"] > 1.8]
    sill_faces = [f for f in south_faces if f["y_max"] <= 1.1 and f["height"] < 1.5]
    header_faces = [f for f in south_faces if f["y_min"] >= 1.9 and f["height"] < 0.5]

    print(f"\n  Full-height faces (solid wall/mullions, h>1.8m):")
    for f in sorted(full_height, key=lambda x: x["x_min"]):
        print(f"    X: [{f['x_min']:.3f}, {f['x_max']:.3f}] Y: [{f['y_min']:.3f}, {f['y_max']:.3f}] w={f['width']:.3f}m")

    print(f"\n  Sill faces (Y_max <= 1.1, below windows):")
    for f in sorted(sill_faces, key=lambda x: x["x_min"]):
        print(f"    X: [{f['x_min']:.3f}, {f['x_max']:.3f}] Y: [{f['y_min']:.3f}, {f['y_max']:.3f}]")

    print(f"\n  Header faces (Y_min >= 1.9, above windows):")
    for f in sorted(header_faces, key=lambda x: x["x_min"]):
        print(f"    X: [{f['x_min']:.3f}, {f['x_max']:.3f}] Y: [{f['y_min']:.3f}, {f['y_max']:.3f}]")

    # Now determine window openings:
    # A window opening is where we have sill + header but NOT full-height wall
    # Find the X ranges covered by full-height faces
    fh_coverage = [(f["x_min"], f["x_max"]) for f in full_height]
    fh_coverage.sort()
    fh_merged = [list(fh_coverage[0])]
    for s, e in fh_coverage[1:]:
        if s <= fh_merged[-1][1] + 0.01:
            fh_merged[-1][1] = max(fh_merged[-1][1], e)
        else:
            fh_merged.append([s, e])

    print(f"\n  Solid wall segments (full-height merged):")
    for s, e in fh_merged:
        print(f"    X: [{s:.3f}, {e:.3f}] (width: {e-s:.3f}m)")

    # Gaps in full-height = window zones
    print(f"\n  *** WINDOW ZONES (gaps in full-height coverage) ***")
    window_zones = []
    for i in range(len(fh_merged) - 1):
        gap_start = fh_merged[i][1]
        gap_end = fh_merged[i + 1][0]
        if gap_end - gap_start > 0.05:
            window_zones.append((gap_start, gap_end))

    if not window_zones:
        print("    No gaps found between full-height segments")

    for i, (gs, ge) in enumerate(window_zones):
        width = ge - gs
        print(f"\n    Window Zone {i+1}: X = {gs:.3f}m to {ge:.3f}m (width: {width:.3f}m)")
        print(f"      Center X: {(gs+ge)/2:.3f}m")

    # Now within each window zone, find mullions (mid-height faces)
    # that divide the zone into individual window panes
    print(f"\n  *** INDIVIDUAL WINDOW PANES (within window zones) ***")

    all_windows = []
    for zi, (zs, ze) in enumerate(window_zones):
        # Find mullions within this zone
        zone_mullions = [f for f in mid_faces
                        if f["x_min"] >= zs - 0.05 and f["x_max"] <= ze + 0.05]

        if not zone_mullions:
            # Check for any face in this zone that doesn't span the full zone
            zone_mid_faces = [f for f in south_faces
                             if f["x_min"] >= zs - 0.05 and f["x_max"] <= ze + 0.05
                             and f["y_min"] >= 0.9 and f["y_max"] <= 2.3
                             and f["width"] < (ze - zs) * 0.8]
            if zone_mid_faces:
                zone_mullions = zone_mid_faces

        if zone_mullions:
            # Sort mullions by X position
            zone_mullions.sort(key=lambda f: f["x_min"])
            print(f"\n    Window Zone {zi+1} mullions:")
            for f in zone_mullions:
                print(f"      X: [{f['x_min']:.3f}, {f['x_max']:.3f}] w={f['width']:.3f}m")

            # Window panes are between mullions and between zone edges and mullions
            pane_edges = [zs]
            for m in zone_mullions:
                pane_edges.append(m["x_min"])
                pane_edges.append(m["x_max"])
            pane_edges.append(ze)

            for j in range(0, len(pane_edges) - 1, 2):
                ps, pe = pane_edges[j], pane_edges[j + 1]
                if pe - ps > 0.05:
                    all_windows.append((ps, pe))
                    print(f"      Pane: X = {ps:.3f}m to {pe:.3f}m (width: {pe-ps:.3f}m)")
        else:
            # Single pane window
            all_windows.append((zs, ze))
            print(f"\n    Window Zone {zi+1}: Single pane X = {zs:.3f}m to {ze:.3f}m")

    # Summary
    print(f"\n\n  *** SOUTH WALL SUMMARY ***")
    print(f"  Total window zones: {len(window_zones)}")

    # Sill and header heights
    if sill_faces:
        sill_top = max(f["y_max"] for f in sill_faces)
        print(f"  Window sill height: ~{sill_top:.3f}m from floor")
    if header_faces:
        header_bottom = min(f["y_min"] for f in header_faces)
        print(f"  Window header height: ~{header_bottom:.3f}m from floor")
        if sill_faces:
            opening_height = header_bottom - sill_top
            print(f"  Window opening height: ~{opening_height:.3f}m")

    print(f"\n  Window openings (glass areas):")
    for i, (ws, we) in enumerate(all_windows):
        print(f"    Window {i+1}: X = {ws:.3f}m to {we:.3f}m (width: {we-ws:.3f}m, center: {(ws+we)/2:.3f}m)")


def analyze_west_wall_window(objects, all_vertices):
    """Analyze the west wall (X ≈ -4.46) for window openings."""
    print("\n" + "=" * 70)
    print("WEST WALL — WINDOW OPENING")
    print("=" * 70)

    west_faces = []
    for obj in objects:
        if "ExternalWalls" not in obj["name"]:
            continue
        for face_indices in obj["faces"]:
            transformed = [transform_vertex(all_vertices[vi - 1]) for vi in face_indices]
            xs = [v[0] for v in transformed]
            if all(-4.50 < x < -4.40 for x in xs):
                ys = [v[1] for v in transformed]
                zs = [v[2] for v in transformed]
                west_faces.append({
                    "z_min": min(zs), "z_max": max(zs),
                    "y_min": min(ys), "y_max": max(ys),
                    "width": max(zs) - min(zs),
                    "height": max(ys) - min(ys),
                })

    print(f"\n  West wall faces: {len(west_faces)}")

    full_height = [f for f in west_faces if f["height"] > 1.8]
    partial = [f for f in west_faces if f["height"] <= 1.8]

    print(f"\n  Full-height faces (solid wall):")
    for f in sorted(full_height, key=lambda x: x["z_min"]):
        print(f"    Z: [{f['z_min']:.3f}, {f['z_max']:.3f}] Y: [{f['y_min']:.3f}, {f['y_max']:.3f}] w={f['width']:.3f}m")

    print(f"\n  Partial-height faces (above/below window):")
    for f in sorted(partial, key=lambda x: x["z_min"]):
        print(f"    Z: [{f['z_min']:.3f}, {f['z_max']:.3f}] Y: [{f['y_min']:.3f}, {f['y_max']:.3f}] h={f['height']:.3f}m")

    # Find gaps in full-height coverage
    fh_coverage = [(f["z_min"], f["z_max"]) for f in full_height]
    fh_coverage.sort()
    fh_merged = [list(fh_coverage[0])]
    for s, e in fh_coverage[1:]:
        if s <= fh_merged[-1][1] + 0.01:
            fh_merged[-1][1] = max(fh_merged[-1][1], e)
        else:
            fh_merged.append([s, e])

    print(f"\n  Full-height coverage (merged):")
    for s, e in fh_merged:
        print(f"    Z: [{s:.3f}, {e:.3f}]")

    # Gaps
    print(f"\n  *** WINDOW OPENING(S) ***")
    for i in range(len(fh_merged) - 1):
        gap_start = fh_merged[i][1]
        gap_end = fh_merged[i + 1][0]
        if gap_end - gap_start > 0.1:
            print(f"    Window: Z = {gap_start:.3f}m to {gap_end:.3f}m (width: {gap_end-gap_start:.3f}m)")


def analyze_interior_walls(objects, all_vertices):
    """Analyze interior walls for door openings."""
    print("\n" + "=" * 70)
    print("INTERIOR WALLS — DOOR OPENINGS")
    print("=" * 70)

    inner_faces = []
    for obj in objects:
        if "InnerSide" not in obj["name"]:
            continue
        for face_indices in obj["faces"]:
            transformed = [transform_vertex(all_vertices[vi - 1]) for vi in face_indices]
            xs = [v[0] for v in transformed]
            ys = [v[1] for v in transformed]
            zs = [v[2] for v in transformed]
            inner_faces.append({
                "x_min": min(xs), "x_max": max(xs),
                "y_min": min(ys), "y_max": max(ys),
                "z_min": min(zs), "z_max": max(zs),
                "name": obj["name"],
            })

    for wall_name, wall_def in INTERIOR_WALLS.items():
        print(f"\n  --- {wall_name} ---")
        axis_idx = {"x": 0, "z": 2}
        axis = wall_def["axis"]
        range_axis = wall_def["range_axis"]
        wall_pos = wall_def["pos"]
        wall_range = wall_def["range"]

        matching = []
        for f in inner_faces:
            if axis == "x":
                axis_min, axis_max = f["x_min"], f["x_max"]
            else:
                axis_min, axis_max = f["z_min"], f["z_max"]

            if range_axis == "x":
                range_min, range_max = f["x_min"], f["x_max"]
            else:
                range_min, range_max = f["z_min"], f["z_max"]

            # Check if on wall plane
            axis_center = (axis_min + axis_max) / 2
            if abs(axis_center - wall_pos) < 0.15:
                # Check overlap with wall range
                if range_max > wall_range[0] - 0.1 and range_min < wall_range[1] + 0.1:
                    matching.append({
                        "range_min": range_min, "range_max": range_max,
                        "y_min": f["y_min"], "y_max": f["y_max"],
                        "width": range_max - range_min,
                        "height": f["y_max"] - f["y_min"],
                    })

        if not matching:
            print(f"    No faces found")
            continue

        # Separate full-height from partial
        full_h = [f for f in matching if f["height"] > 1.5]
        partial_h = [f for f in matching if f["height"] <= 1.5]

        if full_h:
            # Find coverage of full-height faces
            fh_cov = [(f["range_min"], f["range_max"]) for f in full_h]
            fh_cov.sort()
            merged = [list(fh_cov[0])]
            for s, e in fh_cov[1:]:
                if s <= merged[-1][1] + 0.02:
                    merged[-1][1] = max(merged[-1][1], e)
                else:
                    merged.append([s, e])

            # Find gaps
            gaps = []
            if merged[0][0] - wall_range[0] > 0.3:
                gaps.append((wall_range[0], merged[0][0]))
            for i in range(len(merged) - 1):
                gap_s = merged[i][1]
                gap_e = merged[i + 1][0]
                if gap_e - gap_s > 0.3:
                    gaps.append((gap_s, gap_e))
            if wall_range[1] - merged[-1][1] > 0.3:
                gaps.append((merged[-1][1], wall_range[1]))

            if gaps:
                for gs, ge in gaps:
                    w = ge - gs
                    # Check for header above door
                    door_header = [f for f in partial_h
                                  if f["range_min"] < ge and f["range_max"] > gs
                                  and f["y_min"] > 1.5]
                    header_h = ""
                    if door_header:
                        header_h = f", header at Y={min(f['y_min'] for f in door_header):.3f}m"

                    print(f"    DOOR OPENING: {range_axis} = {gs:.3f}m to {ge:.3f}m "
                          f"(width: {w:.3f}m, center: {(gs+ge)/2:.3f}m{header_h})")
                    print(f"      Position: {axis}={wall_pos:.3f}m")
            else:
                print(f"    No door openings — wall is fully covered")
                print(f"    Coverage: {['[{:.3f}, {:.3f}]'.format(s, e) for s, e in merged]}")
        else:
            print(f"    Only partial-height faces (entire span may be open)")
            for f in sorted(partial_h, key=lambda x: x["range_min"]):
                print(f"      {range_axis}: [{f['range_min']:.3f}, {f['range_max']:.3f}] "
                      f"Y: [{f['y_min']:.3f}, {f['y_max']:.3f}]")


def main():
    print("Parsing OBJ file...")
    objects, all_vertices = parse_obj(OBJ_PATH)
    print(f"Found {len(objects)} objects, {len(all_vertices)} total vertices\n")

    # Transform all vertices for summary
    all_transformed = [transform_vertex(v) for v in all_vertices]
    xs = [v[0] for v in all_transformed]
    ys = [v[1] for v in all_transformed]
    zs = [v[2] for v in all_transformed]
    print(f"Transformed coordinate ranges (scale={SCALE}, Y-shift={Y_SHIFT}):")
    print(f"  X: {min(xs):.3f} to {max(xs):.3f}")
    print(f"  Y: {min(ys):.3f} to {max(ys):.3f}")
    print(f"  Z: {min(zs):.3f} to {max(zs):.3f}")

    analyze_south_wall_windows(objects, all_vertices)
    analyze_west_wall_window(objects, all_vertices)
    analyze_interior_walls(objects, all_vertices)

    # Final summary
    print("\n" + "=" * 70)
    print("FINAL SUMMARY — ALL OPENINGS (coordinates in meters)")
    print("=" * 70)

    print("""
  SOUTH WALL (Z ≈ -2.58, window wall):
    Window sill: Y ≈ 1.000m from floor
    Window header: Y ≈ 2.200m from floor
    Window opening height: ≈ 1.200m

    Window Zone 1 (bedroom): X = -3.795 to -2.613m (1.182m wide)
      - Between solid wall segments at X < -3.795 and X > -2.613
      - Subdivided by mullions at X ≈ -0.396 and X ≈ 0.651

    Window Zone 2 (living room): X = -1.578 to 4.084m (5.662m wide)
      - Large window section, subdivided by mullions
      - Mullion positions determine individual pane widths

  WEST WALL (X ≈ -4.46):
    Window opening between solid wall segments

  INTERIOR WALLS — DOORS:
    Wall D (z=-0.471): Door at x = -3.606 to -2.807m (0.799m wide)
      - Between kitchen/bathroom area and hall
""")


if __name__ == "__main__":
    main()
