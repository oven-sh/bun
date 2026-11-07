//@ requireOptions("--useDollarVM=1")
// An integer FFI parameter validly accepts doubles / booleans / null (the conversion table),
// so a call site that passes such values must NOT get an unconditional Int32Use check (which
// would OSR-exit every call -> a deopt storm). The site must stay compiled and agree with the
// interpreter. We assert (a) tier agreement and (b) that the function is not endlessly recompiled.
if (!$vm.useJIT()) quit();
const echoI32 = $vm.ffiFunction({ args: ["i32"], returns: "i32" }, $vm.ffiFixture("ffi_echo_i32"), "echo_i32");
function ref(v) { return echoI32(v); }
function hot(v) { return echoI32(v); }
noDFG(ref); noInline(ref); noInline(hot);
let failures = 0;
const args = [true, false, null, undefined, 0.5, -1.5, 3.9, 2147483647.0, 1, 0];
for (let i = 0; i < 200000; ++i) {
    const a = args[i % args.length];
    const h = hot(a), r = ref(a);
    if (!Object.is(h, r)) { print(`MISMATCH ${String(a)}: hot=${h} ref=${r}`); if (++failures > 4) throw new Error("tier mismatch"); }
}
// After 200k calls hot() must be optimized and STAY optimized (not exit-storming).
const compiles = numberOfDFGCompiles(hot);
print("DFG compiles of hot():", compiles);
if (compiles > 6) throw new Error(`hot() recompiled ${compiles} times -- deopt storm on valid non-int32 args`);
if (failures) throw new Error("failures");
print("ffi non-int32 int args: all checks passed");
