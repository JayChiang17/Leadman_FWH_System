@echo off
REM ========================================
REM   Start Frontend with HTTP (Fallback)
REM ========================================
echo.
echo [HTTP Mode] Starting React Dev Server...
echo.
echo Frontend will be available at:
echo   http://192.168.10.100:3000
echo   http://localhost:3000
echo.
echo Note: PWA installation requires HTTPS mode
echo Use start-https.bat for PWA testing
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

npm run start:http

pause
