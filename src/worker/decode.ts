// File bytes -> straight RGBA8. Works in a worker and on the main thread.
//
// PNG:  fast-png (exact; same decoder the Node tests use, Pillow convert("RGBA") semantics).
// JPEG/WebP: createImageBitmap without premultiplication or color conversion,
//   read back through a 2D OffscreenCanvas. JPEG is always opaque, so this is
//   exact apart from decoder differences vs libjpeg. Semi-transparent WebP pixels
//   can lose precision in the canvas (known limitation).

import type { RGBAImage } from '../core/types';
import { decodePng } from '../decode/png';
import { jpegExifOrientation, sniffFormat, type ImageFormat } from '../decode/sniff';

export interface DecodedInput {
  image: RGBAImage;
  format: ImageFormat;
  /** JPEG EXIF orientation (1 = none). Browsers apply it; the reference does not. */
  exifOrientation: number;
}

export class DecodeError extends Error {}

export async function decodeImageBytes(bytes: Uint8Array): Promise<DecodedInput> {
  const format = sniffFormat(bytes);
  if (!format) {
    throw new DecodeError('Unsupported file. Please use a PNG, JPEG or WebP image.');
  }
  if (format === 'png') {
    try {
      return { image: decodePng(bytes), format, exifOrientation: 1 };
    } catch (e) {
      throw new DecodeError(`Could not read this PNG file (${(e as Error).message}).`);
    }
  }

  const type = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    throw new DecodeError(`Could not read this ${format.toUpperCase()} file.`);
  }
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new DecodeError('This browser cannot decode the image (no 2D canvas).');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    image: { width, height, data },
    format,
    exifOrientation: format === 'jpeg' ? jpegExifOrientation(bytes) : 1,
  };
}
