import test from 'node:test';
import assert from 'node:assert/strict';
import { imageExtent, insideImage, makeRing, newAnnotation, exportAnnotations, importAnnotationText, parseAnnotations, normalizedClass, storageKey, MAX_ANNOTATIONS } from '../src/services/annotations.ts';

const corners = [[13.4000,52.5210],[13.4020,52.5210],[13.4020,52.5190],[13.4000,52.5190]];
const extent = imageExtent(corners);
const ring = makeRing([[13.4001,52.5191],[13.401,52.520]], 'box', extent);
const item = newAnnotation('example-1', 'solar_panel', 'box', ring, extent, '2026-11-18T00:00:00Z');

test('extent supports a bounded image and rejects outside coordinates', () => {
  assert.deepEqual(extent, { west:13.4, south:52.519, east:13.402, north:52.521 });
  assert.ok(insideImage([13.401,52.52], extent));
  assert.equal(insideImage([13.5,52.52], extent), false);
});
test('two box corners create a closed polygon; polygon uses actual user points', () => {
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  const poly = makeRing([[13.4002,52.5192],[13.401,52.5192],[13.4007,52.5203]], 'polygon', extent);
  assert.equal(poly.length, 4);
  assert.deepEqual(poly[0], poly[3]);
});
test('invalid annotation geometry is rejected rather than silently adjusted', () => {
  assert.throws(() => makeRing([[13.4001,52.5191],[13.4001,52.5191]], 'box', extent));
  assert.throws(() => makeRing([[13.4001,52.5191],[13.6,52.5195]], 'box', extent));
  assert.throws(() => makeRing([[13.4,52.519],[13.401,52.52]], 'polygon', extent));
  assert.throws(() => makeRing([[13.4001,52.5191],[13.401,52.5205],[13.401,52.5191],[13.4001,52.5205]], 'polygon', extent));
});
test('labels and source types are validated', () => {
  assert.equal(normalizedClass('  solar  panel '), 'solar panel');
  assert.throws(() => normalizedClass('<script>alert(1)</script>'));
  assert.throws(() => newAnnotation('unsafe/id', 'car', 'box', ring, extent));
});
test('GeoJSON exports have explicit manual origin, year, CRS and imagery attribution', () => {
  const data = JSON.parse(exportAnnotations([item], 2025, extent));
  assert.equal(data.features[0].properties.origin, 'manual_annotation');
  assert.equal(data.metadata.crs, 'EPSG:4326');
  assert.equal(data.metadata.imagery_year, 2025);
  assert.ok(data.metadata.imagery_attribution.includes('Berlin'));
  assert.equal(importAnnotationText(JSON.stringify(data), 2025, extent).length, 1);
});
test('wrong imagery, oversized import, external predictions and duplicate ids are rejected', () => {
  const json = exportAnnotations([item], 2025, extent);
  assert.throws(() => importAnnotationText(json, 2026, extent));
  assert.throws(() => importAnnotationText('x'.repeat(2_000_001), 2025, extent));
  assert.throws(() => parseAnnotations({type:'FeatureCollection', features: [{...item, properties: {...item.properties, origin:'model_prediction'}}]}, extent));
  assert.throws(() => parseAnnotations({type:'FeatureCollection', features: [item, item]}, extent));
  assert.throws(() => parseAnnotations({type:'FeatureCollection', features: Array(MAX_ANNOTATIONS+1).fill(item)}, extent));
});
test('review status is preserved and local storage keys are image-specific', () => {
  const accepted = {...item, properties: {...item.properties, status: 'accepted'}};
  const data = JSON.parse(exportAnnotations([accepted], 2025, extent));
  assert.equal(importAnnotationText(JSON.stringify(data), 2025, extent)[0].properties.status, 'accepted');
  assert.notEqual(storageKey(2025, extent), storageKey(2026, extent));
});
