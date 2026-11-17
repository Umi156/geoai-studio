"""Optional offline inference on the cached Berlin orthophoto.

This command is NOT invoked by GitHub Pages. It requires real pretrained
weights and emits prediction files only after a successful model run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

MODEL_REPO = "giswqs/whu-building-unetplusplus-efficientnet-b4"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def check_georeferencing(metadata: dict, width: int, height: int) -> tuple[float, float, float, float]:
    """Validate axis-aligned image bbox and derived ground pixel spacing."""
    bbox = metadata.get("bbox_25833")
    if not isinstance(bbox, list) or len(bbox) != 4 or any(not isinstance(v, (int, float)) for v in bbox):
        raise ValueError("Missing EPSG:25833 imagery bounding box")
    xmin, ymin, xmax, ymax = (float(v) for v in bbox)
    if width < 1 or height < 1 or not (xmin < xmax and ymin < ymax):
        raise ValueError("Invalid image dimensions or geospatial bounds")
    if xmax - xmin > 300 or ymax - ymin > 300:
        raise ValueError("Unexpected image extent: this command only supports the cached Berlin sample")
    return xmin, ymin, xmax, ymax


def tile_origins(n: int, size: int, overlap: int) -> list[int]:
    if n < 1 or size < 1 or not 0 <= overlap < size:
        raise ValueError("Invalid image/tile dimensions or overlap")
    if n <= size:
        return [0]
    coords = list(range(0, n - size + 1, size - overlap))
    if coords[-1] != n - size:
        coords.append(n - size)
    return coords


def predict_probability(rgb: np.ndarray, model, device: str, *, tile: int = 512, overlap: int = 128) -> np.ndarray:
    """Run true model inference with overlapping, averaged probability tiles."""
    import torch

    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
        raise ValueError("Expected uint8 RGB aerial imagery")
    height, width, _ = rgb.shape
    total = np.zeros((height, width), dtype=np.float32)
    count = np.zeros((height, width), dtype=np.float32)
    model.eval()
    with torch.inference_mode():
        for y in tile_origins(height, tile, overlap):
            for x in tile_origins(width, tile, overlap):
                actual = rgb[y:y + tile, x:x + tile]
                h, w = actual.shape[:2]
                patch = np.zeros((tile, tile, 3), dtype=np.uint8)
                patch[:h, :w] = actual
                # Match GeoAI's WHU inference preprocessing: uint8 RGB -> [0,1].
                tensor = torch.from_numpy(patch.copy()).permute(2, 0, 1).unsqueeze(0).float().div_(255).to(device)
                raw = model(tensor)
                if raw.shape[1] != 2:
                    raise RuntimeError(f"Checkpoint did not produce 2-class logits: {tuple(raw.shape)}")
                scores = torch.softmax(raw, dim=1)[0, 1, :h, :w].cpu().numpy()
                total[y:y + h, x:x + w] += scores
                count[y:y + h, x:x + w] += 1
    if not np.all(count):
        raise RuntimeError("Prediction left unprocessed pixels")
    return total / count


def vectorize_mask(mask: np.ndarray, bbox: tuple[float, float, float, float], *, min_area: float = 15.0) -> list[dict]:
    """Convert raster mask to projected polygons and WGS84 GeoJSON."""
    from pyproj import Transformer
    from rasterio.features import shapes
    from rasterio.transform import from_bounds
    from shapely.geometry import shape, mapping
    from shapely.ops import transform

    if mask.ndim != 2:
        raise ValueError("Expected 2D building mask")
    height, width = mask.shape
    affine = from_bounds(*bbox, width=width, height=height)
    to_wgs = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True).transform
    features = []
    for geo, val in shapes(mask.astype(np.uint8), mask=mask.astype(bool), transform=affine):
        if int(val) != 1:
            continue
        polygon = shape(geo)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.is_empty or polygon.area < min_area:
            continue
        polygon = polygon.simplify(0.2, preserve_topology=True)
        geometry = mapping(transform(to_wgs, polygon))
        features.append({
            "type": "Feature", "id": len(features) + 1,
            "properties": {
                "fid": len(features) + 1, "area_m2": round(float(polygon.area), 1),
                "building_type": "Predicted building", "source": MODEL_REPO,
                "status": "model_prediction", "quality": "unvalidated_cross_city",
            },
            "geometry": geometry,
        })
    return features


def evaluate_mask(mask: np.ndarray, reference_file: Path, bbox: tuple[float, float, float, float]) -> dict:
    """Pixel overlap with independent ALKIS reference polygons on same grid.

    This is a localized agreement statistic, not proof of generalization.
    """
    if not reference_file.exists():
        return {"status": "reference_not_available"}
    from pyproj import Transformer
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds
    from shapely.geometry import shape
    from shapely.ops import transform

    collection = json.loads(reference_file.read_text(encoding="utf-8"))
    if collection.get("type") != "FeatureCollection":
        raise ValueError("Invalid independent reference GeoJSON")
    to_projected = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True).transform
    geometries = []
    for item in collection.get("features", []):
        if item.get("geometry"):
            polygon = transform(to_projected, shape(item["geometry"]))
            if polygon.is_valid and not polygon.is_empty:
                geometries.append((polygon, 1))
    if not geometries:
        return {"status": "reference_empty"}
    reference = rasterize(geometries, out_shape=mask.shape,
                          transform=from_bounds(*bbox, width=mask.shape[1], height=mask.shape[0]),
                          fill=0, dtype="uint8").astype(bool)
    predicted = mask.astype(bool)
    matched = int(np.count_nonzero(reference & predicted))
    reference_pixels = int(np.count_nonzero(reference))
    prediction_pixels = int(np.count_nonzero(predicted))
    union = prediction_pixels + reference_pixels - matched
    return {
        "status": "reference_comparison", "reference": "ALKIS Berlin",
        "raster_iou": round(matched / union, 4) if union else None,
        "raster_precision": round(matched / prediction_pixels, 4) if prediction_pixels else None,
        "raster_recall": round(matched / reference_pixels, 4) if reference_pixels else None,
        "note": "Pixel-level agreement on this one Berlin sample; not a citywide validation result.",
    }


def load_model(revision: str, device: str):
    import torch
    import segmentation_models_pytorch as smp
    from huggingface_hub import hf_hub_download

    weights = Path(hf_hub_download(repo_id=MODEL_REPO, filename="model.pth", revision=revision))
    model = smp.UnetPlusPlus(encoder_name="efficientnet-b4", encoder_weights=None, in_channels=3, classes=2)
    state = torch.load(weights, map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    model = model.to(device)
    checksum = hashlib.sha256(weights.read_bytes()).hexdigest()
    resolved_revision = weights.parent.name  # Hugging Face snapshot commit when available
    return model, checksum, resolved_revision


def run(data: Path, threshold: float, min_area: float, revision: str, device: str) -> int:
    image_file = data / "berlin_orthophoto.png"
    meta_file = data / "metadata.json"
    if not image_file.exists() or not meta_file.exists():
        raise ValueError("Reference imagery missing. Run python scripts/fetch_berlin.py first.")
    metadata = json.loads(meta_file.read_text(encoding="utf-8"))
    rgb = np.asarray(Image.open(image_file).convert("RGB"), dtype=np.uint8)
    bbox = check_georeferencing(metadata, rgb.shape[1], rgb.shape[0])
    model, checksum, resolved_revision = load_model(revision, device)
    probability = predict_probability(rgb, model, device)
    mask = (probability >= threshold).astype(np.uint8)
    features = vectorize_mask(mask, bbox, min_area=min_area)
    evaluation = evaluate_mask(mask, data / "berlin_buildings.geojson", bbox)
    if not features:
        raise RuntimeError("No polygons exceeded the threshold and area filter. No prediction files were published.")
    # Store only real model outputs, never synthetic shapes or ALKIS reference copies.
    collection = {"type": "FeatureCollection", "features": features, "metadata": {
        "data_type": "model_prediction", "source_image": "Berlin DOP 2025",
        "model": MODEL_REPO, "weights_sha256": checksum,
        "license": "Apache-2.0", "crs": "EPSG:4326",
    }}
    result_meta = {
        "model": MODEL_REPO, "model_revision": resolved_revision,
        "weights_sha256": checksum, "source_image_sha256": hashlib.sha256(image_file.read_bytes()).hexdigest(),
        "source_image_year": metadata.get("imagery_year"), "source_bbox_25833": metadata.get("bbox_25833"), "analysis_crs": "EPSG:25833",
        "output_crs": "EPSG:4326", "threshold": threshold, "min_area_m2": min_area,
        "predicted_features": len(features), "computed_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "real_model_inference", "validation_status": "not_evaluated_for_berlin",
        "warning": "Research model prediction; not an authoritative footprint inventory. Model trained on WHU 0.3m imagery.",
        "model_url": f"https://huggingface.co/{MODEL_REPO}",
        "input_provenance": metadata.get("provenance", {}).get("imagery", {}),
        "reference_evaluation": evaluation,
    }
    data.mkdir(parents=True, exist_ok=True)
    (data / "ai_buildings.geojson").write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
    (data / "ai_metadata.json").write_text(json.dumps(result_meta, indent=2), encoding="utf-8")
    print(f"Saved {len(features)} predicted building polygons to {data / 'ai_buildings.geojson'}")
    return len(features)


def main():
    parser = argparse.ArgumentParser(description="Run a pretrained building segmentation model on the cached Berlin aerial sample")
    parser.add_argument("--data", type=Path, default=DATA, help="Directory containing downloaded Berlin sample")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--min-area", type=float, default=15.0)
    parser.add_argument("--revision", default="main", help="Hugging Face model git revision; prefer pinning a commit SHA")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args()
    if not 0 < args.threshold < 1 or args.min_area <= 0:
        parser.error("Threshold must be in (0,1) and minimum area positive")
    try:
        run(args.data, args.threshold, args.min_area, args.revision, args.device)
    except (OSError, ValueError, RuntimeError, ImportError) as exc:
        parser.exit(1, f"Inference failed without producing simulated results: {exc}\n")


if __name__ == "__main__":
    main()
