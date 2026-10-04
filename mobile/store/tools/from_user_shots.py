"""Turn the user's new Android captures into App Store screenshots.

Crops system chrome only. Does not draw a fake iOS status bar.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(
    r"C:\Users\dhila\.cursor\projects\c-Users-dhila-Projects-porch-light-mobile\assets"
)

SRC = {
    "chat": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-ecf7bfd0-f61b-41d9-9c83-f9f3cfe8bf1b.webp",
    "fire": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-c6c9a0fc-7dae-4be9-9737-f8f8133684a5.webp",
    "home_week": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-22922e9a-430b-4a19-98d0-0da3bda9ed86.webp",
    "home_out": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-3b1babfc-68d3-401a-a72a-4ae3bddee67b.webp",
}

SIZES = {
    "APP_IPHONE_65": (1284, 2778),
    "APP_IPHONE_67": (1290, 2796),
    "APP_IPHONE_69": (1320, 2868),
    "APP_IPAD_PRO_3GEN_129": (2064, 2752),
}

IPHONE_NAMES = {
    "home_week": {
        "APP_IPHONE_65": "Bonfire-Home-Week-1284x2778.png",
        "APP_IPHONE_67": "Bonfire-Home-Week-1290x2796.png",
        "APP_IPHONE_69": "Bonfire-Home-Week-1320x2868.png",
    },
    "home_out": {
        "APP_IPHONE_65": "Bonfire-Home-Out-1284x2778.png",
        "APP_IPHONE_67": "Bonfire-Home-Out-1290x2796.png",
        "APP_IPHONE_69": "Bonfire-Home-Out-1320x2868.png",
    },
    "chat": {
        "APP_IPHONE_65": "Bonfire-Crew-Chat-1284x2778.png",
        "APP_IPHONE_67": "Bonfire-Crew-Chat-1290x2796.png",
        "APP_IPHONE_69": "Bonfire-Crew-Chat-1320x2868.png",
    },
    "fire": {
        "APP_IPHONE_65": "Bonfire-Crew-Fire-1284x2778.png",
        "APP_IPHONE_67": "Bonfire-Crew-Fire-1290x2796.png",
        "APP_IPHONE_69": "Bonfire-Crew-Fire-1320x2868.png",
    },
}

IPAD_SRC = [
    (
        "01-home-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-9159a047-cf7b-4e3a-bcbf-57140ff9f419.png",
        False,
    ),
    (
        "02-crew-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-f6bb501b-6b01-45b0-8581-ca71f30e0ff2.webp",
        False,
    ),
    (
        "03-start-spark-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-51e2085e-e590-4d36-8513-905ff2b9c10a.webp",
        False,
    ),
    (
        "04-you-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-2a4408fd-563c-4257-b876-7935c78fe604.webp",
        True,
    ),
]

FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
IPAD_STALE = (
    "04-home-out-2064x2752.png",
    "03-crew-chat-2064x2752.png",
)

EN = ROOT / "apple" / "screenshot" / "en-US"
FULLBLEED = ROOT / "apple" / "screenshot" / "_fullbleed"
READY = ROOT / "app-store-ready"
IPAD_READY = ROOT / "app-store-ipad-13"
UPLOAD = ROOT / "app-store-upload"


def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scale uniformly to Apple's size. Never stretch — that smushes circles."""
    im = im.convert("RGB")
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    nw = max(tw, int(round(im.width * scale)))
    nh = max(th, int(round(im.height * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, (nh - th) // 2)
    return im.crop((left, top, left + tw, top + th))


def contain(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scale uniformly and pad. Used when the source aspect does not match Apple's."""
    im = im.convert("RGB")
    tw, th = size
    bg = im.getpixel((2, 2))
    canvas = Image.new("RGB", size, bg)
    scale = min(tw / im.width, th / im.height)
    nw = max(1, int(round(im.width * scale)))
    nh = max(1, int(round(im.height * scale)))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def hide_pro_price(im: Image.Image) -> Image.Image:
    """Cover the whole Pro banner so no $1.99/$17.99 remains (2.3.7)."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    pix = rgb.load()
    rows: list[tuple[int, int, int]] = []
    for y in range(int(h * 0.16), int(h * 0.80)):
        orange = 0
        xs: list[int] = []
        for x in range(int(w * 0.02), int(w * 0.98)):
            r, g, b = pix[x, y]
            if r > 170 and g < 150 and b < 110 and r > g + 30:
                orange += 1
                xs.append(x)
        if orange > w * 0.22 and xs:
            rows.append((y, min(xs), max(xs)))
    if not rows:
        return rgb
    y0 = rows[0][0]
    y1 = rows[-1][0]
    x0 = min(r[1] for r in rows)
    x1 = max(r[2] for r in rows)
    if y1 - y0 < 20:
        return rgb
    draw = ImageDraw.Draw(rgb)
    sample = pix[(x0 + x1) // 2, (y0 + y1) // 2]
    draw.rounded_rectangle((x0, y0, x1, y1), radius=max(22, (y1 - y0) // 5), fill=sample)
    title = "Go Pro"
    sub = "Unlimited Crews · schedule Sparks · Pro badge"
    title_font = ImageFont.truetype(str(FONT_BOLD), max(32, (y1 - y0) // 4))
    sub_font = ImageFont.truetype(str(FONT_BOLD), max(18, (y1 - y0) // 7))
    tb = draw.textbbox((0, 0), title, font=title_font)
    sb = draw.textbbox((0, 0), sub, font=sub_font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]
    gap = max(8, (y1 - y0) // 16)
    block = th + gap + sh
    ty = (y0 + y1 - block) // 2
    cx = (x0 + x1) // 2
    draw.text((cx - tw // 2, ty), title, font=title_font, fill=(255, 252, 247))
    draw.text((cx - sw // 2, ty + th + gap), sub, font=sub_font, fill=(255, 236, 220))
    return rgb


def hide_system_chrome(im: Image.Image) -> Image.Image:
    """Paint over Android time / wifi / battery and the 3-button nav.

    Keeps the original framing so the app UI is not cropped or stretched.
    """
    im = im.convert("RGB")
    w, h = im.size
    pix = im.load()
    top_h = max(40, int(round(h * 0.055)))
    bot_h = max(48, int(round(h * 0.064)))
    top_color = pix[2, 2]
    bot_color = pix[w // 2, max(0, h - bot_h - 3)]
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w - 1, top_h), fill=top_color)
    d.rectangle((0, h - bot_h, w - 1, h - 1), fill=bot_color)
    return im


def original_still(w: int, h: int) -> Image.Image:
    card = Image.new("RGB", (w, h), (255, 236, 214))
    d = ImageDraw.Draw(card)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=(int(255 - 70 * t), int(168 - 40 * t), int(96 + 20 * t)))
    d.ellipse((w * 0.18, h * 0.12, w * 0.62, h * 0.42), fill=(255, 214, 140))
    d.ellipse((int(w * 0.08), int(h * 0.58), w + 20, h + 20), fill=(196, 92, 48))
    return card


def cover_chat_meme(im: Image.Image) -> Image.Image:
    """Replace the copyrighted thumbs-up still with an original graphic."""
    im = im.convert("RGB")
    w, h = im.size
    x0, y0, x1, y1 = int(w * 0.30), int(h * 0.34), int(w * 0.97), int(h * 0.82)
    card = original_still(max(8, x1 - x0), max(8, y1 - y0))
    mask = Image.new("L", card.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, card.size[0] - 1, card.size[1] - 1),
        radius=max(16, card.size[0] // 16),
        fill=255,
    )
    im.paste(card, (x0, y0), mask)
    return im


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {im.size}")


def main() -> None:
    if FULLBLEED.exists():
        shutil.rmtree(FULLBLEED)
    for leftover in READY.glob("Bonfire-SignIn-*.png"):
        leftover.unlink()
    ipad_folder = "APP_IPAD_PRO_3GEN_129"
    for stale in IPAD_STALE:
        for dest in (
            EN / ipad_folder / stale,
            IPAD_READY / stale,
            UPLOAD / ipad_folder / stale,
            FULLBLEED / ipad_folder / stale,
        ):
            if dest.exists():
                dest.unlink()

    for key, src in SRC.items():
        if not src.exists():
            raise SystemExit(f"missing {src}")
        raw = hide_system_chrome(Image.open(src))
        for folder, size in SIZES.items():
            if folder.startswith("APP_IPAD"):
                continue
            name = IPHONE_NAMES[key][folder]
            out = cover(raw, size)
            dests = [
                EN / folder / name,
                READY / name,
                UPLOAD / folder / name,
                FULLBLEED / folder / name,
            ]
            for dest in dests:
                save(out, dest)

    ipad_size = SIZES[ipad_folder]
    for name, src, redact in IPAD_SRC:
        if not src.exists():
            raise SystemExit(f"missing {src}")
        out = contain(Image.open(src).convert("RGB"), ipad_size)
        if redact:
            out = hide_pro_price(out)
        dests = [
            EN / ipad_folder / name,
            IPAD_READY / name,
            UPLOAD / ipad_folder / name,
            FULLBLEED / ipad_folder / name,
        ]
        for dest in dests:
            save(out, dest)


if __name__ == "__main__":
    main()
