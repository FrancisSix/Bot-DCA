# install-keeper-task.ps1 — register the BOT DCA keeper as a durable Windows task.
#
# Creates (or replaces) a per-user Scheduled Task that runs the supervisor
# (run-keeper.ps1) at logon, keeps it alive, and never stops on battery.
# The supervisor itself restarts the keeper if it crashes, so between the two
# the keeper survives reboots, logoffs, and crashes.
#
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File install-keeper-task.ps1
# Remove: Unregister-ScheduledTask -TaskName 'BotDCA-Keeper' -Confirm:$false

$ErrorActionPreference = "Stop"
$TaskName = "BotDCA-Keeper"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here "run-keeper.ps1"

if (-not (Test-Path $script)) {
  throw "run-keeper.ps1 not found next to this script ($script)"
}
if (-not (Test-Path (Join-Path $here ".env"))) {
  Write-Warning "keeper/.env not found - the keeper will exit until you create it."
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
  -WorkingDirectory $here

# At logon, plus a 10-minute repetition as a backstop if the supervisor is killed.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Omit -RepetitionDuration so the repetition runs indefinitely (MaxValue is out of range).
$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 10)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($logonTrigger, $repeatTrigger) `
  -Settings $settings `
  -Principal $principal `
  -Description "BOT DCA keeper supervisor (BOT Chain testnet). Restarts on crash, boot and logon." `
  -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State | Format-Table -AutoSize
