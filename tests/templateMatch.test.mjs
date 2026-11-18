import test from 'node:test';
import assert from 'node:assert/strict';
import { sampledSimilarity, scanTemplatePixels } from '../src/services/templateMatch.ts';

function image(width = 90, height = 90) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const value = (x * 13 + y * 17 + (x * y) % 19) % 48 + 75;
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  return { width, height, data };
}
function addObject(img, x, y, width = 12, height = 12) {
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const p = ((y + j) * img.width + (x + i)) * 4;
    const value = ((i * 7 + j * 11 + i * j * 4) % 150) + 40;
    img.data[p] = value; img.data[p + 1] = value; img.data[p + 2] = value;
  }
}

test('normalized brightness pattern comparisons support contrast changes', () => {
  assert.ok(sampledSimilarity([2, 4, 3, 8], [10, 14, 12, 22]) > .9999);
  assert.ok(sampledSimilarity([3, 5, 7], [7, 5, 3]) < -.999);
  assert.equal(sampledSimilarity([4, 4, 4], [2, 2, 2]), -1);
});

test('real pixel matching finds a repeated exemplar elsewhere in an image', async () => {
  const img = image();
  addObject(img, 12, 15);
  addObject(img, 54, 45);
  let updates = 0;
  const result = await scanTemplatePixels(img, { x: 12, y: 15, width: 12, height: 12 }, .75, () => { updates++; }, () => false);
  assert.ok(result.examined > 500);
  assert.ok(updates > 0);
  assert.equal(result.mode, 'template');
  assert.ok(result.bestScore > .9);
  assert.ok(result.hits.some(h => Math.abs(h.box.x - 54) <= 3 && Math.abs(h.box.y - 45) <= 3));
});

test('no passing matches still reports the best observed score', async () => {
  const img = image(); addObject(img, 12, 15);
  const result = await scanTemplatePixels(img, { x: 12, y: 15, width: 12, height: 12 }, 1, () => {}, () => false);
  assert.equal(result.hits.length, 0);
  assert.ok(Number.isFinite(result.bestScore));
  assert.ok(result.examined > 0);
});

test('invalid image, oversized selection and cancellation are explicit failures', async () => {
  const img = image();
  await assert.rejects(scanTemplatePixels({ width: 90, height: 90, data: new Uint8Array(10) }, { x: 12, y: 12, width: 12, height: 12 }, .5, () => {}, () => false), /Invalid image/);
  await assert.rejects(scanTemplatePixels(img, { x: 88, y: 89, width: 12, height: 12 }, .5, () => {}, () => false), /larger example/);
  await assert.rejects(scanTemplatePixels(img, { x: 12, y: 12, width: 12, height: 12 }, .5, () => {}, () => true), /cancelled/);
});
