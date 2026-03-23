#!/usr/bin/env python3
"""
Eidos MCP Server — Config manipulation tools for the 3D apartment model.

Layer 2 of the Eidos two-layer architecture:
  Layer 1: Browser API (window.eidos) — live scene manipulation via preview_eval
  Layer 2: This MCP server — persistent config read/write on disk

Orchestration flow:
  1. MCP tool updates config on disk (this server)
  2. Claude calls preview_eval: await window.eidos.rebuild()
  3. Claude calls preview_screenshot() for visual verification
"""

import json
import copy
from pathlib import Path
from mcp.server.fastmcp import FastMCP

# ─── Config ───

CONFIG_PATH = Path(__file__).parent / "config" / "apartment.json"

def _load_config() -> dict:
    """Load apartment.json from disk."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_config(config: dict) -> None:
    """Write apartment.json to disk (pretty-printed)."""
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write("\n")

def _get_by_path(obj, path: str):
    """Navigate a nested dict/list by dot-notation path. E.g. 'walls.interior[0].pos'"""
    if not path:
        return obj
    import re
    parts = re.sub(r'\[(\d+)\]', r'.\1', path).split('.')
    cur = obj
    for p in parts:
        if cur is None:
            return None
        if isinstance(cur, list):
            try:
                cur = cur[int(p)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return None
    return cur

def _set_by_path(obj, path: str, value):
    """Set a value in a nested dict/list by dot-notation path."""
    import re
    parts = re.sub(r'\[(\d+)\]', r'.\1', path).split('.')
    cur = obj
    for i, p in enumerate(parts[:-1]):
        next_part = parts[i + 1]
        if isinstance(cur, list):
            p = int(p)
            if cur[p] is None:
                cur[p] = [] if next_part.isdigit() else {}
            cur = cur[p]
        elif isinstance(cur, dict):
            if p not in cur or cur[p] is None:
                cur[p] = [] if next_part.isdigit() else {}
            cur = cur[p]
    last = parts[-1]
    if isinstance(cur, list):
        cur[int(last)] = value
    else:
        cur[last] = value

# ─── MCP Server ───

mcp = FastMCP(
    "eidos",
    instructions=(
        "Eidos 3D apartment model config server. "
        "Use these tools to read and modify the apartment configuration (apartment.json). "
        "After modifying config, call preview_eval with 'await window.eidos.rebuild()' "
        "to see changes live in the 3D viewport."
    ),
)

@mcp.tool()
def read_config(path: str = "") -> str:
    """Read the full apartment config or a specific path within it.

    Args:
        path: Dot-notation path (e.g. 'walls.interior[0].pos', 'ceiling.zones').
              Empty string returns the full config.

    Returns:
        JSON string of the config value at the given path.
    """
    config = _load_config()
    result = _get_by_path(config, path) if path else config
    return json.dumps(result, indent=2, ensure_ascii=False)

@mcp.tool()
def update_config(path: str, value: str) -> str:
    """Update a specific config value and save to disk.

    After calling this, use preview_eval with 'await window.eidos.rebuild()'
    to apply changes in the 3D viewport.

    Args:
        path: Dot-notation path (e.g. 'walls.interior[0].pos').
        value: JSON-encoded value to set (e.g. '-3.0', '"hello"', '{"x": 1}').

    Returns:
        Confirmation with the updated value.
    """
    config = _load_config()
    parsed_value = json.loads(value)
    _set_by_path(config, path, parsed_value)
    _save_config(config)
    # Verify
    check = _get_by_path(_load_config(), path)
    return json.dumps({"status": "ok", "path": path, "value": check}, indent=2, ensure_ascii=False)

@mcp.tool()
def validate_config() -> str:
    """Validate the apartment config for common issues.

    Checks for:
    - Required top-level keys
    - Ceiling zone coverage
    - Wall consistency
    - Window/door references

    Returns:
        JSON with 'valid' boolean and list of 'warnings'.
    """
    config = _load_config()
    warnings = []

    # Required keys
    for key in ["name", "ceiling", "walls", "bounds"]:
        if key not in config:
            warnings.append(f"Missing required key: {key}")

    # Ceiling zones
    zones = config.get("ceiling", {}).get("zones", [])
    if not zones:
        warnings.append("No ceiling zones defined")
    for z in zones:
        if "id" not in z:
            warnings.append(f"Ceiling zone missing 'id': {z}")
        if z.get("type") == "slope":
            for k in ["slopeStartZ", "slopeEndZ", "startHeight", "endHeight"]:
                if k not in z:
                    warnings.append(f"Slope zone '{z.get('id', '?')}' missing '{k}'")

    # Walls
    walls = config.get("walls", {})
    if "exterior" not in walls:
        warnings.append("No exterior walls defined")
    for i, w in enumerate(walls.get("interior", [])):
        if "id" not in w:
            warnings.append(f"Interior wall [{i}] missing 'id'")
        if "axis" not in w or "pos" not in w:
            warnings.append(f"Interior wall '{w.get('id', i)}' missing axis/pos")

    # Windows — check wall references
    valid_walls = {"south", "north", "east", "west"}
    for win in config.get("windows", []):
        wall = win.get("wall", "")
        if wall not in valid_walls:
            warnings.append(f"Window '{win.get('id', '?')}' has invalid wall: '{wall}'")

    # Doors — check wall references
    interior_ids = {w.get("id") for w in walls.get("interior", [])}
    exterior_names = {"south", "north", "east", "west"}
    all_wall_refs = interior_ids | exterior_names
    for door in config.get("doors", []):
        if door.get("wall") not in all_wall_refs:
            warnings.append(f"Door '{door.get('id', '?')}' references unknown wall: '{door.get('wall')}'")

    return json.dumps({
        "valid": len(warnings) == 0,
        "warnings": warnings,
        "summary": f"{len(warnings)} issue(s) found" if warnings else "Config is valid",
    }, indent=2, ensure_ascii=False)

@mcp.tool()
def list_rooms() -> str:
    """List all rooms with their bounds and ceiling types.

    Returns both ground floor rooms and upper floor rooms (if any).
    """
    config = _load_config()
    rooms = list(config.get("rooms", []))
    uf = config.get("upperFloor")
    if uf and uf.get("rooms"):
        for r in uf["rooms"]:
            rooms.append({**r, "floor": "upper"})
    return json.dumps(rooms, indent=2, ensure_ascii=False)

@mcp.tool()
def list_windows() -> str:
    """List all windows with their positions and dimensions."""
    config = _load_config()
    return json.dumps(config.get("windows", []), indent=2, ensure_ascii=False)

@mcp.tool()
def list_walls() -> str:
    """List all walls (exterior + interior).

    Returns exterior bounds, interior wall segments, and column (if any).
    """
    config = _load_config()
    walls = config.get("walls", {})
    return json.dumps({
        "exterior": walls.get("exterior"),
        "interior": walls.get("interior", []),
        "column": walls.get("column"),
        "protrusions": walls.get("protrusions", []),
    }, indent=2, ensure_ascii=False)

@mcp.tool()
def list_doors() -> str:
    """List all doors with their positions and dimensions."""
    config = _load_config()
    return json.dumps(config.get("doors", []), indent=2, ensure_ascii=False)

@mcp.tool()
def add_door(
    wall: str,
    from_coord: float,
    to_coord: float,
    height: float = 2.0,
    note: str = "",
) -> str:
    """Add a new door to the config.

    Doors are placed on walls (interior or exterior). The wall determines
    the axis and position automatically.

    Args:
        wall: Wall reference — interior wall ID (e.g. 'A', 'B') or
              exterior wall name ('south', 'north', 'east', 'west')
        from_coord: Start of door opening (Z for x-axis walls, X for z-axis walls)
        to_coord: End of door opening
        height: Door height in meters (default 2.0m)
        note: Optional description

    Returns:
        The new door object with auto-generated ID.
    """
    config = _load_config()
    doors = config.setdefault("doors", [])

    # Auto-generate ID
    existing_ids = {d.get("id", "") for d in doors}
    idx = len(doors) + 1
    while f"D{idx}" in existing_ids:
        idx += 1
    new_id = f"D{idx}"

    # Determine axis and pos from wall reference
    exterior_walls = {"south", "north", "east", "west"}
    interior = config.get("walls", {}).get("interior", [])

    door = {"id": new_id, "wall": wall, "from": from_coord, "to": to_coord, "height": height}

    if wall in exterior_walls:
        ext = config.get("walls", {}).get("exterior", {})
        if wall == "south":
            door["axis"] = "z"
            door["pos"] = ext.get("minZ", 0)
        elif wall == "north":
            door["axis"] = "z"
            door["pos"] = ext.get("maxZ", 0)
        elif wall == "east":
            door["axis"] = "x"
            door["pos"] = ext.get("minX", 0)
        elif wall == "west":
            door["axis"] = "x"
            door["pos"] = ext.get("maxX", 0)
    else:
        # Interior wall — inherit axis and pos
        iw = next((w for w in interior if w.get("id") == wall), None)
        if iw:
            door["axis"] = iw["axis"]
            door["pos"] = iw["pos"]
        else:
            return json.dumps({"status": "error", "message": f"Wall '{wall}' not found"})

    if note:
        door["note"] = note

    doors.append(door)
    _save_config(config)
    return json.dumps({"status": "ok", "door": door}, indent=2, ensure_ascii=False)

@mcp.tool()
def add_window(
    wall: str,
    x1: float = 0, x2: float = 0,
    z1: float = 0, z2: float = 0,
    sill_height: float = 0.90,
    top_height: float = 2.10,
) -> str:
    """Add a new window to the config.

    For south/north walls, use x1/x2 for horizontal position.
    For west/east walls, use z1/z2 for horizontal position.

    Args:
        wall: Wall name ('south', 'north', 'east', 'west')
        x1: Left edge X coordinate (for south/north walls)
        x2: Right edge X coordinate (for south/north walls)
        z1: Start Z coordinate (for west/east walls)
        z2: End Z coordinate (for west/east walls)
        sill_height: Height of window sill from floor (default 0.90m)
        top_height: Height of window top from floor (default 2.10m)

    Returns:
        The new window object with auto-generated ID.
    """
    config = _load_config()
    windows = config.setdefault("windows", [])

    # Auto-generate ID
    existing_ids = {w.get("id", "") for w in windows}
    idx = len(windows) + 1
    while f"W{idx}" in existing_ids:
        idx += 1
    new_id = f"W{idx}"

    win = {
        "id": new_id,
        "wall": wall,
        "sillHeight": sill_height,
        "topHeight": top_height,
    }
    if wall in ("south", "north"):
        win["x1"] = x1
        win["x2"] = x2
    else:
        win["z1"] = z1
        win["z2"] = z2

    windows.append(win)
    _save_config(config)
    return json.dumps({"status": "ok", "window": win}, indent=2, ensure_ascii=False)

@mcp.tool()
def add_wall(
    wall_id: str,
    axis: str,
    pos: float,
    from_coord: float,
    to_coord: float,
) -> str:
    """Add a new interior wall segment.

    Args:
        wall_id: Unique wall identifier (e.g. 'E')
        axis: 'x' (wall runs along Z at fixed X) or 'z' (wall runs along X at fixed Z)
        pos: Fixed coordinate (X for axis='x', Z for axis='z')
        from_coord: Start of wall segment
        to_coord: End of wall segment

    Returns:
        The new wall object.
    """
    config = _load_config()
    interior = config.setdefault("walls", {}).setdefault("interior", [])

    # Check for duplicate ID
    if any(w.get("id") == wall_id for w in interior):
        return json.dumps({"status": "error", "message": f"Wall ID '{wall_id}' already exists"})

    wall = {
        "id": wall_id,
        "axis": axis,
        "pos": pos,
        "from": from_coord,
        "to": to_coord,
    }
    interior.append(wall)
    _save_config(config)
    return json.dumps({"status": "ok", "wall": wall}, indent=2, ensure_ascii=False)

@mcp.tool()
def get_staircase_info() -> str:
    """Get computed staircase dimensions and geometry info.

    Returns tread count, rise per tread, stairwell bounds, and run details.
    """
    config = _load_config()
    uf = config.get("upperFloor")
    if not uf or not uf.get("stairwell"):
        return json.dumps({"status": "no_staircase", "message": "No stairwell configured"})

    sw = uf["stairwell"]
    runs = sw.get("runs", [])
    total_treads = sum(r.get("treads", 0) for r in runs)
    floor_y = uf.get("floorY", 2.25)
    rise_per_tread = round(floor_y / total_treads, 4) if total_treads > 0 else 0

    return json.dumps({
        "type": sw.get("type"),
        "width": sw.get("width"),
        "totalTreads": total_treads,
        "risePerTread": rise_per_tread,
        "floorY": floor_y,
        "runs": runs,
        "bounds": sw.get("bounds"),
        "note": f"Total rise: {floor_y}m over {total_treads} treads = {rise_per_tread}m each",
    }, indent=2, ensure_ascii=False)

@mcp.tool()
def add_protrusion(
    min_x: float, max_x: float,
    min_z: float, max_z: float,
    height: float = 0,
    from_y: float = 0,
    note: str = "",
) -> str:
    """Add a wall protrusion (beam, bump, indentation) to the config.

    Protrusions are box-shaped elements that represent structural features
    like beams in corners, pipe shafts, or wall indentations.

    Args:
        min_x: Left edge X coordinate
        max_x: Right edge X coordinate
        min_z: Front edge Z coordinate
        max_z: Back edge Z coordinate
        height: Height in meters (0 = auto, uses ceiling height at center)
        from_y: Start height from floor (default 0). Use > 0 for hanging beams.
        note: Optional description

    Returns:
        The new protrusion object with auto-generated ID.
    """
    config = _load_config()
    protrusions = config.setdefault("walls", {}).setdefault("protrusions", [])

    # Auto-generate ID
    existing_ids = {p.get("id", "") for p in protrusions}
    idx = len(protrusions) + 1
    while f"P{idx}" in existing_ids:
        idx += 1
    new_id = f"P{idx}"

    prot = {
        "id": new_id,
        "bounds": {"minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z},
    }
    if height > 0:
        prot["height"] = height
    if from_y > 0:
        prot["fromY"] = from_y
    if note:
        prot["note"] = note

    protrusions.append(prot)
    _save_config(config)
    return json.dumps({"status": "ok", "protrusion": prot}, indent=2, ensure_ascii=False)

@mcp.tool()
def remove_element(element_type: str, element_id: str) -> str:
    """Remove an element (window, door, interior wall, room, protrusion) by its ID.

    Args:
        element_type: Type of element ('window', 'door', 'wall', 'room', 'protrusion')
        element_id: The 'id' field of the element to remove

    Returns:
        Confirmation or error if not found.
    """
    config = _load_config()

    type_map = {
        "window": "windows",
        "door": "doors",
        "room": "rooms",
    }

    if element_type == "wall":
        interior = config.get("walls", {}).get("interior", [])
        before = len(interior)
        config["walls"]["interior"] = [w for w in interior if w.get("id") != element_id]
        if len(config["walls"]["interior"]) == before:
            return json.dumps({"status": "error", "message": f"Wall '{element_id}' not found"})
    elif element_type == "protrusion":
        protrusions = config.get("walls", {}).get("protrusions", [])
        before = len(protrusions)
        config["walls"]["protrusions"] = [p for p in protrusions if p.get("id") != element_id]
        if len(config["walls"]["protrusions"]) == before:
            return json.dumps({"status": "error", "message": f"Protrusion '{element_id}' not found"})
    elif element_type in type_map:
        key = type_map[element_type]
        arr = config.get(key, [])
        before = len(arr)
        config[key] = [item for item in arr if item.get("id") != element_id]
        if len(config[key]) == before:
            return json.dumps({"status": "error", "message": f"{element_type} '{element_id}' not found"})
    else:
        return json.dumps({"status": "error", "message": f"Unknown element type: {element_type}"})

    _save_config(config)
    return json.dumps({"status": "ok", "removed": element_type, "id": element_id})

@mcp.tool()
def update_element(element_type: str, element_id: str, updates: str) -> str:
    """Update properties of an existing element (window, door, wall, protrusion).

    Find element by type and ID, then merge the provided updates into it.
    Use this to adjust position, size, or other properties.

    Args:
        element_type: Type of element ('window', 'door', 'wall', 'protrusion')
        element_id: The 'id' field of the element to update
        updates: JSON object with fields to update.
                 Examples:
                   Window: '{"x1": -1.5, "x2": -0.3}' or '{"sillHeight": 0.8}'
                   Door: '{"from": -3.5, "to": -2.7}' or '{"height": 2.1}'
                   Wall: '{"pos": -2.10, "from": -2.5, "to": 0.7}'
                   Protrusion: '{"bounds": {"minX": 3.0, "maxX": 4.0, "minZ": 1.5, "maxZ": 2.5}}'

    Returns:
        The updated element, or error if not found.
    """
    config = _load_config()
    parsed = json.loads(updates)

    # Find the element
    element = None
    if element_type == "wall":
        for w in config.get("walls", {}).get("interior", []):
            if w.get("id") == element_id:
                element = w
                break
    elif element_type == "protrusion":
        for p in config.get("walls", {}).get("protrusions", []):
            if p.get("id") == element_id:
                element = p
                break
    else:
        type_map = {"window": "windows", "door": "doors"}
        key = type_map.get(element_type)
        if not key:
            return json.dumps({"status": "error", "message": f"Unknown element type: {element_type}"})
        for item in config.get(key, []):
            if item.get("id") == element_id:
                element = item
                break

    if element is None:
        return json.dumps({"status": "error", "message": f"{element_type} '{element_id}' not found"})

    # Don't allow changing the ID
    parsed.pop("id", None)

    # Deep merge for nested objects like bounds
    for k, v in parsed.items():
        if isinstance(v, dict) and isinstance(element.get(k), dict):
            element[k].update(v)
        else:
            element[k] = v

    _save_config(config)
    return json.dumps({"status": "ok", element_type: element}, indent=2, ensure_ascii=False)

@mcp.tool()
def get_bounds() -> str:
    """Get the overall apartment bounds (min/max X, Z, floor Y)."""
    config = _load_config()
    return json.dumps(config.get("bounds", {}), indent=2, ensure_ascii=False)

# ─── Furniture tools ───

@mcp.tool()
def list_furniture() -> str:
    """List all placed furniture items with their positions and types."""
    config = _load_config()
    items = config.get("furniture", [])
    return json.dumps(items, indent=2, ensure_ascii=False)

@mcp.tool()
def add_furniture(type: str, x: float = 0.0, z: float = 0.0, rotation: int = 0) -> str:
    """Add a furniture item to the apartment.

    Args:
        type: Furniture type from catalog (e.g. 'sofa_3', 'spisebord', 'besta_3x',
              'soderhamn', 'cana_tv', 'sofa_2', 'stol', 'sofabord', 'tv_benk',
              'bokhylle', 'gulvlampe', 'kjokkenbenk', 'spisestol')
        x: X position in meters (negative=west, positive=east)
        z: Z position in meters (negative=south/windows, positive=north/back)
        rotation: Rotation in degrees (0, 90, 180, 270)

    Returns:
        The new furniture item with auto-generated ID.
    """
    config = _load_config()
    items = config.setdefault("furniture", [])

    # Furniture dimensions (subset of catalog for wall-aware placement)
    CATALOG = {
        'kallax': {'w': 0.77, 'd': 0.39}, 'kallax_2x4': {'w': 0.77, 'd': 0.39},
        'billy': {'w': 0.80, 'd': 0.28}, 'besta_3x': {'w': 1.80, 'd': 0.40},
        'soderhamn': {'w': 1.92, 'd': 1.92}, 'cana_tv': {'w': 1.28, 'd': 0.40},
        'sofa_3': {'w': 2.1, 'd': 0.9}, 'sofa_2': {'w': 1.5, 'd': 0.9},
        'stol': {'w': 0.85, 'd': 0.85}, 'sofabord': {'w': 1.2, 'd': 0.6},
        'spisebord': {'w': 1.6, 'd': 0.9}, 'tv_benk': {'w': 1.8, 'd': 0.4},
        'bokhylle': {'w': 1.0, 'd': 0.35}, 'gulvlampe': {'w': 0.3, 'd': 0.3},
        'kjokkenbenk': {'w': 2.5, 'd': 0.6}, 'spisestol': {'w': 0.45, 'd': 0.45},
    }

    # Wall-aware clamping: use interior surface, not exterior bounds
    ext = config.get("walls", {}).get("exterior", {})
    wall_t = ext.get("thickness", 0.08)
    inner_min_x = ext.get("minX", -4.38) + wall_t
    inner_max_x = ext.get("maxX", 4.38) - wall_t
    inner_min_z = ext.get("minZ", -2.5) + wall_t
    inner_max_z = ext.get("maxZ", 2.5) - wall_t

    cat = CATALOG.get(type, {'w': 0.5, 'd': 0.5})
    import math
    rot_rad = rotation * math.pi / 180
    cos_r, sin_r = abs(math.cos(rot_rad)), abs(math.sin(rot_rad))
    half_w = (cat['w'] * cos_r + cat['d'] * sin_r) / 2
    half_d = (cat['w'] * sin_r + cat['d'] * cos_r) / 2

    # Clamp to interior wall surface
    x = max(inner_min_x + half_w, min(inner_max_x - half_w, x))
    z = max(inner_min_z + half_d, min(inner_max_z - half_d, z))

    # Auto-generate ID
    max_id = max((f.get("id", 0) for f in items), default=0)
    new_id = max_id + 1

    item = {
        "id": new_id,
        "type": type,
        "x": round(x, 3),
        "z": round(z, 3),
        "rotation": rotation % 360,
    }
    items.append(item)
    _save_config(config)
    return json.dumps(item, indent=2, ensure_ascii=False)

@mcp.tool()
def remove_furniture(furniture_id: int) -> str:
    """Remove a furniture item by its ID.

    Args:
        furniture_id: The ID of the furniture item to remove.

    Returns:
        Confirmation or error if not found.
    """
    config = _load_config()
    items = config.get("furniture", [])
    idx = next((i for i, f in enumerate(items) if f.get("id") == furniture_id), None)
    if idx is None:
        return json.dumps({"error": f"Furniture ID {furniture_id} not found"})
    removed = items.pop(idx)
    _save_config(config)
    return json.dumps({"removed": removed}, indent=2, ensure_ascii=False)

@mcp.tool()
def update_simulator(field: str, value: str) -> str:
    """Update a simulator setting.

    Args:
        field: Setting name ('playerHeight', 'posX', 'posZ', 'club', 'direction',
               'screenDistance', 'hitDirection')
        value: New value (number or string depending on field)

    Returns:
        Updated simulator config.
    """
    config = _load_config()
    sim = config.setdefault("simulator", {})

    # Auto-type conversion
    try:
        if field in ('playerHeight',):
            sim[field] = int(value)
        elif field in ('posX', 'posZ', 'screenDistance'):
            sim[field] = round(float(value), 3)
        else:
            sim[field] = value
    except (ValueError, TypeError):
        sim[field] = value

    _save_config(config)
    return json.dumps(sim, indent=2, ensure_ascii=False)

# ─── Entry point ───

if __name__ == "__main__":
    mcp.run(transport="stdio")
