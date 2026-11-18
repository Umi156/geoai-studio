import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import { ArrowDownToLine, CheckCircle2, Crosshair, Layers, LoaderCircle, RotateCcw, Search, ShieldCheck, SquareDashedMousePointer, Trash2, XCircle } from 'lucide-react';
import type { DatasetMeta } from './types';
import type { Annotation } from './services/annotations';
import { boundsFromCorners, boxFromPixels, geoToPixel, polygonForBox, exportDetections, MODEL_ID } from './services/similarity';
import type { PixelBox, SimilarityDetection } from './services/similarity';
import { findSimilarInImage } from './services/exemplarModel';

const BASE_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const CLASSES = [
  {value:'solar_panel',label:'Solar panels'},
  {value:'vehicle',label:'Cars / vehicles'},
  {value:'waste_site',label:'Suspected waste sites'},
  {value:'building',label:'Buildings'},
  {value:'vegetation',label:'Vegetation'},
  {value:'other',label:'Other objects'},
];
const DIMENSION = 1024;
function downloadFile(content:string,name:string){
  const url=URL.createObjectURL(new Blob([content],{type:'application/geo+json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function featuresFor(detections:SimilarityDetection[], b:ReturnType<typeof boundsFromCorners>, exemplar:PixelBox|null, selected:string|null){
  const candidates=detections.map(d=>({type:'Feature',id:d.id,geometry:{type:'Polygon',coordinates:polygonForBox(d.box,b,DIMENSION,DIMENSION)},properties:{id:d.id,similarity:d.similarity,review:d.review,selected:d.id===selected}}));
  const example = exemplar ? [{type:'Feature',geometry:{type:'Polygon',coordinates:polygonForBox(exemplar,b,DIMENSION,DIMENSION)},properties:{}}] : [];
  return {candidates:{type:'FeatureCollection',features:candidates},example:{type:'FeatureCollection',features:example}};
}
export default function ObjectDetectionStudio({meta,annotations}:{meta:DatasetMeta|null;annotations:Annotation[]}){
  const containerRef=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<Map|null>(null);
  const mapReadyRef=useRef(false);
  const firstCornerRef=useRef<[number,number]|null>(null);
  const drawingRef=useRef(false);
  const selectRef=useRef<(id:string)=>void>(()=>{});
  const imageBounds=useMemo(()=>meta?boundsFromCorners(meta.image_corners):null,[meta]);
  const [drawing,setDrawing]=useState(false);
  const [exemplar,setExemplar]=useState<PixelBox|null>(null);
  const [className,setClassName]=useState('solar_panel');
  const [threshold,setThreshold]=useState(0.82);
  const [results,setResults]=useState<SimilarityDetection[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [scanning,setScanning]=useState(false);
  const [progress,setProgress]=useState({completed:0,total:0,stage:''});
  const [examined,setExamined]=useState(0);
  const [notice,setNotice]=useState('');
  const [imageReady,setImageReady]=useState(false);
  const cancelRef=useRef(false);
  drawingRef.current=drawing;
  selectRef.current=setSelected;
  useEffect(()=>()=>{cancelRef.current=true;},[]);

  useEffect(()=>{
    if(!containerRef.current||!meta||!imageBounds)return;
    const map=new maplibregl.Map({container:containerRef.current,style:BASE_STYLE,center:meta.center as [number,number],zoom:17,attributionControl:false,pitch:0});
    mapRef.current=map;
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
    map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
    const fit=()=>map.fitBounds([[imageBounds.west,imageBounds.south],[imageBounds.east,imageBounds.north]],{padding:48,maxZoom:19,duration:0});
    map.on('load',()=>{
      map.addSource('detection-ortho',{type:'image',url:`${import.meta.env.BASE_URL}data/berlin_orthophoto.png`,coordinates:meta.image_corners as [[number,number],[number,number],[number,number],[number,number]]});
      map.addLayer({id:'detection-ortho-layer',source:'detection-ortho',type:'raster',paint:{'raster-opacity':1}});
      const boundary=[[imageBounds.west,imageBounds.south],[imageBounds.east,imageBounds.south],[imageBounds.east,imageBounds.north],[imageBounds.west,imageBounds.north],[imageBounds.west,imageBounds.south]];
      map.addSource('ortho-limit',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[boundary]}}});
      map.addLayer({id:'ortho-limit-line',type:'line',source:'ortho-limit',paint:{'line-color':'#facc15','line-width':2,'line-dasharray':[2,2]}});
      map.addSource('example-objects',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      map.addLayer({id:'example-fill',type:'fill',source:'example-objects',paint:{'fill-color':'#a78bfa','fill-opacity':.16}});
      map.addLayer({id:'example-outline',type:'line',source:'example-objects',paint:{'line-color':'#d8b4fe','line-width':3}});
      map.addSource('similar-objects',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      map.addLayer({id:'similar-fill',type:'fill',source:'similar-objects',paint:{'fill-color':['match',['get','review'],'accepted','#34d399','rejected','#64748b','#f59e0b'],'fill-opacity':.21}});
      map.addLayer({id:'similar-outline',type:'line',source:'similar-objects',paint:{'line-color':['case',['==',['get','selected'],true],'#fff',['match',['get','review'],'accepted','#34d399','rejected','#64748b','#f59e0b']],'line-width':['case',['==',['get','selected'],true],3,2]}});
      mapReadyRef.current=true;
      fit();
    });
    const onClick=(event:MapMouseEvent)=>{
      if(drawingRef.current){
        const p=geoToPixel(event.lngLat.lng,event.lngLat.lat,imageBounds,DIMENSION,DIMENSION);
        if(p[0]<0||p[1]<0||p[0]>DIMENSION||p[1]>DIMENSION){setNotice('Draw only inside the yellow aerial-image boundary.');return;}
        if(!firstCornerRef.current){firstCornerRef.current=p;setNotice('Click the opposite corner of the example.');return;}
        try {const box=boxFromPixels(firstCornerRef.current,p,DIMENSION,DIMENSION);setExemplar(box);setResults([]);setSelected(null);setExamined(0);setNotice('Example saved. Click Find Similar to scan the available image.');}
        catch(e){setNotice(e instanceof Error?e.message:'Invalid example box.');}
        firstCornerRef.current=null;setDrawing(false);return;
      }
      const hits=map.getLayer('similar-fill') ? map.queryRenderedFeatures(event.point,{layers:['similar-fill']}) : [];
      const id=hits[0]?.properties?.id;
      if(typeof id==='string')selectRef.current(id);
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){firstCornerRef.current=null;setDrawing(false);}};
    map.on('click',onClick);window.addEventListener('keydown',onKey);
    return()=>{window.removeEventListener('keydown',onKey);mapReadyRef.current=false;map.remove();mapRef.current=null;};
  },[meta,imageBounds]);

  useEffect(()=>{
    if(!imageBounds||!mapReadyRef.current||!mapRef.current)return;
    const maps=featuresFor(results,imageBounds,exemplar,selected);
    (mapRef.current.getSource('example-objects') as GeoJSONSource|undefined)?.setData(maps.example as never);
    (mapRef.current.getSource('similar-objects') as GeoJSONSource|undefined)?.setData(maps.candidates as never);
  },[results,exemplar,selected,imageBounds,imageReady]);

  // Source creation and rendering are asynchronous: refresh after map initialization.
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!imageBounds)return;
    const refresh=()=>{setImageReady(true);};
    map.on('load',refresh);
    if(map.loaded())refresh();
    return()=>{map.off('load',refresh);};
  },[meta,imageBounds]);

  const selectedHit=results.find(item=>item.id===selected);
  const changeReview=(id:string,status:'accepted'|'rejected'|'unreviewed')=>setResults(previous=>previous.map(d=>d.id===id?{...d,review:status}:d));
  const useAnnotation=(annotation:Annotation)=>{
    if(!imageBounds)return;
    const ring=annotation.geometry.coordinates[0];
    const pixelPoints=ring.map(([lon,lat])=>geoToPixel(lon,lat,imageBounds,DIMENSION,DIMENSION));
    const xs=pixelPoints.map(p=>p[0]),ys=pixelPoints.map(p=>p[1]);
    try {setExemplar(boxFromPixels([Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)],DIMENSION,DIMENSION));setClassName(annotation.properties.class_name);setResults([]);setSelected(null);setNotice('Existing annotation selected as search example.');}
    catch(e){setNotice(e instanceof Error?e.message:'Invalid annotation extent.');}
  };
  const scan=async()=>{
    if(!exemplar||!meta||!imageBounds||scanning)return;
    setScanning(true);setNotice('');setResults([]);setExamined(0);cancelRef.current=false;
    let bitmap:ImageBitmap|null=null;
    try{
      setProgress({completed:0,total:64,stage:'Loading registered Berlin aerial imagery…'});
      const response=await fetch(`${import.meta.env.BASE_URL}data/berlin_orthophoto.png`);
      if(!response.ok)throw new Error('Aerial image unavailable. Rebuild the Berlin demo assets.');
      bitmap=await createImageBitmap(await response.blob());
      if(bitmap.width!==DIMENSION||bitmap.height!==DIMENSION)throw new Error('Unexpected image dimensions; the example cannot be correctly georeferenced.');
      const result=await findSimilarInImage(bitmap,exemplar,threshold,setProgress,()=>cancelRef.current);
      if(cancelRef.current)return;
      setExamined(result.examined);
      const detections=result.hits.map((hit,i)=>({...hit,id:`similar-${i+1}`,className,review:'unreviewed' as const}));
      setResults(detections);
      setNotice(`Scanned ${result.examined} candidate windows with ${MODEL_ID}. ${detections.length} proposals passed the chosen similarity threshold. Results require review; this is not exhaustive detection.`);
    }catch(e){if(!cancelRef.current)setNotice(e instanceof Error?`Scan unavailable: ${e.message}`:'The scan failed.');}
    finally{bitmap?.close();setScanning(false);}
  };
  const clear=()=>{cancelRef.current=true;setResults([]);setSelected(null);setExemplar(null);setDrawing(false);firstCornerRef.current=null;setExamined(0);setNotice('New session ready.');};
  return <div className="od-workspace">
    <header className="od-heading"><div><div className="eyebrow"><Crosshair size={14}/> GEOINTELLIGENCE / VISUAL SEARCH</div><h1>Object Detection Studio</h1><p>Draw an example, scan similar image regions, review proposals, and export georeferenced results.</p></div><span className="od-pill">EXPERIMENTAL MODEL SEARCH</span></header>
    <div className="od-stat-strip"><span><Layers size={15}/> Berlin orthophoto <strong>{meta?.imagery_year??'—'}</strong></span><span>Image coverage <strong>200 × 200 m</strong></span><span>Examined windows <strong>{examined}</strong></span><span>Proposals <strong>{results.length}</strong></span><span>Accepted <strong>{results.filter(d=>d.review==='accepted').length}</strong></span></div>
    <div className="od-grid">
      <section className="od-map-column"><div className="od-map-header"><strong><SquareDashedMousePointer size={17}/> Visual search map</strong><div><button onClick={()=>mapRef.current?.fitBounds([[imageBounds?.west??13.4,imageBounds?.south??52.5],[imageBounds?.east??13.41,imageBounds?.north??52.52]],{padding:46,maxZoom:19})}><RotateCcw size={14}/> Reset view</button><button onClick={()=>{firstCornerRef.current=null;setDrawing(d=>!d);setNotice('Select two opposite corners inside the aerial photograph.');}} disabled={!meta||scanning}><SquareDashedMousePointer size={14}/> {drawing?'Cancel drawing':'Draw example'}</button></div></div>
        <div className={`od-map ${drawing?'od-drawing':''}`} ref={containerRef} role="region" aria-label="Interactive aerial imagery for object search"/>
        {drawing&&<div className="od-drawing-hint">Click two opposite corners around one example object. Press Esc to cancel.</div>}
        <div className="od-map-foot"><span><i className="od-example-key"/> Example</span><span><i className="od-hit-key"/> Similarity proposal</span><span><i className="od-accepted-key"/> Accepted</span><span>Yellow dashed: imagery boundary</span></div>
      </section>
      <aside className="od-controls">
        <section className="od-card"><div className="od-step">01 / TEACH BY EXAMPLE</div><h2>Select a visual example</h2><p>Choose a class and draw a box on the aerial image, or reuse an existing annotation.</p><label htmlFor="od-class">Object class</label><select id="od-class" value={className} onChange={e=>setClassName(e.target.value)} disabled={scanning}>{CLASSES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select><button className="od-primary" disabled={!meta||scanning} onClick={()=>{firstCornerRef.current=null;setDrawing(d=>!d);}}><SquareDashedMousePointer size={16}/>{drawing?'Stop drawing':'Draw example box'}</button>
          {exemplar&&<div className="od-detail-success"><CheckCircle2 size={15}/> Example selected: {Math.round(exemplar.width)} × {Math.round(exemplar.height)} pixels</div>}
          {annotations.length>0&&<><label htmlFor="od-previous">Reuse a manual annotation</label><select id="od-previous" value="" onChange={e=>{const found=annotations.find(a=>a.id===e.target.value);if(found)useAnnotation(found);}}><option value="">Choose an annotation…</option>{annotations.filter(a=>a.properties.status!=='rejected').slice(-100).map(a=><option key={a.id} value={a.id}>{a.properties.class_name} · {a.id.slice(-6)}</option>)}</select></>}
        </section>
        <section className="od-card"><div className="od-step">02 / FIND SIMILAR</div><h2>Run visual similarity search</h2><p>The pretrained DINOv2 encoder compares cropped image windows. Scores reflect image similarity, not object-detection probability.</p><label htmlFor="od-threshold">Minimum cosine similarity <strong>{threshold.toFixed(2)}</strong></label><input id="od-threshold" type="range" min="0.55" max="0.98" step="0.01" value={threshold} onChange={e=>setThreshold(Number(e.target.value))} disabled={scanning}/>
          <button className="od-primary od-contrast" disabled={!exemplar||scanning||!imageReady} onClick={()=>{void scan();}}>{scanning?<LoaderCircle size={16} className="od-spin"/>:<Search size={16}/>} {scanning?'Scanning image…':'Find Similar Objects'}</button>
          {scanning&&<><div className="od-progress"><span style={{width:progress.total>0?`${100*progress.completed/progress.total}%`:'4%'}}/></div><div className="od-muted">{progress.stage}</div><button className="od-secondary" onClick={()=>{cancelRef.current=true;setNotice('Stopping after the current model operation…');}}>Cancel search</button></>}
          <div className="od-callout"><ShieldCheck size={15}/> Inference runs in this browser. First use downloads model weights from Hugging Face; CPU scans can be slow. No Overpass API is involved.</div>
        </section>
        <section className="od-card od-results"><div className="od-step">03 / REVIEW RESULTS</div><div className="od-results-top"><h2>Candidate objects</h2><strong>{results.length}</strong></div>{results.length? <><div className="od-results-list">{results.map(d=><button key={d.id} className={selected===d.id?'od-selected':''} onClick={()=>{setSelected(d.id);if(imageBounds) {const [lon,lat]=[d.box.x+d.box.width/2,d.box.y+d.box.height/2];const b=imageBounds;mapRef.current?.flyTo({center:[b.west+lon/DIMENSION*(b.east-b.west),b.north-lat/DIMENSION*(b.north-b.south)],zoom:19,maxDuration:700});}}}><span>{d.className.replaceAll('_',' ')} <small>{d.review}</small></span><strong>{d.similarity.toFixed(3)}</strong></button>)}</div>{selectedHit&&<div className="od-review-actions"><button onClick={()=>changeReview(selectedHit.id,'accepted')}><CheckCircle2 size={15}/> Accept</button><button onClick={()=>changeReview(selectedHit.id,'rejected')}><XCircle size={15}/> Reject</button></div>}</> : <p>No candidates yet. Choose an example and run a scan. Low-resolution objects or challenging imagery may produce no reliable matches.</p>}
          <div className="od-export-actions"><button disabled={!results.length||!exemplar||!imageBounds} onClick={()=>{if(!exemplar||!imageBounds||!meta)return;downloadFile(exportDetections(results,exemplar,imageBounds,DIMENSION,DIMENSION,meta.imagery_year,examined),'geoai_similarity_candidates.geojson');}}><ArrowDownToLine size={14}/> Export GeoJSON</button><button onClick={clear} disabled={scanning}><Trash2 size={14}/> Clear</button></div>
        </section>
      </aside>
    </div>
    {notice&&<p className="od-notice" role="status">{notice}</p>}
    <p className="od-disclaimer">Research preview. Candidate-box visual search is neither dense object detection nor instance segmentation. The bounded 64-window scan may miss objects and produce false matches. Manually review all detections. Model weights and imagery remain subject to their respective terms.</p>
  </div>;
}
