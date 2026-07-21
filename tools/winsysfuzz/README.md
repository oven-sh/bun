# winsysfuzz — Windows syscall fuzzer for bun

A manual bug-hunting tool: it fuzzes **bun's handling of the syscall
boundary** on Windows. The kernel is the trusted side; the bugs live in what
bun does with what syscalls return, and in what bun hands the kernel. Not
part of the test suite — run it when hunting.

Two attack directions, one interception layer:

- **Fault injection** — perturb what Windows *returns* to bun: an
  `ERROR_SHARING_VIOLATION` mid-install, a short read, a completion that
  reports failure for an op that succeeded. Finds error-handling and cleanup
  bugs.
- **Hostile arguments** — drive bun from JS so it hands the kernel
  Windows-specific poison (long/`\\?\` paths, `CON`/`NUL`, trailing dots,
  lone surrogates, UNC, ADS, mid-op deletion races). Finds path/encoding/
  handle-lifetime bugs.

## Why ntdll, not `src/sys`

bun's Rust `src/sys` layer only sees bun's own wrappers. libuv, boringssl,
c-ares, JSC/WTF and mimalloc call the OS directly and never touch it. Every
user-mode syscall from every module exits through the same ntdll `Nt*`
stubs, so `winsysfuzz.dll` hooks those exports in-process (Microsoft Detours)
and thereby sees the whole process — dependencies included — while running
against the **unmodified shipped `bun.exe`**.

Attribution survives the wrapper layers: each hook conservatively scrapes
its own stack for the nearest return address inside `bun.exe`'s image,
recorded as a module-relative RVA (ASLR-stable). (Never the OS unwinder —
it takes the function-table lock, and hooks fire on threads already holding
it; a real deadlock we hit.) Symbolize it against bun's PDB and a
fault reads as "`STATUS_SHARING_VIOLATION` injected at `NtCreateFile` from
`uv__fs_open`". That RVA is also the schedule's callsite key.

**Known blind spot:** the loader maps every static import (the
`NtProtectVirtualMemory` storm, DLL search-path probing, apiset registry
reads) *before* any in-process `DllMain` runs, so process-init syscalls
preceding our attach are invisible by construction. Validated against
NtTrace (a debugger-based tracer that sees from the first instruction): all
of bun's own post-attach syscalls match its counts exactly; the only deltas
are that pre-attach loader phase and timing-driven waits/spins. The blind
phase is OS init, not bun code, so it is not a fuzz target.

## The syscall table comes from NtTrace

`NtTrace.cfg` (rogerorr/NtTrace, MIT — vendored here with its header intact)
is a SAL-annotated prototype database of 537 ntdll entry points. `codegen.ts`
parses it and generates the Detours hook table, a metadata table, and a JSON
manifest for the driver. Every argument is one 8-byte slot on x64 and the
kernel ignores extras, so each trampoline forwards a fixed superset of slots
— which makes the cfg's arity drift on newer Windows builds harmless (its
`NtWaitForWorkViaWorkerFactory` is 2 args; the kernel takes 5). The declared
count and the `_In_`/`_Out_`/`_opt_` annotations still feed the trace printer
and, later, the hostile-argument mutator.

## Layout

```
NtTrace.cfg            vendored syscall prototype database (MIT)
codegen.ts             cfg -> src/generated/*, driver/generated/*
src/dllmain.cpp        Detours attach over all resolved Nt* exports
src/runtime.cpp        trace log, fault schedule, reentrancy guard
src/launcher.cpp       wsfrun.exe: run target with the DLL injected
driver/                JS controller/generator (fuzz driver)
```

## Build (on the Windows box)

```
bun run build          # codegen + cmake (VS 2022 generator) -> build/Release/
```
Produces `build/Release/winsysfuzz.dll` and `build/Release/wsfrun.exe`.

## Trace mode

```
set WSF_LOG_DIR=logs
build\Release\wsfrun.exe -- bun.exe -e "require('fs').readFileSync('x')"
```
writes `logs\wsf-<pid>.log`: one `X <seq> <tid> <sysid> <status> <bun_rva>
<frame0>` line per syscall exit (`!P`/`!Q` mark injected faults). Env knobs:
`WSF_MODE` (`trace`|`inject`|`off`), `WSF_ONLY` / `WSF_EXCLUDE` (comma
syscall lists), `WSF_FRAMES` (caller frames captured), `WSF_SCHEDULE`.

## The fault schedule — the fuzzer's central idea

Not probabilistic. "Fail with probability p" yields luck, not coverage, and
tells you nothing about what you exercised. Instead: a clean trace run
enumerates every `(syscall, callsite, hit-index)` tuple a JS program
produces; the injector then walks that space **systematically** — fault
hit #1 of `NtWriteFile`-from-callsite-X, then #2, then every other tuple,
then pairs. "When" becomes an enumerable coordinate swept to exhaustion, so
seed + program + schedule replays any bug deterministically.

Schedule file, one rule per line:
```
<SyscallName> <bun_rva_hex|*> <hit_index|*> <pre|post> <status_hex>
NtCreateFile 1a2b3c 3 pre C0000034
```
`pre` skips the real call and returns the status (a genuine failure).
`post` runs the real call then reports the status ("succeeded but told it
failed" — a distinct fault class that finds double-close / retry bugs).

The completion side is owned too: bun on Windows is IOCP-driven through
libuv, and completions dequeue via `NtRemoveIoCompletionEx`, which is hooked
like everything else — so beyond synchronous returns the schedule can
reorder completions and deliver failure statuses on ops that succeeded,
forcing completion-after-close and cancel-racing-completion deterministically.

## Staging (prove each before the next; hunt only at the end)

1. Interceptor + codegen; trace mode validated against NtTrace as an
   independent oracle.
2. Fault injection proven in **all locations**: a coverage matrix, one row
   per calling module (bun Rust, libuv, boringssl, c-ares, WebKit/JSC,
   mimalloc), each showing the hook fired from that module's callsite and
   bun surfaced an error instead of crashing.
3. Hostile-argument JS generator, proven by trace mode showing the poison
   reached the syscall intact.
4. Watchdog / crash oracle, dedupe by (callsite, status), replay + minimizer.
