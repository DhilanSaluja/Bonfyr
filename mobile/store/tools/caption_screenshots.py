"""
Put short promo copy ON full-bleed App Store screenshots.

Keeps the app UI filling the exact Apple size. No device frame, no status bar,
no letterboxed poster — those already failed 2.3.10.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
EN = ROOT / "apple" / "screenshot" / "en-US"
SOURCE = ROOT / "apple" / "screenshot" / "_fullbleed"
READY = ROOT / "app-store-ready"
IPAD_READY = ROOT / "app-store-ipad-13"
UPLOAD = ROOT / "app-store-upload"

FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")

IPHONE = {
    "APP_IPHONE_65": [
        ("Bonfire-Home-Week-1284x2778.png", "Keep your crew together", ""),
        ("Bonfire-Home-Out-1284x2778.png", "When the fire goes out, you feel it", ""),
        ("Bonfire-Crew-Chat-1284x2778.png", "Photos and chat that fade", ""),
        ("Bonfire-Crew-Fire-1284x2778.png", "One crew. One fire.", ""),
    ],
    "APP_IPHONE_67": [
        ("Bonfire-Home-Week-1290x2796.png", "Keep your crew together", ""),
        ("Bonfire-Home-Out-1290x2796.png", "When the fire goes out, you feel it", ""),
        ("Bonfire-Crew-Chat-1290x2796.png", "Photos and chat that fade", ""),
        ("Bonfire-Crew-Fire-1290x2796.png", "One crew. One fire.", ""),
    ],
    "APP_IPHONE_69": [
        ("Bonfire-Home-Week-1320x2868.png", "Keep your crew together", ""),
        ("Bonfire-Home-Out-1320x2868.png", "When the fire goes out, you feel it", ""),
        ("Bonfire-Crew-Chat-1320x2868.png", "Photos and chat that fade", ""),
        ("Bonfire-Crew-Fire-1320x2868.png", "One crew. One fire.", ""),
    ],
}

IPAD = [
    ("01-home-2064x2752.png", "Keep your crew together", ""),
    ("02-crew-2064x2752.png", "One crew. One fire.", ""),
    ("03-start-spark-2064x2752.png", "Start a Spark", ""),
    ("04-you-2064x2752.png", "Your account", ""),
]


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = word if not cur else f"{cur} {word}"
        if draw.textlength(trial, font=fnt) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [text]


def line_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def draw_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    fnt: ImageFont.FreeTypeFont,
    cx: int,
    y: int,
    fill: tuple[int, int, int],
    gap: int,
    *,
    stroke_width: int = 0,
    stroke_fill: tuple[int, int, int] = (255, 255, 255),
) -> int:
    for line in lines:
        tw, th = line_size(draw, line, fnt)
        x = int(cx - tw / 2)
        draw.text(
            (x, y),
            line,
            font=fnt,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        y += th + gap
    return y


def caption(im: Image.Image, title: str, subtitle: str) -> Image.Image:
    """Big centered type. No box — just the words."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    d = ImageDraw.Draw(rgb)

    max_w = int(w * 0.88)
    title_size = max(36, int(w * 0.058))
    sub_size = max(18, int(w * 0.028))
    if w > 1600:
        title_size = max(44, int(w * 0.042))
        sub_size = max(22, int(w * 0.018))

    title_font = font(FONT_BOLD, title_size)
    sub_font = font(FONT_REG, sub_size)
    title_lines = wrap(d, title, title_font, max_w)
    sub_lines = wrap(d, subtitle, sub_font, max_w) if subtitle.strip() else []
    title_gap = max(4, int(title_size * 0.12))
    sub_gap = max(3, int(sub_size * 0.12))
    stroke = max(3, int(title_size * 0.08))

    text_h = 0
    for line in title_lines:
        _tw, th = line_size(d, line, title_font)
        text_h += th + title_gap
    text_h -= title_gap
    for i, line in enumerate(sub_lines):
        _tw, th = line_size(d, line, sub_font)
        text_h += th + (sub_gap if i else int(h * 0.01))

    y = (h - text_h) // 2
    y = draw_lines(
        d,
        title_lines,
        title_font,
        w // 2,
        y,
        (26, 16, 12),
        title_gap,
        stroke_width=stroke,
        stroke_fill=(255, 255, 255),
    )
    if sub_lines:
        y += int(h * 0.01)
        draw_lines(
            d,
            sub_lines,
            sub_font,
            w // 2,
            y,
            (179, 61, 22),
            sub_gap,
            stroke_width=max(2, stroke - 1),
            stroke_fill=(255, 255, 255),
        )
    return rgb


def hide_pro_price(im: Image.Image) -> Image.Image:
    """Cover '$1.99/mo or $17.99/yr' on the You screen. Prices in shots fail 2.3.7."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    pix = rgb.load()
    rows: list[tuple[int, int, int]] = []
    for y in range(int(h * 0.28), int(h * 0.62)):
        orange = 0
        xs: list[int] = []
        for x in range(int(w * 0.08), int(w * 0.92)):
            r, g, b = pix[x, y]
            if r > 170 and g < 140 and b < 100 and r > g + 40:
                orange += 1
                xs.append(x)
        if orange > w * 0.45 and xs:
            rows.append((y, min(xs), max(xs)))
    if not rows:
        return rgb
    y0 = rows[0][0]
    y1 = rows[-1][0]
    x0 = min(r[1] for r in rows)
    x1 = max(r[2] for r in rows)
    if y1 - y0 < 40:
        return rgb
    draw = ImageDraw.Draw(rgb)
    sample = pix[(x0 + x1) // 2, (y0 + y1) // 2]
    draw.rounded_rectangle((x0, y0, x1, y1), radius=max(18, (y1 - y0) // 4), fill=sample)
    label = "Go Pro"
    fnt = font(FONT_BOLD, max(28, (y1 - y0) // 3))
    bbox = draw.textbbox((0, 0), label, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((x0 + x1 - tw) // 2, (y0 + y1 - th) // 2 - 2), label, font=fnt, fill=(255, 252, 247))
    return rgb


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {im.size} {im.mode}")


def process(src: Path, dests: list[Path], title: str, subtitle: str, *, redact_price: bool = False) -> None:
    im = Image.open(src)
    if redact_price:
        im = hide_pro_price(im)
    im = im.convert("RGB")
    assert im.mode == "RGB"
    for dest in dests:
        save(im, dest)


def snapshot_sources() -> None:
    """Keep an uncaptioned copy so this script can be re-run safely."""
    folders = list(IPHONE.keys()) + ["APP_IPAD_PRO_3GEN_129"]
    for folder in folders:
        dest = SOURCE / folder
        dest.mkdir(parents=True, exist_ok=True)
        for src in (EN / folder).glob("*.png"):
            if src.name.startswith("Bonfyr-SignIn"):
                continue
            target = dest / src.name
            if not target.exists():
                Image.open(src).convert("RGB").save(target, "PNG")


def main() -> None:
    snapshot_sources()
    for folder, shots in IPHONE.items():
        src_dir = SOURCE / folder
        upload_dir = UPLOAD / folder
        for name, title, subtitle in shots:
            src = src_dir / name
            if not src.exists():
                raise SystemExit(f"missing {src}")
            dests = [EN / folder / name, READY / name, upload_dir / name]
            process(src, dests, title, subtitle)

    for name, title, subtitle in IPAD:
        src = SOURCE / "APP_IPAD_PRO_3GEN_129" / name
        if not src.exists():
            raise SystemExit(f"missing {src}")
        dests = [
            EN / "APP_IPAD_PRO_3GEN_129" / name,
            IPAD_READY / name,
            UPLOAD / "APP_IPAD_PRO_3GEN_129" / name,
        ]
        process(src, dests, title, subtitle, redact_price=name.startswith("04-you"))

    # Never ship the login shot.
    for leftover in READY.glob("Bonfire-SignIn-*.png"):
        leftover.unlink()
        print(f"removed {leftover.name}")


if __name__ == "__main__":
    main()
