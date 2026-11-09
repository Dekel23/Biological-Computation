@echo off
rem Double-click on Windows to run the group-roast site on this computer.
rem First run: installs what the site needs and asks for your API token once.
setlocal
cd /d "%~dp0"
title Al HaEsh - group roast

set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto :nopython

if exist ".venv\installed.txt" goto :token
echo Installing (first run only, takes a minute)...
if exist ".venv" rmdir /s /q ".venv"
%PY% -m venv .venv || goto :failed
".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt || goto :failed
echo ok> ".venv\installed.txt"

:token
findstr /r /b /c:"REPLICATE_API_TOKEN=." ".env" >nul 2>nul && goto :run
findstr /r /b /c:"ANTHROPIC_API_KEY=." ".env" >nul 2>nul && goto :run
echo.
echo Paste your Replicate API token (it starts with r8_) and press Enter.
echo It is saved only on this computer, in the file .env
:ask
set "TOKEN="
set /p "TOKEN=Token: "
if not defined TOKEN goto :ask
> ".env" echo LLM_PROVIDER=replicate
>> ".env" echo REPLICATE_API_TOKEN=%TOKEN%

:run
set "OPEN_BROWSER=1"
".venv\Scripts\python.exe" app.py
echo.
echo The site stopped.
pause
exit /b 0

:nopython
echo Python is not installed.
echo Download it from https://www.python.org/downloads/
echo During the install, tick "Add python.exe to PATH". Then run this file again.
pause
exit /b 1

:failed
echo Installation failed. Check your internet connection and run this file again.
pause
exit /b 1
