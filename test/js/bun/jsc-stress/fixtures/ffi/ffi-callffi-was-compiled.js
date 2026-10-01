//@ requireOptions("--useDollarVM=1", "--useConcurrentJIT=0", "--jitPolicyScale=0")

// Proves the ByteCodeParser feed + strength-reduction conversion are not
// dead code: after a hot exact-arity monomorphic call site, at least one
// CallFFI node must have been compiled by the DFG or FTL, and creating an FFI
// function must have compiled an IC entry stub (SPEC sections 10.2, 11.2).
// The compile counts are process-global atomics read via
// $vm.ffiCompileCounts().

function main() {
    const before = $vm.ffiCompileCounts();
    if (typeof before !== "object" || typeof before.icStub !== "number" || typeof before.dfgCallFFI !== "number" || typeof before.ftlCallFFI !== "number")
        throw new Error("bad $vm.ffiCompileCounts() shape: " + JSON.stringify(before));

    const addI32 = $vm.ffiFunction({ args: ["i32", "i32"], returns: "i32" }, $vm.ffiFixture("ffi_add_i32"), "ffi_add_i32");
    const echoF64 = $vm.ffiFunction({ args: ["f64"], returns: "f64" }, $vm.ffiFixture("ffi_echo_f64"), "ffi_echo_f64");
    const echoBool = $vm.ffiFunction({ args: ["bool"], returns: "bool" }, $vm.ffiFixture("ffi_echo_bool"), "ffi_echo_bool");
    const echoPtr = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, $vm.ffiFixture("ffi_echo_ptr"), "ffi_echo_ptr");
    const echoI64 = $vm.ffiFunction({ args: ["i64"], returns: "i64" }, $vm.ffiFixture("ffi_echo_i64"), "ffi_echo_i64");

    const afterCreation = $vm.ffiCompileCounts();
    if (afterCreation.icStub <= before.icStub) {
        // The IC stub is generated eagerly in JSFFIFunction::create() when
        // Options::useFFIICStub() (default true).
        throw new Error("no IC stub was compiled by JSFFIFunction creation: before " + before.icStub + ", after " + afterCreation.icStub);
    }
    if (afterCreation.icStub < before.icStub + 5)
        throw new Error("expected one IC stub per JSFFIFunction: before " + before.icStub + ", after " + afterCreation.icStub);

    // Exact-arity, monomorphic, hot: everything the conversion requires.
    function hot(a, b) {
        return addI32(a, b);
    }
    noInline(hot);
    function hotTyped(d, flag, view, big) {
        // Several typed CallFFI conversions in one code block.
        const x = echoF64(d) + (echoBool(flag) ? 1 : 0);
        const p = echoPtr(view);
        const b = echoI64(big);
        return x + (p === null ? 0 : 1) + Number(b & 0xffn);
    }
    noInline(hotTyped);

    const view = new Uint8Array(4);
    let sink = 0;
    for (let i = 0; i < 1e5; ++i)
        sink += hot(i, 1);
    if (sink !== 5000050000)
        throw new Error("hot arithmetic wrong: " + sink);
    for (let i = 0; i < 1e5; ++i)
        sink += hotTyped(i + 0.5, i & 1, view, BigInt(i) & 0x7fn);
    if (!Number.isFinite(sink))
        throw new Error("hotTyped produced a non-finite sum");

    const counts = $vm.ffiCompileCounts();
    // Only demand CallFFI compilation when the DFG actually compiled the hot
    // callers in this configuration (some harness configs disable the DFG).
    const dfgRan = numberOfDFGCompiles(hot) > 0 || numberOfDFGCompiles(hotTyped) > 0;
    if (dfgRan && counts.dfgCallFFI + counts.ftlCallFFI === 0)
        throw new Error("DFG compiled the hot callers but no CallFFI node was compiled: " + JSON.stringify(counts));
    if (counts.dfgCallFFI + counts.ftlCallFFI < before.dfgCallFFI + before.ftlCallFFI)
        throw new Error("compile counters went backwards");

    // Results are still exactly right after tier-up.
    if (hot(2147483647, 1) !== -2147483648)
        throw new Error("hot(overflow) wrong after compilation");
    if (hot(-5, 10) !== 5)
        throw new Error("hot(-5, 10) wrong after compilation");
    if (hotTyped(1.5, true, view, 255n) !== 1.5 + 1 + 1 + 255)
        throw new Error("hotTyped exact value wrong after compilation");
    if (hotTyped(-0.25, false, null, -1n) !== -0.25 + 0 + 0 + Number(BigInt.asIntN(64, -1n) & 0xffn))
        throw new Error("hotTyped with null pointer wrong after compilation");
}

if ($vm.useJIT())
    main();
