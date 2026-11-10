//@ requireOptions("--useDollarVM=1")
// Regression: with int32 speculation gated on profiling, an i32/u32 parameter can carry an
// UntypedUse edge. On the FTL DIRECT-call path that operand must be reloaded as a B3 Int32; as an
// Int64 CCallValue lays a STACK argument at 8-byte stride, but Darwin/arm64 packs a stacked
// int32_t at 4-byte natural stride, so the 9th/10th arguments (spilled past the 8 GPRs) would
// shift. Poison the profile so the args stay UntypedUse, pass values whose position matters
// (weighted sum), and compare the FTL-hot twin against a noDFG oracle.
if (!$vm.useJIT()) quit();
const sum10 = $vm.ffiFunction({ args: ["i32","i32","i32","i32","i32","i32","i32","i32","i32","i32"], returns: "i64" },
    $vm.ffiFixture("ffi_sum_i32_x10"), "sum_i32_x10");
function ref(a,b,c,d,e,f,g,h,i,j) { return sum10(a,b,c,d,e,f,g,h,i,j); }
function hot(a,b,c,d,e,f,g,h,i,j) { return sum10(a,b,c,d,e,f,g,h,i,j); }
noDFG(ref); noInline(ref); noInline(hot);
let failures = 0;
// Mix ints with booleans / null / doubles so FFIDFG's shouldSpeculateInt32() gate falls to
// UntypedUse for these arguments (the exact edge kind the direct-call reload must handle).
const vals = [7, true, null, 3, false, 2.0, 9, 1, 12345, -6, 100000, 4];
for (let it = 0; it < 60000; ++it) {
    const a = vals[it % vals.length], b = vals[(it + 1) % vals.length], c = 5, d = -1, e = it & 7, f = 8,
          g = vals[(it + 3) % vals.length], h = 2, i = it & 3, j = vals[(it + 5) % vals.length];
    const hv = hot(a,b,c,d,e,f,g,h,i,j), rv = ref(a,b,c,d,e,f,g,h,i,j);
    if (hv !== rv) { print(`MISMATCH it=${it}: hot=${hv} ref=${rv} args=${[a,b,c,d,e,f,g,h,i,j]}`); if (++failures > 5) throw new Error("stack arg stride mismatch"); }
}
if (failures) throw new Error(failures + " mismatches");
print("ffi untyped int stack args: all checks passed");
