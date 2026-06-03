!macro NSIS_HOOK_PREUNINSTALL
  ; ============================================
  ; PHIM.TV — THOROUGH CLEANUP UNINSTALL SCRIPT
  ; Version 3.0 — Maximum safety & thoroughness
  ; ============================================

  DetailPrint "=========================================="
  DetailPrint "Phim.tv Uninstaller v3.0"
  DetailPrint "Bat dau quy trinh go cai dat an toan..."
  DetailPrint "=========================================="

  ; --- 1. Kill ALL related processes ---
  DetailPrint "[1/14] Dang kiem tra va dong cac tien trinh..."
  nsExec::ExecToLog 'taskkill /f /im "Phim.tv.exe" /t 2>nul'
  nsExec::ExecToLog 'taskkill /f /im "PhimTV.exe" /t 2>nul'
  nsExec::ExecToLog 'taskkill /f /im "phimtvapp.exe" /t 2>nul'
  Sleep 800

  ; Verify process is killed
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq Phim.tv.exe" /NH'
  Pop $0
  ${If} $0 != ""
    DetailPrint "Canh bao: Tien trinh van con chay, thu lai..."
    nsExec::ExecToLog 'taskkill /f /im "Phim.tv.exe" /t 2>nul'
    Sleep 500
  ${EndIf}

  ; --- 2. App Data & WebView2 Storage ---
  DetailPrint "[2/14] Dang xoa du lieu ung dung..."
  ; Primary app data
  RMDir /r "$LOCALAPPDATA\com.phimtv.app"
  RMDir /r "$APPDATA\com.phimtv.app"
  RMDir /r "$LOCALAPPDATA\com.phimtv.phimtvapp"
  RMDir /r "$APPDATA\com.phimtv.phimtvapp"

  ; Alternative product name locations
  RMDir /r "$LOCALAPPDATA\Phim.tv"
  RMDir /r "$APPDATA\Phim.tv"
  RMDir /r "$LOCALAPPDATA\PhimTV"
  RMDir /r "$APPDATA\PhimTV"

  ; Tauri updater cache
  RMDir /r "$LOCALAPPDATA\tauri"
  Delete "$LOCALAPPDATA\com.phimtv.app\.update"
  Delete "$LOCALAPPDATA\com.phimtv.phimtvapp\.update"

  ; IndexedDB & Service Worker cache
  RMDir /r "$LOCALAPPDATA\com.phimtv.phimtvapp\EBWebView"
  RMDir /r "$LOCALAPPDATA\com.phimtv.app\EBWebView"

  ; --- 3. Registry cleanup ---
  DetailPrint "[3/14] Dang xoa registry entries..."
  ; App-specific registry
  DeleteRegKey HKCU "Software\PhimTV Admin\Phim.tv"
  DeleteRegKey HKCU "Software\PhimTV Admin"
  DeleteRegKey HKCU "Software\Classes\com.phimtv.phimtvapp"
  DeleteRegKey HKCU "Software\Classes\com.phimtv.app"

  ; Uninstall registry (both CU and LM)
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv"

  ; Startup registry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Phim.tv"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Phim.tv"

  ; File associations
  DeleteRegKey HKCU "Software\Classes\.phimtv"
  DeleteRegKey HKCU "Software\Classes\phimtv"

  ; --- 4. Install directory cleanup ---
  DetailPrint "[4/14] Dang xoa thu muc cai dat..."
  ; Delete WebView2 data in install dir
  RMDir /r "$INSTDIR\WebView2"
  RMDir /r "$INSTDIR\data"
  RMDir /r "$INSTDIR\resources"

  ; Delete executables and links
  Delete "$INSTDIR\Phim.tv.exe"
  Delete "$INSTDIR\PhimTV.exe"
  Delete "$INSTDIR\phimtvapp.exe"
  Delete "$INSTDIR\Phim.tv.exe.sig"
  Delete "$INSTDIR\PhimTV.exe.sig"
  Delete "$INSTDIR\phimtvapp.exe.sig"

  ; Delete links and logs
  Delete "$INSTDIR\Phim.tv.lnk"
  Delete "$INSTDIR\install.log"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"

  ; Try to remove install dir (may fail if not empty)
  RMDir "$INSTDIR"

  ; --- 5. Windows Icon & Thumbnail Caches ---
  DetailPrint "[5/14] Dang xoa bo nho dem bieu tuong..."
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache_*.db"

  ; --- 6. Recent Files & Jump Lists ---
  DetailPrint "[6/14] Dang xoa tep gan day..."
  Delete "$APPDATA\Microsoft\Windows\Recent\*Phim*"
  Delete "$APPDATA\Microsoft\Windows\Recent\*phimtv*"
  Delete "$APPDATA\Microsoft\Windows\Recent\*com.phimtv*"
  Delete "$APPDATA\Microsoft\Windows\Recent\AutomaticDestinations\*Phim*"
  Delete "$APPDATA\Microsoft\Windows\Recent\CustomDestinations\*Phim*"

  ; --- 7. Prefetch Files ---
  DetailPrint "[7/14] Dang xoa tep prefetch..."
  Delete "$WINDIR\Prefetch\PHIMTVAPP*"
  Delete "$WINDIR\Prefetch\PHIM.TV*"
  Delete "$WINDIR\Prefetch\PHIMTV*"

  ; --- 8. Windows Notification Cache ---
  DetailPrint "[8/14] Dang xoa cache thong bao..."
  Delete "$LOCALAPPDATA\Microsoft\Windows\Notifications\*phimtv*"
  Delete "$LOCALAPPDATA\Microsoft\Windows\Notifications\*Phim*"

  ; --- 9. Quick Launch ---
  DetailPrint "[9/14] Dang xoa Quick Launch..."
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\Phim.tv.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Phim.tv.lnk"

  ; --- 10. Start Menu ---
  DetailPrint "[10/14] Dang xoa Start Menu..."
  RMDir /r "$SMPROGRAMS\Phim.tv"
  RMDir /r "$SMPROGRAMS\PhimTV"
  Delete "$SMPROGRAMS\Phim.tv.lnk"
  Delete "$SMPROGRAMS\PhimTV.lnk"

  ; --- 11. Desktop Shortcut ---
  DetailPrint "[11/14] Dang xoa shortcut Desktop..."
  Delete "$DESKTOP\Phim.tv.lnk"
  Delete "$DESKTOP\PhimTV.lnk"

  ; --- 12. Temp Files ---
  DetailPrint "[12/14] Dang xoa tep tam thoi..."
  RMDir /r "$TEMP\phimtvapp"
  RMDir /r "$TEMP\Phim.tv"
  RMDir /r "$TEMP\PhimTV"
  Delete "$TEMP\*phimtv*"

  ; --- 13. Windows Search Indexer cache ---
  DetailPrint "[13/14] Dang xoa cache tim kiem..."
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\SearchHistory\*phimtv*"
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\SearchHistory\*Phim*"

  ; --- 14. Firewall rules ---
  DetailPrint "[14/14] Dang xoa quy tac tuong lua..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Phim.tv" 2>nul'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PhimTV" 2>nul'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="phimtvapp" 2>nul'

  ; --- Final: Refresh system ---
  DetailPrint "Dang lam moi he thong..."
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'

  ; --- Verification ---
  DetailPrint "=========================================="
  DetailPrint "Kiem tra ket qua go cai dat..."

  ; Check install dir
  ${If} ${FileExists} "$INSTDIR\Phim.tv.exe"
    DetailPrint "CANH BAO: Khong the xoa thu muc cai dat hoan toan"
  ${Else}
    DetailPrint "Thu muc cai dat: DA XOA"
  ${EndIf}

  ; Check app data
  ${If} ${FileExists} "$LOCALAPPDATA\com.phimtv.phimtvapp"
    DetailPrint "CANH BAO: Du lieu app chua xoa hoan toan"
  ${Else}
    DetailPrint "Du lieu app: DA XOA"
  ${EndIf}

  ; Check shortcuts
  ${If} ${FileExists} "$DESKTOP\Phim.tv.lnk"
    DetailPrint "CANH BAO: Shortcut Desktop chua xoa"
  ${Else}
    DetailPrint "Shortcut Desktop: DA XOA"
  ${EndIf}

  DetailPrint "=========================================="
  DetailPrint "Hoan tat go cai dat! Phim.tv da duoc go bo."
  DetailPrint "=========================================="
!macroend