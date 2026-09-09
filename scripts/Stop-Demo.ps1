<#
.SYNOPSIS
    Stop the services Start-Demo started. Nothing else.

.DESCRIPTION
    Reads .runtime/demo-services.json - the pids Start-Demo recorded, with the
    port each was started for - and stops those process trees.

    WHAT IT DELIBERATELY LEAVES ALONE

    The isolated PostgreSQL cluster. It holds the demo trip, the accounts and
    the approved route; stopping it is never part of "close the demo", and
    starting it again is cheap anyway. Stop it explicitly if you really mean to:

        .runtime\pg\pgsql\bin\pg_ctl.exe -D .runtime\data stop

    A service that was ALREADY running when you launched. Start-Demo does not
    record those, so it will not stop them - you were probably using them, and a
    launcher that kills your editor's dev server is a launcher nobody runs twice.

    A pid that has been reused. Each entry is checked against the port it was
    started for before anything is killed, so a recycled pid belonging to some
    unrelated program is skipped rather than terminated.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $Root ".runtime\demo-services.json"

function Test-Port([int]$Port) {
    # Try BOTH loopbacks, each with a socket of the matching family.
    #
    # Neither shortcut works here, and both were tried. A default TcpClient is
    # an IPv4 socket, so it cannot dial ::1 at all. Passing the NAME "localhost"
    # does not help either - .NET resolved it to 127.0.0.1 only and reported
    # "actively refused it 127.0.0.1:5173". Meanwhile Vite was listening, on
    # [::1]:5173 and nowhere else, and the launcher waited ninety seconds for a
    # server that had been ready in under a second.
    foreach ($addr in @([System.Net.IPAddress]::Loopback, [System.Net.IPAddress]::IPv6Loopback)) {
        $c = New-Object System.Net.Sockets.TcpClient($addr.AddressFamily)
        try {
            $c.Connect($addr, $Port)
            return $true
        }
        catch { }
        finally { $c.Dispose() }
    }
    return $false
}

Write-Host ""
Write-Host "NER Fleet Intelligence - stopping the demo" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $StateFile)) {
    Write-Host "  Nothing recorded - Start-Demo has not started anything, or it was already stopped."
    Write-Host ""
    exit 0
}

$services = @()
try { $services = @(Get-Content $StateFile -Raw | ConvertFrom-Json) }
catch {
    Write-Host "  Could not read $StateFile - leaving every process alone." -ForegroundColor Red
    exit 1
}

$stopped = 0
foreach ($s in $services) {
    if (-not $s) { continue }
    $proc = Get-Process -Id $s.pid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "  gone     $($s.name) (pid $($s.pid) already exited)"
        continue
    }

    # A pid outlives its process. Before killing anything, check the port this
    # entry was started for is still open - otherwise this pid is now somebody
    # else's program.
    if ($s.port -and -not (Test-Port ([int]$s.port))) {
        Write-Host "  skipped  $($s.name) (pid $($s.pid) is alive but port $($s.port) is closed - not ours any more)" -ForegroundColor Yellow
        continue
    }

    # /T because npm and Expo start real work in child processes; killing only
    # the launcher leaves the server running and the port held.
    & taskkill.exe /PID $s.pid /T /F 2>&1 | Out-Null
    Write-Host "  stopped  $($s.name) (pid $($s.pid), port $($s.port))" -ForegroundColor Green
    $stopped++
}

Remove-Item $StateFile -Force
Write-Host ""
Write-Host "  $stopped stopped. The isolated database is still running and keeps your demo data."
Write-Host ""
