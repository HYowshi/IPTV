#!/usr/bin/env python3
"""
Generate all app icons from logo.png for Tauri build.
Creates icons for Desktop (Win/Mac/Linux), Android (round + square), iOS, and NSIS installer.

Usage:
    python generate-icons.py              # Default: skip existing files
    python generate-icons.py --force      # Regenerate all icons
    python generate-icons.py --help       # Show help
Requires: pip install Pillow
"""

import os
import sys
import io
import argparse
import time

# Fix encoding on Windows CI
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("[setup] Installing Pillow...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image, ImageDraw

SRC = "logo.png"
ICONS_DIR = "src-tauri/icons"
NSIS_DIR = "src-tauri/nsis"

DESKTOP_SIZES = {"32x32.png":32, "64x64.png":64, "128x128.png":128, "128x128@2x.png":256, "icon.png":512}
WINDOWS_SIZES = {"Square30x30Logo.png":30,"Square44x44Logo.png":44,"Square71x71Logo.png":71,"Square89x89Logo.png":89,"Square107x107Logo.png":107,"Square142x142Logo.png":142,"Square150x150Logo.png":150,"Square284x284Logo.png":284,"Square310x310Logo.png":310,"StoreLogo.png":50}
ANDROID_MIPMAPS = {"mipmap-mdpi":48, "mipmap-hdpi":72, "mipmap-xhdpi":96, "mipmap-xxhdpi":144, "mipmap-xxxhdpi":192}
IOS_SIZES = {"AppIcon-20.png":20,"AppIcon-20@2x.png":40,"AppIcon-20@3x.png":60,"AppIcon-29.png":29,"AppIcon-29@2x.png":58,"AppIcon-29@3x.png":87,"AppIcon-40.png":40,"AppIcon-40@2x.png":80,"AppIcon-40@3x.png":120,"AppIcon-60@2x.png":120,"AppIcon-60@3x.png":180,"AppIcon-76.png":76,"AppIcon-76@2x.png":152,"AppIcon-83.5@2x.png":167,"AppIcon-1024.png":1024}

def log(msg):
    print(f"  {msg}")

def make_round_icon(img, size):
    """Create circular icon from square image."""
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size-1, size-1), fill=255)
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(resized, (0, 0), mask)
    return result

def make_adaptive_icon(img, size):
    """Create Android adaptive icon (logo on transparent background)."""
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    logo_size = int(size * 0.66)
    logo = img.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    offset = (size - logo_size) // 2
    result.paste(logo, (offset, offset), logo if logo.mode == 'RGBA' else None)
    return result

def save_icon(img, path, force=False):
    """Save icon, skip if exists and not force."""
    if not force and os.path.exists(path):
        log(f"  [skip] {os.path.basename(path)}")
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    log(f"  [gen]  {os.path.basename(path)} ({img.size[0]}x{img.size[1]})")
    return True

def main():
    parser = argparse.ArgumentParser(description='Generate app icons from logo.png')
    parser.add_argument('--force', action='store_true', help='Regenerate all icons even if they exist')
    args = parser.parse_args()
    force = args.force

    if not os.path.exists(SRC):
        print(f"Error: {SRC} not found!")
        sys.exit(1)

    img = Image.open(SRC).convert("RGBA")
    w, h = img.size
    if w != h:
        s = min(w, h)
        img = img.crop(((w-s)//2, (h-s)//2, (w+s)//2, (h+s)//2))
        print(f"Cropped to square: {img.size}")

    if img.size[0] < 1024:
        from PIL import ImageEnhance
        current = img
        target = 1024
        while current.size[0] < target:
            step_size = min(current.size[0] * 2, target)
            current = current.resize((step_size, step_size), Image.Resampling.LANCZOS)
            enhancer = ImageEnhance.Sharpness(current)
            current = enhancer.enhance(1.3)
        img = current
        print(f"Upscaled to 1024x1024 with sharpen")

    print(f"\n=== Generating icons from {SRC} ({img.size[0]}x{img.size[1]}) ===\n")
    count = 0

    # Desktop
    print("[Desktop]")
    for name, size in DESKTOP_SIZES.items():
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        if save_icon(resized, os.path.join(ICONS_DIR, name), force):
            count += 1

    # Windows Store
    print("[Windows Store]")
    for name, size in WINDOWS_SIZES.items():
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        if save_icon(resized, os.path.join(ICONS_DIR, name), force):
            count += 1

    # Android (square + round + adaptive)
    print("[Android]")
    for folder, size in ANDROID_MIPMAPS.items():
        dp = os.path.join(ICONS_DIR, "android", folder)
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        if save_icon(resized, os.path.join(dp, "ic_launcher.png"), force):
            count += 1
        round_icon = make_round_icon(img, size)
        if save_icon(round_icon, os.path.join(dp, "ic_launcher_round.png"), force):
            count += 1
        adaptive = make_adaptive_icon(img, size)
        if save_icon(adaptive, os.path.join(dp, "ic_launcher_foreground.png"), force):
            count += 1

    # Android adaptive XML
    anydpi = os.path.join(ICONS_DIR, "android", "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>'
    for name in ["ic_launcher.xml", "ic_launcher_round.xml"]:
        p = os.path.join(anydpi, name)
        if not os.path.exists(p):
            with open(p, 'w') as f: f.write(xml)
            log(f"  [gen]  {name}")

    # Android colors.xml
    vals = os.path.join(ICONS_DIR, "android", "values")
    os.makedirs(vals, exist_ok=True)
    cp = os.path.join(vals, "ic_launcher_background.xml")
    if not os.path.exists(cp):
        with open(cp, 'w') as f: f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#050505</color></resources>\n')
        log("  [gen]  ic_launcher_background.xml")

    # iOS
    print("[iOS]")
    for name, size in IOS_SIZES.items():
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        if save_icon(resized, os.path.join(ICONS_DIR, "ios", name), force):
            count += 1

    # Windows .ico
    print("[Windows .ico]")
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_path = os.path.join(ICONS_DIR, "icon.ico")
    if force or not os.path.exists(ico_path):
        ico_imgs = [img.resize((s, s), Image.Resampling.LANCZOS) for s in ico_sizes]
        ico_imgs[0].save(ico_path, format="ICO", sizes=[(s,s) for s in ico_sizes], append_images=ico_imgs[1:])
        log(f"  [gen]  icon.ico (multi-size)")
        count += 1

    # NSIS installer images
    print("[NSIS]")
    from PIL import ImageFont
    def get_font(name, size):
        for p in [f'C:/Windows/Fonts/{name}.ttf', f'/usr/share/fonts/truetype/dejavu/{name}.ttf']:
            if os.path.exists(p): return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    # Header
    hp = os.path.join(NSIS_DIR, "header.bmp")
    if force or not os.path.exists(hp):
        h = Image.new('RGB', (150, 57), (10, 10, 10))
        d = ImageDraw.Draw(h)
        for x in range(150):
            d.point((x, 55), fill=(int(249*x/150), int(25*x/150+20*(1-x/150)), int(66*x/150+254*(1-x/150))))
            d.point((x, 56), fill=(int(249*x/150), int(25*x/150+20*(1-x/150)), int(66*x/150+254*(1-x/150))))
        logo_s = img.resize((40, 40), Image.Resampling.LANCZOS)
        h.paste(logo_s, (8, 7), logo_s)
        d.text((56, 12), 'Phim.tv', fill=(255,255,255), font=get_font('arialbd', 18))
        d.text((56, 32), 'Giai Tri Da Phuong Tien', fill=(180,180,180), font=get_font('arial', 9))
        h.save(hp, 'BMP')
        log("  [gen]  header.bmp")
        count += 1

    # Sidebar
    sp = os.path.join(NSIS_DIR, "sidebar.bmp")
    if force or not os.path.exists(sp):
        s = Image.new('RGB', (164, 314), (8, 8, 8))
        d = ImageDraw.Draw(s)
        for y in range(314):
            t = y/314
            for x in range(164):
                d.point((x, y), fill=(int(8+12*t), int(8+8*t), int(8+15*t)))
        for y in range(314):
            t = y/314
            for px in [161,162,163]:
                d.point((px, y), fill=(int(249*t), int(25+40*t), int(66+188*(1-t))))
        logo_m = img.resize((80, 80), Image.Resampling.LANCZOS)
        s.paste(logo_m, (42, 60), logo_m)
        f_lg = get_font('arialbd', 22)
        bb = d.textbbox((0,0), 'Phim.tv', font=f_lg)
        d.text(((164-(bb[2]-bb[0]))//2, 155), 'Phim.tv', fill=(255,255,255), font=f_lg)
        f_md = get_font('arial', 10)
        bb2 = d.textbbox((0,0), 'Giai Tri Da Phuong Tien', font=f_md)
        d.text(((164-(bb2[2]-bb2[0]))//2, 180), 'Giai Tri Da Phuong Tien', fill=(170,170,170), font=f_md)
        s.save(sp, 'BMP')
        log("  [gen]  sidebar.bmp")
        count += 1

    # Uninstall header
    uhp = os.path.join(NSIS_DIR, "uninstall-header.bmp")
    if force or not os.path.exists(uhp):
        h = Image.new('RGB', (150, 57), (12, 5, 5))
        d = ImageDraw.Draw(h)
        for x in range(150):
            d.point((x, 55), fill=(int(249*x/150), int(25*x/150), int(66*x/150)))
            d.point((x, 56), fill=(int(249*x/150), int(25*x/150), int(66*x/150)))
        h.paste(img.resize((42, 42), Image.Resampling.LANCZOS), (8, 7), img.resize((42, 42), Image.Resampling.LANCZOS))
        d.text((56, 12), 'Phim.tv', fill=(255,255,255), font=get_font('arialbd', 18))
        d.text((56, 32), 'Go cai dat', fill=(200,150,150), font=get_font('arial', 9))
        h.save(uhp, 'BMP')
        log("  [gen]  uninstall-header.bmp")
        count += 1

    # Uninstall sidebar
    usp = os.path.join(NSIS_DIR, "uninstall-sidebar.bmp")
    if force or not os.path.exists(usp):
        s = Image.new('RGB', (164, 314), (10, 4, 4))
        d = ImageDraw.Draw(s)
        for y in range(314):
            t = y/314
            for x in range(164):
                d.point((x, y), fill=(int(10+20*t), int(4+3*t), int(4+3*t)))
        for y in range(314):
            t = y/314
            for px in [161,162,163]:
                d.point((px, y), fill=(249, int(25+40*t), int(66+50*t)))
        s.paste(img.resize((80, 80), Image.Resampling.LANCZOS), (42, 50), img.resize((80, 80), Image.Resampling.LANCZOS))
        f_lg = get_font('arialbd', 22)
        bb = d.textbbox((0,0), 'Phim.tv', font=f_lg)
        d.text(((164-(bb[2]-bb[0]))//2, 145), 'Phim.tv', fill=(255,255,255), font=f_lg)
        f_md = get_font('arial', 10)
        bb2 = d.textbbox((0,0), 'Go cai dat', font=f_md)
        d.text(((164-(bb2[2]-bb2[0]))//2, 170), 'Go cai dat', fill=(200,150,150), font=f_md)
        d.line([(30, 195), (134, 195)], fill=(249, 25, 66), width=1)
        s.save(usp, 'BMP')
        log("  [gen]  uninstall-sidebar.bmp")
        count += 1

    # Summary
    total = 0
    for root, dirs, files in os.walk(ICONS_DIR):
        total += len(files)

    print(f"\n=== Done! Generated {count} new files ===")
    print(f"   Total icon files: {total}")
    print(f"   NSIS images: 4")

if __name__ == "__main__":
    main()