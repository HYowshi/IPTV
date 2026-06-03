#!/usr/bin/env python3
"""
VTV Playlist Sorter v2.0
Sắp xếp, loại trùng, kiểm tra resolution cho playlist M3U.

Usage:
    python VTV_sort.py                       # Chạy mặc định
    python VTV_sort.py --input output.m3u    # Chỉ định input
    python VTV_sort.py --check-resolution    # Kiểm tra resolution bằng ffmpeg
    python VTV_sort.py --help                # Xem hướng dẫn
"""

import requests
import re
import argparse
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

def log(msg, level="info"):
    """Formatted logging with timestamp."""
    icons = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌", "progress": "⏳"}
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {icons.get(level, '•')} {msg}")

def is_channel_working(url, timeout=20):
    """Check if a channel URL is reachable."""
    try:
        response = requests.head(url, timeout=timeout, allow_redirects=True)
        return response.status_code >= 0
    except requests.RequestException:
        return False

def get_video_resolution(url, timeout=90):
    """Get video resolution using ffmpeg."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-i', url, '-hide_banner'],
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            timeout=timeout
        )
        output = result.stderr.decode('utf-8')
        match = re.search(r'Stream.*Video.* (\d{2,5})x(\d{2,5})', output)
        if match:
            width, height = map(int, match.groups())
            if width >= 2560 or height >= 1440:
                return "4K"
            elif width >= 1920 or height >= 1080:
                return "FHD"
            elif width >= 1280 or height >= 720:
                return "HD"
            else:
                return "SD"
    except subprocess.TimeoutExpired:
        return None
    except Exception:
        return None

def clean_name(name):
    """Remove invalid characters from channel/group name."""
    allowed_chars = re.compile(r'[^a-zA-Z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\u0E00-\u0E7F\u0400-\u04FF ;]+')
    return allowed_chars.sub('', name).strip()

def format_group_title(line):
    """Clean group-title in EXTINF line."""
    match = re.search(r'group-title="([^"]+)"', line)
    if match:
        group_title = match.group(1)
        group_title = re.sub(r'\s+', ' ', group_title)
        group_title = clean_name(group_title)
        line = line.replace(match.group(1), group_title)
    return line

def format_channel_name(line):
    """Clean channel name in EXTINF line."""
    match = re.search(r'#EXTINF[^,]*,(.*)', line)
    if match:
        channel_name = clean_name(match.group(1))
        line = line.replace(match.group(1), channel_name)
    return line

def parse_playlist(file_path):
    """Parse M3U file into list of entries (EXTINF + URL)."""
    with open(file_path, 'r', encoding='utf-8') as file:
        lines = file.readlines()

    entries = []
    entry = []
    for line in lines:
        if line.startswith('#EXTINF'):
            line = format_group_title(line)
            line = format_channel_name(line)
            if entry:
                entries.append(entry)
            entry = [line]
        elif line.strip():
            entry.append(line)

    if entry:
        entries.append(entry)

    return entries

def remove_duplicates(entries):
    """Remove entries with duplicate URLs."""
    unique_entries = []
    seen_urls = set()
    for entry in entries:
        url = entry[-1].strip()
        if url not in seen_urls:
            seen_urls.add(url)
            unique_entries.append(entry)
    return unique_entries

def sort_entries(entries):
    """Sort entries alphabetically by channel name."""
    def sort_key(entry):
        channel_name = entry[0].split(',')[-1].strip()
        url = entry[-1].strip()
        return (channel_name, url)
    return sorted(entries, key=sort_key)

def check_url(url):
    return url, is_channel_working(url)

def check_resolution(url):
    return url, get_video_resolution(url)

def check_and_filter_entries(entries, workers=100):
    """Check URL health and resolution for all entries."""
    urls = [entry[-1].strip() for entry in entries]
    resolution_dict = {}

    log(f"Kiểm tra {len(urls)} kênh...", "progress")
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(check_url, urls))

    valid_entries = [entry for entry, (url, is_valid) in zip(entries, results) if is_valid]
    valid_urls = [entry[-1].strip() for entry in valid_entries]
    log(f"Hợp lệ: {len(valid_entries)}/{len(entries)} kênh", "success")

    log("Kiểm tra resolution...", "progress")
    with ThreadPoolExecutor(max_workers=40) as executor:
        future_to_url = {executor.submit(check_resolution, url): url for url in valid_urls}
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                _, resolution = future.result()
                if resolution:
                    resolution_dict[url] = resolution
            except Exception:
                resolution_dict[url] = None

    # Append resolution to channel name
    for entry in valid_entries:
        url = entry[-1].strip()
        if url in resolution_dict and resolution_dict[url]:
            resolution = resolution_dict[url]
            channel_name_match = re.search(r'#EXTINF[^,]*,(.*)', entry[0])
            if channel_name_match:
                channel_name = channel_name_match.group(1)
                new_channel_name = f"{channel_name} ({resolution})"
                entry[0] = entry[0].replace(channel_name, new_channel_name)

    return valid_entries

def write_playlist(file_path, entries):
    """Write sorted entries to M3U file."""
    with open(file_path, 'w', encoding='utf-8') as file:
        file.write('#EXTM3U\n')
        for entry in entries:
            for line in entry:
                file.write(line)
            file.write('\n')

def main():
    parser = argparse.ArgumentParser(description='VTV Playlist Sorter - Sắp xếp và kiểm tra playlist M3U')
    parser.add_argument('--input', default='output.m3u', help='File input (default: output.m3u)')
    parser.add_argument('--output', default='Vietnam_HBO_Final.m3u', help='File output (default: Vietnam_HBO_Final.m3u)')
    parser.add_argument('--check-resolution', action='store_true', help='Kiểm tra resolution bằng ffmpeg')
    parser.add_argument('--check-health', action='store_true', help='Kiểm tra link sống')
    parser.add_argument('--workers', type=int, default=100, help='Số worker threads (default: 100)')
    args = parser.parse_args()

    start_time = time.time()
    input_path = args.input
    output_path = args.output

    log(f"Input: {input_path}", "info")
    log(f"Output: {output_path}", "info")

    # Parse
    log("Đang parse playlist...", "progress")
    entries = parse_playlist(input_path)
    log(f"Đã parse {len(entries)} entries", "success")

    # Remove duplicates
    log("Đang loại trùng...", "progress")
    unique_entries = remove_duplicates(entries)
    removed = len(entries) - len(unique_entries)
    log(f"Đã loại {removed} entry trùng", "success")

    # Sort
    log("Đang sắp xếp...", "progress")
    sorted_entries = sort_entries(unique_entries)
    log(f"Đã sắp xếp {len(sorted_entries)} entries", "success")

    # Check health and resolution (optional)
    if args.check_health or args.check_resolution:
        sorted_entries = check_and_filter_entries(sorted_entries, args.workers)

    # Write output
    log(f"Đang ghi file: {output_path}", "progress")
    write_playlist(output_path, sorted_entries)

    total_time = time.time() - start_time
    log(f"Hoàn thành trong {total_time:.1f}s", "success")
    log(f"File output: {output_path}", "info")
    print(f"\n📊 THỐNG KÊ:")
    print(f"  Entries ban đầu: {len(entries)}")
    print(f"  Entries trùng: {removed}")
    print(f"  Entries hợp lệ: {len(sorted_entries)}")

if __name__ == '__main__':
    main()