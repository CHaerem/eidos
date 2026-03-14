#!/usr/bin/env python3
"""Extract floor plan shape from OBJ file."""

import re
from collections import defaultdict
import math

OBJ_PATH = "/Users/christopherhaerem/Privat/GolfSim/Vibes Gate 20 - Ground Floor.obj"

# Parse OBJ file
vertices = []  # global vertex list (1-indexed in OBJ)
objects = []   # list of (name, [vertex_indices])

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
            current_verts.append(len(vertices) - 1)  # 0-indexed

if current_obj is not None:
    objects.append((current_obj, list(current_verts)))

print(f"Total vertices: {len(vertices)}")
print(f"Total objects: {len(objects)}")

# Analyze Y values to find floor level
all_y = sorted(set(round(v[1], 2) for v in vertices))
print(f"\nUnique Y values: {all_y}")

# Floor level seems to be y = -12.2 (lowest)
FLOOR_Y = -12.2
Y_TOLERANCE = 0.5

# Extract floor-level vertices (x, z) for each wall object
print("\n" + "="*80)
print("WALL SEGMENTS AT FLOOR LEVEL")
print("="*80)

floor_points = []  # all (x, z) at floor level in decimeters

for obj_name, vert_indices in objects:
    obj_floor_pts = []
    for vi in vert_indices:
        x, y, z = vertices[vi]
        if abs(y - FLOOR_Y) < Y_TOLERANCE:
            obj_floor_pts.append((x, z))

    if obj_floor_pts:
        # Get unique points for this wall
        unique_pts = list(set((round(p[0], 2), round(p[1], 2)) for p in obj_floor_pts))
        if len(unique_pts) >= 2:
            floor_points.extend(unique_pts)

# Get all unique floor points
unique_floor = list(set((round(p[0], 2), round(p[1], 2)) for p in floor_points))
unique_floor.sort()

print(f"\nAll unique floor-level (x, z) points in DECIMETERS:")
print(f"{'X (dm)':>10} {'Z (dm)':>10} | {'X (m)':>8} {'Z (m)':>8}")
print("-" * 45)
for x, z in unique_floor:
    print(f"{x:10.2f} {z:10.2f} | {x/10:8.3f} {z/10:8.3f}")

print(f"\nTotal unique floor points: {len(unique_floor)}")

# Convert to meters
floor_m = [(x/10, z/10) for x, z in unique_floor]

# Find bounding box
xs = [p[0] for p in floor_m]
zs = [p[1] for p in floor_m]
print(f"\nBounding box (meters):")
print(f"  X: {min(xs):.3f} to {max(xs):.3f}  (width: {max(xs)-min(xs):.3f})")
print(f"  Z: {min(zs):.3f} to {max(zs):.3f}  (depth: {max(zs)-min(zs):.3f})")

# Now let's try to find the outer boundary using convex hull first,
# then try to identify the L-shape

# Extract wall segments (pairs of floor-level endpoints per wall)
print("\n" + "="*80)
print("WALL SEGMENTS (floor-level edges)")
print("="*80)

wall_segments = []
for obj_name, vert_indices in objects:
    obj_floor_pts = []
    for vi in vert_indices:
        x, y, z = vertices[vi]
        if abs(y - FLOOR_Y) < Y_TOLERANCE:
            obj_floor_pts.append((round(x, 2), round(z, 2)))

    unique_pts = list(set(obj_floor_pts))
    if len(unique_pts) >= 2:
        # Each wall should have 2 unique floor-level x,z positions
        # (the two bottom corners of the wall rectangle)
        wall_segments.append((unique_pts[0], unique_pts[1], obj_name))

print(f"\nWall segments ({len(wall_segments)} total):")
for i, (p1, p2, name) in enumerate(wall_segments):
    x1, z1 = p1[0]/10, p1[1]/10
    x2, z2 = p2[0]/10, p2[1]/10
    length = math.sqrt((x2-x1)**2 + (z2-z1)**2)
    short_name = name.split(':')[1][:8] if ':' in name else name[:8]

    # Determine orientation
    if abs(x2-x1) < 0.01:
        orient = f"vertical   (x={x1:.3f}m)"
    elif abs(z2-z1) < 0.01:
        orient = f"horizontal (z={z1:.3f}m)"
    else:
        orient = "diagonal"

    print(f"  Wall {i:2d}: ({x1:7.3f}, {z1:7.3f}) -> ({x2:7.3f}, {z2:7.3f})  L={length:.3f}m  {orient}")

# Group walls by orientation and position to find the outline
print("\n" + "="*80)
print("TRYING TO RECONSTRUCT OUTER BOUNDARY")
print("="*80)

# Collect all unique x and z values (quantized)
def quantize(val, precision=0.02):
    return round(val / precision) * precision

x_values = sorted(set(quantize(p[0]) for p in floor_m))
z_values = sorted(set(quantize(p[1]) for p in floor_m))

print(f"\nUnique X positions (m): {[f'{v:.3f}' for v in x_values]}")
print(f"Unique Z positions (m): {[f'{v:.3f}' for v in z_values]}")

# Try to find outer boundary by looking at extreme x,z coordinates
# For an L-shape, we need to find the corners

# Use convex hull as starting point
from functools import cmp_to_key

def cross(O, A, B):
    return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0])

def convex_hull(points):
    points = sorted(set(points))
    if len(points) <= 1:
        return points
    lower = []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

hull = convex_hull(floor_m)
print(f"\nConvex hull ({len(hull)} points):")
for i, (x, z) in enumerate(hull):
    print(f"  {i}: ({x:.3f}, {z:.3f})")

# Calculate convex hull area
def polygon_area(pts):
    n = len(pts)
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2

hull_area = polygon_area(hull)
print(f"\nConvex hull area: {hull_area:.2f} m²")

# Now try to identify the L-shape more precisely
# Look at wall segments that are on the boundary
# Group segments by their x or z coordinate

print("\n" + "="*80)
print("ANALYZING WALL POSITIONS FOR L-SHAPE")
print("="*80)

# For each wall, classify as horizontal or vertical
horiz_walls = []  # walls along z-axis (constant z)
vert_walls = []   # walls along x-axis (constant x)
diag_walls = []

for p1, p2, name in wall_segments:
    x1, z1 = p1[0]/10, p1[1]/10
    x2, z2 = p2[0]/10, p2[1]/10

    if abs(z2-z1) < 0.05:  # horizontal wall
        z_pos = (z1+z2)/2
        x_min, x_max = min(x1,x2), max(x1,x2)
        horiz_walls.append((z_pos, x_min, x_max, name))
    elif abs(x2-x1) < 0.05:  # vertical wall
        x_pos = (x1+x2)/2
        z_min, z_max = min(z1,z2), max(z1,z2)
        vert_walls.append((x_pos, z_min, z_max, name))
    else:
        diag_walls.append((x1, z1, x2, z2, name))

print(f"\nHorizontal walls (constant Z), sorted by Z:")
horiz_walls.sort()
for z, xmin, xmax, name in horiz_walls:
    print(f"  Z={z:7.3f}m  X: {xmin:.3f} to {xmax:.3f}  (length: {xmax-xmin:.3f}m)")

print(f"\nVertical walls (constant X), sorted by X:")
vert_walls.sort()
for x, zmin, zmax, name in vert_walls:
    print(f"  X={x:7.3f}m  Z: {zmin:.3f} to {zmax:.3f}  (length: {zmax-zmin:.3f}m)")

if diag_walls:
    print(f"\nDiagonal walls:")
    for x1, z1, x2, z2, name in diag_walls:
        print(f"  ({x1:.3f}, {z1:.3f}) -> ({x2:.3f}, {z2:.3f})")

# Try to identify the outer boundary by finding the extremes
print("\n" + "="*80)
print("BOUNDARY IDENTIFICATION")
print("="*80)

# For an L-shape, find:
# - min X, max X (total width)
# - min Z, max Z (total depth)
# - the "notch" corner

min_x = min(xs)
max_x = max(xs)
min_z = min(zs)
max_z = max(zs)

print(f"\nExtremes:")
print(f"  Left edge (min X):   {min_x:.3f}m")
print(f"  Right edge (max X):  {max_x:.3f}m")
print(f"  Bottom edge (min Z): {min_z:.3f}m")
print(f"  Top edge (max Z):    {max_z:.3f}m")
print(f"  Total width:  {max_x - min_x:.3f}m")
print(f"  Total depth:  {max_z - min_z:.3f}m")

# Look for the L-shape notch - find vertical walls at intermediate X
# and horizontal walls at intermediate Z
print(f"\nLooking for L-shape notch...")
for x, zmin, zmax, name in vert_walls:
    if min_x + 0.5 < x < max_x - 0.5:  # intermediate X
        print(f"  Intermediate vertical wall at X={x:.3f}m  Z: {zmin:.3f} to {zmax:.3f}")

for z, xmin, xmax, name in horiz_walls:
    if min_z + 0.5 < z < max_z - 0.5:  # intermediate Z
        print(f"  Intermediate horizontal wall at Z={z:.3f}m  X: {xmin:.3f} to {xmax:.3f}")

# Calculate approximate L-shape area
# Assuming we can identify the notch from wall positions
print("\n" + "="*80)
print("DETAILED VERTEX ANALYSIS PER OBJECT")
print("="*80)

for obj_name, vert_indices in objects:
    # Get all vertices for this object
    all_pts = [(vertices[vi][0]/10, vertices[vi][1]/10, vertices[vi][2]/10) for vi in vert_indices]
    floor_pts = [(x, z) for x, y, z in all_pts if abs(y - (-1.22)) < 0.05]
    unique_floor = list(set((round(x, 3), round(z, 3)) for x, z in floor_pts))

    if len(unique_floor) >= 2:
        short = obj_name.split(':')[1][:12] if ':' in obj_name else obj_name[:12]
        pts_str = ", ".join(f"({x:.3f},{z:.3f})" for x, z in sorted(unique_floor))
        print(f"  {short}: {pts_str}")
