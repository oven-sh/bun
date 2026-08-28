//@ requireOptions("--useDollarVM=1")

// Stack-alignment probes (SPEC section 11.1): each fixture performs an
// aligned 16-byte vector access on a 16-byte-aligned local, which faults if
// the FFI caller (host path, IC stub, DFG/FTL CallFFI, or the callback thunk
// on the way back into native code) mis-aligned the stack. Both probes must
// return exactly 1.0 in every tier.

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const probe0 = $vm.ffiFunction({ args: [], returns: "f64" }, fixture("ffi_align_probe_0"), "ffi_align_probe_0");
    const probe9 = $vm.ffiFunction({ args: new Array(9).fill("i32"), returns: "f64" }, fixture("ffi_align_probe_9"), "ffi_align_probe_9");
    const callCbVoid = $vm.ffiFunction({ args: ["function"], returns: "void" }, fixture("ffi_call_cb_void"), "ffi_call_cb_void");
    const callCbI32 = $vm.ffiFunction({ args: ["function", "i32"], returns: "i32" }, fixture("ffi_call_cb_i32"), "ffi_call_cb_i32");

    if (probe0() !== 1)
        throw new Error("ffi_align_probe_0 cold: " + probe0());
    if (probe9(1, 2, 3, 4, 5, 6, 7, 8, 9) !== 1)
        throw new Error("ffi_align_probe_9 cold");
    // Missing / extra JS arguments must not change the call frame layout.
    if (probe9(1, 2, 3) !== 1)
        throw new Error("ffi_align_probe_9 with missing arguments");
    if (probe9(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) !== 1)
        throw new Error("ffi_align_probe_9 with extra arguments");
    if (probe0(1) !== 1)
        throw new Error("ffi_align_probe_0 with an extra argument");

    // Hot: every tier's call path must keep 16-byte alignment.
    for (let i = 0; i < 3e4; ++i) {
        if (probe0() !== 1)
            throw new Error("ffi_align_probe_0 hot iteration " + i);
    }
    for (let i = 0; i < 3e4; ++i) {
        if (probe9(i, -i, i, -i, i, -i, i, -i, i) !== 1)
            throw new Error("ffi_align_probe_9 hot iteration " + i);
    }
    // Mixed argument shapes (int32 and double) at the same call site.
    for (let i = 0; i < 1e4; ++i) {
        if (probe9(i + 0.5, 1, 2, 3, 4, 5, 6, 7, 8) !== 1)
            throw new Error("ffi_align_probe_9 double first argument iteration " + i);
    }

    // Alignment on the way back out: a callback that runs the probes from
    // inside the native -> JS -> native sandwich.
    const cbProbe = $vm.ffiCallback({ args: [], returns: "void" }, () => {
        if (probe0() !== 1)
            throw new Error("probe0 inside callback");
        if (probe9(9, 8, 7, 6, 5, 4, 3, 2, 1) !== 1)
            throw new Error("probe9 inside callback");
    });
    for (let i = 0; i < 3000; ++i)
        callCbVoid(cbProbe);

    // Nested: FFI -> callback -> FFI -> callback -> probe, to depth 20.
    const nestCb = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, depth => {
        if (probe0() !== 1)
            throw new Error("probe0 at depth " + depth);
        if (depth <= 0)
            return 0;
        return callCbI32(nestCb, depth - 1) + 1;
    });
    for (let i = 0; i < 200; ++i) {
        if (callCbI32(nestCb, 20) !== 20)
            throw new Error("nested alignment ladder iteration " + i);
    }
}

if ($vm.useJIT())
    main();
