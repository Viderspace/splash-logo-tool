/// <reference lib="webworker" />
// Runs decoding, the pipeline and PNG encoding off the main thread.
// Messages are handled strictly in order; the main thread coalesces requests.

import { encode } from 'fast-png';
import { BackgroundError } from '../core/errors';
import { processLogo, type ProcessResult } from '../core/pipeline';
import { resizeRGBA } from '../core/resample';
import type { ProcessOptions, RGBAImage } from '../core/types';
import { roundHalfEven } from '../core/round';
import { decodeImageBytes } from './decode';
import type { ProcessFailure, Quality, WorkerRequest, WorkerResponse } from './protocol';

/** Long side of the reduced-resolution source used while a slider is dragged. */
const PREVIEW_MAX_SIDE = 512;

let source: RGBAImage | null = null;
let previewSource: RGBAImage | null = null;
/** Last full-resolution result (outcome of one option set) for download. */
let fullCache: { key: string; result: ProcessResult | ProcessFailure } | null = null;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

function optionsKey(o: ProcessOptions): string {
  return JSON.stringify([o.tolLow, o.tolHigh, o.keepHoles, o.invert, o.keepBg]);
}

function getPreviewSource(src: RGBAImage): RGBAImage {
  if (!previewSource) {
    const long = Math.max(src.width, src.height);
    if (long <= PREVIEW_MAX_SIDE) {
      previewSource = src;
    } else {
      const s = PREVIEW_MAX_SIDE / long;
      previewSource = resizeRGBA(
        src,
        Math.max(1, roundHalfEven(src.width * s)),
        Math.max(1, roundHalfEven(src.height * s)),
      );
    }
  }
  return previewSource;
}

function run(img: RGBAImage, options: ProcessOptions): ProcessResult | ProcessFailure {
  try {
    return processLogo(img, options);
  } catch (e) {
    if (e instanceof BackgroundError) return { kind: e.kind, message: e.message };
    return { kind: 'internal', message: `Unexpected error: ${(e as Error).message}` };
  }
}

function runFull(options: ProcessOptions): ProcessResult | ProcessFailure {
  const key = optionsKey(options);
  if (fullCache?.key !== key) {
    const r = run(source!, options);
    // Don't keep the source-resolution intermediate alive between requests.
    fullCache = { key, result: isFailure(r) ? r : { ...r, removed: null } };
  }
  return fullCache.result;
}

function isFailure(r: ProcessResult | ProcessFailure): r is ProcessFailure {
  return 'kind' in r;
}

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  try {
    if (req.type === 'load') {
      source = previewSource = null;
      fullCache = null;
      const decoded = await decodeImageBytes(new Uint8Array(req.bytes));
      source = decoded.image;
      // Build the reduced copy now, so the first slider drag is already fast.
      getPreviewSource(source);
      post({
        type: 'loaded',
        id: req.id,
        width: source.width,
        height: source.height,
        format: decoded.format,
        exifOrientation: decoded.exifOrientation,
        ms: performance.now() - t0,
      });
      return;
    }
    if (!source) throw new Error('No image loaded.');

    if (req.type === 'process') {
      const quality: Quality = req.quality;
      const img = quality === 'preview' ? getPreviewSource(source) : source;
      const r = quality === 'preview' ? run(img, req.options) : runFull(req.options);
      const base = {
        type: 'processed' as const,
        id: req.id,
        quality,
        options: req.options,
        processedSize: [img.width, img.height] as [number, number],
      };
      if (isFailure(r)) {
        post({ ...base, ms: performance.now() - t0, result: { ok: false, error: r } });
      } else {
        // Copy: the full-resolution buffer stays cached for download.
        const output = r.output.data.slice().buffer;
        post({ ...base, ms: performance.now() - t0, result: { ok: true, report: r.report, output } }, [output]);
      }
      return;
    }

    if (req.type === 'encode') {
      const r = runFull(req.options);
      if (isFailure(r)) throw new Error(r.message);
      // Encode straight from the RGBA buffer: lossless, no canvas involved.
      const png = encode({ width: r.output.width, height: r.output.height, data: r.output.data, channels: 4, depth: 8 });
      const buf = png.slice().buffer;
      post({ type: 'encoded', id: req.id, png: buf, ms: performance.now() - t0 }, [buf]);
    }
  } catch (e) {
    post({ type: 'error', id: req.id, message: (e as Error).message });
  }
};
