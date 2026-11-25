@echo off
setlocal
title n8n - caPOS

netstat -ano | findstr ":5678" | findstr LISTENING >nul
if %errorlevel%==0 (
    echo.
    echo   n8n sudah berjalan.
    echo   Membuka http://localhost:5678 ...
    echo.
    start "" http://localhost:5678
    ping -n 3 127.0.0.1 >nul
    exit /b 0
)

echo.
echo   Menjalankan n8n...
echo   Browser akan terbuka otomatis dalam 20 detik.
echo   JANGAN tutup jendela ini selama n8n dipakai.
echo.

start "" /min cmd /c "ping -n 21 127.0.0.1 >nul & start http://localhost:5678"

call n8n.cmd start

echo.
echo   n8n berhenti. Tekan tombol apa saja untuk menutup.
pause >nul
