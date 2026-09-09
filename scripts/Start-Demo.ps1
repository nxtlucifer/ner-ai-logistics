<#
.SYNOPSIS
    Start everything needed to demonstrate NER Fleet Intelligence, and open it.

.DESCRIPTION
    One entry point: double-click Start-Demo.cmd. It starts only what is not
    already running, waits until each part actually answers, and opens the
    manager and driver applications.

    WHAT IT WILL NOT DO

    No migrations, no test run, no npm install, no password reset. A launcher
    that reseeds on every start is a launcher that destroys the rehearsal it was
    meant to open - and one that reinstalls packages turns a ten-second start
    into a coffee break. Missing prerequisites are REPORTED with the exact
    command to fix them, not fixed silently.

    THE DATABASE IS THE ISOLATED CLUSTER, ALWAYS

    `backend/.env` points at shared Supabase. This script arms the isolated
    target for the backend it starts, the same way the test suite does, so a
    demonstration can never write to the shared project. If the isolated cluster
    is not running it is started; if it cannot be started, the launcher stops
    rather than falling through to whatever else is configured.

    WHAT STOP-DEMO STOPS

    Only what this script started, recorded by pid in .runtime/demo-services.json
    with the port each one was started for. A service that was already running
    when you launched is left alone, because you were probably using it.
#>

[CmdletBinding()]
param(
    # Skip opening browser windows - useful when re-running to repair one service.
    [switch]$NoBrowser,

    # Bind the API to every interface so a PHONE on the same Wi-Fi can reach it.
    #
    # OFF BY DEFAULT, AND THAT IS THE POINT. Without this the API listens on
    # 127.0.0.1 and is reachable only from this laptop, which is the right
    # default for a machine that also runs the database. A phone's "localhost"
    # is the phone, so an installed APK cannot reach a loopback-bound server at
    # all - hence this switch, used deliberately, for the length of a demo.
    #
    # WHAT THIS DOES NOT DO: it does not touch the firewall, and it does not
    # expose the DATABASE. Postgres stays on 127.0.0.1:55432 and the model
    # server, when one exists, stays on loopback too. Only the authenticated
    # API moves, and Windows Firewall must still be allowing inbound TCP 8000
    # on the PRIVATE profile or the phone will time out. See docs/DEMO.md.
    [switch]$Lan
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime"
$StateFile = Join-Path $Runtime "demo-services.json"

$MANAGER_URL = "http://localhost:5173"
$DRIVER_URL = "http://localhost:8081"
$BACKEND_URL = "http://127.0.0.1:8000"

function Write-Step($msg) { Write-Host "  $msg" }
function Write-Good($msg) { Write-Host "  OK    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  ..    $msg" -ForegroundColor Yellow }
function Write-Bad($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

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

function Wait-Port([int]$Port, [int]$Seconds, [string]$What) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Port $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    Write-Bad "$What did not open port $Port within ${Seconds}s."
    return $false
}

# --- Services this run started, so Stop-Demo can be precise ---------------
$Started = New-Object System.Collections.ArrayList
function Record($name, $proc, $port) {
    [void]$Started.Add([pscustomobject]@{
            name      = $name
            pid       = $proc.Id
            port      = $port
            startedAt = (Get-Date).ToString("o")
        })
}

Write-Host ""
Write-Host "NER Fleet Intelligence - demo launcher" -ForegroundColor Cyan
Write-Host "  project: $Root"
Write-Host ""

# =========================================================================
# 1. Isolated database
# =========================================================================
Write-Host "[1/5] isolated database (127.0.0.1:55432)"

$pgData = Join-Path $Runtime "data"
$pgCtl = Join-Path $Runtime "pg\pgsql\bin\pg_ctl.exe"
$pgPass = Join-Path $Runtime "pgpass.txt"

if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
    Write-Bad "No isolated cluster at $pgData."
    Write-Step "This demo needs the LS-7 isolated PostgreSQL/PostGIS cluster."
    exit 1
}
if (-not (Test-Path $pgPass)) {
    Write-Bad "Missing $pgPass - the isolated cluster password."
    exit 1
}

if (Test-Port 55432) {
    Write-Good "already running (left alone)"
}
else {
    if (-not (Test-Path $pgCtl)) {
        Write-Bad "pg_ctl not found at $pgCtl, and nothing is listening on 55432."
        exit 1
    }
    Write-Warn2 "starting..."
    $log = Join-Path $Runtime "server.log"
    # A child Postgres process may inherit the PowerShell pipeline handle,
    # leaving `pg_ctl | Out-Null` waiting after pg_ctl itself has exited.
    # Bound the launcher process; never stop or delete the database to recover.
    $pgStart = Start-Process -FilePath $pgCtl -ArgumentList @('-D', ('"' + $pgData + '"'), '-l', ('"' + $log + '"'), '-w', '-t', '25', 'start') -WindowStyle Hidden -PassThru
    if (-not $pgStart.WaitForExit(30000)) {
        Write-Warn2 "pg_ctl has not exited; checking the existing server before taking any action."
    }
    if (-not (Wait-Port 55432 25 "PostgreSQL")) {
        Write-Step "Look at $log for the reason."
        exit 1
    }
    Write-Good "started"
}

# Arm the isolated target for the child processes only. backend/.env is never
# read from or written to; environment variables win over env_file.
$pw = (Get-Content $pgPass -Raw).Trim()
$dbUrl = "postgresql+psycopg://ner_test:$pw@127.0.0.1:55432/ner_logistics_test"
$env:DATABASE_PROVIDER = "local"
$env:LOCAL_DATABASE_URL = $dbUrl
$env:MIGRATION_DATABASE_URL = $dbUrl
Write-Good "target armed: 127.0.0.1:55432/ner_logistics_test (shared Supabase NOT used)"

# =========================================================================
# 2. Backend
# =========================================================================
Write-Host ""
Write-Host "[2/5] backend API ($BACKEND_URL)"

$py = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Bad "No virtual environment at backend\.venv."
    Write-Step "Create it once:  cd backend; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt"
    exit 1
}

if (Test-Port 8000) {
    Write-Good "already running (left alone)"
}
else {
    Write-Warn2 "starting..."
    if ($Lan) {
        # Read by pydantic-settings as API_HOST, overriding backend/.env for
        # THIS process only. Nothing on disk changes, so the next ordinary
        # start is back on loopback without anyone having to remember.
        $env:API_HOST = "0.0.0.0"
        Write-Warn2 "LAN mode: API will listen on all interfaces (0.0.0.0:8000)"
    }
    $p = Start-Process -FilePath $py -ArgumentList "run.py" `
        -WorkingDirectory (Join-Path $Root "backend") `
        -RedirectStandardOutput (Join-Path $Runtime "demo-backend.log") `
        -RedirectStandardError (Join-Path $Runtime "demo-backend.err") `
        -WindowStyle Hidden -PassThru
    Record "backend" $p 8000
    if (-not (Wait-Port 8000 45 "Backend")) {
        Write-Step "Look at .runtime\demo-backend.err for the reason."
        exit 1
    }
    Write-Good "started (pid $($p.Id))"
    if ($Lan) { Remove-Item Env:\API_HOST -ErrorAction SilentlyContinue }
}

if ($Lan) {
    # The address to put in eas.json, read off the machine rather than
    # remembered: DHCP reassigns, and a stale IP in a built APK is a phone that
    # cannot sign in with no clue why.
    $lanIps = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
    foreach ($ip in $lanIps) {
        Write-Step "Phone should use:  http://${ip}:8000"
    }
    Write-Step "If the phone times out, Windows Firewall is blocking inbound TCP 8000."
}

# Readiness, not just an open port: a listening socket says the process is up,
# not that it can reach its database.
try {
    $ready = Invoke-RestMethod -Uri "$BACKEND_URL/ready" -TimeoutSec 20
    if ($ready.status -eq "ready") {
        Write-Good "ready - provider '$($ready.provider)', $($ready.checks.database.detail)"
    }
    else {
        Write-Bad "backend answered but is not ready: $($ready | ConvertTo-Json -Compress)"
    }
}
catch {
    Write-Bad "backend did not answer /ready: $($_.Exception.Message)"
}

# =========================================================================
# 3. Manager / reviewer web
# =========================================================================
Write-Host ""
Write-Host "[3/5] manager + reviewer web ($MANAGER_URL)"

$managerDir = Join-Path $Root "manager-web"
if (-not (Test-Path (Join-Path $managerDir "node_modules"))) {
    Write-Bad "manager-web dependencies are not installed."
    Write-Step "Install them once:  cd manager-web; npm install"
    exit 1
}

if (Test-Port 5173) {
    Write-Good "already running (left alone)"
}
else {
    Write-Warn2 "starting..."
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" `
        -WorkingDirectory $managerDir `
        -RedirectStandardOutput (Join-Path $Runtime "demo-manager.log") `
        -RedirectStandardError (Join-Path $Runtime "demo-manager.err") `
        -WindowStyle Hidden -PassThru
    Record "manager-web" $p 5173
    if (-not (Wait-Port 5173 90 "Manager web")) {
        Write-Step "Look at .runtime\demo-manager.err for the reason."
        exit 1
    }
    Write-Good "started (pid $($p.Id))"
}

# =========================================================================
# 4. Driver app (Expo web)
# =========================================================================
Write-Host ""
Write-Host "[4/5] driver app ($DRIVER_URL)"

$driverDir = Join-Path $Root "driver-app"
if (-not (Test-Path (Join-Path $driverDir "node_modules"))) {
    Write-Bad "driver-app dependencies are not installed."
    Write-Step "Install them once:  cd driver-app; npm install"
    exit 1
}

if (Test-Port 8081) {
    Write-Good "already running (left alone)"
}
else {
    Write-Warn2 "starting (Expo builds its web bundle on first request - this is the slow one)..."
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run web" `
        -WorkingDirectory $driverDir `
        -RedirectStandardOutput (Join-Path $Runtime "demo-driver.log") `
        -RedirectStandardError (Join-Path $Runtime "demo-driver.err") `
        -WindowStyle Hidden -PassThru
    Record "driver-app" $p 8081
    if (-not (Wait-Port 8081 150 "Driver app")) {
        Write-Step "Look at .runtime\demo-driver.err for the reason."
        exit 1
    }
    Write-Good "started (pid $($p.Id))"
}

# =========================================================================
# 5. Record what we started, and open the apps
# =========================================================================
Write-Host ""
Write-Host "[5/5] opening"

# Merge with anything a previous launch started and left running, so a second
# launch that starts one more service does not orphan the first one's records.
$previous = @()
if (Test-Path $StateFile) {
    try {
        $previous = @(Get-Content $StateFile -Raw | ConvertFrom-Json) | Where-Object {
            $_ -and (Get-Process -Id $_.pid -ErrorAction SilentlyContinue)
        }
    }
    catch { $previous = @() }
}
$keep = @($previous | Where-Object { $n = $_.name; -not ($Started | Where-Object { $_.name -eq $n }) })
$all = @($keep) + @($Started)
# WriteAllText with an explicit no-BOM encoding. PowerShell 5.1's `-Encoding
# utf8` writes a byte-order mark (ef bb bf), and every other tool that reads
# this file - python, node, jq - then fails with "Expecting value: line 1
# column 1" on a file that looks perfectly fine in an editor.
$json = $all | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($StateFile, $json, (New-Object System.Text.UTF8Encoding($false)))

if ($Started.Count -eq 0) {
    Write-Good "everything was already running - nothing new started"
}
else {
    Write-Good "started this run: $(($Started | ForEach-Object { $_.name }) -join ', ')"
}

if (-not $NoBrowser) {
    Start-Process $MANAGER_URL
    Start-Sleep -Seconds 2
    Start-Process $DRIVER_URL
    Write-Good "opened both applications in your default browser"
}

Write-Host ""
Write-Host "Ready." -ForegroundColor Cyan
Write-Host "  Manager / reviewer : $MANAGER_URL"
Write-Host "  Driver             : $DRIVER_URL"
Write-Host "  Sign-in details    : .runtime\*-login.txt  (git-excluded, not printed)"
Write-Host ""
Write-Host "  Simulate the Assam journey : scripts\Simulate-Journey.cmd"
Write-Host "  Stop what this started     : scripts\Stop-Demo.cmd"
Write-Host ""
