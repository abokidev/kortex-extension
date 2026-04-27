#!/usr/bin/env python3
# Run this to generate PNG icons from the SVG
# Requires: pip install cairosvg
try:
    import cairosvg
    for size in [16, 48, 128]:
        cairosvg.svg2png(url="icons/icon.svg", write_to=f"icons/icon{size}.png", output_width=size, output_height=size)
        print(f"Generated icons/icon{size}.png")
    print("All icons generated successfully")
except ImportError:
    print("cairosvg not installed. Run: pip install cairosvg")
    print("Or convert icons/icon.svg manually to PNG at 16, 48, 128px")
