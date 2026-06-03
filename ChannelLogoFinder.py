#!/usr/bin/env python3
"""
Channel Logo Finder v1.0
Tự động tìm và cập nhật logo cho các kênh truyền hình trong file M3U.

Usage:
    python ChannelLogoFinder.py                           # Chạy mặc định
    python ChannelLogoFinder.py --input output.m3u        # Chỉ định input
    python ChannelLogoFinder.py --output IPTV_Master.m3u  # Chỉ định output
    python ChannelLogoFinder.py --dry-run                 # Chỉ hiển thị, không ghi file
    python ChannelLogoFinder.py --help                    # Xem hướng dẫn
"""

import re
import argparse
import time
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote

try:
    import requests
except ImportError:
    print("Cần cài requests: pip install requests")
    exit(1)

# ==================== LOGO SOURCES ====================
# Các nguồn logo uy tín cho kênh TV Việt Nam và quốc tế

LOGO_DATABASE = {
    # Kênh VTV
    "vtv1": "https://upload.wikimedia.org/wikipedia/vi/thumb/9/9e/VTV1_2022.svg/200px-VTV1_2022.svg.png",
    "vtv2": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/67/VTV2_logo.svg/200px-VTV2_logo.svg.png",
    "vtv3": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/42/VTV3_logo_2022.svg/200px-VTV3_logo_2022.svg.png",
    "vtv4": "https://upload.wikimedia.org/wikipedia/vi/thumb/b/b5/VTV4_logo_2022.svg/200px-VTV4_logo_2022.svg.png",
    "vtv5": "https://upload.wikimedia.org/wikipedia/vi/thumb/d/d4/VTV5_logo_2022.svg/200px-VTV5_logo_2022.svg.png",
    "vtv6": "https://upload.wikimedia.org/wikipedia/vi/thumb/2/27/VTV6_logo_2022.svg/200px-VTV6_logo_2022.svg.png",
    "vtv7": "https://upload.wikimedia.org/wikipedia/vi/thumb/2/2f/VTV7_logo_2022.svg/200px-VTV7_logo_2022.svg.png",
    "vtv8": "https://upload.wikimedia.org/wikipedia/vi/thumb/9/93/VTV8_logo_2022.svg/200px-VTV8_logo_2022.svg.png",
    "vtv9": "https://upload.wikimedia.org/wikipedia/vi/thumb/b/b0/VTV9_logo_2022.svg/200px-VTV9_logo_2022.svg.png",
    "vtv can tho": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/6c/VTV_Can_Tho_logo.svg/200px-VTV_Can_Tho_logo.svg.png",

    # Kênh HTV
    "htv1": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png",
    "htv2": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png",
    "htv3": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png",
    "htv the thao": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png",

    # Kênh THVL
    "thvl1": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/4c/THVL1_Logo.svg/200px-THVL1_Logo.svg.png",
    "thvl2": "https://upload.wikimedia.org/wikipedia/vi/thumb/0/0c/THVL2_Logo.svg/200px-THVL2_Logo.svg.png",
    "thvl3": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/4c/THVL1_Logo.svg/200px-THVL1_Logo.svg.png",
    "thvl4": "https://upload.wikimedia.org/wikipedia/vi/thumb/0/0c/THVL2_Logo.svg/200px-THVL2_Logo.svg.png",

    # Kênh ON Sports
    "on football": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/64/ON_Football_logo.svg/200px-ON_Football_logo.svg.png",
    "on sports": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/44/ON_Sports_logo.svg/200px-ON_Sports_logo.svg.png",
    "on sports news": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/44/ON_Sports_logo.svg/200px-ON_Sports_logo.svg.png",
    "on sports+": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/44/ON_Sports_logo.svg/200px-ON_Sports_logo.svg.png",
    "on golf channel": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/44/ON_Sports_logo.svg/200px-ON_Sports_logo.svg.png",

    # Kênh VTVcab
    "vtvcab 16": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/64/ON_Football_logo.svg/200px-ON_Football_logo.svg.png",

    # Kênh Giải trí
    "hbo": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/HBO_logo.svg/200px-HBO_logo.svg.png",
    "hbo hits": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/HBO_logo.svg/200px-HBO_logo.svg.png",
    "hbo family": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/HBO_logo.svg/200px-HBO_logo.svg.png",
    "hbo signature": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/HBO_logo.svg/200px-HBO_logo.svg.png",
    "cinemax": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Cinemax_logo.svg/200px-Cinemax_logo.svg.png",
    "axn": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/AXN_logo_2015.svg/200px-AXN_logo_2015.svg.png",
    "discovery channel": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Discovery_Channel_-_Logo_2019.svg/200px-Discovery_Channel_-_Logo_2019.svg.png",
    "national geographic": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/200px-Natgeologo.svg.png",
    "animal planet": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Animal_Planet_logo.svg/200px-Animal_Planet_logo.svg.png",
    "fashion tv": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Fashion_TV_logo.svg/200px-Fashion_TV_logo.svg.png",
    "warner tv": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Warner_TV_logo.svg/200px-Warner_TV_logo.svg.png",
    "cinema world": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/AXN_logo_2015.svg/200px-AXN_logo_2015.svg.png",

    # Kênh K+
    "k+": "https://upload.wikimedia.org/wikipedia/vi/thumb/1/15/Kplus_logo.svg/200px-Kplus_logo.svg.png",
    "k+ sport": "https://upload.wikimedia.org/wikipedia/vi/thumb/1/15/Kplus_logo.svg/200px-Kplus_logo.svg.png",
    "k+ action": "https://upload.wikimedia.org/wikipedia/vi/thumb/1/15/Kplus_logo.svg/200px-Kplus_logo.svg.png",
    "k+ cine": "https://upload.wikimedia.org/wikipedia/vi/thumb/1/15/Kplus_logo.svg/200px-Kplus_logo.svg.png",
    "k+ kids": "https://upload.wikimedia.org/wikipedia/vi/thumb/1/15/Kplus_logo.svg/200px-Kplus_logo.svg.png",

    # Kênh quốc tế thể thao
    "bbc": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/BBC_Logo_2021.svg/200px-BBC_Logo_2021.svg.png",
    "cnn": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/CNN.svg/200px-CNN.svg.png",
    "fox sports": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/2009_Fox_Sports_logo.svg/200px-2009_Fox_Sports_logo.svg.png",
    "espn": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    "sky sports": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Sky_Sports_Logo.svg/200px-Sky_Sports_Logo.svg.png",
    "bein sports": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/BeIN_Sports_logo.svg/200px-BeIN_Sports_logo.svg.png",
    "nba tv": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/NBA_TV.svg/200px-NBA_TV.svg.png",
    "nfl network": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/NFL_Network_logo.svg/200px-NFL_Network_logo.svg.png",
}

# Logo search APIs (fallback)
LOGO_SEARCH_URLS = [
    "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/vietnam/{channel}.png",
    "https://raw.githubusercontent.com/freetvm/tv-logos/master/vietnam/{channel}.png",
]

# ==================== UTILITY FUNCTIONS ====================

def log(msg, level="info"):
    """Formatted logging."""
    icons = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌", "progress": "⏳"}
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {icons.get(level, '•')} {msg}")

def normalize_name(name):
    """Normalize channel name for matching."""
    name = re.sub(r'\[.*?\]', '', name)
    name = re.sub(r'\(.*?\)', '', name)
    name = re.sub(r'\b(hd|fhd|uhd|4k|sd|channel|tv|ch)\b', '', name, flags=re.IGNORECASE)
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip().lower()
    return name

def find_logo_for_channel(channel_name):
    """Find logo URL for a channel name."""
    normalized = normalize_name(channel_name)

    # Direct match in database
    if normalized in LOGO_DATABASE:
        return LOGO_DATABASE[normalized]

    # Partial match
    for key, url in LOGO_DATABASE.items():
        if key in normalized or normalized in key:
            return url

    # Try GitHub logo repos
    clean_name = re.sub(r'\s+', '-', channel_name.strip().lower())
    clean_name = re.sub(r'[^a-z0-9-]', '', clean_name)

    for template in LOGO_SEARCH_URLS:
        url = template.format(channel=clean_name)
        try:
            resp = requests.head(url, timeout=5, allow_redirects=True)
            if resp.status_code == 200:
                return url
        except Exception:
            continue

    return None

def validate_logo_url(url):
    """Check if a logo URL is accessible."""
    if not url or not url.strip():
        return False
    try:
        resp = requests.head(url, timeout=5, allow_redirects=True)
        return resp.status_code == 200
    except Exception:
        return False

# ==================== M3U PROCESSING ====================

def parse_m3u_lines(file_path):
    """Read M3U file and return lines."""
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        return f.readlines()

def process_channel_logo(line, dry_run=False):
    """Process a single EXTINF line: find and update logo."""
    if not line.startswith('#EXTINF'):
        return line, False, ""

    # Extract channel name
    name_match = re.search(r'#EXTINF[^,]*,(.*)', line)
    if not name_match:
        return line, False, ""
    channel_name = name_match.group(1).strip()

    # Extract current logo
    logo_match = re.search(r'tvg-logo="([^"]*)"', line)
    current_logo = logo_match.group(1) if logo_match else ""

    # Check if logo is missing or broken
    needs_update = False
    if not current_logo or current_logo.strip() == "":
        needs_update = True
    elif not dry_run:
        # Only validate if not dry_run (to avoid slow validation)
        needs_update = not validate_logo_url(current_logo)

    if not needs_update:
        return line, False, ""

    # Find new logo
    new_logo = find_logo_for_channel(channel_name)
    if not new_logo:
        return line, False, ""

    # Update the line
    if logo_match:
        new_line = line.replace(f'tvg-logo="{current_logo}"', f'tvg-logo="{new_logo}"')
    else:
        # Insert tvg-logo attribute
        new_line = line.replace('group-title="', f'tvg-logo="{new_logo}" group-title="')

    return new_line, True, new_logo

def main():
    parser = argparse.ArgumentParser(description='Channel Logo Finder - Tự động tìm và cập nhật logo kênh TV')
    parser.add_argument('--input', default='IPTV_Master.m3u', help='File M3U input (default: IPTV_Master.m3u)')
    parser.add_argument('--output', default=None, help='File output (default: ghi đè file input)')
    parser.add_argument('--dry-run', action='store_true', help='Chỉ hiển thị, không ghi file')
    parser.add_argument('--validate', action='store_true', help='Kiểm tra logo hiện tại có hợp lệ không')
    parser.add_argument('--workers', type=int, default=10, help='Số worker threads (default: 10)')
    args = parser.parse_args()

    output_path = args.output or args.input
    start_time = time.time()

    log(f"Input: {args.input}", "info")
    log(f"Output: {output_path}", "info")
    if args.dry_run:
        log("Chế độ DRY RUN - không ghi file", "warn")

    # Read M3U
    log("Đang đọc file M3U...", "progress")
    try:
        lines = parse_m3u_lines(args.input)
    except FileNotFoundError:
        log(f"Không tìm thấy file: {args.input}", "error")
        return

    log(f"Đã đọc {len(lines)} dòng", "success")

    # Process logos
    log("Đang tìm và cập nhật logo...", "progress")
    updated_count = 0
    failed_count = 0
    skipped_count = 0
    new_lines = []
    updates = []

    for i, line in enumerate(lines):
        new_line, updated, new_logo = process_channel_logo(line.strip(), args.dry_run)
        if updated:
            updated_count += 1
            channel_name = re.search(r'#EXTINF[^,]*,(.*)', line)
            name = channel_name.group(1).strip() if channel_name else "?"
            updates.append((name, new_logo))
            if not args.dry_run:
                new_lines.append(new_line + '\n')
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    # Display updates
    if updates:
        log(f"Tìm thấy {len(updates)} kênh cần cập nhật logo:", "success")
        for name, logo in updates:
            print(f"  ✅ {name}")
            print(f"     → {logo[:80]}{'...' if len(logo) > 80 else ''}")
    else:
        log("Không tìm thấy kênh nào cần cập nhật logo", "info")

    # Validate existing logos
    if args.validate:
        log("Đang kiểm tra logo hiện tại...", "progress")
        broken_count = 0
        for i, line in enumerate(lines):
            if line.startswith('#EXTINF'):
                logo_match = re.search(r'tvg-logo="([^"]*)"', line)
                if logo_match and logo_match.group(1).strip():
                    if not validate_logo_url(logo_match.group(1)):
                        name_match = re.search(r'#EXTINF[^,]*,(.*)', line)
                        name = name_match.group(1).strip() if name_match else "?"
                        log(f"  Logo hỏng: {name}", "warn")
                        broken_count += 1
        if broken_count:
            log(f"Tìm thấy {broken_count} logo hỏng", "warn")
        else:
            log("Tất cả logo đều hợp lệ", "success")

    # Write output
    if not args.dry_run and updates:
        log(f"Đang ghi file: {output_path}", "progress")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
        log(f"Đã cập nhật {updated_count} logo", "success")
    elif args.dry_run:
        log("DRY RUN - không ghi file", "info")

    # Thống kê
    total_time = time.time() - start_time
    log(f"Hoàn thành trong {total_time:.1f}s", "success")
    print(f"\n📊 THỐNG KÊ:")
    print(f"  Tổng dòng: {len(lines)}")
    print(f"  Logo đã cập nhật: {updated_count}")
    print(f"  Logo không tìm thấy: {failed_count}")

if __name__ == "__main__":
    main()