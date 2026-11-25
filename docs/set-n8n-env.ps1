# Set environment variable untuk otomasi caPOS di n8n.
# Jalankan: powershell -ExecutionPolicy Bypass -File docs\set-n8n-env.ps1
# Kosongkan (Enter) untuk melewati variable yang belum punya nilai.

$ErrorActionPreference = "Stop"

$vars = @(
    @{ Name = "TELEGRAM_BOT_TOKEN";  Hint = "token dari @BotFather (123456:AA...)" },
    @{ Name = "TELEGRAM_CHAT_ID";    Hint = "chat id kamu / grup (-100...)" },
    @{ Name = "CAPOS_SHEET_ID";      Hint = "ID spreadsheet caPOS - Tenant Tracking" },
    @{ Name = "RESEND_API_KEY";      Hint = "re_..." },
    @{ Name = "EMAIL_FROM";          Hint = "caPOS <halo@alditriantama.com>" },
    @{ Name = "CAPOS_URL";           Hint = "https://alditriantama.com" },
    @{ Name = "MIDTRANS_SERVER_KEY"; Hint = "SB-Mid-server-... atau Mid-server-..." },
    @{ Name = "GROQ_API_KEY";        Hint = "gsk_..." },
    @{ Name = "WEBHOOK_URL";         Hint = "https://n8n.cloudeflare.my.id" }
)

Write-Host "=== Setup env otomasi caPOS ===" -ForegroundColor Cyan
Write-Host "Nilai lama akan ditimpa. Enter = lewati." -ForegroundColor DarkGray
Write-Host ""

foreach ($v in $vars) {
    $current = [Environment]::GetEnvironmentVariable($v.Name, "User")
    $label = if ($current) { " [$($v.Name)] sekarang: $($current.Substring(0, [Math]::Min(12, $current.Length)))..." } else { " [$($v.Name)]" }
    Write-Host "$label" -ForegroundColor Yellow
    Write-Host "   $($v.Hint)" -ForegroundColor DarkGray
    $value = Read-Host "   nilai baru"
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        [Environment]::SetEnvironmentVariable($v.Name, $value.Trim(), "User")
        Write-Host "   disimpan." -ForegroundColor Green
    } else {
        Write-Host "   dilewati." -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Selesai. Sekarang RESTART n8n supaya env terbaca:" -ForegroundColor Cyan
Write-Host "  1. Tutup jendela/terminal tempat n8n berjalan (atau Stop-Process -Id <PID node>)"
Write-Host "  2. Jalankan lagi: n8n start"
Write-Host ""
Write-Host "Verifikasi cepat:" -ForegroundColor Cyan
Write-Host "  https://api.telegram.org/bot<TOKEN>/getMe"
Write-Host "  https://n8n.cloudeflare.my.id/healthz"
