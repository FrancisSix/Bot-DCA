# run-keeper.ps1 — supervisor for the BOT DCA keeper.
#
# Runs `npm start` in a loop and restarts it if it exits for any reason
# (crash, RPC drop, OOM). Intended to be launched by Windows Task Scheduler
# so the keeper survives logoff, reboot, and crashes.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File run-keeper.ps1

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$log = Join-Path $here "keeper-supervisor.log"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
}

# Prevent duplicate supervisors (Task Scheduler can fire more than once).
$mutexName = "Global\BotDCAKeeperSupervisor"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  Write-Log "another supervisor already holds the mutex; exiting"
  exit 0
}

if (-not (Test-Path (Join-Path $here ".env"))) {
  Write-Log "FATAL: keeper/.env is missing; cannot start"
  exit 1
}

Write-Log "supervisor started (pid $PID)"

$delaySeconds = 5
while ($true) {
  Write-Log "starting keeper (npm start)"
  $started = Get-Date

  try {
    & npm start 2>&1 | ForEach-Object { $_ | Out-String | ForEach-Object { $_.TrimEnd() } | Add-Content -Path $log }
  } catch {
    Write-Log "keeper threw: $($_.Exception.Message)"
  }

  $ranFor = (New-TimeSpan -Start $started -End (Get-Date)).TotalSeconds
  Write-Log ("keeper exited after {0:N0}s" -f $ranFor)

  # Back off only on rapid crash loops; a long healthy run resets the delay.
  if ($ranFor -lt 30) {
    $delaySeconds = [Math]::Min($delaySeconds * 2, 300)
  } else {
    $delaySeconds = 5
  }

  Write-Log "restarting in ${delaySeconds}s"
  Start-Sleep -Seconds $delaySeconds
}
