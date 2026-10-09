# Starts the Glorious HR stack after a PC reboot / login.
# Safe to run repeatedly: skips anything that is already up.
#
#   .\start-app.ps1
#
# Log: start-app.log (next to this script)

$ErrorActionPreference = 'Stop'
$ROOT    = Split-Path -Parent $MyInvocation.MyCommand.Path
$PGCTL   = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
$PGDATA  = Join-Path $ROOT 'postgres-data'
$BACKEND = Join-Path $ROOT 'backend'
$FRONT   = Join-Path $ROOT 'frontend'
$NODE    = 'C:\Program Files\nodejs\node.exe'
$LOG     = Join-Path $ROOT 'start-app.log'

function Write-Log($msg) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $LOG -Value $line
}

function Test-Port($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Port($port, $seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Port $port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

try {
    # 1. Database ------------------------------------------------------------
    if (Test-Port 5432) {
        Write-Log 'database: already listening on 5432'
    } else {
        # Clear a stale pid left by an unclean shutdown, otherwise pg_ctl
        # refuses to start and the whole stack stays down after a reboot.
        $pidFile = Join-Path $PGDATA 'postmaster.pid'
        if (Test-Path $pidFile) {
            $oldPid = 0
            try { $oldPid = [int](Get-Content $pidFile | Select-Object -First 1) } catch {}
            if ($oldPid -gt 0 -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
                Write-Log "database: stale pid $oldPid belongs to a live process - leaving it"
            } else {
                Write-Log "database: removing stale postmaster.pid (pid $oldPid is dead)"
                Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Log 'database: starting project cluster on 5432'
        if (-not (Test-Path $PGCTL)) { throw "pg_ctl not found at $PGCTL" }
        # Launch pg_ctl fully detached and without -w. Calling it with &
        # and `*> $null` deadlocks the script on PowerShell 5.1 (the server
        # starts, but this script blocks forever reading the child's pipes).
        # We poll the port ourselves instead.
        $pgArgs = '-D "' + $PGDATA + '" -l "' + (Join-Path $PGDATA 'server.log') + '" -t 90 start'
        Start-Process -FilePath $PGCTL -ArgumentList $pgArgs -WindowStyle Hidden | Out-Null
        # First boot after a crash can spend ~35s syncing the data directory.
        if (-not (Wait-Port 5432 90)) { throw 'database did not come up on 5432' }
        Write-Log 'database: up'
    }

    # 2. Backend API ---------------------------------------------------------
    if (Test-Port 5000) {
        Write-Log 'backend: already listening on 5000'
    } else {
        Write-Log 'backend: starting node api'
        $out = Join-Path $BACKEND 'runtime.log'
        $err = Join-Path $BACKEND 'runtime.log.err'
        Start-Process -FilePath $NODE -ArgumentList 'src\index.js' -WorkingDirectory $BACKEND `
            -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
        if (-not (Wait-Port 5000 30)) { throw 'backend did not come up on 5000' }
        Write-Log 'backend: up'
    }

    # 3. Frontend dev server -------------------------------------------------
    if (Test-Port 3000) {
        Write-Log 'frontend: already listening on 3000'
    } else {
        Write-Log 'frontend: starting vite dev server'
        Start-Process -FilePath 'C:\Program Files\nodejs\npm.cmd' `
            -ArgumentList @('run', 'dev') -WorkingDirectory $FRONT `
            -WindowStyle Minimized -RedirectStandardOutput (Join-Path $FRONT 'runtime.log') `
            -RedirectStandardError (Join-Path $FRONT 'runtime.log.err') | Out-Null
        Write-Log 'frontend: launched (vite needs a few seconds)'
    }

    Write-Log 'done'
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
}