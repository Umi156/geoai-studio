import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAoi, approximatePolygonAreaM2, parseOverpassBuildings, queryText } from '../src/services/overpass.ts';

const aoi = { west: 13.4, south: 52.52, east: 13.405, north: 52.523 };

test('valid bounds provide small area in square kilometres', () => {
  const size = inspectAoi(aoi);
  assert.ok(size.areaKm2 > 0 && size.areaKm2 < 0.5);
});

test('invalid and oversized bounds are rejected before any request', () => {
  assert.throws(() => inspectAoi({ ...aoi, east: aoi.west }));
  assert.throws(() => inspectAoi({ ...aoi, east: 13.5 }));
  assert.throws(() => inspectAoi({ ...aoi, north: 53 }));
});

test('queries preserve the strict south west north east order', () => {
  assert.match(queryText(aoi), /52\.520000,13\.400000,52\.523000,13\.405000/);
});

test('closed OSM building ways convert to geographic footprints with area', () => {
  const ring = [
    { lat: 52.52, lon: 13.4 }, { lat: 52.52, lon: 13.4001 },
    { lat: 52.5201, lon: 13.4001 }, { lat: 52.5201, lon: 13.4 },
    { lat: 52.52, lon: 13.4 },
  ];
  const result = parseOverpassBuildings({ elements: [
    { type: 'way', id: 999, tags: { building: 'residential' }, geometry: ring },
    { type: 'way', id: 998, geometry: ring.slice(0, -1) },
  ] });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.status, 'osm_community_data');
  assert.equal(result.features[0].properties.building_type, 'residential');
  assert.ok(result.features[0].properties.area_m2 > 50);
  assert.ok(approximatePolygonAreaM2([ring.map(p => [p.lon, p.lat])]) > 50);
});

test('malformed and excessively long OSM responses are rejected', () => {
  assert.throws(() => parseOverpassBuildings({ wrong: true }));
  assert.throws(() => parseOverpassBuildings({ elements: Array.from({ length: 2501 }, () => ({ type: 'node' })) }));
});


test('polygon area is orientation independent and respects interior holes', () => {
  const outside = [
    [13.4, 52.52], [13.4002, 52.52], [13.4002, 52.5202],
    [13.4, 52.5202], [13.4, 52.52],
  ];
  const hole = [
    [13.40005, 52.52005], [13.4001, 52.52005],
    [13.4001, 52.5201], [13.40005, 52.5201], [13.40005, 52.52005],
  ];
  const outer = approximatePolygonAreaM2([outside]);
  assert.ok(Math.abs(outer - approximatePolygonAreaM2([[...outside].reverse()])) < 1e-5);
  assert.ok(approximatePolygonAreaM2([outside, hole]) < outer);
});
