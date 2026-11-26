; Handshake installer for Windows.
; Installs for the current user only (no administrator rights needed),
; registers handshake:// meeting links, and adds a clean uninstaller.
;
; Built by scripts/build-installer.cjs with the native makensis (NSIS 3),
; which runs on Windows, Linux and macOS:
;   makensis -DVERSION=1.0.0 -DSRC=dist/win-unpacked -DOUT=dist/Handshake-Setup-1.0.0.exe installer/handshake.nsi

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!ifndef VERSION
  !define VERSION "1.2.0"
!endif
!ifndef SRC
  !define SRC "..\dist\win-unpacked"
!endif
!ifndef OUT
  !define OUT "..\dist\Handshake-Setup-${VERSION}.exe"
!endif

!define APP "Handshake"
!define EXE "Handshake.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Handshake"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
BrandingText "${APP} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 CS-Fasih and Handshake contributors. Non-commercial use only."
VIAddVersionKey "CompanyName" "Handshake contributors"

!include "MUI2.nsh"

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP}"
!define MUI_WELCOMEPAGE_TEXT "Private video meetings, encrypted from your device to theirs. No account needed.$\r$\n$\r$\nThis installs ${APP} ${VERSION} for your Windows user only. Click Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  ; Replace any earlier version completely.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC}\*.*"
  File "/oname=LICENSE.txt" "..\..\LICENSE"

  WriteUninstaller "$INSTDIR\Uninstall ${APP}.exe"

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  ; handshake://join/<code> links open the app.
  WriteRegStr HKCU "Software\Classes\handshake" "" "URL:Handshake meeting link"
  WriteRegStr HKCU "Software\Classes\handshake" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\handshake\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\handshake\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Handshake contributors"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP}.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP}.exe" /S'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/CS-Fasih/E2EE-meeting"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKCU "Software\Classes\handshake"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP}"
  RMDir /r "$INSTDIR"
  ; Settings saved by the app (your name and device choices) live here.
  RMDir /r "$APPDATA\${APP}"
SectionEnd
