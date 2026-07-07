# Main-thread stack profiling: canary (Rust) vs 1.3.14, Windows x64

## Method

`stackprof.c` (attached): a tiny debug-loop launcher that snapshots each
thread's TEB at create/exit and reports two numbers:

- **commit** = `StackBase - TEB.StackLimit`. Lowest page ever committed.
  Useless for bun once JSC inits (preCommitStackMemory force-commits the
  whole reserve); useful for non-JSC paths.
- **dirty** = `StackBase - (lowest page containing any non-zero byte)`.
  Fresh guard-committed pages are demand-zero and preCommitStackMemory's
  `*p = *p` preserves zero, so a page only goes non-zero when a real
  frame lands on it. This is actual peak usage, 4KB-granular.

Validated against a probe that pre-commits 18MB then does 500 shallow
frames: `commit=18304KB, dirty=28KB`. Validated against a recursion
probe: dirty tracks commit exactly.

All binaries were re-stamped to `/STACK:18M,16K` (same reserve, tiny
initial commit) so non-JSC measurements aren't floored at 2MB.

## Main thread, by workload (dirty KB)

| Workload            | 1.3.14 | canary | ratio |
|---------------------|-------:|-------:|------:|
| `--revision`        |   692  |   16   |  43x  |
| `-e 1`              |  1072  |  684   | 1.6x  |
| `-e JSON.stringify` |  1072  |  684   | 1.6x  |
| `bun <200-mod>.ts`  |  1776  |  684   | 2.6x  |
| `bun build` 200 mod |  1600  |  604   | 2.6x  |
| `bun test`          |  1200  |  688   | 1.7x  |
| `bun install` (3 deps)| 2500 | 1324   | 1.9x  |
| js recursion→cap    |  6072  | 5288   | 1.15x |

The js-recursion number is `(depth at JSC entry) + maxPerThreadStackUsage
(5MB)`. Canary enters JSC ~400KB shallower, so the ceiling drops ~800KB.

## Bundler worker thread, parser recursion (bytes per nesting level)

| AST shape              | 1.3.14 B/lvl | canary B/lvl | ratio |
|------------------------|-------------:|-------------:|------:|
| `(((...)))`            |  4351        |  1614        | 2.7x  |
| `{a:{a:{...}}}`        |  4639        |  1550        | 3.0x  |
| `[[[...]]]`            |  2415        |   814        | 3.0x  |
| `for(;;){for(;;){...}}`|  6204        |  1389        | 4.5x  |
| `for(..) for(..) STMT` | ~3324        |  ~305        |  11x  |

`lots-of-for-loop.js` (the fixture cited in `ThreadPool.rs` as the reason
for 18MB worker stacks): both builds hit the worker-thread StackCheck and
bail gracefully with "Maximum call stack size exceeded", but 1.3.14 bails
at ~5600 levels and canary at ~61000. Neither "passes" the 320k fixture.

## Min viable `/STACK` (all four: `-e 1`, rec, `test`, `build` exit 0)

| /STACK | 1.3.14 | canary |
|--------|--------|--------|
| 18 MB  | ok     | ok     |
| 2 MB   | ok     | ok     |
| 1 MB   | **crash** | ok |

## JS recursion depth vs `/STACK` (canary)

| /STACK | depth | note |
|--------|------:|------|
| ≥6 MB  | 45602 | full JSC 5MB cap reached |
| 5 MB   | 42928 | |
| 4 MB   | 33561 | |
| 3 MB   | 24210 | |
| 2 MB   | 14840 | |
| 1 MB   |  5482 | |

1.3.14 needs ≥8 MB to reach the same 45600 plateau.

## Takeaways

- Canary's main-thread peak for **all** measured workloads is 5.3 MB
  (js recursion to JSC's cap). Everything else ≤1.3 MB.
- 18 MB reserve is ~3.4x what the main thread ever dirties on canary.
- Dropping `/STACK` to **8 MB** keeps full JSC recursion depth (same
  45602 frames as 18 MB), gives 2.7 MB margin over observed peak, and
  cuts preCommitStackMemory's boot-time commit from ~16 MB to ~6 MB.
- Dropping to **6 MB** still keeps full JSC depth on canary but only
  ~700 KB margin.
- Worker threads (`DEFAULT_THREAD_STACK_SIZE=18MB` on Windows) are a
  separate knob; they don't preCommitStackMemory so there's no
  boot-commit cost, only address space. Canary's parser is 2.7-11x
  leaner per level, so the same 18 MB reserve now handles 2.7-11x
  deeper ASTs than 1.3.14. Could lower to match, or leave it.

## Files

- `/tmp/stackprof.c` — the profiler
- `/tmp/reproduction.md` — BUN-2V26 repro + root cause
