"""
Build App Store screenshots that fill the entire frame with app UI only.

Apple 2.3.10 rejects non-iOS status bars. The previous pass drew fake chrome
and put the UI in a marketing frame — reviewers still saw Android-style icons.
This pass:
  - crops Android status / nav (iPhone) and empty margins / fake clock (iPad)
  - scales the app UI to COVER the exact App Store pixel size
  - draws no status bar, no device frame, no caption poster
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BACKUP = ROOT / "apple" / "screenshot" / "_rejected-android"

IPHONE_SRC = BACKUP / "APP_IPHONE_65"
IPAD_SRC = BACKUP / "app-store-ipad-13"

OUT_65 = ROOT / "apple" / "screenshot" / "en-US" / "APP_IPHONE_65"
OUT_67 = ROOT / "apple" / "screenshot" / "en-US" / "APP_IPHONE_67"
OUT_69 = ROOT / "apple" / "screenshot" / "en-US" / "APP_IPHONE_69"
OUT_IPAD = ROOT / "apple" / "screenshot" / "en-US" / "APP_IPAD_PRO_3GEN_129"
READY = ROOT / "app-store-ready"
IPAD_READY = ROOT / "app-store-ipad-13"

# Measured on the rejected Android captures (status icons ~y=45–84, 3-button nav ~170px).
ANDROID_STATUS_CROP = 96
ANDROID_NAV_CROP = 176

SIZE_65 = (1284, 2778)
SIZE_67 = (1290, 2796)
SIZE_69 = (1320, 2868)
SIZE_IPAD = (2064, 2752)

IPHONE_SHOTS = [
    "Bonfire-Home-Week-1284x2778.png",
    "Bonfire-Home-Out-1284x2778.png",
    "Bonfire-Crew-Chat-1284x2778.png",
    "Bonfire-SignIn-1284x2778.png",
    "Bonfire-Crew-Fire-1284x2778.png",
]
IPAD_SHOTS = [
    "01-home-2064x2752.png",
    "03-start-spark-2064x2752.png",
    "02-crew-2064x2752.png",
    "04-you-2064x2752.png",
]


def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scale to fill `size` without letterboxing (center-crop overflow)."""
    im = im.convert("RGB")
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    nw, nh = max(tw, int(round(im.width * scale))), max(th, int(round(im.height * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, (nh - th) // 2)
    return im.crop((left, top, left + tw, top + th))


def crop_android_chrome(im: Image.Image) -> Image.Image:
    w, h = im.size
    top = min(ANDROID_STATUS_CROP, h // 8)
    bottom = max(top + 1, h - ANDROID_NAV_CROP)
    return im.crop((0, top, w, bottom))


# Fake centered 9:41 sits ~y=20; desktop window-resize hook is in the last ~48px.
IPAD_TOP_CROP = 72
IPAD_BOTTOM_CROP = 52


def iosify_iphone(src: Image.Image, size: tuple[int, int]) -> Image.Image:
    return cover(crop_android_chrome(src), size)


def iosify_ipad(src: Image.Image, size: tuple[int, int]) -> Image.Image:
    src = src.convert("RGB")
    w, h = src.size
    cropped = src.crop((0, IPAD_TOP_CROP, w, h - IPAD_BOTTOM_CROP))
    return cover(cropped, size)


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)}  {im.size}")


def main() -> None:
    for src_name in IPHONE_SHOTS:
        src_path = IPHONE_SRC / src_name
        if not src_path.exists():
            raise SystemExit(f"missing iPhone source {src_path}")
        print(src_name)
        raw = Image.open(src_path)
        im65 = iosify_iphone(raw, SIZE_65)
        im67 = iosify_iphone(raw, SIZE_67)
        im69 = iosify_iphone(raw, SIZE_69)

        save(im65, OUT_65 / src_name)
        name67 = src_name.replace("1284x2778", "1290x2796")
        name69 = src_name.replace("1284x2778", "1320x2868")
        save(im67, OUT_67 / name67)
        save(im69, OUT_69 / name69)
        save(im65, READY / src_name)
        save(im67, READY / name67)
        save(im69, READY / name69)

    for src_name in IPAD_SHOTS:
        src_path = IPAD_SRC / src_name
        if not src_path.exists():
            raise SystemExit(f"missing iPad source {src_path}")
        print(src_name)
        raw = Image.open(src_path)
        im = iosify_ipad(raw, SIZE_IPAD)
        save(im, OUT_IPAD / src_name)
        save(im, IPAD_READY / src_name)


if __name__ == "__main__":
    main()
