import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryIntersectsBounds, filterBuildings } from '../src/services/spatial.ts';
import { buildingCsv } from '../src/services/export.ts';

const bounds = { west: 10, south: 10, east: 12, north: 12 };
const ring = (coords) => [...coords, coords[0]];
const poly = (coords, holes = []) => ({ type: 'Polygon', coordinates: [ring(coords), ...holes.map(ring)] });
const feature = (id, geom, area = 120, kind = 'yes') => ({
  type: 'Feature', id, geometry: geom,
  properties: { fid: id, area_m2: area, building_type: kind, source: 'test', status: 'reference' },
});

test('polygon within extent intersects; far-away polygon does not', () => {
  assert.equal(geometryIntersectsBounds(poly([[10.2,10.2],[10.4,10.2],[10.4,10.4],[10.2,10.4]]), bounds), true);
  assert.equal(geometryIntersectsBounds(poly([[1,1],[2,1],[2,2],[1,2]]), bounds), false);
});

test('detects polygons crossing extent with no polygon vertices inside', () => {
  assert.equal(geometryIntersectsBounds(poly([[9,10.8],[13,10.8],[13,11.2],[9,11.2]]), bounds), true);
});

test('extent entirely inside polygon is an intersection', () => {
  assert.equal(geometryIntersectsBounds(poly([[9,9],[13,9],[13,13],[9,13]]), bounds), true);
});

test('extent contained entirely within a hole is excluded', () => {
  const donut = poly([[8,8],[14,8],[14,14],[8,14]], [[[9,9],[13,9],[13,13],[9,13]]]);
  assert.equal(geometryIntersectsBounds(donut, bounds), false);
});

test('multi-polygons are checked one part at a time', () => {
  const near = poly([[11,11],[11.5,11],[11.5,11.5],[11,11.5]]);
  const far = poly([[30,30],[31,30],[31,31],[30,31]]);
  const multi = { type: 'MultiPolygon', coordinates: [far.coordinates, near.coordinates] };
  assert.equal(geometryIntersectsBounds(multi, bounds), true);
});

test('filtering combines geometry extent and minimum source footprint area', () => {
  const features = [
    feature(1, poly([[10.2,10.2],[10.4,10.2],[10.4,10.4],[10.2,10.4]]), 60),
    feature(2, poly([[10.5,10.5],[11,10.5],[11,11],[10.5,11]]), 180),
    feature(3, poly([[30,30],[31,30],[31,31],[30,31]]), 200),
  ];
  assert.deepEqual(filterBuildings(features, 100, bounds).map(f => f.id), [2]);
  assert.equal(filterBuildings(features, 0, null).length, 3);
});

test('CSV export escapes user-controlled tags and emits source columns', () => {
  const text = buildingCsv([feature(7, poly([[10,10],[11,10],[11,11],[10,11]]), 100, '=WEBSERVICE("x")')], 'ALKIS Berlin');
  assert.match(text, /feature_id,area_m2,building_type,dataset/);
  assert.match(text, /"'=WEBSERVICE\(""x""\)"/);
  assert.match(text, /"ALKIS Berlin"/);
});
