//@ requireOptions("--useDollarVM=1")
// An f32/f64 parameter whose call site does NOT speculate a number (FFIDFG falls back to
// UntypedUse) has no single SSA operand: the value is converted into the canonical slot by
// operationFFIWriteSlot. The FTL direct call must reload that slot AS A FLOAT so the value goes
// out in an FPR -- reloading it as an integer sends the bits in a GPR and the callee reads junk.
if (!$vm.useJIT()) quit();

const fixture = name => $vm.ffiFixture(name);
const addF64 = $vm.ffiFunction({ args: ["f64", "f64"], returns: "f64" }, fixture("ffi_add_f64"), "add_f64");
const addF32 = $vm.ffiFunction({ args: ["f32", "f32"], returns: "f32" }, fixture("ffi_add_f32"), "add_f32");
const echoF64 = $vm.ffiFunction({ args: ["f64"], returns: "f64" }, fixture("ffi_echo_f64"), "echo_f64");

// Oracles pinned below the DFG.
function refAddF64(a, b) { return addF64(a, b); }
function refAddF32(a, b) { return addF32(a, b); }
function refEchoF64(a) { return echoF64(a); }
noDFG(refAddF64); noDFG(refAddF32); noDFG(refEchoF64);
noInline(refAddF64); noInline(refAddF32); noInline(refEchoF64);

function hotAddF64(a, b) { return addF64(a, b); }
function hotAddF32(a, b) { return addF32(a, b); }
function hotEchoF64(a) { return echoF64(a); }
noInline(hotAddF64); noInline(hotAddF32); noInline(hotEchoF64);

let failures = 0;
function agree(label, hot, ref) {
    const same = Object.is(hot, ref);
    if (!same) { print(`MISMATCH [${label}]: hot=${String(hot)} ref=${String(ref)}`); if (++failures > 8) throw new Error("too many mismatches"); }
}

// Poison the argument prediction so FFIDFG picks UntypedUse: feed values that are numbers most of
// the time but sometimes null/undefined/boolean, so neither shouldSpeculateDoubleReal() nor
// shouldSpeculateNumber() holds at the call site.
const poison = [1.5, 2.25, null, undefined, true, false, -0.5, 1e300, NaN, 0];
const iterations = 30000;
for (let i = 0; i < iterations; ++i) {
    const a = poison[i % poison.length];
    const b = poison[(i + 3) % poison.length];
    agree(`addF64#${i}`, hotAddF64(a, b), refAddF64(a, b));
    agree(`addF32#${i}`, hotAddF32(a, b), refAddF32(a, b));
    agree(`echoF64#${i}`, hotEchoF64(a), refEchoF64(a));
}

// And the plain numeric case must still be exact after all that.
for (let i = 0; i < 5000; ++i) {
    agree(`exact#${i}`, hotAddF64(1.5, 2.25), 3.75);
    agree(`exactEcho#${i}`, hotEchoF64(1e300), 1e300);
}

if (failures) throw new Error(`${failures} mismatch(es)`);
print("ffi untyped float args: all checks passed");
