//@ requireOptions("--useDollarVM=1")
// FFI Type::BufferLength ("buffer_length"): the length twin of "buffer". Given a
// TypedArray / DataView argument it marshals the view's byteLength() as an unsigned 64-bit
// integer. Bound as args: ["ptr", "buffer_length"] with the SAME view passed for both, the
// engine reads pointer and length off one cell at call time. Argument-only; accepts exactly
// what "buffer" accepts (a view) and throws a TypeError for anything else. Every tier converts
// buffer_length through the C++ path, so a hot function and its noDFG-pinned reference twin
// must agree on every iteration.
if (!$vm.useJIT()) quit();

const fixture = name => $vm.ffiFixture(name);
const byteLength = $vm.ffiFunction({ args: ["ptr", "buffer_length"], returns: "u64" }, fixture("ffi_view_byte_length"), "ffi_view_byte_length");
const byteLengthAlias = $vm.ffiFunction({ args: ["ptr", "buffer_bytelength"], returns: "u64" }, fixture("ffi_view_byte_length"), "ffi_view_byte_length(alias)");
const lastByte = $vm.ffiFunction({ args: ["ptr", "buffer_length"], returns: "i32" }, fixture("ffi_view_last_byte"), "ffi_view_last_byte");

// Oracle twins pinned below the DFG: their (out-of-line C++ conversion) answer is what the
// tiered-up caller must reproduce exactly.
function refByteLength(v) { return byteLength(v, v); }
function refLastByte(v) { return lastByte(v, v); }
noDFG(refByteLength); noDFG(refLastByte);
noInline(refByteLength); noInline(refLastByte);

function hotByteLength(v) { return byteLength(v, v); }
function hotLastByte(v) { return lastByte(v, v); }
noInline(hotByteLength); noInline(hotLastByte);

let failures = 0;
function check(actual, expected, label) {
    if (actual !== expected) {
        print(`FAIL [${label}]: got ${String(actual)} (${typeof actual}), expected ${String(expected)} (${typeof expected})`);
        if (++failures > 8) throw new Error("too many failures");
    }
}
function agree(label, hot, ref) {
    if (hot !== ref) {
        print(`TIER MISMATCH [${label}]: hot=${String(hot)} ref=${String(ref)}`);
        if (++failures > 8) throw new Error("too many tier mismatches");
    }
}

// ---------------------------------------------------------------------------------------------
// 1. The marshalled length is the view's byteLength: several sizes, a DataView, a subarray
//    with a byteOffset, and the buffer_bytelength alias spelling.
// ---------------------------------------------------------------------------------------------
for (const size of [0, 1, 4, 4096]) {
    const view = new Uint8Array(size);
    check(refByteLength(view), BigInt(view.byteLength), `Uint8Array(${size}) byteLength`);
    check(byteLengthAlias(view, view), BigInt(view.byteLength), `Uint8Array(${size}) via buffer_bytelength alias`);
}
{
    const backing = new ArrayBuffer(256);
    const dataView = new DataView(backing, 32, 96);
    check(refByteLength(dataView), 96n, "DataView(32, 96) byteLength");
    const wide = new Float64Array(backing, 64, 10); // byteLength is in BYTES, not elements
    check(refByteLength(wide), 80n, "Float64Array(64, 10) byteLength");
    const sub = new Uint8Array(backing).subarray(100, 150);
    check(refByteLength(sub), 50n, "subarray(100, 150) byteLength");
    // Pointer + length come off the same cell: the last byte through (ptr, byteLength) is the
    // subarray's own last byte, not the backing store's.
    sub[sub.length - 1] = 0x5a;
    check(refLastByte(sub), 0x5a, "subarray pointer+length agree");
    check(refLastByte(new Uint8Array(0)), -1, "empty view last byte");
}

// ---------------------------------------------------------------------------------------------
// 2. Anything that is not a view throws a TypeError -- numbers included (unlike ptr, which
//    accepts them). Identical message from a cold and a warmed caller.
// ---------------------------------------------------------------------------------------------
function expectTypeError(thunk, label) {
    try {
        thunk();
    } catch (error) {
        if (!(error instanceof TypeError)) {
            print(`FAIL [${label}]: threw ${describeError(error)}, expected a TypeError`);
            ++failures;
        }
        return;
    }
    print(`FAIL [${label}]: did not throw`);
    ++failures;
}
function describeError(error) {
    try { return String(error); } catch { return Object.prototype.toString.call(error); }
}
const badValues = [
    [42, "number"],
    [4096n, "bigint"],
    ["not a view", "string"],
    [{}, "plain object"],
    [undefined, "undefined"],
    [null, "null"],
    [new ArrayBuffer(8), "ArrayBuffer (not a view)"],
];
const validView = new Uint8Array(16);
for (const [bad, label] of badValues)
    expectTypeError(() => byteLength(validView, bad), `cold buffer_length=${label}`);

// ---------------------------------------------------------------------------------------------
// 3. Tier differential: hammer the hot twins alongside the noDFG oracles, then re-check that
//    the bad-value TypeErrors still fire from the (now tiered-up) callers.
// ---------------------------------------------------------------------------------------------
const backing = new ArrayBuffer(4096);
const views = [
    new Uint8Array(0),
    new Uint8Array(1),
    new Uint8Array(4),
    new Uint8Array(4096),
    new DataView(backing, 8, 24),
    new Uint8Array(backing).subarray(17, 900),
    new Uint32Array(backing, 64, 7),
    new Float64Array(3),
];
views[1][0] = 0x7f;
views[3][4095] = 0x11;
const iterations = 50000;
for (let i = 0; i < iterations; ++i) {
    const view = views[i % views.length];
    agree(`byteLength#${i}`, hotByteLength(view), refByteLength(view));
    agree(`lastByte#${i}`, hotLastByte(view), refLastByte(view));
    if (hotByteLength(view) !== BigInt(view.byteLength)) {
        print(`FAIL [hot byteLength#${i}]: ${hotByteLength(view)} != ${view.byteLength}`);
        if (++failures > 8) throw new Error("too many failures");
    }
}

// The bad-value paths must still throw the same TypeError once the callers are hot.
function hotThrows(view, bad) { return byteLength(view, bad); }
noInline(hotThrows);
for (let i = 0; i < 20000; ++i)
    hotThrows(validView, validView);
for (const [bad, label] of badValues)
    expectTypeError(() => hotThrows(validView, bad), `hot buffer_length=${label}`);

// buffer_length is argument-only: a "length" return type is rejected at signature creation.
expectTypeError(() => $vm.ffiFunction({ args: ["ptr"], returns: "buffer_length" }, fixture("ffi_view_byte_length"), "bad"), "buffer_length as return type");

if (failures)
    throw new Error(`ffi-buffer-length: ${failures} failure(s)`);
