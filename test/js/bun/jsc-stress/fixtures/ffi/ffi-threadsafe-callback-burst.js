//@ requireOptions("--useDollarVM=1")
// Burst: many foreign-thread invocations queue up (each on its own OS thread) BEFORE a single
// drain. Records must all survive queuing (refcounted C data), and one drain must deliver every
// one, in some order, with exact values. Also multiple distinct threadsafe callbacks interleaved.
if (!$vm.useJIT()) quit();
const callFromThread = $vm.ffiFunction({ args: ["ptr", "i32", "i64", "u64", "f64"], returns: "void" },
    $vm.ffiFixture("ffi_call_cb_from_thread"), "call_cb_from_thread");
const seenA = [], seenB = [];
const cbA = $vm.ffiCallback({ args: ["i32", "i64", "u64", "f64"], returns: "void" }, (a) => seenA.push(a), { threadsafe: true });
const cbB = $vm.ffiCallback({ args: ["i32", "i64", "u64", "f64"], returns: "void" }, (a, b) => seenB.push([a, b]), { threadsafe: true });
const N = 300;
for (let i = 0; i < N; ++i) {
    callFromThread(cbA.ptr, i, 1n, 1n, 0);            // queued, not run
    callFromThread(cbB.ptr, i * 2, BigInt(i) - 500n, 1n, 0);
}
if (seenA.length !== 0 || seenB.length !== 0) throw new Error("ran inline");
const delivered = $vm.drainThreadsafeCallbacks();
if (delivered !== 2 * N) throw new Error("expected " + (2 * N) + " delivered, got " + delivered);
if (seenA.length !== N || seenB.length !== N) throw new Error("counts: " + seenA.length + "/" + seenB.length);
seenA.sort((x, y) => x - y);
for (let i = 0; i < N; ++i) if (seenA[i] !== i) throw new Error("A[" + i + "]=" + seenA[i]);
seenB.sort((x, y) => x[0] - y[0]);
for (let i = 0; i < N; ++i) {
    if (seenB[i][0] !== i * 2) throw new Error("B i32 " + seenB[i][0]);
    if (seenB[i][1] !== BigInt(i) - 500n) throw new Error("B i64 " + String(seenB[i][1]));
}
// A second drain finds nothing left.
if ($vm.drainThreadsafeCallbacks() !== 0) throw new Error("queue not empty after drain");
cbA.close(); cbB.close();
print("ffi threadsafe burst: all checks passed");
