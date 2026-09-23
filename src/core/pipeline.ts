// Stage order of the reference main():
// existing-transparency check -> background removal -> optional invert ->
// contrast check vs white -> trim -> circle fit -> center.

import { invertLightness, logoContrast } from './adjust';
import { hasExistingTransparency, removeBackground } from './background';
import { toHex } from './color';
import { MIN_CONTRAST, TOL_HIGH, TOL_LOW } from './constants';
import { fitInCircle, type FitInfo } from './fit';
import type { ProcessOptions, RGB, RGBAImage } from './types';

export const DEFAULT_OPTIONS: ProcessOptions = {
  tolLow: TOL_LOW,
  tolHigh: TOL_HIGH,
  keepHoles: false,
  invert: false,
  keepBg: false,
};

export type SkipReason = 'keepBg' | 'alreadyTransparent' | null;

export interface ProcessReport {
  skip: SkipReason;
  /** Only set when background removal ran. */
  bgRgb: RGB | null;
  bgHex: string | null;
  band: number | null;
  match: number | null;
  contrast: number;
  lowContrast: boolean;
  fit: FitInfo;
}

export interface ProcessResult {
  output: RGBAImage;
  /** Buffer right after background removal (source resolution), if removal ran. */
  removed: RGBAImage | null;
  report: ProcessReport;
}

/** Throws BackgroundError exactly where the reference exits with "Error: ...". */
export function processLogo(input: RGBAImage, options: Partial<ProcessOptions> = {}): ProcessResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let img = input;
  let skip: SkipReason = null;
  let removed: RGBAImage | null = null;
  let bgRgb: RGB | null = null;
  let band: number | null = null;
  let match: number | null = null;

  if (opts.keepBg) {
    skip = 'keepBg';
  } else if (hasExistingTransparency(img)) {
    skip = 'alreadyTransparent';
  } else {
    const r = removeBackground(img, !opts.keepHoles, opts.tolLow, opts.tolHigh);
    img = removed = r.image;
    bgRgb = r.bgRgb;
    band = r.band;
    match = r.match;
  }

  if (opts.invert) img = invertLightness(img);

  const contrast = logoContrast(img);
  const lowContrast = contrast < MIN_CONTRAST;

  const { image, fit } = fitInCircle(img);
  return {
    output: image,
    removed,
    report: { skip, bgRgb, bgHex: bgRgb ? toHex(bgRgb) : null, band, match, contrast, lowContrast, fit },
  };
}
