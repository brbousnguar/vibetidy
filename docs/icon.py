import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Palette - terminal ink + amber
BG_TOP  = (30, 36, 48)     # #1E2430 deep slate ink
BG_BOT  = (22, 27, 37)     # slightly deeper for diagonal depth
AMBER   = (232, 163, 61)   # #E8A33D aligned bars
DIM     = (90, 102, 120)   # #5A6678 ragged bars
TEXT    = (238, 240, 244)
TEXTDIM = (138, 150, 168)

FONT_CANDIDATES = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]
FONT_PATH = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None)


def _vignette(S, strength=70):
    v = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(v)
    steps = 14
    for i in range(steps, 0, -1):
        t = i / steps
        alpha = int(strength * (1 - t) ** 2.6)
        margin = int(S * (1 - t) * 0.48)
        d.ellipse([margin, margin, S - margin, S - margin], fill=(6, 9, 14, alpha))
    return v


def _bar_layer(S, l, r, y0, bar_h, color, tilt=0.0):
    """One bar on its own layer so it can be tilted about its centre."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [S * l, y0, S * r, y0 + bar_h], bar_h / 2, fill=(*color, 255))
    if tilt:
        layer = layer.rotate(tilt, resample=Image.BICUBIC, center=(S * (l + r) / 2, y0 + bar_h / 2))
    return layer


def _bars(S):
    """Two skewed bars settling into two flush ones: messy repo -> tidy repo.

    The tilt is what carries the idea. Without it the bars read as a menu icon.
    """
    bar_h = S * 0.088
    gap   = S * 0.062
    total = 4 * bar_h + 3 * gap
    top   = (S - total) / 2

    spec = [
        # l,     r,     color, tilt
        (0.250, 0.735, DIM,   -5.0),
        (0.190, 0.640, DIM,    3.4),
        (0.215, 0.785, AMBER,  0.0),
        (0.215, 0.785, AMBER,  0.0),
    ]
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for i, (l, r, color, tilt) in enumerate(spec):
        y0 = top + i * (bar_h + gap)
        out = Image.alpha_composite(out, _bar_layer(S, l, r, y0, bar_h, color, tilt))
    return out


def render(size: int) -> Image.Image:
    S = 1024
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # diagonal gradient ground (top-left lighter -> bottom-right deeper)
    for y in range(S):
        t = max(0.0, min(1.0, (y * 0.62 + (S * 0.38)) / S))
        c = tuple(int(BG_TOP[i] + t * (BG_BOT[i] - BG_TOP[i])) for i in range(3))
        draw.line([(0, y), (S, y)], fill=(*c, 255))

    img = Image.alpha_composite(img, _vignette(S))

    # soft amber glow under the aligned pair, for depth
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S * 0.16, S * 0.52, S * 0.84, S * 0.80], fill=(232, 163, 61, 30))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.055))
    img = Image.alpha_composite(img, glow)

    img = Image.alpha_composite(img, _bars(S))

    return img.resize((size, size), Image.LANCZOS)


def squircle_clip(icon, radius_pct=0.225):
    S = icon.size[0]
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], int(S * radius_pct), fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(icon, mask=mask)
    return out


if __name__ == "__main__":
    OUT = "/private/tmp/claude-501/-Users-boss-Server/b965bffb-56ae-4cc9-a1b9-b5b0222ce6c8/scratchpad"
    hi = render(1024)

    # contact sheet: dark chrome, light chrome, and small sizes
    sheet = Image.new("RGB", (1180, 620), (28, 28, 32))
    d = ImageDraw.Draw(sheet)
    d.rectangle([590, 0, 1180, 620], fill=(250, 250, 250))
    sq = squircle_clip(hi)
    for x0 in (40, 630):
        big = sq.resize((360, 360), Image.LANCZOS)
        sheet.paste(big, (x0, 40), big)
    # small sizes on both grounds
    for i, px in enumerate((72, 48, 32, 24)):
        s = squircle_clip(render(px))
        sheet.paste(s, (40 + i * 90, 450), s)
        sheet.paste(s, (630 + i * 90, 450), s)
    sheet.save(f"{OUT}/contact_sheet.png")
    print("wrote contact_sheet.png")
