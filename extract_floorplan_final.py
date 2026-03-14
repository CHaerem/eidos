#!/usr/bin/env python3
"""Final floor plan extraction - accurate polygon and area calculation."""

import math

print("="*80)
print("FLOOR PLAN EXTRACTION - FINAL RESULTS")
print("="*80)

# All coordinates in meters (OBJ decimeters / 10)
# Using INNER wall surfaces (room-facing side)

print("""
APARTMENT OUTLINE (inner wall boundaries):
==========================================

The apartment is roughly rectangular but with a SLANTED right facade.
The right exterior wall runs diagonally from (4.377, 2.498) to (4.378, -2.502).

Outline polygon (clockwise from top-left):
""")

# Full apartment inner boundary polygon
outline = [
    (-4.377,  2.496),   # A: top-left corner
    ( 0.640,  2.500),   # B: top edge (wall C position) -- effectively same z
    ( 4.377,  2.498),   # C: top-right corner
    ( 4.378, -2.502),   # D: bottom-right corner (slanted facade)
    (-1.946, -2.500),   # E: bottom edge at wall B
    (-4.377, -2.490),   # F: bottom-left corner
]

for i, (x, z) in enumerate(outline):
    label = 'ABCDEF'[i]
    print(f"  {label}: x={x:7.3f}m, z={z:7.3f}m")

def polygon_area(pts):
    n = len(pts)
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2

total_area = polygon_area(outline)
print(f"\nTotal apartment area (inner): {total_area:.2f} m²")

print(f"""
INTERIOR WALLS divide the apartment into rooms:
================================================

  Wall A (vertical):   x = -2.77m to -2.85m (thickness ~8cm)
                       Spans from z≈1.30 to z=2.50 (upper section only)
                       This wall has a DIAGONAL section from z≈1.30 down to
                       where it meets Wall E at z≈0.90

  Wall B (vertical):   x = -1.95m to -2.03m (thickness ~8cm)
                       Spans from z=-2.50 to z=-0.47 (lower section only)

  Wall C (vertical):   x = 0.64m to 0.72m (thickness ~8cm)
                       Spans from z=0.82 to z=2.50 (upper section only)

  Wall D (horizontal): z = -0.47m to -0.55m (thickness ~8cm)
                       Spans from x=-4.38 to x=-1.95

  Wall E (horizontal): z = 0.82m to 0.90m (thickness ~8cm)
                       Spans from x=-2.00 to x=0.72
                       Has diagonal connection to Wall A
""")

print("="*80)
print("ROOM IDENTIFICATION")
print("="*80)

# Room 1: Top-left (small room, likely bathroom/hallway)
r1 = [(-4.377, 2.496), (-2.848, 2.496), (-2.848, 1.295), (-4.377, 1.295)]
# Note: bottom edge is approximate due to diagonal wall A section

# Room 2: Top-center (part of stue or separate room)
r2 = [(-2.769, 2.502), (0.639, 2.502), (0.639, 0.902), (-1.974, 0.902)]
# Note: left side has diagonal from (-1.974, 0.902) up to (-2.769, 2.502) area

# Room 3: Top-right (part of stue)
r3 = [(0.718, 2.499), (4.377, 2.498), (4.378, -2.502), (-1.946, -2.500),
       (-1.946, -0.471), (0.718, -0.471)]
# Wait - this is the big open area. Let me reconsider.

# Actually, looking at wall positions:
# - Wall D (z≈-0.47 to -0.55) only goes from x=-4.38 to x=-1.95
# - Wall E (z≈0.82 to 0.90) only goes from x=-2.00 to x=0.72
# - Wall C (x≈0.64 to 0.72) only goes from z=0.82 to z=2.50
# - Wall B (x≈-1.95 to -2.03) only goes from z=-2.50 to z=-0.47
#
# This means:
# - The area to the right of Wall C and below Wall E is OPEN
# - The area below Wall D and to the right of Wall B is OPEN
# - These open areas connect!

# So the large stue/living room is:
# Everything to the right of walls A and B, except the upper-left pocket

print("""
ROOM LAYOUT:
============

The apartment has 4 distinct rooms separated by interior walls:

Room 1 (Top-left, small): "Soverom" or utility
  Bounded by: x=-4.377 to x≈-2.85, z≈1.30 to z=2.50
  Width: ~1.53m, Depth: ~1.20m
  Area: ~1.84 m²

Room 2 (Top-center): Possibly part of L-shaped room
  Bounded by: x≈-2.77 to x=0.64, z=0.90 to z=2.50
  Width: ~3.41m, Depth: ~1.60m
  Area: ~5.45 m²

Room 3 (Top-right): Adjacent to Room 2
  Bounded by: x=0.72 to slanted right wall, z=0.82 to z=2.50
  Width: ~3.66m (to slanted wall), Depth: ~1.68m
  Area: ~6.14 m² (approximate, right wall is slanted)

Room 4 (Bottom-left): Enclosed room
  Bounded by: x=-4.377 to x≈-2.03, z=-2.49 to z≈-0.55
  Width: ~2.35m, Depth: ~1.94m
  Area: ~4.54 m²

Large open area (Bottom-center-right + connection):
  The area from x≈-1.95 to the slanted right wall, z=-2.50 upward
  This connects to Rooms 2 and 3 if they share an open plan
""")

# Check if Room 2 and Room 3 are actually one open room (stue)
# Wall C goes from z=0.82 to z=2.50 - it separates them at the TOP
# But Wall E goes from x=-2.00 to x=0.72 - it's BELOW both rooms
# So Rooms 2 and 3 are separate rooms divided by Wall C

# The big open area is everything NOT enclosed by walls
# Below Wall E (z<0.82) and to the right of Wall B (x>-1.95):
# This area goes from z=-2.50 up to z=0.82, and from x=-1.95 to the slanted wall

print("="*80)
print("L-SHAPED STUE ANALYSIS")
print("="*80)

# For the stue to be L-shaped, it probably combines:
# - Room 3 (top-right, above z=0.82)
# - The large bottom-right open area (below z=0.82, right of x=-1.95)
# This creates an L-shape!

# Or possibly Room 2 + Room 3 + open area below

# Let's compute the L-shaped stue assuming it's:
# Top part: x=0.72 to right wall, z=0.82 to z=2.50
# Bottom part: x=-1.95 to right wall, z=-2.50 to z=0.82

# The right wall is slanted: from (4.377, 2.498) to (4.378, -2.502)
# At z=0.82, the right wall x ≈ 4.377 + (4.378-4.377)*(2.498-0.82)/(2.498+2.502)
# ≈ 4.377 (essentially vertical at this scale - only 0.001m difference!)

# Actually the slant is only 0.001m over 5m - it's essentially vertical!
# The "diagonal" in the OBJ is likely just numerical precision, not an actual slant.

# BUT looking at wall 21: (0.640, 2.502) -> (4.378, -2.502)
# This is a 6.25m diagonal wall! And wall 20: (-4.457, 2.576) -> (-2.026, -2.579)
# is a 5.70m diagonal wall!

# These are the OUTER surface of the floor/ceiling slab - they represent
# the building outline, not necessarily visible walls.

# The actual exterior walls that form room boundaries are:
# Left: x=-4.377 (vertical, confirmed by multiple wall segments)
# Top: z≈2.50 (horizontal, confirmed)
# Bottom: z≈-2.50 (horizontal, confirmed)
# Right: Need to check - is it vertical or slanted?

# Object cb6be5f4 has points at (4.377, 2.498), (4.378, -2.502) AND
# (0.310, -0.222), (0.310, 0.491), (0.379, -0.222), (0.379, 0.491)
# This suggests a column at x≈0.35 and a wall from (4.377,2.498) to (4.378,-2.502)

# The right "wall" at x≈4.38 is essentially vertical (1mm difference over 5m)

print("""
The L-SHAPED STUE appears to be the large open living area:

Option A: If wall C (x≈0.64-0.72) separates rooms 2 and 3:
  The stue = Room 3 (top-right) + open area below

  Top section:  x=0.72 to 4.38, z=0.82 to 2.50
                Width: 3.66m, Depth: 1.68m = 6.15 m²

  Bottom section: x=-1.95 to 4.38, z=-2.50 to 0.82
                  Width: 6.33m, Depth: 3.32m = 21.02 m²

  Total L-shaped area: ~27.17 m²

  L-shape dimensions:
    Full width (bottom): 6.33m
    Narrow width (top): 3.66m
    Full height: 5.00m (z=-2.50 to z=2.50)
    Short height (left side): 3.32m (z=-2.50 to z=0.82)

Option B: If wall C is NOT a dividing wall (open plan):
  The stue = Rooms 2+3 + open area below

  Top section:  x=-2.77 to 4.38, z=0.90 to 2.50
                Width: 7.15m, Depth: 1.60m = 11.44 m²

  Bottom section: x=-1.95 to 4.38, z=-2.50 to 0.90
                  Width: 6.33m, Depth: 3.40m = 21.52 m²

  Total L-shaped area: ~32.96 m²
""")

# Let's compute actual areas for the L-shape options with slanted wall
# The right wall goes from (4.377, 2.498) to (4.378, -2.502)
# This is essentially x=4.378, so we'll treat it as vertical

print("="*80)
print("PRECISE COORDINATE TABLE FOR GOLF SIMULATOR")
print("="*80)

print("""
All coordinates in METERS, measured from OBJ inner wall surfaces:

APARTMENT CORNERS (inner walls):
  Top-left:     (-4.377,  2.496)
  Top-right:    ( 4.377,  2.498)  [~4.378 at bottom]
  Bottom-right: ( 4.378, -2.502)
  Bottom-left:  (-4.377, -2.490)

INTERIOR WALL POSITIONS (inner face, closest to room center):
  Wall A (vert):  x = -2.769m  (from z=1.341 to z=2.502, with diagonal below)
  Wall B (vert):  x = -1.946m  (from z=-2.500 to z=-0.471)
  Wall C (vert):  x =  0.718m  (from z=0.821 to z=2.499)
  Wall D (horiz): z = -0.471m  (from x=-4.378 to x=-1.946)
  Wall E (horiz): z =  0.821m  (from x=-1.993 to x=0.718)

COLUMN/PILLAR at approximately:
  x = 0.310 to 0.379m, z = -0.222 to 0.491m

KEY MEASUREMENTS:
  Total width (top):    {w_top:.3f}m
  Total width (bottom): {w_bot:.3f}m
  Left side height:     {h_left:.3f}m
  Right side height:    {h_right:.3f}m
  Wall thickness:       ~0.080m (8cm) for most walls
""".format(
    w_top=4.377-(-4.377),
    w_bot=4.378-(-4.377),
    h_left=2.496-(-2.490),
    h_right=2.498-(-2.502),
))

# Comparison table
print("="*80)
print("COMPARISON: OBJ vs PLANTEGNING")
print("="*80)

comparisons = [
    ("Top edge (window wall) width", 4.377-(-4.377), 8.65, "m"),
    ("Left side depth", 2.496-(-2.490), 4.80, "m"),
    ("Right side depth", 2.498-(-2.502), 6.80, "m"),
    ("Bottom edge width", 4.378-(-4.377), 8.48, "m"),
    ("Room 1 width (soverom?)", 2.769-(-4.377+4.377+2.769), None, "m"),  # skip
]

print(f"\n{'Measurement':<35} {'OBJ (m)':>10} {'Plan (m)':>10} {'Ratio':>8}")
print("-" * 70)
data = [
    ("Top edge width",           4.377-(-4.377),   8.65),
    ("Bottom edge width",        4.378-(-4.377),   8.48),
    ("Left side depth",          2.496-(-2.490),   4.80),
    ("Right side depth",         2.498-(-2.502),   6.80),
    ("Left room width (top)",    -2.848-(-4.377),  2.30),
    ("Bottom-left room width",   -2.031-(-4.377),  None),
    ("Bottom-left room depth",   -0.554-(-2.489),  None),
    ("Wall B to right edge",     4.378-(-1.946),   None),
]

for name, obj_val, plan_val in data:
    if plan_val:
        ratio = obj_val / plan_val
        print(f"  {name:<33} {obj_val:10.3f} {plan_val:10.3f} {ratio:8.3f}")
    else:
        print(f"  {name:<33} {obj_val:10.3f} {'N/A':>10}")

print("""
OBSERVATIONS:
- OBJ top width (8.754m) vs plantegning (8.65m): ratio 1.012
- OBJ left depth (4.986m) vs plantegning (4.80m): ratio 1.039
- OBJ right depth (5.000m) vs plantegning (6.80m): MISMATCH!
  This suggests the OBJ model is NOT the same floor as the plantegning,
  OR the right wall treatment is different (possibly the slanted facade
  means the 5th floor has a different footprint than ground floor).

- The OBJ is labeled "Ground Floor" while the plantegning shows 5th floor.
  Ground floor likely has a different layout/dimensions than the 5th floor.

- Left room width: OBJ=1.529m vs plantegning soverom=2.30m (different!)
  This confirms the ground floor layout differs from the 5th floor.

SCALE FACTOR: The overall width ratio (~1.01) suggests the OBJ units
are correct (decimeters -> meters by /10). No additional scaling needed.
""")
