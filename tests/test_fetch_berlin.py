"""Offline safety and geometry unit tests. No network calls."""
import unittest
from scripts.fetch_berlin import DEFAULT_BBOX, coordinates_4326, normalized_geojson, validate_bbox


class DataAcquisitionTests(unittest.TestCase):
    def test_corners_are_ordered_and_geographic(self):
        corners = coordinates_4326(DEFAULT_BBOX)
        self.assertEqual(len(corners), 4)
        self.assertTrue(all(13 < lon < 14 and 52 < lat < 53 for lon, lat in corners))
        self.assertLess(corners[0][0], corners[1][0])
        self.assertGreater(corners[0][1], corners[3][1])

    def test_reject_large_download_area(self):
        with self.assertRaises(ValueError):
            validate_bbox((385000, 5819000, 387000, 5821000))

    def test_reject_invalid_area(self):
        with self.assertRaises(ValueError):
            validate_bbox((386000, 5819000, 385000, 5821000))

    def test_normalize_utm_polygon(self):
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {
            "type": "Polygon", "coordinates": [[[385850, 5819750], [385860, 5819750], [385860, 5819760], [385850, 5819760], [385850, 5819750]]]
        }}]}
        normalized = normalized_geojson(fc)
        f = normalized['features'][0]
        self.assertAlmostEqual(f['properties']['area_m2'], 100.0, delta=0.01)
        self.assertEqual(f['properties']['status'], 'official_reference')
        self.assertTrue(13 < f['geometry']['coordinates'][0][0][0] < 14)

    def test_normalize_lat_lon_axis_order(self):
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {
            "type": "Polygon", "coordinates": [[[52.5000, 13.3100], [52.5000, 13.3101], [52.5001, 13.3101], [52.5001, 13.3100], [52.5000, 13.3100]]]
        }}]}
        feature = normalized_geojson(fc)["features"][0]
        lon, lat = feature["geometry"]["coordinates"][0][0]
        self.assertAlmostEqual(lon, 13.31, places=3)
        self.assertAlmostEqual(lat, 52.5, places=3)
        self.assertGreater(feature["properties"]["area_m2"], 1)

    def test_reject_empty_feature_collection(self):
        with self.assertRaises(ValueError):
            normalized_geojson({"type": "FeatureCollection", "features": []})


if __name__ == '__main__':
    unittest.main()
