import { useEffect, useRef } from 'react';
import maplibregl, { Map, Popup, LngLatBounds } from 'maplibre-gl';
import type { GeoJSONSource, LngLat } from 'maplibre-gl';
import type { AoiBounds } from './services/overpass';
import type { BuildingCollection, BuildingFeature, DatasetMeta } from './types';
import { imageExtent, insideImage, makeRing } from './services/annotations';
import type { Annotation, DrawingShape, Position } from './services/annotations';

const baseStyle = 'https://tiles.openfreemap.org/styles/positron';
const emptyFeatureCollection = { type: 'FeatureCollection' as const, features: [] };

function rectangleCoordinates(bounds: AoiBounds): [number, number][][] {
  return [[
    [bounds.west, bounds.south], [bounds.east, bounds.south],
    [bounds.east, bounds.north], [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ]];
}

function aoiFeature(bounds: AoiBounds | null) {
  if (!bounds) return emptyFeatureCollection;
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: rectangleCoordinates(bounds) } };
}

function fromCorners(a: LngLat, b: LngLat): AoiBounds {
  return { west: Math.min(a.lng, b.lng), east: Math.max(a.lng, b.lng), south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat) };
}

function fitImage(map: Map, meta: DatasetMeta, duration = 0) {
  const coordinates = meta.image_corners;
  map.fitBounds([
    [Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1]))],
    [Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))],
  ], { padding: 55, duration, maxZoom: 18.5 });
}

type Props = {
  meta: DatasetMeta;
  buildings: BuildingCollection;
  predictions: BuildingCollection | null;
  showPredictions: boolean;
  showOrthophoto: boolean;
  showBuildings: boolean;
  opacity: number;
  minArea: number;
  selectedId: number | null;
  resetToken: number;
  focusToken: number;
  expanded: boolean;
  sourceMode: 'alkis' | 'osm';
  aoi: AoiBounds | null;
  drawingAoi: boolean;
  onAoiChange: (bounds: AoiBounds) => void;
  onCancelDrawing: () => void;
  onSelect: (feature: BuildingFeature | null) => void;
  onBoundsChange: (bounds: AoiBounds) => void;
  annotations: Annotation[];
  annotationMode: DrawingShape | null;
  selectedAnnotationId: string | null;
  onAnnotationCreate: (ring: Position[], shape: DrawingShape) => void;
  onAnnotationSelect: (id: string) => void;
  onAnnotationCancel: () => void;
  onAnnotationError: (message: string) => void;
};

export default function GeoMap({
  meta, buildings, predictions, showPredictions, showOrthophoto, showBuildings, opacity, minArea, selectedId,
  resetToken, focusToken, expanded, sourceMode, aoi, drawingAoi,
  onAoiChange, onCancelDrawing, onSelect, onBoundsChange,
  annotations, annotationMode, selectedAnnotationId, onAnnotationCreate, onAnnotationSelect, onAnnotationCancel, onAnnotationError,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const firstCorner = useRef<LngLat | null>(null);
  const annotationPoints = useRef<Position[]>([]);
  const annotationRef = useRef(annotations);
  const annotationModeRef = useRef(annotationMode);
  const selectedAnnotationRef = useRef(selectedAnnotationId);
  const imageBounds = imageExtent(meta.image_corners);
  const buildingRef = useRef(buildings);
  const predictionRef = useRef(predictions);
  const showPredictionsRef = useRef(showPredictions);
  const aoiRef = useRef(aoi);
  const drawingRef = useRef(drawingAoi);
  const handlersRef = useRef({ onSelect, onAoiChange, onCancelDrawing, onBoundsChange, onAnnotationCreate, onAnnotationSelect, onAnnotationCancel, onAnnotationError });
  const settingsRef = useRef({ showOrthophoto, showBuildings, opacity, minArea, selectedId, sourceMode });
  buildingRef.current = buildings;
  predictionRef.current = predictions;
  showPredictionsRef.current = showPredictions;
  aoiRef.current = aoi;
  drawingRef.current = drawingAoi;
  annotationRef.current = annotations;
  annotationModeRef.current = annotationMode;
  selectedAnnotationRef.current = selectedAnnotationId;
  handlersRef.current = { onSelect, onAoiChange, onCancelDrawing, onBoundsChange, onAnnotationCreate, onAnnotationSelect, onAnnotationCancel, onAnnotationError };
  settingsRef.current = { showOrthophoto, showBuildings, opacity, minArea, selectedId, sourceMode };

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: baseStyle,
      center: meta.center,
      zoom: 17.3,
      maxPitch: 65,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    const clearAnnotationDraft = () => {
      annotationPoints.current = [];
      (map.getSource('annotation-draft') as GeoJSONSource | undefined)?.setData(emptyFeatureCollection);
    };
    const finishAnnotation = () => {
      if (annotationModeRef.current !== 'polygon') return;
      try {
        const ring = makeRing(annotationPoints.current, 'polygon', imageBounds);
        handlersRef.current.onAnnotationCreate(ring, 'polygon');
        clearAnnotationDraft();
      } catch (error) {
        handlersRef.current.onAnnotationError(error instanceof Error ? error.message : 'Invalid polygon.');
      }
    };
    const stopDrawing = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && annotationModeRef.current === 'polygon') {
        if (!(event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName))) {
          event.preventDefault(); finishAnnotation();
        }
      }
      if (event.key !== 'Escape') return;
      if (annotationModeRef.current) {
        clearAnnotationDraft(); handlersRef.current.onAnnotationCancel(); return;
      }
      if (drawingRef.current) {
        firstCorner.current = null;
        (map.getSource('aoi-preview') as GeoJSONSource | undefined)?.setData(emptyFeatureCollection);
        handlersRef.current.onCancelDrawing();
      }
    };
    window.addEventListener('keydown', stopDrawing);

    const notifyViewport = () => {
      const b = map.getBounds();
      handlersRef.current.onBoundsChange({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    };
    map.on('moveend', notifyViewport);
    map.on('load', () => {
      const settings = settingsRef.current;
      map.addSource('aerial', {
        type: 'image',
        url: `${import.meta.env.BASE_URL}data/berlin_orthophoto.png`,
        coordinates: meta.image_corners as [[number, number], [number, number], [number, number], [number, number]],
      });
      map.addLayer({ id: 'aerial-layer', type: 'raster', source: 'aerial',
        layout: { visibility: settings.showOrthophoto ? 'visible' : 'none' },
        paint: { 'raster-opacity': settings.opacity, 'raster-fade-duration': 0 },
      });

      const [nw, ne, se, sw] = meta.image_corners;
      map.addSource('image-extent', { type: 'geojson', data: {
        type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[nw, ne, se, sw, nw]] },
      } });
      map.addLayer({ id: 'image-extent-line', type: 'line', source: 'image-extent',
        layout: { visibility: settings.showOrthophoto ? 'visible' : 'none' },
        paint: { 'line-color': '#f8c970', 'line-width': 2, 'line-dasharray': [3, 3], 'line-opacity': 0.9 },
      });

      map.addSource('aoi-preview', { type: 'geojson', data: emptyFeatureCollection });
      map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi-preview', paint: { 'fill-color': '#57a8e6', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'aoi-outline', type: 'line', source: 'aoi-preview', paint: { 'line-color': '#e4f8fe', 'line-width': 2.4, 'line-dasharray': [2, 1.5] } });
      (map.getSource('aoi-preview') as GeoJSONSource).setData(aoiFeature(aoiRef.current));

      map.addSource('manual-annotations', { type: 'geojson', data: { type: 'FeatureCollection', features: annotationRef.current } });
      map.addLayer({ id: 'manual-annotations-fill', type: 'fill', source: 'manual-annotations',
        paint: { 'fill-color': ['match', ['get', 'status'], 'accepted', '#34d399', 'rejected', '#94a3b8', '#a78bfa'], 'fill-opacity': 0.20 },
      });
      map.addLayer({ id: 'manual-annotations-lines', type: 'line', source: 'manual-annotations',
        paint: { 'line-color': ['case', ['==', ['get', 'annotation_id'], selectedAnnotationRef.current ?? ''], '#f8fafc', ['match', ['get', 'status'], 'accepted', '#34d399', 'rejected', '#94a3b8', '#a78bfa']], 'line-width': 3 },
      });
      map.addSource('annotation-draft', { type: 'geojson', data: emptyFeatureCollection });
      map.addLayer({ id: 'annotation-draft-fill', type: 'fill', source: 'annotation-draft', paint: { 'fill-color': '#e879f9', 'fill-opacity': 0.20 } });
      map.addLayer({ id: 'annotation-draft-line', type: 'line', source: 'annotation-draft', paint: { 'line-color': '#f0abfc', 'line-width': 2.5, 'line-dasharray': [3, 1] } });
      map.addLayer({ id: 'annotation-draft-point', type: 'circle', source: 'annotation-draft', paint: { 'circle-color': '#f0abfc', 'circle-radius': 5 } });
      map.on('click', 'manual-annotations-fill', e => {
        if (annotationModeRef.current || drawingRef.current) return;
        const id = e.features?.[0]?.properties?.annotation_id;
        if (typeof id === 'string') handlersRef.current.onAnnotationSelect(id);
      });

      map.addSource('buildings', { type: 'geojson', data: buildingRef.current, promoteId: 'fid' });
      map.addLayer({ id: 'buildings-fill', type: 'fill', source: 'buildings',
        layout: { visibility: settings.showBuildings ? 'visible' : 'none' },
        filter: ['>=', ['get', 'area_m2'], settings.minArea],
        paint: {
          'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffe58a', settings.sourceMode === 'osm' ? '#9a90f7' : '#22d3ee'],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.65, 0.30],
        },
      });
      map.addLayer({ id: 'buildings-line', type: 'line', source: 'buildings',
        layout: { visibility: settings.showBuildings ? 'visible' : 'none' },
        filter: ['>=', ['get', 'area_m2'], settings.minArea],
        paint: { 'line-color': settings.sourceMode === 'osm' ? '#c4b5fd' : '#67e8f9', 'line-width': 1.8 },
      });
      map.addLayer({ id: 'buildings-selected', type: 'line', source: 'buildings',
        layout: { visibility: settings.showBuildings ? 'visible' : 'none' },
        filter: ['==', ['get', 'fid'], settings.selectedId ?? -1],
        paint: { 'line-color': '#ffde59', 'line-width': 4 },
      });
      map.addSource('model-predictions', { type: 'geojson', data: predictionRef.current ?? emptyFeatureCollection });
      map.addLayer({ id: 'model-predictions-fill', type: 'fill', source: 'model-predictions',
        layout: { visibility: showPredictionsRef.current ? 'visible' : 'none' },
        paint: { 'fill-color': '#fb923c', 'fill-opacity': 0.14 },
      });
      map.addLayer({ id: 'model-predictions-line', type: 'line', source: 'model-predictions',
        layout: { visibility: showPredictionsRef.current ? 'visible' : 'none' },
        paint: { 'line-color': '#fb923c', 'line-width': 2.5, 'line-dasharray': [2, 1] },
      });
      // Keep annotation geometry above reference and prediction layers for editing.
      for (const id of ['manual-annotations-fill', 'manual-annotations-lines', 'annotation-draft-fill', 'annotation-draft-line', 'annotation-draft-point']) map.moveLayer(id);
      fitImage(map, meta);
      notifyViewport();
      let hovered: number | null = null;
      map.on('mousemove', 'buildings-fill', e => {
        if (drawingRef.current || annotationModeRef.current) return;
        const feature = e.features?.[0];
        if (!feature) return;
        const id = Number(feature.properties?.fid);
        if (!Number.isFinite(id)) return;
        if (hovered !== null && hovered !== id) map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
        hovered = id;
        map.setFeatureState({ source: 'buildings', id }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';
        popupRef.current?.remove();
        const el = document.createElement('div');
        el.className = 'map-tooltip';
        const title = document.createElement('strong');
        title.textContent = settingsRef.current.sourceMode === 'osm' ? `OSM way #${id}` : `ALKIS building #${id}`;
        const detail = document.createElement('span');
        detail.textContent = `${Number(feature.properties?.area_m2 ?? 0).toLocaleString()} m² · ${settingsRef.current.sourceMode === 'osm' ? 'OSM approximate area' : 'official footprint'}`;
        el.append(title, detail);
        popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 12 }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      });
      map.on('mouseleave', 'buildings-fill', () => {
        if (hovered !== null) map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
        hovered = null;
        popupRef.current?.remove();
        map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '';
      });
      map.on('click', 'buildings-fill', e => {
        if (drawingRef.current || annotationModeRef.current) return;
        // A manual annotation is a separate, higher-priority editable layer.
        if (map.queryRenderedFeatures(e.point, { layers: ['manual-annotations-fill'] }).length) return;
        const id = Number(e.features?.[0]?.properties?.fid);
        handlersRef.current.onSelect(buildingRef.current.features.find(f => f.properties.fid === id) ?? null);
      });
    });

    // Two-click rectangle selection is compatible with mouse, touch and trackpads.
    const updateAnnotationPreview = (pointer?: Position) => {
      const pts = [...annotationPoints.current];
      if (pointer) pts.push(pointer);
      const mode = annotationModeRef.current;
      let feature: object | null = null;
      if (mode === 'box' && pts.length >= 2) {
        try { feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [makeRing([pts[0], pts[pts.length - 1]], 'box', imageBounds)] } }; } catch { /* ignore zero-size preview */ }
      } else if (mode === 'polygon' && pts.length >= 3) {
        feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } };
      } else if (pts.length >= 2) feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } };
      else if (pts.length === 1) feature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pts[0] } };
      (map.getSource('annotation-draft') as GeoJSONSource | undefined)?.setData(feature ? { type: 'FeatureCollection', features: [feature] } as never : emptyFeatureCollection);
    };
    map.on('dblclick', e => {
      if (annotationModeRef.current === 'polygon') { e.preventDefault(); finishAnnotation(); }
    });
    map.on('click', e => {
      if (annotationModeRef.current) {
        const point: Position = [e.lngLat.lng, e.lngLat.lat];
        if (!insideImage(point, imageBounds)) { handlersRef.current.onAnnotationError('Select only inside the yellow imagery boundary.'); return; }
        annotationPoints.current.push(point);
        if (annotationModeRef.current === 'box' && annotationPoints.current.length === 2) {
          try {
            const ring = makeRing(annotationPoints.current, 'box', imageBounds);
            handlersRef.current.onAnnotationCreate(ring, 'box');
            clearAnnotationDraft();
          } catch (err) {
            handlersRef.current.onAnnotationError(err instanceof Error ? err.message : 'Invalid box.');
            clearAnnotationDraft();
          }
        } else updateAnnotationPreview();
        return;
      }
      if (!drawingRef.current) return;
      if (!firstCorner.current) { firstCorner.current = e.lngLat; return; }
      const bounds = fromCorners(firstCorner.current, e.lngLat);
      firstCorner.current = null;
      handlersRef.current.onAoiChange(bounds);
    });
    map.on('mousemove', e => {
      if (annotationModeRef.current && annotationPoints.current.length) {
        const pointer: Position = [e.lngLat.lng, e.lngLat.lat];
        updateAnnotationPreview(insideImage(pointer, imageBounds) ? pointer : undefined);
        return;
      }
      if (!drawingRef.current || !firstCorner.current) return;
      (map.getSource('aoi-preview') as GeoJSONSource | undefined)
        ?.setData(aoiFeature(fromCorners(firstCorner.current, e.lngLat)));
    });
    return () => {
      window.removeEventListener('keydown', stopDrawing);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [meta]);

  useEffect(() => {
    const map = mapRef.current;
    (map?.getSource('model-predictions') as GeoJSONSource | undefined)?.setData(predictions ?? emptyFeatureCollection);
  }, [predictions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const name of ['model-predictions-fill', 'model-predictions-line']) {
      if (map.getLayer(name)) map.setLayoutProperty(name, 'visibility', showPredictions ? 'visible' : 'none');
    }
  }, [showPredictions]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('buildings') as GeoJSONSource | undefined;
    source?.setData(buildings);
  }, [buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('aerial-layer')) return;
    map.setLayoutProperty('aerial-layer', 'visibility', showOrthophoto ? 'visible' : 'none');
    map.setPaintProperty('aerial-layer', 'raster-opacity', opacity);
    if (map.getLayer('image-extent-line')) map.setLayoutProperty('image-extent-line', 'visibility', showOrthophoto ? 'visible' : 'none');
  }, [showOrthophoto, opacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('buildings-fill')) return;
    for (const layer of ['buildings-fill', 'buildings-line', 'buildings-selected']) {
      map.setLayoutProperty(layer, 'visibility', showBuildings ? 'visible' : 'none');
    }
    const filter: ['>=', ['get', 'area_m2'], number] = ['>=', ['get', 'area_m2'], minArea];
    map.setFilter('buildings-fill', filter);
    map.setFilter('buildings-line', filter);
    map.setPaintProperty('buildings-fill', 'fill-color', ['case', ['boolean', ['feature-state', 'hover'], false], '#ffe58a', sourceMode === 'osm' ? '#9a90f7' : '#22d3ee']);
    map.setPaintProperty('buildings-line', 'line-color', sourceMode === 'osm' ? '#c4b5fd' : '#67e8f9');
  }, [showBuildings, minArea, sourceMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('buildings-selected')) return;
    map.setFilter('buildings-selected', ['==', ['get', 'fid'], selectedId ?? -1]);
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    (map?.getSource('manual-annotations') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: annotations });
  }, [annotations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('manual-annotations-lines')) return;
    map.setPaintProperty('manual-annotations-lines', 'line-color', ['case', ['==', ['get', 'annotation_id'], selectedAnnotationId ?? ''], '#f8fafc', ['match', ['get', 'status'], 'accepted', '#34d399', 'rejected', '#94a3b8', '#a78bfa']]);
  }, [selectedAnnotationId]);

  useEffect(() => {
    const map = mapRef.current;
    annotationPoints.current = [];
    (map?.getSource('annotation-draft') as GeoJSONSource | undefined)?.setData(emptyFeatureCollection);
    if (map) {
      map.getCanvas().style.cursor = drawingAoi || annotationMode ? 'crosshair' : '';
      if (annotationMode === 'polygon') map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    }
  }, [annotationMode, drawingAoi]);

  useEffect(() => {
    if (drawingAoi) {
      firstCorner.current = null;
      popupRef.current?.remove();
    }
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = drawingAoi || !!annotationMode ? 'crosshair' : '';
    if (!drawingAoi) (map?.getSource('aoi-preview') as GeoJSONSource | undefined)?.setData(aoiFeature(aoi));
  }, [drawingAoi, aoi, annotationMode]);

  useEffect(() => {
    const map = mapRef.current;
    (map?.getSource('aoi-preview') as GeoJSONSource | undefined)?.setData(aoiFeature(aoi));
  }, [aoi]);

  useEffect(() => {
    if (!selectedAnnotationId) return;
    const map = mapRef.current;
    const chosen = annotations.find(item => item.id === selectedAnnotationId);
    if (!map || !chosen) return;
    const bounds = new LngLatBounds();
    chosen.geometry.coordinates[0].forEach(point => bounds.extend(point));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 85, duration: 350, maxZoom: 19.2 });
  }, [selectedAnnotationId, annotations]);

  useEffect(() => {
    if (!resetToken) return;
    const map = mapRef.current;
    if (map) fitImage(map, meta, 500);
  }, [resetToken, meta]);

  useEffect(() => {
    if (!focusToken || selectedId === null) return;
    const map = mapRef.current;
    const feature = buildings.features.find(f => f.properties.fid === selectedId);
    if (!map || !feature) return;
    const bounds = new LngLatBounds();
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polygons.forEach(polygon => polygon.forEach(ring => ring.forEach(point => bounds.extend([point[0], point[1]]))));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 100, duration: 500, maxZoom: 19 });
  }, [focusToken, selectedId, buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  return <div ref={container} className="map-canvas" aria-label="Interactive geospatial map with AOI selection and manual imagery annotations"/>;
}
