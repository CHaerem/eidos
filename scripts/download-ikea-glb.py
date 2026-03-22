#!/usr/bin/env python3
"""Download IKEA GLB 3D models from IKEA's Rotera/Dimma CDN.

Usage:
    python3 scripts/download-ikea-glb.py <article_number> [output_name]

Example:
    python3 scripts/download-ikea-glb.py 20275814 kallax
    → saves to models/furniture/kallax.glb

The script:
1. Fetches model metadata from IKEA's Rotera API
2. Extracts the GLB download URL
3. Downloads the actual GLB file
4. Reports dimensions from IKEA's metadata
"""

import sys
import os
import json
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
MODELS_DIR = os.path.join(PROJECT_DIR, 'models', 'furniture')

ROTERA_URL = "https://www.ikea.com/global/assets/rotera/resources/{article}.json"

HEADERS = {
    'Accept': '*/*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    'Origin': 'https://www.ikea.com',
    'Referer': 'https://www.ikea.com/',
}


def download_glb(article_number, output_name=None):
    """Download a GLB model from IKEA."""
    art = article_number.strip().lstrip('s').replace('-', '')

    # Step 1: Get model metadata
    meta_url = ROTERA_URL.format(article=art)
    print(f"Fetching metadata: {meta_url}")

    resp = requests.get(meta_url, headers=HEADERS)
    if resp.status_code == 404:
        print(f"No 3D model found for article {art}")
        return None
    if resp.status_code != 200:
        print(f"HTTP error: {resp.status_code}")
        return None

    data = resp.json()

    # Step 2: Find GLB URL (prefer GLB over USDZ)
    glb_url = None
    usdz_url = None
    for model in data.get('models', []):
        if model.get('format') == 'glb':
            glb_url = model['url']
        elif model.get('format') == 'usdz':
            usdz_url = model['url']

    if not glb_url:
        print(f"No GLB model found in metadata")
        if usdz_url:
            print(f"  USDZ available: {usdz_url}")
        return None

    # Step 3: Extract dimensions
    measurements = {}
    for m in data.get('measurements', []):
        mtype = m.get('measurementType', '')
        val = m.get('value', 0)
        if mtype in ('width', 'height', 'depth'):
            measurements[mtype] = val / 1000  # mm → meters

    if measurements:
        w = measurements.get('width', '?')
        h = measurements.get('height', '?')
        d = measurements.get('depth', '?')
        print(f"Dimensions: {w}m × {d}m × {h}m (W×D×H)")

    # Step 4: Download GLB
    print(f"Downloading GLB: {glb_url}")
    glb_resp = requests.get(glb_url, headers=HEADERS)

    if glb_resp.status_code != 200:
        print(f"GLB download failed: HTTP {glb_resp.status_code}")
        return None

    glb_data = glb_resp.content

    # Verify GLB magic
    is_glb = len(glb_data) > 4 and glb_data[:4] == b'glTF'

    # Step 5: Save
    if not output_name:
        output_name = f"ikea-{art}"
    output_path = os.path.join(MODELS_DIR, f"{output_name}.glb")
    os.makedirs(MODELS_DIR, exist_ok=True)

    with open(output_path, 'wb') as f:
        f.write(glb_data)

    size_mb = len(glb_data) / (1024 * 1024)
    print(f"{'Valid GLB' if is_glb else 'Saved'}: {output_path} ({size_mb:.1f} MB)")

    # Return info for catalog entry
    return {
        'path': f"models/furniture/{output_name}.glb",
        'measurements': measurements,
        'glb_url': glb_url,
        'usdz_url': usdz_url,
        'article': art,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    article = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else None
    result = download_glb(article, name)

    if result:
        print(f"\nCatalog entry:")
        w = result['measurements'].get('width', 0.5)
        h = result['measurements'].get('height', 0.5)
        d = result['measurements'].get('depth', 0.5)
        print(f"  glb: '{result['path']}',")
        print(f"  w: {w}, h: {h}, d: {d},")
        sys.exit(0)
    else:
        sys.exit(1)
