' LikeBoard 无窗启动器：开机自启时避免 cmd 黑框一闪
CreateObject("Wscript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\一键启动.bat" & """", 0, False
