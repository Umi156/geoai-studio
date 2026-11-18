/** On-demand, browser-local text-guided detection. Not exemplar training or ground truth. */
import { rankAndSuppress } from './similarity.ts';
import type { PixelBox, SimilarityHit } from './similarity.ts';

export const ZERO_SHOT_MODEL_ID = 'Xenova/owlvit-base-patch32';
export const ZERO_SHOT_TILES = 4;
const TILE_SIZE = 512;
export type ZeroShotProgress = { completed: number; total: number; stage: string };
export type ZeroShotResult = { hits: SimilarityHit[]; examined: number; bestScore: number | null; model: string };
export type RawDetection = { score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } };

/** Model classes must be identified by the user, not guessed from the drawn sample. */
export function promptForClass(value: string): string {
  const known: Record<string, string> = {
    vehicle: 'car', solar_panel: 'solar panel', waste_site: 'pile of garbage',
    building: 'building', vegetation: 'tree', other: 'object',
  };
  return known[value] ?? 'object';
}

/** Convert one model-reported bounding box to a global image-pixel window. */
export function pixelHit(raw: RawDetection, offsetX: number, offsetY: number, tileWidth: number, tileHeight: number, imageWidth: number, imageHeight: number): SimilarityHit | null {
  if (!Number.isFinite(raw.score) || raw.score < 0 || raw.score > 1 || !raw.box) return null;
  const b = raw.box;
  if (![b.xmin, b.ymin, b.xmax, b.ymax].every(Number.isFinite)) return null;
  const x1 = Math.max(0, Math.min(tileWidth, b.xmin));
  const y1 = Math.max(0, Math.min(tileHeight, b.ymin));
  const x2 = Math.max(0, Math.min(tileWidth, b.xmax));
  const y2 = Math.max(0, Math.min(tileHeight, b.ymax));
  const box: PixelBox = { x: offsetX + x1, y: offsetY + y1, width: x2 - x1, height: y2 - y1 };
  if (box.width < 5 || box.height < 5 || box.x + box.width > imageWidth || box.y + box.height > imageHeight) return null;
  return { box, similarity: raw.score };
}

/** Convert scores and boxes, without manufacturing detections for empty model output. */
export function collectZeroShotHits(output: unknown, offsetX: number, offsetY: number, width: number, height: number, imageWidth: number, imageHeight: number): SimilarityHit[] {
  if (!Array.isArray(output)) throw new Error('Text detector returned an unexpected result format');
  const flat = output.flat(1);
  if (flat.length > 256) throw new Error('Text detector returned too many outputs');
  return flat.flatMap((d: unknown) => {
    if (!d || typeof d !== 'object' || !('box' in d) || !('score' in d)) return [];
    const hit = pixelHit(d as RawDetection, offsetX, offsetY, width, height, imageWidth, imageHeight);
    return hit ? [hit] : [];
  });
}

type DetectorOutput = { box: { xmin: number; ymin: number; xmax: number; ymax: number }; label: string; score: number };
type Detector = (imageUrl: string, labels: string[], options: { threshold: number; top_k: number }) => Promise<DetectorOutput[]>;
let detectorPromise: Promise<Detector> | null = null;
async function loadDetector(): Promise<Detector> {
  if (!detectorPromise) detectorPromise = import('@huggingface/transformers').then(async ({pipeline}) => {
    const instance = await pipeline('zero-shot-object-detection', ZERO_SHOT_MODEL_ID, { device: 'wasm', dtype: 'q8' });
    return instance as unknown as Detector;
  }).catch(error => { detectorPromise = null; throw error; });
  return detectorPromise;
}
function tileDataUrl(bitmap: ImageBitmap, left: number, top: number, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image canvas unavailable');
  ctx.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/** Search four non-overlapping 512px tiles; candidates remain unvalidated until reviewed. */
export async function findObjectsByText(image: ImageBitmap, category: string, threshold: number,
  progress: (p: ZeroShotProgress) => void, isCancelled: () => boolean): Promise<ZeroShotResult> {
  if (!Number.isFinite(threshold) || threshold < 0.01 || threshold > 0.9) throw new Error('Invalid detection threshold');
  if (image.width !== 1024 || image.height !== 1024) throw new Error('Text detection currently supports the prepared 1024 × 1024 Berlin image');
  const prompt = promptForClass(category);
  progress({ completed: 0, total: ZERO_SHOT_TILES, stage: `Loading OWL-ViT model for “${prompt}” (large one-time download)…` });
  const detector = await loadDetector();
  if (isCancelled()) throw new Error('Scan cancelled');
  const rawHits: SimilarityHit[] = [];
  const coords = [[0, 0], [TILE_SIZE, 0], [0, TILE_SIZE], [TILE_SIZE, TILE_SIZE]];
  for (let i = 0; i < coords.length; i++) {
    if (isCancelled()) throw new Error('Scan cancelled');
    const [left, top] = coords[i];
    progress({ completed: i, total: coords.length, stage: `Detecting “${prompt}” in image tile ${i + 1}/${coords.length}…` });
    const output = await detector(tileDataUrl(image, left, top, TILE_SIZE, TILE_SIZE), [prompt], { top_k: 48, threshold });
    rawHits.push(...collectZeroShotHits(output, left, top, TILE_SIZE, TILE_SIZE, image.width, image.height));
    progress({ completed: i + 1, total: coords.length, stage: `Processed ${i + 1}/${coords.length} aerial tiles` });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return { hits: rankAndSuppress(rawHits, threshold, 30), examined: coords.length,
    bestScore: rawHits.length ? Math.max(...rawHits.map(hit => hit.similarity)) : null,
    model: ZERO_SHOT_MODEL_ID };
}
