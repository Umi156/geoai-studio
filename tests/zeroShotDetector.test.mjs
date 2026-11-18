import test from 'node:test';
import assert from 'node:assert/strict';
import { promptForClass, pixelHit, collectZeroShotHits, ZERO_SHOT_MODEL_ID } from '../src/services/zeroShotDetector.ts';
import { exportDetections, boundsFromCorners } from '../src/services/similarity.ts';

test('controlled class prompts cover cars, solar panels and suspected waste', () => {
  assert.equal(promptForClass('vehicle'), 'car');
  assert.equal(promptForClass('solar_panel'), 'solar panel');
  assert.equal(promptForClass('waste_site'), 'pile of garbage');
  assert.equal(promptForClass('some_unknown_class'), 'object');
  assert.ok(ZERO_SHOT_MODEL_ID.includes('owlvit'));
});

test('model boxes map correctly into a 1024px tiled orthophoto', () => {
  const output = [{label: 'car',score: 0.43,box: {xmin: 20,ymin: 40,xmax: 60,ymax: 75}}];
  const hits = collectZeroShotHits(output, 512, 0, 512, 512, 1024, 1024);
  assert.deepEqual(hits, [{box:{x:532,y:40,width:40,height:35},similarity:0.43}]);
});

test('invalid, negligible or malformed boxes are ignored rather than invented', () => {
  const raw = {label:'car',score:.9,box:{xmin:10,ymin:10,xmax:13,ymax:13}};
  assert.equal(pixelHit(raw, 0,0,512,512,1024,1024),null);
  assert.equal(pixelHit({...raw,score:2},0,0,512,512,1024,1024),null);
  assert.equal(collectZeroShotHits([],0,0,512,512,1024,1024).length,0);
  assert.throws(()=>collectZeroShotHits('wrong',0,0,512,512,1024,1024),/unexpected result/);
  assert.deepEqual(collectZeroShotHits([{label:'car',score:.05,box:{xmin:-20,ymin:30,xmax:15,ymax:60}}],0,0,512,512,1024,1024),[{box:{x:0,y:30,width:15,height:30},similarity:.05}]);
});

test('zero-shot GeoJSON export records actual detector and does not claim example learning', () => {
  const bounds = boundsFromCorners([[13.3,52.6],[13.4,52.6],[13.4,52.5],[13.3,52.5]]);
  const f={ id:'det-1',className:'vehicle',review:'unreviewed',similarity:.23,box:{x:200,y:300,width:20,height:15} };
  const data=JSON.parse(exportDetections([f],null,bounds,1024,1024,2025,4,'owlvit'));
  assert.equal(data.metadata.search_engine,'owlvit');
  assert.match(data.metadata.annotation_source,/no exemplar used/);
  assert.equal(data.features[0].properties.origin,'zero_shot_model_candidate');
  assert.equal(data.features[0].properties.score,.23);
});
