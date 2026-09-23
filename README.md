# Splash Logo Tool

Turns a logo into a **1152×1152 transparent PNG** for the Android 12+ splash
screen: the logo is centered and scaled so its actual shape fits inside the
768 px circle (the splash icon spec at xxxhdpi).

It is a browser port of `reference_logo_to_square.py`, which is the spec: the
TypeScript core reproduces it and is tested against its output. Everything runs
in the browser. There is no backend, the app makes no network requests (enforced
by a Content Security Policy), and images never leave your machine.

## Using the tool

1. Open the tool's GitHub Pages link.
2. Drop a logo (PNG, JPEG or WebP) on the page, or click to choose a file.
3. Check the status line and the preview, adjust if needed, and click
   **Download** to save `<original name>_1152.png`.

What the tool does, in order: remove the background (skipped if the image is
already transparent), optionally invert lightness, check contrast against a white
splash, trim, scale to the circle, center on the canvas.

**Settings** (reset to defaults whenever you open a new file):

| Setting | Use it when |
|---|---|
| Tolerance low / high | Background removal is too weak (raise) or eats into the logo (lower). Colors closer to the background than *low* become transparent, farther than *high* stay opaque, with a soft edge in between. |
| Keep holes | Areas inside the logo that have the background color (the inside of an “O”, white dots) should stay opaque instead of becoming transparent. |
| Invert lightness | The logo is light (e.g. white on black) and would be invisible on the white splash. |
| Keep background | Background removal gets it wrong, e.g. a full-bleed badge (see limitations). |

**Status line:** the detected background color, whether removal was skipped,
errors (e.g. a gradient background) and a warning when contrast against the white
splash is below 1.5:1.

**Preview:** *Splash on white* shows the result as the splash will show it
(white screen, icon clipped to the circle; *Show circle* draws the mask outline).
*Transparent output* shows the raw PNG on a checkerboard with the circle.

## Development

Requirements: Node 24, Python 3.13 (only for regenerating goldens).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # parity tests against the Python reference (Vitest, Node)
npm run build        # production build in dist/
```

Layout:

| Path | What |
|---|---|
| `reference_logo_to_square.py` | The Python reference = the spec. |
| `src/core/` | The algorithm as pure TypeScript on RGBA buffers (no DOM); runs in the worker and in Node. |
| `src/decode/` | Format sniffing and exact PNG decoding (Pillow-compatible). |
| `src/worker/` | Web Worker: decoding, processing, PNG encoding. |
| `src/ui/` | React UI. |
| `example_logos/` | Public test logos: invented stand-ins 01–04 and cases 05–10 derived from them (see `EXPECTED.md`). |
| `test_images/synthetic/` | Generated test images for cases the examples don't cover. |
| `goldens/` | Reference outputs for the public fixtures + `manifest.json` (generated; committed). |
| `private_fixtures/`, `goldens_private/` | Optional private tier (gitignored; see below). |
| `tools/` | `make_standins.py`, `make_synthetic.py`, `make_golden.py`, `icc.py`, `requirements.txt`. |
| `tests/` | Vitest suites. |
| `dev/` | Browser parity and performance pages (not part of the deployed app). |

### How parity is tested

`tools/make_golden.py` runs the reference on every input and variant and writes
to `goldens/<case>/`:
- `input.png`: exactly the pixels the reference processes
  (`Image.open(...).convert("RGBA")`).
- `removed.png`: the result right after background removal.
- `final.png`: the 1152 output.
- `meta.json`: decisions, background color, contrast, errors.

For each input's default settings it also runs the reference script's command
line and requires byte-identical output, so the golden generator cannot drift
from the script.

`npm test` then checks the TypeScript core against those goldens:
- decisions, background color, error messages and warnings must match exactly;
- post-removal pixels must be within ±1 per channel;
- final images are compared with tolerances (currently they are bit-exact);
- the PNG decoder must match Pillow exactly;
- `goldens/manifest.json` must match the SHA-256 of the reference script, the
  tools and every input. If anything changed, the test fails with
  *"goldens are stale, run tools/make_golden.py"*.

CI runs the same tests on every push and pull request, with the public fixtures
only.

### Two fixture tiers

| Tier | Inputs | Goldens | In git |
|---|---|---|---|
| public | `example_logos/`, `test_images/synthetic/` | `goldens/` | yes |
| private | `private_fixtures/` | `goldens_private/` | no (gitignored) |

The public tier uses invented stand-in logos, so the repository contains no
third-party material. Real logos that must not be published (e.g. client work
under NDA) go in `private_fixtures/`, using the same file-name prefixes 01–10
(and s09) so the same variants are generated for them. Each tier has its own
manifest. `make_golden.py` builds the private tier only when `private_fixtures/`
exists, and `npm test` runs it only then. Otherwise the output shows one line:
*"Private tier skipped: private_fixtures/ not present"*.

### Adding test images and regenerating goldens

```bash
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt   # pinned Pillow/numpy/scipy
```

- **Public base logos:** `example_logos/01_*` to `04_*` are stand-ins generated
  once by `tools/make_standins.py`. To use your own designs, replace them with
  files that keep the same prefixes and properties (listed in
  `example_logos/EXPECTED.md`). Cases 05–10 and `s09` are derived from them
  automatically.
- **Synthetic cases:** add them to `tools/make_synthetic.py`.
- **Private logos:** put them in `private_fixtures/` (never committed).
- **Extra variants** (keep holes, invert, keep background, other tolerances):
  add them to `EXTRA_VARIANTS` in `tools/make_golden.py`. They are keyed by the
  numeric prefix (`01`, `s03`, ...), so they apply to both tiers.

Then regenerate everything and test:

```bash
.venv/bin/python tools/make_synthetic.py && .venv/bin/python tools/make_golden.py
npm test
```

Commit the new public inputs together with the regenerated `goldens/`. The Python
versions are pinned on purpose: a different Pillow can change the reference's
output (resampling, JPEG decoding). If you upgrade them, regenerate the goldens
and review the diff.

### Cross-browser check (Safari, Firefox)

```bash
npm run parity
```

This builds the app together with the parity page and the test fixtures, and
serves them. Open **http://localhost:4174/dev/parity.html** in each browser
(add `?tier=private` for the private fixtures, if present locally). To
test from another device (e.g. an iPhone on the same network), use
`npm run parity -- --host` and the printed network address.

The page shows one PASS/FAIL banner and a row per check:
- **Color management:** every JPEG with an embedded ICC profile must decode
  identically with and without the profile. That means the browser honors
  `createImageBitmap(..., { colorSpaceConversion: 'none' })` the way Pillow
  ignores profiles. `s09_display_p3_icc.jpeg` has a non-sRGB (Display P3)
  profile, so a browser that color-manages anyway fails this check.
- **Pipeline:** every input and variant is decoded through the app's own path
  (in a worker) and processed in that browser's JavaScript engine. PASS means the
  decisions (skipped / error / contrast warning) are identical to the reference,
  the background color is within ΔE 1, and the measured logo radius is within
  ±2 px. Pixel differences from the browser's JPEG decoder are shown for
  information.

`dev/perf.html` (in `npm run dev` or `npm run parity`) times large synthetic
inputs: run `preparePerf(6000, 4000)` and then `await runPerf()` in the console.

## Deployment (GitHub Pages)

`.github/workflows/ci.yml` runs `npm ci`, `npm test` and `npm run build` on every
push and pull request. On a push to `main` it then deploys `dist/` to GitHub
Pages. The build is served from the repository subpath
(`https://<owner>.github.io/<repo>/`); the workflow passes
`BASE_PATH=/<repo>/` to Vite.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

## Known limitations

- **Full-bleed / edge-covering logos.** When the logo's badge or shape fills the
  image to the edges (no margin), the badge color is detected as the background
  and removed, leaving only what sits on top of it (e.g. the text). Turn on
  **Keep background** for such logos. Documented by the golden for
  `test_images/synthetic/s08_fullbleed_badge.png`.
- **Already-transparent inputs with opaque background-colored holes** (e.g. a
  transparent PNG whose letter counters are opaque white): background removal is
  skipped for transparent inputs, so the holes stay opaque. See
  `example_logos/06_text_transparent_opaque_counters.png`.
- **Semi-transparent WebP pixels** may lose a little precision: WebP is decoded
  through a browser canvas, which stores premultiplied alpha. PNG is decoded
  exactly; JPEG is always opaque.
- **JPEG decoding differs slightly between browsers.** Chromium matches Pillow
  exactly on the test images; other browsers may differ by a few levels, which can
  shift soft edges slightly. Run the cross-browser check above to see it.
- **JPEG EXIF rotation:** browsers apply it, the reference script ignores it. The
  tool shows a note when a JPEG carries a rotation.
- **16-bit grayscale PNG:** the reference (Pillow) turns these almost entirely
  white; the tool uses the high byte of each sample instead.
- **Contrast warning with Keep background** is measured over the whole image,
  including the kept background.
- **Very large files** (e.g. 6000×4000 print files) take a few seconds to
  process at full resolution and need about 0.5 GB of memory in the browser.
  Slider previews stay fast because they run on a reduced copy.

## Reference script

`reference_logo_to_square.py` is kept as the spec. The only change made to it
was removing the deprecated `"RGBA"` mode argument from its two
`Image.fromarray` calls, for Pillow 13 compatibility. All goldens were verified
byte-identical before and after the change.
