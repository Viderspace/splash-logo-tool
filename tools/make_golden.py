"""
Generate golden outputs from the Python reference (reference_logo_to_square.py).

Two tiers, each with its own output folder and manifest:
  public   example_logos/ + test_images/synthetic/  -> goldens/          (committed)
  private  private_fixtures/                        -> goldens_private/  (gitignored;
           generated only when private_fixtures/ exists)

For each input <case> (paths shown for the public tier):
  goldens/<case>/input.png                 Image.open(...).convert("RGBA"), i.e. exactly
                                           the buffer the reference processes
  goldens/<case>/<variant>/removed.png     right after remove_background (source res), if it ran
  goldens/<case>/<variant>/final.png       the 1152 output, if no error
  goldens/<case>/<variant>/meta.json       decisions + diagnostics

Plus:
  goldens/pillow/                          Pillow premultiply/unpremultiply tables and
                                           resize-only fixtures for the TS resampler
  goldens/manifest.json                    SHA-256 of the reference script, the tools and
                                           every input file (staleness guard)

Drift guard: for the default variant of every input, the reference CLI itself is
run on a temp copy; its PNG must be byte-identical to final.png and its printed
skip/warning/error lines must match meta.json. Any mismatch aborts generation.

Variants beyond "default" are chosen by the case's numeric prefix (01, 02, s03, ...),
so they don't depend on file names and apply to both tiers.

Run:  .venv/bin/python tools/make_golden.py [--tier public|private|all]   (default: all)
"""

import argparse
import hashlib
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import PIL
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REF_PATH = ROOT / "reference_logo_to_square.py"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
TOOLS = ROOT / "tools"

TIERS = {
    "public": {
        "inputs": [ROOT / "example_logos", ROOT / "test_images" / "synthetic"],
        "out": ROOT / "goldens",
        "tools": [TOOLS / "make_golden.py", TOOLS / "make_synthetic.py", TOOLS / "icc.py"],
        "pillow_fixtures": True,
    },
    "private": {
        "inputs": [ROOT / "private_fixtures"],
        "out": ROOT / "goldens_private",
        "tools": [TOOLS / "make_golden.py"],
        "pillow_fixtures": False,
    },
}

spec = importlib.util.spec_from_file_location("ref", REF_PATH)
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)

DEFAULT = {"keep_holes": False, "invert": False, "keep_bg": False,
           "tol_low": ref.TOL_LOW, "tol_high": ref.TOL_HIGH}

# Extra variants by case prefix (the "default" variant is always generated).
EXTRA_VARIANTS = {
    "01": {"invert": {"invert": True}},
    "02": {"keep_holes": {"keep_holes": True}, "keep_bg": {"keep_bg": True}},
    "03": {"keep_holes": {"keep_holes": True}},
    "05": {"invert": {"invert": True}},
    "07": {"keep_holes": {"keep_holes": True}, "tol_10_30": {"tol_low": 10.0, "tol_high": 30.0}},
    "s03": {"keep_holes": {"keep_holes": True}},
    "s05": {"invert": {"invert": True}},
    "s08": {"keep_bg": {"keep_bg": True}},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def list_inputs(dirs):
    files = []
    for d in dirs:
        files += sorted(p for p in d.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    stems = [p.stem for p in files]
    dupes = {s for s in stems if stems.count(s) > 1}
    if dupes:
        raise SystemExit(f"duplicate case names in one tier: {sorted(dupes)}")
    return files


def error_kind(message: str) -> str:
    if message.startswith("Border is not a uniform background (only"):
        return "borderMatch"
    if "edges differ by Delta E" in message:
        return "sideMismatch"
    if message.startswith("Nothing left"):
        return "empty"
    raise ValueError(f"unknown error message: {message}")


def removal_diagnostics(img: Image.Image, tol_high: float) -> dict:
    """Recompute (with the reference's own expressions) the values that
    remove_background uses internally but does not return."""
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    rgb = arr[..., :3]
    h, w = arr.shape[:2]
    band = max(2, round(min(h, w) * 0.01))
    border = ref.border_mask(h, w, band)
    bg_rgb = np.median(rgb[border], axis=0)
    lab = ref.srgb_to_lab(rgb)
    bg_lab = ref.srgb_to_lab(bg_rgb[None, :])[0]
    dist = np.linalg.norm(lab - bg_lab, axis=-1)
    match = float((dist[border] < tol_high).mean())
    return {"band": int(band), "bg_rgb": [float(v) for v in bg_rgb],
            "bg_lab": [float(v) for v in bg_lab], "match": match}


def fit_diagnostics(img: Image.Image) -> dict:
    """Same expressions as fit_in_circle, recorded for the report."""
    alpha = np.asarray(img.getchannel("A"))
    mask = alpha >= ref.EXTENT_ALPHA_MIN
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cx, cy = (x1 - x0) / 2.0, (y1 - y0) / 2.0
    px, py = xs - x0 + 0.5, ys - y0 + 0.5
    radius = np.sqrt((px - cx) ** 2 + (py - cy) ** 2).max() + math.sqrt(0.5)
    scale = (ref.CIRCLE_DIAMETER / 2.0) / radius
    return {"crop": [int(x0), int(y0), int(x1), int(y1)], "radius": float(radius),
            "scale": float(scale),
            "new_size": [max(1, round(int(x1 - x0) * scale)), max(1, round(int(y1 - y0) * scale))]}


def run_variant(src: Image.Image, opts: dict, out_dir: Path) -> dict:
    """Mirror of reference main() control flow (main() itself saves next to the
    source and exits, so it can't be called directly; the CLI drift guard below
    verifies this mirror against it)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {"options": opts, "skip": None, "removal": None, "error": None,
            "contrast": None, "low_contrast": None, "fit": None, "log": []}
    img = src
    try:
        if opts["keep_bg"]:
            meta["skip"] = "keepBg"
            meta["log"].append("Background removal skipped (--keep-bg).")
        elif ref.has_existing_transparency(np.asarray(img.getchannel("A"))):
            meta["skip"] = "alreadyTransparent"
            meta["log"].append("Image already has transparency — background removal skipped.")
        else:
            meta["removal"] = removal_diagnostics(img, opts["tol_high"])
            img = ref.remove_background(img, not opts["keep_holes"], opts["tol_low"], opts["tol_high"])
            img.save(out_dir / "removed.png", "PNG")
            meta["log"].append("Background removed.")

        if opts["invert"]:
            img = ref.invert_lightness(img)
            meta["log"].append("Lightness inverted (--invert).")

        contrast = ref.logo_contrast(img)
        meta["contrast"] = float(contrast)
        meta["low_contrast"] = bool(contrast < ref.MIN_CONTRAST)
        if contrast < ref.MIN_CONTRAST:
            hint = "" if opts["invert"] else " Consider running with --invert."
            meta["log"].append(f"WARNING: low contrast against a white splash "
                               f"({contrast:.2f}:1, minimum {ref.MIN_CONTRAST}:1).{hint}")

        if np.asarray(img.getchannel("A")).max() >= ref.EXTENT_ALPHA_MIN:
            meta["fit"] = fit_diagnostics(img)
        result = ref.fit_in_circle(img)
        result.save(out_dir / "final.png", "PNG")
    except ref.BackgroundError as e:
        meta["error"] = {"kind": error_kind(str(e)), "message": str(e)}
    return meta


def cli_guard(src_path: Path, meta: dict, final_path: Path) -> None:
    """Run the reference CLI on a temp copy and compare with our default variant."""
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / src_path.name
        shutil.copyfile(src_path, tmp)
        proc = subprocess.run([sys.executable, str(REF_PATH), str(tmp)],
                              capture_output=True, text=True)
        out_png = tmp.with_name(f"{tmp.stem}_{ref.CANVAS_SIZE}.png")
        stdout = [l for l in proc.stdout.splitlines() if not l.startswith("Saved: ")]
        problems = []
        if stdout != meta["log"]:
            problems.append(f"stdout {stdout!r} != meta log {meta['log']!r}")
        if meta["error"]:
            want = f"Error: {meta['error']['message']}"
            if proc.returncode == 0 or proc.stderr.strip() != want:
                problems.append(f"expected failure {want!r}, got rc={proc.returncode} stderr={proc.stderr!r}")
            if out_png.exists():
                problems.append("CLI wrote an output although an error was expected")
        else:
            if proc.returncode != 0:
                problems.append(f"CLI failed: rc={proc.returncode} stderr={proc.stderr!r}")
            elif out_png.read_bytes() != final_path.read_bytes():
                problems.append("CLI output PNG is not byte-identical to final.png")
        if problems:
            raise SystemExit(f"DRIFT GUARD FAILED for {src_path.name}:\n  " + "\n  ".join(problems))


def make_pillow_fixtures(out: Path) -> None:
    d = out / "pillow"
    d.mkdir(parents=True, exist_ok=True)
    # Exhaustive tables: pixel (x=v, y=a) -> converted value of channel R.
    v = np.arange(256, dtype=np.uint8)
    grid = np.zeros((256, 256, 4), dtype=np.uint8)
    grid[..., 0] = v[None, :]
    grid[..., 1] = v[None, :]
    grid[..., 2] = v[None, :]
    grid[..., 3] = v[:, None]
    premul = Image.frombytes("RGBA", (256, 256), grid.tobytes()).convert("RGBa")
    (d / "premultiply_r.bin").write_bytes(bytes(np.frombuffer(premul.tobytes(), np.uint8)[0::4]))
    unpremul = Image.frombytes("RGBa", (256, 256), grid.tobytes()).convert("RGBA")
    (d / "unpremultiply_r.bin").write_bytes(bytes(np.frombuffer(unpremul.tobytes(), np.uint8)[0::4]))

    # Resize-only fixtures on a premultiplied buffer (stored as raw RGBA PNGs).
    rng = np.random.default_rng(1234)
    h, w = 61, 83
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    a = np.clip(1.2 - np.sqrt(((xx - 41) / 38) ** 2 + ((yy - 30) / 27) ** 2), 0, 1)
    base = np.zeros((h, w, 4), dtype=np.float64)
    base[..., 0] = 128 + 127 * np.sin(xx / 5.0)
    base[..., 1] = 128 + 127 * np.cos(yy / 7.0)
    base[..., 2] = rng.integers(0, 256, (h, w))
    base[..., 3] = np.round(a * 255)
    rgba = Image.frombytes("RGBA", (w, h), np.round(base).astype(np.uint8).tobytes())
    src = rgba.convert("RGBa")
    Image.frombytes("RGBA", (w, h), src.tobytes()).save(d / "resize_src.png")
    sizes = [(83, 61), (40, 30), (17, 9), (84, 62), (200, 147), (768, 565), (1, 1), (83, 20), (5, 61)]
    for (nw, nh) in sizes:
        out = src.resize((nw, nh), Image.LANCZOS)
        Image.frombytes("RGBA", (nw, nh), out.tobytes()).save(d / f"resize_{nw}x{nh}.png")
    (d / "resize_sizes.json").write_text(json.dumps(sizes))


def generate_tier(name: str) -> None:
    tier = TIERS[name]
    out: Path = tier["out"]
    inputs = list_inputs(tier["inputs"])
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()

    if tier["pillow_fixtures"]:
        make_pillow_fixtures(out)

    cases = []
    for path in inputs:
        case = path.stem
        case_dir = out / case
        case_dir.mkdir()
        src = Image.open(path).convert("RGBA")
        src.save(case_dir / "input.png", "PNG")

        variants = {"default": {}} | EXTRA_VARIANTS.get(case.split("_")[0], {})
        summary = {}
        for vname, overrides in variants.items():
            opts = DEFAULT | overrides
            vdir = case_dir / vname
            meta = run_variant(src, opts, vdir)
            (vdir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
            if vname == "default":
                cli_guard(path, meta, vdir / "final.png")
            summary[vname] = (meta["error"]["kind"] if meta["error"] else
                              ("skip:" + meta["skip"] if meta["skip"] else "removed") +
                              (" LOW-CONTRAST" if meta["low_contrast"] else ""))
        cases.append({"case": case, "source": rel(path), "variants": list(variants)})
        print(f"  {case}: " + ", ".join(f"{k}={v}" for k, v in summary.items()))

    manifest = {
        "note": "Generated by tools/make_golden.py. Do not edit.",
        "tier": name,
        "pillow": PIL.__version__,
        "numpy": np.__version__,
        "hashes": {rel(p): sha256(p) for p in [REF_PATH, *tier["tools"], *inputs]},
        "input_dirs": [rel(d) for d in tier["inputs"]],
        "image_exts": sorted(IMAGE_EXTS),
        "cases": cases,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"{name}: wrote {len(cases)} cases to {rel(out)} (CLI drift guard passed for all).")


def main() -> None:
    p = argparse.ArgumentParser(description="Generate golden outputs from the reference.")
    p.add_argument("--tier", choices=["public", "private", "all"], default="all")
    args = p.parse_args()
    has_private = TIERS["private"]["inputs"][0].is_dir()

    if args.tier in ("public", "all"):
        print("public tier:")
        generate_tier("public")
    if args.tier in ("private", "all"):
        if has_private:
            print("private tier:")
            generate_tier("private")
        elif args.tier == "private":
            raise SystemExit("private_fixtures/ not found.")
        else:
            print("private tier skipped: private_fixtures/ not found.")


if __name__ == "__main__":
    main()
