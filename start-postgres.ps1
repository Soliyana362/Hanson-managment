# Starts the Glorious HR PostgreSQL server against the project data folder.
# Launches postgres.exe directly with a clean environment to avoid the
# 0xC0000142 DLL-init crash caused by a stale "PostgreSQL\16" entry on PATH.
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
$pg    = "C:\Program Files\PostgreSQL\18\bin\postgres.exe"
$data  = Join-Path $PSScriptRoot "postgres-data"
$log   = Join-Path $data "server.log"

if (Test-Path (Join-Path $data "postmaster.pid")) {
    Write-Host "PostgreSQL already running (postmaster.pid present)."
    exit 0
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName               = $pg
$psi.Arguments              = "-D `"$data`""
$psi.UseShellExecute        = $false
$psi.CreateNoWindow         = $true
$psi.Environment["PATH"]    = "C:\Windows\System32;C:\Windows;C:\Program Files\PostgreSQL\18\bin"
$psi.Environment["SYSTEMROOT"] = "C:\Windows"
$psi.Environment["COMSPEC"] = "C:\Windows\System32\cmd.exe"

$p = [System.Diagnostics.Process]::Start($psi)
Write-Host "PostgreSQL started (PID $($p.Id)). Log: $log"