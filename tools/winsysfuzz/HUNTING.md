# Hunting with winsysfuzz

The handoff for a bug-hunting session. `README.md` explains the design and
why; this file is the how, plus everything the calibration runs taught us.

## Setup (once per box)

Prerequisites are the ones building bun already needs: VS 2022 (C++), CMake,
git, a `bun` on PATH. From `tools/winsysfuzz`:

```powershell
.\setup.ps1 -InstallDebuggers   # -InstallDebuggers adds cdb.exe (hang/crash
                                  # stack capture); without it everything runs
                                  # but findings carry no stacks
```
It checks prerequisites, builds `winsysfuzz.dll` / `wsfrun.exe` /
`wsfsym.exe`, and self-tests by tracing your `bun` running a one-liner.

Every command below takes `--bun <path>`: point it at the binary you want
to hunt on — `build\debug\bun-debug.exe`, a release build, or the shipped
`bun.exe`. The interceptor works on the unmodified binary.

## The hunting loop

**1. Check your target scenario is healthy under interception.**
```powershell
bun driver\coverage.ts --bun <bun.exe>
```
Runs the workload suite. Every scenario should report `ok`; a
`BASELINE-HANG`/`BASELINE-CRASH` means the interceptor or workload is broken
— fix that first, it is not a bun bug. The output also lists which
injectable syscalls the suite reaches and the gap list of ones it doesn't.

**2. Sweep a program.**
```powershell
bun driver\sweep.ts --bun <bun.exe> --program <script.js> --plan-only   # cost first
bun driver\sweep.ts --bun <bun.exe> --program <script.js> --timeout 30 --jobs 6
```
`--plan-only` runs one baseline and prints the coordinate count and time
estimate — always look before launching a big one. Point `--program` at a
workload from `workloads\`, or your own script (cwd-relative paths keep
parallel workers from colliding). Narrow with `--syscalls a,b` or
`--modules libuv,bun-rust`. Watch it live:
`Get-Content C:\wsfsweep\<stamp>\sweep-progress.jsonl -Wait`.

**3. Read the findings.** The sweep prints `FINDINGS`, each with a verdict
(see below). The full result table is `sweep-report.json` in the same
timestamped directory; each result row carries a ready-made `schedule` line.

**4. Triage a finding.**
```powershell
bun driver\repro.ts --bun <bun.exe> --schedule "NtDeviceIoControlFile 189e64f 1 pre C000009A" `
    --program <script.js> --times 3
```
Writes `finding.md`: determinism ratio, the true owning callsite
(symbolized across all candidate stack frames), per-run output, live thread
stacks for a HANG (captured before the kill), the faulting stack for a CRASH,
and a copy-pasteable repro command. This is what you file a bug from.

**5. Hostile arguments** (the other attack direction).
```powershell
bun driver\hostile.ts --bun <bun.exe>
```
Feeds bun Windows path poison and reports, per poison, the JS-visible outcome
next to the NT path that actually reached the kernel — reached / not-reached
/ blocked. A CRASH or an unexpected `blocked` is a finding; so is a poison
that reaches the kernel where bun should have validated it.

## Reading verdicts (the anti-false-positive gate)

Every CRASH/HANG the parallel sweep sees is replayed standalone x3 at double
the timeout before being reported:

- **confirmed** — reproduces standalone. Real, deterministic, replayable. Chase it.
- **slow** — finishes given more time. Not the infinite hang the sweep implied,
  but a genuine slowness symptom under that fault; worth a look.
- **load-dependent** — bad only under sweep parallelism. Could still be a real
  timing bug, but it is *not* the deterministic finding it looked like. Lower
  priority; re-verify under load if you care.
- **not-reproduced** — didn't recur; nondeterministic callsite (GC-driven
  allocation sites do this). Skip.

## Severity: when a crash is (not) a bun bug

Each fault carries an expectation class, and the report says which:

- **must-handle** — fs, sockets, pipes, spawn. An injected failure must
  surface as an error; a CRASH or HANG here is a real bug candidate. Sorts first.
- **abort-expected** — allocator failure (`NtAllocateVirtualMemory` ->
  `STATUS_NO_MEMORY`). Crash-on-OOM is by design (WebKit `CRASH()`, Rust alloc
  abort). Reported as `expected-abort`, not a bug.
- **judgment** — `post` (the API lies about failing) and `delay` faults. Real
  behavior, but "correct" is a human call.

Note what is deliberately NOT excluded: "a status the vanilla kernel never
returns." AV/EDR minifilters and filter drivers sit in the syscall path on
real machines and return exotic statuses and mangled output all the time.
bun crashing on a weird-but-*filter-driver-plausible* result is a real
robustness bug — the "works here, crashes on the customer's corporate laptop"
class. That's what `mangle` mode probes.

## What the trace tells you

`bun driver\analyze.ts <wsf-log> --sym <bun.exe> --status --callsites` turns
any run's log into a per-syscall census plus a per-module census (which of
bun's Rust, libuv, WebKit, mimalloc, boringssl, ... reached which syscall).
Callsites are `bun+0xRVA`; resolve any of them by hand with
`build\Release\wsfsym.exe <bun.exe> <rva>`.

## Calibration observations (leads, not verified bugs)

These fell out of proving the tool. They are starting points for you to
confirm or dismiss — the instrument reported them, nobody triaged them:

- `NtDeviceIoControlFile` faulted (`STATUS_INSUFFICIENT_RESOURCES`) at libuv's
  `uv__msafd_poll` (socket poll setup): bun's event loop **hangs indefinitely**
  (confirmed 3/3 standalone, still hung at 80s). Hang stacks show the main
  thread parked in `uv__poll` (IOCP wait) under `uv_run` <- `us_loop_run` <-
  `WindowsLoop::tick_with_timeout` — waiting for a completion that never
  arrives. Reproduce from the sweep report's schedule line.
- `mangle:short` on a file read: kernel read 100 bytes, we reported 50, and
  `readFileSync` returned 50 with exit 0 and no error — the short count taken
  as final (silent truncation). Whether `readFile` should loop on a short read
  is your call; the mechanism is one command away.
- `bun:sqlite`: right after `db.close()` the database file is still locked on
  Windows (`unlink` -> `EBUSY`).
- Hostile args: `CON` maps to `\??\CONIN$` and a read blocks forever
  (expected console semantics, but note it); trailing dot/space are stripped
  before the syscall; embedded NUL is rejected in userland.

## Known limits

- **Loader-phase blind spot**: syscalls the loader makes before any `DllMain`
  runs (import mapping, DLL search probing) are invisible to in-process
  hooking. That's OS init, not bun code — validated against NtTrace, all of
  bun's own syscalls match exactly.
- **Module reach**: the current workload suite lights up bun's Rust, libuv,
  WebKit, mimalloc, rust-std and the CRT — but not boringssl or c-ares (crypto
  rarely syscalls; DNS goes through libuv's threadpool). Add a TLS-handshake or
  c-ares-forcing workload if you want those rows.
- **Nothing is deleted, ever.** Output roots (`C:\wsfsweep`, `C:\wsfcov`,
  `C:\wsfhostile`, `C:\wsfrepro`) are timestamped per invocation and accumulate.
  Every run's full test case (schedule + program + trace + stdout) stays on
  disk. Prune old runs yourself when disk demands it.
