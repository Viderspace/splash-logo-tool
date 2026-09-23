// Ports of srgb_to_lab, lab_to_srgb and relative_luminance from the reference.
// Same constants and the same operation order, evaluated per pixel in float64.

const M00 = 0.4124564, M01 = 0.3575761, M02 = 0.1804375;
const M10 = 0.2126729, M11 = 0.7151522, M12 = 0.072175;
const M20 = 0.0193339, M21 = 0.119192, M22 = 0.9503041;

const MI00 = 3.2404542, MI01 = -1.5371385, MI02 = -0.4985314;
const MI10 = -0.969266, MI11 = 1.8760108, MI12 = 0.041556;
const MI20 = 0.0556434, MI21 = -0.2040259, MI22 = 1.0572252;

const WX = 0.95047, WY = 1.0, WZ = 1.08883;
const F_OFFSET = 16.0 / 116.0;

/** sRGB companding, input 0..255 (may be fractional, e.g. a median of .5). */
export function srgbToLinear(v: number): number {
  const c = v / 255.0;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear values of the 256 integer channel values (identical results to srgbToLinear). */
export const LINEAR_LUT: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i);
  return t;
})();

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + F_OFFSET;
}

/** Lab (D65) from linear RGB, written into out[0..2]. */
export function linearToLab(lr: number, lg: number, lb: number, out: Float64Array | number[]): void {
  const x = (lr * M00 + lg * M01 + lb * M02) / WX;
  const y = (lr * M10 + lg * M11 + lb * M12) / WY;
  const z = (lr * M20 + lg * M21 + lb * M22) / WZ;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  out[0] = 116.0 * fy - 16.0;
  out[1] = 500.0 * (fx - fy);
  out[2] = 200.0 * (fy - fz);
}

/** srgb_to_lab for one color given as 0..255 floats. */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  linearToLab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), out);
  return out;
}

function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function labFInv(f: number): number {
  const f3 = f ** 3;
  return f3 > 0.008856 ? f3 : (f - F_OFFSET) / 7.787;
}

function compand(lin: number): number {
  return lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055;
}

/** lab_to_srgb: Lab (D65) -> float sRGB 0..255 (clipped), written into out[0..2]. */
export function labToSrgb(L: number, a: number, b: number, out: Float64Array | number[]): void {
  const fy = (L + 16.0) / 116.0;
  const fx = fy + a / 500.0;
  const fz = fy - b / 200.0;
  const x = labFInv(fx) * WX;
  const y = labFInv(fy) * WY;
  const z = labFInv(fz) * WZ;
  const lr = clip(x * MI00 + y * MI01 + z * MI02, 0.0, 1.0);
  const lg = clip(x * MI10 + y * MI11 + z * MI12, 0.0, 1.0);
  const lb = clip(x * MI20 + y * MI21 + z * MI22, 0.0, 1.0);
  out[0] = clip(compand(lr) * 255.0, 0, 255);
  out[1] = clip(compand(lg) * 255.0, 0, 255);
  out[2] = clip(compand(lb) * 255.0, 0, 255);
}

/** WCAG relative luminance of sRGB 0..255. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return srgbToLinear(r) * 0.2126 + srgbToLinear(g) * 0.7152 + srgbToLinear(b) * 0.0722;
}

export function toHex(rgb: readonly number[]): string {
  return (
    '#' +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}
