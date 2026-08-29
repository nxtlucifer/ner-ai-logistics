<#
.SYNOPSIS
    Start the development database (PostgreSQL 18 + PostGIS 3.6 in WSL2 Ubuntu)
    and hold the WSL2 network relay open.

.DESCRIPTION
    Run this once per Windows session, before starting the backend.

    WHY THE KEEPALIVE EXISTS
    ------------------------
    WSL2 proxies Windows localhost into the WSL VM. On this machine that relay is
    torn down roughly 20 seconds after the last Windows-side wsl.exe process
    exits, even though the distro and PostgreSQL keep running happily inside the
    VM. The symptom is confusing: the TCP handshake still succeeds, then the
    connection dies with

        could not receive data from server: Socket is not connected (10057)

    Holding one long-lived wsl.exe process open keeps the relay up, and
    localhost:5432 then works reliably. This was measured, not guessed - see
    docs/ARCHITECTURE.md section 10 and the README troubleshooting table.

    Alternatives considered and rejected:
      - WSL mirrored networking (networkingMode=mirrored): the Hyper-V firewall
        defaults to blocking inbound, and changing it needs Administrator.
      - Connecting to the WSL VM IP directly: same idle teardown, and the IP
        changes on every WSL restart.
      - Docker Desktop: a larger install requiring virtualization changes and a
        reboot. Still a valid option; see docker-compose.yml.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\db-start.ps1
#>

[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu",
    [int]$Port = 5432
)

$ErrorActionPreference = "Stop"

Write-Host "==> Ensuring WSL distro '$Distro' is running" -ForegroundColor Cyan
wsl -d $Distro -- true
if ($LASTEXITCODE -ne 0) { throw "Could not start WSL distro '$Distro'." }

Write-Host "==> Ensuring PostgreSQL is running inside WSL" -ForegroundColor Cyan
$status = (wsl -d $Distro -u root -- systemctl is-active postgresql) -replace "`0", ""
if ($status.Trim() -ne "active") {
    Write-Host "    PostgreSQL not active (state: $($status.Trim())), starting it" -ForegroundColor Yellow
    wsl -d $Distro -u root -- systemctl start postgresql
    if ($LASTEXITCODE -ne 0) { throw "Failed to start PostgreSQL inside WSL." }
}
Write-Host "    PostgreSQL is active" -ForegroundColor Green

# --- Keepalive ---------------------------------------------------------------
$marker = "ner-db-keepalive"
$existing = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$marker*" }

if ($existing) {
    Write-Host "==> Keepalive already running (PID $($existing.ProcessId -join ', '))" -ForegroundColor Green
} else {
    Write-Host "==> Starting WSL network keepalive" -ForegroundColor Cyan
    # `sleep infinity` under a shell whose command line carries the marker, so
    # db-stop.ps1 can find exactly this process and nothing else.
    Start-Process -FilePath "wsl.exe" `
        -ArgumentList "-d", $Distro, "--", "sh", "-c", "# $marker`nexec sleep infinity" `
        -WindowStyle Hidden
    Start-Sleep -Milliseconds 1500
    Write-Host "    Keepalive started" -ForegroundColor Green
}

# --- Verify ------------------------------------------------------------------
Write-Host "==> Verifying localhost:$Port from Windows" -ForegroundColor Cyan
$ok = $false
foreach ($attempt in 1..5) {
    $test = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
    if ($test.TcpTestSucceeded) { $ok = $true; break }
    Start-Sleep -Milliseconds 800
}

if ($ok) {
    Write-Host ""
    Write-Host "  Database ready on localhost:$Port" -ForegroundColor Green
    Write-Host "  Leave this keepalive running while you develop." -ForegroundColor Green
    Write-Host "  Stop it with: scripts\db-stop.ps1" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  Could not reach localhost:$Port." -ForegroundColor Red
    Write-Host "  Check inside WSL:  wsl -d $Distro -u root -- pg_lsclusters" -ForegroundColor Gray
    exit 1
}
