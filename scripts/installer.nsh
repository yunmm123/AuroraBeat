; Custom uninstall script for AuroraBeat
; Cleans up AppData folder on uninstall

!macro customUnInstall
  ; Delete AppData folder
  RMDir /r "$APPDATA\AuroraBeat"
  RMDir /r "$APPDATA\com.aurorabeat.player"
  
  ; Delete LocalAppData folder (for cache)
  RMDir /r "$LOCALAPPDATA\AuroraBeat"
  RMDir /r "$LOCALAPPDATA\com.aurorabeat.player"
!macroend
