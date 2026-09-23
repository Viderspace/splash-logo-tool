"""
Place a logo centered on a 1152x1152 transparent canvas, scaled so the
logo's actual shape fits inside an imaginary 768px circle.

REFERENCE IMPLEMENTATION: this script is the spec for the TypeScript port.
Behavior, defaults and constants here are authoritative.

Pipeline:
1. Background removal (skipped if the image already has transparency):
   - Detect background color from the border band (median), verify the border
     is mostly uniform and that all four edges agree (catches gradients),
     otherwise abort with an explanation.
   - Per-pixel distance to the background in Lab (Delta E 76).
   - Removes background connected to the border AND enclosed
     background-colored regions (e.g. the inside of an "O").
     --keep-holes removes only the border-connected background.
   - Soft alpha via two thresholds + color decontamination, so anti-aliased
     edges don't keep a halo of the old background color.
2. Optional --invert: flips lightness (Lab L) of the logo, keeping hue and
   alpha. Intended for light logos (e.g. white on black).
3. Contrast check against a white splash background; warns if too low.
4. Trim to the bounding box of meaningfully opaque pixels.
5. Scale so the farthest opaque pixel from the logo's center touches the circle.
6. Center on the transparent canvas.

Requires: pip install pillow numpy scipy
"""

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

CANVAS_SIZE = 1152
CIRCLE_DIAMETER = 768

# Delta E thresholds: below TOL_LOW -> fully transparent,
# above TOL_HIGH -> fully opaque, linear in between.
TOL_LOW = 6.0
TOL_HIGH = 24.0

# Share of border pixels that must match the background color.
BORDER_MATCH_MIN = 0.6

# Pixels with alpha below this are ignored when measuring the logo's extent.
EXTENT_ALPHA_MIN = 8

# Share of pixels with alpha < 250 for the image to count as "already transparent".
EXISTING_ALPHA_MIN_SHARE = 0.01

# Assumed splash background and the minimum WCAG contrast ratio against it.
SPLASH_BG_RGB = (255, 255, 255)
MIN_CONTRAST = 1.5


class BackgroundError(Exception):
    pass


# ---------- color ----------

def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """rgb: float array (..., 3) in 0..255 -> Lab (D65)."""
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = lin @ m.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    """Lab (D65) -> float sRGB (..., 3) in 0..255 (clipped)."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16.0 / 116.0) / 7.787)
    xyz *= np.array([0.95047, 1.0, 1.08883])
    m_inv = np.array([
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ])
    lin = np.clip(xyz @ m_inv.T, 0.0, 1.0)
    c = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    return np.clip(c * 255.0, 0, 255)


def relative_luminance(rgb: np.ndarray) -> np.ndarray:
    """WCAG relative luminance of sRGB 0..255."""
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return lin @ np.array([0.2126, 0.7152, 0.0722])


# ---------- invert / contrast ----------

def invert_lightness(img: Image.Image) -> Image.Image:
    """Flip Lab lightness (L -> 100 - L), keep hue/chroma and alpha."""
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    lab = srgb_to_lab(arr[..., :3])
    lab[..., 0] = 100.0 - lab[..., 0]
    rgb = lab_to_srgb(lab)
    out = np.dstack([rgb, arr[..., 3]]).round().astype(np.uint8)
    return Image.fromarray(out)


def logo_contrast(img: Image.Image, bg_rgb=SPLASH_BG_RGB) -> float:
    """WCAG contrast ratio between the alpha-weighted mean logo luminance and bg."""
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    w = arr[..., 3] / 255.0
    if w.sum() == 0:
        return 1.0
    y_logo = (relative_luminance(arr[..., :3]) * w).sum() / w.sum()
    y_bg = float(relative_luminance(np.array(bg_rgb, dtype=np.float64)))
    hi, lo = max(y_logo, y_bg), min(y_logo, y_bg)
    return (hi + 0.05) / (lo + 0.05)


# ---------- background removal ----------

def has_existing_transparency(alpha: np.ndarray) -> bool:
    return (alpha < 250).mean() > EXISTING_ALPHA_MIN_SHARE


def border_mask(h: int, w: int, band: int) -> np.ndarray:
    m = np.zeros((h, w), dtype=bool)
    m[:band, :] = m[-band:, :] = True
    m[:, :band] = m[:, -band:] = True
    return m


def remove_background(img: Image.Image, fill_holes: bool,
                      tol_low: float, tol_high: float) -> Image.Image:
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    rgb, alpha = arr[..., :3], arr[..., 3]
    h, w = alpha.shape

    band = max(2, round(min(h, w) * 0.01))
    border = border_mask(h, w, band)

    bg_rgb = np.median(rgb[border], axis=0)
    lab = srgb_to_lab(rgb)
    bg_lab = srgb_to_lab(bg_rgb[None, :])[0]
    dist = np.linalg.norm(lab - bg_lab, axis=-1)

    match = (dist[border] < tol_high).mean()
    if match < BORDER_MATCH_MIN:
        raise BackgroundError(
            f"Border is not a uniform background (only {match:.0%} of border "
            f"pixels match {tuple(int(v) for v in bg_rgb)}). "
            "Gradient/graphic background or logo covering the edges."
        )

    # Per-side consistency: each side's median color must be close to every
    # other side's. Catches smooth gradients, which pass the overall match test.
    sides = {
        "top": rgb[:band, :].reshape(-1, 3),
        "bottom": rgb[-band:, :].reshape(-1, 3),
        "left": rgb[:, :band].reshape(-1, 3),
        "right": rgb[:, -band:].reshape(-1, 3),
    }
    side_lab = {k: srgb_to_lab(np.median(v, axis=0)[None, :])[0] for k, v in sides.items()}
    names = list(side_lab)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            d = float(np.linalg.norm(side_lab[names[i]] - side_lab[names[j]]))
            if d > tol_high:
                raise BackgroundError(
                    f"Border is not a uniform background ({names[i]} and {names[j]} "
                    f"edges differ by Delta E {d:.1f} > {tol_high}). "
                    "Gradient/graphic background or logo covering most of an edge."
                )

    # Soft alpha from color distance.
    soft = np.clip((dist - tol_low) / (tol_high - tol_low), 0.0, 1.0)

    # Which pixels are allowed to become (partially) transparent.
    candidate = dist < tol_high
    labels, _ = ndimage.label(candidate)  # 4-connectivity: doesn't leak diagonally
    border_labels = np.unique(labels[border & candidate])
    region = np.isin(labels, border_labels[border_labels > 0])

    if fill_holes:
        core = dist < tol_low
        core_labels = np.unique(labels[core])
        region |= np.isin(labels, core_labels[core_labels > 0])

    new_alpha = np.where(region, soft, 1.0)

    # Color decontamination: C = (P - (1 - a) * B) / a
    a = new_alpha[..., None]
    with np.errstate(divide="ignore", invalid="ignore"):
        clean = (rgb - (1.0 - a) * bg_rgb) / a
    clean = np.where(a > 0, clean, 0.0)
    clean = np.where(region[..., None], clean, rgb)
    clean = np.clip(clean, 0, 255)

    out_alpha = new_alpha * alpha  # respect any existing alpha
    out = np.dstack([clean, out_alpha]).round().astype(np.uint8)
    return Image.fromarray(out)


# ---------- fit into circle ----------

def fit_in_circle(logo: Image.Image) -> Image.Image:
    alpha = np.asarray(logo.getchannel("A"))
    mask = alpha >= EXTENT_ALPHA_MIN
    if not mask.any():
        raise BackgroundError("Nothing left after background removal.")

    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    logo = logo.crop((x0, y0, x1, y1))

    # Center = bounding box center (in cropped coords).
    cx, cy = (x1 - x0) / 2.0, (y1 - y0) / 2.0
    px, py = xs - x0 + 0.5, ys - y0 + 0.5  # pixel centers
    # + half pixel diagonal so the pixel's footprint, not its center, fits.
    radius = np.sqrt((px - cx) ** 2 + (py - cy) ** 2).max() + math.sqrt(0.5)

    scale = (CIRCLE_DIAMETER / 2.0) / radius
    new_w = max(1, round(logo.width * scale))
    new_h = max(1, round(logo.height * scale))

    # Resize in premultiplied alpha to avoid dark/colored fringes.
    logo = logo.convert("RGBa").resize((new_w, new_h), Image.LANCZOS).convert("RGBA")

    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(logo, ((CANVAS_SIZE - new_w) // 2, (CANVAS_SIZE - new_h) // 2))
    return canvas


# ---------- main ----------

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("path", nargs="?", help="logo image (asked interactively if omitted)")
    p.add_argument("--keep-holes", action="store_true",
                   help="keep enclosed background-colored regions (e.g. inside letters) opaque")
    p.add_argument("--invert", action="store_true",
                   help="invert logo lightness after background removal (for light logos)")
    p.add_argument("--tol-low", type=float, default=TOL_LOW)
    p.add_argument("--tol-high", type=float, default=TOL_HIGH)
    p.add_argument("--keep-bg", action="store_true", help="skip background removal")
    args = p.parse_args()

    raw = args.path or input("Path to logo image: ")
    src = Path(raw.strip().strip('"').strip("'")).expanduser()
    if not src.is_file():
        sys.exit(f"File not found: {src}")

    img = Image.open(src).convert("RGBA")

    try:
        if args.keep_bg:
            print("Background removal skipped (--keep-bg).")
        elif has_existing_transparency(np.asarray(img.getchannel("A"))):
            print("Image already has transparency — background removal skipped.")
        else:
            img = remove_background(img, not args.keep_holes, args.tol_low, args.tol_high)
            print("Background removed.")

        if args.invert:
            img = invert_lightness(img)
            print("Lightness inverted (--invert).")

        contrast = logo_contrast(img)
        if contrast < MIN_CONTRAST:
            hint = "" if args.invert else " Consider running with --invert."
            print(f"WARNING: low contrast against a white splash "
                  f"({contrast:.2f}:1, minimum {MIN_CONTRAST}:1).{hint}")

        result = fit_in_circle(img)
    except BackgroundError as e:
        sys.exit(f"Error: {e}")

    out = src.with_name(f"{src.stem}_{CANVAS_SIZE}.png")
    result.save(out, "PNG")
    print(f"Saved: {out}")


if __name__ == "__main__":
    main()
