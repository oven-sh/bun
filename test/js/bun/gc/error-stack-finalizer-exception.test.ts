import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// computeErrorInfoWrapperToString (src/jsc/bindings/FormatStackTraceForJS.cpp,
// the vm.setOnComputeErrorInfo hook) runs from
// ErrorInstance::reconcileWeakReferencesAtGCEnd during Heap::runEndPhase, to
// materialize the stack of a live Error whose frames have died. It used to
// clear whatever exception was pending on the VM. The entry module's
// evaluation promise is rejected with the caught exception after an allocation
// safepoint, so a collection ending in that window dropped the error:
//
//   assert build:  ASSERTION FAILED: exception   JSPromise.cpp, rejectWithCaughtException
//   release build: panic(main thread): Segmentation fault at address 0x8
//
// Unlike the concurrent-GC reproducers (sourcetextmodule-link-gc.test.ts,
// dynamic-import-evaluation-error-gc.test.ts, the Bun.resolve() case in
// resolve-error.test.ts) this one is deterministic: slowPathAllocsBetweenGCs
// collects every N slow-path allocations, so the end phase lands in the same
// place every run. The Error is built inside an eval'd arrow so its frames are
// garbage by the time the throw propagates, which is what gives the end phase a
// stack to materialize.
//
// It is allocation-count sensitive, as that option is: on the unfixed debug
// build N of 3, 4 and 7 abort every run while 1, 2, 5, 6 and >= 8 print the
// error normally. Check the values that fire rather than one, since the counts
// shift with the build. A value that does not fire still has to print the
// error, so this cannot flake on a fixed build.
const ALLOCS_BETWEEN_GCS = [3, 4, 7];

test.each(ALLOCS_BETWEEN_GCS)("an uncaught Error survives a GC end phase (every %i allocations)", async n => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const e = eval("(() => Object.assign(new Error('c'), { code: 1 }))")(); throw e`],
    env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: String(n) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Bun prints `error: c` plus the `code: 1` property and a frame. The crash
  // produces an assertion or a segfault instead, and a nonzero-but-not-1 code.
  expect({ stdout, startsWithError: stderr.startsWith("error: c"), exitCode }).toEqual({
    stdout: "",
    startsWithError: true,
    exitCode: 1,
  });
});
