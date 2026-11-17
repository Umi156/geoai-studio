import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Activity, ArrowDownToLine, BarChart3, Building2, Check, ChevronDown, CircleHelp, Database, ExternalLink, Layers, Leaf, Map as MapIcon, Menu, Search, ShieldCheck, SlidersHorizontal, Sun, X } from 'lucide-react';
import GeoMap from './GeoMap';
import type { BuildingCollection, BuildingFeature, DatasetMeta } from './types';

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

function exportGeoJSON(features: BuildingFeature[]) {
  const contents = JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'berlin_reference_buildings.geojson'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [geo, setGeo] = useState<BuildingCollection | null>(null);
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

  useEffect(() => {
    const base = `${import.meta.env.BASE_URL}data/`;
    Promise.all([
      fetch(base + 'metadata.json').then(r => { if (!r.ok) throw new Error('Metadata unavailable'); return r.json() as Promise<DatasetMeta>; }),
      fetch(base + 'berlin_buildings.geojson').then(r => { if (!r.ok) throw new Error('Building data unavailable'); return r.json() as Promise<BuildingCollection>; }),
    ]).then(([m, g]) => { setMeta(m); setGeo(g); }).catch(e => setError(String(e)));
  }, []);

  const filtered = useMemo(() => (geo?.features ?? []).filter(f => f.properties.area_m2 >= minArea), [geo, minArea]);
  const area = useMemo(() => filtered.reduce((total, f) => total + f.properties.area_m2, 0), [filtered]);
  const chartData = useMemo(() => areaBuckets.map(b => ({ name: b.label, count: filtered.filter(f => f.properties.area_m2 >= b.low && f.properties.area_m2 < b.high).length })), [filtered]);
  const active = modules.find(m => m.id === module)!;
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
      <div className="sidebar-bottom">
        <div className="groundtruth"><ShieldCheck size={17}/><div><strong>Verified reference data</strong><p>Ground-truth showcase, not live AI inference.</p></div></div>
        <div className="version">OPEN DATA DEMO <span>v0.1.0</span></div>
      </div>
    </aside>

    <div className="main-column">
      <header className="topbar">
        <div className="top-left"><button className="icon-btn mobile-only" onClick={() => setSidebar(true)} aria-label="Open menu"><Menu size={20}/></button><span className="crumb">Workspace</span><ChevronDown size={13}/><span className="crumb-active">Berlin Urban Explorer</span></div>
        <div className="top-actions"><span className="connection"><span/> PUBLIC DATA</span><button className="icon-btn" title="About this demonstration" onClick={() => setShowInfo(true)}><CircleHelp size={19}/></button><div className="avatar">G</div></div>
      </header>
      <main className="content">
        <div className="page-head"><div><div className="eyebrow"><Activity size={13}/> GEOINTELLIGENCE / {active.id.toUpperCase()}</div><h1>{active.title}</h1><p>{active.subtitle} · Berlin, Germany</p></div><button className="outline-btn" onClick={() => exportGeoJSON(visible ? filtered : [])} disabled={!visible || filtered.length === 0}><ArrowDownToLine size={16}/> Export GeoJSON</button></div>
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-title">Mapped buildings <Building2 size={17}/></div><strong>{visible ? fmt(filtered.length) : '—'}</strong><div className="stat-desc"><span className="stat-up">Reference</span> ALKIS source features</div></div>
          <div className="stat-card"><div className="stat-title">Total footprint area <Layers size={17}/></div><strong>{visible ? fmt(area) : '—'}<small>{visible ? ' m²' : ''}</small></strong><div className="stat-desc">Computed in ETRS89 / UTM 33N</div></div>
          <div className="stat-card"><div className="stat-title">Mean building area <BarChart3 size={17}/></div><strong>{visible && filtered.length ? fmt(area / filtered.length) : '—'}<small>{visible && filtered.length ? ' m²' : ''}</small></strong><div className="stat-desc">Current filtered extent</div></div>
          <div className="stat-card status-card"><div className="stat-title">Data classification <ShieldCheck size={17}/></div><strong className="status-text">Official</strong><div className="stat-desc"><span className="green-dot"/> Not model predictions</div></div>
        </div>
        <div className="workspace-grid">
          <section className="map-panel">
            <div className="panel-bar"><div><span className="panel-icon"><MapIcon size={16}/></span><strong>Spatial Explorer</strong><span className="panel-muted">ETRS89 / UTM 33N</span></div><button className="small-btn" onClick={() => setShowInfo(true)}><Database size={14}/> Sources <ExternalLink size={12}/></button></div>
            <div className="map-wrap">
              {meta && geo ? <GeoMap meta={meta} buildings={geo} showOrthophoto={ortho} showBuildings={visible && footprints} opacity={opacity} minArea={minArea} selectedId={selected?.properties.fid ?? null} onSelect={setSelected}/> : <div className="map-fallback"><MapIcon size={32}/><strong>{error ? 'Geospatial assets not prepared yet' : 'Loading map data…'}</strong><p>{error ? 'Run: python scripts/fetch_berlin.py — then restart the app.' : 'Retrieving local demo assets'}</p></div>}
              <div className="map-badge"><span className="pulse"/> {meta ? `Berlin · DOP ${meta.imagery_year}` : 'GeoAI Workspace'}</div>
              {module !== 'buildings' && <div className="not-ready"><active.icon size={23}/><strong>{active.title}</strong><p>Reserved for a future, validated dataset and real model. No synthetic predictions are shown.</p><button onClick={() => setModule('buildings')}>Return to building explorer</button></div>}
              {selected && visible && <div className="feature-inspect"><div className="inspect-head"><span>FEATURE INSPECTOR</span><button onClick={() => setSelected(null)} aria-label="Close selection"><X size={15}/></button></div><strong>Building #{selected.properties.fid}</strong><div><span>Footprint area</span><b>{fmt(selected.properties.area_m2)} m²</b></div><div><span>Dataset</span><b>ALKIS Berlin</b></div><div><span>Data status</span><b>Official reference</b></div></div>}
            </div>
            <div className="map-footer"><span><span className="legend-key"/> ALKIS footprints</span><span>Hover to inspect · Click to select · Scroll to zoom</span></div>
          </section>
          <aside className="control-column">
            <div className="control-panel"><div className="panel-title"><SlidersHorizontal size={17}/> Layer controls</div><div className="control-row"><div><strong>Aerial imagery</strong><small>Berlin DOP20 2025</small></div><button className={`switch ${ortho ? 'on' : ''}`} role="switch" aria-checked={ortho} onClick={() => setOrtho(v => !v)}><span/></button></div>
              <div className="control-row"><div><strong>Building footprints</strong><small>ALKIS polygons</small></div><button className={`switch ${footprints ? 'on' : ''}`} role="switch" aria-checked={footprints} onClick={() => setFootprints(v => !v)}><span/></button></div>
              <label className="range-title" htmlFor="op"><span>Imagery opacity</span><b>{Math.round(opacity * 100)}%</b></label><input id="op" type="range" min="0" max="100" step="5" value={Math.round(opacity * 100)} onChange={e => setOpacity(Number(e.target.value) / 100)}/>
              <label className="range-title" htmlFor="area"><span>Minimum building area</span><b>{minArea} m²</b></label><input id="area" type="range" min="0" max="500" step="25" value={minArea} onChange={e => { setMinArea(Number(e.target.value)); setSelected(null); }}/>
            </div>
            <div className="control-panel chart-panel"><div className="panel-title"><BarChart3 size={17}/> Footprint distribution</div><p className="chart-caption">Buildings by area (m²)</p><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={visible ? chartData : []} margin={{ top: 12, right: 7, left: 7, bottom: 0 }}><XAxis dataKey="name" tick={{ fill: '#8a96ac', fontSize: 10 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #344053', background: '#182437', color: '#e9f0f8', fontSize: 12 }}/><Area type="monotone" dataKey="count" stroke="#55c7db" fill="#2d90ad" fillOpacity={0.27} strokeWidth={2}/></AreaChart></ResponsiveContainer></div></div>
            <div className="control-panel feature-panel"><div className="panel-title"><Search size={17}/> Find a building</div><div className="search-box"><Search size={15}/><input placeholder="Search by feature ID…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="feature-list">{visible && options.length ? options.map(f => <button key={f.id} onClick={() => setSelected(f)} className={selected?.id === f.id ? 'selected-item' : ''}><span>Building #{f.properties.fid}</span><b>{fmt(f.properties.area_m2)} m²</b></button>) : <p className="empty-features">No matching buildings</p>}</div></div>
          </aside>
        </div>
        <footer className="footer"><span>© GeoAI Studio · Educational geospatial research</span><span>Imagery © Geoportal Berlin · Buildings © Geoportal Berlin · Basemap © OpenFreeMap / OpenStreetMap contributors</span></footer>
      </main>
    </div>
    {showInfo && <div className="modal-overlay" onClick={() => setShowInfo(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowInfo(false)}><X size={20}/></button><div className="eyebrow">DATA PROVENANCE</div><h2>Real geospatial data. No simulated AI results.</h2><p>This first release uses two official Berlin open data services. A local Python script downloads a small orthophoto and matching cadastral building footprints automatically.</p><div className="modal-row"><strong>Imagery</strong><span>DOP20RGBI 2025 · Geoportal Berlin WMS</span></div><div className="modal-row"><strong>Buildings</strong><span>ALKIS Berlin Gebäude · Geoportal Berlin WFS</span></div><div className="modal-row"><strong>Coordinate system</strong><span>ETRS89 / UTM zone 33N (EPSG:25833)</span></div><div className="modal-row"><strong>License</strong><span>dl-de/zero-2-0</span></div><p className="modal-note">Building areas are calculated from official polygons; they are not validation metrics or AI confidence scores.</p><button className="primary-btn" onClick={() => setShowInfo(false)}><Check size={16}/> Understood</button></div></div>}
  </div>;
}
