#!/usr/bin/env python3
"""Replace broken IPTV_Master streams with working duplicates from another M3U."""

import argparse
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
import urllib.request
import urllib.error
import ssl

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ATTRIBUTE_RE = re.compile(r'([\w-]+)="([^"]*)"')
QUALITY_RE = re.compile(
    r'\b(?:4k|uhd|fhd|hd|sd|\d{3,4}[pi]|\d+mbps|geo.?blocked|drm|live)\b',
    re.IGNORECASE,
)


def log(message):
    print(f'[{time.strftime("%H:%M:%S")}] {message}', flush=True)


def normalize_name(name):
    value = (name or '').replace('Đ', 'D').replace('đ', 'd')
    value = unicodedata.normalize('NFKD', value)
    value = value.encode('ascii', 'ignore').decode().lower()
    value = re.sub(r'\([^)]*\)|\[[^]]*\]', ' ', value)
    value = QUALITY_RE.sub(' ', value)
    value = re.sub(r'[^a-z0-9]+', ' ', value)
    return ' '.join(value.split())


def normalize_tvg_id(value):
    value = (value or '').strip().lower().split('@', 1)[0]
    return value.removesuffix('.vn')


def read_playlist(path):
    raw = open(path, 'rb').read()
    has_bom = raw.startswith(b'\xef\xbb\xbf')
    newline = '\r\n' if b'\r\n' in raw else '\n'
    lines = raw.decode('utf-8-sig', errors='replace').splitlines()
    return lines, has_bom, newline


def read_playlist_url(url):
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    )
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=10, context=context) as response:
        raw = response.read()
        has_bom = raw.startswith(b'\xef\xbb\xbf')
        newline = '\r\n' if b'\r\n' in raw else '\n'
        lines = raw.decode('utf-8-sig', errors='replace').splitlines()
        return lines, has_bom, newline


def parse_playlist(lines):
    channels = []
    current = None
    for index, original in enumerate(lines):
        line = original.strip()
        if line.startswith('#EXTINF:'):
            attributes = dict(ATTRIBUTE_RE.findall(line))
            current = {
                'line_index': index,
                'name': line.rsplit(',', 1)[-1].strip() if ',' in line else '',
                'tvg_id': attributes.get('tvg-id', ''),
                'url': '',
                'url_index': None,
                'kodi_props': [],
                'prop_indices': []
            }
        elif current and line.startswith('#KODIPROP:'):
            current['kodi_props'].append(original)
            current['prop_indices'].append(index)
        elif current and line and not line.startswith('#'):
            current['url'] = line
            current['url_index'] = index
            current['normalized_name'] = normalize_name(current['name'])
            current['normalized_tvg_id'] = normalize_tvg_id(current['tvg_id'])
            channels.append(current)
            current = None
    return channels


def check_stream(url, timeout):
    if not url.lower().startswith(('http://', 'https://')):
        return False, 'unsupported'
    if 'youtube.com/' in url or 'youtu.be/' in url:
        return True, 'youtube'

    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Range': 'bytes=0-4095',
                'Accept': '*/*'
            }
        )
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=context) as response:
            status = response.status
            content_type = response.headers.get('Content-Type', '').lower()
            chunk = response.read(4096)
            lower = chunk[:1024].lower()
            if status not in (200, 206):
                return False, f'http_{status}'
            if not chunk:
                return False, 'empty'
            if content_type.startswith('image/'):
                return False, 'image'
            if b'<html' in lower and b'mpegurl' not in content_type.encode():
                return False, 'html'
            if b'signal_low' in lower:
                return False, 'signal_low'
            return True, f'http_{status}'
    except urllib.error.HTTPError as exc:
        return False, f'http_{exc.code}'
    except Exception as exc:
        return False, type(exc).__name__


def candidate_score(master, candidate):
    name_score = SequenceMatcher(
        None, master['normalized_name'], candidate['normalized_name']
    ).ratio()
    exact_name = bool(
        master['normalized_name']
        and master['normalized_name'] == candidate['normalized_name']
    )
    id_match = bool(
        master['normalized_tvg_id']
        and master['normalized_tvg_id'] == candidate['normalized_tvg_id']
    )
    shared = set(master['normalized_name'].split()) & set(candidate['normalized_name'].split())
    fuzzy_name = name_score >= 0.90 and any(len(token) >= 3 for token in shared)
    if not (exact_name or fuzzy_name or (id_match and name_score >= 0.70)):
        return None
    return (2 if id_match else 0) + (2 if exact_name else 0) + name_score


def build_candidates(master_channels, source_channels):
    candidates = {}
    for master in master_channels:
        matches = []
        for source in source_channels:
            score = candidate_score(master, source)
            if score is not None and source['url'] != master['url']:
                matches.append((score, source))
        if matches:
            matches.sort(key=lambda item: item[0], reverse=True)
            candidates[master['line_index']] = [item[1] for item in matches]
    return candidates


def write_playlist(path, lines, has_bom, newline):
    encoding = 'utf-8-sig' if has_bom else 'utf-8'
    with open(path, 'w', encoding=encoding, newline='') as handle:
        handle.write(newline.join(lines) + newline)


def main():
    parser = argparse.ArgumentParser(description='Sync broken IPTV_Master streams')
    parser.add_argument('--master', default='IPTV_Master.m3u')
    parser.add_argument('--source', default='Vietnam_HBO_Final.m3u')
    parser.add_argument('--vip-source', default='https://raw.githubusercontent.com/hoiquanclick/hoiquan/main/vip.m3u')
    parser.add_argument('--workers', type=int, default=32)
    parser.add_argument('--timeout', type=float, default=5)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    master_lines, has_bom, newline = read_playlist(args.master)
    source_lines, _, _ = read_playlist(args.source)
    masters = parse_playlist(master_lines)
    sources = parse_playlist(source_lines)
    
    if args.vip_source:
        try:
            vip_lines, _, _ = read_playlist_url(args.vip_source)
            vip_sources = parse_playlist(vip_lines)
            sources.extend(vip_sources)
            log(f'Loaded {len(vip_sources)} channels from VIP source')
        except Exception as e:
            log(f'Failed to load VIP source: {e}')

    candidates = build_candidates(masters, sources)
    log(f'Found duplicate candidates for {len(candidates)}/{len(masters)} master channels')

    urls = {channel['url'] for channel in masters}
    urls.update(
        candidate['url']
        for matches in candidates.values()
        for candidate in matches
    )
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        results = executor.map(lambda url: check_stream(url, args.timeout), sorted(urls))
        health = dict(zip(sorted(urls), results))

    replacements = []
    for master in masters:
        master_ok, master_reason = health.get(master['url'], (False, 'not_checked'))
        if master_ok:
            continue
        for candidate in candidates.get(master['line_index'], []):
            candidate_ok, _ = health.get(candidate['url'], (False, 'not_checked'))
            # Trust candidates with DRM/KODIPROP since simple GET fails on them (e.g. 403 Forbidden)
            if candidate_ok or bool(candidate['kodi_props']):
                replacements.append((master, candidate, master_reason))
                break

    for master, candidate, reason in replacements:
        log(f'Replace {master["name"]} ({reason}) -> {candidate["name"]}')
        if not args.dry_run:
            # Mark old KODIPROP lines for deletion safely
            for idx in master['prop_indices']:
                master_lines[idx] = None
            
            # Form the new block with candidate's KODIPROP and URL
            new_block = candidate['kodi_props'] + [candidate['url']]
            master_lines[master['url_index']] = newline.join(new_block)

    if replacements and not args.dry_run:
        # Filter out marked None lines
        master_lines = [line for line in master_lines if line is not None]
        write_playlist(args.master, master_lines, has_bom, newline)

    log(f'Updated {len(replacements)} stream(s)')


if __name__ == '__main__':
    main()
