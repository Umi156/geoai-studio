/** Lightweight image-embedding adapter. Runtime model weights are downloaded on first use. */
import { MODEL_ID, cosineSimilarity, sampleWindows, rankAndSuppress, MAX_SCAN_WINDOWS } from './similarity';
import type { PixelBox, SimilarityHit } from './similarity';

export type ScanProgress = { completed: number; total: number; stage: string };
export type ScanResult = { hits: SimilarityHit[]; examined: number; model: string; bestScore: number | null };

function cropAsDataUrl(image: ImageBitmap, box: PixelBox): string {
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(8,Math.round(box.width));
  canvas.height=Math.max(8,Math.round(box.height));
  const ctx=canvas.getContext('2d', {willReadFrequently:false});
  if(!ctx) throw new Error('Image canvas is unavailable');
  ctx.drawImage(image,box.x,box.y,box.width,box.height,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png');
}

let extractorPromise: Promise<(input:string, options:object)=>Promise<{data:ArrayLike<number>}>> | null = null;
async function loadExtractor(): Promise<(input:string, options:object)=>Promise<{data:ArrayLike<number>}>> {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers').then(async ({pipeline})=> {
      const extractor = await pipeline('image-feature-extraction',MODEL_ID,{device:'wasm',dtype:'q8'});
      return extractor as unknown as (input:string,options:object)=>Promise<{data:ArrayLike<number>}>;
    }).catch(error=>{extractorPromise=null;throw error;});
  }
  return extractorPromise;
}
/** Uses actual pretrained DINOv2 embeddings. This is an exploratory shortlist, NOT dense instance segmentation. */
export async function findSimilarInImage(image: ImageBitmap, example: PixelBox, threshold: number,
  progress: (state:ScanProgress)=>void, isCancelled:()=>boolean): Promise<ScanResult> {
  progress({completed:0,total:MAX_SCAN_WINDOWS,stage:'Loading pretrained visual encoder (first run downloads model weights)…'});
  const extractor=await loadExtractor();
  if(isCancelled()) throw new Error('Scan cancelled');
  const options={pooling:'cls',normalize:true};
  const exemplar=await extractor(cropAsDataUrl(image,example),options);
  if(!exemplar?.data?.length) throw new Error('Visual encoder returned no exemplar embedding');
  const windows=sampleWindows(example,image.width,image.height,MAX_SCAN_WINDOWS);
  const samples:SimilarityHit[]=[];
  for (let i=0;i<windows.length;i++) {
    if(isCancelled()) throw new Error('Scan cancelled');
    const result=await extractor(cropAsDataUrl(image,windows[i]),options);
    if(!result?.data?.length) throw new Error('Visual encoder returned an empty embedding');
    samples.push({box:windows[i],similarity:cosineSimilarity(exemplar.data,result.data)});
    progress({completed:i+1,total:windows.length,stage:`Comparing image windows (${i+1}/${windows.length})…`});
    // Yield control so the progress UI and cancel button stay responsive.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  return {hits:rankAndSuppress(samples,threshold,16),examined:samples.length,model:MODEL_ID,bestScore:samples.length ? Math.max(...samples.map(s=>s.similarity)) : null};
}
