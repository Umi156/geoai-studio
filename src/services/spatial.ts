/** Browser-side spatial analysis over already downloaded GeoJSON.
 * Uses exact polygon/axis-aligned rectangle intersection (not only a bbox prefilter).
 * Longitudes must be in ordinary WGS84 coordinates; dateline-wrapping viewports are unsupported.
 */
import type { BuildingFeature, Coordinate, PolygonGeom } from '../types';
import type { AoiBounds } from './overpass';

export type SpatialScope = 'dataset' | 'aoi' | 'viewport';
const EPS = 1e-12;

export function pointInBounds([lon, lat]: Coordinate, b: AoiBounds): boolean {
  return lon >= b.west - EPS && lon <= b.east + EPS && lat >= b.south - EPS && lat <= b.north + EPS;
}

function pointOnSegment(p: Coordinate, a: Coordinate, b: Coordinate): boolean {
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > EPS) return false;
  return p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

function pointInRing(point: Coordinate, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i++) {
    const a = ring[i] as Coordinate;
    const b = ring[j] as Coordinate;
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointInPolygon(p: Coordinate, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(p, rings[0])) return false;
  // Points on a hole boundary are still part of the polygon boundary.
  return !rings.slice(1).some(ring => pointInRing(p, ring));
}

function segmentHitsBounds(a: Coordinate, c: Coordinate, b: AoiBounds): boolean {
  if (pointInBounds(a, b) || pointInBounds(c, b)) return true;
  // Liang-Barsky clipping against an axis-aligned rectangle.
  const dx = c[0] - a[0]; const dy = c[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - b.west, b.east - a[0], a[1] - b.south, b.north - a[1]];
  let t0 = 0; let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) {
      if (q[i] < -EPS) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1 + EPS) return false;
    }
  }
  return true;
}

function polygonHitsBounds(rings: number[][][], b: AoiBounds): boolean {
  if (!rings.length || !rings[0].length) return false;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const p of rings[0]) {
    west = Math.min(west, p[0]); south = Math.min(south, p[1]);
    east = Math.max(east, p[0]); north = Math.max(north, p[1]);
  }
  // Fast reject using bounding boxes before the more precise spatial tests.
  if (east < b.west || west > b.east || north < b.south || south > b.north) return false;
  for (const ring of rings) {
    if (ring.some(p => pointInBounds(p as Coordinate, b))) return true;
    for (let i = 0; i < ring.length - 1; i++) {
      if (segmentHitsBounds(ring[i] as Coordinate, ring[i + 1] as Coordinate, b)) return true;
    }
  }
  const corners: Coordinate[] = [
    [b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north],
  ];
  return corners.some(c => pointInPolygon(c, rings));
}

export function geometryIntersectsBounds(geometry: PolygonGeom, bounds: AoiBounds): boolean {
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
      bounds.west >= bounds.east || bounds.south >= bounds.north) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => polygonHitsBounds(polygon, bounds));
}

export function filterBuildings(features: BuildingFeature[], minAreaM2: number, bounds: AoiBounds | null): BuildingFeature[] {
  return features.filter(feature => Number.isFinite(feature.properties.area_m2) &&
    feature.properties.area_m2 >= minAreaM2 &&
    (!bounds || geometryIntersectsBounds(feature.geometry, bounds)));
}
