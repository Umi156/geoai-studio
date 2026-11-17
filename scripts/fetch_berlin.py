"""Automatically prepare a SMALL public Berlin orthophoto and ALKIS building AOI.

Run from the repository root: python scripts/fetch_berlin.py
No file picker, private account, credential, geospatial desktop software or GPU required.

This script intentionally retrieves only one small AOI and caches existing assets.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform

BASE = Path(__file__).resolve().parents[1]
OUTPUT = BASE / "public" / "data"
WMS_URL = "https://gdi.berlin.de/services/wms/dop_2025_fruehjahr"
WFS_URL = "https://gdi.berlin.de/services/wfs/alkis_gebaeude"
WMS_LAYER = "dop_2025"
WFS_TYPENAME = "alkis_gebaeude:gebaeude"
CRS = "EPSG:25833"
# 200 m x 200 m: intentionally small to protect disk space and provider resources.
DEFAULT_BBOX = (385850.0, 5819750.0, 386050.0, 5819950.0)
IMAGE_SIZE = 1024
MAX_RESPONSE_BYTES = 12 * 1024 * 1024
USER_AGENT = "GeoAI-Studio-OpenData-Demo/0.1 (educational; single-AOI cache)"


def validate_bbox(bbox: tuple[float, float, float, float]) -> None:
    x1, y1, x2, y2 = bbox
    if not (x1 < x2 and y1 < y2):
        raise ValueError("Invalid bbox: min coordinates must precede max coordinates")
    if (x2 - x1) > 300 or (y2 - y1) > 300:
        raise ValueError("Limit initial AOI to 300 m x 300 m to conserve resources")


def bounded_get(session: requests.Session, url: str, params: dict[str, str]) -> bytes:
    """Fetch with timeouts and a hard response cap; never download an entire city."""
    with session.get(url, params=params, timeout=(10, 45), stream=True) as response:
        response.raise_for_status()
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(chunk_size=65536):
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise ValueError("Provider response exceeds 12 MB safety limit")
            chunks.append(chunk)
        result = b"".join(chunks)
        if not result:
            raise ValueError(f"Empty service response from {url}")
        return result


def coordinates_4326(bbox: tuple[float, float, float, float]) -> list[list[float]]:
    xmin, ymin, xmax, ymax = bbox
    transformer = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    corners = ((xmin, ymax), (xmax, ymax), (xmax, ymin), (xmin, ymin))
    return [[round(lon, 8), round(lat, 8)] for lon, lat in transformer.itransform(corners)]


def normalized_geojson(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize output to RFC 7946 WGS84; compute footprint area in metre CRS."""
    if raw.get("type") != "FeatureCollection" or not isinstance(raw.get("features"), list):
        raise ValueError("Unexpected WFS response: expected GeoJSON FeatureCollection")
    to_wgs84 = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform
    to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform
    output: list[dict[str, Any]] = []
    for original in raw["features"]:
        geometry = original.get("geometry")
        if not geometry:
            continue
        try:
            geo = shape(geometry)
            if geo.is_empty or geo.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            # Some WFS servers honor SRSNAME in JSON; others return the source CRS.
            # Determine from numeric coordinate extent, never guess geographic axes.
            cx, cy = geo.centroid.x, geo.centroid.y
            if 300000 < cx < 500000 and 5700000 < cy < 6000000:
                projected = geo
                wgs84 = transform(to_wgs84, geo)
            elif 12 < cx < 15 and 51 < cy < 54:
                wgs84 = geo
                projected = transform(to_utm, geo)
            elif 51 < cx < 54 and 12 < cy < 15:
                # Some WFS EPSG:4326 implementations use latitude,longitude axis order.
                wgs84 = transform(lambda x, y, z=None: (y, x), geo)
                projected = transform(to_utm, wgs84)
            else:
                raise ValueError("Unrecognized Berlin WFS coordinate system or axis order")
            if not wgs84.is_valid or not projected.is_valid:
                continue
            area = float(projected.area)
            if not (0 < area < 1_000_000):
                continue
            props = original.get("properties") or {}
            category = props.get("funktion") or props.get("gebaeudefunktion") or "Official building footprint"
            fid = len(output) + 1
            output.append({
                "type": "Feature", "id": fid,
                "properties": {"fid": fid, "area_m2": round(area, 1), "building_type": str(category), "source": "ALKIS Berlin Gebäude", "status": "official_reference"},
                "geometry": mapping(wgs84),
            })
        except (ValueError, TypeError, KeyError):
            continue
    if not output:
        raise ValueError("No building polygons returned. Try a nearby AOI or verify WFS availability.")
    return {"type": "FeatureCollection", "features": output}


def write_atomic(path: Path, contents: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(contents)
        tempname = tmp.name
    os.replace(tempname, path)


def acquire(bbox: tuple[float, float, float, float], force: bool = False) -> None:
    validate_bbox(bbox)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image_file = OUTPUT / "berlin_orthophoto.png"
    geo_file = OUTPUT / "berlin_buildings.geojson"
    meta_file = OUTPUT / "metadata.json"

    if not force and all(p.exists() and p.stat().st_size > 10 for p in (image_file, geo_file, meta_file)):
        try:
            existing = json.loads(meta_file.read_text(encoding="utf-8"))
            if tuple(existing.get("bbox_25833", [])) == bbox:
                print("Using cached Berlin data. Run with --force to refresh.")
                return
        except (ValueError, OSError):
            pass

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    xmin, ymin, xmax, ymax = bbox
    bboxstr = f"{xmin},{ymin},{xmax},{ymax}"
    print("Fetching a 200–300 m study area from Berlin public geodata services...")

    img = bounded_get(session, WMS_URL, {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
        "LAYERS": WMS_LAYER, "STYLES": "", "CRS": CRS, "BBOX": bboxstr,
        "WIDTH": str(IMAGE_SIZE), "HEIGHT": str(IMAGE_SIZE), "FORMAT": "image/png", "TRANSPARENT": "FALSE",
    })
    if not img.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Berlin WMS did not return PNG. Check GetCapabilities / service availability: " + img[:160].decode("utf-8", "replace"))

    vectors = bounded_get(session, WFS_URL, {
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
        "TYPENAMES": WFS_TYPENAME, "BBOX": bboxstr + "," + CRS,
        "SRSNAME": "EPSG:4326", "OUTPUTFORMAT": "json", "COUNT": "1000",
    })
    try:
        data = normalized_geojson(json.loads(vectors.decode("utf-8-sig")))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Berlin WFS did not return JSON; inspect its GetCapabilities response") from exc

    corners = coordinates_4326(bbox)
    meta = {
        "name": "Berlin | Building footprint explorer", "imagery_year": 2025,
        "bbox_25833": list(bbox), "image_corners": corners,
        "center": [round(sum(pt[0] for pt in corners) / 4, 8), round(sum(pt[1] for pt in corners) / 4, 8)],
        "building_count": len(data["features"]), "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "provenance": {
            "imagery": {"provider": "Geoportal Berlin", "dataset": "DOP20RGBI 2025", "service": WMS_URL, "layer": WMS_LAYER, "license": "dl-de/zero-2-0"},
            "buildings": {"provider": "Geoportal Berlin", "dataset": "ALKIS Berlin Gebäude", "service": WFS_URL, "type_name": WFS_TYPENAME, "license": "dl-de/zero-2-0"},
        },
        "warning": "Official reference building footprints, not AI predictions."
    }
    # Write verified assets only after BOTH services respond correctly.
    write_atomic(image_file, img)
    write_atomic(geo_file, (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    write_atomic(meta_file, (json.dumps(meta, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(f"Done: {len(data['features'])} ALKIS polygons, {len(img) / 1_048_576:.2f} MiB imagery")
    print(f"Assets: {OUTPUT}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Automatically fetch a small Berlin geospatial example")
    parser.add_argument("--force", action="store_true", help="Refresh local cache")
    parser.add_argument("--bbox", type=float, nargs=4, metavar=("XMIN", "YMIN", "XMAX", "YMAX"), default=DEFAULT_BBOX, help="EPSG:25833 UTM bounding box, max 300 x 300 metres")
    args = parser.parse_args()
    try:
        acquire(tuple(args.bbox), args.force)
    except (requests.RequestException, ValueError, OSError) as exc:
        parser.exit(1, f"Data download failed safely: {exc}\nNo invented data were substituted.\n")


if __name__ == "__main__":
    main()
