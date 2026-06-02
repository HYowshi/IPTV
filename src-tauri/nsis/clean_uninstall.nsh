!macro NSIS_HOOK_PREUNINSTALL
  ; ============================================
  ; PHIM.TV — THOROUGH CLEANUP UNINSTALL SCRIPT
  ; Version 2.1 — Removes ALL traces cleanly
  ; ============================================

  DetailPrint "Bat dau go Phim.tv va xoa du lieu..."

  ; --- 1. Close app processes if still running ---
  DetailPrint "Dang dong cac tien trinh dang chay..."
  nsExec::ExecToLog 'taskkill /f /im "Phim.tv.exe" /t 2>nul'
  Sleep 500

  ; --- 2. App Data & WebView2 Storage ---
  DetailPrint "Dang xoa du lieu ung dung va bo nho dem..."
  ; WebView2 user data (localStorage, sessionStorage, IndexedDB, Service Workers, cookies, cache)
  RMDir /r "$LOCALAPPDATA\com.phimtv.app"

  ; Tauri plugin-store data
  RMDir /r "$APPDATA\com.phimtv.app"

  ; Alternative data locations
  RMDir /r "$LOCALAPPDATA\Phim.tv"
  RMDir /r "$APPDATA\Phim.tv"

  ; Tauri updater cache
  RMDir /r "$LOCALAPPDATA\tauri"
  Delete "$LOCALAPPDATA\com.phimtv.app\.update"

  ; --- 2b. Registry cleanup ---
  DetailPrint "Dang xoa registry..."
  DeleteRegKey HKCU "Software\PhimTV Admin\Phim.tv"
  DeleteRegKey HKCU "Software\Classes\com.phimtv.app"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Phim.tv"

  ; --- 2c. Install directory cleanup ---
  DetailPrint "Dang xoa thu muc cai dat..."
  RMDir /r "$INSTDIR\WebView2"
  Delete "$INSTDIR\Phim.tv.exe"
  Delete "$INSTDIR\Phim.tv.exe.sig"
  Delete "$INSTDIR\Phim.tv.lnk"
  Delete "$INSTDIR\install.log"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; --- 3. Windows Icon & Thumbnail Caches ---
  DetailPrint "Dang xoa bo nho dem bieu tuong..."
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache_*.db"

  ; --- 4. Recent Files & Jump Lists ---
  DetailPrint "Dang xoa tep gan day va danh sach nhanh..."
  Delete "$APPDATA\Microsoft\Windows\Recent\*Phim*"
  Delete "$APPDATA\Microsoft\Windows\Recent\*phimtvapp*"
  Delete "$APPDATA\Microsoft\Windows\Recent\*com.phimtv*"
  Delete "$APPDATA\Microsoft\Windows\Recent\AutomaticDestinations\*Phim*"
  Delete "$APPDATA\Microsoft\Windows\Recent\CustomDestinations\*Phim*"

  ; --- 5. Prefetch Files ---
  DetailPrint "Dang xoa tep prefetch..."
  Delete "$WINDIR\Prefetch\PHIMTVAPP*"
  Delete "$WINDIR\Prefetch\PHIM.TV*"

  ; --- 6. Windows Notification Cache ---
  DetailPrint "Dang xoa cache thong bao..."
  Delete "$LOCALAPPDATA\Microsoft\Windows\Notifications\*phimtv*"

  ; --- 7. Quick Launch ---
  DetailPrint "Dang xoa Quick Launch shortcuts..."
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\Phim.tv.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Phim.tv.lnk"

  ; --- 8. Start Menu ---
  DetailPrint "Dang xoa Start Menu..."
  RMDir /r "$SMPROGRAMS\Phim.tv"
  Delete "$SMPROGRAMS\Phim.tv.lnk"

  ; --- 9. Desktop Shortcut ---
  DetailPrint "Dang xoa shortcut Desktop..."
  Delete "$DESKTOP\Phim.tv.lnk"

  ; --- 10. Temp Files ---
  DetailPrint "Dang xoa tep tam thoi..."
  RMDir /r "$TEMP\phimtvapp"
  RMDir /r "$TEMP\Phim.tv"

  ; --- 11. Windows Search Indexer cache ---
  DetailPrint "Dang xoa cache tim kiem Windows..."
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\SearchHistory\*phimtv*"

  ; --- 12. Firewall rules (remove if added) ---
  DetailPrint "Dang xoa quy tac tuong lua..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Phim.tv" 2>nul'

  ; --- 13. Flush Windows icon/thumbnail caches ---
  DetailPrint "Dang lam moi bo nho dem he thong..."
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'

  ; --- 14. Refresh desktop icons ---
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'

  DetailPrint "Hoan tat go cai dat! Phim.tv da duoc go bo hoan toan."
!macroend
