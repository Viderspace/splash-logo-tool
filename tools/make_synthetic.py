"""
Generate deterministic test images (public tier).

1. Derived example cases 05-10 in example_logos/, made from the base logos
   01_*..04_* found there (the stand-ins from make_standins.py, or your own
   designs with the same prefixes). See example_logos/EXPECTED.md.
2. Synthetic cases in test_images/synthetic/ (listed below).

Pipeline cases (processed by make_golden.py):
  s01_gradient_horizontal.png      smooth left->right gradient bg  -> must fail (side mismatch)
  s02_busy_border.png              random-noise background         -> must fail (border match)
  s03_ring_hole_on_beige.png       dark ring, enclosed beige hole  -> holes vs keepHoles
  s04_soft_alpha_rgba.png          soft-edged RGBA shape           -> already transparent, premultiplied resize
  s05_pale_yellow_on_white.png     low-contrast logo               -> contrast warning, cleared by invert
  s06_plain_white.png              nothing but background          -> "Nothing left" error
  s07_median_tie_250x300.png       50/50 two-value border          -> even-count median, half-even band
  s08_fullbleed_badge.png          dark text on a full-bleed light badge -> known limitation: the
                                   badge color is detected as background and removed (use keepBg)
  s09_display_p3_icc.jpeg          base logo 02 re-encoded with a Display P3 ICC profile. The reference
                                   (Pillow) ignores the profile; a browser that color-manages the
                                   decode would shift every color. Guards the createImageBitmap
                                   options (colorSpaceConversion: 'none') on every browser.

Decode-only cases (PNG color types; used by the decoder test and also processed):
  d01_palette_trns.png             4-bit palette with tRNS
  d02_gray.png                     8-bit grayscale
  d03_gray_alpha.png               8-bit grayscale + alpha
  d04_rgba16.png                   16-bit RGBA
  d05_interlaced_rgba.png          Adam7 interlaced RGBA
  d06_palette_4bit.png             4-bit palette, no tRNS
  d07_rgb_trns.png                 8-bit RGB with tRNS color key

Run with the venv python:  .venv/bin/python tools/make_synthetic.py
"""

import struct
import zlib
from pathlib import Path

import importlib.util

import numpy as np
from PIL import Image

from icc import display_p3_icc

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test_images" / "synthetic"
EXAMPLES = ROOT / "example_logos"

_spec = importlib.util.spec_from_file_location("ref", ROOT / "reference_logo_to_square.py")
ref = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ref)


def disk_alpha(h, w, cx, cy, r_out, r_in=0.0, ss=4):
    """Anti-aliased disk / ring coverage (0..1) via supersampling."""
    ys = (np.arange(h * ss) + 0.5) / ss
    xs = (np.arange(w * ss) + 0.5) / ss
    d = np.sqrt((xs[None, :] - cx) ** 2 + (ys[:, None] - cy) ** 2)
    cov = ((d <= r_out) & (d >= r_in)).astype(np.float64)
    return cov.reshape(h, ss, w, ss).mean(axis=(1, 3))


def over(bg_rgb, fg_rgb, cov):
    """Composite a flat fg color over a flat/array bg with coverage -> uint8 RGB."""
    bg = np.broadcast_to(np.asarray(bg_rgb, dtype=np.float64), cov.shape + (3,))
    fg = np.asarray(fg_rgb, dtype=np.float64)
    out = bg * (1 - cov[..., None]) + fg * cov[..., None]
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def save_rgb(arr, name):
    Image.fromarray(arr).save(OUT / name)


def write_png_raw(path, width, height, color_type, bit_depth, rows, extra_chunks=(), interlace=0):
    """Minimal PNG writer for color types Pillow can't easily emit (16-bit RGBA)."""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, interlace)
    raw = b"".join(b"\x00" + r for r in rows)
    body = chunk(b"IHDR", ihdr)
    for tag, data in extra_chunks:
        body += chunk(tag, data)
    body += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + body)


def base_logo(n: int) -> Image.Image:
    """Base logo NN_* from example_logos/ (exactly one file per prefix 01..04)."""
    found = sorted(EXAMPLES.glob(f"{n:02d}_*"))
    found = [p for p in found if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]
    if len(found) != 1:
        raise SystemExit(f"expected exactly one base logo {n:02d}_* in {EXAMPLES}, found {[p.name for p in found]}")
    return Image.open(found[0])


def composite_on(logo_rgba: Image.Image, bg: np.ndarray) -> Image.Image:
    """Straight-alpha composite of an RGBA logo over an RGB background array."""
    a = np.asarray(logo_rgba).astype(np.float64)
    alpha = a[..., 3:4] / 255.0
    out = a[..., :3] * alpha + bg.astype(np.float64) * (1 - alpha)
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8))


def make_derived() -> None:
    """Example cases 05-10, derived from base logos 01-04 (see example_logos/EXPECTED.md)."""
    for old in EXAMPLES.glob("*"):
        if old.name[:2] in ("05", "06", "07", "08", "09", "10"):
            old.unlink()
    emblem = base_logo(1).convert("RGBA")
    colored = base_logo(2).convert("RGBA")
    text = base_logo(3).convert("RGBA")
    wordmark = base_logo(4).convert("RGBA")

    # 05: 01 with inverted colors on black (light logo on a dark background).
    e = np.asarray(emblem).copy()
    e[..., :3] = 255 - e[..., :3]
    composite_on(Image.fromarray(e), np.zeros(e.shape[:2] + (3,))).save(EXAMPLES / "05_emblem_white_on_black.png")

    # 06: 03 with only the outer background removed (known limitation: opaque counters).
    ref.remove_background(text, False, ref.TOL_LOW, ref.TOL_HIGH).save(
        EXAMPLES / "06_text_transparent_opaque_counters.png")

    # 07: 02 moved onto beige; its enclosed white fills stay white (not the bg color). JPEG q85.
    cut = ref.remove_background(colored, False, ref.TOL_LOW, ref.TOL_HIGH)
    beige = np.broadcast_to(np.array([240, 228, 205]), (cut.height, cut.width, 3))
    composite_on(cut, beige).save(EXAMPLES / "07_colored_on_beige.jpeg", quality=85)

    # 08: 04 on a vertical gradient: must fail with a non-uniform border error.
    cut = ref.remove_background(wordmark, True, ref.TOL_LOW, ref.TOL_HIGH)
    t = np.linspace(0.0, 1.0, cut.height)[:, None, None]
    grad = np.array([170, 195, 225]) * (1 - t) + np.array([245, 235, 205]) * t
    composite_on(cut, np.broadcast_to(grad, (cut.height, cut.width, 3))).save(EXAMPLES / "08_wordmark_gradient_bg.png")

    # 09: 03 cropped tight: the logo touches all four edges.
    a = np.asarray(text.convert("RGB"))
    ys, xs = np.nonzero((a < 250).any(axis=-1))
    text.convert("RGB").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).save(
        EXAMPLES / "09_text_cropped_touching_edges.png")

    # 10: 01 on white, scaled down to 96 px wide (large Lanczos upscale later).
    white = composite_on(emblem, np.full((emblem.height, emblem.width, 3), 255))
    white.resize((96, round(emblem.height * 96 / emblem.width)), Image.LANCZOS).save(
        EXAMPLES / "10_emblem_tiny_96px_on_white.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    make_derived()

    # s01: horizontal gradient background with a dark disk.
    h, w = 300, 400
    ramp = np.linspace(140, 255, w)
    bg = np.stack([np.broadcast_to(ramp, (h, w))] * 3, axis=-1)
    cov = disk_alpha(h, w, 200, 150, 80)
    save_rgb(over(bg, (30, 40, 90), cov), "s01_gradient_horizontal.png")

    # s02: busy (random-noise) background: no border color dominates.
    h, w = 300, 300
    noise = np.random.default_rng(7).integers(0, 256, (h, w, 3)).astype(np.float64)
    cov = disk_alpha(h, w, 150, 150, 90)
    save_rgb(over(noise, (20, 60, 20), cov), "s02_busy_border.png")

    # s03: dark ring with an enclosed beige hole, on beige.
    beige = (240, 228, 205)
    h, w = 320, 320
    cov = disk_alpha(h, w, 160, 160, 110, 60)
    save_rgb(over(beige, (60, 30, 20), cov), "s03_ring_hole_on_beige.png")

    # s04: RGBA with soft alpha (radial falloff) and a colored gradient.
    h, w = 260, 340
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    d = np.sqrt(((xx - 170) / 130) ** 2 + ((yy - 130) / 90) ** 2)
    a = np.clip((1.0 - d) * 3.0, 0, 1)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = np.round(40 + 180 * xx / w)
    rgba[..., 1] = np.round(200 - 150 * yy / h)
    rgba[..., 2] = 120
    rgba[..., 3] = np.round(a * 255)
    Image.fromarray(rgba).save(OUT / "s04_soft_alpha_rgba.png")

    # s05: pale yellow disk + bar on white.
    h, w = 300, 300
    cov = np.maximum(disk_alpha(h, w, 150, 130, 90), 0)
    cov[220:250, 60:240] = 1.0
    save_rgb(over((255, 255, 255), (250, 245, 170), cov), "s05_pale_yellow_on_white.png")

    # s06: plain white.
    save_rgb(np.full((200, 200, 3), 255, dtype=np.uint8), "s06_plain_white.png")

    # s07: 250x300 (min side 250 -> 250*0.01 = 2.5 -> Python round -> band 2).
    # Checkerboard of two background values so the border median is 200.5,
    # with a dark rounded square in the middle.
    h, w = 300, 250
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.where((xx + yy) % 2 == 0, 200, 201).astype(np.float64)
    bg = np.stack([base, base, base - 20], axis=-1)
    cov = disk_alpha(h, w, 125, 150, 70)
    save_rgb(over(bg, (10, 20, 120), cov), "s07_median_tie_250x300.png")

    # s08: full-bleed badge: light yellow fills the whole image (no margin),
    # dark "text" (three letter-like blocks) on it.
    h, w = 240, 420
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = (250, 215, 110)
    dark = (35, 30, 60)
    img[80:160, 60:80] = dark                                           # L
    img[140:160, 60:120] = dark
    img[80:160, 160:180] = dark; img[80:160, 240:260] = dark             # O
    img[80:100, 160:260] = dark; img[140:160, 160:260] = dark
    img[80:160, 300:320] = dark; img[80:100, 300:370] = dark             # G-ish
    img[140:160, 300:370] = dark; img[120:160, 350:370] = dark
    save_rgb(img, "s08_fullbleed_badge.png")

    # s09: base logo 02 re-encoded with a (non-sRGB) Display P3 profile embedded.
    base_logo(2).convert("RGB").save(OUT / "s09_display_p3_icc.jpeg", quality=95, icc_profile=display_p3_icc())

    # ---- decode-only fixtures: a small logo on white with varied PNG encodings ----
    h, w = 120, 160
    cov = disk_alpha(h, w, 80, 60, 45, 20)
    rgb = over((255, 255, 255), (180, 30, 60), cov)

    # d01: palette + tRNS (white -> fully transparent entry, plus a partial one).
    pal_img = Image.fromarray(rgb).quantize(colors=16, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = pal_img.getpalette()[: 16 * 3]
    lum = [pal[i * 3] + pal[i * 3 + 1] + pal[i * 3 + 2] for i in range(16)]
    trns = bytes(0 if l >= 750 else (128 if l >= 600 else 255) for l in lum)
    pal_img.info["transparency"] = trns
    pal_img.save(OUT / "d01_palette_trns.png", transparency=trns)

    # d02: grayscale.
    gray = np.round(0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.uint8)
    Image.fromarray(gray).save(OUT / "d02_gray.png")

    # d03: grayscale + alpha.
    la = np.dstack([gray, np.round(cov * 255).astype(np.uint8)])
    Image.fromarray(la).save(OUT / "d03_gray_alpha.png")

    # d04: 16-bit RGBA (values chosen so the low byte is non-trivial).
    rgba8 = np.dstack([rgb, np.round(cov * 255).astype(np.uint8)]).astype(np.uint16)
    rgba16 = rgba8 * 257 + (np.arange(w)[None, :, None] * 37 % 200).astype(np.uint16)
    rgba16 = np.minimum(rgba16, 65535).astype(">u2")
    rows = [rgba16[y].tobytes() for y in range(h)]
    write_png_raw(OUT / "d04_rgba16.png", w, h, 6, 16, rows)

    # d05: Adam7-interlaced RGBA (Pillow can't write interlaced; use our writer
    # with a correctly interlaced stream).
    rgba = np.dstack([rgb, np.round(cov * 255).astype(np.uint8)])
    passes = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    raw = b""
    for x0, y0, dx, dy in passes:
        sub = rgba[y0::dy, x0::dx]
        if sub.shape[0] == 0 or sub.shape[1] == 0:
            continue
        raw += b"".join(b"\x00" + sub[y].tobytes() for y in range(sub.shape[0]))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 1)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    (OUT / "d05_interlaced_rgba.png").write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

    # d06: 4-bit palette, no tRNS.
    pal4 = Image.fromarray(rgb).quantize(colors=16, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal4.save(OUT / "d06_palette_4bit.png", bits=4)

    # d07: RGB with a tRNS color key (pure white transparent).
    Image.fromarray(rgb).save(OUT / "d07_rgb_trns.png", transparency=(255, 255, 255))

    for p in sorted(OUT.iterdir()):
        im = Image.open(p)
        print(f"{p.name}: {im.size} mode={im.mode} info={ {k: v for k, v in im.info.items() if k in ('transparency', 'interlace')} if not isinstance(im.info.get('transparency'), bytes) else 'palette-trns'}")


if __name__ == "__main__":
    main()
