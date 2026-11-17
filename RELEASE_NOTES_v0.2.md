# GeoAI Studio — v0.2 UI/UX update

This is a **patch** for the existing project at https://github.com/Umi156/geoai-studio.

## Changes

- Feature inspector moved from a clipped map overlay into the right control column.
- Yellow dashed outline defines the **actual 200 × 200 m orthophoto coverage**. Basemap still extends beyond it.
- `Reset view` fits the map to the downloaded study area.
- `Expand` enlarges the map without hiding data or installing a backend.
- Clicking a building in search results fits the map to the selected geometry.
- Footprint distribution uses a count-based histogram, not a smoothed area chart.
- Panel labels clarify that area statistics describe the filtered dataset, not the current viewport.
- Reset filters restores the full building list.
- The About dialog explains why ALKIS polygons may extend beyond the orthophoto.

## How to apply

1. Extract this ZIP.
2. In GitHub Desktop select **Repository > Show in Explorer**.
3. Copy the **src** folder from this archive into your existing repository, replacing only the three matching source files (`App.tsx`, `GeoMap.tsx`, `styles.css`).
4. Confirm `src/vite-env.d.ts` and `tsconfig.json` remain unchanged.
5. In GitHub Desktop commit with summary `Improve map interactions and dashboard UX (v0.2)` and click **Push origin**.
6. Watch the newest GitHub Actions deployment.

No paid infrastructure, GPU, new dataset or Python installation is needed for this UI patch.

## Verification

- Six existing offline Python geospatial tests pass.
- Browser and TypeScript production build not independently verified in this environment (node modules unavailable).
- Live end-to-end GitHub Pages behavior must be confirmed after deployment.

## Future improvements (not included)

- Area-of-interest drawing and on-demand imagery requests
- Continuous orthophoto layers (subject to provider permissions, licensing and load limits)
- Viewport-based counts and spatial filtering
- Actual model-generated detection layer separate from official ALKIS reference features
