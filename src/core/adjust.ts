// Ports of invert_lightness and logo_contrast.

import { SPLASH_BG_RGB } from './constants';
import { LINEAR_LUT, labToSrgb, linearToLab, relativeLuminance } from './color';
import { roundHalfEven } from './round';
import { createImage, type RGBAImage } from './types';

/** Flip Lab lightness (L -> 100 - L), keep hue/chroma and alpha. Per pixel, cached per color. */
export function invertLightness(img: RGBAImage): RGBAImage {
  const out = createImage(img.width, img.height);
  const src = img.data, o = out.data;
  const lab = new Float64Array(3), rgb = new Float64Array(3);
  const cache = new Map<number, number>();
  for (let i = 0; i < src.length; i += 4) {
    const key = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
    let packed = cache.get(key);
    if (packed === undefined) {
      linearToLab(LINEAR_LUT[src[i]], LINEAR_LUT[src[i + 1]], LINEAR_LUT[src[i + 2]], lab);
      labToSrgb(100.0 - lab[0], lab[1], lab[2], rgb);
      packed = (roundHalfEven(rgb[0]) << 16) | (roundHalfEven(rgb[1]) << 8) | roundHalfEven(rgb[2]);
      if (cache.size < 1 << 20) cache.set(key, packed);
    }
    o[i] = (packed >> 16) & 255;
    o[i + 1] = (packed >> 8) & 255;
    o[i + 2] = packed & 255;
    o[i + 3] = src[i + 3];
  }
  return out;
}

/** WCAG contrast ratio between the alpha-weighted mean logo luminance and the splash bg. */
export function logoContrast(img: RGBAImage, bg: readonly number[] = SPLASH_BG_RGB): number {
  const d = img.data;
  let sumW = 0;
  let sumYW = 0;
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3] / 255.0;
    const y = LINEAR_LUT[d[i]] * 0.2126 + LINEAR_LUT[d[i + 1]] * 0.7152 + LINEAR_LUT[d[i + 2]] * 0.0722;
    sumYW += y * w;
    sumW += w;
  }
  if (sumW === 0) return 1.0;
  const yLogo = sumYW / sumW;
  const yBg = relativeLuminance(bg[0], bg[1], bg[2]);
  const hi = Math.max(yLogo, yBg), lo = Math.min(yLogo, yBg);
  return (hi + 0.05) / (lo + 0.05);
}
