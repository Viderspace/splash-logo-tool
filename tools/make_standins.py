"""
Generate the four public stand-in base logos in example_logos/ (invented
designs and names). They cover the properties the tests need:

  01_emblem_black_on_transparent.png   round emblem with thin rings and text, transparent PNG
  02_colored_on_white_srgb_icc.jpeg    colored logo with enclosed white fills (dots),
                                       progressive JPEG with an sRGB ICC profile
  03_dark_text_on_white.png            dark text with letter counters (P, A, R, O, &) and
                                       a distressed texture, opaque PNG
  04_red_on_offwhite_srgb_icc.jpeg     wide red wordmark on off-white (254), small details
                                       (registered mark, crown), baseline JPEG + sRGB ICC

This only needs to run once. The files can be replaced by other designs with the
same numeric prefixes (01_..04_); then run make_synthetic.py (which derives cases
05-10 and s09 from them) and make_golden.py.

Run:  .venv/bin/python tools/make_standins.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from icc import srgb_icc

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "example_logos"
SS = 4  # supersampling factor for anti-aliased edges


def font(size):
    # Pillow's bundled font (Aileron): identical on every platform.
    return ImageFont.load_default(size=size * SS)


def centered_text(draw, cx, cy, text, size, fill, stroke=0):
    f = font(size)
    x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=f, stroke_width=stroke * SS)
    draw.text((cx * SS - (x0 + x1) / 2, cy * SS - (y0 + y1) / 2), text, font=f, fill=fill,
              stroke_width=stroke * SS, stroke_fill=fill)
    return (x1 - x0) / SS, (y1 - y0) / SS


def ring(draw, cx, cy, r_out, r_in, fill, bg):
    draw.ellipse([(cx - r_out) * SS, (cy - r_out) * SS, (cx + r_out) * SS, (cy + r_out) * SS], fill=fill)
    draw.ellipse([(cx - r_in) * SS, (cy - r_in) * SS, (cx + r_in) * SS, (cy + r_in) * SS], fill=bg)


def star(draw, cx, cy, r, fill):
    pts = []
    for i in range(10):
        a = -np.pi / 2 + i * np.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append(((cx + rr * np.cos(a)) * SS, (cy + rr * np.sin(a)) * SS))
    draw.polygon(pts, fill=fill)


def emblem():
    """01: black round emblem on transparent."""
    w, h = 400, 370
    big = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    ink = (20, 20, 20, 255)
    clear = (0, 0, 0, 0)
    cx, cy = 200, 185
    ring(d, cx, cy, 170, 160, ink, clear)
    ring(d, cx, cy, 146, 143, ink, clear)
    centered_text(d, cx, cy - 8, "ORBELLA", 52, ink, stroke=1)
    centered_text(d, cx, cy + 42, "EST. 2026", 20, ink)
    for dx in (-90, 90):
        star(d, cx + dx, cy + 44, 9, ink)
    star(d, cx, cy - 92, 16, ink)
    return big.resize((w, h), Image.LANCZOS)


def colored():
    """02: red/yellow logo with white dots enclosed in red shapes, on white."""
    w, h = 800, 600
    big = Image.new("RGB", (w * SS, h * SS), (255, 255, 255))
    d = ImageDraw.Draw(big)
    red, yellow, dark = (196, 38, 34), (250, 206, 64), (90, 20, 20)
    # Banner.
    d.polygon([(140 * SS, 300 * SS), (660 * SS, 300 * SS), (700 * SS, 360 * SS), (660 * SS, 440 * SS),
               (140 * SS, 440 * SS), (100 * SS, 360 * SS)], fill=red, outline=dark, width=4 * SS)
    centered_text(d, 400, 368, "Zolto Pizza", 64, yellow, stroke=2)
    # Three round "slices" above the banner, each with enclosed white dots.
    for i, cx in enumerate((300, 400, 500)):
        cy = 230 - (20 if i == 1 else 0)
        d.ellipse([(cx - 55) * SS, (cy - 55) * SS, (cx + 55) * SS, (cy + 55) * SS], fill=red, outline=dark, width=4 * SS)
        for ox, oy in ((-20, -15), (18, -10), (0, 22)):
            d.ellipse([(cx + ox - 11) * SS, (cy + oy - 11) * SS, (cx + ox + 11) * SS, (cy + oy + 11) * SS],
                      fill=(255, 255, 255))
    return big.resize((w, h), Image.LANCZOS)


def text_logo():
    """03: dark distressed text with counters on white."""
    w, h = 500, 500
    big = Image.new("RGB", (w * SS, h * SS), (255, 255, 255))
    d = ImageDraw.Draw(big)
    ink = (22, 22, 24)
    centered_text(d, 250, 170, "PARVANO", 78, ink, stroke=3)
    centered_text(d, 250, 255, "&", 84, ink, stroke=3)
    centered_text(d, 250, 340, "ROAST", 78, ink, stroke=3)
    img = big.resize((w, h), Image.LANCZOS)
    # Distressed texture: small light specks inside the letters.
    arr = np.asarray(img).copy()
    rng = np.random.default_rng(3)
    dark = np.argwhere(arr[..., 0] < 60)
    for y, x in dark[rng.choice(len(dark), size=len(dark) // 40, replace=False)]:
        arr[y, x] = rng.integers(200, 256)
    return Image.fromarray(arr)


def wordmark():
    """04: wide red wordmark with small details on off-white (254)."""
    w, h = 687, 687
    big = Image.new("RGB", (w * SS, h * SS), (254, 254, 254))
    d = ImageDraw.Draw(big)
    red = (200, 28, 44)
    tw, th = centered_text(d, 343, 350, "Lumora", 150, red, stroke=2)
    # Small registered mark (ring + R; the bundled font has no glyph for it) and crown.
    rx, ry = 343 + tw / 2 + 16, 350 - th / 2 + 6
    ring(d, rx, ry, 10, 8.5, red, (254, 254, 254))
    centered_text(d, rx, ry, "R", 11, red)
    cx, cy = 343 - tw / 2 + 40, 350 - th / 2 - 36
    d.polygon([((cx - 22) * SS, (cy + 14) * SS), ((cx - 22) * SS, (cy - 8) * SS), ((cx - 11) * SS, (cy + 2) * SS),
               (cx * SS, (cy - 14) * SS), ((cx + 11) * SS, (cy + 2) * SS), ((cx + 22) * SS, (cy - 8) * SS),
               ((cx + 22) * SS, (cy + 14) * SS)], fill=red)
    return big.resize((w, h), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    icc = srgb_icc()
    emblem().save(OUT / "01_emblem_black_on_transparent.png")
    colored().save(OUT / "02_colored_on_white_srgb_icc.jpeg", quality=90, progressive=True, icc_profile=icc)
    text_logo().save(OUT / "03_dark_text_on_white.png")
    wordmark().save(OUT / "04_red_on_offwhite_srgb_icc.jpeg", quality=92, icc_profile=icc)
    for p in sorted(OUT.glob("0[1-4]_*")):
        print(p.name, Image.open(p).size, Image.open(p).mode)


if __name__ == "__main__":
    main()
