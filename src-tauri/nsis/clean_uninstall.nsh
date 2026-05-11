!macro NSIS_HOOK_PREUNINSTALL
  ; ============================================
  ; PHIM.TV — THOROUGH CLEANUP UNINSTALL SCRIPT
  ; Removes ALL traces from the user's machine
  ; ============================================

  ; --- 1. App Data & WebView2 Storage ---
  ; WebView2 user data (localStorage, sessionStorage, IndexedDB, Service Workers, cookies, cache)
  RMDir /r "$LOCALAPPDATA\com.phimtv.app"

  ; Tauri plugin-store data
  RMDir /r "$APPDATA\com.phimtv.app"

  ; Alternative data location (if Tauri uses product name)
  RMDir /r "$LOCALAPPDATA\Phim.tv"
  RMDir /r "$APPDATA\Phim.tv"

  ; --- 2. Windows Icon & Thumbnail Caches ---
  ; Delete app-specific icon cache entries
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db" 
  Delete "$LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache_*.db"

  ; --- 3. Recent Files & Jump Lists ---
  ; Remove recent file entries related to the app
  Delete "$APPDATA\Microsoft\Windows\Recent\*Phim*"
  Delete "$APPDATA\Microsoft\Windows\Recent\*phimtvapp*"
  Delete "$APPDATA\Microsoft\Windows\Recent\*com.phimtv*"
  ; Remove Jump List entries
  Delete "$APPDATA\Microsoft\Windows\Recent\AutomaticDestinations\*Phim*"
  Delete "$APPDATA\Microsoft\Windows\Recent\CustomDestinations\*Phim*"

  ; --- 4. Prefetch Files ---
  Delete "$WINDIR\Prefetch\PHIMTVAPP*"
  Delete "$WINDIR\Prefetch\PHIM.TV*"

  ; --- 5. Windows Notification Cache ---
  Delete "$LOCALAPPDATA\Microsoft\Windows\Notifications\*phimtv*"

  ; --- 6. Quick Launch ---
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\Phim.tv.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Phim.tv.lnk"

  ; --- 7. Start Menu (extra safety — NSIS handles this by default) ---
  RMDir /r "$SMPROGRAMS\Phim.tv"
  Delete "$SMPROGRAMS\Phim.tv.lnk"

  ; --- 8. Desktop Shortcut (extra safety) ---
  Delete "$DESKTOP\Phim.tv.lnk"

  ; --- 9. Temp Files ---
  RMDir /r "$TEMP\phimtvapp"
  RMDir /r "$TEMP\Phim.tv"

  ; --- 10. Flush Windows icon/thumbnail caches ---
  ; This forces Explorer to rebuild its caches after uninstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend