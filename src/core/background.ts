// Ports of has_existing_transparency and remove_background.
// Memory: one Float64Array (dist) plus Int32 labels at source resolution; Lab is
// computed per pixel and never stored.

import { BORDER_MATCH_MIN, EXISTING_ALPHA_MIN_SHARE } from './constants';
import { LINEAR_LUT, linearToLab, srgbToLab } from './color';
import { BackgroundError } from './errors';
import { labelComponents } from './labels';
import { ChannelHistogram, rectMedian } from './median';
import { formatFixed, formatPercent0, formatPyFloat, roundHalfEven } from './round';
import { createImage, type RGB, type RGBAImage } from './types';

export function hasExistingTransparency(img: RGBAImage): boolean {
  const { data } = img;
  const n = img.width * img.height;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) count++;
  return count / n > EXISTING_ALPHA_MIN_SHARE;
}

export function borderBand(width: number, height: number): number {
  return Math.max(2, roundHalfEven(Math.min(height, width) * 0.01));
}

export interface RemovalResult {
  image: RGBAImage;
  /** Median border color (float, may end in .5). */
  bgRgb: RGB;
  band: number;
  /** Share of border pixels within tolHigh of the background. */
  match: number;
}

function labDistance(a: readonly number[], b: readonly number[]): number {
  const d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

export function removeBackground(
  img: RGBAImage,
  fillHoles: boolean,
  tolLow: number,
  tolHigh: number,
): RemovalResult {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const band = borderBand(w, h);
  const inBorder = (x: number, y: number) => y < band || y >= h - band || x < band || x >= w - band;

  // Background color: per-channel median over the border band.
  const hist = new ChannelHistogram();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBorder(x, y)) continue;
      const i = (y * w + x) * 4;
      hist.add(data[i], data[i + 1], data[i + 2]);
    }
  }
  const bgRgb = hist.median();
  const bgLab = srgbToLab(bgRgb[0], bgRgb[1], bgRgb[2]);

  // Per-pixel Delta E 76 to the background.
  const dist = new Float64Array(n);
  const lab = new Float64Array(3);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    linearToLab(LINEAR_LUT[data[i]], LINEAR_LUT[data[i + 1]], LINEAR_LUT[data[i + 2]], lab);
    const d0 = lab[0] - bgLab[0], d1 = lab[1] - bgLab[1], d2 = lab[2] - bgLab[2];
    dist[p] = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
  }

  let borderCount = 0;
  let borderMatch = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBorder(x, y)) continue;
      borderCount++;
      if (dist[y * w + x] < tolHigh) borderMatch++;
    }
  }
  const match = borderMatch / borderCount;
  if (match < BORDER_MATCH_MIN) {
    const t = bgRgb.map((v) => Math.trunc(v)).join(', ');
    throw new BackgroundError(
      'borderMatch',
      `Border is not a uniform background (only ${formatPercent0(match)} of border ` +
        `pixels match (${t})). ` +
        'Gradient/graphic background or logo covering the edges.',
      { match, bgRgb },
    );
  }

  // Per-side consistency (catches smooth gradients).
  const b = Math.min(band, h), bw = Math.min(band, w);
  const sides: [string, [number, number, number]][] = [
    ['top', rectMedian(data, w, 0, 0, w, b)],
    ['bottom', rectMedian(data, w, 0, h - b, w, h)],
    ['left', rectMedian(data, w, 0, 0, bw, h)],
    ['right', rectMedian(data, w, w - bw, 0, w, h)],
  ];
  const sideLab = sides.map(([name, rgb]) => [name, srgbToLab(rgb[0], rgb[1], rgb[2])] as const);
  for (let i = 0; i < sideLab.length; i++) {
    for (let j = i + 1; j < sideLab.length; j++) {
      const d = labDistance(sideLab[i][1], sideLab[j][1]);
      if (d > tolHigh) {
        throw new BackgroundError(
          'sideMismatch',
          `Border is not a uniform background (${sideLab[i][0]} and ${sideLab[j][0]} ` +
            `edges differ by Delta E ${formatFixed(d, 1)} > ${formatPyFloat(tolHigh)}). ` +
            'Gradient/graphic background or logo covering most of an edge.',
          { sides: [sideLab[i][0], sideLab[j][0]], deltaE: d, match, bgRgb },
        );
      }
    }
  }

  // Candidates for (partial) transparency, grouped by 4-connectivity.
  const candidate = new Uint8Array(n);
  for (let p = 0; p < n; p++) candidate[p] = dist[p] < tolHigh ? 1 : 0;
  const { labels, count } = labelComponents(candidate, w, h);
  const keep = new Uint8Array(count + 1); // 1 = component becomes (partially) transparent
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (labels[p] === 0) continue;
      if (inBorder(x, y) || (fillHoles && dist[p] < tolLow)) keep[labels[p]] = 1;
    }
  }

  // Soft alpha + color decontamination: C = (P - (1 - a) * B) / a.
  const out = createImage(w, h);
  const o = out.data;
  const span = tolHigh - tolLow;
  const [br, bgG, bb] = bgRgb;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const alpha = data[i + 3];
    if (!keep[labels[p]]) {
      // Outside the region: alpha factor 1.0, original color (keep[0] is always 0).
      o[i] = data[i];
      o[i + 1] = data[i + 1];
      o[i + 2] = data[i + 2];
      o[i + 3] = alpha;
      continue;
    }
    let a = (dist[p] - tolLow) / span;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    if (a > 0) {
      const k = 1.0 - a;
      o[i] = roundHalfEven(clip255((data[i] - k * br) / a));
      o[i + 1] = roundHalfEven(clip255((data[i + 1] - k * bgG) / a));
      o[i + 2] = roundHalfEven(clip255((data[i + 2] - k * bb) / a));
    } else {
      o[i] = o[i + 1] = o[i + 2] = 0;
    }
    o[i + 3] = roundHalfEven(a * alpha);
  }

  return { image: out, bgRgb, band, match };
}

function clip255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
