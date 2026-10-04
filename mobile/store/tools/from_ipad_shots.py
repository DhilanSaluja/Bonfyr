"""Make iPad captures Apple-safe at 2064x2752.

Removes only native chrome (TestFlight / time / wifi / battery / home bar).
Keeps the full app header. Does not stretch or crop the top off.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from from_user_shots import (
    EN,
    FULLBLEED,
    IPAD_READY,
    UPLOAD,
    contain,
    hide_pro_price,
)

ASSETS = Path(
    r"C:\Users\dhila\.cursor\projects\c-Users-dhila-Projects-porch-light-mobile\assets"
)

IPAD_SIZE = (2064, 2752)
FOLDER = "APP_IPAD_PRO_3GEN_129"

SRC = [
    (
        "01-home-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-9ddf0228-427d-4d64-84ee-db3f4357ea4a.webp",
        False,
    ),
    (
        "02-crew-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-b208366e-c0e0-47cf-9a42-5875971e0097.webp",
        False,
    ),
    (
        "03-start-spark-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-cf91aeca-5f0e-4789-abb6-d2140e02dbe4.webp",
        False,
    ),
    (
        "04-you-2064x2752.png",
        ASSETS
        / "c__Users_dhila_AppData_Roaming_Cursor_User_workspaceStorage_9f665280b56ac76da312df3a7bc50212_images_unnamed-a3ef5470-b83a-446e-aee8-70b5e59669c7.webp",
        True,
    ),
]


def cream_at(pix, w: int, h: int) -> tuple[int, int, int]:
    return pix[min(w - 1, 24), min(h - 1, h // 3)]


def first_app_row(im: Image.Image) -> int:
    """Row where the cream app UI starts under a dark TestFlight bar, if any."""
    pix = im.load()
    w, h = im.size
    for y in range(min(48, h)):
        r, g, b = pix[w // 2, y]
        if r > 220 and g > 210 and b > 190:
            return y
    return 0


def hide_native_chrome(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    pix = im.load()
    app_y = first_app_row(im)
    bg = pix[24, min(h - 1, app_y + 8)] if app_y else pix[24, 2]

    # Dark iPad status bar (Spark) or cream bar with TestFlight / 9:41 / wifi.
    top_end = max(app_y, int(round(h * 0.022)), 20)
    # Stay above the Bonfyr / You / back-button header (~y=32+).
    top_end = min(top_end, 28) if app_y == 0 else min(app_y, 34)
    for y in range(0, top_end):
        for x in range(w):
            pix[x, y] = bg

    # Home indicator only — last sliver. Do not eat the cover photo or map.
    bot_bg = pix[w // 2, h - 18]
    for y in range(h - 14, h):
        for x in range(w):
            r, g, b = pix[x, y]
            if r + g + b < 360:
                pix[x, y] = bot_bg
    return im


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    im.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(root)}  {im.size}")


def main() -> None:
    for name, src, redact in SRC:
        if not src.exists():
            raise SystemExit(f"missing {src}")
        out = hide_native_chrome(Image.open(src))
        out = contain(out, IPAD_SIZE)
        if redact:
            out = hide_pro_price(out)
        dests = [
            EN / FOLDER / name,
            IPAD_READY / name,
            UPLOAD / FOLDER / name,
            FULLBLEED / FOLDER / name,
        ]
        for dest in dests:
            save(out, dest)


if __name__ == "__main__":
    main()
