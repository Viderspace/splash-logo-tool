// The production PNG decoder must produce exactly the buffer the reference
// processes (Pillow's Image.open(...).convert("RGBA")).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../src/decode/png';
import { jpegExifOrientation, sniffFormat } from '../src/decode/sniff';
import { ROOT, TIERS, diffImages, loadManifest, readPng, tierEnabled } from './helpers/golden';

for (const tier of TIERS) {
  const manifest = tierEnabled(tier) ? loadManifest(tier) : null;
  const cases = manifest?.cases ?? [];

  describe.skipIf(!manifest)(`decoding (${tier.name} tier)`, () => {
    describe('format sniffing by magic bytes', () => {
      for (const c of cases) {
        it(c.source, () => {
          const ext = c.source.split('.').pop()!.toLowerCase();
          const expected = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
          expect(sniffFormat(readFileSync(join(ROOT, c.source)))).toBe(expected);
        });
      }
    });

    describe('PNG decode matches PIL convert("RGBA") exactly', () => {
      for (const c of cases.filter((c) => c.source.toLowerCase().endsWith('.png'))) {
        it(c.source, () => {
          const ours = decodePng(readFileSync(join(ROOT, c.source)));
          const pil = readPng(join(tier.goldens, c.case, 'input.png'));
          const stats = diffImages(ours, pil, 0);
          expect(stats.maxDiff, stats.samples.join('\n')).toBe(0);
        });
      }
    });

    it('JPEG fixtures have no EXIF rotation (reference and browser agree)', () => {
      for (const c of cases.filter((c) => /\.jpe?g$/i.test(c.source))) {
        expect(jpegExifOrientation(readFileSync(join(ROOT, c.source))), c.source).toBe(1);
      }
    });
  });
}

describe('format sniffing and EXIF parsing', () => {
  it('rejects unknown data', () => {
    expect(sniffFormat(new TextEncoder().encode('GIF89a......'))).toBeNull();
  });
  it('reads orientation from a big-endian APP1 Exif block', () => {
    // SOI, APP1(len 34) "Exif\0\0", TIFF "MM" 42 IFD@8, 1 entry: 0x0112 SHORT 1 value 6.
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
    ]);
    expect(jpegExifOrientation(bytes)).toBe(6);
  });
});
