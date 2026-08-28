//@ requireOptions("--useDollarVM=1")
// JSFFIFunction owner cell + CallHooks:
//  1) hooks bracket EVERY call as before:N / after:N with the token round-tripping;
//  2) after fires even when the call throws (a callback raised an exception mid-call);
//  3) a hooked function is host-path-only: it must NOT be lifted into a CallFFI node -- observable
//     as the hooks still firing on every call after the caller is FTL-hot (a CallFFI node would
//     bypass ffiHostCall, the only place hooks run, so the log would go quiet);
//  4) the owner is kept alive by the function (WeakRef stays populated while the fn is reachable).
if (!$vm.useJIT()) quit();

const owner = { hookLog: [] };
const addI32 = $vm.ffiFunction({ args: ["i32", "i32"], returns: "i32" }, $vm.ffiFixture("ffi_add_i32"), "add_i32", { owner, hooks: "test" });

// (1) bracketing + token round trip
addI32(1, 2);
if (owner.hookLog.length !== 2) throw new Error("expected before+after, got " + JSON.stringify(owner.hookLog));
const t = owner.hookLog[0].split(":")[1];
if (owner.hookLog[0] !== "before:" + t || owner.hookLog[1] !== "after:" + t)
    throw new Error("bad bracket order/token: " + JSON.stringify(owner.hookLog));

// (2) after runs even when the native call throws (callback throws inside the call)
const callCbVoid = $vm.ffiFunction({ args: ["ptr"], returns: "void" }, $vm.ffiFixture("ffi_call_cb_void"), "call_cb_void", { owner, hooks: "test" });
const boom = $vm.ffiCallback({ args: [], returns: "void" }, () => { throw new RangeError("cb"); });
owner.hookLog.length = 0;
let threw = false;
try { callCbVoid(boom.ptr); } catch (e) { threw = e instanceof RangeError; }
if (!threw) throw new Error("callback exception did not propagate");
if (owner.hookLog.length !== 2 || !owner.hookLog[1].startsWith("after:"))
    throw new Error("after hook did not run on the throwing call: " + JSON.stringify(owner.hookLog));

// (3) host-path-only: hooks keep firing on every call even when the caller is FTL-hot.
function hot(a, b) { return addI32(a, b); }
noInline(hot);
owner.hookLog.length = 0;
let sum = 0;
for (let i = 0; i < 20000; ++i) sum += hot(i, 1);
const expected = (19999 * 20000) / 2 + 20000; // sum over i in [0,20000) of (i+1) = 200010000
if (sum !== expected) throw new Error("wrong sum " + sum + " != " + expected);
if (owner.hookLog.length !== 40000)
    throw new Error("hooks stopped firing when hot (CallFFI took over?): " + owner.hookLog.length + " entries for 20000 calls");

// (4) owner liveness: the function alone must keep its owner reachable.
let ref;
(function () {
    const localOwner = { hookLog: [] };
    ref = new WeakRef(localOwner);
    globalThis.keptFn = $vm.ffiFunction({ args: ["i32"], returns: "i32" }, $vm.ffiFixture("ffi_echo_i32"), "echo42", { owner: localOwner, hooks: "test" });
})();
for (let i = 0; i < 5; ++i) { fullGC(); edenGC(); }
if (ref.deref() === undefined) throw new Error("owner was collected while its function is still reachable");
if (keptFn(42) !== 42) throw new Error("kept function no longer callable");
globalThis.keptFn = null;
print("ffi hooks + owner: all checks passed");
