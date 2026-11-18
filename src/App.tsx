import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowDownToLine, BarChart3, Building2, Check, ChevronDown, CircleHelp, Database, ExternalLink, Layers, Leaf, Map as MapIcon, Maximize2, Menu, Crosshair, MousePointer2, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Sun, X, Pencil, Square, Pentagon, Upload, Trash2, CheckCircle2, XCircle, Save } from 'lucide-react';
import GeoMap from './GeoMap';
import ObjectDetectionStudio from './ObjectDetectionStudio';
import type { BuildingCollection, BuildingFeature, DatasetMeta } from './types';
import { fetchOsmBuildings, inspectAoi, OVERPASS_SERVICES } from './services/overpass';
import type { AoiBounds, OverpassProvider } from './services/overpass';
import { filterBuildings } from './services/spatial';
import type { SpatialScope } from './services/spatial';
import { buildingCsv } from './services/export';
import { exportAnnotations, imageExtent, importAnnotationText, makeRing, newAnnotation, normalizedClass, storageKey, MAX_ANNOTATIONS } from './services/annotations';
import type { Annotation, DrawingShape, AnnotationStatus, Position } from './services/annotations';

type ModuleName = 'buildings' | 'solar' | 'waste';
const modules: { id: ModuleName; title: string; subtitle: string; icon: typeof Building2; ready: boolean }[] = [
  { id: 'buildings', title: 'Urban Intelligence', subtitle: 'Building footprint analytics', icon: Building2, ready: true },
  { id: 'solar', title: 'Solar Intelligence', subtitle: 'Roof-mounted photovoltaics', icon: Sun, ready: false },
  { id: 'waste', title: 'Environmental Monitor', subtitle: 'Waste-site change analysis', icon: Leaf, ready: false },
];
const areaBuckets = [
  { label: '0–50', low: 0, high: 50 }, { label: '50–100', low: 50, high: 100 },
  { label: '100–200', low: 100, high: 200 }, { label: '200–500', low: 200, high: 500 },
  { label: '500+', low: 500, high: Infinity },
];
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');

function exportGeoJSON(features: BuildingFeature[], source: 'alkis' | 'osm', scope: SpatialScope) {
  const attribution = source === 'osm' ? '© OpenStreetMap contributors · ODbL 1.0' : 'Geoportal Berlin · dl-de/zero-2-0';
  const contents = JSON.stringify({ type: 'FeatureCollection', features, metadata: { attribution, license_url: source === 'osm' ? 'https://www.openstreetmap.org/copyright' : 'https://www.govdata.de/dl-de/zero-2-0', data_type: source === 'osm' ? 'community mapping, not AI predictions' : 'official reference, not AI predictions', spatial_scope: scope, clipping: 'full feature geometries, features selected by intersection' } }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url; a.download = source === 'osm' ? 'osm_aoi_buildings.geojson' : 'berlin_alkis_buildings.geojson'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(contents: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [geo, setGeo] = useState<BuildingCollection | null>(null);
  const [osmGeo, setOsmGeo] = useState<BuildingCollection | null>(null);
  const [predictions, setPredictions] = useState<BuildingCollection | null>(null);
  const [predictionMeta, setPredictionMeta] = useState<{ model: string; validation_status: string; predicted_features: number } | null>(null);
  const [showPredictions, setShowPredictions] = useState(false);
  const [sourceMode, setSourceMode] = useState<'alkis' | 'osm'>('alkis');
  const [aoi, setAoi] = useState<AoiBounds | null>(null);
  const [viewport, setViewport] = useState<AoiBounds | null>(null);
  const [spatialScope, setSpatialScope] = useState<SpatialScope>('dataset');
  const [drawingAoi, setDrawingAoi] = useState(false);
  const [osmStatus, setOsmStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [osmProvider, setOsmProvider] = useState<OverpassProvider>('fossgis');
  const [osmError, setOsmError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState<ModuleName>('buildings');
  const [workspace, setWorkspace] = useState<'explorer' | 'detection'>('detection');
  const [ortho, setOrtho] = useState(true);
  const [footprints, setFootprints] = useState(true);
  const [opacity, setOpacity] = useState(0.96);
  const [minArea, setMinArea] = useState(0);
  const [selected, setSelected] = useState<BuildingFeature | null>(null);
  const [search, setSearch] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapResetToken, setMapResetToken] = useState(0);
  const [locateToken, setLocateToken] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsLoaded, setAnnotationsLoaded] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<DrawingShape | null>(null);
  const [annotationClass, setAnnotationClass] = useState('solar_panel');
  const [customClass, setCustomClass] = useState('');
  const [annotationRename, setAnnotationRename] = useState('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationMessage, setAnnotationMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const base = `${import.meta.env.BASE_URL}data/`;
    Promise.all([
      fetch(base + 'metadata.json').then(r => { if (!r.ok) throw new Error('Metadata unavailable'); return r.json() as Promise<DatasetMeta>; }),
      fetch(base + 'berlin_buildings.geojson').then(r => { if (!r.ok) throw new Error('Building data unavailable'); return r.json() as Promise<BuildingCollection>; }),
    ]).then(([m, g]) => { setMeta(m); setGeo(g); }).catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    // Model outputs are optional and never fabricated. Missing assets are a normal state.
    if (!meta) return;
    let live = true;
    const base = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${base}data/ai_buildings.geojson`, { cache: 'no-store' }),
      fetch(`${base}data/ai_metadata.json`, { cache: 'no-store' }),
    ]).then(async ([features, metadata]) => {
      if (!features.ok || !metadata.ok) return;
      const [collection, details] = await Promise.all([features.json(), metadata.json()]);
      if (live && collection.type === 'FeatureCollection' && Array.isArray(collection.features) && details.status === 'real_model_inference' && details.validation_status === 'not_evaluated_for_berlin' && details.source_image_year === meta?.imagery_year && JSON.stringify(details.source_bbox_25833) === JSON.stringify(meta?.bbox_25833) && collection.metadata?.data_type === 'model_prediction') {
        setPredictions(collection as BuildingCollection);
        setPredictionMeta(details);
      }
    }).catch(() => { /* no predictions published: retain official reference view */ });
    return () => { live = false; };
  }, [meta]);

  useEffect(() => () => requestRef.current?.abort(), []);

  // Browser-local persistence is keyed to the actual image extent and year.
  useEffect(() => {
    if (!meta) return;
    const extent = imageExtent(meta.image_corners);
    try {
      const saved = window.localStorage.getItem(storageKey(meta.imagery_year, extent));
      setAnnotations(saved ? importAnnotationText(saved, meta.imagery_year, extent) : []);
      setAnnotationMessage(null);
    } catch (err) {
      setAnnotations([]);
      setAnnotationMessage(`Previously saved annotations could not be loaded: ${err instanceof Error ? err.message : 'invalid data'}. Import your backup if available.`);
    }
    setAnnotationsLoaded(true);
  }, [meta]);

  useEffect(() => {
    if (!meta || !annotationsLoaded) return;
    const extent = imageExtent(meta.image_corners);
    try {
      window.localStorage.setItem(storageKey(meta.imagery_year, extent), exportAnnotations(annotations, meta.imagery_year, extent));
    } catch {
      setAnnotationMessage('Local saving is unavailable or full. Export GeoJSON now to avoid losing your work.');
    }
  }, [annotations, annotationsLoaded, meta]);

  const createManualAnnotation = (ring: Position[], shape: DrawingShape) => {
    if (!meta) return;
    if (annotations.length >= MAX_ANNOTATIONS) { setAnnotationMessage(`Maximum ${MAX_ANNOTATIONS} annotations reached. Export the current dataset.`); setAnnotationMode(null); return; }
    try {
      const label = annotationClass === 'custom' ? normalizedClass(customClass) : annotationClass;
      const item = newAnnotation(crypto.randomUUID(), label, shape, makeRing(ring.slice(0, -1), 'polygon', imageExtent(meta.image_corners)), imageExtent(meta.image_corners));
      setAnnotations(previous => [...previous, item]);
      setSelectedAnnotationId(item.id);
      setAnnotationMessage(`Saved ${label} as a manual annotation. Review its label before training.`);
    } catch (err) { setAnnotationMessage(err instanceof Error ? err.message : 'Annotation rejected.'); }
  };
  const startAnnotation = (shape: DrawingShape) => {
    if (!meta) return;
    try { normalizedClass(annotationClass === 'custom' ? customClass : annotationClass); }
    catch (err) { setAnnotationMessage(err instanceof Error ? err.message : 'Invalid class name.'); return; }
    setDrawingAoi(false);
    setSourceMode('alkis');
    setOrtho(true);
    setModule('buildings');
    setMapResetToken(v => v + 1);
    setAnnotationMode(current => current === shape ? null : shape);
    setAnnotationMessage(null);
  };
  const updateAnnotation = (id: string, status: AnnotationStatus) => {
    setAnnotations(previous => previous.map(item => item.id === id ? { ...item, properties: { ...item.properties, status } } : item));
  };
  const renameAnnotation = (id: string, label: string) => {
    try {
      const name = normalizedClass(label);
      setAnnotations(previous => previous.map(item => item.id === id ? { ...item, properties: { ...item.properties, class_name: name } } : item));
      setAnnotationMessage('Annotation class updated.');
    } catch (err) { setAnnotationMessage(err instanceof Error ? err.message : 'Invalid class.'); }
  };
  const exportManualAnnotations = () => {
    if (!meta) return;
    downloadText(exportAnnotations(annotations, meta.imagery_year, imageExtent(meta.image_corners)), 'geoai-studio-manual-annotations.geojson', 'application/geo+json');
    setAnnotationMessage('GeoJSON exported. Keep a backup: browser storage is device-specific.');
  };
  const importManualAnnotations = async (file: File | undefined) => {
    if (!file || !meta) return;
    try {
      if (file.size > 2_000_000) throw new Error('Import file exceeds 2 MB.');
      const parsed = importAnnotationText(await file.text(), meta.imagery_year, imageExtent(meta.image_corners));
      if (parsed.length > MAX_ANNOTATIONS) throw new Error('Too many annotations.');
      if (annotations.length && !window.confirm('Replace all current annotations with the imported file? Export a backup first.')) return;
      setAnnotations(parsed);
      setAnnotationMode(null);
      setSelectedAnnotationId(null);
      setAnnotationMessage(`Imported ${parsed.length} manual annotations.`);
    } catch (err) { setAnnotationMessage(err instanceof Error ? err.message : 'Import failed.'); }
    finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
  };
  const selectedAnnotation = annotations.find(item => item.id === selectedAnnotationId) ?? null;
  useEffect(() => { setAnnotationRename(selectedAnnotation?.properties.class_name ?? ''); }, [selectedAnnotationId]);

  const aoiSize = useMemo(() => {
    if (!aoi) return { size: null, error: null };
    try { return { size: inspectAoi(aoi), error: null }; }
    catch (e) { return { size: null, error: e instanceof Error ? e.message : 'Invalid selection' }; }
  }, [aoi]);

  const handleNewAoi = (bounds: AoiBounds) => {
    requestRef.current?.abort();
    setAoi(bounds);
    setSpatialScope('aoi'); // analyze the known dataset immediately, no Overpass dependency
    setDrawingAoi(false);
    setSourceMode('alkis');
    setOsmGeo(null);
    setOsmStatus('idle');
    setOsmError(null);
    setSelected(null);
  };

  const loadOsmBuildings = async () => {
    if (!aoi || !aoiSize.size || osmStatus === 'loading') return;
    const controller = new AbortController();
    requestRef.current = controller;
    setOsmStatus('loading');
    setOsmError(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35_000);
    try {
      const result = await fetchOsmBuildings(aoi, controller.signal, osmProvider);
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setOsmGeo(result);
      setSourceMode('osm');
      setSelected(null);
      setMinArea(0);
      setSearch('');
      setFootprints(true);
      setOrtho(false); // the static Berlin orthophoto is not a live WMS service
      setOsmStatus('ready');
    } catch (e) {
      if (requestRef.current !== controller) return;
      if (controller.signal.aborted && !timedOut) { setOsmStatus('idle'); return; }
      setOsmError(timedOut ? 'This public service did not respond within 35 seconds. Try a smaller AOI (about 100 × 100 m), or select the other service and request again.' : e instanceof Error ? e.message : 'Data request failed.');
      setOsmStatus('error');
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const activeGeo = sourceMode === 'osm' && osmGeo ? osmGeo : geo;
  const scopeBounds = spatialScope === 'aoi' ? aoi : spatialScope === 'viewport' ? viewport : null;
  const filtered = useMemo(
    () => filterBuildings(activeGeo?.features ?? [], minArea, scopeBounds),
    [activeGeo, minArea, scopeBounds],
  );
  const displayGeo = useMemo<BuildingCollection>(() => ({ type: 'FeatureCollection', features: filtered }), [filtered]);
  const area = useMemo(() => filtered.reduce((total, f) => total + f.properties.area_m2, 0), [filtered]);
  const chartData = useMemo(() => areaBuckets.map(b => ({ name: b.label, count: filtered.filter(f => f.properties.area_m2 >= b.low && f.properties.area_m2 < b.high).length })), [filtered]);
  const active = modules.find(m => m.id === module)!;
  const hasFilters = minArea > 0 || search.length > 0 || spatialScope !== 'dataset';
  const isOsm = sourceMode === 'osm';
  const sourceLabel = isOsm ? 'OSM buildings' : 'ALKIS Berlin';
  const scopeLabel = spatialScope === 'aoi' ? 'Selected AOI' : spatialScope === 'viewport' ? 'Map viewport' : 'Full dataset';
  const visible = module === 'buildings';
  const options = useMemo(() => filtered.filter(f => String(f.properties.fid).includes(search.trim())).slice(0, 7), [filtered, search]);

  useEffect(() => {
    if (selected && !filtered.some(f => f.id === selected.id)) setSelected(null);
  }, [filtered, selected]);

  return <div className="shell">
    <aside className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
      <div className="brand">
        <div className="brand-mark"><Layers size={21} strokeWidth={2.2}/></div>
        <div><strong>GEOAI<span>STUDIO</span></strong><small>INTELLIGENCE WORKSPACE</small></div>
        <button className="icon-btn mobile-only close-side" onClick={() => setSidebar(false)} aria-label="Close menu"><X size={19}/></button>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-main ${workspace === 'explorer' ? 'active' : ''}`} onClick={() => { setWorkspace('explorer'); setSidebar(false); }}><MapIcon size={17}/> GeoAI Explorer {workspace === 'explorer' && <span className="nav-dot"/>}</button>
      <button className={`nav-main nav-detection ${workspace === 'detection' ? 'active' : ''}`} onClick={() => { setWorkspace('detection'); setSidebar(false); }}><Crosshair size={17}/> Object Detection Studio {workspace === 'detection' && <span className="nav-dot"/>}</button>
      <div className="source-row"><div className="source-status annotation-source"/><span><strong>Annotation workspace</strong><small>Manual labels · {annotations.length} saved locally</small></span></div>
      <div className="nav-label second">APPLICATIONS</div>
      <div className="modules">
        {modules.map(m => <button key={m.id} className={`module-btn ${module === m.id ? 'chosen' : ''}`} onClick={() => { setWorkspace('explorer'); setModule(m.id); setSelected(null); setSidebar(false); }}>
          <m.icon size={18}/><span><strong>{m.title}</strong><small>{m.subtitle}</small></span>{!m.ready && <em>SOON</em>}
        </button>)}
      </div>
      <div className="nav-label second">DATA SOURCES</div>
      <div className="source-row"><div className="source-status"/><span><strong>Berlin DOP 2025</strong><small>Official orthophoto</small></span></div>
      <div className="source-row"><div className="source-status"/><span><strong>ALKIS Berlin</strong><small>Official building footprints</small></span></div>
      <div className="source-row"><div className="source-status community-status"/><span><strong>OpenStreetMap</strong><small>On-demand community building ways</small></span></div>
      <div className="source-row"><div className="source-status prediction-status"/><span><strong>Building segmentation</strong><small>{predictions ? 'Predictions available · unvalidated' : 'Offline model stage · optional'}</small></span></div>
      <div className="sidebar-bottom">
        <div className="groundtruth"><ShieldCheck size={17}/><div><strong>{sourceMode === 'osm' ? 'Community map data' : 'Official reference data'}</strong><p>{sourceMode === 'osm' ? 'OpenStreetMap contributors · not AI inference.' : 'Berlin ALKIS footprints · not AI inference.'}</p></div></div>
        <div className="version">GEOAI STUDIO <span>v0.7.0</span></div>
      </div>
    </aside>

    <div className="main-column">
      <header className="topbar">
        <div className="top-left"><button className="icon-btn mobile-only" onClick={() => setSidebar(true)} aria-label="Open menu"><Menu size={20}/></button><span className="crumb">Workspace</span><ChevronDown size={13}/><span className="crumb-active">{workspace === 'detection' ? 'Object Detection Studio' : isOsm ? 'Live AOI Explorer' : 'Berlin Urban Explorer'}</span></div>
        <div className="top-actions"><span className="connection"><span/> PUBLIC DATA</span><button className="icon-btn" title="About this demonstration" onClick={() => setShowInfo(true)}><CircleHelp size={19}/></button><div className="avatar">G</div></div>
      </header>
      <main className={workspace === 'detection' ? 'content detection-content' : 'content'}>
        {workspace === 'detection' ? <ObjectDetectionStudio meta={meta} annotations={annotations}/> : <>
        <div className="page-head"><div><div className="eyebrow"><Activity size={13}/> GEOINTELLIGENCE / {active.id.toUpperCase()}</div><h1>{active.title}</h1><p>{active.subtitle} · {isOsm ? 'OpenStreetMap' : 'Berlin, Germany'} · {scopeLabel}</p></div><div className="export-actions"><button className="outline-btn" title={`Export ${filtered.length} features from ${scopeLabel.toLowerCase()}`} onClick={() => exportGeoJSON(visible ? filtered : [], sourceMode, spatialScope)} disabled={!visible || filtered.length === 0}><ArrowDownToLine size={16}/> GeoJSON</button><button className="outline-btn" title="Download the same scoped features as CSV" onClick={() => downloadText(buildingCsv(filtered, sourceLabel), 'geoai_buildings.csv', 'text/csv;charset=utf-8')} disabled={!visible || filtered.length === 0}><ArrowDownToLine size={16}/> CSV</button></div></div>
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-title">Mapped buildings <Building2 size={17}/></div><strong>{visible ? fmt(filtered.length) : '—'}</strong><div className="stat-desc"><span className="stat-up">{isOsm ? 'OSM' : 'Reference'}</span> {scopeLabel} · matching polygons</div></div>
          <div className="stat-card"><div className="stat-title">Total footprint area <Layers size={17}/></div><strong>{visible ? fmt(area) : '—'}<small>{visible ? ' m²' : ''}</small></strong><div className="stat-desc">Sum of full feature footprints (not clipped to view)</div></div>
          <div className="stat-card"><div className="stat-title">Mean building area <BarChart3 size={17}/></div><strong>{visible && filtered.length ? fmt(area / filtered.length) : '—'}<small>{visible && filtered.length ? ' m²' : ''}</small></strong><div className="stat-desc">{scopeLabel} · source measurements</div></div>
          <div className="stat-card status-card"><div className="stat-title">Data classification <ShieldCheck size={17}/></div><strong className="status-text">{isOsm ? 'Community' : 'Official'}</strong><div className="stat-desc"><span className="green-dot"/> Not model predictions</div></div>
        </div>
        <div className={`workspace-grid ${mapExpanded ? 'map-expanded' : ''}`}>
          <section className="map-panel">
            <div className="panel-bar"><div><span className="panel-icon"><MapIcon size={16}/></span><strong>Spatial Explorer</strong><span className="panel-muted">{isOsm ? 'WGS84 · estimated areas' : 'WGS84 map · UTM 33N measurements'}</span></div><div className="map-actions"><button className={`small-btn ${drawingAoi ? 'drawing-active' : ''}`} title="Select an area with two map clicks" onClick={() => { setAnnotationMode(null); setDrawingAoi(v => !v); setAoi(null); setSpatialScope('dataset'); setOsmError(null); setSourceMode('alkis'); setSelected(null); }} disabled={osmStatus === 'loading'}><MousePointer2 size={14}/> {drawingAoi ? 'Cancel AOI' : 'Draw AOI'}</button><button className="small-btn" title="Fit the map to the study area" onClick={() => setMapResetToken(v => v + 1)}><RotateCcw size={14}/> Reset view</button><button className="small-btn" title={mapExpanded ? "Restore dashboard layout" : "Expand map"} onClick={() => setMapExpanded(v => !v)}><Maximize2 size={14}/> {mapExpanded ? "Restore" : "Expand"}</button><button className="small-btn sources-btn" onClick={() => setShowInfo(true)}><Database size={14}/> Sources <ExternalLink size={12}/></button></div></div>
            <div className="map-wrap">
              {meta && geo && activeGeo ? <GeoMap meta={meta} buildings={displayGeo} predictions={predictions} showPredictions={visible && !isOsm && showPredictions} showOrthophoto={ortho} showBuildings={visible && footprints} opacity={opacity} minArea={minArea} selectedId={selected?.properties.fid ?? null} resetToken={mapResetToken} focusToken={locateToken} expanded={mapExpanded} sourceMode={sourceMode} aoi={aoi} drawingAoi={drawingAoi} onAoiChange={handleNewAoi} onCancelDrawing={() => setDrawingAoi(false)} onSelect={setSelected} onBoundsChange={setViewport} annotations={annotations} annotationMode={annotationMode} selectedAnnotationId={selectedAnnotationId} onAnnotationCreate={createManualAnnotation} onAnnotationSelect={setSelectedAnnotationId} onAnnotationCancel={() => setAnnotationMode(null)} onAnnotationError={setAnnotationMessage}/> : <div className="map-fallback"><MapIcon size={32}/><strong>{error ? 'Geospatial assets not prepared yet' : 'Loading map data…'}</strong><p>{error ? 'Run: python scripts/fetch_berlin.py — then restart the app.' : 'Retrieving local demo assets'}</p></div>}
              <div className="map-badge"><span className="pulse"/> {isOsm ? 'Selected AOI · OSM community buildings' : meta ? `Berlin · DOP ${meta.imagery_year} · ${Math.round(meta.bbox_25833[2] - meta.bbox_25833[0])} × ${Math.round(meta.bbox_25833[3] - meta.bbox_25833[1])} m sample` : 'GeoAI Workspace'}</div>
              {annotationMode && <div className="aoi-guidance annotation-guidance"><Pencil size={15}/>{annotationMode === 'box' ? 'Box: click two opposite corners within the aerial image. Esc to cancel.' : 'Polygon: click corners within the image, then double-click or press Enter to finish. Esc to cancel.'}</div>}
              {drawingAoi && <div className="aoi-guidance"><MousePointer2 size={15}/> Click the first corner, move the cursor, then click the opposite corner. Press Esc to cancel.</div>}
              {module !== 'buildings' && <div className="not-ready"><active.icon size={23}/><strong>{active.title}</strong><p>Reserved for a future, validated dataset and real model. No synthetic predictions are shown.</p><button onClick={() => setModule('buildings')}>Return to building explorer</button></div>}

            </div>
            <div className="map-footer"><span><span className={`legend-key ${isOsm ? 'legend-osm' : ''}`}/> {sourceLabel} · yellow dashed = imagery boundary</span><span>{isOsm ? 'OSM © contributors · ODbL · live query limited to building ways' : 'Outside image boundary: basemap only'}</span></div>
          </section>
          <aside className="control-column">
            <section className="control-panel annotation-panel" aria-label="Imagery annotation workspace">
              <div className="panel-title"><Pencil size={17}/> Annotation Studio <span className="aoi-beta">MANUAL LABELS</span></div>
              <p className="aoi-intro">Teach the dataset what to look for. Draw labelled boxes or polygons on the Berlin orthophoto. These are <strong>your annotations</strong>, not automatic detections.</p>
              <label className="spatial-label" htmlFor="annotation-class">Object class</label>
              <select id="annotation-class" value={annotationClass} onChange={e => { setAnnotationClass(e.target.value); setAnnotationMode(null); }}>
                <option value="solar_panel">Solar panel</option>
                <option value="vehicle">Vehicle / car</option>
                <option value="waste_site">Possible waste site</option>
                <option value="building">Building</option>
                <option value="vegetation">Vegetation</option>
                <option value="water">Water</option>
                <option value="custom">Custom class…</option>
              </select>
              {annotationClass === 'custom' && <input className="annotation-input" aria-label="Custom class name" maxLength={40} value={customClass} placeholder="e.g. rooftop equipment" onChange={e => setCustomClass(e.target.value)}/>}
              <div className="annotation-tools">
                <button className={`aoi-outline-btn ${annotationMode === 'box' ? 'drawing-active' : ''}`} onClick={() => startAnnotation('box')} disabled={!meta}><Square size={15}/>{annotationMode === 'box' ? 'Stop boxes' : 'Draw box'}</button>
                <button className={`aoi-outline-btn ${annotationMode === 'polygon' ? 'drawing-active' : ''}`} onClick={() => startAnnotation('polygon')} disabled={!meta}><Pentagon size={15}/>{annotationMode === 'polygon' ? 'Stop polygon' : 'Draw polygon'}</button>
              </div>
              <div className="annotation-summary" role="status"><strong>{annotations.length} annotations</strong><span>{annotations.filter(item => item.properties.status === 'accepted').length} accepted · {annotations.filter(item => item.properties.status === 'unreviewed').length} awaiting review</span></div>
              <div className="annotation-buttons">
                <button className="aoi-outline-btn" disabled={!meta} onClick={exportManualAnnotations}><Save size={14}/> Export GeoJSON</button>
                <button className="aoi-outline-btn" disabled={!meta} onClick={() => fileInputRef.current?.click()}><Upload size={14}/> Import</button>
                <input ref={fileInputRef} type="file" accept=".geojson,.json,application/geo+json,application/json" hidden onChange={event => { void importManualAnnotations(event.target.files?.[0]); }}/>
              </div>
              {annotationMessage && <p className="annotation-notice" role="status">{annotationMessage}</p>}
              {selectedAnnotation && <div className="annotation-details">
                <strong>Selected annotation</strong>
                <label htmlFor="annotation-rename">Class</label>
                <div className="annotation-buttons annotation-rename-row"><input id="annotation-rename" className="annotation-input" maxLength={40} value={annotationRename} onChange={event => setAnnotationRename(event.target.value)}/><button className="aoi-outline-btn" disabled={!annotationRename.trim()} onClick={() => renameAnnotation(selectedAnnotation.id, annotationRename)}>Save label</button></div>
                <span className="annotation-record">{selectedAnnotation.properties.shape} · {selectedAnnotation.properties.status}</span>
                <div className="annotation-buttons">
                  <button className="aoi-outline-btn" onClick={() => updateAnnotation(selectedAnnotation.id, 'accepted')}><CheckCircle2 size={14}/> Accept</button>
                  <button className="aoi-outline-btn" onClick={() => updateAnnotation(selectedAnnotation.id, 'rejected')}><XCircle size={14}/> Reject</button>
                  <button className="aoi-outline-btn danger-btn" onClick={() => { setAnnotations(previous => previous.filter(item => item.id !== selectedAnnotation.id)); setSelectedAnnotationId(null); }}><Trash2 size={14}/> Delete</button>
                </div>
              </div>}
              {annotations.length > 0 && <div className="annotation-list" aria-label="Annotation records">{annotations.slice(-15).reverse().map(item => <button key={item.id} className={selectedAnnotationId === item.id ? 'active-annotation' : ''} onClick={() => setSelectedAnnotationId(item.id)}><span>{item.properties.class_name}</span><small>{item.properties.status}</small></button>)}</div>}
              {annotations.length > 0 && <button className="annotation-clear" onClick={() => { if (window.confirm('Delete every local annotation? Export GeoJSON first.')) { setAnnotations([]); setSelectedAnnotationId(null); } }}>Clear annotations…</button>}
              <p className="aoi-disclaimer">Annotations are saved in this browser only, for the currently loaded image. Use Export GeoJSON to back them up. Outside the yellow orthophoto boundary, no annotation is permitted. No objects are detected or trained automatically in this release.</p>
            </section>
            <div className="control-panel spatial-panel">
              <div className="panel-title"><Layers size={17}/> Spatial analysis <span className="aoi-beta">OFFLINE READY</span></div>
              <p className="aoi-intro">Analyze downloaded features without calling a public API. The map, metrics, chart and exports use the same spatial scope.</p>
              <label htmlFor="spatial-scope" className="spatial-label">Analysis extent</label>
              <select id="spatial-scope" value={spatialScope} onChange={e => { setSpatialScope(e.target.value as SpatialScope); setSelected(null); }}>
                <option value="dataset">Full available dataset</option>
                <option value="aoi" disabled={!aoi}>Drawn AOI {aoi ? '' : '(draw first)'}</option>
                <option value="viewport" disabled={!viewport}>Current map view</option>
              </select>
              <div className="scope-summary" role="status"><strong>{fmt(filtered.length)} matching buildings</strong><span>{scopeLabel} · {fmt(area)} m² total feature area</span></div>
              {spatialScope === 'aoi' && filtered.length === 0 && <p className="scope-warning">No features from the loaded dataset intersect your AOI. The included ALKIS data covers only the small Berlin sample; this is not evidence that there are no buildings on the ground.</p>}
              <small className="scope-explainer">A building counts if its polygon intersects the extent. Its full recorded footprint area contributes to totals; polygons are not clipped.</small>
            </div>
            <div className="control-panel aoi-panel">
              <div className="panel-title"><MousePointer2 size={17}/> Draw / Explore AOI <span className="aoi-beta">SELECTION</span></div>
              <p className="aoi-intro">Draw a rectangle to analyze the existing buildings immediately. Optional live OSM retrieval remains experimental and may time out.</p>
              <div className="aoi-buttons">
                <button className="aoi-outline-btn" onClick={() => { setAnnotationMode(null); setDrawingAoi(true); setAoi(null); setSpatialScope('dataset'); setOsmError(null); setSourceMode('alkis'); setSelected(null); }} disabled={osmStatus === 'loading'}>{drawingAoi ? 'Start again' : 'Draw rectangle'}</button>
                {aoi && <button className="aoi-outline-btn" onClick={() => { setAoi(null); setSpatialScope('dataset'); setDrawingAoi(false); setOsmError(null); setSourceMode('alkis'); setSelected(null); setOsmStatus('idle'); setOsmGeo(null); }}>Clear</button>}
              </div>
              {aoi && <div className="aoi-metrics"><strong>Selected extent</strong>{aoiSize.size ? <span>{Math.round(aoiSize.size.widthM)} × {Math.round(aoiSize.size.heightM)} m · {aoiSize.size.areaKm2.toFixed(3)} km²</span> : <span className="aoi-error">{aoiSize.error}</span>}</div>}
              {drawingAoi && <p className="aoi-note">Click two opposite corners on the map. Press Esc to stop drawing.</p>}
              {aoi && aoiSize.size && <div className="aoi-service-control"><label htmlFor="overpass-provider">Experimental OpenStreetMap data service</label><select id="overpass-provider" value={osmProvider} disabled={osmStatus === 'loading'} onChange={event => { setOsmProvider(event.target.value as OverpassProvider); setOsmError(null); }} aria-describedby="overpass-note">{OVERPASS_SERVICES.map(service => <option key={service.id} value={service.id}>{service.label}</option>)}</select><small id="overpass-note">Public servers have no guaranteed availability. Switching servers does not start a request automatically.</small></div>}
              {aoi && aoiSize.size && <button className="aoi-fetch-btn" onClick={loadOsmBuildings} disabled={osmStatus === 'loading'}>{osmStatus === 'loading' ? 'Loading buildings…' : 'Fetch extra OSM buildings (optional)'}</button>}
              {osmStatus === 'loading' && <div role="status" className="aoi-loading"><span className="aoi-spinner"/> Querying public OpenStreetMap data… <button onClick={() => requestRef.current?.abort()}>Cancel</button></div>}
              {osmError && <p className="aoi-error" role="alert">{osmError}</p>}
              {isOsm && <div className="aoi-result" role="status">{osmGeo?.features.length ?? 0} OSM buildings loaded. Areas are approximate.</div>}
              {isOsm && <button className="aoi-return-btn" onClick={() => { setSourceMode('alkis'); setSpatialScope('dataset'); setSelected(null); setMinArea(0); setOrtho(true); }}>Return to Berlin ALKIS</button>}
              <p className="aoi-disclaimer">Local AOI analysis does not depend on Overpass. Public Overpass APIs are best-effort and may be unavailable. Start with about 100 × 100 m (max 0.5 km²). Please avoid rapid retries or repeated switching between providers. Your selected coordinates go directly to the public Overpass server only when you click Fetch. OSM is community mapping, not cadastral data or AI inference.</p>
            </div>
            {selected && visible && <div className="control-panel inspector-panel" aria-live="polite"><div className="panel-title inspector-heading"><Building2 size={17}/> Selected {isOsm ? 'OSM way' : 'building'} <button onClick={() => setSelected(null)} aria-label="Close building inspector"><X size={16}/></button></div><strong className="inspector-name">{isOsm ? 'OSM way' : 'Building'} #{selected.properties.fid}</strong><dl className="inspector-details"><div><dt>Footprint area</dt><dd>{fmt(selected.properties.area_m2)} m²{isOsm ? ' (approx.)' : ''}</dd></div><div><dt>Dataset</dt><dd>{sourceLabel}</dd></div><div><dt>Classification</dt><dd>{isOsm ? 'OSM community mapping · not AI' : 'Official reference · not AI'}</dd></div></dl></div>}
            <div className="control-panel"><div className="panel-title"><SlidersHorizontal size={17}/> Layer controls</div><div className="control-row"><div><strong>Aerial imagery</strong><small>Berlin DOP20 2025</small></div><button className={`switch ${ortho ? 'on' : ''}`} role="switch" aria-checked={ortho} onClick={() => setOrtho(v => !v)}><span/></button></div>
              <div className="control-row"><div><strong>Building footprints</strong><small>{isOsm ? 'OSM polygon ways' : 'ALKIS polygons'}</small></div><button className={`switch ${footprints ? 'on' : ''}`} role="switch" aria-checked={footprints} onClick={() => setFootprints(v => !v)}><span/></button></div>
              <div className="control-row"><div><strong>Model predictions</strong><small>{predictions && predictionMeta ? `${predictionMeta.predicted_features} estimated footprints · unvalidated` : 'Not generated · optional offline inference'}</small></div><button className={`switch ${showPredictions && !isOsm ? 'on' : ''}`} role="switch" aria-label="Show independently inferred building footprints" aria-checked={showPredictions && !isOsm} disabled={!predictions || isOsm} onClick={() => setShowPredictions(v => !v)}><span/></button></div>
              {predictions && predictionMeta && !isOsm && <p className="prediction-warning"><span className="prediction-swatch"/> Orange outlines: pretrained model predictions, not official footprints. Cross-city accuracy has not been validated. <a href="https://huggingface.co/giswqs/whu-building-unetplusplus-efficientnet-b4" target="_blank" rel="noopener noreferrer">Model details</a>.</p>}
              <label className="range-title" htmlFor="op"><span>Imagery opacity</span><b>{Math.round(opacity * 100)}%</b></label><input id="op" type="range" min="0" max="100" step="5" value={Math.round(opacity * 100)} onChange={e => setOpacity(Number(e.target.value) / 100)}/>
              <label className="range-title" htmlFor="area"><span>Minimum building area</span><b>{minArea} m²</b></label><input id="area" type="range" min="0" max="500" step="25" value={minArea} onChange={e => { setMinArea(Number(e.target.value)); setSelected(null); }}/>{hasFilters && <button className="reset-filters" onClick={() => { setMinArea(0); setSearch(''); setSpatialScope('dataset'); setSelected(null); }}>Reset filters</button>}
            </div>
            <div className="control-panel chart-panel"><div className="panel-title"><BarChart3 size={17}/> Footprint distribution</div><p className="chart-caption">Buildings by full footprint area (m²) · {scopeLabel}</p><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={visible ? chartData : []} margin={{ top: 8, right: 7, left: 0, bottom: 0 }}><XAxis dataKey="name" tick={{ fill: '#8a96ac', fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis width={22} allowDecimals={false} tick={{ fill: '#8a96ac', fontSize: 10 }} axisLine={false} tickLine={false}/><Tooltip cursor={{fill: '#ffffff0b'}} contentStyle={{ borderRadius: 10, border: '1px solid #344053', background: '#182437', color: '#e9f0f8', fontSize: 12 }}/><Bar dataKey="count" name="Buildings" fill="#4bc5d8" radius={[4, 4, 0, 0]}/></BarChart></ResponsiveContainer></div></div>
            <div className="control-panel feature-panel"><div className="panel-title"><Search size={17}/> Find a building</div><div className="search-box"><Search size={15}/><input aria-label="Search buildings by ID" placeholder="Search by feature ID…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="feature-list" aria-label="Building search results">{visible && options.length ? options.map(f => <button key={f.id} onClick={() => { setSelected(f); setLocateToken(v => v + 1); }} className={selected?.id === f.id ? 'selected-item' : ''}><span>{isOsm ? 'OSM way' : 'Building'} #{f.properties.fid}</span><b>{fmt(f.properties.area_m2)} m²</b></button>) : <p className="empty-features">No matching buildings</p>}</div></div>
          </aside>
        </div>
        <footer className="footer"><span>© GeoAI Studio · Educational geospatial research</span><span>Berlin imagery/ALKIS © Geoportal Berlin · OSM <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© contributors (ODbL)</a> · Basemap © OpenFreeMap / OSM</span></footer>
        </>}
      </main>
    </div>
    {showInfo && <div className="modal-overlay" onClick={() => setShowInfo(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowInfo(false)}><X size={20}/></button><div className="eyebrow">DATA PROVENANCE</div><h2>Real geospatial data. No simulated AI results.</h2><p>The default demonstration loads a small official Berlin orthophoto and official ALKIS building footprints acquired by Python during deployment. The dashed image border is the full downloaded extent; no additional orthophotos are downloaded on pan or zoom. Live AOI discovery separately queries building ways mapped by OpenStreetMap contributors through a public Overpass API endpoint. OSM coverage is not complete, its polygon areas are approximate, and the public API can be unavailable or rate limited. Neither dataset constitutes AI predictions. v0.7 performs bounded browser-side visual similarity scoring only when requested; v0.6 annotations and GIS spatial analytics work independently of the live OSM service. Building area sums use full feature footprints for intersecting polygons.</p><div className="modal-row"><strong>Imagery</strong><span>DOP20RGBI 2025 · Geoportal Berlin WMS</span></div><div className="modal-row"><strong>Buildings</strong><span>ALKIS Berlin Gebäude · Geoportal Berlin WFS</span></div><div className="modal-row"><strong>On-demand buildings</strong><span>OpenStreetMap · Overpass public endpoint · ODbL 1.0</span></div><div className="modal-row"><strong>Coordinate system</strong><span>ETRS89 / UTM zone 33N (EPSG:25833)</span></div><div className="modal-row"><strong>License</strong><span>dl-de/zero-2-0</span></div><p className="modal-note">ALKIS building areas are measured in UTM zone 33N. OSM building areas use a small-area spherical approximation. Both are mapping data, not model performance or AI confidence scores. Where available, the separate orange layer contains independently inferred model polygons, which are not validated for Berlin.</p><button className="primary-btn" onClick={() => setShowInfo(false)}><Check size={16}/> Understood</button></div></div>}
  </div>;
}
