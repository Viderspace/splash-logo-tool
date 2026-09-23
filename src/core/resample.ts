// Separable Lanczos (a=3) resize on premultiplied 8-bit RGBA: a port of
// Pillow's Resample.c (precompute_coeffs, normalize_coeffs_8bpc,
// ImagingResampleHorizontal_8bpc / Vertical_8bpc, ImagingResampleInner),
// plus Pillow's RGBA <-> RGBa conversions from Convert.c. Kernel support
// scales with the downscale factor, as in Pillow.

import { createImage, type RGBAImage } from './types';

const PRECISION_BITS = 32 - 8 - 2;
const LANCZOS_SUPPORT = 3.0;

function sinc(x: number): number {
  if (x === 0.0) return 1.0;
  x = x * Math.PI;
  return Math.sin(x) / x;
}

function lanczos(x: number): number {
  if (-3.0 <= x && x < 3.0) return sinc(x) * sinc(x / 3);
  return 0.0;
}

interface Coeffs {
  ksize: number;
  bounds: Int32Array; // [xmin, count] per output pixel
  kk: Int32Array; // fixed-point coefficients, ksize per output pixel
}

function precomputeCoeffs(inSize: number, outSize: number): Coeffs {
  const in0 = 0, in1 = inSize;
  const scale = (in1 - in0) / outSize;
  const filterscale = scale < 1.0 ? 1.0 : scale;
  const support = LANCZOS_SUPPORT * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const kk = new Float64Array(outSize * ksize);
  const bounds = new Int32Array(outSize * 2);
  for (let xx = 0; xx < outSize; xx++) {
    const center = in0 + (xx + 0.5) * scale;
    let ww = 0.0;
    const ss = 1.0 / filterscale;
    let xmin = Math.trunc(center - support + 0.5); // C (int) cast truncates
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    const k = xx * ksize;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      kk[k + x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) if (ww !== 0.0) kk[k + x] /= ww;
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  // normalize_coeffs_8bpc
  const fixed = new Int32Array(kk.length);
  const one = 1 << PRECISION_BITS;
  for (let i = 0; i < kk.length; i++) {
    fixed[i] = kk[i] < 0 ? Math.trunc(-0.5 + kk[i] * one) : Math.trunc(0.5 + kk[i] * one);
  }
  return { ksize, bounds, kk: fixed };
}

function clip8(ss: number): number {
  const v = ss >> PRECISION_BITS;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const HALF = 1 << (PRECISION_BITS - 1);

function resampleHorizontal(src: RGBAImage, outW: number, rowOffset: number, rows: number, c: Coeffs): RGBAImage {
  const out = createImage(outW, rows);
  const s = src.data, o = out.data, sw = src.width;
  for (let yy = 0; yy < rows; yy++) {
    const rowBase = (yy + rowOffset) * sw;
    for (let xx = 0; xx < outW; xx++) {
      const xmin = c.bounds[xx * 2], xmax = c.bounds[xx * 2 + 1];
      const kb = xx * c.ksize;
      let s0 = HALF, s1 = HALF, s2 = HALF, s3 = HALF;
      for (let x = 0; x < xmax; x++) {
        const k = c.kk[kb + x];
        const i = (rowBase + x + xmin) * 4;
        s0 += s[i] * k;
        s1 += s[i + 1] * k;
        s2 += s[i + 2] * k;
        s3 += s[i + 3] * k;
      }
      const oi = (yy * outW + xx) * 4;
      o[oi] = clip8(s0);
      o[oi + 1] = clip8(s1);
      o[oi + 2] = clip8(s2);
      o[oi + 3] = clip8(s3);
    }
  }
  return out;
}

function resampleVertical(src: RGBAImage, outH: number, c: Coeffs, boundsShift: number): RGBAImage {
  const w = src.width;
  const out = createImage(w, outH);
  const s = src.data, o = out.data;
  for (let yy = 0; yy < outH; yy++) {
    const kb = yy * c.ksize;
    const ymin = c.bounds[yy * 2] - boundsShift, ymax = c.bounds[yy * 2 + 1];
    for (let xx = 0; xx < w; xx++) {
      let s0 = HALF, s1 = HALF, s2 = HALF, s3 = HALF;
      for (let y = 0; y < ymax; y++) {
        const k = c.kk[kb + y];
        const i = ((y + ymin) * w + xx) * 4;
        s0 += s[i] * k;
        s1 += s[i + 1] * k;
        s2 += s[i + 2] * k;
        s3 += s[i + 3] * k;
      }
      const oi = (yy * w + xx) * 4;
      o[oi] = clip8(s0);
      o[oi + 1] = clip8(s1);
      o[oi + 2] = clip8(s2);
      o[oi + 3] = clip8(s3);
    }
  }
  return out;
}

/** Lanczos resize of a premultiplied ("RGBa") buffer, like Pillow's Image.resize(LANCZOS). */
export function resizePremultiplied(src: RGBAImage, outW: number, outH: number): RGBAImage {
  if (src.width === outW && src.height === outH) {
    return { width: outW, height: outH, data: new Uint8ClampedArray(src.data) };
  }
  const needH = outW !== src.width;
  const needV = outH !== src.height;
  const ch = precomputeCoeffs(src.width, outW);
  const cv = precomputeCoeffs(src.height, outH);
  let img = src;
  let shift = 0;
  if (needH) {
    // Only rows used by the vertical pass are resampled horizontally.
    const first = cv.bounds[0];
    const last = cv.bounds[outH * 2 - 2] + cv.bounds[outH * 2 - 1];
    img = resampleHorizontal(src, outW, first, last - first, ch);
    shift = first;
  }
  if (needV) img = resampleVertical(img, outH, cv, shift);
  return img;
}

/** Pillow RGBA -> RGBa (Convert.c rgbA2rgba, MULDIV255 rounding). */
export function premultiply(img: RGBAImage): RGBAImage {
  const out = createImage(img.width, img.height);
  const s = img.data, o = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    let t = s[i] * a + 128;
    o[i] = ((t >> 8) + t) >> 8;
    t = s[i + 1] * a + 128;
    o[i + 1] = ((t >> 8) + t) >> 8;
    t = s[i + 2] * a + 128;
    o[i + 2] = ((t >> 8) + t) >> 8;
    o[i + 3] = a;
  }
  return out;
}

/** Pillow RGBa -> RGBA (Convert.c rgba2rgbA, truncating division). */
export function unpremultiply(img: RGBAImage): RGBAImage {
  const out = createImage(img.width, img.height);
  const s = img.data, o = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    if (a === 255 || a === 0) {
      o[i] = s[i];
      o[i + 1] = s[i + 1];
      o[i + 2] = s[i + 2];
    } else {
      o[i] = Math.min(255, Math.trunc((255 * s[i]) / a));
      o[i + 1] = Math.min(255, Math.trunc((255 * s[i + 1]) / a));
      o[i + 2] = Math.min(255, Math.trunc((255 * s[i + 2]) / a));
    }
    o[i + 3] = a;
  }
  return out;
}

/** Straight RGBA Lanczos resize the way Pillow does it for RGBA (via premultiplied). */
export function resizeRGBA(img: RGBAImage, outW: number, outH: number): RGBAImage {
  return unpremultiply(resizePremultiplied(premultiply(img), outW, outH));
}
