//@ requireOptions("--useDollarVM=1")
// A THROWING threadsafe callback: the drain must stop running further invocations once one
// throws, propagate the exception, and still RETIRE the counts of the un-run records -- so a
// callback close()d while records were queued (the deferred-unroot path) is not leaked/rooted
// forever, and the queue is empty afterwards. (Regression for the drain-loop early-return.)
if (!$vm.useJIT()) quit();
const callFromThread = $vm.ffiFunction({ args: ["ptr", "i32", "i64", "u64", "f64"], returns: "void" },
    $vm.ffiFixture("ffi_call_cb_from_thread"), "call_cb_from_thread");
let ran = 0;
const boom = $vm.ffiCallback({ args: ["i32", "i64", "u64", "f64"], returns: "void" },
    (a) => { ran++; throw new RangeError("cb-throw " + a); }, { threadsafe: true });
const other = $vm.ffiCallback({ args: ["i32", "i64", "u64", "f64"], returns: "void" },
    () => { ran++; }, { threadsafe: true });
// Queue three records: boom (throws first), then two more that must NOT run this drain.
callFromThread(boom.ptr, 1, 2n, 3n, 4.5);
callFromThread(other.ptr, 2, 2n, 3n, 4.5);
callFromThread(boom.ptr, 3, 2n, 3n, 4.5);
// Close one callback WHILE its records are queued (deferred-unroot path).
other.close();
let threw = false;
try { $vm.drainThreadsafeCallbacks(); } catch (e) { threw = e instanceof RangeError && /cb-throw 1/.test(e.message); }
if (!threw) throw new Error("expected the first callback's RangeError to propagate from drain");
if (ran !== 1) throw new Error("invocations after the throw must not run this drain: ran=" + ran);
// The queue was fully consumed (the un-run records were retired, not left queued).
if ($vm.drainThreadsafeCallbacks() !== 0) throw new Error("queue not empty after the throwing drain");
// GC must be fine: no leaked-root cell, no swept-cell record.
for (let i = 0; i < 4; ++i) { fullGC(); edenGC(); }
// And the surviving callback still works after all that.
callFromThread(boom.ptr, 9, 2n, 3n, 4.5);
let threw2 = false;
try { $vm.drainThreadsafeCallbacks(); } catch (e) { threw2 = /cb-throw 9/.test(e.message); }
if (!threw2) throw new Error("post-recovery throwing invocation did not propagate");
boom.close();
print("ffi threadsafe throwing callback: all checks passed");
