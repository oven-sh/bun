# One-command bring-up for winsysfuzz on a fresh Windows box.
#
#   .\setup.ps1                     verify prerequisites, build, self-test
#   .\setup.ps1 -InstallDebuggers   also install Debugging Tools for Windows
#                                   (cdb.exe: hang/crash capture; admin, ~1min)
#
# Prerequisites are exactly what building bun itself needs: Visual Studio
# 2022 (C++ workload), CMake, git, and a bun on PATH. Everything else is
# handled here or fetched by CMake (Microsoft Detours).

param(
  [switch]$InstallDebuggers
)
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$ok = $true

function Check($name, $found, $hint) {
  if ($found) { Write-Host ("  [ok]      {0}" -f $name) -ForegroundColor Green }
  else { Write-Host ("  [MISSING] {0} -- {1}" -f $name, $hint) -ForegroundColor Red; $script:ok = $false }
}

Write-Host "winsysfuzz setup" -ForegroundColor Cyan
Write-Host "-- prerequisites --"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = (Test-Path $vswhere) -and (& $vswhere -latest -property installationPath)
Check "Visual Studio 2022 (C++)" $vs "install VS 2022 with the Desktop C++ workload"
Check "cmake" (Get-Command cmake -ErrorAction SilentlyContinue) "install CMake"
Check "git" (Get-Command git -ErrorAction SilentlyContinue) "install git"
$bun = Get-Command bun -ErrorAction SilentlyContinue
Check "bun (drives the TS tooling)" $bun "install bun and put it on PATH"

# Debugging Tools: optional; gates hang/crash CAPTURE only.
$cdb = @(
  "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\cdb.exe",
  "${env:ProgramFiles}\Windows Kits\10\Debuggers\x64\cdb.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cdb -and $InstallDebuggers) {
  Write-Host "  installing Debugging Tools for Windows..." -ForegroundColor Yellow
  $s = "$env:TEMP\winsdksetup.exe"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest 'https://go.microsoft.com/fwlink/?linkid=2261842' -OutFile $s -UseBasicParsing
  $p = Start-Process $s -ArgumentList '/features OptionId.WindowsDesktopDebuggers /quiet /norestart' -Wait -PassThru
  $cdb = "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\cdb.exe"
  if (-not (Test-Path $cdb)) { $cdb = $null }
}
if ($cdb) { Write-Host ("  [ok]      cdb.exe (hang/crash capture)") -ForegroundColor Green }
else { Write-Host "  [opt]     cdb.exe absent: capture disabled (rerun with -InstallDebuggers)" -ForegroundColor Yellow }

if (-not $ok) { Write-Host "`nMissing prerequisites; fix and rerun." -ForegroundColor Red; exit 1 }

Write-Host "-- build --"
& bun run build 2>&1 | Select-String " error |: error|winsysfuzz.dll|wsfrun.exe|wsfsym.exe" | ForEach-Object { $_.Line }
$dll = Test-Path .\build\Release\winsysfuzz.dll
$run = Test-Path .\build\Release\wsfrun.exe
$sym = Test-Path .\build\Release\wsfsym.exe
if (-not ($dll -and $run -and $sym)) { Write-Host "build did not produce all binaries" -ForegroundColor Red; exit 1 }
Write-Host "  binaries built" -ForegroundColor Green

Write-Host "-- self-test (trace this bun running a one-liner) --"
$logDir = Join-Path $env:TEMP 'wsf-selftest'
New-Item -ItemType Directory -Force $logDir | Out-Null
Get-ChildItem $logDir -Filter 'wsf-*.log' | Remove-Item -Force -ErrorAction SilentlyContinue
$env:WSF_LOG_DIR = $logDir
$env:WSF_MODE = 'trace'
$env:BUN_DEBUG_QUIET_LOGS = '1'
$out = & .\build\Release\wsfrun.exe -- $bun.Source -e "console.log('selftest-ok')" 2>&1
Remove-Item Env:WSF_LOG_DIR, Env:WSF_MODE -ErrorAction SilentlyContinue
$log = Get-ChildItem $logDir -Filter 'wsf-*.log' | Select-Object -First 1
$records = if ($log) { (Get-Content $log.FullName | Where-Object { $_ -match '^[XE] ' } | Measure-Object).Count } else { 0 }
$attached = if ($log) { (Get-Content $log.FullName | Where-Object { $_ -like '# attached*' }) } else { '' }
$printed = ($out -join ' ') -match 'selftest-ok'
if ($printed -and $records -gt 100) {
  Write-Host ("  [ok] target ran under interception: {0} syscall records, {1}" -f $records, $attached.Trim('# ')) -ForegroundColor Green
} else {
  Write-Host ("  [FAIL] self-test: printed={0} records={1}" -f $printed, $records) -ForegroundColor Red
  Write-Host ($out -join "`n")
  exit 1
}

Write-Host "`nREADY." -ForegroundColor Green
Write-Host "  trace:   .\driver\run.ps1 -- <bun.exe> <script.js>"
Write-Host "  analyze: bun driver\analyze.ts <log> --sym <bun.exe>"
Write-Host "  sweep:   bun driver\sweep.ts --bun <bun.exe> --program <script.js> [--plan-only]"
Write-Host "  triage:  bun driver\repro.ts --bun <bun.exe> --schedule ""<line>"" --program <script.js>"
