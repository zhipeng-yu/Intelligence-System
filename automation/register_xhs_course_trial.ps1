param(
  [Parameter(Mandatory = $true)][string]$Python,
  [Parameter(Mandatory = $true)][string]$Runner,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][datetime]$StartBoundary,
  [Parameter(Mandatory = $true)][datetime]$EndBoundary,
  [Parameter(Mandatory = $true)][string]$TaskName
)

$action = New-ScheduledTaskAction -Execute $Python -Argument ('"{0}" run' -f $Runner) -WorkingDirectory $WorkingDirectory
$trigger = New-ScheduledTaskTrigger -Daily -At $StartBoundary
$trigger.StartBoundary = $StartBoundary.ToString('yyyy-MM-ddTHH:mm:ss')
$trigger.EndBoundary = $EndBoundary.ToString('yyyy-MM-ddTHH:mm:ss')
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description '小红书公开课程产品 7 天最小试运行' -Force | Out-Null
