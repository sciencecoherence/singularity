@echo off
setlocal
cd /d "%~dp0web"
where php >NUL 2>&1
if errorlevel 1 goto nophp
echo Serving the website on http://127.0.0.1:8097
echo Close this window to stop it.
start "" http://127.0.0.1:8097/
php -S 127.0.0.1:8097
exit /b 0
:nophp
echo.
echo The website preview needs PHP on this machine, and PHP is not on PATH.
echo Four of the sources - NASA GISTEMP, NSIDC sea ice, NOAA CPC, Epoch AI -
echo publish no cross-origin header, so the page reaches them through
echo proxy.php. Opening index.html straight from disk leaves those four dark.
echo.
echo Use Open App.cmd instead: the app has its own allowlist and needs no
echo proxy. The web folder works as it stands once uploaded to Hostinger,
echo where PHP is already running.
echo.
pause
