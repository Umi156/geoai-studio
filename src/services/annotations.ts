/** Manual, image-bound GeoJSON annotations. No model inference or synthetic detections. */
export type Position = [number, number];
export type DrawingShape = 'box' | 'polygon';
export type AnnotationStatus = 'unreviewed' | 'accepted' | 'rejected';
export type Annotation = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: Position[][] };
  properties: {
    annotation_id: string;
    class_name: string;
    shape: DrawingShape;
    status: AnnotationStatus;
    origin: 'manual_annotation';
    created_at_utc: string;
  };
};
export type AnnotationCollection = { type: 'FeatureCollection'; features: Annotation[] };
export type ImageExtent = { west: number; south: number; east: number; north: number };
export const MAX_ANNOTATIONS = 500;
export const MAX_VERTICES = 100;
const MAX_IMPORT_BYTES = 2_000_000;
const equal = (a: Position, b: Position) => Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;

export function imageExtent(corners: Position[]): ImageExtent {
  if (corners.length !== 4 || corners.some(p => !validPosition(p))) throw new Error('Invalid orthophoto extent.');
  return {
    west: Math.min(...corners.map(p => p[0])), east: Math.max(...corners.map(p => p[0])),
    south: Math.min(...corners.map(p => p[1])), north: Math.max(...corners.map(p => p[1])),
  };
}
export function validPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n))
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -85 && value[1] <= 85;
}
export function insideImage(point: Position, extent: ImageExtent): boolean {
  const epsilon = 1e-8;
  return point[0] >= extent.west - epsilon && point[0] <= extent.east + epsilon
    && point[1] >= extent.south - epsilon && point[1] <= extent.north + epsilon;
}
export function normalizedClass(value: string): string {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u.test(label)) {
    throw new Error('Class name must be 1–40 letters/numbers (spaces, _ and - are allowed).');
  }
  return label;
}
function signedRingArea(ring: Position[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return area / 2;
}
function crossing(a: Position, b: Position, c: Position, d: Position): boolean {
  const cross = (p: Position, q: Position, r: Position) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  return x * y < 0 && z * w < 0;
}
function validateRing(ring: unknown, extent: ImageExtent): asserts ring is Position[] {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > MAX_VERTICES + 1
    || ring.some(p => !validPosition(p) || !insideImage(p, extent))) {
    throw new Error('Annotation must be a polygon inside the supplied orthophoto (max 100 vertices).');
  }
  const pts = ring as Position[];
  if (!equal(pts[0], pts[pts.length - 1])) throw new Error('Polygon ring must be closed.');
  for (let i = 1; i < pts.length; i++) if (equal(pts[i], pts[i - 1])) throw new Error('Duplicate consecutive polygon points.');
  if (Math.abs(signedRingArea(pts)) < 1e-12) throw new Error('Annotation is too small or has zero area.');
  for (let i = 0; i < pts.length - 1; i++) for (let j = i + 2; j < pts.length - 1; j++) {
    if (i === 0 && j === pts.length - 2) continue;
    if (crossing(pts[i], pts[i + 1], pts[j], pts[j + 1])) throw new Error('Polygon edges cross each other.');
  }
}
export function makeRing(points: Position[], shape: DrawingShape, extent: ImageExtent): Position[] {
  if (points.some(p => !validPosition(p) || !insideImage(p, extent))) throw new Error('Draw inside the yellow imagery boundary.');
  let ring: Position[];
  if (shape === 'box') {
    if (points.length !== 2) throw new Error('A box needs two opposite corners.');
    const [a, b] = points;
    ring = [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
      [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])]];
  } else {
    const unique = points.filter((p, i) => i === 0 || !equal(p, points[i - 1]));
    if (unique.length > MAX_VERTICES) throw new Error('Maximum 100 polygon vertices.');
    ring = unique.length > 3 && equal(unique[0], unique[unique.length - 1]) ? unique.slice(0, -1) : unique;
    if (ring.length < 3) throw new Error('A polygon needs at least 3 distinct corners.');
  }
  const closed = [...ring, ring[0]];
  validateRing(closed, extent);
  return closed;
}
export function newAnnotation(id: string, label: string, shape: DrawingShape, ring: Position[], extent: ImageExtent, at = new Date().toISOString()): Annotation {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid annotation identifier.');
  validateRing(ring, extent);
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: {
    annotation_id: id, class_name: normalizedClass(label), shape, status: 'unreviewed', origin: 'manual_annotation', created_at_utc: at,
  } };
}
export function parseAnnotations(data: unknown, extent: ImageExtent): Annotation[] {
  if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'FeatureCollection'
    || !('features' in data) || !Array.isArray(data.features) || data.features.length > MAX_ANNOTATIONS) {
    throw new Error('Expected a GeoJSON FeatureCollection with 500 or fewer annotations.');
  }
  const seen = new Set<string>();
  return data.features.map((entry: unknown): Annotation => {
    if (!entry || typeof entry !== 'object' || !('type' in entry) || entry.type !== 'Feature'
      || !('geometry' in entry) || !entry.geometry || typeof entry.geometry !== 'object'
      || !('type' in entry.geometry) || entry.geometry.type !== 'Polygon'
      || !('coordinates' in entry.geometry) || !Array.isArray(entry.geometry.coordinates)
      || entry.geometry.coordinates.length !== 1 || !('properties' in entry) || !entry.properties || typeof entry.properties !== 'object') {
      throw new Error('Only single-ring polygon annotations are supported.');
    }
    const props = entry.properties as Record<string, unknown>;
    const id = props.annotation_id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || seen.has(id)) throw new Error('Duplicate or invalid annotation ID.');
    seen.add(id);
    const shape = props.shape;
    if (shape !== 'box' && shape !== 'polygon') throw new Error('Unknown annotation shape.');
    if (typeof props.class_name !== 'string') throw new Error('Missing class label.');
    if (props.origin !== 'manual_annotation') throw new Error('Only manually created annotations may be imported.');
    if (!['unreviewed', 'accepted', 'rejected'].includes(String(props.status))) throw new Error('Invalid review state.');
    if (typeof props.created_at_utc !== 'string' || !Number.isFinite(Date.parse(props.created_at_utc))) throw new Error('Invalid timestamp.');
    const ring = (entry.geometry.coordinates as unknown[])[0];
    validateRing(ring, extent);
    return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: {
      annotation_id: id, class_name: normalizedClass(String(props.class_name)), shape, status: props.status as AnnotationStatus,
      origin: 'manual_annotation', created_at_utc: props.created_at_utc,
    } };
  });
}
export function exportAnnotations(annotations: Annotation[], imageryYear: number, extent: ImageExtent): string {
  const features = parseAnnotations({ type: 'FeatureCollection', features: annotations }, extent);
  return JSON.stringify({ type: 'FeatureCollection', features,
    metadata: { schema: 'geoai-annotations-v1', crs: 'EPSG:4326', source: 'manual imagery annotation',
      imagery: 'Berlin DOP20 RGB', imagery_year: imageryYear, imagery_extent: extent,
      validation: 'Labels are user-supplied; no model predictions or verified ground truth are implied.',
      imagery_attribution: 'Geoportal Berlin · dl-de/zero-2-0', exported_at_utc: new Date().toISOString() },
  }, null, 2);
}
export function importAnnotationText(text: string, imageryYear: number, extent: ImageExtent): Annotation[] {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('Import must be smaller than 2 MB.');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('The selected file is not valid JSON.'); }
  if (!data || typeof data !== 'object' || !('metadata' in data) || !data.metadata || typeof data.metadata !== 'object') {
    throw new Error('Missing GeoAI Studio annotation metadata.');
  }
  const meta = data.metadata as Record<string, unknown>;
  if (meta.schema !== 'geoai-annotations-v1' || meta.imagery_year !== imageryYear || meta.crs !== 'EPSG:4326') {
    throw new Error('This annotation file uses a different image or unsupported format.');
  }
  if (JSON.stringify(meta.imagery_extent) !== JSON.stringify(extent)) throw new Error('Annotation extent does not match the current image.');
  return parseAnnotations(data, extent);
}
export function storageKey(year: number, extent: ImageExtent): string {
  return `geoai-studio.annotations.v1.${year}.${extent.west.toFixed(6)}.${extent.south.toFixed(6)}.${extent.east.toFixed(6)}.${extent.north.toFixed(6)}`;
}
