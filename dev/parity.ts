// Cross-browser parity page (not part of the production app).
//   dev:    npm run dev     -> http://localhost:5173/dev/parity.html
//   build:  npm run parity  -> http://localhost:4174/dev/parity.html  (open in Safari / Firefox)
//   Add ?tier=private to check the private fixtures (only when private_fixtures/ exists locally).
//
// 1. Every input and variant from the goldens: decode the original file through the
//    production path (in a worker), run the pipeline in this browser's JS engine, and
//    compare with the Python reference:
//      PASS = decisions identical (skip / error kind / contrast warning),
//             background color within Delta E 1, measured radius within +-2 px.
//    Decode and final-pixel differences are reported for information.
// 2. Color management: each JPEG with an embedded ICC profile must decode identically
//    with and without its ICC segments (i.e. the browser honors
//    colorSpaceConversion: 'none'). Decoder-independent, so it is strict on any browser.

import { srgbToLab } from '../src/core/color';
import { BackgroundError } from '../src/core/errors';
import { measuredRadius } from '../src/core/measure';
import { processLogo } from '../src/core/pipeline';
import type { RGBAImage } from '../src/core/types';
import { decodePng } from '../src/decode/png';

interface Meta {
  options: { keep_holes: boolean; invert: boolean; keep_bg: boolean; tol_low: number; tol_high: number };
  skip: string | null;
  removal: { bg_rgb: number[] } | null;
  error: { kind: string } | null;
  low_contrast: boolean | null;
}
interface Manifest { cases: { case: string; source: string; variants: string[] }[] }

const root = new URL('../', location.href);
const tier = new URLSearchParams(location.search).get('tier') === 'private' ? 'private' : 'public';
const goldens = tier === 'private' ? 'goldens_private' : 'goldens';
const fetchBytes = async (p: string) => {
  const r = await fetch(new URL(p, root));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.arrayBuffer();
};
const fetchJson = async <T,>(p: string): Promise<T> => JSON.parse(new TextDecoder().decode(await fetchBytes(p)));

const worker = new Worker(new URL('./parity.worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
function decodeInWorker(bytes: ArrayBuffer, mode: 'production' | 'browserDefault'): Promise<RGBAImage> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data.id !== id) return;
      worker.removeEventListener('message', onMsg);
      if (ev.data.ok) resolve({ width: ev.data.width, height: ev.data.height, data: new Uint8ClampedArray(ev.data.data) });
      else reject(new Error(ev.data.error));
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id, bytes, mode });
  });
}

function pixelDiff(a: RGBAImage, b: RGBAImage) {
  if (a.width !== b.width || a.height !== b.height) return null;
  let max = 0, sum = 0, n = 0, over1 = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > max) max = d;
    sum += d; n++;
    if (d > 1) over1++;
  }
  return { max, mean: sum / n, over1Pct: (100 * over1) / n };
}

function over3Pct(a: RGBAImage, b: RGBAImage): number {
  let over = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    let m = 0;
    for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs(a.data[p * 4 + k] - b.data[p * 4 + k]));
    if (m > 3) over++;
  }
  return (100 * over) / (a.width * a.height);
}

/** JPEG bytes without APP2 ICC_PROFILE segments. */
function stripIcc(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let p = 2;
  while (p + 4 <= bytes.length) {
    const marker = bytes[p + 1];
    if (marker === 0xda) break; // start of scan: copy the rest verbatim
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    const isIcc = marker === 0xe2 && String.fromCharCode(...bytes.subarray(p + 4, p + 15)) === 'ICC_PROFILE';
    if (!isIcc) for (let i = p; i < p + 2 + len; i++) out.push(bytes[i]);
    p += 2 + len;
  }
  const rest = bytes.subarray(p);
  const res = new Uint8Array(out.length + rest.length);
  res.set(out);
  res.set(rest, out.length);
  return res;
}
const hasIcc = (bytes: Uint8Array) => stripIcc(bytes).length !== bytes.length;

export interface Row {
  id: string; pass: boolean; reasons: string[];
  decode: string; decisions: string; bgDeltaE: number | null; radiusDelta: number | null; finalOver3Pct: number | null;
}
export interface IccRow { file: string; pass: boolean; strippedMaxDiff: number | null; browserDefaultMaxDiff: number | null }

const f = (x: number | null, d = 3) => (x === null ? '–' : x.toFixed(d));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

async function main() {
  const manifest = await fetchJson<Manifest>(`${goldens}/manifest.json`);
  const rows: Row[] = [];
  const iccRows: IccRow[] = [];
  const status = document.getElementById('status')!;

  for (const c of manifest.cases) {
    status.textContent = `Running ${c.case}…`;
    const original = await fetchBytes(c.source);
    const decoded = await decodeInWorker(original.slice(0), 'production');
    const pil = decodePng(new Uint8Array(await fetchBytes(`${goldens}/${c.case}/input.png`)));
    const dd = pixelDiff(decoded, pil);
    const decodeText = dd ? `max ${dd.max}, mean ${dd.mean.toFixed(4)}, >1: ${dd.over1Pct.toFixed(2)}%` : 'size differs';

    if (/\.jpe?g$/i.test(c.source) && hasIcc(new Uint8Array(original))) {
      const stripped = await decodeInWorker(stripIcc(new Uint8Array(original)).slice().buffer, 'production');
      const sd = pixelDiff(decoded, stripped);
      const dflt = await decodeInWorker(original.slice(0), 'browserDefault');
      const dfd = pixelDiff(dflt, stripped);
      iccRows.push({ file: c.source, pass: !!sd && sd.max === 0, strippedMaxDiff: sd?.max ?? null, browserDefaultMaxDiff: dfd?.max ?? null });
    }

    for (const v of c.variants) {
      const meta = await fetchJson<Meta>(`${goldens}/${c.case}/${v}/meta.json`);
      const opts = { tolLow: meta.options.tol_low, tolHigh: meta.options.tol_high, keepHoles: meta.options.keep_holes, invert: meta.options.invert, keepBg: meta.options.keep_bg };
      const theirs = meta.error ? `error:${meta.error.kind}` : `${meta.skip ?? 'removed'}${meta.low_contrast ? '+warn' : ''}`;
      const reasons: string[] = [];
      let ours: string, bgDeltaE: number | null = null, radiusDelta: number | null = null, finalOver3: number | null = null;
      try {
        if (!dd) throw new Error('decoded size differs from the reference');
        const r = processLogo(decoded, opts);
        ours = `${r.report.skip ?? 'removed'}${r.report.lowContrast ? '+warn' : ''}`;
        if (r.report.bgRgb && meta.removal) {
          const a = srgbToLab(...r.report.bgRgb), b = srgbToLab(...(meta.removal.bg_rgb as [number, number, number]));
          bgDeltaE = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          if (bgDeltaE > 1) reasons.push(`background ΔE ${bgDeltaE.toFixed(2)} > 1`);
        }
        if (!meta.error) {
          const golden = decodePng(new Uint8Array(await fetchBytes(`${goldens}/${c.case}/${v}/final.png`)));
          radiusDelta = measuredRadius(r.output) - measuredRadius(golden);
          finalOver3 = over3Pct(r.output, golden);
          if (Math.abs(radiusDelta) > 2) reasons.push(`radius Δ ${radiusDelta.toFixed(2)} px`);
        }
      } catch (e) {
        if (!(e instanceof BackgroundError)) {
          ours = `exception: ${(e as Error).message}`;
        } else {
          ours = `error:${e.kind}`;
        }
      }
      if (ours !== theirs) reasons.unshift(`decision ${ours} ≠ reference ${theirs}`);
      rows.push({ id: `${c.case} / ${v}`, pass: reasons.length === 0, reasons, decode: decodeText, decisions: ours, bgDeltaE, radiusDelta, finalOver3Pct: finalOver3 });
    }
  }

  const failed = rows.filter((r) => !r.pass).length + iccRows.filter((r) => !r.pass).length;
  const total = rows.length + iccRows.length;
  (window as unknown as { __parity: unknown }).__parity = { rows, iccRows, failed, total };

  const badge = (p: boolean) => `<td class="${p ? 'pass' : 'fail'}"><b>${p ? 'PASS' : 'FAIL'}</b></td>`;
  document.getElementById('pipeline')!.innerHTML =
    '<tr><th>Result</th><th>Input / variant</th><th>Decision (this browser)</th><th>bg ΔE</th><th>Radius Δ px</th><th>Final px &gt;3</th><th>Decode vs Pillow</th><th>Why it failed</th></tr>' +
    rows.map((r) => `<tr>${badge(r.pass)}<td>${esc(r.id)}</td><td>${esc(r.decisions)}</td><td>${f(r.bgDeltaE)}</td><td>${f(r.radiusDelta)}</td><td>${r.finalOver3Pct === null ? '–' : r.finalOver3Pct.toFixed(3) + '%'}</td><td>${esc(r.decode)}</td><td>${esc(r.reasons.join('; '))}</td></tr>`).join('');
  document.getElementById('icc')!.innerHTML =
    '<tr><th>Result</th><th>JPEG with ICC profile</th><th>Max diff: app decode vs ICC stripped (must be 0)</th><th>Max diff: browser default options vs ICC stripped (info)</th></tr>' +
    iccRows.map((r) => `<tr>${badge(r.pass)}<td>${esc(r.file)}</td><td>${f(r.strippedMaxDiff, 0)}</td><td>${f(r.browserDefaultMaxDiff, 0)}</td></tr>`).join('');
  const summary = document.getElementById('summary')!;
  summary.className = failed ? 'fail' : 'pass';
  summary.textContent = failed ? `FAIL: ${failed} of ${total} checks failed` : `PASS: all ${total} checks passed`;
  status.textContent = `${tier} fixtures · ${navigator.userAgent}`;
}

main().catch((e) => {
  const s = document.getElementById('summary')!;
  s.className = 'fail';
  s.textContent = `ERROR: ${e instanceof Error ? e.message : e}`;
  throw e;
});
