Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object {
  $_.CommandLine -match 'sim-capture' -or $_.CommandLine -match 'index\.ts'
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
  Write-Output ("killed " + $_.ProcessId + " " + $_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))
}
