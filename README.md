# GeoAI Studio — automatic open-data GIS dashboard starter

> **Status:** research-grade starter, not a deployed platform or an AI detection service. The map uses **official reference footprints**, not model predictions.

This repository is a zero-budget, GitHub Pages-ready demonstration of the **GeoAI-first** architecture. It includes a Python acquisition script that fetches a tiny portion of Berlin aerial imagery and matching cadastral building data automatically, plus an interactive React/MapLibre dashboard for exploration.

## Data automatically downloaded (no manual file picker)

| Layer | Service | Format | Use |
|---|---|---|---|
| Berlin DOP 2025 orthophotos | [`WMS / dop_2025_fruehjahr`](https://gdi.berlin.de/services/wms/dop_2025_fruehjahr) | PNG (small 1024×1024) | Map imagery overlay |
| ALKIS Berlin Gebäude | [`WFS / alkis_gebaeude`](https://gdi.berlin.de/services/wfs/alkis_gebaeude) | GeoJSON | Building reference polygons |

Both referenced Berlin datasets list the `dl-de/zero-2-0` license. Display attribution in the UI regardless. External provider services can change, throttle, or be offline: there is **no fake fallback dataset**.

Data is requested for a **200 × 200 metre** AOI in EPSG:25833, not an entire Berlin city download. The script enforces a maximum **300 × 300 metre** AOI and 12 MB per response, caches output, validates PNG and GeoJSON, and does not touch files outside `public/data/`.

## Before starting

- The computer owner has irreplaceable data without a full backup. **Do not reinstall Windows, repartition drives, or perform recursive cleanup.**
- Ensure the project folder is on a drive with sufficient free space. No administrator privileges required.
- Windows 10, Python 3.12, and a compatible Node.js/npm installation are required for the local React development option.
- No GPU, Docker, WSL, database or API key is required for this stage.

## Local Windows setup (CMD, when you explicitly decide to start)

Do not run these commands in `C:\Windows\System32`. Extract the project ZIP into a dedicated folder with enough free space, then enter that folder.

```bat
py -3.12 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python scripts\fetch_berlin.py
npm install
npm run dev
```

Open the local URL printed by Vite (commonly `http://localhost:5173/`).

To refresh data deliberately:

```bat
python scripts\fetch_berlin.py --force
```

## GitHub Pages deployment

Create a **public** GitHub repository, push these files to its `main` branch, and enable Pages in GitHub repository settings using **GitHub Actions** as the source. The included `.github/workflows/pages.yml` will:

1. Set up Python 3.12 on a GitHub-hosted runner.
2. Install small Python geospatial dependencies.
3. Call the official Berlin WMS and WFS automatically.
4. Validate and prepare map assets without a manual upload.
5. Build the React/Vite application.
6. Deploy the built static site to GitHub Pages.

The default GitHub-hosted runner is external to your laptop. This avoids downloading imagery on your PC during a cloud build. GitHub Pages **does not run Python or real-time AI inference**. A backend will be a separate later milestone.

**Notice:** This action downloads from Berlin's servers on each build; push responsibly. You can move data refresh to manual runs and commit small, licensed assets after validation. Publishing may be blocked by GitHub account or Pages settings. Nothing is published automatically until you configure your repository.

## Interaction inventory

- Hover over polygons for footprint area and building ID.
- Click a polygon to open the feature inspector.
- Change aerial image opacity.
- Show/hide imagery and building layers.
- Filter polygons by their minimum footprint area.
- Read dynamic KPI cards and an area-distribution chart.
- Search by building ID.
- Download filtered results as GeoJSON.
- Inspect source provenance and license.
- Switch to solar/waste concept pages (clearly marked as future modules).

## Code architecture

```text
scripts/fetch_berlin.py    Fetch WMS/WFS, transform CRS, compute areas, cache assets
src/GeoMap.tsx             MapLibre base map and raster/vector overlays
src/App.tsx                Interactions, filters, inspector, chart and downloads
src/types.ts               Typed data interface
src/styles.css             Dashboard design system
public/data/              Generated small study-area assets
.github/workflows/pages.yml GitHub build and deployment
```

## What this does NOT implement yet

- No real detection or segmentation inference.
- No custom model training.
- No imagery uploaded by end users.
- No Supabase, PostGIS or FastAPI backend.
- No change detection or monitoring schedules.
- No promise of arbitrary AOI support beyond a small Berlin sample.

These features belong to later development phases. Keep the frontend/data contract stable as they are implemented.

## Licenses and provenance

- DOP20RGBI Berlin 2025 dataset: https://daten.berlin.de/datensaetze/digitale-farbige-orthophotos-2025-dop20rgbi-wms-6529de5a
- ALKIS buildings dataset: https://daten.berlin.de/datensaetze/alkis-berlin-gebaude-wfs-728b368a
- Berlin license: https://www.govdata.de/dl-de/zero-2-0
- Map tiles: OpenFreeMap, https://openfreemap.org/ ; based on OpenStreetMap contributors.

Data was **not bundled** in this ZIP, because external requests are unavailable in the authoring runtime. The download script has offline tests, but live WMS/WFS connectivity must be verified when you run it or on GitHub Actions.
