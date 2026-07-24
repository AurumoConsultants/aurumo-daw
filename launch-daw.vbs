' Launches Aurumo DAW without leaving a console window open.
Set sh = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = scriptDir
' 0 = hidden window, False = don't wait for it to finish
sh.Run "cmd /c """ & scriptDir & "launch-daw.cmd""", 0, False
