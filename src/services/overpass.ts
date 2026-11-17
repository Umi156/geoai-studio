/** Bounded, user-triggered OSM building discovery for the static GitHub Pages demo.
 * This service is best-effort. Public Overpass is NOT a production/SLA backend.
 */
import type { BuildingCollection, BuildingFeature } from '../types';

export type AoiBounds = { west: number; south: number; east: number; north: number };
export type AoiSize = { widthM: number; heightM: number; areaKm2: number };

const EARTH_RADIUS_M = 6_371_008.8;
export const MAX_AOI_KM2 = 0.5;
const MAX_OSM_FEATURES = 2500;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { savedAt: number; features: BuildingCollection }>();

function toRad(value: number): number { return value * Math.PI / 180; }

export function inspectAoi(aoi: AoiBounds): AoiSize {
  const { west, south, east, north } = aoi;
  if (![west, south, east, north].every(Number.isFinite) ||
      south < -85 || north > 85 || west < -180 || east > 180 ||
      west >= east || south >= north) {
    throw new Error('Invalid geographic rectangle. Select two corners without crossing the date line.');
  }
  const midLat = toRad((south + north) / 2);
  const widthM = EARTH_RADIUS_M * toRad(east - west) * Math.cos(midLat);
  const heightM = EARTH_RADIUS_M * toRad(north - south);
  const areaKm2 = widthM * heightM / 1_000_000;
  if (areaKm2 < 0.000025) throw new Error('Area too small. Draw a rectangle at least about 5 × 5 metres.');
  if (areaKm2 > MAX_AOI_KM2 || widthM > 1000 || heightM > 1000) {
    throw new Error(`Area too large. Please draw at most ${MAX_AOI_KM2} km² and 1 km per side.`);
  }
  return { widthM, heightM, areaKm2 };
}

/** Small-AOI spherical area approximation for display, NOT an official cadastral measurement. */
export function approximatePolygonAreaM2(rings: number[][][]): number {
  function ringArea(ring: number[][]): number {
    if (ring.length < 4) return 0;
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i]; const b = ring[i + 1];
      let longitudeDiff = toRad(b[0] - a[0]);
      if (longitudeDiff > Math.PI) longitudeDiff -= 2 * Math.PI;
      if (longitudeDiff < -Math.PI) longitudeDiff += 2 * Math.PI;
      sum += longitudeDiff * (2 + Math.sin(toRad(a[1])) + Math.sin(toRad(b[1])));
    }
    return Math.abs(sum * EARTH_RADIUS_M * EARTH_RADIUS_M / 2);
  }
  if (!rings.length) return 0;
  return Math.max(0, ringArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0));
}

type OsmElement = {
  type?: unknown; id?: unknown; tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

export function parseOverpassBuildings(payload: unknown): BuildingCollection {
  if (!payload || typeof payload !== 'object' || !('elements' in payload) ||
      !Array.isArray((payload as { elements?: unknown }).elements)) {
    throw new Error('Unexpected OpenStreetMap response format.');
  }
  const elements = (payload as { elements: OsmElement[] }).elements;
  if (elements.length > MAX_OSM_FEATURES) {
    throw new Error('Too many buildings returned. Draw a smaller area and try again.');
  }
  const features: BuildingFeature[] = [];
  const seen = new Set<number>();
  for (const element of elements) {
    if (element.type !== 'way' || typeof element.id !== 'number' || !Number.isSafeInteger(element.id) ||
        seen.has(element.id) || !Array.isArray(element.geometry)) continue;
    const points = element.geometry.map(p => [p.lon, p.lat]);
    if (points.length < 4 || points.some(p => !p.every(Number.isFinite) || p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90)) continue;
    const first = points[0], last = points[points.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) continue; // open ways are not polygons
    const areaM2 = approximatePolygonAreaM2([points]);
    if (!(areaM2 > 0 && areaM2 < 1_000_000)) continue;
    seen.add(element.id);
    features.push({
      type: 'Feature', id: element.id,
      geometry: { type: 'Polygon', coordinates: [points] },
      properties: {
        fid: element.id,
        area_m2: Math.round(areaM2 * 10) / 10,
        building_type: element.tags?.building || 'yes',
        source: 'OpenStreetMap contributors',
        status: 'osm_community_data',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function queryText(aoi: AoiBounds): string {
  inspectAoi(aoi);
  const n = (v: number) => v.toFixed(6);
  // Overpass bbox order: south, west, north, east. Fetch only building ways.
  return `[out:json][timeout:20];way["building"](${n(aoi.south)},${n(aoi.west)},${n(aoi.north)},${n(aoi.east)});out geom;`;
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 429 || response.status === 504) throw new Error('OpenStreetMap query service is busy. Please try again later.');
    throw new Error(`OpenStreetMap data request failed (HTTP ${response.status}).`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Response exceeds the 5 MB safety limit. Reduce the AOI.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Your browser cannot stream the service response.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Response exceeds the 5 MB safety limit. Reduce the AOI.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { all.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(all)) as unknown; }
  catch { throw new Error('The data service returned unreadable data. Try again later.'); }
}

export async function fetchOsmBuildings(aoi: AoiBounds, signal: AbortSignal): Promise<BuildingCollection> {
  const query = queryText(aoi);
  const key = query;
  const existing = cache.get(key);
  if (existing && Date.now() - existing.savedAt < CACHE_MS) return existing.features;
  // No automatic retries or background polling: each fetch is user-initiated.
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not contact the public OpenStreetMap query service. Check your connection or try later.');
  }
  const result = parseOverpassBuildings(await readBoundedResponse(response));
  cache.set(key, { savedAt: Date.now(), features: result });
  return result;
}
