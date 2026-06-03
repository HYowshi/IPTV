#!/usr/bin/env python3
"""
Generate all required app icons from logo.png for Tauri build.
Usage: python generate-icons.py
Requires: pip install Pillow
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image

SRC = "logo.png"
ICONS_DIR = "src-tauri/icons"

# Desktop icons (Windows/Mac/Linux)
DESKTOP_SIZES = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}

# Windows Store / UWP icons
WINDOWS_SIZES = {
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

# Android mipmap sizes
ANDROID_MIPMAPS = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# iOS icon sizes (common ones)
IOS_SIZES = {
    "AppIcon-20.png": 20,
    "AppIcon-20@2x.png": 40,
    "AppIcon-20@3x.png": 60,
    "AppIcon-29.png": 29,
    "AppIcon-29@2x.png": 58,
    "AppIcon-29@3x.png": 87,
    "AppIcon-40.png": 40,
    "AppIcon-40@2x.png": 80,
    "AppIcon-40@3x.png": 120,
    "AppIcon-60@2x.png": 120,
    "AppIcon-60@3x.png": 180,
    "AppIcon-76.png": 76,
    "AppIcon-76@2x.png": 152,
    "AppIcon-83.5@2x.png": 167,
    "AppIcon-1024.png": 1024,
}

def generate_icon(img, size, output_path):
    """Resize image to exact size with high-quality resampling."""
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(output_path, "PNG", optimize=True)
    print(f"  Generated: {output_path} ({size}x{size})")

def main():
    if not os.path.exists(SRC):
        print(f"Error: {SRC} not found!")
        sys.exit(1)

    img = Image.open(SRC).convert("RGBA")
    
    # Make square by cropping to center
    w, h = img.size
    if w != h:
        size = min(w, h)
        left = (w - size) // 2
        top = (h - size) // 2
        img = img.crop((left, top, left + size, top + size))
        print(f"Cropped to square: {img.size}")

    print(f"\n=== Generating icons from {SRC} ({img.size[0]}x{img.size[1]}) ===\n")

    # Desktop icons
    print("[Desktop Icons]")
    for name, size in DESKTOP_SIZES.items():
        generate_icon(img, size, os.path.join(ICONS_DIR, name))

    # Windows Store icons
    print("\n[Windows Store Icons]")
    for name, size in WINDOWS_SIZES.items():
        generate_icon(img, size, os.path.join(ICONS_DIR, name))

    # Android icons
    print("\n[Android Icons]")
    for folder, size in ANDROID_MIPMAPS.items():
        folder_path = os.path.join(ICONS_DIR, "android", folder)
        os.makedirs(folder_path, exist_ok=True)
        for name in ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]:
            generate_icon(img, size, os.path.join(folder_path, name))

    # Android adaptive icon XML (keep existing if present)
    anydpi_path = os.path.join(ICONS_DIR, "android", "mipmap-anydpi-v26")
    os.makedirs(anydpi_path, exist_ok=True)
    
    ic_launcher_xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>'''

    for name in ["ic_launcher.xml", "ic_launcher_round.xml"]:
        xml_path = os.path.join(anydpi_path, name)
        if not os.path.exists(xml_path):
            with open(xml_path, 'w') as f:
                f.write(ic_launcher_xml)
            print(f"  Created: {xml_path}")

    # Android colors.xml
    values_path = os.path.join(ICONS_DIR, "android", "values")
    os.makedirs(values_path, exist_ok=True)
    colors_path = os.path.join(values_path, "ic_launcher_background.xml")
    if not os.path.exists(colors_path):
        with open(colors_path, 'w') as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#050505</color>\n</resources>\n')
        print(f"  Created: {colors_path}")

    # iOS icons
    print("\n[iOS Icons]")
    ios_path = os.path.join(ICONS_DIR, "ios")
    os.makedirs(ios_path, exist_ok=True)
    for name, size in IOS_SIZES.items():
        generate_icon(img, size, os.path.join(ios_path, name))

    # Generate .ico for Windows (multi-size)
    print("\n[Windows .ico]")
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_images = [img.resize((s, s), Image.Resampling.LANCZOS) for s in ico_sizes]
    ico_path = os.path.join(ICONS_DIR, "icon.ico")
    ico_images[0].save(ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_images[1:])
    print(f"  Generated: {ico_path} (multi-size)")

    # Also generate NSIS header/sidebar if not exist
    print("\n[NSIS Installer Images]")
    nsis_dir = os.path.join("src-tauri", "nsis")
    os.makedirs(nsis_dir, exist_ok=True)

    header_path = os.path.join(nsis_dir, "header.bmp")
    sidebar_path = os.path.join(nsis_dir, "sidebar.bmp")

    if not os.path.exists(header_path):
        try:
            from PIL import ImageDraw, ImageFont
            # Header: 150x57
            header = Image.new('RGB', (150, 57), (5, 5, 5))
            draw = ImageDraw.Draw(header)
            for x in range(150):
                r = int(249 * x / 150)
                g = int(25 * x / 150 + 20 * (1 - x/150))
                b = int(66 * x / 150 + 254 * (1 - x/150))
                draw.point((x, 55), fill=(r, g, b))
                draw.point((x, 56), fill=(r, g, b))
            logo_small = img.resize((40, 40), Image.Resampling.LANCZOS)
            header.paste(logo_small, (10, 8), logo_small)
            try: font = ImageFont.truetype('arial.ttf', 16)
            except: font = ImageFont.load_default()
            draw.text((58, 12), 'Phim.tv', fill=(255, 255, 255), font=font)
            try: font_sm = ImageFont.truetype('arial.ttf', 9)
            except: font_sm = ImageFont.load_default()
            draw.text((58, 32), 'Giai Tri Da Phuong Tien', fill=(170, 170, 170), font=font_sm)
            header.save(header_path, 'BMP')
            print(f"  Generated: {header_path} (150x57)")
        except Exception as e:
            print(f"  Skipped header.bmp: {e}")

    if not os.path.exists(sidebar_path):
        try:
            from PIL import ImageDraw, ImageFont
            # Sidebar: 164x314
            sidebar = Image.new('RGB', (164, 314), (5, 5, 5))
            draw = ImageDraw.Draw(sidebar)
            for y in range(314):
                intensity = int(5 + 15 * (y / 314))
                for x in range(164):
                    draw.point((x, y), fill=(intensity, intensity, intensity))
            for y in range(314):
                ratio = y / 314
                r = int(249 * ratio)
                g = int(25 * ratio)
                b = int(66 * ratio + 254 * (1 - ratio))
                draw.point((162, y), fill=(r, g, b))
                draw.point((163, y), fill=(r, g, b))
            logo_med = img.resize((80, 80), Image.Resampling.LANCZOS)
            sidebar.paste(logo_med, (42, 60), logo_med)
            try: font_lg = ImageFont.truetype('arial.ttf', 20)
            except: font_lg = ImageFont.load_default()
            bbox = draw.textbbox((0, 0), 'Phim.tv', font=font_lg)
            tx = (164 - (bbox[2] - bbox[0])) // 2
            draw.text((tx, 155), 'Phim.tv', fill=(255, 255, 255), font=font_lg)
            try: font_md = ImageFont.truetype('arial.ttf', 10)
            except: font_md = ImageFont.load_default()
            bbox2 = draw.textbbox((0, 0), 'Giai Tri Da Phuong Tien', font=font_md)
            tx2 = (164 - (bbox2[2] - bbox2[0])) // 2
            draw.text((tx2, 180), 'Giai Tri Da Phuong Tien', fill=(170, 170, 170), font=font_md)
            sidebar.save(sidebar_path, 'BMP')
            print(f"  Generated: {sidebar_path} (164x314)")
        except Exception as e:
            print(f"  Skipped sidebar.bmp: {e}")

    # Generate uninstaller images (red-themed)
    print("\n[NSIS Uninstaller Images]")
    uninstall_header_path = os.path.join(nsis_dir, "uninstall-header.bmp")
    uninstall_sidebar_path = os.path.join(nsis_dir, "uninstall-sidebar.bmp")

    if not os.path.exists(uninstall_header_path):
        try:
            from PIL import ImageDraw, ImageFont
            header = Image.new('RGB', (150, 57), (15, 5, 5))
            draw = ImageDraw.Draw(header)
            for x in range(150):
                r = int(249 * x / 150)
                g = int(25 * x / 150)
                b = int(66 * x / 150 + 30 * (1 - x/150))
                draw.point((x, 55), fill=(r, g, b))
                draw.point((x, 56), fill=(r, g, b))
            logo_small = img.resize((40, 40), Image.Resampling.LANCZOS)
            header.paste(logo_small, (10, 8), logo_small)
            try: font = ImageFont.truetype('arial.ttf', 16)
            except: font = ImageFont.load_default()
            draw.text((58, 12), 'Phim.tv', fill=(255, 255, 255), font=font)
            try: font_sm = ImageFont.truetype('arial.ttf', 9)
            except: font_sm = ImageFont.load_default()
            draw.text((58, 32), 'Go cai dat', fill=(200, 150, 150), font=font_sm)
            header.save(uninstall_header_path, 'BMP')
            print(f"  Generated: {uninstall_header_path} (150x57)")
        except Exception as e:
            print(f"  Skipped uninstall-header.bmp: {e}")

    if not os.path.exists(uninstall_sidebar_path):
        try:
            from PIL import ImageDraw, ImageFont
            sidebar = Image.new('RGB', (164, 314), (15, 5, 5))
            draw = ImageDraw.Draw(sidebar)
            for y in range(314):
                r = int(15 + 20 * (y / 314))
                g = int(5 + 3 * (y / 314))
                b = int(5 + 3 * (y / 314))
                for x in range(164):
                    draw.point((x, y), fill=(r, g, b))
            for y in range(314):
                ratio = y / 314
                r = int(249)
                g = int(25 + 40 * ratio)
                b = int(66 + 50 * ratio)
                draw.point((162, y), fill=(r, g, b))
                draw.point((163, y), fill=(r, g, b))
            logo_med = img.resize((80, 80), Image.Resampling.LANCZOS)
            sidebar.paste(logo_med, (42, 50), logo_med)
            try: font_lg = ImageFont.truetype('arial.ttf', 20)
            except: font_lg = ImageFont.load_default()
            bbox = draw.textbbox((0, 0), 'Phim.tv', font=font_lg)
            tx = (164 - (bbox[2] - bbox[0])) // 2
            draw.text((tx, 145), 'Phim.tv', fill=(255, 255, 255), font=font_lg)
            try: font_md = ImageFont.truetype('arial.ttf', 10)
            except: font_md = ImageFont.load_default()
            bbox2 = draw.textbbox((0, 0), 'Go cai dat', font=font_md)
            tx2 = (164 - (bbox2[2] - bbox2[0])) // 2
            draw.text((tx2, 170), 'Go cai dat', fill=(200, 150, 150), font=font_md)
            draw.line([(30, 195), (134, 195)], fill=(249, 25, 66), width=1)
            try: font_warn = ImageFont.truetype('arial.ttf', 9)
            except: font_warn = ImageFont.load_default()
            lines = ['Tat ca du lieu se bi', 'xoa hoan toan khoi', 'may tinh cua ban.']
            y_start = 205
            for line in lines:
                bbox3 = draw.textbbox((0, 0), line, font=font_warn)
                tx3 = (164 - (bbox3[2] - bbox3[0])) // 2
                draw.text((tx3, y_start), line, fill=(180, 120, 120), font=font_warn)
                y_start += 14
            sidebar.save(uninstall_sidebar_path, 'BMP')
            print(f"  Generated: {uninstall_sidebar_path} (164x314)")
        except Exception as e:
            print(f"  Skipped uninstall-sidebar.bmp: {e}")

    import io, locale
    if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    print(f"\nAll icons generated successfully in {ICONS_DIR}/")
    total = len(os.listdir(ICONS_DIR))
    for d in ['android', 'ios']:
        dp = os.path.join(ICONS_DIR, d)
        if os.path.exists(dp):
            total += sum(len(os.listdir(os.path.join(dp, sd))) for sd in os.listdir(dp))
    print(f"   Total files: {total}")

if __name__ == "__main__":
    main()