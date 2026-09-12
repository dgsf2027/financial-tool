@echo off
REM 天猫直通车每日抓取 —— 供 Windows 计划任务调用（每天 07:00）
REM 抓取万相台资金明细，输出 downloads\天猫直通车_<日期>.csv，日志写入 logs\
setlocal
set DIR=%~dp0
set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
if not exist "%DIR%logs" mkdir "%DIR%logs"
set LOG=%DIR%logs\tmall_%date:~0,4%%date:~5,2%%date:~8,2%.log
echo ==== %date% %time% ==== >> "%LOG%"
"%PY%" "%DIR%tmall_fetch.py" >> "%LOG%" 2>&1
echo exit=%ERRORLEVEL% >> "%LOG%"
endlocal
