' Grid Tile Editor - launch server daemon with no visible window
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\_DX\Grid.Tile.Editor\scripts\server-daemon.cmd""", 0, False
