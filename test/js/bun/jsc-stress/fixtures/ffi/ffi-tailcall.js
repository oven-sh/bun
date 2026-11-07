//@ requireOptions("--useDollarVM=1")
"use strict";
// An FFI call in TAIL position (arrow expression body / `return sym(...)` in strict code) is a
// bytecode TailCall. The parser emits it as a plain Call so it can become CallFFI; that must not
// change semantics: the value returned, exceptions from the FFI conversion, and deep call chains
// (no tail-call frame reuse assumed) all behave identically to the interpreter.
if (!$vm.useJIT()) quit();
const fixture = name => $vm.ffiFixture(name);
const identity = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity");
const addI32 = $vm.ffiFunction({ args: ["i32", "i32"], returns: "i32" }, fixture("ffi_add_i32"), "ffi_add_i32");

// Tail position via arrow expression bodies (strict => TailCall bytecode).
const tailIdentity = (v) => identity(v);
const tailAdd = (a, b) => addI32(a, b);
// Tail position via explicit `return` in a strict function.
function returnsCall(a, b) { return addI32(a, b); }
noInline(tailIdentity); noInline(tailAdd); noInline(returnsCall);

// Interpreter/baseline oracles pinned below the DFG.
function refIdentity(v) { return identity(v); }
function refAdd(a, b) { return addI32(a, b); }
noDFG(refIdentity); noDFG(refAdd); noInline(refIdentity); noInline(refAdd);

let failures = 0;
const check = (label, got, want) => { if (!Object.is(got, want)) { print(`FAIL ${label}: got ${String(got)} want ${String(want)}`); if (++failures > 8) throw new Error("too many failures"); } };

for (let i = 0; i < 40000; ++i) {
    const a = (i * 7) | 0, b = -(i % 101);
    check(`tailAdd#${i}`, tailAdd(a, b), refAdd(a, b));
    check(`returnsCall#${i}`, returnsCall(a, b), refAdd(a, b));
    check(`tailIdentity#${i}`, tailIdentity(i), refIdentity(i));
    // The tail-position result must be USABLE (not lost): compose it.
    check(`compose#${i}`, addI32(tailAdd(a, b), 1), (a + b + 1) | 0);
}

// Exceptions raised by the FFI conversion must propagate out of the tail-call arrow correctly.
const sym = Symbol("no-coerce");
let threw = 0;
for (let i = 0; i < 40000; ++i) {
    try { tailAdd(sym, 1); print("FAIL: symbol arg did not throw at " + i); ++failures; }
    catch (e) { if (e instanceof TypeError) ++threw; else { print("FAIL: wrong error " + e); ++failures; } }
}
check("threw-count", threw, 40000);

// A DEEP chain of tail-position FFI calls: with real tail calls this reuses frames; converted to
// plain Calls it grows the stack per level. It must complete (depth is modest) with the same value.
const step = (n) => n === 0 ? 0 : (addI32(step(n - 1), 1) | 0);
check("deep-chain", step(2000), 2000);

if (failures) throw new Error(`${failures} failure(s)`);
print("ffi tail-call: all checks passed");
