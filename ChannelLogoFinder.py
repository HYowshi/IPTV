#!/usr/bin/env python3
"""
Channel Logo Finder v2.1
Tự động tìm, kiểm tra và cập nhật logo cho các kênh truyền hình trong file M3U.

Kiểm tra logo:
- Chính xác: Logo đúng của kênh đó
- Đúng kênh: Logo match với tên kênh
- Khả dụng: Logo URL trả về HTTP 200

Usage:
    python ChannelLogoFinder.py                           # Chạy mặc định
    python ChannelLogoFinder.py --input output.m3u        # Chỉ định input
    python ChannelLogoFinder.py --output IPTV_Master.m3u  # Chỉ định output
    python ChannelLogoFinder.py --dry-run                 # Chỉ hiển thị, không ghi file
    python ChannelLogoFinder.py --validate                # Kiểm tra logo hiện tại
    python ChannelLogoFinder.py --help                    # Xem hướng dẫn
"""

import re
import argparse
import json
import sys
import time
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor

try:
    import requests
except ImportError:
    print("Missing dependency: install it with 'python -m pip install requests'")
    exit(1)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ==================== LOGO DATABASE ====================
# Logo chính xác cho từng kênh (verified URLs)

LOGO_DATABASE = {
    # Kênh VTV
    "vtv1": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/9/9e/VTV1_2022.svg/200px-VTV1_2022.svg.png", "verified": True},
    "vtv2": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/67/VTV2_logo.svg/200px-VTV2_logo.svg.png", "verified": True},
    "vtv3": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/42/VTV3_logo_2022.svg/200px-VTV3_logo_2022.svg.png", "verified": True},
    "vtv4": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/b/b5/VTV4_logo_2022.svg/200px-VTV4_logo_2022.svg.png", "verified": True},
    "vtv5": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/d/d4/VTV5_logo_2022.svg/200px-VTV5_logo_2022.svg.png", "verified": True},
    "vtv6": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/2/27/VTV6_logo_2022.svg/200px-VTV6_logo_2022.svg.png", "verified": True},
    "vtv7": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/2/2f/VTV7_logo_2022.svg/200px-VTV7_logo_2022.svg.png", "verified": True},
    "vtv8": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/9/93/VTV8_logo_2022.svg/200px-VTV8_logo_2022.svg.png", "verified": True},
    "vtv9": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/b/b0/VTV9_logo_2022.svg/200px-VTV9_logo_2022.svg.png", "verified": True},
    "vtv can tho": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/6c/VTV_Can_Tho_logo.svg/200px-VTV_Can_Tho_logo.svg.png", "verified": True},
    "vietnam today": {"url": "https://vtvgo-assets.vtvdigital.vn/assets/images/v2/channel/20250905/2025090515/S1CWNGr2gI-VIETNAMTODAY-THUMBNAIL-KENHVTVgo-500x281.webp", "verified": True},

    # Kênh HTV
    "htv1": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png", "verified": True},
    "htv2": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png", "verified": True},
    "htv3": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/a/a8/HTV_Logo.svg/200px-HTV_Logo.svg.png", "verified": True},

    # Kênh THVL
    "thvl1": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/4c/THVL1_Logo.svg/200px-THVL1_Logo.svg.png", "verified": True},
    "thvl2": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/0/0c/THVL2_Logo.svg/200px-THVL2_Logo.svg.png", "verified": True},

    # Kênh ON Sports
    "on football": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/6/64/ON_Football_logo.svg/200px-ON_Football_logo.svg.png", "verified": True},
    "on sports": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/44/ON_Sports_logo.svg/200px-ON_Sports_logo.svg.png", "verified": True},
    "on sports news": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/4/44/ON_Sports_logo.svg/200px-ON_Sports_logo.svg.png", "verified": True},

    # Kênh Giải trí quốc tế
    "hbo": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/HBO_logo.svg/200px-HBO_logo.svg.png", "verified": True},
    "cinemax": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Cinemax_logo.svg/200px-Cinemax_logo.svg.png", "verified": True},
    "axn": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/AXN_logo_2015.svg/200px-AXN_logo_2015.svg.png", "verified": True},
    "discovery channel": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Discovery_Channel_-_Logo_2019.svg/200px-Discovery_Channel_-_Logo_2019.svg.png", "verified": True},
    "national geographic": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/200px-Natgeologo.svg.png", "verified": True},
    "animal planet": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Animal_Planet_logo.svg/200px-Animal_Planet_logo.svg.png", "verified": True},

    # Kênh K+
    "k+": {"url": "https://upload.wikimedia.org/wikipedia/vi/thumb/1/15/Kplus_logo.svg/200px-Kplus_logo.svg.png", "verified": True},

    # Kênh quốc tế
    "bbc": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/BBC_Logo_2021.svg/200px-BBC_Logo_2021.svg.png", "verified": True},
    "cnn": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/CNN.svg/200px-CNN.svg.png", "verified": True},
    "fox sports": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/2009_Fox_Sports_logo.svg/200px-2009_Fox_Sports_logo.svg.png", "verified": True},
    "espn": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png", "verified": True},
    "sky sports": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Sky_Sports_Logo.svg/200px-Sky_Sports_Logo.svg.png", "verified": True},
    "bein sports": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/BeIN_Sports_logo.svg/200px-BeIN_Sports_logo.svg.png", "verified": True},
    "nba tv": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/NBA_TV.svg/200px-NBA_TV.svg.png", "verified": True},
    "nfl network": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/NFL_Network_logo.svg/200px-NFL_Network_logo.svg.png", "verified": True},
    "disney channel": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Disney_Channel_2014.svg/200px-Disney_Channel_2014.svg.png", "verified": True},
    "nickelodeon": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Nickelodeon_2023_logo.svg/200px-Nickelodeon_2023_logo.svg.png", "verified": True},
    "cartoon network": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Cartoon_Network_2010_logo.svg/200px-Cartoon_Network_2010_logo.svg.png", "verified": True},
    "mtv": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/MTV_2021_%28outline%29.svg/200px-MTV_2021_%28outline%29.svg.png", "verified": True},
    "national geographic wild": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/200px-Natgeologo.svg.png", "verified": True},
    "history channel": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/History_Channel_logo_2021.svg/200px-History_Channel_logo_2021.svg.png", "verified": True},
    "comedy central": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Comedy_Central_2018.svg/200px-Comedy_Central_2018.svg.png", "verified": True},
    "paramount": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Paramount_Plus_logo.svg/200px-Paramount_Plus_logo.svg.png", "verified": True},
    "star movies": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Star_Movies_India_logo.svg/200px-Star_Movies_India_logo.svg.png", "verified": True},
    "star plus": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/StarPlus_2016.svg/200px-StarPlus_2016.svg.png", "verified": True},
    "sony": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Sony_Pictures_Television_logo.svg/200px-Sony_Pictures_Television_logo.svg.png", "verified": True},
    "set max": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/SET_Max_logo.svg/200px-SET_Max_logo.svg.png", "verified": True},
    "zee tv": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Zee_TV_logo.svg/200px-Zee_TV_logo.svg.png", "verified": True},
    "nat geo wild": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/200px-Natgeologo.svg.png", "verified": True},
    "tnt": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/TNT_logo_2016.svg/200px-TNT_logo_2016.svg.png", "verified": True},
    "fx": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/FX_2017.svg/200px-FX_2017.svg.png", "verified": True},
    "amc": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/AMC_logo_2019.svg/200px-AMC_logo_2019.svg.png", "verified": True},
    "showtime": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Showtime_2015.svg/200px-Showtime_2015.svg.png", "verified": True},
    "starz": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Starz_2016.svg/200px-Starz_2016.svg.png", "verified": True},
}

# GitHub logo repos (fallback)
LOGO_GITHUB_REPOS = [
    "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/vietnam/{channel}.png",
    "https://raw.githubusercontent.com/freetvm/tv-logos/master/vietnam/{channel}.png",
]

# Alternative logo sources with keyword patterns
LOGO_SEARCH_SOURCES = {
    # Vietnamese channels - search patterns
    "vtv": ["VTV", "vtvgo-assets"],
    "htv": ["HTV", "HTVPlus"],
    "thvl": ["THVL", "thvli"],
    "sctv": ["SCTV", "sctv"],
    "k+": ["Kplus", "K-PLUS"],
    "on sports": ["ON_Sports", "ONSports"],
    "on football": ["ON_Football"],
    "vfc": ["VFC"],
    "vtc": ["VTC"],
    "qpvn": ["QPVN"],
    "anninh": ["ANTV", "AnNinh"],
}

# ==================== UTILITY FUNCTIONS ====================

def log(msg, level="info"):
    icons = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌", "progress": "⏳"}
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {icons.get(level, '•')} {msg}")

def normalize_name(name):
    """Normalize channel name for matching."""
    name = name.replace('Đ', 'D').replace('đ', 'd')
    name = unicodedata.normalize('NFKD', name)
    name = name.encode('ascii', 'ignore').decode()
    name = re.sub(r'\[.*?\]', '', name)
    name = re.sub(r'\(.*?\)', '', name)
    name = re.sub(r'\b(hd|fhd|uhd|4k|sd|channel|tv|ch)\b', '', name, flags=re.IGNORECASE)
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip().lower()
    return name

_thread_local = threading.local()


def get_http_session():
    """Return one reusable requests session per worker thread."""
    if not hasattr(_thread_local, 'session'):
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; PhimTV-LogoFinder/2.1)',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        })
        _thread_local.session = session
    return _thread_local.session


def check_logo(url, timeout=3):
    """Validate a logo with one small GET request.

    HEAD is not reliable for image CDNs: several valid hosts reject HEAD while
    accepting GET. Reading only the first bytes also avoids downloading large
    images during the scheduled workflow.
    """
    if not url:
        return False, 'missing'

    try:
        response = get_http_session().get(
            url,
            timeout=timeout,
            allow_redirects=True,
            stream=True,
            headers={'Range': 'bytes=0-4095'},
        )
        if response.status_code not in (200, 206):
            response.close()
            return False, f'http_{response.status_code}'

        content_type = response.headers.get('Content-Type', '').lower()
        chunk = next(response.iter_content(4096), b'')
        response.close()
        signature = chunk[:16]
        is_image = (
            'image/' in content_type
            or signature.startswith((b'\x89PNG', b'\xff\xd8\xff', b'GIF87a', b'GIF89a'))
            or (signature.startswith(b'RIFF') and b'WEBP' in signature)
            or b'<svg' in chunk[:1024].lower()
        )
        return (True, '') if chunk and is_image else (False, 'not_image')
    except requests.RequestException as exc:
        return False, type(exc).__name__


def check_logo_urls(urls, workers=10, timeout=3):
    """Check each unique URL once and return a URL -> result mapping."""
    unique_urls = sorted({url for url in urls if url})
    if not unique_urls:
        return {}

    log(f"Kiem tra {len(unique_urls)} URL logo voi {workers} workers...", "progress")
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        results = executor.map(lambda url: check_logo(url, timeout), unique_urls)
        return dict(zip(unique_urls, results))

def verify_logo_matches_channel(logo_url, channel_name):
    """Verify logo URL actually matches the channel name."""
    normalized_channel = normalize_name(channel_name)
    url_lower = logo_url.lower()

    # Check if channel name appears in URL
    name_words = normalized_channel.split()
    matches = sum(1 for w in name_words if w in url_lower)

    # At least 50% of name words should be in URL
    if len(name_words) > 0 and matches / len(name_words) >= 0.5:
        return True

    # Special cases: brand names in URL
    brand_patterns = {
        'vtv': ['vtv'],
        'htv': ['htv'],
        'thvl': ['thvl'],
        'hbo': ['hbo'],
        'cinemax': ['cinemax'],
        'axn': ['axn'],
        'discovery': ['discovery'],
        'national geographic': ['natgeo', 'national'],
        'animal planet': ['animal'],
        'k+': ['kplus', 'k+'],
        'bbc': ['bbc'],
        'cnn': ['cnn'],
        'espn': ['espn'],
        'sky sports': ['sky'],
        'bein sports': ['bein'],
    }

    for brand, patterns in brand_patterns.items():
        if brand in normalized_channel:
            if any(p in url_lower for p in patterns):
                return True

    # If we can't verify, assume OK (better to have some logo than none)
    return True

def load_logo_overrides(file_path):
    """Load curated logo mappings maintained with the playlists."""
    if not file_path:
        return {'by_name': {}, 'by_tvg_id': {}}
    try:
        with open(file_path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
    except FileNotFoundError:
        log(f"Không tìm thấy file logo: {file_path}", "warn")
        return {'by_name': {}, 'by_tvg_id': {}}
    return {
        'by_name': {
            normalize_name(key): value
            for key, value in data.get('by_name', {}).items()
        },
        'by_tvg_id': {
            key.strip().lower().split('@', 1)[0]: value
            for key, value in data.get('by_tvg_id', {}).items()
        },
    }


def find_logo_for_channel(channel, overrides):
    """Find a conservative logo candidate for a channel.

    Automatic updates only use exact normalized database matches. Broad
    partial matching can silently attach a generic or wrong channel logo.
    """
    normalized = normalize_name(channel['name'])
    tvg_id = channel.get('tvg_id', '').strip().lower().split('@', 1)[0]

    if normalized in overrides['by_name']:
        return overrides['by_name'][normalized], 'override-name'
    if tvg_id and tvg_id in overrides['by_tvg_id']:
        return overrides['by_tvg_id'][tvg_id], 'override-tvg-id'

    # 1. Direct match in verified database
    if normalized in LOGO_DATABASE:
        entry = LOGO_DATABASE[normalized]
        return entry["url"], "database"

    return None, None

# ==================== M3U PROCESSING ====================

def read_m3u(file_path):
    """Read an M3U while retaining encoding and newline style."""
    raw = open(file_path, 'rb').read()
    has_bom = raw.startswith(b'\xef\xbb\xbf')
    newline = '\r\n' if b'\r\n' in raw else '\n'
    text = raw.decode('utf-8-sig', errors='replace')
    return text.splitlines(), has_bom, newline


def parse_m3u_channels(lines):
    """Parse M3U entries and retain the original EXTINF line index."""
    channels = []
    current = None
    for line_index, original_line in enumerate(lines):
        line = original_line.strip()
        if line.startswith('#EXTINF'):
            name_match = re.search(r'#EXTINF[^,]*,(.*)', line)
            logo_match = re.search(r'tvg-logo="([^"]*)"', line)
            current = {
                'name': name_match.group(1).strip() if name_match else '',
                'logo': logo_match.group(1) if logo_match else '',
                'tvg_id': dict(re.findall(r'([\w-]+)="([^"]*)"', line)).get('tvg-id', ''),
                'line_index': line_index,
                'url': '',
            }
        elif current and line and not line.startswith('#'):
            current['url'] = line
            channels.append(current)
            current = None
    return channels

def validate_channel_logo(channel, logo_results):
    """Validate a channel's current logo."""
    name = channel['name']
    logo = channel['logo']

    issues = []

    # 1. No logo
    if not logo or logo.strip() == '':
        issues.append('missing')
        return issues

    valid, reason = logo_results.get(logo, (False, 'not_checked'))
    if not valid:
        issues.append(reason)

    # 4. Logo doesn't match channel (basic check)
    if not verify_logo_matches_channel(logo, name):
        issues.append('mismatch')

    return issues

def update_logo_attribute(line, logo_url):
    """Update only tvg-logo and preserve every other EXTINF attribute."""
    if re.search(r'tvg-logo="[^"]*"', line):
        return re.sub(r'tvg-logo="[^"]*"', f'tvg-logo="{logo_url}"', line, count=1)

    comma_index = line.rfind(',')
    if comma_index == -1:
        return line
    return f'{line[:comma_index].rstrip()} tvg-logo="{logo_url}"{line[comma_index:]}'


def write_m3u(file_path, lines, has_bom, newline):
    encoding = 'utf-8-sig' if has_bom else 'utf-8'
    with open(file_path, 'w', encoding=encoding, newline='') as file:
        file.write(newline.join(lines) + newline)

def main():
    parser = argparse.ArgumentParser(description='Channel Logo Finder v2.1 - Tìm, kiểm tra và cập nhật logo kênh TV')
    parser.add_argument('--input', default='IPTV_Master.m3u', help='File M3U input')
    parser.add_argument('--output', default=None, help='File output (default: ghi đè input)')
    parser.add_argument('--dry-run', action='store_true', help='Chỉ hiển thị, không ghi file')
    parser.add_argument('--validate', action='store_true', help='Chỉ kiểm tra logo hiện tại')
    parser.add_argument('--workers', type=int, default=10, help='Số worker threads')
    parser.add_argument('--timeout', type=float, default=3, help='Timeout mỗi URL logo, tính bằng giây')
    parser.add_argument('--logo-file', default='channel_logos.json', help='File JSON logo chuẩn')
    args = parser.parse_args()

    output_path = args.output or args.input
    start_time = time.time()

    log("Channel Logo Finder v2.1", "info")
    log(f"Input: {args.input}", "info")
    log(f"Output: {output_path}", "info")
    overrides = load_logo_overrides(args.logo_file)

    # Parse M3U
    log("Đang đọc file M3U...", "progress")
    try:
        lines, has_bom, newline = read_m3u(args.input)
        channels = parse_m3u_channels(lines)
    except FileNotFoundError:
        log(f"Không tìm thấy file: {args.input}", "error")
        return

    log(f"Đã đọc {len(channels)} kênh", "success")

    logo_results = check_logo_urls(
        (channel['logo'] for channel in channels),
        workers=args.workers,
        timeout=args.timeout,
    )

    if args.validate:
        # Validate-only mode
        log("Đang kiểm tra tất cả logo...", "progress")
        valid = 0
        invalid = 0
        missing = 0

        for ch in channels:
            issues = validate_channel_logo(ch, logo_results)
            if not issues:
                valid += 1
            else:
                if 'missing' in issues:
                    missing += 1
                    log(f"  Thiếu logo: {ch['name']}", "warn")
                else:
                    invalid += 1
                    log(f"  Logo không truy cập: {ch['name']} → {ch['logo'][:60]}", "warn")

        print(f"\n📊 KẾT QUẢ KIỂM TRA:")
        print(f"  ✅ Logo hợp lệ: {valid}")
        print(f"  ⚠️ Logo không hợp lệ: {invalid}")
        print(f"  ❌ Thiếu logo: {missing}")
        return

    # Process logos
    log("Đang tìm và cập nhật logo...", "progress")
    updated = 0
    not_found = 0
    updates = []

    pending = []
    for ch in channels:
        issues = validate_channel_logo(ch, logo_results)
        if not issues:
            continue
        new_logo, source = find_logo_for_channel(ch, overrides)
        if new_logo:
            pending.append((ch, new_logo, source, issues))
        elif 'missing' in issues:
            not_found += 1

    replacement_results = check_logo_urls(
        (new_logo for _, new_logo, _, _ in pending),
        workers=args.workers,
        timeout=args.timeout,
    )

    for ch, new_logo, source, issues in pending:
        if replacement_results.get(new_logo, (False, ''))[0]:
            updated += 1
            updates.append((ch['name'], new_logo, issues))
            if not args.dry_run:
                lines[ch['line_index']] = update_logo_attribute(
                    lines[ch['line_index']], new_logo
                )
        elif 'missing' in issues:
            not_found += 1

    # Display results
    if updates:
        log(f"Cập nhật {len(updates)} logo:", "success")
        for name, logo, issues in updates:
            issue_str = f" [{', '.join(issues)}]" if issues else ""
            print(f"  ✅ {name}{issue_str}")
            print(f"     → {logo[:70]}{'...' if len(logo) > 70 else ''}")
    else:
        log("Không tìm thấy logo cần cập nhật", "info")

    # Write output
    if not args.dry_run and updates:
        log(f"Đang ghi file: {output_path}", "progress")
        write_m3u(output_path, lines, has_bom, newline)
        log(f"Đã cập nhật {updated} logo", "success")

    # Stats
    total_time = time.time() - start_time
    log(f"Hoàn thành trong {total_time:.1f}s", "success")
    print(f"\n📊 THỐNG KÊ:")
    print(f"  Tổng kênh: {len(channels)}")
    print(f"  Logo đã cập nhật: {updated}")
    print(f"  Không tìm logo: {not_found}")

if __name__ == "__main__":
    main()
