#!/usr/bin/env python3
"""Extract floor plan shape from OBJ - focused analysis."""

import math

OBJ_PATH = "/Users/christopherhaerem/Privat/GolfSim/Vibes Gate 20 - Ground Floor.obj"

# Parse OBJ
vertices = []
objects = []
current_obj = None
current_verts = []

with open(OBJ_PATH, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith('o '):
            if current_obj is not None:
                objects.append((current_obj, list(current_verts)))
            current_obj = line[2:]
            current_verts = []
        elif line.startswith('v ') and not line.startswith('vt') and not line.startswith('vn'):
            parts = line.split()
            x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
            vertices.append((x, y, z))
            current_verts.append(len(vertices) - 1)

if current_obj is not None:
    objects.append((current_obj, list(current_verts)))

FLOOR_Y = -12.2
Y_TOL = 0.5

# The last two objects (0bcd6ec2-d67) appear to be the floor/ceiling polygons
# They contain the outer and inner boundary vertices
# Let's focus on those

print("="*80)
print("FLOOR BOUNDARY ANALYSIS")
print("="*80)

# The outer boundary object has vertices at y=-12.2 with the full perimeter
# From the previous output, the last two objects both named 0bcd6ec2-d67
# contain the outer wall surface and inner wall surface vertices

# OUTER wall boundary (object index -2, the one with -4.458, etc.)
# Points in meters:
outer_pts = [
    (-4.458, -0.552), (-4.457, 1.065), (-4.457, 1.866), (-4.457, 2.576),
    (-4.456, -2.570),  (-4.456, -0.552),
    (-2.850, 2.576), (-2.850, 2.582),
    (-2.026, -2.580), (-2.026, -2.579),
    (0.720, 2.579), (0.720, 2.582),
    (4.457, 2.578), (4.458, -2.581)
]

# INNER wall boundary (object index -1)
inner_pts = [
    (-4.378, -0.471), (-4.377, 2.496),
    (-4.376, -2.490), (-4.376, -0.471),
    (-2.770, 2.496), (-2.770, 2.502),
    (-1.946, -2.500), (-1.946, -2.499),
    (0.640, 2.499), (0.640, 2.502),
    (4.377, 2.498), (4.378, -2.502)
]

# Let's look at the INNER boundary (room dimensions) since that's the usable space
# The inner wall points define the room boundaries

# From the wall analysis, we can identify the room structure:
# The walls form multiple rooms. Let me trace the boundaries.

# Looking at the wall segments:
# There are two parallel wall lines at different positions suggesting wall thickness:
#   Outer: x=-4.457/-4.458  Inner: x=-4.377/-4.378  (left wall, thickness ~0.08m)
#   Outer: z=2.576/2.582    Inner: z=2.496/2.502     (top wall)
#   Outer: z=-2.570/-2.581  Inner: z=-2.489/-2.502   (bottom wall)
#   At x≈-2.85/-2.77: intermediate wall
#   At x≈-2.02/-1.95: intermediate wall
#   At x≈0.64/0.72: intermediate wall
#   At z≈-0.55/-0.47: intermediate wall
#   At z≈0.82/0.90: intermediate wall (with diagonal section)

print("\nWALL STRUCTURE (inner surfaces = room boundaries):")
print("="*80)

print("\nThe apartment has walls creating multiple rooms.")
print("Let me identify each room by tracing inner wall surfaces.\n")

# From the wall segments analysis, the rooms are:
#
# Room 1 (top-left): bounded by
#   Left: x=-4.377, Top: z=2.496, Right: x=-2.848, Bottom: varies (has diagonal)
#
# Room 2 (top-center): bounded by
#   Left: x=-2.769, Top: z=2.502, Right: x=0.639, Bottom: z=0.902 (with diagonal)
#
# Room 3 (top-right): bounded by
#   Left: x=0.718, Top: z=2.499, Right: x=4.377 (exterior?), Bottom: ...
#
# Room 4 (bottom-left): bounded by
#   Left: x=-4.377, Top: z=-0.554, Right: x=-2.031, Bottom: z=-2.489
#   Actually: Left: x=-4.377, inner wall at z=-0.471 to z=-0.554

# Let me trace this more carefully using the wall segments
# Inner wall positions (using the closer-to-center surface):

print("KEY INNER WALL POSITIONS (meters):")
print("-" * 50)

walls = {
    'Left exterior':   'x = -4.377',
    'Right exterior':  'x = 4.377 (but this is a slanted facade!)',
    'Top exterior':    'z = 2.496 to 2.502',
    'Bottom exterior': 'z = -2.489 to -2.502',
    'Wall A (vert)':   'x = -2.848/-2.769 (pair, wall between rooms)',
    'Wall B (vert)':   'x = -2.031/-1.946 (pair, wall between rooms)',
    'Wall C (vert)':   'x = 0.639/0.718 (pair, wall between rooms)',
    'Wall D (horiz)':  'z = -0.554/-0.471 (pair, horizontal wall)',
    'Wall E (horiz)':  'z = 0.821/0.902 (pair, horizontal wall with diagonal)',
}

for name, pos in walls.items():
    print(f"  {name:20s}: {pos}")

# The diagonal walls are interesting - walls 20 and 21 from previous output
# Wall 20: (-4.457, 2.576) -> (-2.026, -2.579) - this is the OUTER surface diagonal
# Wall 21: (0.640, 2.502) -> (4.378, -2.502) - this is the OUTER surface diagonal
# But object cb6be5f4 has: (0.310,-0.222), (0.310,0.491), (0.379,-0.222), (0.379,0.491), (4.377,2.498), (4.378,-2.502)
# This suggests the right facade is a slanted wall from (4.377,2.498) to (4.378,-2.502) with a column

# Actually, looking more carefully at wall 15 and object cb6be5f4:
# The right side has a slanted exterior wall, plus there's something at x=0.31-0.38
# That seems like a column or pillar

print("\n" + "="*80)
print("ROOM DIMENSIONS")
print("="*80)

# Let me compute room dimensions based on inner wall surfaces
# Using the INNER surface of each wall pair

print("\n--- Room layout (top view, Z is up/north, X is right/east) ---")
print()

# The overall structure seems to be:
# Top row (z > ~0.9): three rooms side by side
# Bottom area (z < ~-0.47): rooms below

# Top-left room (soverom?):
r1_left = -4.377
r1_right = -2.848  # or -2.769
r1_top = 2.496
r1_bottom_approx = 1.295  # where wall E meets wall A
r1_w = abs(r1_right - r1_left)
r1_h = abs(r1_top - r1_bottom_approx)
print(f"Top-left room:  x=[{r1_left:.3f} to {r1_right:.3f}], z=[{r1_bottom_approx:.3f} to {r1_top:.3f}]")
print(f"  Width: {r1_w:.3f}m, Depth: {r1_h:.3f}m, Area: {r1_w*r1_h:.2f}m²")

# Top-center room (stue part 1?):
r2_left = -2.769
r2_right = 0.639
r2_top = 2.502
r2_bottom = 0.902
r2_w = abs(r2_right - r2_left)
r2_h = abs(r2_top - r2_bottom)
print(f"\nTop-center room: x=[{r2_left:.3f} to {r2_right:.3f}], z=[{r2_bottom:.3f} to {r2_top:.3f}]")
print(f"  Width: {r2_w:.3f}m, Depth: {r2_h:.3f}m, Area: {r2_w*r2_h:.2f}m²")

# Top-right room (stue part 2?):
r3_left = 0.718
r3_right = 4.377  # but this is slanted...
r3_top = 2.499
r3_bottom = 0.821
r3_w = abs(r3_right - r3_left)
r3_h = abs(r3_top - r3_bottom)
print(f"\nTop-right room:  x=[{r3_left:.3f} to {r3_right:.3f}], z=[{r3_bottom:.3f} to {r3_top:.3f}]")
print(f"  Width: {r3_w:.3f}m, Depth: {r3_h:.3f}m, Area: {r3_w*r3_h:.2f}m² (but right wall is slanted!)")

# Bottom room:
r4_left = -4.377
r4_right = -2.031  # or -1.946
r4_top = -0.554  # or -0.471
r4_bottom = -2.489
r4_w = abs(r4_right - r4_left)
r4_h = abs(r4_top - r4_bottom)
print(f"\nBottom-left room: x=[{r4_left:.3f} to {r4_right:.3f}], z=[{r4_bottom:.3f} to {r4_top:.3f}]")
print(f"  Width: {r4_w:.3f}m, Depth: {r4_h:.3f}m, Area: {r4_w*r4_h:.2f}m²")

# Bottom-right area (hallway or open?):
r5_left = -1.946
r5_right = 4.378  # slanted facade
r5_top = -0.471  # or some other wall
r5_bottom = -2.500
print(f"\nBottom-right area: x=[{r5_left:.3f} to slanted], z=[{r5_bottom:.3f} to ??]")

print("\n" + "="*80)
print("OVERALL APARTMENT OUTLINE (inner boundaries, meters)")
print("="*80)

# The entire apartment inner boundary, going clockwise from top-left:
# The floor/ceiling polygon gives us the full outline
# From the inner floor polygon (last object), the points at floor level are:
# (-4.377, 2.496), (-2.770, 2.496), (-2.770, 2.502), (0.640, 2.502), (0.640, 2.499)
# These seem like they trace the top edge with a slight step at x=-2.770

# Let me reconstruct the full inner boundary polygon
# Using the floor polygon vertices (inner surface):

inner_floor = [
    (-4.376, -2.490),
    (-4.376, -0.471),
    (-4.377, 2.496),
    (-2.770, 2.496),
    (-2.770, 2.502),
    (0.640, 2.502),
    (0.640, 2.499),
    (4.377, 2.498),
    (4.378, -2.502),
    (-1.946, -2.500),
    (-1.946, -2.499),
    (-4.378, -0.471),
]

# Simplify by merging near-duplicate points
def simplify(pts, tol=0.015):
    result = [pts[0]]
    for p in pts[1:]:
        if abs(p[0]-result[-1][0]) > tol or abs(p[1]-result[-1][1]) > tol:
            result.append(p)
    return result

simple = simplify(inner_floor)
print("\nSimplified inner boundary polygon (meters):")
for i, (x, z) in enumerate(simple):
    print(f"  Point {i}: ({x:7.3f}, {z:7.3f})")

# But wait - the floor polygon seems to be the ENTIRE floor slab
# including all rooms. The inner walls divide this space.
# The floor polygon is the overall apartment outline.

print("\n" + "="*80)
print("FULL APARTMENT FLOOR POLYGON")
print("="*80)

# From the floor/ceiling objects, let me extract the actual polygon
# The inner floor polygon traces the entire apartment

# Sorting the inner floor pts to form a proper polygon
# Going counter-clockwise from bottom-left:
apartment_outline = [
    (-4.377,  2.496),   # Top-left corner
    (-2.770,  2.496),   # Top edge, step at first interior wall (tiny step in z)
    (-2.770,  2.502),   # step
    ( 0.640,  2.502),   # Top edge continues
    ( 0.640,  2.499),   # tiny step
    ( 4.377,  2.498),   # Top-right corner
    ( 4.378, -2.502),   # Bottom-right corner (slanted wall!)
    (-1.946, -2.500),   # Bottom edge, to interior wall
    (-1.946, -2.499),   # tiny
    (-4.376, -2.490),   # Bottom-left corner
    (-4.376, -0.471),   # Left edge going up, but there might be a notch
    (-4.378, -0.471),   # tiny step (duplicate essentially)
]

# Wait - (-4.376, -0.471) to (-4.377, 2.496) is a continuous wall (left exterior)
# And (-4.376, -2.490) to (-4.376, -0.471) also on the left exterior
# So the left wall goes from z=-2.490 to z=2.496 continuously at x≈-4.377

# The actual apartment outline is:
outline = [
    (-4.377,  2.496),   # A: top-left
    ( 0.640,  2.500),   # B: top, at wall C inner
    ( 4.377,  2.498),   # C: top-right (start of slanted facade)
    ( 4.378, -2.502),   # D: bottom-right (end of slanted facade)
    (-1.946, -2.500),   # E: bottom, at wall B
    (-4.377, -2.490),   # F: bottom-left
]
# This is basically a rectangle with a slanted right wall!

# But the plantegning shows an L-shape. The L-shape might be formed by
# the interior walls. Let me reconsider.

# Actually the floor plan shows rooms. The "stue" (living room) is L-shaped
# because it spans part of the top and wraps. Let me look at which walls
# are just room dividers vs apartment boundary.

print("\nThe apartment outline is approximately a parallelogram/trapezoid:")
print("(The right facade wall runs diagonally from top-right to bottom-right)")
print()
for i, (x, z) in enumerate(outline):
    label = ['Top-left', 'Top-mid', 'Top-right', 'Bottom-right', 'Bottom-mid', 'Bottom-left'][i]
    print(f"  {label:15s}: ({x:7.3f}, {z:7.3f})m")

def polygon_area(pts):
    n = len(pts)
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2

total_area = polygon_area(outline)
print(f"\nTotal apartment floor area: {total_area:.2f} m²")

# Edge lengths
print("\nEdge lengths:")
for i in range(len(outline)):
    j = (i + 1) % len(outline)
    p1, p2 = outline[i], outline[j]
    dx = p2[0] - p1[0]
    dz = p2[1] - p1[1]
    length = math.sqrt(dx*dx + dz*dz)
    print(f"  {['Top-left','Top-mid','Top-right','Bottom-right','Bottom-mid','Bottom-left'][i]:15s} -> {['Top-left','Top-mid','Top-right','Bottom-right','Bottom-mid','Bottom-left'][j]:15s}: {length:.3f}m")

print("\n" + "="*80)
print("COMPARISON WITH PLANTEGNING MEASUREMENTS")
print("="*80)

# Plantegning says:
# Total width at window wall: 2.30m + 6.35m = 8.65m
# Left side depth: 1.96m + 2.84m = 4.80m
# Right side depth: 5.00m + 1.80m = 6.80m
# Bottom edge: 1.46m + 3.41m + 3.61m = 8.48m

# Our measurements:
top_width = abs(outline[2][0] - outline[0][0])  # top edge
bottom_width = abs(outline[3][0] - outline[5][0])  # bottom edge
left_depth = abs(outline[0][1] - outline[5][1])  # left side
right_wall_len = math.sqrt((outline[2][0]-outline[3][0])**2 + (outline[2][1]-outline[3][1])**2)

print(f"\nMeasured from OBJ (inner walls):")
print(f"  Top edge width:     {top_width:.3f}m  (plantegning: 8.65m)")
print(f"  Bottom edge width:  {bottom_width:.3f}m  (plantegning: 8.48m)")
print(f"  Left side depth:    {left_depth:.3f}m  (plantegning: 4.80m)")
print(f"  Right facade length:{right_wall_len:.3f}m  (plantegning: ~6.80m diagonal)")

# Interior wall positions tell us room divisions
print(f"\nInterior wall positions (inner surfaces):")
print(f"  Vertical wall A at x≈-2.77/-2.85m: divides top into left room + center")
print(f"  Vertical wall B at x≈-1.95/-2.03m: divides bottom area")
print(f"  Vertical wall C at x≈0.64/0.72m: divides top into center + right")
print(f"  Horizontal wall D at z≈-0.47/-0.55m: creates bottom rooms")
print(f"  Horizontal wall E at z≈0.82/0.90m: with diagonal, creates upper rooms")

# Room widths based on interior walls
print(f"\nRoom divisions along top (X axis):")
print(f"  Left room width:   {abs(-2.770 - (-4.377)):.3f}m  = 1.607m")
print(f"  Center room width: {abs(0.640 - (-2.770)):.3f}m   = 3.410m")
print(f"  Right room width:  {abs(4.377 - 0.640):.3f}m      = 3.737m (to slanted wall)")

print(f"\nRoom heights:")
print(f"  Top rooms depth:   z=0.90 to z=2.50 = {2.50-0.90:.3f}m")
print(f"  Bottom room depth: z=-2.49 to z=-0.47 = {abs(-0.47-(-2.49)):.3f}m")
print(f"  Overall depth:     z=-2.49 to z=2.50 = {2.50-(-2.49):.3f}m")

print("\n" + "="*80)
print("STUE (LIVING ROOM) L-SHAPE ANALYSIS")
print("="*80)
print("""
Based on the wall layout, the L-shaped stue likely spans:
- The top-center room (x=-2.77 to x=0.64, z=0.90 to z=2.50)
- The top-right room  (x=0.64 to slanted wall, z=0.82 to z=2.50)

Combined, this gives an L-shape where:
- The full width at the top (window wall at z≈2.50):
  from x=-2.77 to x=4.38 ≈ 7.15m (or to where slanted wall meets top)
- The center section depth: z=0.90 to z=2.50 ≈ 1.60m
- The right section extends further down

But the OBJ model dimensions don't perfectly match the plantegning.
This might be because:
1. The OBJ is the entire floor (all apartments), not just one unit
2. Wall thickness differences between inner/outer surfaces
3. The OBJ might be a different floor than the plantegning
""")

# Let me look at the wall at z=-0.47/-0.55 more carefully
# Wall D runs from x=-4.377 to x=-1.946 (not full width!)
# This means the bottom-left room is separated but bottom-right is open

print("ROOM MAP (approximate, top view):")
print()
print("  z=2.50  ┌────────┬──────────────┬──────────────────────┐ z=2.50")
print("          │        │              │                    / │")
print("          │  Room  │   Room 2     │     Room 3       /  │")
print("          │  1     │  (center)    │    (right)      /   │")
print("          │        ├──────────────┤               /     │")
print("  z=0.90  │        │   z=0.90     │  z=0.82     /      │")
print("          │        │              │            /        │")
print("          │  x=-2.77             x=0.64-0.72          │")
print("  z=-0.47 ├────────┼─────────────┐           /         │")
print("          │        │             │          /           │")
print("          │ Room 4 │             │        /             │")
print("          │(bot-L) │    Open     │      /               │")
print("          │        │    area     │    /                 │")
print("  z=-2.49 └────────┘─────────────┴──/──────────────────┘ z=-2.50")
print("        x=-4.38  x=-2.03/-1.95                      x=4.38")

print("\n" + "="*80)
print("ALL WALL SEGMENT DETAILS WITH THICKNESS")
print("="*80)

# Print paired walls (inner/outer surface pairs)
wall_pairs = [
    ("Left exterior wall",
     "x=-4.457 (outer) / x=-4.377 (inner)",
     "z=-2.49 to z=2.50",
     abs(-4.457 - (-4.377))),
    ("Top wall (left section)",
     "z=2.576 (outer) / z=2.496 (inner)",
     "x=-4.38 to x=-2.85",
     abs(2.576 - 2.496)),
    ("Top wall (center section)",
     "z=2.502 (outer) / z=2.502 (inner)??",
     "x=-2.77 to x=0.64",
     0),
    ("Top wall (right section)",
     "z=2.578 (outer) / z=2.498 (inner)",
     "x=0.72 to x=4.38",
     abs(2.578 - 2.498)),
    ("Bottom wall",
     "z=-2.580 (outer) / z=-2.500 (inner)",
     "x=-1.95 to x=4.38",
     abs(-2.580 - (-2.500))),
    ("Bottom-left wall",
     "z=-2.570 (outer) / z=-2.490 (inner)",
     "x=-4.46 to x=-2.03",
     abs(-2.570 - (-2.490))),
]

for name, surfaces, span, thickness in wall_pairs:
    print(f"  {name}:")
    print(f"    Surfaces: {surfaces}")
    print(f"    Span: {span}")
    print(f"    Thickness: {thickness*100:.1f}cm")
    print()
