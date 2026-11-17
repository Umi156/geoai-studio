"""Offline correctness checks: these tests do not download model weights."""
import unittest
import numpy as np

from scripts.run_building_inference import check_georeferencing, tile_origins, vectorize_mask, evaluate_mask


class InferenceGeometryTests(unittest.TestCase):
    def test_georeferencing_checks_bbox(self):
        self.assertEqual(check_georeferencing({"bbox_25833": [385850, 5819750, 386050, 5819950]}, 1024, 1024),
                         (385850.0, 5819750.0, 386050.0, 5819950.0))
        with self.assertRaises(ValueError):
            check_georeferencing({"bbox_25833": [386050, 5819750, 385850, 5819950]}, 1024, 1024)

    def test_tile_origins_guarantee_edge_coverage(self):
        self.assertEqual(tile_origins(1024, 512, 128), [0, 384, 512])
        self.assertEqual(tile_origins(99, 512, 128), [0])
        with self.assertRaises(ValueError):
            tile_origins(300, 512, 512)

    def test_real_mask_is_vectorized_with_projection(self):
        mask = np.zeros((100, 100), dtype=np.uint8)
        mask[10:30, 10:30] = 1
        out = vectorize_mask(mask, (385850, 5819750, 385950, 5819850))
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]['properties']['area_m2'], 400, places=1)
        self.assertEqual(out[0]['properties']['status'], 'model_prediction')
        x, y = out[0]['geometry']['coordinates'][0][0]
        self.assertTrue(12.0 < x < 14.5 and 52.0 < y < 53.5)

    def test_reference_comparison_is_derived_from_real_mask(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        import json
        from pyproj import Transformer
        from shapely.geometry import box, mapping
        from shapely.ops import transform
        bbox = (385850, 5819750, 385950, 5819850)
        mask = np.zeros((100, 100), dtype=np.uint8)
        mask[20:30, 20:30] = 1
        to_wgs = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True).transform
        geom = mapping(transform(to_wgs, box(385870, 5819820, 385880, 5819830)))
        with TemporaryDirectory() as temp:
            path = Path(temp) / 'reference.geojson'
            path.write_text(json.dumps({'type':'FeatureCollection','features':[{'type':'Feature','geometry':geom,'properties':{}}]}))
            metrics = evaluate_mask(mask, path, bbox)
            self.assertEqual(metrics['status'], 'reference_comparison')
            self.assertEqual(metrics['raster_iou'], 1.0)
            self.assertEqual(metrics['raster_precision'], 1.0)
            self.assertEqual(metrics['raster_recall'], 1.0)

    def test_small_artifacts_removed(self):
        mask = np.zeros((100, 100), dtype=np.uint8)
        mask[2:3, 2:3] = 1
        self.assertEqual(vectorize_mask(mask, (385850, 5819750, 385950, 5819850)), [])


if __name__ == '__main__':
    unittest.main()
