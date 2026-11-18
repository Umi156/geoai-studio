import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsFromCorners, geoToPixel, pixelToGeo, boxFromPixels, polygonForBox, overlapIoU, cosineSimilarity, sampleWindows, rankAndSuppress, exportDetections, MODEL_ID, MAX_SCAN_WINDOWS } from '../src/services/similarity.ts';
const corners=[[13.1,52.2],[13.3,52.2],[13.3,52.0],[13.1,52.0]];
const bbox=boundsFromCorners(corners);
const example={x:50,y:60,width:100,height:80};
test('geographic coordinates map consistently to imagery pixels',()=>{
  assert.deepEqual(geoToPixel(13.1,52.2,bbox,1024,1024),[0,0]);
  const [x,y]=geoToPixel(13.2,52.1,bbox,1024,1024);
  assert.ok(Math.abs(x-512)<.001 && Math.abs(y-512)<.001);
  const [lon,lat]=pixelToGeo(x,y,bbox,1024,1024);
  assert.ok(Math.abs(lon-13.2)<1e-12 && Math.abs(lat-52.1)<1e-12);
});
test('rotated WGS84 imagery corners round-trip without axis-aligned displacement',()=>{
  const c=[[13.1,52.2],[13.3001,52.198],[13.3,51.998],[13.0999,52.0]];
  const b=boundsFromCorners(c);
  const lonlat=pixelToGeo(400,730,b,1024,1024);
  const result=geoToPixel(...lonlat,b,1024,1024);
  assert.ok(Math.abs(result[0]-400)<.001 && Math.abs(result[1]-730)<.001);
});
test('invalid boxes and small selections cannot be submitted',()=>{
  assert.throws(()=>boxFromPixels([2,3],[7,8],1024,1024));
  assert.throws(()=>boxFromPixels([2,3],[30,40],28,40));
  assert.deepEqual(boxFromPixels([150,140],[50,60],1024,1024),example);
});
test('geospatial polygon output is closed and area-bounded',()=>{
  const ring=polygonForBox(example,bbox,1024,1024)[0];
  assert.equal(ring.length,5);assert.deepEqual(ring[0],ring[4]);
  assert.ok(ring.every(p=>p[0]>=bbox.west&&p[0]<=bbox.east&&p[1]>=bbox.south&&p[1]<=bbox.north));
});
test('similarity score is cosine similarity, not detection confidence',()=>{
  assert.ok(Math.abs(cosineSimilarity([3,4],[6,8])-1)<1e-12);
  assert.ok(Math.abs(cosineSimilarity([1,0],[0,1]))<1e-12);
  assert.throws(()=>cosineSimilarity([0,0],[1,1]));
  assert.throws(()=>cosineSimilarity([1,2],[1]));
});
test('bounded multi-scale candidate generation stays inside image',()=>{
  const found=sampleWindows(example,1024,1024);
  assert.ok(found.length>0 && found.length<=MAX_SCAN_WINDOWS);
  assert.ok(found.every(b=>b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width<=1024&&b.y+b.height<=1024));
  assert.throws(()=>sampleWindows(example,1024,1024,1000));
});
test('non maximum suppression removes overlapping hits while preserving rank',()=>{
  const hits=[{box:example,similarity:.92},{box:{...example,x:55},similarity:.91},{box:{x:600,y:600,width:100,height:80},similarity:.87},{box:{x:500,y:500,width:50,height:50},similarity:.64}];
  assert.ok(overlapIoU(hits[0].box,hits[1].box)>.8);
  const results=rankAndSuppress(hits,.8,12);
  assert.equal(results.length,2);
  assert.deepEqual(results.map(d=>d.similarity),[.92,.87]);
});
test('exports real candidate provenance, review status, model identity and analysis limits',()=>{
  const text=exportDetections([{id:'hit-1',box:example,similarity:.865232,className:'solar_panel',review:'accepted'}],example,bbox,1024,1024,2025,35);
  const exported=JSON.parse(text);
  assert.equal(exported.features.length,1);
  assert.equal(exported.features[0].properties.origin,'model_similarity_candidate');
  assert.equal(exported.features[0].properties.review_status,'accepted');
  assert.equal(exported.features[0].properties.similarity_score,.8652);
  assert.equal(exported.metadata.model,MODEL_ID);
  assert.match(exported.metadata.score_definition,/not calibrated/);
  assert.equal(exported.metadata.windows_evaluated,35);
  assert.match(text,/unvalidated exploratory/);
});

test('pixel-template exports do not claim neural-network inference',()=>{
  const file=exportDetections([{id:'pixel-1',box:example,similarity:.72,className:'vehicle',review:'unreviewed'}],example,bbox,1024,1024,2025,1000,'template');
  const out=JSON.parse(file);
  assert.equal(out.metadata.search_engine,'template');
  assert.equal(out.metadata.model,'none');
  assert.equal(out.features[0].properties.origin,'image_template_candidate');
  assert.match(out.metadata.method,/pixel-template/);
});
