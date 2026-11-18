/** Bounded, reproducible similarity search on a georeferenced orthophoto. */
export type PixelBox = { x: number; y: number; width: number; height: number };
export type ImageBounds = { west: number; east: number; north: number; south: number; corners?: [number, number][] };
export type SimilarityHit = { box: PixelBox; similarity: number };
export type ReviewState = 'unreviewed' | 'accepted' | 'rejected';
export type SimilarityDetection = SimilarityHit & { id: string; className: string; review: ReviewState };

export const MODEL_ID = 'Xenova/dinov2-small';
export const MAX_SCAN_WINDOWS = 64;
export type SearchEngine = 'template' | 'dinov2' | 'owlvit';

export function boundsFromCorners(corners: number[][]): ImageBounds {
  if (corners.length !== 4 || corners.some(v => v.length !== 2 || v.some(n => !Number.isFinite(n)))) throw new Error('Invalid image georeferencing');
  return { west: Math.min(...corners.map(p => p[0])), east: Math.max(...corners.map(p => p[0])), south: Math.min(...corners.map(p => p[1])), north: Math.max(...corners.map(p => p[1])), corners: corners.map(p=>[p[0],p[1]]) };
}
/** Bilinear interpolation of the actual four geographic image corners (NW, NE, SE, SW).
 * Corrects the skew from an ETRS89/UTM raster being displayed in WGS84. */
function interpolate(u:number,v:number,corners:[number,number][]):[number,number] {
  const [nw,ne,se,sw]=corners;
  const weights=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];
  return [nw[0]*weights[0]+ne[0]*weights[1]+se[0]*weights[2]+sw[0]*weights[3],
    nw[1]*weights[0]+ne[1]*weights[1]+se[1]*weights[2]+sw[1]*weights[3]];
}
export function geoToPixel(lon:number,lat:number,b:ImageBounds,width:number,height:number):[number,number] {
  if(!(b.east>b.west&&b.north>b.south&&width>0&&height>0))throw new Error('Invalid image reference');
  let u=(lon-b.west)/(b.east-b.west),v=(b.north-lat)/(b.north-b.south);
  if(b.corners){
    // Invert the bilinear warp by Newton iterations; converges rapidly on small orthophotos.
    const c=b.corners;
    for(let i=0;i<12;i++) {
      const [lon0,lat0]=interpolate(u,v,c);
      const du:[number,number]=[(1-v)*(c[1][0]-c[0][0])+v*(c[2][0]-c[3][0]),(1-v)*(c[1][1]-c[0][1])+v*(c[2][1]-c[3][1])];
      const dv:[number,number]=[(1-u)*(c[3][0]-c[0][0])+u*(c[2][0]-c[1][0]),(1-u)*(c[3][1]-c[0][1])+u*(c[2][1]-c[1][1])];
      const det=du[0]*dv[1]-du[1]*dv[0];
      if(Math.abs(det)<1e-15)throw new Error('Degenerate imagery transform');
      const dx=lon-lon0,dy=lat-lat0;
      const deltaU=(dx*dv[1]-dy*dv[0])/det,deltaV=(du[0]*dy-du[1]*dx)/det;
      u+=deltaU;v+=deltaV;
      if(Math.max(Math.abs(deltaU),Math.abs(deltaV))<1e-10)break;
    }
  }
  return [u*width,v*height];
}
export function pixelToGeo(x:number,y:number,b:ImageBounds,width:number,height:number):[number,number] {
  if(!(b.east>b.west&&b.north>b.south&&width>0&&height>0))throw new Error('Invalid image reference');
  const u=x/width,v=y/height;
  return b.corners?interpolate(u,v,b.corners):[b.west+u*(b.east-b.west),b.north-v*(b.north-b.south)];
}
export function boxFromPixels(a: [number,number], c: [number,number], width: number, height: number): PixelBox {
  const x = Math.min(a[0], c[0]), y = Math.min(a[1], c[1]);
  const w = Math.abs(a[0]-c[0]), h = Math.abs(a[1]-c[1]);
  if (!([x,y,w,h].every(Number.isFinite) && w >= 8 && h >= 8 && x >= 0 && y >= 0 && x+w <= width && y+h <= height)) throw new Error('Draw a box at least 8 × 8 image pixels within the aerial photograph');
  return { x, y, width: w, height: h };
}
export function polygonForBox(box: PixelBox, b: ImageBounds, width: number, height: number): [number,number][][] {
  const { x, y, width:w, height:h } = box;
  const pts: [number,number][] = [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
  return [pts.map(([px,py])=>pixelToGeo(px,py,b,width,height))];
}
export function overlapIoU(a: PixelBox, b: PixelBox): number {
  const x = Math.max(0, Math.min(a.x+a.width,b.x+b.width) - Math.max(a.x,b.x));
  const y = Math.max(0, Math.min(a.y+a.height,b.y+b.height) - Math.max(a.y,b.y));
  const intersection = x*y;
  return intersection / (a.width*a.height+b.width*b.height-intersection || 1);
}
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || a.length !== b.length) throw new Error('Incompatible embedding dimensions');
  let dot=0, na=0, nb=0;
  for (let i=0;i<a.length;i++) { const x=a[i], y=b[i]; if (!Number.isFinite(x)||!Number.isFinite(y)) throw new Error('Non-finite embedding'); dot+=x*y; na+=x*x; nb+=y*y; }
  if (!na || !nb) throw new Error('Empty embedding');
  return Math.max(-1,Math.min(1,dot/Math.sqrt(na*nb)));
}
/** Construct a spatially distributed shortlist, not an exhaustive dense detector. */
export function sampleWindows(example: PixelBox, imageWidth: number, imageHeight: number, limit=MAX_SCAN_WINDOWS): PixelBox[] {
  if (!(limit>=1 && limit<=MAX_SCAN_WINDOWS && imageWidth>0 && imageHeight>0)) throw new Error('Invalid search budget');
  const windows: PixelBox[]=[];
  const seen=new Set<string>();
  for (const factor of [1, 0.75, 1.35]) {
    const w=Math.max(8, Math.min(imageWidth,Math.round(example.width*factor)));
    const h=Math.max(8, Math.min(imageHeight,Math.round(example.height*factor)));
    const cols=Math.max(1,Math.floor(Math.sqrt(limit * imageWidth/imageHeight * h/w)));
    const rows=Math.max(1,Math.ceil(limit / cols / 3));
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
      const x=Math.round((c+.5)/cols*(imageWidth-w));
      const y=Math.round((r+.5)/rows*(imageHeight-h));
      const box={x,y,width:w,height:h};
      const key=`${x}:${y}:${w}:${h}`;
      if (!seen.has(key)&&overlapIoU(box,example)<0.65) {seen.add(key);windows.push(box);}
    }
  }
  // Round-robin ordered across scales keeps the budget bounded.
  return windows.slice(0,limit);
}
export function rankAndSuppress(hits: SimilarityHit[], threshold: number, maxResults=16): SimilarityHit[] {
  if (!Number.isFinite(threshold) || threshold< -1 || threshold>1) throw new Error('Invalid similarity threshold');
  const ranked=hits.filter(h=>Number.isFinite(h.similarity)&&h.similarity>=threshold).sort((a,b)=>b.similarity-a.similarity);
  const kept: SimilarityHit[]=[];
  for(const hit of ranked){if(kept.length>=maxResults)break;if(kept.every(other=>overlapIoU(other.box,hit.box)<0.35))kept.push(hit);}
  return kept;
}
export function exportDetections(detections: SimilarityDetection[], exemplar: PixelBox | null, b: ImageBounds, width: number, height: number, imageryYear: number, examined: number, engine: SearchEngine = 'dinov2'): string {
  const model = engine === 'dinov2' ? MODEL_ID : engine === 'owlvit' ? 'Xenova/owlvit-base-patch32' : 'none';
  const method = engine === 'dinov2' ? 'DINOv2 image embeddings; bounded multi-scale sliding-window similarity and NMS' : engine === 'owlvit' ? 'OWL-ViT zero-shot text-guided object detection; four 512px tiles; NMS' : 'Local pixel-template normalized cross-correlation; 8x8 brightness sampling, multi-scale scanning and NMS';
  const scoreDefinition = engine === 'dinov2' ? 'cosine similarity, not calibrated object probability' : engine === 'owlvit' ? 'model-provided detection score; NOT calibrated for aerial imagery' : 'normalized cross-correlation of sampled pixel brightness, not calibrated object probability';
  const features = detections.map(hit=>({type:'Feature' as const,id:hit.id,geometry:{type:'Polygon' as const,coordinates:polygonForBox(hit.box,b,width,height)},properties:{detection_id:hit.id,class_name:hit.className,score:Number(hit.similarity.toFixed(4)),...(engine === 'owlvit' ? { detection_score:Number(hit.similarity.toFixed(4)) } : { similarity_score:Number(hit.similarity.toFixed(4)) }),review_status:hit.review,origin:engine === 'owlvit' ? 'zero_shot_model_candidate' : engine === 'dinov2' ? 'model_similarity_candidate' : 'image_template_candidate',model,method:engine}}));
  return JSON.stringify({type:'FeatureCollection',features,metadata:{schema:'geoai-similarity-v1',crs:'EPSG:4326',model,method,score_definition:scoreDefinition,search_engine:engine,evaluation_status:'unvalidated exploratory results',annotation_source:engine === 'owlvit' ? 'user-selected text class; no exemplar used' : 'one human-selected exemplar box',exemplar_pixel_box:exemplar,imagery:'Geoportal Berlin DOP RGB',imagery_year:imageryYear,windows_evaluated:examined,imagery_boundary:b,georeferencing:'image-coordinate affine approximation; not survey-grade',source_license:'dl-de/zero-2-0'}},null,2);
}
