# Changelog

## [0.6.0] — 2026-11-18

### Added
- User-controlled bounding-box and polygon annotation directly on the Berlin orthophoto.
- Manual classes: solar panels, vehicles, possible waste sites, buildings, vegetation, water, and custom classes.
- Independently styled annotation geometry, review statuses, selection, class editing, individual deletion and clear-all confirmation.
- Browser-local persistence keyed to the original imagery year and extent.
- Validated GeoJSON import/export recording geometry, origin, class, review state, timestamp, CRS, imagery provenance and extent.
- Geometry and data-integrity checks for bounds, self-intersections, invalid coordinates, unsafe labels and duplicate feature identifiers.
- Annotation regression tests in existing GitHub Actions frontend test command.
- README technology badges and interactive annotation instructions.

### Scope
- This release prepares annotated examples. It does **not** run real-time object detection, find-similar searches, or training.
- Browser storage is not a managed database; datasets should be exported after annotation sessions.

## [0.5.0] — 2026-11-17

### Added
- Optional pretrained building segmentation from cached Berlin RGB orthophoto, with georeferenced vector predictions, model-weight provenance and localized ALKIS comparison metrics.
- Independently switchable prediction layer; it is unavailable until real output files have been generated and reviewed.
- Spatial and inference test suites remain separate to avoid heavy dependencies in routine website deployment.
- Technical direction for future LiDAR-based and multimodal building extraction with per-provider availability and license controls.

### Notes
- Inference is not performed on GitHub Pages or in its CI/CD jobs; no synthetic results are supplied.
- Cross-city performance on Berlin remains unvalidated until actual inference and independent evaluation are completed.
- Public Overpass requests remain optional and can time out.

## [0.4.0] — 2026-11-17

### Added
- Offline-first **spatial analysis scope**: full downloaded dataset, drawn AOI, or current map viewport.
- Local polygon/rectangle intersection supporting Polygon, MultiPolygon and interior holes; bounding-box reject before detailed intersection.
- Map, KPI counts, area histogram and exports use the same matching feature subset.
- CSV download with spreadsheet formula-injection protection; GeoJSON export records its spatial scope and provenance.
- Tests for geometry intersections, filtering and safe CSV serialization.

### Changed
- Drawing an AOI immediately analyzes already downloaded features without an Overpass call.
- Public OSM/Overpass retrieval remains optional, experimental and subject to third-party rate limits.
- Added explicit warning that all summed areas are **full footprint areas of intersecting features**, not areas clipped by the selection.
- Retained the v0.3.1 manual Overpass provider selection; retained the missing MapLibre `LngLatBounds` import fix.

### Limitations
- Offline analysis applies only to the bundled Berlin ALKIS sample or previously loaded OSM features; it does **not** download new buildings outside this coverage.
- Map view statistics update on map movement completion, not continuously during panning.
- The production Vite build must be verified on GitHub Actions; package installation was unavailable in the offline build environment.

## [0.3.0] — Dynamic Geospatial Explorer

- Added a two-click AOI rectangle tool for mouse and touchscreen users.
- Added a user-initiated, bounded OpenStreetMap building-way query service.
- Added OSM/ALKIS dataset switching with separate provenance and area-calculation labels.
- Added clear loading, cancel, error and empty-result states for dynamic geodata requests.
- Added cached query results, response-size checks, AOI restrictions and offline AOI tests.
- Preserved the original fixed Berlin orthophoto and reference data as the default dataset.
- Added attribution metadata to exported GeoJSON.
- Limited release packages to public project materials.

## [0.2.0] — Dashboard usability

- Moved selected building details out of the map viewport.
- Added reset map view and expanded map layout.
- Added orthophoto boundary visualization and building ID fly-to.
- Improved filtering and footprint area distribution chart.

## [0.1.0] — Initial exploration

- Implemented automated small-area Berlin WMS/WFS acquisition.
- Added MapLibre-based React GIS dashboard and GitHub Pages deployment.

