@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

REM ── Быстрый деплой Garbona на VPS ───────────────────────────────────────────
REM Примеры:
REM   scripts\deploy-vps.cmd
REM   scripts\deploy-vps.cmd quick
REM   scripts\deploy-vps.cmd with-env
REM   scripts\deploy-vps.cmd env
REM   scripts\deploy-vps.cmd full
REM   scripts\deploy-vps.cmd full-env
REM   scripts\deploy-vps.cmd restart
REM   scripts\deploy-vps.cmd status
REM   scripts\deploy-vps.cmd files src\panel\routes.js panel\js\app.js
REM
REM Конфиг: скопируй scripts\deploy-vps.env.example → scripts\deploy-vps.env

if not exist "scripts\deploy-vps.env" if exist "scripts\deploy-vps.env.example" (
  echo [i] Нет scripts\deploy-vps.env — скопируй из deploy-vps.env.example и укажи пароль/хост.
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=menu"

if /I "%MODE%"=="files" goto :files
if /I "%MODE%"=="help" goto :help
if /I "%MODE%"=="/?" goto :help
if /I "%MODE%"=="-h" goto :help

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-vps.ps1" %MODE% %2 %3 %4 %5 %6 %7 %8 %9
set "ERR=%ERRORLEVEL%"
echo.
pause
exit /b %ERR%

:files
shift
set "LIST="
:files_loop
if "%~1"=="" goto :files_run
if defined LIST (
  set "LIST=%LIST%,%~1"
) else (
  set "LIST=%~1"
)
shift
goto :files_loop

:files_run
if not defined LIST (
  echo Укажи файлы: scripts\deploy-vps.cmd files src\a.js panel\js\app.js
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-vps.ps1" files -Files "%LIST%"
set "ERR=%ERRORLEVEL%"
echo.
pause
exit /b %ERR%

:help
echo.
echo Garbona VPS deploy
echo.
echo   deploy-vps.cmd              меню
echo   deploy-vps.cmd quick        изменённые файлы, БЕЗ .env + restart
echo   deploy-vps.cmd with-env     изменённые файлы + .env + restart
echo   deploy-vps.cmd env          только .env + restart
echo   deploy-vps.cmd full         полный tar, БЕЗ .env
echo   deploy-vps.cmd full-env     полный tar + .env
echo   deploy-vps.cmd restart      только pm2 restart
echo   deploy-vps.cmd status       статус/логи
echo   deploy-vps.cmd files a b    конкретные файлы
echo.
echo Конфиг: scripts\deploy-vps.env  ^(из deploy-vps.env.example^)
echo.
pause
exit /b 0
