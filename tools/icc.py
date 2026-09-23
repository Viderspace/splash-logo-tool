"""
Minimal ICC v2 matrix/TRC display profiles, written byte-for-byte here so test
fixtures are deterministic and don't depend on OS profile files.
"""

import struct


def _s15f16(v: float) -> bytes:
    return struct.pack(">i", int(round(v * 65536)))


def _xyz(x: float, y: float, z: float) -> bytes:
    return b"XYZ " + b"\0" * 4 + _s15f16(x) + _s15f16(y) + _s15f16(z)


def _curve_gamma(gamma_u8f8: int) -> bytes:
    return b"curv" + b"\0" * 4 + struct.pack(">IH", 1, gamma_u8f8) + b"\0\0"


def _curve_srgb(n: int = 1024) -> bytes:
    vals = []
    for i in range(n):
        c = i / (n - 1)
        lin = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        vals.append(int(round(lin * 65535)))
    return b"curv" + b"\0" * 4 + struct.pack(">I", n) + struct.pack(f">{n}H", *vals)


def _profile(description: str, colorants, trc: bytes) -> bytes:
    desc_text = description.encode("ascii") + b"\0"
    desc = (b"desc" + b"\0" * 4 + struct.pack(">I", len(desc_text)) + desc_text
            + struct.pack(">II", 0, 0) + struct.pack(">HB", 0, 0) + b"\0" * 67)
    cprt = b"text" + b"\0" * 4 + b"No copyright, test data\0"
    r, g, b = colorants
    tags = [
        (b"desc", desc), (b"cprt", cprt), (b"wtpt", _xyz(0.9642, 1.0, 0.8249)),
        (b"rXYZ", _xyz(*r)), (b"gXYZ", _xyz(*g)), (b"bXYZ", _xyz(*b)),
        (b"rTRC", trc), (b"gTRC", trc), (b"bTRC", trc),
    ]
    offset = 128 + 4 + 12 * len(tags)
    table, data, placed = b"", b"", {}
    for sig, blob in tags:
        if blob not in placed:  # the three TRC tags share one curve
            placed[blob] = offset + len(data)
            data += blob + b"\0" * (-len(blob) % 4)
        table += sig + struct.pack(">II", placed[blob], len(blob))
    size = offset + len(data)
    header = (struct.pack(">I", size) + b"\0" * 4 + struct.pack(">I", 0x02100000) + b"mntrRGB XYZ "
              + struct.pack(">6H", 2026, 1, 1, 0, 0, 0) + b"acsp" + b"\0" * 24
              + struct.pack(">I", 0) + _s15f16(0.9642) + _s15f16(1.0) + _s15f16(0.8249) + b"\0" * 48)
    assert len(header) == 128
    return header + struct.pack(">I", len(tags)) + table + data


def srgb_icc() -> bytes:
    """sRGB primaries (D50-adapted colorants) with the sRGB tone curve."""
    return _profile("sRGB (synthetic test profile)",
                    ((0.4360747, 0.2225045, 0.0139322),
                     (0.3850649, 0.7168786, 0.0971045),
                     (0.1430804, 0.0606169, 0.7141733)),
                    _curve_srgb())


def display_p3_icc() -> bytes:
    """Display P3 primaries (D50-adapted colorants, as in Apple's Display P3
    profile) with a gamma 2.2 tone curve."""
    return _profile("Display P3 (synthetic test profile)",
                    ((0.515121, 0.241196, -0.001053),
                     (0.291977, 0.692245, 0.041885),
                     (0.157104, 0.066574, 0.784073)),
                    _curve_gamma(0x0233))
