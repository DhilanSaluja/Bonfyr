"""Rebuild black/orange App Store posters at native pixel size.

The current shots were upscaled from 473x1024 marketing PNGs, so the orange
type is mush on iPad and desktop. This draws the headlines with a real font
and drops in the higher-res app UI (Android chrome cropped, no fake iOS bar).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
EN = ROOT / "apple" / "screenshot" / "en-US"
FULLBLEED = ROOT / "apple" / "screenshot" / "_fullbleed"
READY = ROOT / "app-store-ready"
IPAD_READY = ROOT / "app-store-ipad-13"
UPLOAD = ROOT / "app-store-upload"
ANDROID = ROOT / "apple" / "screenshot" / "_rejected-android" / "APP_IPHONE_65"

FONT_TITLE = Path(r"C:\Windows\Fonts\Montserrat-Black.ttf")
FONT_KICKER = Path(r"C:\Windows\Fonts\Montserrat-Bold.ttf")

ORANGE = (242, 84, 28)
KICKER = "BONFIRE"
BG = (0, 0, 0)

ANDROID_STATUS_CROP = 96
ANDROID_NAV_CROP = 176

IPHONE_SIZES = {
    "APP_IPHONE_65": (1284, 2778),
    "APP_IPHONE_67": (1290, 2796),
    "APP_IPHONE_69": (1320, 2868),
}

IPHONE_SHOTS = [
    (
        "Bonfire-Home-Week",
        ANDROID / "Bonfire-Home-Week-1284x2778.png",
        ["Keep Friendships", "Kindling"],
        False,
    ),
    (
        "Bonfire-Home-Out",
        ANDROID / "Bonfire-Home-Out-1284x2778.png",
        ["Spark a", "Hangout"],
        False,
    ),
    (
        "Bonfire-Crew-Chat",
        ANDROID / "Bonfire-Crew-Chat-1284x2778.png",
        ["Keep Group Chats", "Alive"],
        True,
    ),
    (
        "Bonfire-Crew-Fire",
        ANDROID / "Bonfire-Crew-Fire-1284x2778.png",
        ["Keep the", "fire lit"],
        False,
    ),
]

IPAD_SIZE = (2064, 2752)
UI_IPAD = ROOT / "apple" / "screenshot" / "_ui-ipad"
IPAD_SHOTS = [
    ("01-home-2064x2752.png", ["Keep Friendships", "Kindling"]),
    ("02-crew-2064x2752.png", ["Keep the", "fire lit"]),
    ("03-start-spark-2064x2752.png", ["Spark a", "Hangout"]),
    ("04-you-2064x2752.png", ["Your crew.", "Your fire."]),
]


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    im = im.convert("RGB")
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    nw = max(tw, int(round(im.width * scale)))
    nh = max(th, int(round(im.height * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, (nh - th) // 2)
    return im.crop((left, top, left + tw, top + th))


def crop_android_chrome(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    top = min(ANDROID_STATUS_CROP, h // 8)
    bottom = max(top + 1, h - ANDROID_NAV_CROP)
    return im.crop((0, top, w, bottom))


def cover_chat_still(im: Image.Image) -> Image.Image:
    """Replace the third-party GIF still with an original gradient card."""
    im = im.convert("RGB")
    pix = im.load()
    w, h = im.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(int(h * 0.28), int(h * 0.88)):
        for x in range(int(w * 0.12), int(w * 0.92)):
            r, g, b = pix[x, y]
            if r > 190 and 40 < g < 140 and b < 90 and r > g + 50:
                xs.append(x)
                ys.append(y)
    if not xs:
        return im
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    if (x1 - x0) < w * 0.28 or (y1 - y0) < h * 0.12:
        return im
    pad = max(4, (x1 - x0) // 40)
    x0 += pad
    y0 += pad
    x1 -= pad
    y1 -= pad
    cw, ch = x1 - x0, y1 - y0
    card = Image.new("RGB", (cw, ch), (255, 236, 214))
    d = ImageDraw.Draw(card)
    for y in range(ch):
        t = y / max(ch - 1, 1)
        d.line(
            [(0, y), (cw, y)],
            fill=(int(255 - 70 * t), int(168 - 40 * t), int(96 + 20 * t)),
        )
    d.ellipse((cw * 0.18, ch * 0.12, cw * 0.62, ch * 0.42), fill=(255, 214, 140))
    d.ellipse((int(cw * 0.08), int(ch * 0.58), cw + 20, ch + 20), fill=(196, 92, 48))
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, cw - 1, ch - 1), radius=max(28, cw // 18), fill=255
    )
    im.paste(card, (x0, y0), mask)
    return im


def draw_kicker(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, cx: int, y: int) -> int:
    tracking = max(4, int(fnt.size * 0.22))
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, tw in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=ORANGE)
        x += tw + tracking
    bbox = fnt.getbbox("Ay")
    return y + (bbox[3] - bbox[1])


def draw_title(draw: ImageDraw.ImageDraw, lines: list[str], fnt: ImageFont.FreeTypeFont, cx: int, y: int) -> None:
    gap = max(2, int(fnt.size * -0.04))
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=fnt)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((cx - tw / 2 - bbox[0], y - bbox[1]), line, font=fnt, fill=ORANGE)
        y += th + gap


def fit_title_font(draw: ImageDraw.ImageDraw, lines: list[str], max_w: int, start: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > 28:
        fnt = font(FONT_TITLE, size)
        if all(draw.textlength(line, font=fnt) <= max_w for line in lines):
            return fnt
        size -= 2
    return font(FONT_TITLE, 28)


def compose(ui: Image.Image, size: tuple[int, int], lines: list[str], *, tablet: bool = False) -> Image.Image:
    tw, th = size
    canvas = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(canvas)

    side = int(tw * (0.07 if tablet else 0.108))
    top = int(th * (0.20 if tablet else 0.188))
    bot = int(th * (0.035 if tablet else 0.028))
    x0, y0, x1, y1 = side, top, tw - side, th - bot
    radius = max(36, int((x1 - x0) * (0.055 if tablet else 0.072)))

    ui = cover(ui, (x1 - x0, y1 - y0))
    mask = Image.new("L", ui.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, ui.width - 1, ui.height - 1), radius=radius, fill=255
    )
    canvas.paste(ui, (x0, y0), mask)

    kicker_size = max(18, int(tw * (0.022 if tablet else 0.026)))
    kicker_font = font(FONT_KICKER, kicker_size)
    title_max = int(tw * 0.88)
    title_font = fit_title_font(draw, lines, title_max, max(44, int(tw * (0.055 if tablet else 0.078))))

    kicker_y = int(th * 0.046)
    kicker_bottom = draw_kicker(draw, KICKER, kicker_font, tw // 2, kicker_y)
    title_y = kicker_bottom + max(10, int(th * 0.012))
    # Keep the headline in the black band above the device.
    band_bottom = y0 - int(th * 0.018)
    title_bbox = draw.textbbox((0, 0), "Ay", font=title_font)
    line_h = title_bbox[3] - title_bbox[1]
    needed = line_h * len(lines) + max(2, int(title_font.size * -0.04)) * (len(lines) - 1)
    if title_y + needed > band_bottom:
        title_y = max(kicker_bottom + 8, band_bottom - needed)
    draw_title(draw, lines, title_font, tw // 2, title_y)
    return canvas


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {im.size}")


def main() -> None:
    for stem, src, lines, is_chat in IPHONE_SHOTS:
        if not src.exists():
            raise SystemExit(f"missing {src}")
        ui = crop_android_chrome(Image.open(src))
        if is_chat:
            ui = cover_chat_still(ui)
        for folder, size in IPHONE_SIZES.items():
            name = f"{stem}-{size[0]}x{size[1]}.png"
            out = compose(ui, size, lines)
            dests = [
                EN / folder / name,
                READY / name,
                UPLOAD / folder / name,
                FULLBLEED / folder / name,
            ]
            for dest in dests:
                save(out, dest)

    print("iPad screens stay full-bleed (not the blurry black posters).")


if __name__ == "__main__":
    main()
