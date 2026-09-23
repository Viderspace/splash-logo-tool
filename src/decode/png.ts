// PNG -> straight RGBA8 with the same result as Pillow's
// Image.open(path).convert("RGBA"): exact, no color management (iCCP/gAMA are
// ignored, as Pillow does), no canvas involved. Pure: runs in the worker and in Node.
//
// Known deviation: 16-bit grayscale. Pillow opens it as "I;16" and its convert
// to RGBA clips values to 255 (almost everything turns white); we take the high
// byte instead, like Pillow does for 16-bit RGB/RGBA.

import { convertIndexedToRgb, decode } from 'fast-png';
import type { RGBAImage } from '../core/types';

export function decodePng(bytes: Uint8Array): RGBAImage {
  const png = decode(bytes);
  const { width, height, channels, depth } = png;
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);

  if (png.palette) {
    const rgb = convertIndexedToRgb(png);
    const per = png.palette[0].length; // 3, or 4 with tRNS
    for (let p = 0; p < n; p++) {
      out[p * 4] = rgb[p * per];
      out[p * 4 + 1] = rgb[p * per + 1];
      out[p * 4 + 2] = rgb[p * per + 2];
      out[p * 4 + 3] = per === 4 ? rgb[p * per + 3] : 255;
    }
    return { width, height, data: out };
  }

  const src = png.data;
  const sample = samplesAs8Bit(src, n * channels, depth, width, height, channels);
  const trns = png.transparency;
  for (let p = 0; p < n; p++) {
    const s = p * channels;
    const o = p * 4;
    switch (channels) {
      case 1: {
        const g = sample[s];
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = trns && rawSample(src, s, depth, width, channels) === trns[0] ? 0 : 255;
        break;
      }
      case 2:
        out[o] = out[o + 1] = out[o + 2] = sample[s];
        out[o + 3] = sample[s + 1];
        break;
      case 3:
        out[o] = sample[s];
        out[o + 1] = sample[s + 1];
        out[o + 2] = sample[s + 2];
        out[o + 3] =
          trns &&
          rawSample(src, s, depth, width, channels) === trns[0] &&
          rawSample(src, s + 1, depth, width, channels) === trns[1] &&
          rawSample(src, s + 2, depth, width, channels) === trns[2]
            ? 0
            : 255;
        break;
      case 4:
        out[o] = sample[s];
        out[o + 1] = sample[s + 1];
        out[o + 2] = sample[s + 2];
        out[o + 3] = sample[s + 3];
        break;
      default:
        throw new Error(`Unsupported PNG channel count: ${channels}`);
    }
  }
  return { width, height, data: out };
}

/** Raw sample value (unscaled), handling packed low bit depths (rows are byte-aligned). */
function rawSample(data: ArrayLike<number>, index: number, depth: number, width: number, channels: number): number {
  if (depth >= 8) return data[index];
  const rowSamples = width * channels;
  const rowBytes = Math.ceil((rowSamples * depth) / 8);
  const row = Math.floor(index / rowSamples);
  const col = index % rowSamples;
  const bit = col * depth;
  const byte = data[row * rowBytes + (bit >> 3)];
  const shift = 8 - depth - (bit & 7);
  return (byte >> shift) & ((1 << depth) - 1);
}

/** All samples as 8-bit: 16-bit -> high byte, 1/2/4-bit gray scaled to 0..255 (as Pillow). */
function samplesAs8Bit(
  data: ArrayLike<number>,
  count: number,
  depth: number,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const out = new Uint8Array(count);
  if (depth === 8) {
    for (let i = 0; i < count; i++) out[i] = data[i];
  } else if (depth === 16) {
    for (let i = 0; i < count; i++) out[i] = data[i] >> 8;
  } else {
    const scale = 255 / ((1 << depth) - 1);
    for (let i = 0; i < width * height * channels; i++) out[i] = rawSample(data, i, depth, width, channels) * scale;
  }
  return out;
}
