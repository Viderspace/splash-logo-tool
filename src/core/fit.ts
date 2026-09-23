// Port of fit_in_circle: trim, scale so the farthest opaque pixel touches the
// circle, resize in premultiplied alpha, center on the transparent canvas.

import { alphaCompositeInto } from './composite';
import { CANVAS_SIZE, CIRCLE_DIAMETER, EXTENT_ALPHA_MIN } from './constants';
import { BackgroundError } from './errors';
import { resizeRGBA } from './resample';
import { roundHalfEven } from './round';
import { createImage, type RGBAImage } from './types';

export interface FitInfo {
  /** Crop box in source coordinates: [x0, y0, x1, y1) */
  crop: [number, number, number, number];
  radius: number;
  scale: number;
  newSize: [number, number];
  offset: [number, number];
}

export function crop(img: RGBAImage, x0: number, y0: number, x1: number, y1: number): RGBAImage {
  const w = x1 - x0, h = y1 - y0;
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    const start = ((y + y0) * img.width + x0) * 4;
    out.data.set(img.data.subarray(start, start + w * 4), y * w * 4);
  }
  return out;
}

export function fitInCircle(logo: RGBAImage): { image: RGBAImage; fit: FitInfo } {
  const { width: w, height: h, data } = logo;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
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
  if (x1 < 0) throw new BackgroundError('empty', 'Nothing left after background removal.');
  x1 += 1;
  y1 += 1;

  // Center = bounding box center (cropped coords); radius over pixel centers,
  // + half pixel diagonal so the pixel's footprint fits.
  const cx = (x1 - x0) / 2.0, cy = (y1 - y0) / 2.0;
  let maxD2 = 0;
  for (let y = y0; y < y1; y++) {
    const dy = y - y0 + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      if (data[(y * w + x) * 4 + 3] < EXTENT_ALPHA_MIN) continue;
      const dx = x - x0 + 0.5 - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) maxD2 = d2;
    }
  }
  // sqrt is monotonic, so sqrt(max d^2) == max sqrt(d^2).
  const radius = Math.sqrt(maxD2) + Math.sqrt(0.5);

  const cropped = crop(logo, x0, y0, x1, y1);
  const scale = CIRCLE_DIAMETER / 2.0 / radius;
  const newW = Math.max(1, roundHalfEven(cropped.width * scale));
  const newH = Math.max(1, roundHalfEven(cropped.height * scale));
  const resized = resizeRGBA(cropped, newW, newH);

  const canvas = createImage(CANVAS_SIZE, CANVAS_SIZE);
  const ox = Math.floor((CANVAS_SIZE - newW) / 2), oy = Math.floor((CANVAS_SIZE - newH) / 2);
  alphaCompositeInto(canvas, resized, ox, oy);
  return {
    image: canvas,
    fit: { crop: [x0, y0, x1, y1], radius, scale, newSize: [newW, newH], offset: [ox, oy] },
  };
}
