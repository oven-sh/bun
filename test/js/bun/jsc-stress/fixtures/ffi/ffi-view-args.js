//@ requireOptions("--useDollarVM=1")
// Pointer-family FFI arguments accept typed-array / DataView VIEWS directly, resolved inline in the
// DFG and (now) the FTL to the view's data pointer. This is a per-call tier-differential test: every
// hot (FTL-bound) function has a noDFG-pinned twin as the interpreter/baseline oracle, and the two
// must agree on EVERY iteration -- for every view type, storage mode, and the guard cases (detached,
// shared / resizable) that must punt to the C++ conversion in every tier.
if (!$vm.useJIT()) quit();

const fixture = name => $vm.ffiFixture(name);
const identity = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity");
const strlen = $vm.ffiFunction({ args: ["cstring"], returns: "u64" }, fixture("ffi_strlen"), "ffi_strlen");
const bufIdentity = $vm.ffiFunction({ args: ["buffer"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity(buffer)");
const readU32 = $vm.ffiFunction({ args: ["ptr"], returns: "u32" }, fixture("ffi_ptr_read_u32"), "ffi_ptr_read_u32");

// Oracle twins: same call, pinned below the DFG, so their result is the interpreter/baseline
// (out-of-line C++ conversion) answer that the JIT tiers must match exactly.
function refIdentity(v) { return identity(v); }
function refBufIdentity(v) { return bufIdentity(v); }
function refStrlen(v) { return strlen(v); }
noDFG(refIdentity); noDFG(refBufIdentity); noDFG(refStrlen);
noInline(refIdentity); noInline(refBufIdentity); noInline(refStrlen);

function hotIdentity(v) { return identity(v); }
function hotBufIdentity(v) { return bufIdentity(v); }
function hotStrlen(v) { return strlen(v); }
noInline(hotIdentity); noInline(hotBufIdentity); noInline(hotStrlen);

let failures = 0;
function agree(label, hot, ref) {
    // A pointer is a number, jsNull for 0, or an exact BigInt above 2^53 -- compare exactly.
    if (hot !== ref) {
        print(`TIER MISMATCH [${label}]: hot=${String(hot)} ref=${String(ref)}`);
        if (++failures > 8) throw new Error("too many tier mismatches");
    }
}

const iterations = 30000;

// ---------------------------------------------------------------------------------------------
// 1. Every view type resolves to base + byteOffset, and stays tier-stable.
// ---------------------------------------------------------------------------------------------
const backing = new ArrayBuffer(512);
const views = [
    ["Int8Array", new Int8Array(backing, 8)],
    ["Uint8Array", new Uint8Array(backing, 16)],
    ["Uint8ClampedArray", new Uint8ClampedArray(backing, 24)],
    ["Int16Array", new Int16Array(backing, 32)],
    ["Uint16Array", new Uint16Array(backing, 40)],
    ["Int32Array", new Int32Array(backing, 48)],
    ["Uint32Array", new Uint32Array(backing, 56)],
    ["Float32Array", new Float32Array(backing, 64)],
    ["Float64Array", new Float64Array(backing, 72)],
    ["BigInt64Array", new BigInt64Array(backing, 80)],
    ["BigUint64Array", new BigUint64Array(backing, 88)],
    ["DataView", new DataView(backing, 96)],
];
const basePtr = refIdentity(new Uint8Array(backing));
if (typeof basePtr !== "number" || basePtr === 0)
    throw new Error("bad base pointer: " + String(basePtr));
for (const [name, view] of views) {
    const expected = basePtr + view.byteOffset;
    if (refIdentity(view) !== expected)
        throw new Error(`${name}: byteOffset not applied by the reference path: ${refIdentity(view)} vs ${expected}`);
}
for (let i = 0; i < iterations; ++i) {
    for (const [name, view] of views) {
        agree(`identity(${name})#${i}`, hotIdentity(view), refIdentity(view));
        agree(`buffer(${name})#${i}`, hotBufIdentity(view), refBufIdentity(view));
    }
}

// ---------------------------------------------------------------------------------------------
// 2. Storage modes: a Fast (GC-heap vector) view whose .buffer is materialized MID-LOOP moves to
//    Wasteful storage (the vector may be re-pointed); an Oversize (Gigacage) view; a subarray.
//    Whatever the pointer is at each instant, both tiers must agree on it -- and the pointer must
//    still address the LIVE bytes (proven by reading through it).
// ---------------------------------------------------------------------------------------------
const fastView = new Uint32Array(64);            // Fast: small, GC-heap vector
const oversize = new Uint8Array(4 * 1024 * 1024); // Oversize: Gigacage-allocated
const sub = oversize.subarray(4096, 8192);
fastView[0] = 0xdeadbeef;
oversize[4096] = 0x7f;
let materialized = false;
for (let i = 0; i < iterations; ++i) {
    agree(`fast#${i}`, hotIdentity(fastView), refIdentity(fastView));
    agree(`oversize#${i}`, hotIdentity(oversize), refIdentity(oversize));
    agree(`subarray#${i}`, hotIdentity(sub), refIdentity(sub));
    // The pointer must address live memory: read the value we stored, through the returned pointer.
    if (readU32(hotIdentity(fastView)) !== 0xdeadbeef)
        throw new Error(`fast view pointer does not address live data at ${i}`);
    if (hotIdentity(sub) !== hotIdentity(oversize) + 4096)
        throw new Error(`subarray offset lost at ${i}`);
    if (!materialized && i === (iterations >> 1)) {
        void fastView.buffer;                     // Fast -> Wasteful: storage may move
        materialized = true;
    }
}
// After materialization the read-through invariant must still hold at the (possibly new) pointer.
if (readU32(hotIdentity(fastView)) !== 0xdeadbeef || readU32(refIdentity(fastView)) !== 0xdeadbeef)
    throw new Error("materialized wasteful view lost its data or its pointer");

// ---------------------------------------------------------------------------------------------
// 3. cstring parameter with a view: the inline path hands over the vector and C reads real,
//    NUL-terminated bytes -- including through a byteOffset'd subarray.
// ---------------------------------------------------------------------------------------------
const strBuf = new Uint8Array(64); // "abc\0" at 0, then "engine-native\0" at 16
strBuf.set([97, 98, 99, 0], 0);
strBuf.set([101, 110, 103, 105, 110, 101, 45, 110, 97, 116, 105, 118, 101, 0], 16);
const strView = strBuf.subarray(16);
for (let i = 0; i < iterations; ++i) {
    agree(`strlen(buf)#${i}`, hotStrlen(strBuf), refStrlen(strBuf));
    agree(`strlen(sub)#${i}`, hotStrlen(strView), refStrlen(strView));
    if (hotStrlen(strBuf) !== 3n || hotStrlen(strView) !== 13n)
        throw new Error(`cstring-from-view read wrong bytes at ${i}: ${hotStrlen(strBuf)}, ${hotStrlen(strView)}`);
}

// ---------------------------------------------------------------------------------------------
// 4. The number paths of the same untyped conversion must be undisturbed by the new view checks
//    (regression cover): int32 / double / negative / null / large all agree tier-to-tier.
// ---------------------------------------------------------------------------------------------
const numberArgs = [0, 1, 4096, -1, 2147483647, -2147483648, 4294967296, 1.5e9, null, undefined];
for (let i = 0; i < iterations; ++i)
    for (const n of numberArgs)
        agree(`number(${String(n)})#${i}`, hotIdentity(n), refIdentity(n));

// ---------------------------------------------------------------------------------------------
// 5. GUARD: a DETACHED view must never leak its stale pointer through the inline path (null
//    vector -> slow path); whatever the C++ conversion decides (0 / null / throw), the tiers agree.
// ---------------------------------------------------------------------------------------------
function tryHot(fn, v) { try { return fn(v); } catch (e) { return "threw:" + e.constructor.name; } }
const detached = new Uint8Array(new ArrayBuffer(64));
const stalePtr = refIdentity(detached);
if (typeof detached.buffer.transfer === "function") detached.buffer.transfer();
else if (typeof transferArrayBuffer === "function") transferArrayBuffer(detached.buffer);
else throw new Error("no way to detach an ArrayBuffer in this shell");
for (let i = 0; i < iterations; ++i) {
    const hot = tryHot(hotIdentity, detached), ref = tryHot(refIdentity, detached);
    agree(`detached#${i}`, hot, ref);
    if (hot === stalePtr && stalePtr !== 0)
        throw new Error(`detached view leaked its stale pointer at ${i}: ${String(hot)}`);
}

// ---------------------------------------------------------------------------------------------
// 6. GUARD: RESIZABLE and GROWABLE-SHARED backed views carry the isResizableOrGrowableShared
//    mode bits and must take the C++ path in every tier; a plain (fixed) SharedArrayBuffer view
//    does not carry them. In all cases the requirement is tier AGREEMENT, whatever the C++
//    conversion's policy for these buffers is.
// ---------------------------------------------------------------------------------------------
const guardedViews = [];
guardedViews.push(["resizable", new Uint8Array(new ArrayBuffer(64, { maxByteLength: 256 }))]);
if (typeof SharedArrayBuffer === "function") {
    guardedViews.push(["shared-fixed", new Uint8Array(new SharedArrayBuffer(64))]);
    let growable;
    try { growable = new SharedArrayBuffer(64, { maxByteLength: 256 }); } catch (e) { growable = null; }
    if (growable)
        guardedViews.push(["shared-growable", new Uint8Array(growable)]);
}
for (let i = 0; i < iterations; ++i)
    for (const [name, view] of guardedViews)
        agree(`${name}#${i}`, tryHot(hotIdentity, view), tryHot(refIdentity, view));

// ---------------------------------------------------------------------------------------------
// 7. buffer-typed parameter rejects NON-view values consistently in every tier (numbers throw
//    in C++; the inline path must not accept them either).
// ---------------------------------------------------------------------------------------------
for (let i = 0; i < iterations; ++i) {
    const hot = tryHot(hotBufIdentity, 1234), ref = tryHot(refBufIdentity, 1234);
    agree(`buffer(number)#${i}`, hot, ref);
    if (!String(hot).startsWith("threw:"))
        throw new Error(`buffer param accepted a number in the JIT at ${i}: ${String(hot)}`);
}

// ---------------------------------------------------------------------------------------------
// 8. A view argument followed by a THROWING argument: the exception propagates cleanly (the
//    partially-written slot buffer is never observed) and identically across tiers.
// ---------------------------------------------------------------------------------------------
const add = $vm.ffiFunction({ args: ["ptr", "i32"], returns: "ptr" }, fixture("ffi_ptr_identity"), "identity2");
function hotAdd(v, x) { return add(v, x); }
function refAdd(v, x) { return add(v, x); }
noDFG(refAdd); noInline(refAdd); noInline(hotAdd);
const poison = { valueOf() { throw new RangeError("poison"); } };
const sym = Symbol("s");
function tryCall(fn, a, b) { try { return fn(a, b); } catch (e) { return "threw:" + e.constructor.name; } }
for (let i = 0; i < iterations; ++i) {
    agree(`view+poison#${i}`, tryCall(hotAdd, strBuf, poison), tryCall(refAdd, strBuf, poison));
    agree(`view+symbol#${i}`, tryCall(hotAdd, strBuf, sym), tryCall(refAdd, strBuf, sym));
}

if (failures)
    throw new Error(`${failures} tier mismatch(es) reported above`);
print("ffi view args: all checks passed");
