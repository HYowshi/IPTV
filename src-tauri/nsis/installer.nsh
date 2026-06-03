; ============================================
; PHIM.TV — Custom NSIS Installer Hooks
; Professional install/uninstall experience
; ============================================

; Unicode Vietnamese support
Unicode true

; --- Modern UI custom strings ---
; These replace default NSIS installer text
!define MUI_WELCOMEPAGE_TITLE "Chao mung den voi Phim.tv"
!define MUI_WELCOMEPAGE_TEXT "Trinh cai dat se huong dan ban qua quy trinh cai dat Phim.tv.$\n$\nPhim.tv la ung dung giai tri da phuong tien ho tro xem phim truc tuyen va truyen hinh IPTV voi chat luong cao.$\n$\nBan co the chon noi cai dat tuy y.$\n$\nNhan TIEP TUC de bat dau."

!define MUI_DIRECTORYPAGE_TEXT_TOP "Chon noi cai dat Phim.tv. Ban can it nhat 500MB trong o dia."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Thu muc cai dat"

!define MUI_LICENSEPAGE_TEXT_TOP "Vui long doc va dong y voi dieu khoan su dung"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "Neu ban dong y voi tat ca dieu khoan, nhan TOI DONG Y de tiep tuc."

!define MUI_INSTFILESPAGE_FINISHHEADER_MESSAGE "Cai dat hoan tat!"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Phim.tv da duoc cai dat thanh cong."
!define MUI_INSTFILESPAGE_ABORTHEADER_MESSAGE "Cai dat bi huy"
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "Quy trinh cai dat khong hoan tat."

; --- Uninstaller images (show app logo during uninstall) ---
!define MUI_UNHEADERIMAGE
!define MUI_UNHEADERIMAGE_BITMAP "nsis\uninstall-header.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "nsis\uninstall-sidebar.bmp"

; --- Uninstaller strings ---
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Trinh go cai dat se go Phim.tv khoi may tinh cua ban."
!define MUI_UNCONFIRMREGISTRY_TEXT "Xoa tat ca thiet lap va du lieu cua Phim.tv"
!define MUI_UNINSTFILESPAGE_FINISHHEADER_MESSAGE "Go cai dat hoan tat!"
!define MUI_UNINSTFILESPAGE_FINISHHEADER_SUBTEXT "Phim.tv da duoc go bo hoan toan. Khong con du lieu nao tren may tinh."

; --- Uninstaller UI customization (red-themed to distinguish) ---
!macro NSIS_HOOK_PREUNINSTALL_CONFIRM
  ; Confirmation dialog before uninstall
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "BAN CO CHAC CHAN MUON GO CAI DAT PHIM.TV?$\n$\nTac vu nay se:$\n  - Dong Phim.tv neu dang chay$\n  - Xoa toan bo thu muc cai dat$\n  - Xoa du lieu nguoi dung (yeu thich, lich su)$\n  - Xoa registry va shortcuts$\n  - Xoa bo nho dem va cache$\n$\nKHONG THE HOAN TAC sau khi go." IDYES uninstall_go IDNO uninstall_cancel

  uninstall_go:
    DetailPrint "Nguoi dung xac nhan go cai dat..."
    Goto uninstall_confirm_done

  uninstall_cancel:
    DetailPrint "Nguoi dung huy go cai dat."
    Abort

  uninstall_confirm_done:
!macroend

; --- Smart Pre-install: Detect environment, cleanup old install, check dependencies ---
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "=== Phim.tv Smart Installer ==="
  DetailPrint "Phien ban: ${__DATE__}"

  ; --- Smart Detect: Check if already installed ---
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Phim.tv" "InstallLocation"
  ${If} $R0 != ""
    DetailPrint "Phat hien Phim.tv da duoc cai dat tai: $R0"
    MessageBox MB_YESNO|MB_ICONQUESTION "Phim.tv da duoc cai dat tai:$\n$R0$\n$\nBan co muon cai dat de (ghi de) khong?$\n$\n(Lua chin KHONG de huy)" IDYES upgrade_install IDNO cancel_install
    upgrade_install:
      DetailPrint "Dang cai dat de len phien ban cu..."
      nsExec::ExecToLog 'taskkill /f /im "Phim.tv.exe" /t 2>nul'
      Sleep 500
      Goto check_webview
    cancel_install:
      DetailPrint "Nguoi dung huy cai dat."
      Abort
  ${EndIf}

  check_webview:
  ; --- Smart Detect: WebView2 Runtime ---
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-235B8DB62BE4}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-235B8DB62BE4}" "pv"
  ${EndIf}

  ${If} $0 == ""
    DetailPrint "WebView2 Runtime chua duoc cai dat."
    MessageBox MB_YESNO|MB_ICONQUESTION "Phim.tv can Microsoft Edge WebView2 Runtime de hoat dong.$\n$\nDay la thanh phan bat buoc (khoang 1.5MB).$\n$\nBan co muon tai ve va cai dat tu dong khong?" IDYES download_webview2 IDNO skip_webview2

    download_webview2:
      DetailPrint "Dang tai va cai dat WebView2 Runtime..."
      ; Download WebView2 bootstrapper silently
      NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
      Pop $R1
      ${If} $R1 == "success"
        DetailPrint "Dang cai dat WebView2 Runtime..."
        ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install' $R2
        ${If} $R2 == 0
          DetailPrint "WebView2 Runtime da cai dat thanh cong!"
        ${Else}
          DetailPrint "Cai dat WebView2 co loi (ma loi: $R2). Tiep tuc..."
        ${EndIf}
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
      ${Else}
        DetailPrint "Khong the tai WebView2: $R1"
        MessageBox MB_OK|MB_ICONINFORMATION "Khong the tai WebView2 tu dong.$\nVui long cai dat thu cong tu: https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
      ${EndIf}
      Goto done_webview2

    skip_webview2:
      DetailPrint "Bo qua cai dat WebView2 - co the khong hoat dong dung."

    done_webview2:
  ${Else}
    DetailPrint "WebView2 Runtime phien ban $0 da san sang."
  ${EndIf}

  ; --- Smart Detect: Display system info ---
  DetailPrint "Kiem tra moi truong he thong..."
  DetailPrint "Thu muc cai dat: $INSTDIR"

  ; --- Smart Detect: Kill running instances ---
  nsExec::ExecToLog 'taskkill /f /im "Phim.tv.exe" /t 2>nul'
  Sleep 300
  DetailPrint "San sang cai dat!"
!macroend

; --- Post-install: Create data dirs & show completion ---
!macro NSIS_HOOK_POSTINSTALL
  ; Create app data directory
  CreateDirectory "$LOCALAPPDATA\com.phimtv.app"
  CreateDirectory "$APPDATA\com.phimtv.app"

  ; Show completion message
  MessageBox MB_YESNO|MB_ICONQUESTION "Cai dat thanh cong! Ban co muon khoi dong Phim.tv ngay bay gio?" IDYES launch_app IDNO skip_launch

  launch_app:
    Exec '"$INSTDIR\Phim.tv.exe"'
    Goto done_launch

  skip_launch:
    DetailPrint "Nguoi dung chon khong khoi dong"

  done_launch:
!macroend

; --- Custom install page: License agreement ---
!macro NSIS_HOOK_PREINSTALL_CONFIRM
  ; Pre-install system requirements check
  DetailPrint "Kiem tra yeu cau he thong..."

  ; Check minimum Windows version (Windows 10+)
  ${If} ${AtLeastWin10}
    DetailPrint "He dieu hanh: Windows 10+ - Dat yeu cau"
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "Phim.tv yeu cau Windows 10 tro len. Vui long nang cap he dieu hanh."
    Abort
  ${EndIf}

  ; Check available disk space (minimum 500MB)
  ${DriveSpace} "$INSTDIR" "/D=F /S=M" $0
  ${If} $0 < 500
    MessageBox MB_OK|MB_ICONSTOP "Khong du dung luong o dia. Can it nhat 500MB trong."
    Abort
  ${Else}
    DetailPrint "Dung luong o dia: $0MB - Dat yeu cau"
  ${EndIf}

  ; Close running instances
  nsExec::ExecToLog 'taskkill /f /im "Phim.tv.exe" /t 2>nul'
  Sleep 300
!macroend