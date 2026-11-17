export type Coordinate = [number, number];
export type PolygonGeom = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
export type BuildingFeature = {
  type: 'Feature'; id: number;
  geometry: PolygonGeom;
  properties: { fid: number; area_m2: number; building_type: string; source: string; status: string };
};
export type BuildingCollection = { type: 'FeatureCollection'; features: BuildingFeature[] };
export type DatasetMeta = {
  name: string; imagery_year: number; bbox_25833: number[]; image_corners: Coordinate[];
  center: Coordinate; building_count: number; downloaded_at_utc: string;
  provenance: { imagery: { provider: string; dataset: string; license: string }; buildings: { provider: string; dataset: string; license: string } };
  warning: string;
};
