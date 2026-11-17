/** CSV export for selected geospatial features, including spreadsheet-formula safeguards. */
import type { BuildingFeature } from '../types';

function csvCell(value: string | number): string {
  const text = String(value);
  // Prevent untrusted OSM tags from becoming spreadsheet formulas.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildingCsv(features: BuildingFeature[], datasetLabel: string): string {
  const header = ['feature_id', 'area_m2', 'building_type', 'dataset'];
  const rows = features.map(f => [
    f.properties.fid,
    f.properties.area_m2,
    f.properties.building_type,
    datasetLabel,
  ].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
