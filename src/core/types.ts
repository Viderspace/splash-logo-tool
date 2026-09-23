/** Straight (non-premultiplied) 8-bit RGBA buffer, row-major. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export type RGB = [number, number, number];

export interface ProcessOptions {
  tolLow: number;
  tolHigh: number;
  /** Keep enclosed background-colored regions opaque (reference --keep-holes). */
  keepHoles: boolean;
  /** Flip Lab lightness after background removal (reference --invert). */
  invert: boolean;
  /** Skip background removal (reference --keep-bg). */
  keepBg: boolean;
}
