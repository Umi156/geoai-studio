import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowDownToLine, BarChart3, Building2, Check, ChevronDown, CircleHelp, Database, ExternalLink, Layers, Leaf, Map as MapIcon, Maximize2, Menu, MousePointer2, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Sun, X } from 'lucide-react';
import GeoMap from './GeoMap';
import type { BuildingCollection, BuildingFeature, DatasetMeta } from './types';
import { fetchOsmBuildings, inspectAoi } from './services/overpass';
import type { AoiBounds } from './services/overpass';

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

function exportGeoJSON(features: BuildingFeature[], source: 'alkis' | 'osm') {
  const attribution = source === 'osm' ? '© OpenStreetMap contributors · ODbL 1.0' : 'Geoportal Berlin · dl-de/zero-2-0';
  const contents = JSON.stringify({ type: 'FeatureCollection', features, metadata: { attribution, license_url: source === 'osm' ? 'https://www.openstreetmap.org/copyright' : 'https://www.govdata.de/dl-de/zero-2-0', data_type: source === 'osm' ? 'community mapping, not AI predictions' : 'official reference, not AI predictions' } }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url; a.download = source === 'osm' ? 'osm_aoi_buildings.geojson' : 'berlin_alkis_buildings.geojson'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [geo, setGeo] = useState<BuildingCollection | null>(null);
  const [osmGeo, setOsmGeo] = useState<BuildingCollection | null>(null);
  const [sourceMode, setSourceMode] = useState<'alkis' | 'osm'>('alkis');
  const [aoi, setAoi] = useState<AoiBounds | null>(null);
  const [drawingAoi, setDrawingAoi] = useState(false);
  const [osmStatus, setOsmStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [osmError, setOsmError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState<ModuleName>('buildings');
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

  useEffect(() => {
    const base = `${import.meta.env.BASE_URL}data/`;
    Promise.all([
      fetch(base + 'metadata.json').then(r => { if (!r.ok) throw new Error('Metadata unavailable'); return r.json() as Promise<DatasetMeta>; }),
      fetch(base + 'berlin_buildings.geojson').then(r => { if (!r.ok) throw new Error('Building data unavailable'); return r.json() as Promise<BuildingCollection>; }),
    ]).then(([m, g]) => { setMeta(m); setGeo(g); }).catch(e => setError(String(e)));
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  const aoiSize = useMemo(() => {
    if (!aoi) return { size: null, error: null };
    try { return { size: inspectAoi(aoi), error: null }; }
    catch (e) { return { size: null, error: e instanceof Error ? e.message : 'Invalid selection' }; }
  }, [aoi]);

  const handleNewAoi = (bounds: AoiBounds) => {
    requestRef.current?.abort();
    setAoi(bounds);
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
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    try {
      const result = await fetchOsmBuildings(aoi, controller.signal);
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
      setOsmError(timedOut ? 'The public service timed out. Try a smaller AOI later.' : e instanceof Error ? e.message : 'Data request failed.');
      setOsmStatus('error');
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const activeGeo = sourceMode === 'osm' && osmGeo ? osmGeo : geo;
  const filtered = useMemo(() => (activeGeo?.features ?? []).filter(f => f.properties.area_m2 >= minArea), [activeGeo, minArea]);
  const area = useMemo(() => filtered.reduce((total, f) => total + f.properties.area_m2, 0), [filtered]);
  const chartData = useMemo(() => areaBuckets.map(b => ({ name: b.label, count: filtered.filter(f => f.properties.area_m2 >= b.low && f.properties.area_m2 < b.high).length })), [filtered]);
  const active = modules.find(m => m.id === module)!;
  const hasFilters = minArea > 0 || search.length > 0;
  const isOsm = sourceMode === 'osm';
  const sourceLabel = isOsm ? 'OSM buildings' : 'ALKIS Berlin';
  const visible = module === 'buildings';
  const options = useMemo(() => filtered.filter(f => String(f.properties.fid).includes(search.trim())).slice(0, 7), [filtered, search]);

  return <div className="shell">
    <aside className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
      <div className="brand">
        <div className="brand-mark"><Layers size={21} strokeWidth={2.2}/></div>
        <div><strong>GEOAI<span>STUDIO</span></strong><small>INTELLIGENCE WORKSPACE</small></div>
        <button className="icon-btn mobile-only close-side" onClick={() => setSidebar(false)} aria-label="Close menu"><X size={19}/></button>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-main active"><MapIcon size={17}/> GeoAI Explorer <span className="nav-dot"/></button>
      <div className="nav-label second">APPLICATIONS</div>
      <div className="modules">
        {modules.map(m => <button key={m.id} className={`module-btn ${module === m.id ? 'chosen' : ''}`} onClick={() => { setModule(m.id); setSelected(null); setSidebar(false); }}>
          <m.icon size={18}/><span><strong>{m.title}</strong><small>{m.subtitle}</small></span>{!m.ready && <em>SOON</em>}
        </button>)}
      </div>
      <div className="nav-label second">DATA SOURCES</div>
      <div className="source-row"><div className="source-status"/><span><strong>Berlin DOP 2025</strong><small>Official orthophoto</small></span></div>
      <div className="source-row"><div className="source-status"/><span><strong>ALKIS Berlin</strong><small>Official building footprints</small></span></div>
      <div className="source-row"><div className="source-status community-status"/><span><strong>OpenStreetMap</strong><small>On-demand community building ways</small></span></div>
      <div className="sidebar-bottom">
        <div className="groundtruth"><ShieldCheck size={17}/><div><strong>{sourceMode === 'osm' ? 'Community map data' : 'Official reference data'}</strong><p>{sourceMode === 'osm' ? 'OpenStreetMap contributors · not AI inference.' : 'Berlin ALKIS footprints · not AI inference.'}</p></div></div>
        <div className="version">OPEN DATA DEMO <span>v0.3.0</span></div>
      </div>
    </aside>

    <div className="main-column">
      <header className="topbar">
        <div className="top-left"><button className="icon-btn mobile-only" onClick={() => setSidebar(true)} aria-label="Open menu"><Menu size={20}/></button><span className="crumb">Workspace</span><ChevronDown size={13}/><span className="crumb-active">{isOsm ? 'Live AOI Explorer' : 'Berlin Urban Explorer'}</span></div>
        <div className="top-actions"><span className="connection"><span/> PUBLIC DATA</span><button className="icon-btn" title="About this demonstration" onClick={() => setShowInfo(true)}><CircleHelp size={19}/></button><div className="avatar">G</div></div>
      </header>
      <main className="content">
        <div className="page-head"><div><div className="eyebrow"><Activity size={13}/> GEOINTELLIGENCE / {active.id.toUpperCase()}</div><h1>{active.title}</h1><p>{active.subtitle} · {isOsm ? 'Selected AOI · OpenStreetMap' : 'Berlin, Germany'}</p></div><button className="outline-btn" title="Export buildings passing the area filter (not limited to current map viewport)" onClick={() => exportGeoJSON(visible ? filtered : [], sourceMode)} disabled={!visible || filtered.length === 0}><ArrowDownToLine size={16}/> Export GeoJSON</button></div>
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-title">Mapped buildings <Building2 size={17}/></div><strong>{visible ? fmt(filtered.length) : '—'}</strong><div className="stat-desc"><span className="stat-up">{isOsm ? 'OSM' : 'Reference'}</span> {isOsm ? 'Community-mapped building ways' : 'ALKIS source features'}</div></div>
          <div className="stat-card"><div className="stat-title">Total footprint area <Layers size={17}/></div><strong>{visible ? fmt(area) : '—'}<small>{visible ? ' m²' : ''}</small></strong><div className="stat-desc">{isOsm ? 'Approx. spherical areas · not cadastral' : 'Computed in ETRS89 / UTM 33N'}</div></div>
          <div className="stat-card"><div className="stat-title">Mean building area <BarChart3 size={17}/></div><strong>{visible && filtered.length ? fmt(area / filtered.length) : '—'}<small>{visible && filtered.length ? ' m²' : ''}</small></strong><div className="stat-desc">Filtered dataset (not map viewport)</div></div>
          <div className="stat-card status-card"><div className="stat-title">Data classification <ShieldCheck size={17}/></div><strong className="status-text">{isOsm ? 'Community' : 'Official'}</strong><div className="stat-desc"><span className="green-dot"/> Not model predictions</div></div>
        </div>
        <div className={`workspace-grid ${mapExpanded ? 'map-expanded' : ''}`}>
          <section className="map-panel">
            <div className="panel-bar"><div><span className="panel-icon"><MapIcon size={16}/></span><strong>Spatial Explorer</strong><span className="panel-muted">{isOsm ? 'WGS84 · estimated areas' : 'WGS84 map · UTM 33N measurements'}</span></div><div className="map-actions"><button className={`small-btn ${drawingAoi ? 'drawing-active' : ''}`} title="Select an area with two map clicks" onClick={() => { setDrawingAoi(v => !v); setAoi(null); setOsmError(null); setSourceMode('alkis'); setSelected(null); }} disabled={osmStatus === 'loading'}><MousePointer2 size={14}/> {drawingAoi ? 'Cancel AOI' : 'Draw AOI'}</button><button className="small-btn" title="Fit the map to the study area" onClick={() => setMapResetToken(v => v + 1)}><RotateCcw size={14}/> Reset view</button><button className="small-btn" title={mapExpanded ? "Restore dashboard layout" : "Expand map"} onClick={() => setMapExpanded(v => !v)}><Maximize2 size={14}/> {mapExpanded ? "Restore" : "Expand"}</button><button className="small-btn sources-btn" onClick={() => setShowInfo(true)}><Database size={14}/> Sources <ExternalLink size={12}/></button></div></div>
            <div className="map-wrap">
              {meta && geo && activeGeo ? <GeoMap meta={meta} buildings={activeGeo} showOrthophoto={ortho} showBuildings={visible && footprints} opacity={opacity} minArea={minArea} selectedId={selected?.properties.fid ?? null} resetToken={mapResetToken} focusToken={locateToken} expanded={mapExpanded} sourceMode={sourceMode} aoi={aoi} drawingAoi={drawingAoi} onAoiChange={handleNewAoi} onCancelDrawing={() => setDrawingAoi(false)} onSelect={setSelected}/> : <div className="map-fallback"><MapIcon size={32}/><strong>{error ? 'Geospatial assets not prepared yet' : 'Loading map data…'}</strong><p>{error ? 'Run: python scripts/fetch_berlin.py — then restart the app.' : 'Retrieving local demo assets'}</p></div>}
              <div className="map-badge"><span className="pulse"/> {isOsm ? 'Selected AOI · OSM community buildings' : meta ? `Berlin · DOP ${meta.imagery_year} · ${Math.round(meta.bbox_25833[2] - meta.bbox_25833[0])} × ${Math.round(meta.bbox_25833[3] - meta.bbox_25833[1])} m sample` : 'GeoAI Workspace'}</div>
              {drawingAoi && <div className="aoi-guidance"><MousePointer2 size={15}/> Click the first corner, move the cursor, then click the opposite corner. Press Esc to cancel.</div>}
              {module !== 'buildings' && <div className="not-ready"><active.icon size={23}/><strong>{active.title}</strong><p>Reserved for a future, validated dataset and real model. No synthetic predictions are shown.</p><button onClick={() => setModule('buildings')}>Return to building explorer</button></div>}

            </div>
            <div className="map-footer"><span><span className={`legend-key ${isOsm ? 'legend-osm' : ''}`}/> {sourceLabel} · yellow dashed = imagery boundary</span><span>{isOsm ? 'OSM © contributors · ODbL · live query limited to building ways' : 'Outside image boundary: basemap only'}</span></div>
          </section>
          <aside className="control-column">
            <div className="control-panel aoi-panel">
              <div className="panel-title"><MousePointer2 size={17}/> Area of interest <span className="aoi-beta">LIVE DATA</span></div>
              <p className="aoi-intro">Select a small rectangle on the map, then retrieve mapped buildings automatically. No file upload or account required.</p>
              <div className="aoi-buttons">
                <button className="aoi-outline-btn" onClick={() => { setDrawingAoi(true); setAoi(null); setOsmError(null); setSourceMode('alkis'); setSelected(null); }} disabled={osmStatus === 'loading'}>{drawingAoi ? 'Start again' : 'Draw rectangle'}</button>
                {aoi && <button className="aoi-outline-btn" onClick={() => { setAoi(null); setDrawingAoi(false); setOsmError(null); setSourceMode('alkis'); setSelected(null); setOsmStatus('idle'); setOsmGeo(null); }}>Clear</button>}
              </div>
              {aoi && <div className="aoi-metrics"><strong>Selected extent</strong>{aoiSize.size ? <span>{Math.round(aoiSize.size.widthM)} × {Math.round(aoiSize.size.heightM)} m · {aoiSize.size.areaKm2.toFixed(3)} km²</span> : <span className="aoi-error">{aoiSize.error}</span>}</div>}
              {drawingAoi && <p className="aoi-note">Click two opposite corners on the map. Press Esc to stop drawing.</p>}
              {aoi && aoiSize.size && <button className="aoi-fetch-btn" onClick={loadOsmBuildings} disabled={osmStatus === 'loading'}>{osmStatus === 'loading' ? 'Loading buildings…' : 'Fetch OSM buildings'}</button>}
              {osmStatus === 'loading' && <div role="status" className="aoi-loading"><span className="aoi-spinner"/> Querying public OpenStreetMap data… <button onClick={() => requestRef.current?.abort()}>Cancel</button></div>}
              {osmError && <p className="aoi-error" role="alert">{osmError}</p>}
              {isOsm && <div className="aoi-result" role="status">{osmGeo?.features.length ?? 0} OSM buildings loaded. Areas are approximate.</div>}
              {isOsm && <button className="aoi-return-btn" onClick={() => { setSourceMode('alkis'); setSelected(null); setMinArea(0); setOrtho(true); }}>Return to Berlin ALKIS</button>}
              <p className="aoi-disclaimer">Public Overpass API is best-effort and may be unavailable. Small requests only (max 0.5 km²). Your selected coordinates go directly to the public Overpass server only when you click Fetch. OSM is community mapping, not cadastral data or AI inference.</p>
            </div>
            {selected && visible && <div className="control-panel inspector-panel" aria-live="polite"><div className="panel-title inspector-heading"><Building2 size={17}/> Selected {isOsm ? 'OSM way' : 'building'} <button onClick={() => setSelected(null)} aria-label="Close building inspector"><X size={16}/></button></div><strong className="inspector-name">{isOsm ? 'OSM way' : 'Building'} #{selected.properties.fid}</strong><dl className="inspector-details"><div><dt>Footprint area</dt><dd>{fmt(selected.properties.area_m2)} m²{isOsm ? ' (approx.)' : ''}</dd></div><div><dt>Dataset</dt><dd>{sourceLabel}</dd></div><div><dt>Classification</dt><dd>{isOsm ? 'OSM community mapping · not AI' : 'Official reference · not AI'}</dd></div></dl></div>}
            <div className="control-panel"><div className="panel-title"><SlidersHorizontal size={17}/> Layer controls</div><div className="control-row"><div><strong>Aerial imagery</strong><small>Berlin DOP20 2025</small></div><button className={`switch ${ortho ? 'on' : ''}`} role="switch" aria-checked={ortho} onClick={() => setOrtho(v => !v)}><span/></button></div>
              <div className="control-row"><div><strong>Building footprints</strong><small>{isOsm ? 'OSM polygon ways' : 'ALKIS polygons'}</small></div><button className={`switch ${footprints ? 'on' : ''}`} role="switch" aria-checked={footprints} onClick={() => setFootprints(v => !v)}><span/></button></div>
              <label className="range-title" htmlFor="op"><span>Imagery opacity</span><b>{Math.round(opacity * 100)}%</b></label><input id="op" type="range" min="0" max="100" step="5" value={Math.round(opacity * 100)} onChange={e => setOpacity(Number(e.target.value) / 100)}/>
              <label className="range-title" htmlFor="area"><span>Minimum building area</span><b>{minArea} m²</b></label><input id="area" type="range" min="0" max="500" step="25" value={minArea} onChange={e => { setMinArea(Number(e.target.value)); setSelected(null); }}/>{hasFilters && <button className="reset-filters" onClick={() => { setMinArea(0); setSearch(''); }}>Reset filters</button>}
            </div>
            <div className="control-panel chart-panel"><div className="panel-title"><BarChart3 size={17}/> Footprint distribution</div><p className="chart-caption">Buildings by area (m²)</p><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={visible ? chartData : []} margin={{ top: 8, right: 7, left: 0, bottom: 0 }}><XAxis dataKey="name" tick={{ fill: '#8a96ac', fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis width={22} allowDecimals={false} tick={{ fill: '#8a96ac', fontSize: 10 }} axisLine={false} tickLine={false}/><Tooltip cursor={{fill: '#ffffff0b'}} contentStyle={{ borderRadius: 10, border: '1px solid #344053', background: '#182437', color: '#e9f0f8', fontSize: 12 }}/><Bar dataKey="count" name="Buildings" fill="#4bc5d8" radius={[4, 4, 0, 0]}/></BarChart></ResponsiveContainer></div></div>
            <div className="control-panel feature-panel"><div className="panel-title"><Search size={17}/> Find a building</div><div className="search-box"><Search size={15}/><input aria-label="Search buildings by ID" placeholder="Search by feature ID…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="feature-list" aria-label="Building search results">{visible && options.length ? options.map(f => <button key={f.id} onClick={() => { setSelected(f); setLocateToken(v => v + 1); }} className={selected?.id === f.id ? 'selected-item' : ''}><span>{isOsm ? 'OSM way' : 'Building'} #{f.properties.fid}</span><b>{fmt(f.properties.area_m2)} m²</b></button>) : <p className="empty-features">No matching buildings</p>}</div></div>
          </aside>
        </div>
        <footer className="footer"><span>© GeoAI Studio · Educational geospatial research</span><span>Berlin imagery/ALKIS © Geoportal Berlin · OSM <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© contributors (ODbL)</a> · Basemap © OpenFreeMap / OSM</span></footer>
      </main>
    </div>
    {showInfo && <div className="modal-overlay" onClick={() => setShowInfo(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowInfo(false)}><X size={20}/></button><div className="eyebrow">DATA PROVENANCE</div><h2>Real geospatial data. No simulated AI results.</h2><p>The default demonstration loads a small official Berlin orthophoto and official ALKIS building footprints acquired by Python during deployment. The dashed image border is the full downloaded extent; no additional orthophotos are downloaded on pan or zoom. Live AOI discovery separately queries building ways mapped by OpenStreetMap contributors through a public Overpass API endpoint. OSM coverage is not complete, its polygon areas are approximate, and the public API can be unavailable or rate limited. Neither dataset constitutes AI predictions.</p><div className="modal-row"><strong>Imagery</strong><span>DOP20RGBI 2025 · Geoportal Berlin WMS</span></div><div className="modal-row"><strong>Buildings</strong><span>ALKIS Berlin Gebäude · Geoportal Berlin WFS</span></div><div className="modal-row"><strong>On-demand buildings</strong><span>OpenStreetMap · Overpass public endpoint · ODbL 1.0</span></div><div className="modal-row"><strong>Coordinate system</strong><span>ETRS89 / UTM zone 33N (EPSG:25833)</span></div><div className="modal-row"><strong>License</strong><span>dl-de/zero-2-0</span></div><p className="modal-note">ALKIS building areas are measured in UTM zone 33N. OSM building areas use a small-area spherical approximation. Both are mapping data, not model performance or AI confidence scores.</p><button className="primary-btn" onClick={() => setShowInfo(false)}><Check size={16}/> Understood</button></div></div>}
  </div>;
}
