// Pillow-compatibility of the resampling building blocks, checked in isolation.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { premultiply, resizePremultiplied, unpremultiply } from '../src/core/resample';
import type { RGBAImage } from '../src/core/types';
import { GOLDENS, diffImages, readPng } from './helpers/golden';

const dir = join(GOLDENS, 'pillow');

function grid(): RGBAImage {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let a = 0; a < 256; a++) {
    for (let v = 0; v < 256; v++) {
      const i = (a * 256 + v) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = a;
    }
  }
  return { width: 256, height: 256, data };
}

function channelR(img: RGBAImage): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let p = 0; p < out.length; p++) out[p] = img.data[p * 4];
  return out;
}

describe('Pillow premultiply / unpremultiply (exhaustive 256x256)', () => {
  it('RGBA -> RGBa matches Pillow for every (value, alpha)', () => {
    const expected = new Uint8Array(readFileSync(join(dir, 'premultiply_r.bin')));
    expect(Buffer.from(channelR(premultiply(grid()))).equals(Buffer.from(expected))).toBe(true);
  });
  it('RGBa -> RGBA matches Pillow for every (value, alpha)', () => {
    const expected = new Uint8Array(readFileSync(join(dir, 'unpremultiply_r.bin')));
    expect(Buffer.from(channelR(unpremultiply(grid()))).equals(Buffer.from(expected))).toBe(true);
  });
});

describe('Pillow Lanczos resize on premultiplied data', () => {
  const src = readPng(join(dir, 'resize_src.png'));
  const sizes: [number, number][] = JSON.parse(readFileSync(join(dir, 'resize_sizes.json'), 'utf8'));
  for (const [w, h] of sizes) {
    it(`${src.width}x${src.height} -> ${w}x${h}`, () => {
      const expected = readPng(join(dir, `resize_${w}x${h}.png`));
      const stats = diffImages(resizePremultiplied(src, w, h), expected, 0);
      expect(stats.maxDiff, stats.samples.join('\n')).toBe(0);
    });
  }
});
