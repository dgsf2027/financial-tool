@echo off
REM 京东自营每日抓取 —— 供 Windows 计划任务调用（每天 07:05）
setlocal
set DIR=%~dp0
set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
if not exist "%DIR%logs" mkdir "%DIR%logs"
set LOG=%DIR%logs\jd_%date:~0,4%%date:~5,2%%date:~8,2%.log
echo ==== %date% %time% ==== >> "%LOG%"
"%PY%" "%DIR%jd_fetch.py" >> "%LOG%" 2>&1
echo exit=%ERRORLEVEL% >> "%LOG%"
endlocal
