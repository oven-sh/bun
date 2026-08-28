//@ requireOptions("--useDollarVM=1")
// Pointer-family arguments accept an object carrying a numeric/BigInt `ptr` property (Bun's
// documented FFIType.function / pointer forms accept a JSCallback / Pointer / CString object).
// The property get may run a getter, so its exceptions must propagate; a non-numeric `ptr`
// falls through to the normal type error. Tier-differential against a noDFG oracle.
if (!$vm.useJIT()) quit();

const identity = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, $vm.ffiFixture("ffi_ptr_identity"), "ffi_ptr_identity");
function ref(v) { try { return identity(v); } catch (e) { return "threw:" + e.constructor.name; } }
function hot(v) { try { return identity(v); } catch (e) { return "threw:" + e.constructor.name; } }
noDFG(ref); noInline(ref); noInline(hot);

let failures = 0;
const check = (l, got, want) => { if (!Object.is(got, want)) { print(`FAIL ${l}: got ${String(got)} want ${String(want)}`); if (++failures > 8) throw new Error("too many"); } };

const buf = new Uint8Array(8);
const addr = ref(buf); // a real address (number)
const withPtr = { ptr: addr };                       // JSCallback / Pointer-style wrapper
const withBigPtr = { ptr: 4294967297n };              // BigInt ptr (> 2^32)
class Wrapper { get ptr() { return addr; } }         // getter on the prototype (like CString)
const viaGetter = new Wrapper();
const throwing = { get ptr() { throw new RangeError("ptr getter"); } };
const badPtr = { ptr: "not a number" };              // must still be a TypeError
const noPtr = {};

for (let i = 0; i < 30000; ++i) {
    check(`obj#${i}`, hot(withPtr), addr);
    check(`bigint#${i}`, hot(withBigPtr), 4294967297);
    check(`getter#${i}`, hot(viaGetter), addr);
    check(`getter-throws#${i}`, hot(throwing), "threw:RangeError");
    check(`badptr#${i}`, hot(badPtr), "threw:TypeError");
    check(`noptr#${i}`, hot(noPtr), "threw:TypeError");
    // and the reference tier agrees on every one
    check(`agree-obj#${i}`, hot(withPtr), ref(withPtr));
    check(`agree-throw#${i}`, hot(throwing), ref(throwing));
}
if (failures) throw new Error(`${failures} failure(s)`);
print("ffi ptr-object arg: all checks passed");
