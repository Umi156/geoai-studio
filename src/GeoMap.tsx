import { useEffect, useRef } from 'react';
import maplibregl, { Map, Popup } from 'maplibre-gl';
import type { BuildingCollection, BuildingFeature, DatasetMeta } from './types';

const baseStyle = 'https://tiles.openfreemap.org/styles/positron';

type Props = {
  meta: DatasetMeta;
  buildings: BuildingCollection;
  showOrthophoto: boolean;
  showBuildings: boolean;
  opacity: number;
  minArea: number;
  selectedId: number | null;
  resetToken: number;
  focusToken: number;
  expanded: boolean;
  onSelect: (feature: BuildingFeature | null) => void;
};

export default function GeoMap({ meta, buildings, showOrthophoto, showBuildings, opacity, minArea, selectedId, resetToken, focusToken, expanded, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const selectedHandler = useRef(onSelect);
  const popupRef = useRef<Popup | null>(null);
  selectedHandler.current = onSelect;

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
    map.on('load', () => {
      map.addSource('aerial', { type: 'image', url: `${import.meta.env.BASE_URL}data/berlin_orthophoto.png`, coordinates: meta.image_corners as [[number, number], [number, number], [number, number], [number, number]] });
      map.addLayer({ id: 'aerial-layer', type: 'raster', source: 'aerial', paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } });
      // Distinguish the finite, downloaded orthophoto from the surrounding basemap.
      const [nw, ne, se, sw] = meta.image_corners;
      map.addSource('image-extent', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[nw, ne, se, sw, nw]] } } });
      map.addLayer({ id: 'image-extent-line', type: 'line', source: 'image-extent', paint: { 'line-color': '#f8c970', 'line-width': 2, 'line-dasharray': [3, 3], 'line-opacity': 0.92 } });
      map.addSource('buildings', { type: 'geojson', data: buildings, promoteId: 'fid' });
      map.addLayer({ id: 'buildings-fill', type: 'fill', source: 'buildings', paint: {
        'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#fcd34d', '#22d3ee'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.67, 0.30],
      }});
      map.addLayer({ id: 'buildings-line', type: 'line', source: 'buildings', paint: { 'line-color': '#67e8f9', 'line-width': 1.8 } });
      map.addLayer({ id: 'buildings-selected', type: 'line', source: 'buildings', filter: ['==', ['get', 'fid'], -1], paint: { 'line-color': '#ffde59', 'line-width': 4 } });
      const bbox = meta.image_corners;
      map.fitBounds([
        [Math.min(...bbox.map(p => p[0])), Math.min(...bbox.map(p => p[1]))],
        [Math.max(...bbox.map(p => p[0])), Math.max(...bbox.map(p => p[1]))],
      ], { padding: 74, duration: 0, maxZoom: 18.5 });
      let hovered: number | null = null;
      map.on('mousemove', 'buildings-fill', e => {
        const feature = e.features?.[0];
        if (!feature) return;
        const id = Number(feature.properties?.fid);
        if (hovered !== null && hovered !== id) map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
        hovered = id;
        map.setFeatureState({ source: 'buildings', id }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';
        popupRef.current?.remove();
        const el = document.createElement('div');
        el.className = 'map-tooltip';
        const title = document.createElement('strong');
        title.textContent = `Building #${id}`;
        const detail = document.createElement('span');
        detail.textContent = `${Number(feature.properties?.area_m2 ?? 0).toLocaleString()} m² · official footprint`;
        el.append(title, detail);
        popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 12 }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      });
      map.on('mouseleave', 'buildings-fill', () => {
        if (hovered !== null) map.setFeatureState({ source: 'buildings', id: hovered }, { hover: false });
        hovered = null;
        popupRef.current?.remove();
        map.getCanvas().style.cursor = '';
      });
      map.on('click', 'buildings-fill', e => {
        const id = Number(e.features?.[0]?.properties?.fid);
        selectedHandler.current(buildings.features.find(f => f.properties.fid === id) ?? null);
      });
    });
    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; };
    // Map created only when the dataset changes, not on every UI control update.
  }, [meta, buildings]);

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
    ['buildings-fill', 'buildings-line', 'buildings-selected'].forEach(layer => map.setLayoutProperty(layer, 'visibility', showBuildings ? 'visible' : 'none'));
    const filter: ['>=', ['get', 'area_m2'], number] = ['>=', ['get', 'area_m2'], minArea];
    map.setFilter('buildings-fill', filter);
    map.setFilter('buildings-line', filter);
  }, [showBuildings, minArea]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('buildings-selected')) return;
    map.setFilter('buildings-selected', ['==', ['get', 'fid'], selectedId ?? -1]);
  }, [selectedId]);

  useEffect(() => {
    if (resetToken === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const bbox = meta.image_corners;
    map.fitBounds([
      [Math.min(...bbox.map(p => p[0])), Math.min(...bbox.map(p => p[1]))],
      [Math.max(...bbox.map(p => p[0])), Math.max(...bbox.map(p => p[1]))],
    ], { padding: 50, duration: 500, maxZoom: 18.5 });
  }, [resetToken, meta]);

  useEffect(() => {
    if (focusToken === 0 || selectedId === null) return;
    const map = mapRef.current;
    const feature = buildings.features.find(f => f.properties.fid === selectedId);
    if (!map || !feature) return;
    const bounds = new maplibregl.LngLatBounds();
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polygons.forEach(polygon => polygon.forEach(ring => ring.forEach(point => bounds.extend([point[0], point[1]]))));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 100, duration: 500, maxZoom: 19 });
  }, [focusToken, selectedId, buildings]);

  useEffect(() => {
    // Layout mode changes map container dimensions without resizing the browser window.
    const map = mapRef.current;
    if (!map) return;
    const frame = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  return <div ref={container} className="map-canvas" aria-label="Interactive Berlin aerial imagery and ALKIS building map"/>;
}
