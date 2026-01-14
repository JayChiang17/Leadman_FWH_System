@echo off
REM ========================================
REM   Start Frontend with HTTPS (PWA Ready)
REM ========================================
echo.
echo [HTTPS Mode] Starting React Dev Server...
echo.
echo Frontend will be available at:
echo   https://192.168.10.100:3000
echo   https://localhost:3000
echo.
echo Certificate: ssl/cert.pem (Valid until 2029-01-12)
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

npm start

pause
