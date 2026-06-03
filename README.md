<div align="center">

<!-- Animated Logo Banner -->
<picture>
  <img src="logo.png" width="150" height="150" alt="Phim.tv Logo" style="border-radius: 20px; box-shadow: 0 10px 40px rgba(249,25,66,0.3);">
</picture>

# 🎬 Phim.tv

### Giải Trí Đa Phương Tiện — Xem Phim & Truyền Hình HD

---

[![Build All Platforms](https://img.shields.io/github/actions/workflow/status/HYowshi/IPTV/build.yml?branch=main&label=Build&logo=github&style=for-the-badge&color=blue)](https://github.com/HYowshi/IPTV/actions/workflows/build.yml)
[![Auto Update IPTV](https://img.shields.io/github/actions/workflow/status/HYowshi/IPTV/update_iptv.yml?branch=main&label=IPTV&logo=github&style=for-the-badge&color=green)](https://github.com/HYowshi/IPTV/actions/workflows/update_iptv.yml)
[![Version](https://img.shields.io/badge/Version-1.1.0-blueviolet?style=for-the-badge&logo=verizon)]()
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=open-source-initiative)]()

<br/>

[![Windows](https://img.shields.io/badge/-Windows_10+-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
[![Android](https://img.shields.io/badge/-Android_7.0+-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
[![macOS](https://img.shields.io/badge/-macOS-darkgrey?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build.yml)
[![Linux](https://img.shields.io/badge/-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/HYowshi/IPTV/actions/workflows/build.yml)

<br/>

**Xem phim trực tuyến** và **truyền hình IPTV** với chất lượng cao, giao diện đẹp mắt, mượt mà trên mọi thiết bị.

[![Download Windows EXE](https://img.shields.io/badge/⬇_Download-Windows_EXE-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
[![Download Android APK](https://img.shields.io/badge/⬇_Download-Android_APK-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)

</div>

---

## ✨ Tính Năng Nổi Bật

<table>
<tr>
<td width="50%">

### 🎬 Phim Ảnh
- Kho phim từ **ophim API** — cập nhật liên tục
- Xem phim chất lượng **HD/FHD/4K**
- Tìm kiếm, lọc theo **thể loại/quốc gia/năm**
- **Watch Party** (Xem nhóm) qua PeerJS
- Tự động phát tập tiếp theo
- **Picture-in-Picture**, fullscreen
- Lưu **lịch sử xem**, yêu thích
- **Theater mode** + Lights off

</td>
<td width="50%">

### 📺 Truyền Hình
- **240+ kênh TV** Việt Nam chất lượng cao
- Hỗ trợ **HLS, DASH, YouTube**
- **EPG** (lịch phát sóng) thực tế
- Tìm kiếm kênh, **yêu thích**, gần đây
- **DRM support** (ClearKey, Widevine, PlayReady)
- **Quality selector** tự động
- Picture-in-Picture
- **Spatial navigation** (điều hướng phím)

</td>
</tr>
<tr>
<td width="50%">

### 🎨 Giao Diện
- Theme **tối (dark mode)** hiện đại
- **Responsive**: Desktop, Tablet, Mobile, Fold
- **Font Inter** thống nhất cho tiếng Việt
- Hiệu ứng **animation** mượt mà
- **Easter eggs** theo mùa (hoa anh đào, đom đóm, lá, tuyết)
- **Custom window controls** (Tauri desktop)

</td>
<td width="50%">

### 🛠️ Kỹ Thuật
- **Tauri v2** (Rust backend) — nhẹ, nhanh
- **CORS Proxy** cho streams trên desktop
- **Multi-tier cache** (LRU + Session + Local)
- **NSIS installer** với branding
- **GitHub Actions** CI/CD
- **Python utilities** cho M3U management

</td>
</tr>
</table>

---

## 📦 Cài Đặt

### Windows (EXE Installer)
1. Tải file `.exe` từ [Actions → Build Multi-Platform](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
2. Chạy installer → chọn thư mục → hoàn tất
3. App sẽ tự động kiểm tra **WebView2 Runtime**

### Android (APK)
1. Tải file `.apk` từ [Actions → Build Multi-Platform](https://github.com/HYowshi/IPTV/actions/workflows/build-app.yml)
2. Cài đặt APK (cho phép nguồn không xác định)
3. Yêu cầu **Android 7.0+** (API 24)

### Build từ Source
```bash
git clone https://github.com/HYowshi/IPTV.git
cd IPTV
npm install
npm run tauri dev          # Development
npm run tauri build         # Production (Windows/Linux/macOS)
npx tauri android init      # Android init
npx tauri android build     # Android APK
```

---

## 🏗️ Kiến Trúc Dự Án

```
phimtvapp/
├── src/                           # Frontend (Vanilla HTML/CSS/JS)
│   ├── index.html                 # Trang chủ (chọn dịch vụ)
│   ├── style.css + script.js      # Trang chủ
│   ├── platform.js                # Platform detection (Desktop/Android/iOS/Web)
│   ├── cache.js + performance.js  # Cache system & optimizations
│   ├── mobile.css                 # Fullscreen mobile CSS
│   ├── truyenhinh/                # 📺 Module Truyền hình (7 CSS + 7 JS)
│   └── phim/                      # 🎬 Module Phim ảnh (8 CSS + 7 JS)
│
├── src-tauri/                     # Tauri Backend (Rust)
│   ├── src/
│   │   ├── lib.rs                 # Commands + CORS Proxy (270 lines)
│   │   └── main.rs                # Entry point
│   ├── nsis/                      # NSIS Installer (custom branding)
│   │   ├── installer.nsh          # Smart install hooks
│   │   ├── clean_uninstall.nsh    # 17-step cleanup uninstaller
│   │   └── *.bmp                  # Installer/uninstaller images
│   └── icons/                     # App icons (all platforms)
│
├── .github/workflows/             # CI/CD
│   ├── build.yml                  # Desktop + Android (auto on tag v*)
│   ├── build-app.yml              # APK + EXE (manual trigger)
│   └── update_iptv.yml            # Auto-update playlists (daily)
│
├── M3U_list.py                    # M3U processor (CLI args, EPG, health check)
├── VTV_sort.py                    # Playlist sorter (resolution, dedup)
├── Xtreamlist2M3u.py              # Xtream API → M3U converter (async)
├── ChannelLogoFinder.py           # Auto find & replace TV channel logos
├── generate-icons.py              # Generate all icons from logo.png
└── package.json
```

---

## 🔧 Công Nghệ Sử Dụng

| Layer | Technology |
|-------|-----------|
| **Framework** | Tauri v2 (Rust backend) |
| **Frontend** | Vanilla HTML / CSS / JS |
| **Font** | Google Fonts Inter |
| **Icons** | Material Symbols Rounded |
| **Video** | HLS.js, dash.js |
| **P2P** | PeerJS (Watch Party) |
| **HTTP** | @tauri-apps/plugin-http |
| **Storage** | @tauri-apps/plugin-store |
| **Installer** | NSIS (Windows), APK (Android) |
| **CI/CD** | GitHub Actions |
| **Backend** | Rust (Proxy + Commands) |
| **Scripts** | Python 3.12+ |

---

## 🐍 Python Utilities

| Script | Chức năng | Usage |
|--------|----------|-------|
| `M3U_list.py` | Xử lý M3U: tải, phân loại, health check, EPG | `python M3U_list.py --no-health` |
| `VTV_sort.py` | Sắp xếp playlist, loại trùng, resolution | `python VTV_sort.py --check-resolution` |
| `Xtreamlist2M3u.py` | Xtream API → M3U (async) | `python Xtreamlist2M3u.py --all` |
| `ChannelLogoFinder.py` | Tìm & cập nhật logo kênh TV | `python ChannelLogoFinder.py --validate` |
| `generate-icons.py` | Tạo icons cho mọi platform | `python generate-icons.py` |

---

## 🔄 GitHub Actions

### Build All Platforms
```bash
git tag v1.1.0
git push origin v1.1.0
# → Windows EXE, Linux AppImage, macOS DMG, Android APK
```

### Auto-Update IPTV Playlists (Daily 00:00 GMT+7)
```bash
# Chạy tự động qua GitHub Actions schedule
# Hoặc trigger manual: Actions → Auto Update IPTV → Run workflow
```

### Manual Build APK + EXE
```
Actions → Build Multi-Platform → Run workflow
```

---

## 🎯 API Sources

| Service | URL | Mô tả |
|---------|-----|-------|
| Phim API | `ophim1.com` | Kho phim (miễn phí) |
| IPTV | `github.com/HYowshi/IPTV` | Danh sách kênh M3U |
| EPG | Multiple XML sources | Lịch phát sóng |
| Images | `img.ophim.live`, `phimimg.com`, `image.tmdb.org` | Poster, backdrop |

---

## 🤝 Đóng Góp

1. **Fork** repo
2. Tạo branch: `git checkout -b feature/ten-feature`
3. Commit: `git commit -m "feat: them feature moi"`
4. Push: `git push origin feature/ten-feature`
5. Tạo **Pull Request**

---

## 📄 License

MIT License — xem file `LICENSE` để biết thêm chi tiết.

---

<div align="center">

**Phim.tv** © 2026 PhimTV Admin

Made with ❤️ in Vietnam

![GitHub Stars](https://img.shields.io/github/stars/HYowshi/IPTV?style=social)
![GitHub Forks](https://img.shields.io/github/forks/HYowshi/IPTV?style=social)
![GitHub Watchers](https://img.shields.io/github/watchers/HYowshi/IPTV?style=social)

</div>