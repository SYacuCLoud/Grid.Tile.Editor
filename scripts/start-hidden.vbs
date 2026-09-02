' Grid Tile Editor - launch scripts\server-daemon.cmd with no visible window.
' Used by "scripts\service.cmd start" and by the "Grid Tile Editor" logon task.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run """" & here & "\server-daemon.cmd""", 0, False
