#!/usr/bin/env python3
"""Generate the PWA / home-screen icons with no external dependencies.
Draws a dark background, a ring of neon dots, and a white dancer pictogram.
Run: python3 tools/gen_icons.py
"""
import math
import os
import struct
import zlib

NEON = [
    (255, 45, 149), (255, 123, 0), (255, 230, 0), (138, 43, 226),
    (34, 211, 238), (0, 255, 163), (0, 180, 255), (176, 38, 255),
]


def clamp(v, lo=0, hi=255):
    return lo if v < lo else hi if v > hi else v


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        t = 0.0
    else:
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    cx, cy = ax + dx * t, ay + dy * t
    return math.hypot(px - cx, py - cy)


# Dancer pictogram segments in [-0.5,0.5] space (thickness, ...).
HEAD = (0.0, -0.20, 0.085)
LIMBS = [
    (0.0, -0.11, 0.0, 0.10, 0.052),   # torso
    (0.0, -0.05, -0.18, 0.04, 0.045), # arm L
    (0.0, -0.05, 0.18, 0.04, 0.045),  # arm R
    (0.0, 0.10, -0.10, 0.30, 0.048),  # leg L
    (0.0, 0.10, 0.10, 0.30, 0.048),   # leg R
]


def pixel(x, y, w, h):
    u = (x + 0.5) / w - 0.5
    v = (y + 0.5) / h - 0.5
    d = math.hypot(u, v)
    # background: purple core fading to near-black
    col = mix((26, 15, 46), (5, 1, 10), smoothstep(0.0, 0.62, d))

    # ring of neon dots
    ring_r = 0.40
    for i, c in enumerate(NEON * 2):  # 16 dots
        n = 16
        if i >= n:
            break
        a = (i / n) * math.tau - math.pi / 2
        dx, dy = math.cos(a) * ring_r, math.sin(a) * ring_r
        dd = math.hypot(u - dx, v - dy)
        glow = smoothstep(0.060, 0.018, dd)
        if glow > 0:
            col = mix(col, c, glow)

    # white pictogram
    white = (245, 245, 255)
    hx, hy, hr = HEAD
    inside = smoothstep(hr + 0.012, hr - 0.006, math.hypot(u - hx, v - hy))
    for (ax, ay, bx, by, th) in LIMBS:
        sd = seg_dist(u, v, ax, ay, bx, by)
        inside = max(inside, smoothstep(th + 0.012, th - 0.006, sd))
    if inside > 0:
        col = mix(col, white, inside)

    return (clamp(int(col[0])), clamp(int(col[1])), clamp(int(col[2])))


def write_png(path, w, h):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r, g, b = pixel(x, y, w, h)
            raw += bytes((r, g, b))

    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data +
                struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, w, 'x', h)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, 'icons')
    os.makedirs(out, exist_ok=True)
    write_png(os.path.join(out, 'icon-512.png'), 512, 512)
    write_png(os.path.join(out, 'icon-192.png'), 192, 192)
    write_png(os.path.join(out, 'apple-touch-icon.png'), 180, 180)


if __name__ == '__main__':
    main()
