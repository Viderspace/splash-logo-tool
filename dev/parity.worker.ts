/// <reference lib="webworker" />
// Decodes in a worker context, like production (same decodeImageBytes), and
// optionally with the browser's default createImageBitmap options for comparison.

import { decodeImageBytes } from '../src/worker/decode';

export interface DecodeRequest {
  id: number;
  bytes: ArrayBuffer;
  /** 'production' = the app's path; 'browserDefault' = createImageBitmap without options. */
  mode: 'production' | 'browserDefault';
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (ev: MessageEvent<DecodeRequest>) => {
  const { id, bytes, mode } = ev.data;
  try {
    if (mode === 'production') {
      const { image, format } = await decodeImageBytes(new Uint8Array(bytes));
      const buf = image.data.slice().buffer;
      scope.postMessage({ id, ok: true, width: image.width, height: image.height, data: buf, format }, [buf]);
    } else {
      const bmp = await createImageBitmap(new Blob([bytes]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const buf = ctx.getImageData(0, 0, bmp.width, bmp.height).data.slice().buffer;
      scope.postMessage({ id, ok: true, width: bmp.width, height: bmp.height, data: buf }, [buf]);
    }
  } catch (e) {
    scope.postMessage({ id, ok: false, error: String(e) });
  }
};
