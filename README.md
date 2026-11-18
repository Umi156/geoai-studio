# GeoAI Studio

**Interactive geospatial intelligence workspace — v0.7.0**

[![Website](https://img.shields.io/badge/Live%20demo-GitHub%20Pages-0ea5e9)](https://umi156.github.io/geoai-studio/)

GeoAI Studio is a **browser-based GIS explorer** that analyzes an automatically prepared Berlin reference dataset directly in the browser, with **optional** user-triggered OpenStreetMap queries. It is built with React, TypeScript, MapLibre GL JS and a small Python geospatial acquisition pipeline.

> **Data provenance:** ALKIS and OpenStreetMap polygons are reference/community data, not model outputs. An optional offline inference tool can generate actual building predictions from the Berlin orthophoto; those results remain separate and are never substituted for official footprints. The public Overpass API is best-effort and has no SLA.

## Technology Stack

Badges link to the relevant tool documentation. The stack is reviewed whenever implementation dependencies change.

**Web application**

[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![MapLibre GL JS](https://img.shields.io/badge/MapLibre_GL_JS-285570?style=for-the-badge)](https://maplibre.org/maplibre-gl-js/docs/)
[![Recharts](https://img.shields.io/badge/Recharts-8884D8?style=for-the-badge)](https://recharts.org/)
[![Lucide](https://img.shields.io/badge/Lucide-FF4D4F?style=for-the-badge)](https://lucide.dev/)

**Geospatial data and processing**

[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Shapely](https://img.shields.io/badge/Shapely-2F855A?style=for-the-badge)](https://shapely.readthedocs.io/)
[![PyProj](https://img.shields.io/badge/PROJ-277DA1?style=for-the-badge)](https://pyproj4.github.io/pyproj/)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-7EBC6F?style=for-the-badge&logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)
[![Overpass API](https://img.shields.io/badge/Overpass_API-5B795A?style=for-the-badge)](https://wiki.openstreetmap.org/wiki/Overpass_API)

**Automation and deployment**

[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://docs.github.com/en/actions)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-181717?style=for-the-badge&logo=github&logoColor=white)](https://docs.github.com/en/pages)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**Browser-side visual search (on-demand)**

[![Transformers.js](https://img.shields.io/badge/Transformers.js-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co/docs/transformers.js/index)
[![DINOv2](https://img.shields.io/badge/DINOv2-7C3AED?style=for-the-badge)](https://huggingface.co/Xenova/dinov2-small)
[![ONNX Runtime Web](https://img.shields.io/badge/ONNX_Runtime_Web-005CED?style=for-the-badge)](https://onnxruntime.ai/docs/tutorials/web/)

**Optional offline model processing** (not executed by GitHub Pages)

[![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)](https://pytorch.org/)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co/)
[![Rasterio](https://img.shields.io/badge/Rasterio-277DA1?style=for-the-badge)](https://rasterio.readthedocs.io/)

## Features

- **Object Detection Studio (v0.7):** separate full-width MapLibre workspace for selecting an example on the existing Berlin orthophoto, initiating image-embedding similarity search, reviewing candidates and exporting GeoJSON.
- **Pretrained visual embeddings:** DINOv2-small through Transformers.js / ONNX Runtime Web; the browser fetches the public model weights on first use and scans a maximum of 64 multi-scale image windows. The results are *proposals*, **not** exhaustive object detections or segmentation masks.
- **Explicit review and provenance:** accept/reject each match; exports include model ID, similarity score (not probability), source, imagery year, review status and sampling limits. The model-search layer is separate from manual annotations and ALKIS reference footprints.

- **Manual Annotation Studio (v0.6):** draw bounding boxes or polygon labels directly on the Berlin orthophoto, assign classes (vehicles, solar panels, possible waste sites, buildings, vegetation, water or custom), review each label, and save locally.
- **Interoperable annotations:** export or import a validated GeoJSON FeatureCollection with WGS84 geometry, imagery extent/year, creator origin, review state and source attribution. Annotations are separate from the v0.7 experimental model-search candidates; no fine-tuning is performed.

- Interactive aerial map, with a visible boundary identifying the limited Berlin orthophoto coverage.
- Official ALKIS Berlin building footprints, area calculations, click-to-inspect, hover tooltips, filters and GeoJSON export.
- **Draw a new area of interest** by choosing two opposite map corners. The bundled ALKIS data is analyzed instantly, with no network request.
- Optionally request **OpenStreetMap building ways** for the selected area. Public Overpass services may time out; this is not required for the offline analysis features.
- Switch between official Berlin reference data and separately attributed OSM community data.
- Three spatial scopes (full loaded dataset, drawn AOI, or current map viewport), with consistent maps, KPI totals, area histogram and CSV/GeoJSON exports.
- Clear data-origin labels, loading and error states, request cancellation and bounded server requests.
- Responsive dashboard, collapsible sidebar and map expansion.
- Free hosting with GitHub Pages; the core dashboard needs no GPU, backend or paid provider.
- Optional offline pretrained building-segmentation inference; a separate orange map layer is shown **only when genuinely generated prediction assets exist**.

## Data sources

| Source | Usage | License/terms |
|---|---|---|
| [Berlin DOP 2025 WMS](https://daten.berlin.de/datensaetze/digitale-farbige-orthophotos-2025-dop20rgbi-wms-6529de5a) | 200 × 200 m aerial reference image, generated by the CI workflow | dl-de/zero-2-0 |
| [Berlin ALKIS building WFS](https://daten.berlin.de/datensaetze/alkis-berlin-gebaude-wfs-728b368a) | Official building polygons measured in ETRS89 / UTM zone 33N | dl-de/zero-2-0 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) | On-demand community-mapped building **ways** | ODbL 1.0; © OSM contributors |
| [OpenFreeMap](https://openfreemap.org/) | Background street map | Provider terms and OSM attribution |

OSM buildings returned by a bounding-box query may partly lie beyond the selected rectangle. Their full building footprints are included, not clipped. Dynamic OSM areas use a **spherical approximation** for display, not certified cadastral measurements. OSM multipolygon relations are not included in this version, so coverage can be incomplete.

## How to use the live demo

1. Open [GeoAI Studio](https://umi156.github.io/geoai-studio/).
2. Explore and inspect the default Berlin ALKIS reference buildings.
3. Click **Draw AOI** (or **Draw rectangle** in the right panel).
4. Click one corner on the map; move the cursor and click the opposite corner.
5. The selected rectangle immediately filters the available building polygons, counts, area metrics, chart and exports—without contacting Overpass.
6. Optionally click **Fetch extra OSM buildings** to request additional, independently attributed community data. This may time out or return no data.
7. Use **Analysis extent → Current map view** to analyze mapped features as you pan, then export matching GeoJSON or CSV. Use **Full available dataset** to reset.
8. Use **Return to Berlin ALKIS** to restore the bundled reference view after a successful OSM query.

**Safety limits:** AOI ≤ 0.5 km² and ≤ 1 km along either side; up to 5 MB response data and 2,500 OSM features. The browser sends the selected geographic coordinates directly to the third-party Overpass API only when the visitor clicks Fetch; there is no automatic request on pan or zoom. A failed live request does not replace the working Berlin dataset.

## Object Detection Studio (v0.7)

1. Open the deployed site and choose **Object Detection Studio** in the left workspace navigation. This is a dedicated view; the original GeoAI Explorer remains available.
2. Choose a class (solar panels, vehicles, suspected waste sites, buildings, vegetation, or another category).
3. Click **Draw example box** and click two opposite corners around one object **within the yellow aerial-image boundary**. Alternatively select an existing manual annotation from v0.6.
4. Set the minimum cosine-similarity threshold, then click **Find Similar Objects**. The model is downloaded to the browser on first use (requires access to Hugging Face) and may take a while to initialize, especially on CPU-only computers.
5. The browser compares a bounded maximum of 64 multi-scale image windows with the exemplar using DINOv2 visual embeddings. Open the candidate list to review, accept or reject suggestions.
6. Export georeferenced result boxes in GeoJSON. The score is a cosine similarity, **not a calibrated probability of detection**; the results are **not** automatically imported as manual ground truth.

**Scope and limitations:** v0.7 is a *model-assisted visual similarity pilot*, not an instance segmentation system. There is no live retraining, no guaranteed class-specific recognition, no SAM 3 integration, and no exhaustive search of all objects. Small cars and rooftop panels may be too small at the current 20 cm/pixel image resolution to yield distinctive embeddings. False positives and missed objects are expected; always review results manually. A scan runs locally in the visitor's browser on the downloaded 1024 × 1024 Berlin image, not on the remote Overpass service, and cannot process arbitrary cities until imagery services and bounded inference have been integrated. The pretrained source model [facebook/dinov2-small](https://huggingface.co/facebook/dinov2-small) is Apache-2.0; verify the source dataset and model usage policies before commercial deployment. ONNX-quantized weights are supplied by [Xenova/dinov2-small](https://huggingface.co/Xenova/dinov2-small).

**Performance and privacy:** the user-initiated first run downloads model assets from Hugging Face. Cropped image windows are processed on-device rather than uploaded to an inference API. Model downloads can fail or be blocked by browser/network restrictions; slower CPUs can take a long time per scan. Clicking cancel takes effect after the current model operation. The similarity prototype is not a production SLA-backed detector; use a separately provisioned backend and a validated detection or segmentation model for demanding workloads.

## Manual Annotation Studio (v0.6)

1. Load the Berlin reference map and keep **Aerial imagery** enabled.
2. Select a class under **Annotation Studio** (or enter a custom class name).
3. Select **Draw box**, then click two opposite corners of an object within the yellow dashed orthophoto boundary. For irregular objects, select **Draw polygon**, click its vertices, then press **Enter** or double-click to close the polygon. **Esc** cancels the draft.
4. Click the saved annotation on the map or in the annotation list, then set its review status to **Accept** or **Reject**, or remove it.
5. Click **Export GeoJSON** to back up labels. You can later import an exported file **for the same imagery year and geographic extent**. Import replaces the current annotation set after confirmation.

**Persistence and scope:** Annotations are stored only in the browser's `localStorage`, separated by imagery year and geographic extent; they are not synchronized to an account or server. Clear browser data or change devices and the local data may disappear. Export a backup after each annotation session. The current Berlin imagery is only 200 × 200 m; outside that region, annotations are blocked rather than pretending higher-resolution imagery is available.

**Data integrity:** All manually drawn shapes are stored as GeoJSON polygons in EPSG:4326, with `origin: manual_annotation`, a class, a review state and a timestamp. Unreviewed and accepted annotations are **user labels, not independently verified ground truth**. Future model predictions must be stored as a separate dataset and cannot be silently mixed with annotations. The annotation tools in v0.6 remain manual. The separate v0.7 Object Detection Studio adds an exploratory model-driven similarity shortlist, not dense object detection or online training.

## Source layout

```text
src/App.tsx                  Explorer navigation, dashboard, filters and AOI workflow
src/ObjectDetectionStudio.tsx  Dedicated visual example/search/review interface
src/services/similarity.ts    Image-window sampling, cosine similarity, NMS and geospatial export
src/services/exemplarModel.ts Pretrained browser inference adapter (on-demand)
tests/similarity.test.mjs     Visual search geometry, scoring, export and limits
src/GeoMap.tsx               MapLibre map, feature inspection and rectangle drawing
src/services/overpass.ts     Bounded live OSM service adapter and geometry utilities
src/types.ts                 Data types
src/styles.css               UI design and responsive styling
scripts/fetch_berlin.py      Small bounded WMS/WFS acquisition for demo assets
src/services/spatial.ts      Browser-side polygon-to-rectangle intersection
src/services/export.ts       Safe CSV output
src/services/annotations.ts Manual polygon/box label validation and GeoJSON import/export
tests/annotations.test.mjs  Annotation geometry, provenance, and import validation
scripts/run_building_inference.py   Optional CPU/GPU pretrained segmentation and vectorization
requirements-inference.txt    Optional standalone inference dependencies
tests/inference/              Offline geometry tests for inference outputs
tests/aoi.test.mjs          Offline AOI / Overpass shape tests
tests/spatial.test.mjs      Offline scope/filter/export tests
tests/test_fetch_berlin.py   Offline Python GIS tests
.github/workflows/pages.yml  Tests, geodata fetch, build and Pages deployment
```

## Development on Windows 10

The core dashboard needs no GPU or Docker. Python 3.12 and Node.js/npm are sufficient. Visual embedding search runs through ONNX Runtime Web, and will be slower on older CPU-only devices. Use a dedicated folder rather than `C:\Windows\System32`.

```bat
py -3.12 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt
python -m unittest discover -s tests -p "test_*.py" -v
python scripts\fetch_berlin.py
npm install
npm run test:geo
npm run dev
```

The app relies on generated assets under `public/data/`, which are created by the Python script or by the GitHub Actions workflow. Run `npm run build` to typecheck and bundle the production frontend.

## Deployment

On pushes to `main`, GitHub Actions tests the Python GIS utilities, retrieves Berlin reference data, installs frontend dependencies, runs AOI and annotation tests, builds the site and deploys `dist/` through GitHub Pages. In repository Settings → Pages, select **GitHub Actions** as the build source.

## Geospatial accuracy

- Features are counted when their polygons intersect the chosen rectangle or map viewport (rather than merely comparing bounding boxes). The geometry is not clipped.
- Area totals **sum complete source feature footprint areas**, even for features partly outside the selection. They are *not* clipped-area measurements or percentage-of-AOI coverage.
- Berlin ALKIS areas originate from projected geometry in EPSG:25833. OSM areas are approximate and separately attributed.
- Drawing an AOI anywhere outside the bundled Berlin sample cannot create new building data offline; the app reports no matching *loaded* features, not an absence of actual buildings.
- The map viewport filter refreshes on `moveend`. If live Overpass fails, the bundled ALKIS analysis remains functional.

## Limitations and engineering roadmap

- Live AOI queries depend on a public, third-party Overpass API. **Not suitable as a commercial-production dependency without a separately operated or contracted service.**
- GitHub Pages is a static host. It does not execute FastAPI, server-side Python processing or model training; the optional v0.7 browser-only visual encoder runs on the visitor device.
- The optional building-footprint segmentation workflow runs offline. The separate v0.7 visual-search preview performs limited image-embedding inference in the GitHub Pages browser after a user action, but does not predict segmentation masks. Validated solar/waste object detectors, online model training, authentication and persistent user projects are not yet implemented.
- Larger areas and reliable AI processing will require a backend, quotas, provenance, caching and an appropriate GPU strategy.
- Library licenses, basemap terms and dataset usage conditions should be rechecked before commercializing.

## Offline building detection (optional)

This phase introduces a **real, pretrained segmentation model** as an independently executed research workflow. The reference layers remain available even when model weights or compute are unavailable.

**Model:** [WHU Building Detection — UNet++ / EfficientNet-B4](https://huggingface.co/giswqs/whu-building-unetplusplus-efficientnet-b4) (Apache-2.0 model license; confirm imagery and training-data conditions before commercial use). The model was trained on WHU RGB aerial imagery at 0.3 m resolution; its performance on Berlin has **not yet been validated**.

1. Acquire the usual Berlin imagery and ALKIS reference dataset: `python scripts/fetch_berlin.py`.
2. On a Python 3.12 environment, install PyTorch using the [official instructions](https://pytorch.org/get-started/locally/) (CPU build is suitable for small samples), then `pip install -r requirements-inference.txt`.
3. Run `python scripts/run_building_inference.py --device cpu --threshold 0.5 --min-area 15`.
4. Verify the generated `public/data/ai_buildings.geojson` and `public/data/ai_metadata.json` files before publishing them. The script never manufactures predictions when inference fails.
5. Run `python -m unittest discover -s tests/inference -p 'test_*.py' -v` to check georeferencing/vectorization logic.

The initial model download is performed at inference time and stored outside Git. Its weight hash and exact resolved revision are recorded in output metadata. The output contains separate prediction polygons in EPSG:4326; areas are calculated in EPSG:25833. If ALKIS data is present, pixel-level IoU, precision and recall are recorded for the same study area. These describe agreement on one sample, not validated generalization to the whole city. Public deployments do **not** download model weights or run inference automatically. Generated output can be committed **after review**, at which point the dashboard exposes the orange prediction overlay. The default map remains reference-only.

### Planned LiDAR / multimodal track

Dense airborne LiDAR is available in many regions but not every city. We plan a catalog-driven source adapter for small AOI-based LAZ/COPC/EPT downloads, including point density, classification, coordinate reference system, acquisition date, usage license and source attribution. Possible sources include [Berlin ALS](https://www.govdata.de/suche/daten/airborne-laserscanning-als-primare-3d-laserscan-daten), [USGS 3DEP](https://registry.opendata.aws/usgs-lidar/), [swissSURFACE3D](https://www.swisstopo.admin.ch/en/height-model-swisssurface3d), [AHN Netherlands](https://www.ahn.nl/dataroom), and [IGN LiDAR HD France](https://www.data.gouv.fr/datasets/nuages-de-points-lidar-hd).

Pretrained 3D options include [Point2Building](https://github.com/prs-eth/point2building) for 3D reconstruction, [3dsem](https://pypi.org/project/3dsem/) for point-wise building-class segmentation, and [P³](https://github.com/raphaelsulzer/PixelsPointsPolygons) for 2D polygon prediction with imagery, LiDAR or fusion. P³ pretrained weights have an **academic/non-commercial** license; those weights will not be integrated into a commercial offering without permission. Until actual availability, licensing, compute and cross-city accuracy are verified, these remain future integrations rather than advertised production features.

## Repository Standards

This repository contains application source code, automated tests, configuration files, and technical documentation required for development, maintenance, and deployment.

Internal working documents, confidential information, credentials, and unrelated files are maintained separately from the public codebase.

The `.gitignore` configuration helps prevent unnecessary or sensitive files from being tracked. Files previously committed must be removed from Git tracking separately. Removing a file in a later commit does not automatically remove it from the repository's history.
