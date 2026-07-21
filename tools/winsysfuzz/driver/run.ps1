# Runs a target under wsfrun with a hard timeout, then summarizes the trace.
# The timeout is mandatory by construction: a hang reports RESULT: HANG and
# kills the tree instead of blocking the caller.
#
#   .\driver\run.ps1 [-TimeoutSec 60] [-LogDir C:\wsflogs] [-Schedule <file>] -- <program> [args...]
#
# Emits key=value lines the JS driver parses:
#   RESULT=exit|hang  EXIT=<code>  MS=<elapsed>  LOG=<path>  RECORDS=<n>

# PositionalBinding=$false: otherwise the target's own arguments would bind
# positionally to LogDir/Schedule/Mode instead of overflowing into $Target.
[CmdletBinding(PositionalBinding = $false)]
param(
  [int]$TimeoutSec = 60,
  [string]$LogDir = 'C:\wsflogs',
  [string]$Schedule = '',
  [string]$Mode = '',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Target
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$wsfrun = Join-Path (Split-Path -Parent $here) 'build\Release\wsfrun.exe'
if (-not (Test-Path $wsfrun)) { "RESULT=error"; "ERROR=wsfrun.exe missing; run bun run build"; exit 2 }

if ($Target.Count -gt 0 -and $Target[0] -eq '--') { $Target = $Target[1..($Target.Count - 1)] }
if ($Target.Count -eq 0) { "RESULT=error"; "ERROR=no target"; exit 2 }

New-Item -ItemType Directory -Force $LogDir | Out-Null
Get-ChildItem $LogDir -Filter 'wsf-*.log' | Remove-Item -Force -ErrorAction SilentlyContinue
$env:WSF_LOG_DIR = $LogDir
# Debug builds interleave scoped logs into the target's own output; the trace
# already captures the syscalls, so silence them to keep stdout readable.
$env:BUN_DEBUG_QUIET_LOGS = '1'
$env:WSF_MODE = $(if ($Mode) { $Mode } elseif ($Schedule) { 'inject' } else { 'trace' })
if ($Schedule) { $env:WSF_SCHEDULE = $Schedule } else { Remove-Item Env:WSF_SCHEDULE -ErrorAction SilentlyContinue }

$outFile = Join-Path $LogDir 'stdout.txt'
$errFile = Join-Path $LogDir 'stderr.txt'
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process $wsfrun -ArgumentList (@('--') + $Target) -PassThru -NoNewWindow `
  -RedirectStandardOutput $outFile -RedirectStandardError $errFile
$null = $p.Handle # cache the handle so ExitCode is retrievable (PS 5.1 quirk)
$finished = $p.WaitForExit($TimeoutSec * 1000)
$ms = [int]$sw.Elapsed.TotalMilliseconds

if (-not $finished) {
  Get-Process wsfrun,bun-debug,bun -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  "RESULT=hang"
} else {
  "RESULT=exit"
  "EXIT={0}" -f $p.ExitCode
}
"MS=$ms"
$log = Get-ChildItem $LogDir -Filter 'wsf-*.log' | Sort-Object LastWriteTime | Select-Object -Last 1
if ($log) {
  "LOG=$($log.FullName)"
  "RECORDS=$((Get-Content $log.FullName | Where-Object { $_ -match '^[XE] ' } | Measure-Object).Count)"
}
"STDOUT=$outFile"
"STDERR=$errFile"
