// Port of Pillow's ImagingAlphaComposite (AlphaComposite.c), used by
// Image.alpha_composite(logo, dest) in the reference.

import type { RGBAImage } from './types';

const PRECISION_BITS = 7;

function shiftForDiv255(a: number): number {
  return ((a >>> 8) + a) >>> 8;
}

/** Composite `src` over `dst` in place at (dx, dy). Both straight RGBA; src must fit inside dst. */
export function alphaCompositeInto(dst: RGBAImage, src: RGBAImage, dx: number, dy: number): void {
  const d = dst.data, s = src.data;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const di = ((y + dy) * dst.width + (x + dx)) * 4;
      const sa = s[si + 3];
      if (sa === 0) continue; // out = dst
      const da = d[di + 3];
      const blend = da * (255 - sa);
      const outa255 = sa * 255 + blend;
      const coef1 = Math.trunc((sa * 255 * 255 * (1 << PRECISION_BITS)) / outa255);
      const coef2 = 255 * (1 << PRECISION_BITS) - coef1;
      const round = 0x80 << PRECISION_BITS;
      d[di] = shiftForDiv255(s[si] * coef1 + d[di] * coef2 + round) >>> PRECISION_BITS;
      d[di + 1] = shiftForDiv255(s[si + 1] * coef1 + d[di + 1] * coef2 + round) >>> PRECISION_BITS;
      d[di + 2] = shiftForDiv255(s[si + 2] * coef1 + d[di + 2] * coef2 + round) >>> PRECISION_BITS;
      d[di + 3] = shiftForDiv255(outa255 + 0x80);
    }
  }
}
