// Dev-only: times the real worker on a large synthetic logo (PNG file bytes ->
// load/decode -> full-resolution process -> PNG encode, plus a slider preview run).

import { encode } from 'fast-png';
import { DEFAULT_OPTIONS } from '../src/core/pipeline';
import { ProcessorClient } from '../src/ui/workerClient';

/** White background, dark anti-aliased ring with an enclosed hole, and colored bars. */
function syntheticLogo(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4).fill(255);
  const cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * 0.18, r1 = Math.min(w, h) * 0.3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, r1 - d + 0.5, d - r0 + 0.5));
      const i = (y * w + x) * 4;
      if (cov > 0) {
        data[i] = 255 - cov * 225;
        data[i + 1] = 255 - cov * 215;
        data[i + 2] = 255 - cov * 165;
      }
      const inBar = y > h * 0.8 && y < h * 0.86 && x > w * 0.2 && x < w * 0.8;
      if (inBar) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 50; }
    }
  }
  return data;
}

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };

let prepared: { width: number; height: number; png: ArrayBuffer } | null = null;

/** Step 1: build the synthetic PNG (page memory; done before the memory baseline). */
function preparePerf(width: number, height: number) {
  const t = performance.now();
  const png = encode({ width, height, data: syntheticLogo(width, height), channels: 4, depth: 8 });
  prepared = { width, height, png: png.slice().buffer };
  log(`${width}x${height}: synthetic PNG ${(png.byteLength / 1e6).toFixed(1)} MB generated in ${Math.round(performance.now() - t)} ms`);
  return { bytes: png.byteLength };
}

/** Step 2: run the real worker on it. */
async function runPerf() {
  if (!prepared) throw new Error('call preparePerf first');
  const { width, height, png } = prepared;
  prepared = null;
  const client = new ProcessorClient();
  const t0 = performance.now();
  const loaded = await client.call({ type: 'load', bytes: png }, [png]);
  const tLoad = performance.now() - t0;
  const full = await client.call({ type: 'process', options: DEFAULT_OPTIONS, quality: 'full' });
  const preview1 = await client.call({ type: 'process', options: { ...DEFAULT_OPTIONS, tolHigh: 30 }, quality: 'preview' });
  const preview2 = await client.call({ type: 'process', options: { ...DEFAULT_OPTIONS, tolHigh: 31 }, quality: 'preview' });
  const enc = await client.call({ type: 'encode', options: DEFAULT_OPTIONS });
  const ms = (r: typeof full) => (r.type === 'processed' ? Math.round(r.ms) : r.type);
  client.terminate();
  const r = {
    size: `${width}x${height}`,
    loaded: loaded.type,
    loadDecodeMs: Math.round(tLoad),
    fullProcessMs: ms(full),
    fullOk: full.type === 'processed' && full.result.ok,
    firstPreviewMs: ms(preview1),
    nextPreviewMs: ms(preview2),
    previewSize: preview1.type === 'processed' ? preview1.processedSize : null,
    encodeCachedMs: enc.type === 'encoded' ? Math.round(enc.ms) : enc.type,
  };
  log(JSON.stringify(r));
  return r;
}

Object.assign(window, { preparePerf, runPerf });
