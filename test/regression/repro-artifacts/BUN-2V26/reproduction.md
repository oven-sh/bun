# BUN-2V26 — StackOverflow in JSC::preCommitStackMemory during VM init (Windows)

## TL;DR

Not a `/STACK` regression. `JSC::preCommitStackMemory` touches every page of the
18 MB main-thread stack at VM construction to force Windows to commit it. When
the process cannot commit that many pages (system or job commit charge
exhausted), the guard-page fault returns `STATUS_STACK_OVERFLOW` instead of
committing, and bun's VEH reports `panic(main thread): Stack overflow` before
any user code runs. Skews to x64-baseline because that is the low-end-hardware
population (less RAM, smaller page files).

## Ruled out

| Hypothesis | Verdict | Evidence |
|---|---|---|
| (a) `/STACK` reserve lowered in Rust port | **No** | `scripts/build/flags.ts:980` sets `/STACK:0x1200000,0x200000`. PE header of canary x64 + x64-baseline + installed 1.3.14 all read `SizeOfStackReserve=0x1200000` (18 MB). Standalone `--compile` output is `CopyFileW(bun.exe)` + append, header preserved (verified). |
| (b) Deep pre-VM stack on `boot_standalone` | **No** | At `/STACK:388K` a standalone exe still boots clean 10/10. preCommitStackMemory is reached with ~17.5 MB of headroom. |
| (c) Soft-reserved-zone mismatch on baseline | **No** | No `SetThreadStackGuarantee` calls in bun. `softReservedZoneSize` is the JSC default 128 KB on all targets. 128 KB >> the ~16 KB OS guard guarantee, so the page-touch loop itself cannot walk past the hard guard. |
| Commit-charge exhaustion during the 18 MB stack pre-commit | **Yes** | See below. |

## Mechanism proof (no bun involved)

`/tmp/precommit_test.c` links with `/STACK:0x1200000,0x200000` (same as bun),
soaks process commit via `VirtualAlloc(MEM_COMMIT)` until N MB remain, then
runs the exact `preCommitStackMemory` loop. Under a 30 MB job limit:

| Headroom left before walk | Result |
|---|---|
| 20 MB | walk completes (4381 pages) |
| ≤ 15 MB | `STATUS_STACK_OVERFLOW` raised during the page-touch loop, 10/10 |

## Surgical repro on bun (matches field conditions exactly)

`/tmp/surgical.c` is a tiny debug-loop launcher: sets an INT3 at
`JSC::VM::updateStackLimits` (RVA `0x1627440` in canary `10814346f`
x64-baseline-profile), and when it fires, soaks job commit down to 4 MB, then
continues. The next instruction cluster is the inlined `preCommitStackMemory`
loop.

```
surgical.exe 400 4 hello_prof.exe
  → STATUS_STACK_OVERFLOW first-chance, RIP image-rel=0x1627530
```

llvm-symbolizer on `0x1627530`:
```
JSC::preCommitStackMemory    VM.cpp:1181
JSC::VM::updateStackLimits   VM.cpp:1220
```

**Hit rate: 20 / 20.** bun's own crash handler prints
`panic(main thread): Stack overflow` with features
`jsc standalone_executable`, matching the Sentry signature.

## Amplified standalone repro (no debugger, no PDB, works on any bun)

`/tmp/repro-BUN-2V26.ps1` is one self-contained PowerShell script:

1. `bun build --compile hello.js --outfile app.exe` with the system-installed
   bun.
2. Patch `SizeOfStackReserve` to 1 GB in the PE optional header (8-byte write;
   editbin not required).
3. Run under a Job object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY = 512 MB`.

preCommitStackMemory now needs ~1 GB of stack commit, job cap is 512 MB, so
the guard-page commit fails deterministically inside that loop.

```
bun: C:\Windows\system32\bun.exe
1.3.14
RESULT: 'panic: Stack overflow' in 20 / 20 runs (amplified: reserve=1GB, job commit=512MB)
Control (unmodified PE, same 512MB limit): 5 / 5 ok
```

Fault RIP (captured under the debugger) on 1.4.0 canary baseline-profile:
`image-rel 0x1627530` → `JSC::preCommitStackMemory` (`VM.cpp:1181`, the
`char ch = *p;` touch).

Also reproduces 20/20 on:
- bare `bun.exe -e 1` (non-standalone), 1.3.14 and 1.4.0 canary
- standalone exe from `bun build --compile`, 1.3.14 and 1.4.0 canary

## Why users hit it with the shipped 18 MB reserve

With `/STACK:18M,2M`, `preCommitStackMemory` must commit ~16 MB of fresh stack
at VM init. On a box whose available commit at that moment is below ~16 MB
(no page file, page file full, inside a memory-capped container/Job, or under
heavy memory pressure from other processes) the guard-page commit fails partway
through and raises `STATUS_STACK_OVERFLOW`. Under a synthetic Job limit other
bun allocations (mimalloc arenas, JSC heap) usually fail first, but under real
system-wide pressure the ordering is a race, so the stack pre-commit is the one
that hits the wall often enough to account for 29k events.

## Candidate fixes (not implemented yet)

1. Bound `preCommitStackMemory` by `Options::maxPerThreadStackUsage()` (5 MB)
   instead of the full reserve. The `recursionLimit(startOfUserStack, maxUsage,
   zone)` overload already clamps once `m_stackPointerAtVMEntry` is set; at
   VM construction it is null so the unbounded `recursionLimit(zone)` overload
   runs and walks the whole 18 MB. Using the clamped form with the current SP
   at ctor time caps the up-front commit at ~5 MB. (WebKit change.)
2. Or drop `/STACK` reserve to something closer to 5 MB and rely on
   `maxPerThreadStackUsage` for the soft limit. (Linker-flag change; affects
   bundler recursion depth too.)
3. Or lower `SizeOfStackCommit` only (already 2 MB; no effect on this bug).

Option 1 is the narrowest root-cause fix.
