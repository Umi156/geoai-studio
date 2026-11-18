/** On-device image-template similarity search. This is classical pattern matching, not learned detection. */
import { overlapIoU, rankAndSuppress } from './similarity.ts';
import type { PixelBox, SimilarityHit } from './similarity.ts';

export type MatchProgress = { completed: number; total: number; stage: string };
export type MatchResult = { hits: SimilarityHit[]; examined: number; bestScore: number | null; mode: 'template' };
export type PixelImage = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

/** Fixed-size texture samples make comparisons feasible on older CPUs. */
function sample(image: PixelImage, x: number, y: number, width: number, height: number): number[] {
  const grid = 8;
  const samples: number[] = [];
  for (let row = 0; row < grid; row++) {
    const py = Math.min(image.height - 1, Math.floor(y + (row + .5) * height / grid));
    for (let col = 0; col < grid; col++) {
      const px = Math.min(image.width - 1, Math.floor(x + (col + .5) * width / grid));
      const i = (py * image.width + px) * 4;
      // Luma is relatively stable across different vehicle and roof colors.
      samples.push(image.data[i] * .2126 + image.data[i + 1] * .7152 + image.data[i + 2] * .0722);
    }
  }
  return samples;
}

function centered(values: number[]): { values: Float32Array; magnitude: number } {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const data = new Float32Array(values.length);
  let energy = 0;
  for (let i = 0; i < values.length; i++) {
    const n = values[i] - mean;
    data[i] = n;
    energy += n * n;
  }
  return { values: data, magnitude: Math.sqrt(energy) };
}

/** Normalized cross-correlation, invariant to uniform brightness/contrast changes. */
export function sampledSimilarity(template: number[], window: number[]): number {
  if (template.length !== window.length || template.length < 2) throw new Error('Incompatible image samples');
  const a = centered(template), b = centered(window);
  if (a.magnitude < 1 || b.magnitude < 1) return -1;
  let sum = 0;
  for (let i = 0; i < a.values.length; i++) sum += a.values[i] * b.values[i];
  return Math.max(-1, Math.min(1, sum / (a.magnitude * b.magnitude)));
}

/** Search the image across several box sizes and report score diagnostics even for zero matches. */
export async function scanTemplatePixels(
  image: PixelImage,
  example: PixelBox,
  threshold: number,
  progress: (state: MatchProgress) => void,
  isCancelled: () => boolean,
): Promise<MatchResult> {
  if (!(image.width >= 16 && image.height >= 16 && image.data.length === image.width * image.height * 4)) {
    throw new Error('Invalid image pixels');
  }
  if (!(threshold >= -1 && threshold <= 1)) throw new Error('Invalid matching threshold');
  if (!(example.width >= 8 && example.height >= 8 && example.x >= 0 && example.y >= 0 && example.x + example.width <= image.width && example.y + example.height <= image.height)) {
    throw new Error('Select a larger example box inside the photograph');
  }
  const exemplarSample = sample(image, example.x, example.y, example.width, example.height);
  const exemplarCentered = centered(exemplarSample);
  if (exemplarCentered.magnitude < 1) throw new Error('Example is nearly uniform. Draw around an object with visible edges or texture.');
  // Avoid allocating arrays in the tight scanning loop.
  const scoreAt = (x: number, y: number, w: number, h: number): number => {
    let total = 0, squares = 0, dot = 0, k = 0;
    for (let row = 0; row < 8; row++) {
      const py = Math.min(image.height - 1, Math.floor(y + (row + .5) * h / 8));
      for (let col = 0; col < 8; col++) {
        const px = Math.min(image.width - 1, Math.floor(x + (col + .5) * w / 8));
        const i = (py * image.width + px) * 4;
        const v = image.data[i] * .2126 + image.data[i + 1] * .7152 + image.data[i + 2] * .0722;
        total += v;
        squares += v * v;
        dot += exemplarCentered.values[k++] * v;
      }
    }
    const energy = Math.max(0, squares - total * total / 64);
    return energy < 1 ? -1 : Math.max(-1, Math.min(1, dot / (exemplarCentered.magnitude * Math.sqrt(energy))));
  };

  const scales = [1, .8, 1.25];
  const variants = scales.map(scale => {
    const w = Math.min(image.width, Math.max(8, Math.round(example.width * scale)));
    const h = Math.min(image.height, Math.max(8, Math.round(example.height * scale)));
    // Dense enough to see small objects while retaining a bounded CPU workload.
    const step = Math.max(2, Math.floor(Math.min(w, h) / 4));
    return { w, h, step, rows: Math.floor((image.height - h) / step) + 1, cols: Math.floor((image.width - w) / step) + 1 };
  });
  const totalRows = variants.reduce((n, v) => n + v.rows, 0);
  let completeRows = 0, examined = 0, bestScore = -Infinity;
  const aboveThreshold: SimilarityHit[] = [];
  for (const v of variants) {
    for (let row = 0; row < v.rows; row++) {
      if (isCancelled()) throw new Error('Search cancelled');
      const y = Math.min(row * v.step, image.height - v.h);
      for (let col = 0; col < v.cols; col++) {
        const x = Math.min(col * v.step, image.width - v.w);
        const box: PixelBox = { x, y, width: v.w, height: v.h };
        if (overlapIoU(box, example) > .3) continue;
        const score = scoreAt(x, y, v.w, v.h);
        examined += 1;
        if (score > bestScore) bestScore = score;
        if (score >= threshold) {
          aboveThreshold.push({ box, similarity: score });
          if (aboveThreshold.length >= 512) {
            aboveThreshold.sort((a, b) => b.similarity - a.similarity);
            aboveThreshold.length = 128;
          }
        }
      }
      completeRows++;
      if (row % 12 === 0 || completeRows === totalRows) {
        progress({ completed: completeRows, total: totalRows, stage: `Searching image regions (${examined.toLocaleString()} comparisons)…` });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
  }
  return { hits: rankAndSuppress(aboveThreshold, threshold, 24), examined, bestScore: Number.isFinite(bestScore) ? bestScore : null, mode: 'template' };
}

/** Decode a browser ImageBitmap once; keep memory bounded when the reference is very large. */
export async function findTemplateMatches(
  image: ImageBitmap, example: PixelBox, threshold: number,
  progress: (state: MatchProgress) => void, isCancelled: () => boolean,
): Promise<MatchResult> {
  const dimension = Math.min(image.width, image.height);
  const target = Math.min(dimension, Math.min(example.width, example.height) < 24 ? 1024 : Math.min(example.width, example.height) < 48 ? 768 : 512);
  const factor = target / dimension;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * factor);
  canvas.height = Math.round(image.height * factor);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('The browser does not support 2D image processing');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scaled: PixelBox = { x: example.x * factor, y: example.y * factor, width: example.width * factor, height: example.height * factor };
  if (scaled.width < 8 || scaled.height < 8) throw new Error('The selected object is too small for a meaningful comparison. Zoom in or select a larger feature.');
  const result = await scanTemplatePixels(pixels, scaled, threshold, progress, isCancelled);
  return { ...result, hits: result.hits.map(hit => ({...hit, box:{x:hit.box.x/factor,y:hit.box.y/factor,width:hit.box.width/factor,height:hit.box.height/factor}})) };
}
