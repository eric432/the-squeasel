#!/usr/bin/env python3
"""Build the unusual-file kit used by the Rust edge-case test.

Dev-only. Nothing here is shipped with the app.

ImageMagick is not installed, and this Python has no Pillow, so the files are
written with the standard library. macOS sips embeds the Display P3 and Adobe
RGB profiles and writes the HEIC. The CMYK JPEG, 16-bit TIFF, indexed PNG,
grayscale PNG, and animated GIF are written directly.

The folder is a sibling of the counted phase kits. Those tests expect 7, 10,
and 200 images, so these files must not be dropped into those folders.

    python3 scripts/make-edge-cases.py
"""

import struct
import subprocess
import sys
import zlib
from pathlib import Path

OUT = Path.home() / "Desktop" / "squeasel-phase1-test-kit" / "squeasel-edge-cases"
DISPLAY_P3 = "/System/Library/ColorSync/Profiles/Display P3.icc"
ADOBE_RGB = "/System/Library/ColorSync/Profiles/AdobeRGB1998.icc"

# Stored JPEG numbers. Display P3 and Adobe RGB are tagged onto the same warm
# color. Pure green clips back to the same bytes, so it cannot show the conversion.
# The other files are this blue.
WARM = (200, 80, 40)
BLUE = (40, 120, 200)
# Inverted CMYK ink: no cyan, full magenta, full yellow, no black → red.
CMYK_RED = (255, 0, 0, 255)
GRAY = 140
INDEXED = (20, 140, 220)
DEPTH16 = 32768
LONG_STEM = "n" * 220

# Standard luminance Huffman tables (JPEG spec K.3 / K.5).
DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
DC_VALS = list(range(12))
AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7D]
AC_VALS = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
    0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
    0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
    0xF9, 0xFA,
]


class BitWriter:
    def __init__(self):
        self.acc = 0
        self.n = 0
        self.out = bytearray()

    def write(self, code, length):
        self.acc = (self.acc << length) | code
        self.n += length
        while self.n >= 8:
            self.n -= 8
            byte = (self.acc >> self.n) & 0xFF
            self.out.append(byte)
            if byte == 0xFF:
                self.out.append(0)
            self.acc = self.acc & ((1 << self.n) - 1) if self.n else 0

    def finish(self):
        if self.n:
            pad = 8 - self.n
            byte = ((self.acc << pad) | ((1 << pad) - 1)) & 0xFF
            self.out.append(byte)
            if byte == 0xFF:
                self.out.append(0)
        return bytes(self.out)


def canonical(counts, symbols):
    code = 0
    index = 0
    codes = {}
    for length, count in enumerate(counts, start=1):
        for _ in range(count):
            codes[symbols[index]] = (code, length)
            index += 1
            code += 1
        code <<= 1
    if index != len(symbols):
        raise SystemExit("Huffman table does not match its symbols")
    return codes


DC_CODES = canonical(DC_BITS, DC_VALS)
AC_CODES = canonical(AC_BITS, AC_VALS)
if AC_CODES[0x00] != (0b1010, 4):
    raise SystemExit("the end-of-block code is not the JPEG standard code")


def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path, width, height, bit_depth, color_type, rows, palette=None):
    ihdr = struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, 0)
    parts = [b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", ihdr)]
    if palette is not None:
        parts.append(chunk(b"PLTE", palette))
    raw = b"".join(b"\x00" + row for row in rows)
    parts.append(chunk(b"IDAT", zlib.compress(raw, 9)))
    parts.append(chunk(b"IEND", b""))
    path.write_bytes(b"".join(parts))


def dht(class_id, counts, symbols):
    payload = bytes([class_id]) + bytes(counts) + bytes(symbols)
    return b"\xff\xc4" + struct.pack(">H", len(payload) + 2) + payload


def write_dc(bits, diff):
    if diff == 0:
        code, length = DC_CODES[0]
        bits.write(code, length)
        return
    category = abs(diff).bit_length()
    code, length = DC_CODES[category]
    bits.write(code, length)
    extra = diff if diff > 0 else diff + (1 << category) - 1
    bits.write(extra, category)


def solid_jpeg(path, width, height, samples):
    """Baseline JPEG of one flat color. Quant table is all ones, so the DC is exact."""
    if width % 8 or height % 8:
        raise SystemExit(f"{path.name} must be a multiple of 8")
    components = len(samples)
    sof_body = struct.pack(">BHHB", 8, height, width, components)
    for index in range(components):
        sof_body += bytes([index + 1, 0x11, 0])
    sos_body = bytes([components])
    for index in range(components):
        sos_body += bytes([index + 1, 0x00])
    sos_body += bytes([0x00, 0x3F, 0x00])
    # Transform 0: three channels are RGB, four are CMYK. Without it, a
    # decoder treats three channels as YCbCr and the flat color comes out wrong.
    adobe = b"Adobe\x00\x64\x00\x00\x00\x00\x00"
    app14 = b"\xff\xee" + struct.pack(">H", len(adobe) + 2) + adobe if components in (3, 4) else b""
    bits = BitWriter()
    predictors = [0] * components
    mcus = (width // 8) * (height // 8)
    for _ in range(mcus):
        for index, sample in enumerate(samples):
            dc = 8 * (sample - 128)
            write_dc(bits, dc - predictors[index])
            predictors[index] = dc
            eob, eob_len = AC_CODES[0x00]
            bits.write(eob, eob_len)
    entropy = bits.finish()
    jfif = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    parts = [
        b"\xff\xd8",
        b"\xff\xe0" + struct.pack(">H", len(jfif) + 2) + jfif,
        app14,
        b"\xff\xdb" + struct.pack(">H", 67) + bytes([0]) + bytes([1] * 64),
        dht(0x00, DC_BITS, DC_VALS),
        dht(0x10, AC_BITS, AC_VALS),
        b"\xff\xc0" + struct.pack(">H", len(sof_body) + 2) + sof_body,
        b"\xff\xda" + struct.pack(">H", len(sos_body) + 2) + sos_body,
        entropy,
        b"\xff\xd9",
    ]
    path.write_bytes(b"".join(parts))


def write_tiff16(path, width, height, value):
    """Uncompressed little-endian 16-bit RGB. No profile, so the value stays put."""
    count = 10
    entries = 2 + count * 12 + 4
    bits_at = 8 + entries
    pixels_at = bits_at + 6
    pixels = struct.pack("<H", value) * 3 * width * height

    def entry(tag, typ, number, value_or_offset):
        return struct.pack("<HHI", tag, typ, number) + struct.pack("<I", value_or_offset)

    ifd = struct.pack("<H", count)
    ifd += entry(256, 4, 1, width)
    ifd += entry(257, 4, 1, height)
    ifd += entry(258, 3, 3, bits_at)
    ifd += entry(259, 3, 1, 1)
    ifd += entry(262, 3, 1, 2)
    ifd += entry(273, 4, 1, pixels_at)
    ifd += entry(277, 3, 1, 3)
    ifd += entry(278, 4, 1, height)
    ifd += entry(279, 4, 1, len(pixels))
    ifd += entry(284, 3, 1, 1)
    ifd += struct.pack("<I", 0)
    header = b"II" + struct.pack("<HI", 42, 8)
    path.write_bytes(header + ifd + struct.pack("<HHH", 16, 16, 16) + pixels)


def gif_lzw(pixels, min_code_size):
    clear = 1 << min_code_size
    eoi = clear + 1
    code_size = min_code_size + 1
    next_code = eoi + 1
    table = {(None, i): i for i in range(clear)}
    acc = 0
    nbits = 0
    raw = bytearray()

    def emit(code):
        nonlocal acc, nbits, code_size
        acc |= code << nbits
        nbits += code_size
        while nbits >= 8:
            raw.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8

    emit(clear)
    prefix = None
    for pixel in pixels:
        key = (prefix, pixel)
        if key in table:
            prefix = table[key]
            continue
        emit(prefix)
        if next_code < 4096:
            table[key] = next_code
            next_code += 1
            # The decoder grows the code width one entry later than a naive count.
            if next_code > (1 << code_size) and code_size < 12:
                code_size += 1
        else:
            emit(clear)
            table = {(None, i): i for i in range(clear)}
            next_code = eoi + 1
            code_size = min_code_size + 1
        prefix = pixel
    if prefix is not None:
        emit(prefix)
        if next_code + 1 > (1 << code_size) and code_size < 12:
            code_size += 1
    emit(eoi)
    if nbits:
        raw.append(acc & 0xFF)
    blocks = bytearray([min_code_size])
    for start in range(0, len(raw), 255):
        piece = raw[start : start + 255]
        blocks.append(len(piece))
        blocks.extend(piece)
    blocks.append(0)
    return bytes(blocks)


def write_animated_gif(path, width, height, frames):
    colors = []
    for rgb, _delay in frames:
        if rgb not in colors:
            colors.append(rgb)
    size = 2
    while size < len(colors):
        size *= 2
    while len(colors) < size:
        colors.append((0, 0, 0))
    field = (size - 1).bit_length() - 1
    packed = 0x80 | (field << 4) | field
    out = bytearray(b"GIF89a")
    out += struct.pack("<HH", width, height)
    out += bytes([packed, 0, 0])
    for red, green, blue in colors:
        out += bytes([red, green, blue])
    out += b"!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    min_code_size = max(2, field)
    for rgb, delay in frames:
        index = colors.index(rgb)
        out += b"!\xf9\x04" + bytes([0x00, delay & 0xFF, (delay >> 8) & 0xFF, 0x00, 0x00])
        out += b"," + struct.pack("<HHHH", 0, 0, width, height) + b"\x00"
        out += gif_lzw(bytes([index]) * (width * height), min_code_size)
    out += b";"
    path.write_bytes(out)


def inject_orientation(jpeg, orientation):
    """One-tag little-endian Exif APP1, matching the orientation the app's tests use."""
    exif = bytearray([
        0xFF, 0xE1, 0x00, 0x22, ord("E"), ord("x"), ord("i"), ord("f"), 0x00, 0x00,
        ord("I"), ord("I"), 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    ])
    exif += orientation.to_bytes(2, "little")
    exif += bytes(6)
    return jpeg[:2] + exif + jpeg[2:]


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"{' '.join(args)}\n{result.stderr}\n{result.stdout}")
    return result.stdout


def sips_get(path, key):
    text = run(["sips", "-g", key, str(path)])
    for line in text.splitlines():
        if ":" in line:
            name, value = line.split(":", 1)
            if name.strip() == key:
                return value.strip()
    raise SystemExit(f"sips did not report {key} for {path.name}\n{text}")


def paeth(left, up, up_left):
    estimate = left + up - up_left
    nearest = min((abs(estimate - left), left), (abs(estimate - up), up), (abs(estimate - up_left), up_left))
    return nearest[1]


def unfilter(raw, width, height, channels, depth):
    sample_bytes = 2 if depth == 16 else 1
    bpp = channels * sample_bytes
    stride = 1 + width * bpp
    prev = bytearray(width * bpp)
    rows = []
    for y in range(height):
        row = raw[y * stride : (y + 1) * stride]
        kind = row[0]
        data = bytearray(row[1:])
        for index in range(len(data)):
            left = data[index - bpp] if index >= bpp else 0
            up = prev[index]
            up_left = prev[index - bpp] if index >= bpp else 0
            if kind == 1:
                data[index] = (data[index] + left) & 255
            elif kind == 2:
                data[index] = (data[index] + up) & 255
            elif kind == 3:
                data[index] = (data[index] + ((left + up) // 2)) & 255
            elif kind == 4:
                data[index] = (data[index] + paeth(left, up, up_left)) & 255
            elif kind != 0:
                raise SystemExit(f"unknown PNG filter {kind}")
        prev = data
        rows.append(data)
    return rows


def png_center(path):
    data = path.read_bytes()
    pos = 8
    width = height = color = depth = 0
    idat = b""
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        chunk_data = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", chunk_data[:10])
        elif tag == b"IDAT":
            idat += chunk_data
        elif tag == b"IEND":
            break
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    rows = unfilter(zlib.decompress(idat), width, height, channels, depth)
    row = rows[height // 2]
    offset = (width // 2) * channels * (2 if depth == 16 else 1)
    if depth == 16:
        return tuple(struct.unpack(">H", row[offset + i : offset + i + 2])[0] for i in range(0, 6, 2))
    if channels == 1:
        return (row[offset],) * 3
    return tuple(row[offset : offset + 3])


def sips_png_center(path):
    dest = path.with_suffix(".check.png")
    run(["sips", "-s", "format", "png", str(path), "--out", str(dest)])
    try:
        return png_center(dest)
    finally:
        dest.unlink(missing_ok=True)


def near(got, expected, tol, label):
    if any(abs(a - b) > tol for a, b in zip(got, expected)):
        raise SystemExit(f"{label}: got {got}, expected {expected}")


def main():
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    dest.mkdir(parents=True, exist_ok=True)

    base = dest / "_warm.jpg"
    solid_jpeg(base, 8, 8, WARM)
    near(sips_png_center(base), WARM, 1, "flat warm jpeg")
    for name, profile, label in (
        ("display-p3.jpg", DISPLAY_P3, "Display P3"),
        ("adobe-rgb.jpg", ADOBE_RGB, "Adobe RGB"),
    ):
        target = dest / name
        run(["sips", "-e", profile, str(base), "--out", str(target)])
        reported = sips_get(target, "profile")
        if label.split()[0] not in reported and label not in reported:
            raise SystemExit(f"{name} profile is {reported}")
        # sips may color-manage on the way to PNG. The stored numbers are checked
        # by the Rust test, which compares a profile-blind decode with our conversion.
        center = sips_png_center(target)
        if not (center[0] > center[1] > center[2]):
            raise SystemExit(f"{name} lost its warm color: {center}")
    base.unlink()

    cmyk = dest / "cmyk.jpg"
    solid_jpeg(cmyk, 8, 8, CMYK_RED)
    space = sips_get(cmyk, "space")
    if space != "CMYK":
        raise SystemExit(f"cmyk.jpg space is {space}")
    # sips applies a CMYK profile on export. The app uses the JPEG decoder's
    # plain CMYK conversion, which the kit test checks for pure red.
    red, green, blue = sips_png_center(cmyk)
    if not (red > 180 and red > green + 80 and red > blue + 80):
        raise SystemExit(f"cmyk.jpg did not come out red: {(red, green, blue)}")

    rows16 = [struct.pack(">H", DEPTH16) * 3 * 8 for _ in range(8)]
    write_png(dest / "depth-16.png", 8, 8, 16, 2, rows16)
    near(png_center(dest / "depth-16.png"), (DEPTH16, DEPTH16, DEPTH16), 0, "16-bit png")
    write_tiff16(dest / "depth-16.tif", 8, 8, DEPTH16)
    if sips_get(dest / "depth-16.tif", "bitsPerSample") != "16":
        raise SystemExit("16-bit tiff was not 16-bit")

    write_png(dest / "indexed.png", 8, 8, 8, 3, [bytes([0] * 8) for _ in range(8)], bytes(INDEXED))
    write_png(dest / "gray.png", 8, 8, 8, 0, [bytes([GRAY] * 8) for _ in range(8)])

    write_animated_gif(
        dest / "animation.gif",
        8,
        8,
        [((220, 30, 30), 10), ((30, 30, 220), 10)],
    )
    if dest.joinpath("animation.gif").read_bytes().count(b",") < 2:
        raise SystemExit("animation.gif does not have two frames")

    blue = dest / "_blue.jpg"
    solid_jpeg(blue, 8, 8, BLUE)
    near(sips_png_center(blue), BLUE, 1, "flat blue jpeg")
    run(["sips", "-s", "format", "heic", str(blue), "--out", str(dest / "photo.heic")])
    if "heic" not in sips_get(dest / "photo.heic", "format").lower():
        raise SystemExit("photo.heic is not HEIC")

    # Landscape pixels, orientation 6, Display P3, and a copyright line.
    # sips keeps all four on the HEIC. The app should turn it upright.
    wide = dest / "_wide.jpg"
    solid_jpeg(wide, 32, 16, WARM)
    oriented = dest / "_oriented.jpg"
    oriented.write_bytes(inject_orientation(wide.read_bytes(), 6))
    profiled = dest / "_oriented-p3.jpg"
    run(["sips", "-e", DISPLAY_P3, str(oriented), "--out", str(profiled)])
    tagged = dest / "_tagged.jpg"
    run([
        "sips",
        "-s", "copyright", "(c) 2026 Bitclone Test",
        "-s", "artist", "Test Artist",
        str(profiled),
        "--out", str(tagged),
    ])
    run(["sips", "-s", "format", "heic", str(tagged), "--out", str(dest / "credit-p3.heic")])
    if sips_get(dest / "credit-p3.heic", "profile").find("P3") < 0:
        raise SystemExit("credit-p3.heic lost Display P3")
    if sips_get(dest / "credit-p3.heic", "copyright") != "(c) 2026 Bitclone Test":
        raise SystemExit("credit-p3.heic lost its copyright")
    for leftover in (wide, oriented, profiled, tagged):
        leftover.unlink()

    for name in ("cafe photo.jpg", "café.jpg", "sunset 🌅.jpg", f"{LONG_STEM}.jpg"):
        solid_jpeg(dest / name, 8, 8, BLUE)
    blue.unlink()

    panorama = dest / "panorama-12000x3000.jpg"
    solid_jpeg(panorama, 12000, 3000, BLUE)
    if (sips_get(panorama, "pixelWidth"), sips_get(panorama, "pixelHeight")) != ("12000", "3000"):
        raise SystemExit("panorama is not 12000×3000")

    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
