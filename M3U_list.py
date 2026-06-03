#!/usr/bin/env python3
"""
M3U Playlist Processor v2.0
Tải, phân loại, kiểm tra health, resolve playlist, tải EPG cho IPTV.

Usage:
    python M3U_list.py                    # Chạy với config mặc định
    python M3U_list.py --no-health        # Tắt kiểm tra link sống
    python M3U_list.py --no-epg           # Tắt tải EPG
    python M3U_list.py --no-health --no-epg  # Chạy nhanh nhất
    python M3U_list.py --help             # Xem hướng dẫn
"""

import requests
import re
import argparse
import json
import gzip
import time
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ==================== CONFIGURATION ====================
SPECIAL_URL = "https://raw.githubusercontent.com/t23-02/bongda/refs/heads/main/bongda.m3u"

VTV_CHANNELS = [
    "VTV1", "VTV2", "VTV3", "VTV4", "VTV5", "VTV6", "VTV7", "VTV8", "VTV9",
    "VTV CẦN THƠ", "VTV5 TÂY NAM BỘ", "VTV5 TÂY NGUYÊN", "VIETNAM TODAY"
]

ENTERTAINMENT_CHANNELS = [
    "AXN", "HBO", "HBO HITS", "HBO FAMILY", "HBO SIGNATURE", "CINEMAX",
    "CINEMA WORLD", "DREAMWORKS", "BOX HITS", "WARNER TV", "FOX FAMILY MOVIES",
    "DISCOVERY CHANNEL", "DISCOVERY ASIA", "NATIONAL GEOGRAPHIC", "ANIMAL PLANET",
    "FASHION TV", "OUTDOOR CHANNEL"
]

SPORTS_INCLUDE_KEYWORDS = [
    'thể thao', 'the thao', 'sport', 'bóng đá', 'bong da',
    'k+', 'k+ sport', 'k+ cine', 'k+ life', 'k+ action',
    'on sports', 'on football', 'on sports news', 'on sports+',
    'vtc3', 'htv thể thao', 'sctv thể thao', 'sctv15',
    'tv360', 'vtvcab', 'truc tiep', 'trực tiếp', 'vebo', 'xoilac'
]

SPORTS_EXCLUDE_KEYWORDS = [
    'sky sports', 'espn', 'tnt', 'fox sports', 'bein sports',
    'movistar', 'astro', 'dazn', 'peacock', 'viaplay', 'bt sport',
    'cricket', 'nhl', 'rugby', 'doku', 'livecam', 'quran', 'music'
]

MOVIE_EXCLUDE_KEYWORDS = [
    'man [', 'man! (', 'woman [', 'wo man [',
]

SPORTS_RENAME_MAP = {
    "Sky Sports Action UK NOW": "Sky Sports Action UK (NOW)",
    "Sky Sports F1 UK NOW": "Sky Sports F1 UK (NOW)",
    "Sky Sports Football UK NOW": "Sky Sports Football UK (NOW)",
    "Sky Sports Golf UK NOW": "Sky Sports Golf UK (NOW)",
    "Sky Sports Main Event UK NOW": "Sky Sports Main Event UK (NOW)",
    "Sky Sports Mix UK NOW": "Sky Sports Mix UK (NOW)",
    "Sky Sports PL UK NOW": "Sky Sports PL UK (NOW)",
    "Sky Sports Racing UK NOW": "Sky Sports Racing UK (NOW)",
    "Sky Sports Tennis UK NOW": "Sky Sports Tennis UK (NOW)",
    "Sky Sports+ UK NOW": "Sky Sports+ UK (NOW)",
    "TNT Sport 1 NOW": "TNT Sport 1 (NOW)",
    "TNT Sport 2 NOW": "TNT Sport 2 (NOW)",
    "TNT Sport 3 NOW": "TNT Sport 3 (NOW)",
    "TNT Sport 4 NOW": "TNT Sport 4 (NOW)",
    ",TSN": "TSN",
    ",SPORTS TV": "SPORTS TV",
    ",FOOTBALL TV": "FOOTBALL TV",
    "ช่อง": " ",
}

VTV_ORDER = {name: i for i, name in enumerate(VTV_CHANNELS)}
ENT_ORDER = {name: i for i, name in enumerate(ENTERTAINMENT_CHANNELS)}

GROUP_ORDER = {
    "Kenh dac biet": 0,
    "Kenh VTV": 1,
    "Kenh Giai Tri": 2,
    "Kenh The Thao": 3,
    "Truc tiep": 4,
    "Hoat hinh": 5,
    "THVL": 6,
    "SCTV": 7,
    "Kenh Quoc Te": 8
}

EPG_SOURCES = [
    "https://hnlive.dramahay.xyz/epg.xml",
    "https://raw.githubusercontent.com/mrprince/epg/refs/heads/main/epg.xml.gz",
]

PLAYLIST_CACHE = {}

# ==================== UTILITY FUNCTIONS ====================

def log(msg, level="info"):
    """Formatted logging with timestamp."""
    icons = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌", "progress": "⏳"}
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {icons.get(level, '•')} {msg}")

def clean_channel_name(name):
    """Remove old group-title, special chars from channel name."""
    name = re.sub(r'group-title="[^"]*"', '', name)
    name = re.sub(r',+', ',', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name

def normalize_channel_name(name):
    """Normalize channel name for matching: remove brackets, diacritics, special chars."""
    name = re.sub(r'\[.*?\]', '', name)
    name = re.sub(r'\(.*?\)', '', name)
    name = re.sub(r'\b(hd|fhd|uhd|4k|sd|channel|tv|ch)\b', '', name, flags=re.IGNORECASE)
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip().lower()
    return name

def build_normalized_set(channel_list):
    return {normalize_channel_name(name) for name in channel_list}

def is_sports_channel(name_lower):
    has_include = any(inc in name_lower for inc in SPORTS_INCLUDE_KEYWORDS)
    has_exclude = any(ex in name_lower for ex in SPORTS_EXCLUDE_KEYWORDS)
    return has_include and not has_exclude

def is_movie_excluded(name_lower):
    return any(ex in name_lower for ex in MOVIE_EXCLUDE_KEYWORDS)

def is_low_resolution(resolution):
    if not resolution:
        return False
    resolution = resolution.lower()
    if 'sd' in resolution:
        return True
    for pattern in [r'360p', r'480p', r'576p', r'360', r'480', r'576', r'low']:
        if re.search(pattern, resolution):
            return True
    numbers = re.findall(r'\d+', resolution)
    for num in numbers:
        if int(num) < 720:
            return True
    return False

def classify_channel(ch_name, ch_name_lower, normalized_name, vtv_set, ent_set):
    if is_sports_channel(ch_name_lower):
        return "Kenh The Thao"
    elif normalized_name in vtv_set:
        return "Kenh VTV"
    elif normalized_name in ent_set:
        return "Kenh Giai Tri"
    return None

def sort_key(ch, group):
    name_norm = normalize_channel_name(ch['name'])
    if group == "Kênh VTV":
        for orig in VTV_CHANNELS:
            if normalize_channel_name(orig) == name_norm:
                return VTV_ORDER[orig]
        return len(VTV_CHANNELS)
    elif group == "Giải Trí":
        for orig in ENTERTAINMENT_CHANNELS:
            if normalize_channel_name(orig) == name_norm:
                return ENT_ORDER[orig]
        return len(ENTERTAINMENT_CHANNELS)
    else:
        return ch['name'].lower()

# ==================== NETWORK FUNCTIONS ====================

def resolve_m3u8_url(url, max_depth=2, session=None):
    if max_depth <= 0:
        return url
    if url in PLAYLIST_CACHE:
        return PLAYLIST_CACHE[url]
    if not url.lower().endswith(('.m3u8', '.m3u')):
        return url
    try:
        if session is None:
            session = requests.Session()
        headers = {'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18'}
        resp = session.get(url, headers=headers, timeout=8)
        if resp.status_code != 200:
            return url
        content = resp.text
        if '#EXTM3U' not in content:
            return url
        lines = content.splitlines()
        best_url = None
        best_bandwidth = -1
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith('#EXT-X-STREAM-INF'):
                bw_match = re.search(r'BANDWIDTH=(\d+)', line)
                bandwidth = int(bw_match.group(1)) if bw_match else 0
                if i + 1 < len(lines):
                    stream_url = lines[i + 1].strip()
                    if stream_url and not stream_url.startswith('#'):
                        full_url = urljoin(url, stream_url)
                        if bandwidth > best_bandwidth:
                            best_bandwidth = bandwidth
                            best_url = full_url
                i += 2
            else:
                i += 1
        if best_url:
            resolved = resolve_m3u8_url(best_url, max_depth - 1, session)
            PLAYLIST_CACHE[url] = resolved
            return resolved
        else:
            PLAYLIST_CACHE[url] = url
            return url
    except Exception:
        return url

def check_channel_health(url, timeout=3):
    if url.startswith('udp://'):
        return True
    try:
        headers = {'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18'}
        resp = requests.head(url, headers=headers, timeout=timeout, allow_redirects=True)
        if resp.status_code < 400:
            return True
        if resp.status_code in (403, 452, 456, 405, 400) or resp.status_code >= 500:
            headers_range = headers.copy()
            headers_range['Range'] = 'bytes=0-1'
            resp2 = requests.get(url, headers=headers_range, timeout=timeout, allow_redirects=True)
            if resp2.status_code in (206, 200):
                return True
        return False
    except Exception:
        return False

# ==================== M3U PARSING ====================

def fetch_and_parse_m3u(url):
    try:
        if url.startswith('http://') or url.startswith('https://'):
            response = requests.get(url, timeout=10)
            content = response.text
        else:
            with open(url, 'r', encoding='utf-8', errors='ignore') as file:
                content = file.read()
        return parse_m3u(content)
    except Exception as e:
        log(f"Lỗi khi xử lý {url}: {str(e)[:50]}", "error")
        return []

def parse_m3u(content):
    channels = []
    current_ch = {}
    extra_lines = []
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith('#EXTINF'):
            if current_ch and 'name' in current_ch and 'url' in current_ch:
                if extra_lines:
                    current_ch['extra'] = extra_lines
                channels.append(current_ch)
            current_ch = {}
            extra_lines = []
            params = re.findall(r'([a-zA-Z-]+)="([^"]*)"', line)
            current_ch['params'] = {k.lower(): v for k, v in params}
            name_part = line.split(',', 1)
            if len(name_part) > 1:
                current_ch['name'] = unquote(name_part[1].strip())
            else:
                tvg_name = current_ch['params'].get('tvg-name', 'Unknown Channel')
                current_ch['name'] = unquote(tvg_name)
        elif line.startswith('http') or line.startswith('udp://'):
            if current_ch and 'name' in current_ch:
                current_ch['url'] = line
                if extra_lines:
                    current_ch['extra'] = extra_lines
                channels.append(current_ch)
                current_ch = {}
                extra_lines = []
        elif line.startswith('#'):
            extra_lines.append(line)
    if current_ch and 'name' in current_ch and 'url' in current_ch:
        if extra_lines:
            current_ch['extra'] = extra_lines
        channels.append(current_ch)
    return channels

# ==================== EPG ====================

def get_epg_mapping(epg_url):
    mapping = {}
    try:
        response = requests.get(epg_url, timeout=5)
        if epg_url.endswith('.gz'):
            content = gzip.decompress(response.content)
            root = ET.fromstring(content)
        else:
            root = ET.fromstring(response.content)
        for channel in root.findall('.//channel'):
            tvg_id = channel.get('id')
            display_name = channel.find('display-name')
            if display_name is not None and display_name.text:
                display_name_text = display_name.text.strip()
                normalized = re.sub(r'\W+', '', display_name_text.lower())
                if tvg_id and normalized:
                    mapping[normalized] = tvg_id
    except Exception as e:
        if "not well-formed" not in str(e) and "syntax error" not in str(e):
            log(f"Lỗi EPG {epg_url}: {str(e)[:50]}", "warn")
    return mapping

# ==================== CHANNEL PROCESSING ====================

def process_channel(ch, vtv_set, ent_set, epg_mapping, enable_epg):
    if 'name' not in ch:
        return None
    ch['name'] = clean_channel_name(ch['name'])
    ch_name = ch['name']
    ch_name_lower = ch_name.lower()

    if is_movie_excluded(ch_name_lower):
        return None

    res_match = re.search(r'(\d{3,4}[pP]|\d+K|HD|SD|FHD|UHD)', ch_name_lower)
    resolution = res_match.group(0).upper() if res_match else ""
    if is_low_resolution(resolution):
        return None

    normalized_name = normalize_channel_name(ch_name)
    group = classify_channel(ch_name, ch_name_lower, normalized_name, vtv_set, ent_set)
    if not group:
        return None

    ch['group'] = group
    if enable_epg:
        normalized_for_epg = re.sub(r'\W+', '', ch_name_lower)
        ch['tvg-id'] = epg_mapping.get(normalized_for_epg, ch['params'].get('tvg-id', ''))
    else:
        ch['tvg-id'] = ''
    ch['resolution'] = resolution
    return ch

def final_check_and_resolve(ch, check_health):
    url = ch['url']
    if url.startswith('udp://'):
        return ch
    if 'github' in url.lower() and url.lower().endswith(('.m3u8', '.m3u')):
        resolved = resolve_m3u8_url(url)
        if resolved != url:
            ch['url'] = resolved
    if check_health:
        if check_channel_health(ch['url']):
            return ch
        else:
            return None
    else:
        return ch

def get_m3u_links():
    with open('M3U_list.txt', 'r', encoding='utf-8', errors='ignore') as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
    links = [line for line in lines if not line.startswith('#')]
    if "Sports_Playlist.m3u" not in links:
        links.append("Sports_Playlist.m3u")
    return links

def load_existing_m3u_urls(file_path):
    """Load URLs from existing M3U file to avoid duplicates."""
    existing_urls = set()
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line.startswith('http') or line.startswith('udp://'):
                    existing_urls.add(line)
    except FileNotFoundError:
        pass
    return existing_urls

# ==================== MAIN ====================

def main():
    parser = argparse.ArgumentParser(description='M3U Playlist Processor - Tải và phân loại kênh IPTV')
    parser.add_argument('--no-health', action='store_true', help='Tắt kiểm tra link sống (chạy nhanh)')
    parser.add_argument('--no-epg', action='store_true', help='Tắt tải EPG (chạy nhanh)')
    parser.add_argument('--output', default='output.m3u', help='Tên file output (default: output.m3u)')
    parser.add_argument('--workers', type=int, default=20, help='Số worker threads (default: 20)')
    parser.add_argument('--health-timeout', type=int, default=3, help='Timeout kiểm tra health (giây, default: 3)')
    args = parser.parse_args()

    check_health = not args.no_health
    enable_epg = not args.no_epg

    start_time = time.time()
    log(f"Chế độ Health Check: {'BẬT' if check_health else 'TẮT'}", "info")
    log(f"Chế độ EPG: {'BẬT' if enable_epg else 'TẮT'}", "info")

    vtv_set = build_normalized_set(VTV_CHANNELS)
    ent_set = build_normalized_set(ENTERTAINMENT_CHANNELS)
    m3u_links = get_m3u_links()

    # Tải EPG song song
    epg_mapping = {}
    if enable_epg:
        log("Đang tải EPG...", "progress")
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(get_epg_mapping, url) for url in EPG_SOURCES]
            for future in as_completed(futures):
                epg_mapping.update(future.result())
        log(f"Đã tải {len(epg_mapping)} mappings EPG", "success")

    all_channels = []

    # Xử lý link đặc biệt (Trực tiếp)
    log(f"Đang tải link đặc biệt: {SPECIAL_URL}", "progress")
    try:
        response = requests.get(SPECIAL_URL, timeout=10)
        channels = parse_m3u(response.text)
        for ch in channels:
            if 'name' not in ch:
                continue
            ch_name = ch['name']
            ch_name_lower = ch_name.lower()
            if 'highlight' in ch_name_lower or 'xem lại' in ch_name_lower:
                continue
            res_match = re.search(r'(\d{3,4}[pP]|\d+K|HD|SD|FHD|UHD)', ch_name_lower)
            resolution = res_match.group(0).upper() if res_match else ""
            if is_low_resolution(resolution):
                continue
            ch['group'] = "Trực tiếp"
            if enable_epg:
                normalized_name = re.sub(r'\W+', '', ch_name_lower)
                ch['tvg-id'] = epg_mapping.get(normalized_name, ch['params'].get('tvg-id', ''))
            else:
                ch['tvg-id'] = ''
            ch['resolution'] = resolution
            all_channels.append(ch)
        log(f"Đã tải {len(channels)} kênh trực tiếp", "success")
    except Exception as e:
        log(f"Lỗi xử lý link đặc biệt: {e}", "error")

    # Xử lý các link M3U còn lại song song
    log(f"Đang tải {len(m3u_links)} M3U playlists...", "progress")
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(fetch_and_parse_m3u, url) for url in m3u_links if url != SPECIAL_URL]
        for future in as_completed(futures):
            all_channels.extend(future.result())
    log(f"Đã tải tổng cộng {len(all_channels)} kênh", "success")

    # Lọc kênh
    log("Đang lọc kênh theo tên và độ phân giải...", "progress")
    filtered_channels = []
    for ch in all_channels:
        processed = process_channel(ch, vtv_set, ent_set, epg_mapping, enable_epg)
        if processed:
            filtered_channels.append(processed)

    # Loại bỏ trùng URL
    log("Đang loại bỏ kênh trùng lặp...", "progress")
    unique_urls = set()
    unique_channels = []
    for ch in filtered_channels:
        if ch['url'] not in unique_urls:
            unique_urls.add(ch['url'])
            unique_channels.append(ch)

    # Kiểm tra kênh sống và resolve playlist
    log(f"Đang xử lý {len(unique_channels)} kênh...", "progress")
    valid_channels = []
    with ThreadPoolExecutor(max_workers=100) as executor:
        future_to_ch = {executor.submit(final_check_and_resolve, ch, check_health): ch for ch in unique_channels}
        for future in as_completed(future_to_ch):
            result = future.result()
            if result:
                valid_channels.append(result)

    # Đổi tên kênh thể thao
    for ch in valid_channels:
        if ch['group'] == "Thể Thao":
            old_name = ch['name'].strip()
            if old_name in SPORTS_RENAME_MAP:
                ch['name'] = SPORTS_RENAME_MAP[old_name]

    # Nhóm và sắp xếp
    grouped = {}
    for ch in valid_channels:
        if ch['group'] not in GROUP_ORDER:
            continue
        grouped.setdefault(ch['group'], []).append(ch)

    for group in grouped:
        if group in ("Kênh VTV", "Giải Trí"):
            grouped[group].sort(key=lambda x: sort_key(x, group))
        else:
            grouped[group].sort(key=lambda x: x['name'].lower())

    sorted_groups = sorted(grouped.items(), key=lambda x: GROUP_ORDER.get(x[0], 99))

    # Ghi file output
    output_path = args.output
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('#EXTM3U\n')
        for group_name, channels in sorted_groups:
            for ch in channels:
                tvg_id = ch.get('tvg-id', '')
                tvg_logo = ch['params'].get('tvg-logo', '')
                resolution = ch.get('resolution', '')
                name_display = f"{ch['name']} - {resolution}" if resolution else ch['name']

                extinf = f'#EXTINF:-1 tvg-id="{tvg_id}" group-title="{group_name}"'
                if tvg_logo:
                    extinf += f' tvg-logo="{tvg_logo}"'
                extinf += f',{name_display}'
                f.write(extinf + '\n')

                if 'extra' in ch:
                    for extra_line in ch['extra']:
                        if not extra_line.startswith('#EXTINF'):
                            f.write(extra_line + '\n')
                f.write(ch['url'] + '\n')

    # Thống kê
    total_time = time.time() - start_time
    log("=" * 50, "info")
    log(f"Hoàn thành trong {total_time:.1f}s", "success")
    log(f"File output: {output_path}", "info")
    stats = "\n".join([f"  {group}: {len(channels)} kênh" for group, channels in sorted_groups])
    print(f"\n📊 THỐNG KÊ:\n{stats}")
    print(f"\n📺 Tổng kênh hợp lệ: {len(valid_channels)}")
    print(f"🔄 Kênh trùng đã loại: {len(filtered_channels) - len(unique_channels)}")

if __name__ == "__main__":
    main()