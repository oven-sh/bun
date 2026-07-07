# Reproduction for BUN-2V26: StackOverflow in JSC::preCommitStackMemory during VM init (Windows).
#
# Root cause: preCommitStackMemory walks the main-thread stack from the current
# SP down to (StackBase + 128KB), touching each 4KB page so Windows commits it.
# With bun's /STACK:18MB reserve this commits ~16MB of stack in one shot at VM
# construction. If the process cannot commit that many pages (system/job commit
# charge exhausted), the guard-page fault returns STATUS_STACK_OVERFLOW instead
# of committing, and bun's VEH reports "panic: Stack overflow" before any user
# code runs.
#
# The shipped PE header is correct (18MB reserve). This is not a /STACK
# regression; it is commit-charge exhaustion on the user's machine.
#
# Amplified repro: we make the effect deterministic without touching system
# commit by (a) raising SizeOfStackReserve to 1GB so preCommitStackMemory is
# the dominant committer, and (b) running under a Job object with a 512MB
# per-process commit limit. Same mechanism as the field crash, just scaled so
# preCommitStackMemory is guaranteed to be the allocation that hits the wall.
#
# Works on the system-installed bun (tested: 1.3.14) and canary 1.4.0.
# No external tools required; PE header is patched in-place.

$ErrorActionPreference = 'Stop'

function Set-PEStackReserve([string]$path, [UInt64]$reserve, [UInt64]$commit) {
    $fs = [IO.File]::Open($path, 'Open', 'ReadWrite')
    try {
        $br = New-Object IO.BinaryReader($fs)
        $bw = New-Object IO.BinaryWriter($fs)
        $fs.Seek(0x3C, 'Begin') | Out-Null
        $peOff = $br.ReadInt32()
        $optOff = $peOff + 4 + 20
        $fs.Seek($optOff, 'Begin') | Out-Null
        $magic = $br.ReadUInt16()
        if ($magic -ne 0x20B) { throw "not a PE32+ image (magic=0x$("{0:X}" -f $magic))" }
        $fs.Seek($optOff + 72, 'Begin') | Out-Null
        $bw.Write([UInt64]$reserve)
        $bw.Write([UInt64]$commit)
        $bw.Flush()
    } finally { $fs.Close() }
}

$src = @'
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
int wmain(int argc, wchar_t** argv) {
    if (argc < 3) { fwprintf(stderr, L"usage: joblimit <limit-mb> <exe> [args...]\n"); return 2; }
    SIZE_T limitMB = (SIZE_T)wcstoull(argv[1], NULL, 10);
    wchar_t cmdline[32768] = L"";
    for (int i = 2; i < argc; i++) {
        wcscat_s(cmdline, 32768, L"\""); wcscat_s(cmdline, 32768, argv[i]); wcscat_s(cmdline, 32768, L"\" ");
    }
    HANDLE job = CreateJobObjectW(NULL, NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = {0};
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    jeli.ProcessMemoryLimit = limitMB * 1024 * 1024;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(NULL, cmdline, NULL, NULL, TRUE, CREATE_SUSPENDED, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "CreateProcess failed: %lu\n", GetLastError()); return 2;
    }
    AssignProcessToJobObject(job, pi.hProcess);
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 60000);
    DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);
    fprintf(stderr, "[joblimit] child exit=%lu (0x%lX)\n", code, code);
    return (int)code;
}
'@

$work = Join-Path $env:TEMP "bun-2v26-repro"
New-Item -ItemType Directory -Force -Path $work | Out-Null
Set-Location $work
[Environment]::CurrentDirectory = $work

# 1. Build the job-limit launcher (needs any C compiler; clang-cl used here).
Set-Content -Path "$work\joblimit.c" -Value $src
$cc = (Get-Command clang-cl -ErrorAction SilentlyContinue) ?? (Get-Command cl -ErrorAction SilentlyContinue)
if (-not $cc) { throw "need clang-cl or cl.exe in PATH" }
& $cc.Source /nologo "$work\joblimit.c" "/Fe:$work\joblimit.exe" /link /SUBSYSTEM:CONSOLE | Out-Null
if (-not (Test-Path "$work\joblimit.exe")) { throw "failed to build joblimit.exe" }

# 2. Prepare the target: a standalone exe built by the system-installed bun.
$bun = (Get-Command bun).Source
Write-Host "bun: $bun"
& $bun --version
Set-Content -Path "$work\hello.js" -Value "console.log('ok');"
& $bun build --compile "$work\hello.js" --outfile "$work\app.exe" | Out-Null
Copy-Item "$work\app.exe" "$work\app-bigstack.exe" -Force

# 3. Amplify: raise SizeOfStackReserve to 1GB (SizeOfStackCommit 64KB).
Set-PEStackReserve -path "$work\app-bigstack.exe" -reserve 0x40000000 -commit 0x10000

# 4. Run N times under a 512MB commit limit.
$N = 20; $hits = 0
for ($i = 0; $i -lt $N; $i++) {
    $out = & "$work\joblimit.exe" 512 "$work\app-bigstack.exe" 2>&1 | Out-String
    if ($out -match 'Stack overflow') { $hits++ }
}
Write-Host ""
Write-Host "RESULT: 'panic: Stack overflow' in $hits / $N runs (amplified: reserve=1GB, job commit=512MB)"
Write-Host ""
Write-Host "Control (unmodified PE, same 512MB limit):"
$ctrl = 0
for ($i = 0; $i -lt 5; $i++) {
    $out = & "$work\joblimit.exe" 512 "$work\app.exe" 2>&1 | Out-String
    if ($out -match 'child exit=0 ') { $ctrl++ }
}
Write-Host "  unmodified exe: $ctrl / 5 ok"
