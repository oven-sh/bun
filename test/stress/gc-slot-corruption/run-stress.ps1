param(
  [int]$Iterations = 30,
  [int]$Seconds = 60,
  [string]$Script = "C:\tmp\gc-stress2.js",
  [string]$Bun = "C:\Windows\system32\bun.exe",
  [string]$ExtraJsc = ""
)
$ErrorActionPreference = 'Continue'

$env:BUN_CRASH_REPORT_URL = 'none'
$env:BUN_DEBUG_QUIET_LOGS = '1'
$env:BUN_JSC_collectContinuously = '1'
$env:BUN_JSC_collectContinuouslyPeriodMS = '0.3'
$env:BUN_JSC_useConcurrentGC = '1'
$env:BUN_JSC_numberOfGCMarkers = '8'
$env:BUN_JSC_slowPathAllocsBetweenGCs = '97'
$env:BUN_JSC_forceRAMSize = '268435456'
$env:STRESS_MS = ($Seconds * 1000).ToString()
$env:STRESS_QUIET = '1'
foreach ($kv in ($ExtraJsc -split ';')) {
  if ($kv -match '^(\w+)=(.+)$') { Set-Item "Env:BUN_JSC_$($Matches[1])" $Matches[2] }
}

$hits = 0
for ($i = 1; $i -le $Iterations; $i++) {
  $stderr = [System.IO.Path]::GetTempFileName()
  $p = Start-Process -FilePath $Bun -ArgumentList $Script `
        -NoNewWindow -PassThru -Wait `
        -RedirectStandardError $stderr -RedirectStandardOutput 'NUL'
  $code = $p.ExitCode
  $err = (Get-Content $stderr -Raw)
  Remove-Item $stderr -ErrorAction SilentlyContinue
  $codeHex = "0x{0:X8}" -f ([uint32]$code)
  $hit = $false
  $tail = ''
  if ($code -ne 0) {
    if ($err -match 'Segmentation|SIGSEGV|loadAndFence|aboutToMark|visitChildren|MarkedBlock|SlotVisitor') { $hit = $true }
    if ($err) {
      $tail = ' | ' + (($err -split "`n" | Where-Object { $_ -match 'panic|Segmentation|fault|0x' -or $_ -match '\S' } | Select-Object -Last 4) -join ' / ')
    }
  }
  Write-Output ("[{0,3}/{1}] exit={2} {3}{4}" -f $i, $Iterations, $code, $codeHex, $tail)
  if ($hit) {
    $hits++
    Write-Output '--- FULL STDERR (hit) ---'
    Write-Output $err
    Write-Output '-------------------------'
  }
}
Write-Output ""
Write-Output "=== $hits segfault hit(s) / $Iterations ==="
