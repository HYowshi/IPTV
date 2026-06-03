#!/usr/bin/env python3
"""
Xtream API to M3U Converter v2.0
Kết nối Xtream IPTV API, lấy danh sách kênh, xuất M3U playlist.

Usage:
    python Xtreamlist2M3u.py                    # Chạy mặc định
    python Xtreamlist2M3u.py --all              # Lấy tất cả kênh (không chỉ thể thao)
    python Xtreamlist2M3u.py --output my.m3u    # Chỉ định file output
    python Xtreamlist2M3u.py --help             # Xem hướng dẫn
"""

import sys
import asyncio
import argparse
import aiohttp
from urllib.parse import urlparse, parse_qs
import json
import platform

# Windows event loop policy
if platform.system() == "Windows":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

def log(msg, level="info"):
    """Formatted logging."""
    icons = {"info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌", "progress": "⏳"}
    print(f"{icons.get(level, '•')} {msg}")

class XtreamChannelFetcher:
    """Fetch channels from Xtream IPTV API."""

    SPORTS_KEYWORDS = [
        "Sport", "Sports", "Football", "Soccer", "Live", "Racing", "Golf",
        "VTV", "K+", "HBO", "Cinemax", "AXN", "Discovery", "National Geographic",
        "Animal Planet"
    ]

    def __init__(self, provider_name, host, username, password, port=80, fetch_all=False):
        self.provider_name = provider_name
        self.host = host.replace('http://', '').replace('https://', '').split('/')[0]
        self.username = username
        self.password = password
        self.port = port
        self.fetch_all = fetch_all
        self.base_api_url = f"http://{self.host}:{self.port}/player_api.php"
        self.headers = {
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 14; 22101320G Build/UKQ1.231003.002)",
            "Accept": "*/*"
        }

    async def _fetch_json(self, session, params):
        """Fetch JSON from Xtream API."""
        try:
            async with session.get(self.base_api_url, params=params, headers=self.headers, timeout=15) as response:
                response.raise_for_status()
                return await response.json()
        except (aiohttp.ClientError, json.JSONDecodeError, asyncio.TimeoutError) as e:
            log(f"[{self.provider_name}] Lỗi fetch: {e}", "error")
            return None

    def _should_include(self, channel_name, category_name):
        """Check if channel should be included (sports or all)."""
        if self.fetch_all:
            return True
        name_lower = channel_name.lower()
        cat_lower = (category_name or '').lower()
        for keyword in self.SPORTS_KEYWORDS:
            if keyword.lower() in name_lower or keyword.lower() in cat_lower:
                return True
        return False

    async def get_channels(self, session):
        """Fetch channels from Xtream API."""
        log(f"[{self.provider_name}] Đang tìm nạp danh sách kênh...", "progress")
        auth_params = {"username": self.username, "password": self.password}

        # Get user info (for EPG URL)
        user_info_data = await self._fetch_json(session, auth_params)
        epg_url = None
        if user_info_data and 'server_info' in user_info_data and user_info_data.get('server_info'):
            epg_url = user_info_data['server_info'].get('url')

        # Get categories
        categories_data = await self._fetch_json(session, {**auth_params, "action": "get_live_categories"})
        if not categories_data:
            log(f"[{self.provider_name}] Không thể lấy danh mục.", "warn")
            return [], None

        category_map = {cat['category_id']: cat['category_name'] for cat in categories_data}

        # Get streams
        streams_data = await self._fetch_json(session, {**auth_params, "action": "get_live_streams"})
        if not streams_data:
            log(f"[{self.provider_name}] Không thể lấy streams.", "warn")
            return [], None

        m3u_entries = []
        for stream in streams_data:
            channel_name = stream.get("name", "")
            category_id = stream.get("category_id")
            category_name = category_map.get(category_id)

            if self._should_include(channel_name, category_name):
                stream_id = stream.get("stream_id")
                logo_url = stream.get("stream_icon", "")
                epg_id = stream.get("epg_channel_id") or channel_name
                group_title = category_name or self.provider_name

                if stream_id and channel_name:
                    stream_url = f"http://{self.host}:{self.port}/live/{self.username}/{self.password}/{stream_id}.ts"
                    m3u_entry = (
                        f'#EXTINF:-1 tvg-id="{epg_id}" tvg-name="{channel_name}" '
                        f'tvg-logo="{logo_url}" group-title="{group_title}",'
                        f'{channel_name}\n{stream_url}'
                    )
                    m3u_entries.append(m3u_entry)

        filter_type = "tất cả" if self.fetch_all else "thể thao"
        log(f"[{self.provider_name}] Tìm thấy {len(m3u_entries)} kênh {filter_type}", "success")
        return m3u_entries, epg_url

def parse_provider_line(line):
    """Parse provider info from a line (URL or CSV format)."""
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    try:
        if line.startswith('http'):
            parsed = urlparse(line)
            host = parsed.hostname
            port = parsed.port or 80
            qs = parse_qs(parsed.query)
            username = qs.get('username', [None])[0]
            password = qs.get('password', [None])[0]
            provider_name = host
            if not all([host, port, username, password]):
                return None
            return (provider_name, host, username, password, port)
        elif ',' in line:
            parts = [p.strip() for p in line.split(',')]
            if len(parts) == 4:
                host, port_str, username, password = parts
                host = host.replace('http://', '').replace('https://', '')
                provider_name = host
                return (provider_name, host, username, password, int(port_str))
    except Exception as e:
        log(f"Lỗi parse dòng: {line} - {e}", "error")
        return None
    return None

async def main():
    parser = argparse.ArgumentParser(description='Xtream API to M3U Converter')
    parser.add_argument('--input', default='Xtream_List.txt', help='File danh sách nhà cung cấp (default: Xtream_List.txt)')
    parser.add_argument('--output', default='Sports_Playlist.m3u', help='File output (default: Sports_Playlist.m3u)')
    parser.add_argument('--all', action='store_true', help='Lấy tất cả kênh (không chỉ thể thao)')
    args = parser.parse_args()

    provider_details = []
    try:
        with open(args.input, "r", encoding="utf-8") as f:
            for line in f:
                parsed_data = parse_provider_line(line)
                if parsed_data:
                    provider_details.append(parsed_data)
    except FileNotFoundError:
        log(f"Không tìm thấy tệp '{args.input}'. Đang tạo mẫu...", "warn")
        with open(args.input, "w", encoding="utf-8") as f_template:
            f_template.write("# Thêm nhà cung cấp Xtream IPTV vào đây\n")
            f_template.write("# Định dạng: http://host:port?username=xxx&password=yyy\n")
            f_template.write("# Hoặc: host,port,username,password\n")
        return

    if not provider_details:
        log(f"File '{args.input}' trống hoặc không hợp lệ.", "warn")
        return

    log(f"Tìm thấy {len(provider_details)} nhà cung cấp", "info")

    all_m3u_entries = []
    all_epg_urls = set()

    async with aiohttp.ClientSession() as session:
        tasks = []
        for name, host, user, pw, port in provider_details:
            fetcher = XtreamChannelFetcher(name, host, user, pw, port, fetch_all=args.all)
            tasks.append(fetcher.get_channels(session))

        results = await asyncio.gather(*tasks)

        for m3u_entries, epg_url in results:
            all_m3u_entries.extend(m3u_entries)
            if epg_url:
                parsed_epg_url = urlparse(epg_url)
                epg_address = f"{parsed_epg_url.scheme}://{parsed_epg_url.netloc}/xmltv.php"
                all_epg_urls.add(epg_address)

    if not all_m3u_entries:
        log("Không tìm thấy kênh nào.", "warn")
        return

    epg_urls_str = ",".join(sorted(list(all_epg_urls)))
    header = f'#EXTM3U x-tvg-url="{epg_urls_str}" x-tvg-shift="+7"\n' if epg_urls_str else '#EXTM3U\n'

    final_m3u_content = header + "\n".join(all_m3u_entries)

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(final_m3u_content)

    filter_type = "tất cả" if args.all else "thể thao"
    log(f"Hoàn thành! Đã lưu {len(all_m3u_entries)} kênh {filter_type} vào '{args.output}'", "success")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("Đã thoát bởi người dùng.", "info")
        sys.exit(0)