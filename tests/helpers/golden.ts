import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RGBAImage } from '../../src/core/types';
import { decodePng } from '../../src/decode/png';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Public goldens (also holds the Pillow resampler fixtures). */
export const GOLDENS = join(ROOT, 'goldens');

export interface GoldenMeta {
  options: { keep_holes: boolean; invert: boolean; keep_bg: boolean; tol_low: number; tol_high: number };
  skip: 'keepBg' | 'alreadyTransparent' | null;
  removal: { band: number; bg_rgb: number[]; bg_lab: number[]; match: number } | null;
  error: { kind: string; message: string } | null;
  contrast: number | null;
  low_contrast: boolean | null;
  fit: { crop: number[]; radius: number; scale: number; new_size: number[] } | null;
  log: string[];
}

export interface Manifest {
  tier: string;
  pillow: string;
  hashes: Record<string, string>;
  input_dirs: string[];
  image_exts: string[];
  cases: { case: string; source: string; variants: string[] }[];
}

export interface Tier {
  name: 'public' | 'private';
  goldens: string;
  /** Fixture folder that must exist for the tier to run (private tier only). */
  requires: string | null;
}

export const TIERS: Tier[] = [
  { name: 'public', goldens: GOLDENS, requires: null },
  { name: 'private', goldens: join(ROOT, 'goldens_private'), requires: join(ROOT, 'private_fixtures') },
];

/** The private tier runs only when private_fixtures/ exists (never in CI). */
export function tierEnabled(tier: Tier): boolean {
  return tier.requires === null || existsSync(tier.requires);
}

/** null when the tier's manifest is missing (the manifest test reports that as stale). */
export function loadManifest(tier: Tier): Manifest | null {
  const path = join(tier.goldens, 'manifest.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

export function readPng(path: string): RGBAImage {
  return decodePng(readFileSync(path));
}

export function loadMeta(tier: Tier, caseName: string, variant: string): GoldenMeta {
  return JSON.parse(readFileSync(join(tier.goldens, caseName, variant, 'meta.json'), 'utf8'));
}

export interface DiffStats {
  maxDiff: number;
  /** Pixels where any channel differs by more than `threshold`. */
  over: number;
  total: number;
  samples: string[];
}

export function diffImages(a: RGBAImage, b: RGBAImage, threshold: number, maxSamples = 10): DiffStats {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let maxDiff = 0, over = 0;
  const samples: string[] = [];
  for (let p = 0; p < a.width * a.height; p++) {
    let pm = 0;
    for (let c = 0; c < 4; c++) pm = Math.max(pm, Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]));
    if (pm > maxDiff) maxDiff = pm;
    if (pm > threshold) {
      over++;
      if (samples.length < maxSamples) {
        const x = p % a.width, y = Math.floor(p / a.width);
        samples.push(`(${x},${y}) ts=[${a.data.subarray(p * 4, p * 4 + 4).join(',')}] py=[${b.data.subarray(p * 4, p * 4 + 4).join(',')}]`);
      }
    }
  }
  return { maxDiff, over, total: a.width * a.height, samples };
}
