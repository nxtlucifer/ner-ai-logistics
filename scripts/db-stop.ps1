<#
.SYNOPSIS
    Stop the WSL network keepalive started by db-start.ps1.

.DESCRIPTION
    Stops only the keepalive process. PostgreSQL keeps running inside WSL, and
    the distro is left alone - other WSL work is unaffected.

    To stop the database itself:
        wsl -d Ubuntu -u root -- systemctl stop postgresql

    To shut down WSL entirely (this WILL stop PostgreSQL):
        wsl --shutdown
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$marker = "ner-db-keepalive"

$procs = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$marker*" }

if (-not $procs) {
    Write-Host "No keepalive process found - nothing to stop." -ForegroundColor Yellow
    exit 0
}

foreach ($p in $procs) {
    Write-Host "Stopping keepalive PID $($p.ProcessId)" -ForegroundColor Cyan
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Keepalive stopped. PostgreSQL is still running inside WSL." -ForegroundColor Green
Write-Host "Note: localhost:5432 from Windows will become unreliable until you" -ForegroundColor Gray
Write-Host "run scripts\db-start.ps1 again." -ForegroundColor Gray
