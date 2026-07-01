; Custom uninstall script for AuroraBeat
; 彻底清理所有用户数据，确保卸载无残留（登录信息、cookie、session partition、缓存）
; 路径说明：
;   Electron userData 默认在 %APPDATA%/<package.json name>，即 %APPDATA%/aurorabeat（小写）
;   session partition persist:aurorabeat-netease 存在 %APPDATA%/aurorabeat/Partitions/aurorabeat-netease
;   server.js 的 cookie 文件写在 %APPDATA%/aurorabeat-cookie.txt（APPDATA 根目录）
;   electron-builder 缓存在 %APPDATA%/<productName> 或 %APPDATA%/<appId>

!macro customUnInstall
  ; ===== Windows 清理 =====
  ; Electron userData 目录（小写 name，真实路径）
  RMDir /r "$APPDATA\aurorabeat"
  RMDir /r "$APPDATA\AuroraBeat"
  RMDir /r "$APPDATA\com.aurorabeat.player"
  ; server.js 写的 cookie 文件（在 APPDATA 根目录）
  Delete "$APPDATA\aurorabeat-cookie.txt"
  ; LocalAppData 缓存
  RMDir /r "$LOCALAPPDATA\aurorabeat"
  RMDir /r "$LOCALAPPDATA\AuroraBeat"
  RMDir /r "$LOCALAPPDATA\com.aurorabeat.player"
  ; electron-builder 更新缓存
  RMDir /r "$LOCALAPPDATA\@aurorabeat"
  RMDir /r "$LOCALAPPDATA\AuroraBeat-updater"
  ; 临时下载/安装包
  Delete "$TEMP\AuroraBeat*.tmp"
  Delete "$TEMP\aurorabeat*.tmp"
!macroend
