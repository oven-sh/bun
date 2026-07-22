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

## Fastest path: hunt over bun's own test suite

One command, one file to read. The test suite is the corpus - thousands of
realistic programs already exercising every subsystem, each with its own
assertions and timeouts as the oracle:

```powershell
bun driver\hunt.ts --bun <bun.exe> --tests C:\bun\test\js\node\fs --limit 20 --parallel 3
```
Every `*.test.*` file becomes a `bun test <file>` target. Each is swept
(baseline -> enumerate -> inject -> auto-verify), sweeps run `--parallel`
at a time, and everything rolls into `C:\wsfhunt\<stamp>\hunt-findings.md`
- per-target outcome tallies, then finding cards, `confirmed` first. bun
children the tests spawn are traced and faulted too (recursive injection),
so subprocess-heavy tests are covered. Also works on the workload suite
(default) or explicit programs (`--programs a.js,b.js`).

Throughput: a small test file sweeps in ~20s; heavy ones a few minutes.
Sweeps are independent, so raise `--parallel` (and lower per-sweep
`--jobs`) to use the box. More load means more `load-dependent` verdicts;
that's exactly what the verify gate exists to sort out, and it does.

## Writing target scripts (the contract)

When no test covers what you want faulted, write a target. Rules an agent
can follow mechanically:

- **cwd-relative paths only** (`fs.writeFileSync("a.txt")`, `port: 0`) so
  parallel sweep workers, each in its own directory, cannot collide.
- **`console.log("STAGE: <name>")` before each step** - a hang or slow run
  then reports the last stage reached, localizing the failure for free.
- **Fast and deterministic** - well under 2s, no wall-clock output, no counts
  of transient directory contents (those show up as spurious `diverged`), no
  external network, no fixed ports.
- **Self-verifying output** on the last line (`console.log("net ok tcp=... udp=...")`)
  so a diverged run's stdout tells you what changed.
- **One subsystem per file.** To generate one: read that subsystem's tests
  under `test/js/...`, lift the API calls, wrap them in stages. See
  `workloads/*.js` for the shape.

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
bun driver\repro.ts --bun <bun.exe> --schedule "NtDeviceIoControlFile b:189e64f 1 pre C000009A" `
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

- **The retracted lead - and why keys were redesigned.** An earlier hunt
  reported `NtCreateThreadEx` -> `STATUS_INSUFFICIENT_RESOURCES` hanging bun,
  "confirmed" across seven test targets. A second look on a quiet box could
  NOT reproduce it (no-fire): its key frame `__ascii_strnicmp+0xba` was a
  stack leftover, not a caller, so the coordinate fired only when load shaped
  the stack. That is why the schedule key is now the syscall's immediate
  return address (module-tagged) rather than a scraped frame - see
  README. Any thread-creation-failure lead must be re-derived under the new
  keys before it is believed; the pre-redesign roll-ups (`C:\wsfhunt` runs
  before 2026-07-22) use unstable keys and should not be triaged.

- Socket poll setup: fault `NtCreateFile` at libuv's `uv__msafd_poll` (the
  AFD-device open for fast-poll) during `http-serve-and-fetch`, or
  `NtDeviceIoControlFile` in the UDP setup path during `udp-roundtrip`: bun
  **hangs indefinitely** (confirmed 3/3 standalone, still hung at 60s). The
  stack digest shows the main thread parked in `NtRemoveIoCompletionEx` <-
  `GetQueuedCompletionStatusEx` <- `uv__poll` <- `uv_run` <- `us_loop_run`
  — the event loop waiting for a completion that never comes because the
  setup failure was swallowed. The status differential is the lead: at that
  same callsite `STATUS_ACCESS_DENIED` / `STATUS_SHARING_VIOLATION` finish at
  ~29.6s (some timeout path covers them) while `STATUS_OBJECT_NAME_NOT_FOUND`
  hangs forever — an error path exists but doesn't cover every status.
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


## Reach limit: same-thread ordering bugs (2026-07-22, the watcher UAF)

The largest actionable Windows crash class in field telemetry is a segfault
under `uv__process_fs_event_req` — a directory-change completion dispatched
into a `PathWatcher` that `close()` has already freed. Extensive attack on
this target (`workloads/fs-watch-churn.js`) established:

- The watcher's arm path (`NtNotifyChangeDirectoryFileEx`) tolerates every
  fault we can express: `DELETE_PENDING` (watched dir deleted mid-watch),
  resource failure, and arm delay — all clean, deterministic.
- Delaying completion *delivery* (`NtRemoveIoCompletionEx` at several depths,
  and compounded with an arm delay) is also clean.

Why the technique cannot reach it: this is a **same-thread ordering** bug —
the completion must be dequeued and dispatched into a watcher whose memory
`close()` released, an interleaving *inside one loop iteration*. Our lever
is a per-syscall return perturbation (fail / delay / mangle). A delay makes
everything late *together*; it cannot make a queued completion be processed
after a close that the same loop queues later. No return-address fault
reorders work within a thread. Do not resume chaos on this workload
expecting the field crash — that requires source-level instrumentation of the
close/callback ordering, which is out of scope for a binary syscall fuzzer.
The workload stays as *error-path coverage* (arm/delivery failures), which
it has swept clean.

Corollary for target selection: prefer field crash classes whose fault is an
**error return, short/garbage transfer, or resource exhaustion** — those are
exactly our levers. Deprioritize UAF/ordering signatures.


## Socket payload faults: send works, receive needs completion-time application (2026-07-22)

Rules can key socket ioctls by decoded AFD code (`afd:SEND`, `afd:RECV`) at
any callsite, and the runtime follows the WSABUF indirection.

- `afd:SEND` + `mangle:short`: WITHDRAWN result. The earlier 'fired, verified
  clean' probes were reading the AFD_SEND_INFO through the codegen bufIndex,
  which is -1 for ioctls, so the WSABUF.len shrink never ran - `fired=1`
  meant only that the rule matched, not that the payload changed. Partial
  sends were NOT actually tested. (Root cause below; retest required.)
- `afd:RECV` + `mangle:garbage`: does NOT fire, and correctly so - overlapped
  WSARecv returns STATUS_PENDING and the data lands LATER via the IOCP
  completion, so an exit-time mangle finds no synchronous success to
  poison. This is a runtime gap, not a workload or coordinate problem:
  poisoning received data means catching it at COMPLETION time - remember
  {IOSB -> WSABUF array} at AFD_RECV entry, and when a dequeued completion's
  IOSB matches, poison Information bytes across those buffers. Until that
  exists, hostile-peer-data coverage of the receive path is NOT achieved;
  do not read a clean afd:RECV run as coverage.

  Correction (2026-07-22): `NtDeviceIoControlFile` is manifest id **90** in the
  regenerated table (not 210 as one earlier note assumed - 210 is
  `NtProtectVirtualMemory`). The compiled enum is correct (same codegen run);
  RESOLVED in part (match-site LogNote): the rule matcher is correct and the
  workload's data path IS \Device\Afd (AFD_RECV 0x12017 x~1000/run); a stray
  "foreign ioctl codes / second socket path" theory came from mis-sampling
  six setup-time ioctls (GetAdaptersAddresses-class device controls) and is
  WITHDRAWN - there is no second receive stack. The genuine open item is the
  COMPLETION side: matched receives are recorded but no dequeued completion
  is poisoned (count 0). The code ASSUMES AFD echoes the original
  IO_STATUS_BLOCK pointer as the completion's ApcContext; that layout
  assumption is unverified and is the next thing to instrument.
