// Parity of the TS core with the Python reference, per input and variant.
// Inputs are the exact buffers the reference processed (goldens/<case>/input.png).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BackgroundError } from '../src/core/errors';
import { alphaBBox, measuredRadius } from '../src/core/measure';
import { referenceLog } from '../src/core/messages';
import { processLogo, type ProcessResult } from '../src/core/pipeline';
import type { ProcessOptions } from '../src/core/types';
import { ROOT, TIERS, diffImages, loadManifest, loadMeta, readPng, tierEnabled } from './helpers/golden';

const REMOVED_TOL = 1; // max per-channel diff after background removal
const FINAL_DIFF = 3; // "pixel differs" threshold for the final image
const FINAL_MAX_SHARE = 0.01; // at most 1% of pixels may differ by more than FINAL_DIFF
const RADIUS_TOL = 2; // px

interface Row {
  tier: string;
  id: string;
  outcome: string;
  removedMax: string;
  removedOver: string;
  finalMax: string;
  finalPct: string;
  bboxDelta: string;
  radiusDelta: string;
  note: string;
}
const rows: Row[] = [];

for (const tier of TIERS) {
  const manifest = tierEnabled(tier) ? loadManifest(tier) : null;
  const GOLDENS = tier.goldens;
  describe.skipIf(!manifest)(`parity with reference_logo_to_square.py (${tier.name} tier)`, () => {
    for (const c of manifest?.cases ?? []) {
      const input = readPng(join(GOLDENS, c.case, 'input.png'));
      for (const variant of c.variants) {
        const id = `${c.case} / ${variant}`;
        it(id, () => {
          const meta = loadMeta(tier, c.case, variant);
          const opts: ProcessOptions = {
            tolLow: meta.options.tol_low,
            tolHigh: meta.options.tol_high,
            keepHoles: meta.options.keep_holes,
            invert: meta.options.invert,
            keepBg: meta.options.keep_bg,
          };
          const row: Row = { tier: tier.name, id, outcome: '', removedMax: '–', removedOver: '–', finalMax: '–', finalPct: '–', bboxDelta: '–', radiusDelta: '–', note: '' };
          rows.push(row);

          let result: ProcessResult | null = null;
          let error: BackgroundError | null = null;
          try {
            result = processLogo(input, opts);
          } catch (e) {
            if (!(e instanceof BackgroundError)) throw e;
            error = e;
          }

          // Error cases must fail exactly where Python fails, with the same message.
          if (meta.error) {
            row.outcome = `error:${meta.error.kind}`;
            expect(error, `expected ${meta.error.kind} error`).not.toBeNull();
            expect(error!.kind).toBe(meta.error.kind);
            expect(error!.message).toBe(meta.error.message);
            return;
          }
          expect(error, error?.message).toBeNull();
          const r = result!;
          row.outcome = (r.report.skip ? `skip:${r.report.skip}` : 'removed') + (r.report.lowContrast ? ' +warn' : '');

          // Decisions and detected values.
          expect(r.report.skip).toBe(meta.skip);
          if (meta.removal) {
            expect(r.report.bgRgb).toEqual(meta.removal.bg_rgb);
            expect(r.report.band).toBe(meta.removal.band);
            expect(r.report.match).toBe(meta.removal.match);
          }
          expect(Math.abs(r.report.contrast - meta.contrast!) / meta.contrast!).toBeLessThan(1e-9);
          expect(r.report.lowContrast).toBe(meta.low_contrast);
          expect(referenceLog(r.report, opts)).toEqual(meta.log);
          expect(r.report.fit.crop).toEqual(meta.fit!.crop);
          expect(r.report.fit.newSize).toEqual(meta.fit!.new_size);
          expect(Math.abs(r.report.fit.radius - meta.fit!.radius)).toBeLessThan(1e-9);

          // Post-removal buffer: no resampling involved -> near exact.
          const removedPath = join(GOLDENS, c.case, variant, 'removed.png');
          expect(r.removed !== null).toBe(existsSync(removedPath));
          if (r.removed) {
            const s = diffImages(r.removed, readPng(removedPath), REMOVED_TOL);
            row.removedMax = String(s.maxDiff);
            row.removedOver = String(s.over);
            if (s.over) row.note += `removed>${REMOVED_TOL}: ${s.samples.slice(0, 3).join('; ')} `;
            expect(s.over, `pixels with diff > ${REMOVED_TOL}:\n${s.samples.join('\n')}`).toBe(0);
          }

          // Final 1152 output: tolerance-based.
          const golden = readPng(join(GOLDENS, c.case, variant, 'final.png'));
          const s = diffImages(r.output, golden, FINAL_DIFF);
          row.finalMax = String(s.maxDiff);
          row.finalPct = `${((100 * s.over) / s.total).toFixed(3)}%`;
          const bbTs = alphaBBox(r.output)!, bbPy = alphaBBox(golden)!;
          const bbDelta = Math.max(...bbTs.map((v, i) => Math.abs(v - bbPy[i])));
          const radDelta = measuredRadius(r.output) - measuredRadius(golden);
          row.bboxDelta = String(bbDelta);
          row.radiusDelta = radDelta.toFixed(3);
          expect(s.over / s.total).toBeLessThanOrEqual(FINAL_MAX_SHARE);
          expect(bbDelta).toBeLessThanOrEqual(RADIUS_TOL);
          expect(Math.abs(radDelta)).toBeLessThanOrEqual(RADIUS_TOL);
        });
      }
    }
  });
}

afterAll(() => {
  const header = '| tier | input / variant | outcome | removed max diff | removed px > 1 | final max diff | final px > 3 | alpha bbox Δ | radius Δ | note |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    `| ${r.tier} | ${r.id} | ${r.outcome} | ${r.removedMax} | ${r.removedOver} | ${r.finalMax} | ${r.finalPct} | ${r.bboxDelta} | ${r.radiusDelta} | ${r.note.trim()} |`,
  );
  const md = [`# Parity report`, '', header, sep, ...body, ''].join('\n');
  const dir = join(ROOT, 'test-report');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'parity.md'), md);
  console.log(`\n${md}`);
});
