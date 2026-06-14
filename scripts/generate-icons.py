#!/usr/bin/env python3
"""Generate extension icon sizes from the main TabPack icon."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ModuleNotFoundError:
    print(
        "Pillow is required to generate icons.\n"
        "Install it with: python3 -m pip install Pillow",
        file=sys.stderr,
    )
    raise SystemExit(1)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "extension" / "assets" / "icons" / "iconMain.png"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "extension" / "assets" / "icons"
ICON_SIZES = (16, 32, 48, 128)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate icon16.png, icon32.png, icon48.png, and icon128.png from iconMain.png.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Source icon image. Default: {DEFAULT_SOURCE.relative_to(REPO_ROOT)}",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory. Default: {DEFAULT_OUTPUT_DIR.relative_to(REPO_ROOT)}",
    )
    parser.add_argument(
        "--no-sharpen",
        action="store_true",
        help="Disable the subtle sharpening pass used for small icon sizes.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_path = args.source.resolve()
    output_dir = args.output_dir.resolve()

    if not source_path.is_file():
        print(f"Source icon not found: {source_path}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(source_path) as source:
        base_icon = make_square_canvas(source.convert("RGBA"))

        for size in ICON_SIZES:
            icon = base_icon.resize((size, size), Image.Resampling.LANCZOS)

            if not args.no_sharpen and size <= 48:
                icon = sharpen_small_icon(icon, size)

            output_path = output_dir / f"icon{size}.png"
            icon.save(output_path, format="PNG", optimize=True)
            print(f"Wrote {output_path.relative_to(REPO_ROOT)}")

    return 0


def make_square_canvas(image: Image.Image) -> Image.Image:
    """Center non-square sources on a transparent square canvas before resizing."""
    width, height = image.size
    if width == height:
        return image

    side = max(width, height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset = ((side - width) // 2, (side - height) // 2)
    canvas.alpha_composite(image, offset)
    return canvas


def sharpen_small_icon(icon: Image.Image, size: int) -> Image.Image:
    """Add a light clarity pass after downsampling so tiny toolbar icons stay readable."""
    if size <= 16:
        percent = 135
        radius = 0.45
    elif size <= 32:
        percent = 115
        radius = 0.35
    else:
        percent = 105
        radius = 0.25

    return icon.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3))


if __name__ == "__main__":
    raise SystemExit(main())
