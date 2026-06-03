<div align="center">

<img src="logo.png" width="120" height="120" alt="Phim.tv Logo">

# Phim.tv

### Giải Trí Đa Phương Tiện

[![Build All Platforms](https://github.com/HYowshi/IPTV/actions/workflows/build.yml/badge.svg)](https://github.com/HYowshi/IPTV/actions/workflows/build.yml)
[![Build APK & EXE](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml/badge.svg)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
[![Version](https://img.shields.io/badge/version-1.1.0-blue)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20Linux%20%7C%20macOS-green)]()
[![License](https://img.shields.io/badge/license-MIT-yellow)]()

Ứng dụng xem phim trực tuyến và truyền hình IPTV với chất lượng cao, giao diện đẹp mắt.

[![Download Windows](https://img.shields.io/badge/Download-Windows_EXE-blue?logo=windows&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
[![Download Android](https://img.shields.io/badge/Download-Android_APK-green?logo=android&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)

</div>

---

## Tính Năng Nổi Bật

### Phim Ảnh
- Kho phim từ ophim API - cập nhật liên tục
- Xem phim chất lượng cao (HD/FHD/4K)
- Tìm kiếm, lọc theo thể loại/quốc gia/năm
- Xem nhóm (Watch Party) qua PeerJS
- Tự động phát tập tiếp theo
- Picture-in-Picture, fullscreen
- Lưu lịch sử xem, yêu thích

### Truyền Hình
- 240+ kênh TV Việt Nam
- Hỗ trợ HLS, DASH, YouTube
- EPG (lịch phát sóng) thực tế
- Tìm kiếm kênh, yêu thích
- DRM support (ClearKey, Widevine, PlayReady)

### Giao Diện
- Theme tối (dark mode) hiện đại
- Responsive: Desktop, Tablet, Mobile, Fold
- Hiệu ứng animation mượt mà
- Easter eggs theo mùa (hoa anh đào, đom đóm, lá rơi, tuyết)
- Window controls tùy chỉnh (Tauri desktop)

---

## Cài Đặt

### Windows
1. Tải file `.exe` từ [Actions](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
2. Chạy installer → chọn thư mục → hoàn tất
3. App sẽ tự động kiểm tra WebView2 Runtime

### Android
1. Tải file `.apk` từ [Actions](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
2. Cài đặt APK (cho phép nguồn không xác định)
3. Yêu cầu Android 7.0+ (API 24)

### Build từ Source
```bash
# Clone repo
git clone https://github.com/HYowshi/IPTV.git
cd IPTV

# Install dependencies
npm install

# Run development
npm run tauri dev

# Build for production
npm run tauri build

# Build Android
npm run tauri android init
npm run tauri android build
```

---

## Cấu Trúc Dự ÁN

```
phimtvapp/
├── src/                          # Frontend
│   ├── index.html                # Trang chủ (chọn dịch vụ)
│   ├── style.css                 # CSS trang chủ
│   ├── script.js                 # JS trang chủ
│   ├── platform.js               # Platform detection
│   ├── cache.js                  # Cache system
│   ├── performance.js            # Performance utilities
│   ├── mobile.css                # Mobile fullscreen styles
│   ├── truyenhinh/               # Module Truyền hình
│   │   ├── truyenhinh.html
│   │   ├── css/                  # 7 CSS files
│   │   └── js/                   # 7 JS files
│   └── phim/                     # Module Phim ảnh
│       ├── phim.html
│       ├── css/                  # 8 CSS files
│       └── js/                   # 7 JS files
├── src-tauri/                    # Tauri Backend (Rust)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   └── lib.rs                # Commands + CORS Proxy
│   ├── tauri.conf.json           # Tauri config
│   ├── nsis/                     # NSIS installer
│   │   ├── installer.nsh
│   │   ├── clean_uninstall.nsh
│   │   └── *.bmp                 # Installer images
│   └── icons/                    # App icons (all platforms)
├── .github/workflows/            # CI/CD
│   ├── build.yml                 # Desktop + Android
│   └── build-app.yml             # APK + EXE manual
├── M3U_list.py                   # M3U playlist processor
├── VTV_sort.py                   # Playlist sorter
├── Xtreamlist2M3u.py             # Xtream API converter
├── generate-icons.py             # Icon generator
└── package.json
```

---

## Công Nghệ Sử Dụng

| Component | Technology |
|-----------|-----------|
| **Framework** | Tauri v2 (Rust backend) |
| **Frontend** | Vanilla HTML/CSS/JS |
| **Video Player** | HLS.js, dash.js |
| **Font** | Google Fonts Inter |
| **Icons** | Material Symbols Rounded |
| **P2P** | PeerJS (Watch Party) |
| **HTTP Plugin** | @tauri-apps/plugin-http |
| **Store** | @tauri-apps/plugin-store |
| **CI/CD** | GitHub Actions |
| **Installer** | NSIS (Windows) |

---

## API Sources

| Service | URL |
|---------|-----|
| Phim API | ophim1.com |
| IPTV Sources | GitHub (HYowshi/IPTV) |
| EPG | Multiple XML sources |
| Images | img.ophim.live, phimimg.com, image.tmdb.org |

---

## Python Utilities

| Script | Chức năng |
|--------|----------|
| `M3U_list.py` | Xử lý M3U playlists: tải, phân loại, kiểm tra health, resolve, EPG |
| `VTV_sort.py` | Sắp xếp playlist, loại trùng, kiểm tra resolution |
| `Xtreamlist2M3u.py` | Chuyển đổi Xtream API sang M3U format |
| `generate-icons.py` | Tạo tất cả icons từ logo.png cho mọi platform |

### Sử dụng
```bash
# Cài dependencies
pip install requests tqdm aiohttp Pillow

# Chạy M3U processor
python M3U_list.py

# Chạy Xtream converter
python Xtreamlist2M3u.py

# Generate icons
python generate-icons.py
```

---

## GitHub Actions

### Tự động build khi push tag `v*`:
```bash
git tag v1.1.0
git push origin v1.1.0
```

### Manual trigger:
Vào **Actions** → chọn workflow → **Run workflow**

### Download artifacts:
Vào **Actions** → chọn workflow run → **Artifacts** → tải về

---

## Đóng Góp

1. Fork repo
2. Tạo branch mới: `git checkout -b feature/ten-feature`
3. Commit: `git commit -m "feat: them feature moi"`
4. Push: `git push origin feature/ten-feature`
5. Tạo Pull Request

---

## License

MIT License - xem file LICENSE để biết thêm chi tiết.

---

<div align="center">

**Phim.tv** © 2026 PhimTV Admin

Made with ❤️ in Vietnam

</div>