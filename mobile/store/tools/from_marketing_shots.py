"""Make the user's marketing iPhone posters Apple-safe.

Keeps the black poster and headlines. Paints out the fake 9:41 / wifi / battery
and the home indicator. Does not ship the Sign In shot (2.3.3).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(
    r"C:\Users\dhila\.cursor\projects\c-Users-dhila-Projects-porch-light-mobile\assets"
)

SRC = {
    "home_week": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_0x0ss-3e523b1f-51c1-4cc0-811c-a3d69f9bee62.png",
    "fire": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_0x0ss-02fde1da-a2d0-4eea-b3f7-f0f90c328d92.png",
    "home_out": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_0x0ss-acbd3bb5-7102-4161-96b3-2e90e915a2a4.png",
    "chat": ASSETS
    / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_0x0ss-03cc0c39-8656-495c-92a4-230dddecab77.png",
}

SIZES = {
    "APP_IPHONE_65": (1284, 2778),
    "APP_IPHONE_67": (1290, 2796),
    "APP_IPHONE_69": (1320, 2868),
}

NAMES = {
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

EN = ROOT / "apple" / "screenshot" / "en-US"
FULLBLEED = ROOT / "apple" / "screenshot" / "_fullbleed"
READY = ROOT / "app-store-ready"
UPLOAD = ROOT / "app-store-upload"


def is_poster_black(c: tuple[int, int, int]) -> bool:
    return c[0] < 30 and c[1] < 30 and c[2] < 30


def is_screen(c: tuple[int, int, int]) -> bool:
    r, g, b = c
    if is_poster_black(c):
        return False
    return r + g + b > 480 or (r > 180 and g > 200 and b > 200)


def screen_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    pix = im.load()
    w, h = im.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(h):
        for x in range(w):
            if is_screen(pix[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("could not find the phone screen")
    return min(xs), min(ys), max(xs), max(ys)


def hide_chrome(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    pix = im.load()
    x0, y0, x1, y1 = screen_bbox(im)
    screen_h = max(1, y1 - y0)
    top_h = max(28, int(round(screen_h * 0.048)))
    bot_h = max(12, int(round(screen_h * 0.018)))
    top_bg = pix[(x0 + x1) // 2, min(im.height - 1, y0 + top_h + 10)]
    bot_bg = pix[(x0 + x1) // 2, max(0, y1 - bot_h - 12)]

    # Time / wifi / battery are black — paint them too, not just the cream.
    for y in range(y0, min(im.height, y0 + top_h + 1)):
        for x in range(x0, x1 + 1):
            pix[x, y] = top_bg

    for y in range(max(0, y1 - bot_h), y1 + 1):
        for x in range(x0, x1 + 1):
            pix[x, y] = bot_bg
    return im


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


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {im.size}")


def main() -> None:
    for leftover in READY.glob("Bonfire-SignIn-*.png"):
        leftover.unlink()
    for folder in SIZES:
        for leftover in (EN / folder).glob("Bonfire-SignIn-*.png"):
            leftover.unlink()
        for leftover in (UPLOAD / folder).glob("Bonfire-SignIn-*.png"):
            leftover.unlink()

    for key, src in SRC.items():
        if not src.exists():
            raise SystemExit(f"missing {src}")
        raw = hide_chrome(Image.open(src))
        for folder, size in SIZES.items():
            name = NAMES[key][folder]
            out = cover(raw, size)
            dests = [
                EN / folder / name,
                READY / name,
                UPLOAD / folder / name,
                FULLBLEED / folder / name,
            ]
            for dest in dests:
                save(out, dest)


if __name__ == "__main__":
    main()
