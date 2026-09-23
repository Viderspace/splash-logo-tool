export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** Detect the format from magic bytes (never from the file extension). */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/** EXIF orientation of a JPEG (1..8), or 1 if absent. */
export function jpegExifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1;
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) return 1; // start of scan / end
    const len = view.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= bytes.length &&
        view.getUint32(p + 4) === 0x45786966 /* "Exif" */) {
      const tiff = p + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > bytes.length) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > bytes.length) return 1;
        if (view.getUint16(e, little) === 0x0112) return view.getUint16(e + 8, little) || 1;
      }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}
