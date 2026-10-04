"""Replace the copyrighted GIF in crew-chat screenshots with a simple original still."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "apple" / "screenshot" / "en-US" / "APP_IPHONE_65" / "Bonfire-Crew-Chat-1284x2778.png",
    ROOT / "apple" / "screenshot" / "en-US" / "APP_IPHONE_67" / "Bonfire-Crew-Chat-1290x2796.png",
    ROOT / "apple" / "screenshot" / "en-US" / "APP_IPHONE_69" / "Bonfire-Crew-Chat-1320x2868.png",
    ROOT / "app-store-ready" / "Bonfire-Crew-Chat-1284x2778.png",
    ROOT / "app-store-ready" / "Bonfire-Crew-Chat-1290x2796.png",
    ROOT / "app-store-ready" / "Bonfire-Crew-Chat-1320x2868.png",
]

# Measured on the 1320x2868 shot.
REF = (1320, 2868)
BOX = (410, 1668, 1220, 2448)


def cover(path: Path) -> None:
    if not path.exists():
        return
    im = Image.open(path).convert("RGB")
    sx = im.width / REF[0]
    sy = im.height / REF[1]
    x0, y0, x1, y1 = (int(BOX[0] * sx), int(BOX[1] * sy), int(BOX[2] * sx), int(BOX[3] * sy))
    pad = 6
    x0 += pad
    y0 += pad
    x1 -= pad
    y1 -= pad
    w, h = x1 - x0, y1 - y0
    card = Image.new("RGB", (w, h), (255, 236, 214))
    d = ImageDraw.Draw(card)
    # Original, rights-clear photo-like gradient (not a third-party still).
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(255 - 70 * t)
        g = int(168 - 40 * t)
        b = int(96 + 20 * t)
        d.line([(0, y), (w, y)], fill=(r, g, b))
    d.ellipse((w * 0.18, h * 0.12, w * 0.62, h * 0.42), fill=(255, 214, 140))
    d.ellipse((int(w * 0.08), int(h * 0.58), w + 20, h + 20), fill=(196, 92, 48))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=max(28, w // 18), fill=255)
    im.paste(card, (x0, y0), mask)
    im.save(path, "PNG", optimize=True)
    print(f"covered {path.name} {im.size} {im.mode}")


def main() -> None:
    for p in TARGETS:
        cover(p)


if __name__ == "__main__":
    main()
