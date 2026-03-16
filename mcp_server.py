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
    }, indent=2, ensure_ascii=False)

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
def remove_element(element_type: str, element_id: str) -> str:
    """Remove an element (window, door, interior wall, room) by its ID.

    Args:
        element_type: Type of element ('window', 'door', 'wall', 'room')
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
def get_bounds() -> str:
    """Get the overall apartment bounds (min/max X, Z, floor Y)."""
    config = _load_config()
    return json.dumps(config.get("bounds", {}), indent=2, ensure_ascii=False)

# ─── Entry point ───

if __name__ == "__main__":
    mcp.run(transport="stdio")
