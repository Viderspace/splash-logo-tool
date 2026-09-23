// Staleness guard: each tier's goldens must have been generated from the
// current reference, tools and inputs.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, TIERS, loadManifest, tierEnabled } from './helpers/golden';

const STALE = 'goldens are stale, run tools/make_golden.py';

for (const tier of TIERS) {
  describe.skipIf(!tierEnabled(tier))(`golden manifest (${tier.name} tier)`, () => {
    const manifest = loadManifest(tier);

    it('manifest exists', () => {
      expect(manifest, `${STALE} (${tier.goldens}/manifest.json missing)`).not.toBeNull();
    });

    it.skipIf(!manifest)('hashes of reference script, tools and inputs match', () => {
      const mismatches: string[] = [];
      for (const [rel, hash] of Object.entries(manifest!.hashes)) {
        const path = join(ROOT, rel);
        if (!existsSync(path)) {
          mismatches.push(`${rel}: missing`);
          continue;
        }
        const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
        if (actual !== hash) mismatches.push(`${rel}: changed`);
      }
      expect(mismatches, `${STALE}\n${mismatches.join('\n')}`).toEqual([]);
    });

    it.skipIf(!manifest)('no inputs were added or removed', () => {
      const exts = new Set(manifest!.image_exts);
      const onDisk = manifest!.input_dirs.flatMap((dir) =>
        readdirSync(join(ROOT, dir))
          .filter((f) => exts.has(extname(f).toLowerCase()))
          .map((f) => `${dir}/${f}`),
      );
      const known = new Set(Object.keys(manifest!.hashes));
      const added = onDisk.filter((f) => !known.has(f));
      const removed = manifest!.cases.map((c) => c.source).filter((s) => !onDisk.includes(s));
      expect({ added, removed }, STALE).toEqual({ added: [], removed: [] });
    });
  });
}
