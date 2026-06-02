#!/usr/bin/env python3
"""Génère le visuel de signature e-mail AutoCache Pro (PNG transparent)."""
from PIL import Image, ImageDraw, ImageFont

S = 3  # supersampling pour un rendu net
W, H = 760 * S, 200 * S

ORANGE = (242, 101, 34, 255)
DARK   = (28, 28, 28, 255)
INK    = (34, 34, 34, 255)
GREY   = (120, 120, 120, 255)
INNER  = (15, 15, 15, 255)

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO   = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

def f(path, size):
    return ImageFont.truetype(path, size * S)

# ── Logo hexagonal (repris du SVG de l'app) ───────────────────────────────
def hexagon(cx, cy, r):
    # mêmes proportions que le viewBox 22 du site : sommets haut/bas, côtés verticaux
    pts22 = [(11, 1), (21, 6), (21, 16), (11, 21), (1, 16), (1, 6)]
    return [(cx + (x - 11) / 10 * r, cy + (y - 11) / 10 * r) for (x, y) in pts22]

hx, hy, hr = 64 * S, H // 2, 52 * S
d.polygon(hexagon(hx, hy, hr), fill=ORANGE)
d.polygon(hexagon(hx, hy, hr * 0.55), fill=INNER)

# ── Bloc marque ───────────────────────────────────────────────────────────
bx = 132 * S
brand_f = f(SANS_B, 33)
d.text((bx, 56 * S), "AUTOCACHE", font=brand_f, fill=DARK)
bw = d.textlength("AUTOCACHE", font=brand_f)

# Chip "PRO"
chip_f = f(MONO_B, 14)
ctxt = "PRO"
cw = d.textlength(ctxt, font=chip_f)
pad = 7 * S
cx0 = bx + bw + 12 * S
cy0 = 60 * S
d.rounded_rectangle(
    [cx0, cy0, cx0 + cw + pad * 2, cy0 + 26 * S],
    radius=4 * S, fill=ORANGE,
)
d.text((cx0 + pad, cy0 + 5 * S), ctxt, font=chip_f, fill=(255, 255, 255, 255))

# Tagline
tag_f = f(MONO, 13)
d.text((bx + 2 * S, 100 * S), "CACHE PLAQUE AUTOMATIQUE", font=tag_f,
       fill=GREY, spacing=0)

# ── Séparateur vertical orange ─────────────────────────────────────────────
sep_x = 430 * S
d.rectangle([sep_x, 52 * S, sep_x + 3 * S, 148 * S], fill=ORANGE)

# ── Coordonnées (e-mail + téléphone) ───────────────────────────────────────
cx = sep_x + 26 * S
info_f = f(MONO, 15)
label_f = f(MONO_B, 15)

def icon_mail(x, y, s):
    d.rounded_rectangle([x, y, x + s, y + s * 0.72], radius=2 * S,
                        outline=ORANGE, width=2 * S)
    d.line([x, y, x + s / 2, y + s * 0.42], fill=ORANGE, width=2 * S)
    d.line([x + s, y, x + s / 2, y + s * 0.42], fill=ORANGE, width=2 * S)

def icon_phone(x, y, s):
    d.rounded_rectangle([x + s * 0.22, y, x + s * 0.78, y + s], radius=3 * S,
                        outline=ORANGE, width=2 * S)
    d.line([x + s * 0.4, y + s * 0.85, x + s * 0.6, y + s * 0.85],
           fill=ORANGE, width=2 * S)

iy1 = 68 * S
icon_mail(cx, iy1 + 2 * S, 20 * S)
d.text((cx + 34 * S, iy1), "contact.asgs29200@gmail.com", font=info_f, fill=INK)

iy2 = 104 * S
icon_phone(cx, iy2, 20 * S)
d.text((cx + 34 * S, iy2), "07 56 98 17 29", font=info_f, fill=INK)

# ── Export (downscale = anti-aliasing) ─────────────────────────────────────
out = img.resize((W // S, H // S), Image.LANCZOS)
out.save("/home/user/autocache/signature_autocache.png")
print("OK", out.size)
