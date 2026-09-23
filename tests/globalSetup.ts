import { TIERS, loadManifest, tierEnabled } from './helpers/golden';

// One clear line about the private tier, printed once per run.
export default function setup(): void {
  const priv = TIERS.find((t) => t.name === 'private')!;
  if (!tierEnabled(priv)) {
    console.log('\n  Private tier skipped: private_fixtures/ not present (running public fixtures only).\n');
  } else {
    const n = loadManifest(priv)?.cases.length;
    console.log(`\n  Private tier enabled: private_fixtures/ present (${n ?? 'no'} golden cases).\n`);
  }
}
