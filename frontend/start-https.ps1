# ========================================
#   Start Frontend with HTTPS (PWA Ready)
# ========================================

Write-Host ""
Write-Host "[HTTPS Mode] Starting React Dev Server..." -ForegroundColor Green
Write-Host ""
Write-Host "Frontend will be available at:" -ForegroundColor Cyan
Write-Host "  https://192.168.10.100:3000" -ForegroundColor Yellow
Write-Host "  https://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Certificate: ssl/cert.pem (Valid until 2029-01-12)" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Gray
Write-Host ""

npm start
