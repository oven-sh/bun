//@ requireOptions("--useDollarVM=1")

// TypedArray storage modes vs. the ptr/buffer argument fast paths (SPEC
// sections 5 and 8.3): a JSArrayBufferView's vector lives in different
// places depending on its mode --
//   FastTypedArray      small array, GC-auxiliary storage, no ArrayBuffer
//   OversizeTypedArray  large array, malloc'd (Gigacage) storage, no ArrayBuffer
//   WastefulTypedArray  ArrayBuffer-backed (created up front, or MATERIALIZED
//                       on demand by touching .buffer, which MOVES the storage:
//                       JSArrayBufferView::slowDownAndWasteMemory)
// The IC stub / DFG / FTL read the vector with a single offsetOfVector() load,
// so every mode must yield the right pointer, and a mode transition between
// two calls must be picked up (the freshly materialized buffer, not the stale
// pre-transition storage). None of this may crash the engine at any tier.

// The stress harness also runs every file with the JIT disabled (lockdown /
// no-jit configs), where bun:ffi creation throws by design (SPEC section
// 0.1); like every ffi-*.js file, gate the body on $vm.useJIT()
// (ffi-no-jit.js covers the no-JIT behavior explicitly).
if (!$vm.useJIT())
    quit();

const identity = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, $vm.ffiFixture("ffi_ptr_identity"), "ffi_ptr_identity");
const readU32 = $vm.ffiFunction({ args: ["ptr"], returns: "u32" }, $vm.ffiFixture("ffi_ptr_read_u32"), "ffi_ptr_read_u32");
const writeU32 = $vm.ffiFunction({ args: ["ptr", "u32"], returns: "void" }, $vm.ffiFixture("ffi_ptr_write_u32"), "ffi_ptr_write_u32");
const bufferIdentity = $vm.ffiFunction({ args: ["buffer"], returns: "ptr" }, $vm.ffiFixture("ffi_ptr_identity"), "ffi_buffer_identity");
const callVoid = $vm.ffiFunction({ args: ["ptr"], returns: "void" }, $vm.ffiFixture("ffi_call_cb_void"), "ffi_call_cb_void");

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + String(expected) + " but got " + String(actual));
}

function currentPtr(view) { return identity(view); }

function main() {
    // ---- 1. Fast (small) vs Oversize (large) vs Wasteful (buffer-backed) views:
    // pointer identity and read-through must agree across many iterations
    // (hot enough for baseline -> DFG -> FTL on the call sites below).
    const fast = new Uint32Array(4);            // FastTypedArray
    fast[0] = 0xF00D;
    const oversize = new Uint32Array(1 << 16);  // OversizeTypedArray (256KB)
    oversize[0] = 0x0517E;
    const wasteful = new Uint32Array(new ArrayBuffer(64)); // Wasteful from birth
    wasteful[0] = 0xBEEF;

    for (let i = 0; i < 2e4; ++i) {
        check(readU32(fast), 0xF00D, "fast read");
        check(readU32(wasteful), 0xBEEF, "wasteful read");
        // The buffer-typed argument path (requires a view; §5) sees the same storage.
        check(bufferIdentity(fast) === currentPtr(fast), true, "buffer arg == ptr arg (fast)");
        // Write then read back through the oversize (malloc'd Gigacage) storage.
        writeU32(oversize, i & 0xffff);
        check(oversize[0], i & 0xffff, "oversize write visible to JS");
        check(readU32(oversize), (i & 0xffff) >>> 0, "oversize read after write");
    }

    // ---- 2. Materialize .buffer AFTER the call site is hot: the storage
    // MOVES (slowDownAndWasteMemory). Subsequent calls must see the new
    // location, and reads/writes must round-trip through it.
    const migrant = new Uint32Array(4); // starts Fast
    migrant[0] = 0xAAAA;
    for (let i = 0; i < 2e4; ++i)
        check(readU32(migrant), 0xAAAA, "pre-materialization read");
    const before = currentPtr(migrant);
    const buffer = migrant.buffer;      // <-- materialize: mode transition happens here
    const after = currentPtr(migrant);
    check(migrant[0], 0xAAAA, "contents survive materialization");
    check(readU32(migrant), 0xAAAA, "read after materialization (same hot site)");
    if (buffer.byteLength !== 16)
        throw new Error("materialized buffer has wrong length: " + buffer.byteLength);
    // The engine reads the vector fresh on every call, so writes through the
    // NEW storage are visible; a stale cached pre-transition pointer would not be.
    writeU32(migrant, 0xC0FFEE);
    check(migrant[0], 0xC0FFEE, "write after materialization lands in the new storage");
    check(new Uint32Array(buffer)[0], 0xC0FFEE, "write visible through the materialized buffer");
    // (before/after may or may not differ numerically depending on the
    // allocator; the invariant is behavior, asserted above, not the address.)
    void before; void after;

    // Keep the hot site polymorphic across modes so one compiled body sees all three.
    const rotation = [fast, oversize, wasteful, migrant];
    for (let i = 0; i < 4e4; ++i) {
        const view = rotation[i & 3];
        const expected = view[0];
        check(readU32(view), expected, "rotating-mode read " + (i & 3));
    }

    // ---- 3. A view over a SLICE of a buffer (byteOffset != 0): the pointer
    // must include the offset (vector() already does; this pins it).
    const slab = new ArrayBuffer(64);
    const whole = new Uint32Array(slab);
    whole[3] = 0xDEAD10;
    const sliced = new Uint32Array(slab, 12, 4); // byteOffset 12 -> element index 3
    for (let i = 0; i < 2e4; ++i)
        check(readU32(sliced), 0xDEAD10, "sliced view reads at its byteOffset");
    writeU32(sliced, 0x51CE);
    check(whole[3], 0x51CE, "write through sliced view lands at the offset");

    // ---- 4. Mode transition triggered INSIDE the FFI call by a JS callback,
    // while native code (conceptually) still holds the pre-call vector. This
    // is the documented user-error case (like detach-during-callback); the
    // engine's contract is only that it does not crash and stays consistent
    // AFTER the call. The callback materializes .buffer on a Fast view.
    const trigger = new Uint32Array(4);
    trigger[0] = 0x1EAD;
    const materializeInCallback = $vm.ffiCallback({ args: [], returns: "void" }, () => {
        trigger.buffer; // slowDownAndWasteMemory mid-FFI-call
    });
    for (let i = 0; i < 5e3; ++i) {
        // Pass the callback's native entrypoint as a plain pointer; the fixture calls it.
        callVoid(materializeInCallback.ptr);
        check(readU32(trigger), 0x1EAD, "read of the (already-materialized) view after callback " + i);
    }

    // ---- 5. Detach hot: the same site sees a live view, then that view is
    // detached; conversion yields a null pointer (0) from then on (§5), at every tier.
    const doomed = new ArrayBuffer(32);
    const doomedView = new Uint32Array(doomed);
    for (let i = 0; i < 2e4; ++i)
        currentPtr(doomedView);
    check(currentPtr(doomedView) !== null && currentPtr(doomedView) !== 0, true, "live view yields a non-null pointer");
    if (typeof doomed.transfer === "function")
        doomed.transfer();
    else if (typeof transferArrayBuffer === "function")
        transferArrayBuffer(doomed);
    else
        return; // No detach primitive in this shell; sections 1-4 still ran.
    check(doomedView.length, 0, "view is detached");
    for (let i = 0; i < 100; ++i)
        check(currentPtr(doomedView), null, "detached view -> null pointer after tier-up (iteration " + i + ")");
}
noInline(main);

main();
// A full GC and a second run make the storage-lifetime story exercise
// reclamation of the (now-unreferenced) pre-materialization storage.
gc();
main();
