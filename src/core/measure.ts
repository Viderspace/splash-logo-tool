// Measurements on a finished canvas (used by tests and the UI).

import { EXTENT_ALPHA_MIN } from './constants';
import type { RGBAImage } from './types';

/** Bounding box [x0, y0, x1, y1) of pixels with alpha >= EXTENT_ALPHA_MIN, or null. */
export function alphaBBox(img: RGBAImage): [number, number, number, number] | null {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] >= EXTENT_ALPHA_MIN) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/**
 * Distance from the canvas center to the farthest pixel footprint with
 * alpha >= EXTENT_ALPHA_MIN (pixel center distance + half diagonal).
 */
export function measuredRadius(img: RGBAImage): number {
  const { width: w, height: h, data } = img;
  const cx = w / 2, cy = h / 2;
  let maxD2 = -1;
  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < EXTENT_ALPHA_MIN) continue;
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) maxD2 = d2;
    }
  }
  return maxD2 < 0 ? 0 : Math.sqrt(maxD2) + Math.SQRT1_2;
}
