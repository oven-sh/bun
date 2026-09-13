//@ requireOptions("--useDollarVM=1")

// Callee-saved register canary (SPEC section 11.1): ffi_canary_call loads
// sentinels into every ABI-callee-saved GPR/FPR, calls the callback, and
// returns a bitmask of the registers that were clobbered. The callback thunk
// (native entry -> callbackDispatch -> JS) plus everything the JS side does
// must preserve all of them, in every JIT tier and with callbacks of every
// arity and behavior.

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + String(expected) + " but got " + String(actual));
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const canary = $vm.ffiFunction({ args: ["function"], returns: "i32" }, fixture("ffi_canary_call"), "ffi_canary_call");
    const addI32 = $vm.ffiFunction({ args: ["i32", "i32"], returns: "i32" }, fixture("ffi_add_i32"), "ffi_add_i32");
    const sumF64_12 = $vm.ffiFunction({ args: new Array(12).fill("f64"), returns: "f64" }, fixture("ffi_sum_f64_12"), "ffi_sum_f64_12");
    const callCbI32 = $vm.ffiFunction({ args: ["function", "i32"], returns: "i32" }, fixture("ffi_call_cb_i32"), "ffi_call_cb_i32");
    const alignProbe0 = $vm.ffiFunction({ args: [], returns: "f64" }, fixture("ffi_align_probe_0"), "ffi_align_probe_0");
    const makeCanaryCallback = fn => $vm.ffiCallback({ args: [], returns: "void" }, fn);

    let sink = 0;
    // Callbacks of every "arity"/shape wrapped as void(void) native callbacks.
    const behaviours = [
        () => { },
        () => { sink++; },
        (a) => { sink += a === undefined ? 1 : 0; },
        (a, b, c, d, e, f, g, h, i, j, k, l) => { sink += (a === undefined) + (l === undefined); },
        (...rest) => { sink += rest.length; },
        function usesArguments() { sink += arguments.length; },
        () => { let x = 0; for (let i = 0; i < 200; ++i) x = Math.imul(x + i, 31) ^ (x >>> 7); sink += x & 1; },
        () => { const o = []; for (let i = 0; i < 500; ++i) o.push({ i, s: "s" + i }); sink += o.length; },
        () => { sink += addI32(20, 22); }, // re-enter an FFI function from inside the callback
        () => { sink += sumF64_12(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) | 0; }, // fp-heavy re-entry
        () => { const inner = makeCanaryCallback(() => { sink++; }); sink += canary(inner); }, // nested canary
        () => { const cb = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => x * 3); sink += callCbI32(cb, 14); },
        () => { let d = 0.5; for (let i = 0; i < 100; ++i) d = Math.sqrt(d + i) * 1.0001; sink += d | 0; }, // touches many FP registers
        () => { gc(); },
        () => { fullGC(); },
        () => { try { throw new Error("caught inside"); } catch (e) { sink += e.message.length; } },
        () => { sink += alignProbe0() === 1 ? 1 : 100; }, // stack alignment inside the callback frame
        () => { const big = 2n ** 200n + 1n; sink += Number(big % 3n); },
        () => { sink += "abc".repeat(64).length; },
        async () => { sink++; }, // returns a promise (ignored by the void return conversion)
        () => 12345, // returns a value for a void callback: ignored
    ];

    for (let i = 0; i < behaviours.length; ++i) {
        const cb = makeCanaryCallback(behaviours[i]);
        const mask = canary(cb);
        check(mask, 0, "canary with behaviour #" + i);
    }

    // The same callbacks, but hot: the FFI call to ffi_canary_call itself goes
    // through the IC stub / DFG / FTL paths, whose register state differs. The
    // full-heap gc()/fullGC() behaviours (#13/#14) stay in the cold pass only:
    // hundreds of synchronous full collections would blow the per-test time
    // budget in debug builds without adding register coverage.
    const hotBehaviours = behaviours.filter((_, index) => index !== 13 && index !== 14);
    const hotCallbacks = hotBehaviours.map(makeCanaryCallback);
    for (let iteration = 0; iteration < 4000; ++iteration) {
        const cb = hotCallbacks[iteration % hotCallbacks.length];
        const mask = canary(cb);
        if (mask !== 0)
            throw new Error("canary clobber mask 0x" + mask.toString(16) + " at hot iteration " + iteration + " (behaviour #" + (iteration % hotCallbacks.length) + ")");
    }

    // A monomorphic hot loop so the caller reliably tiers up with one callback.
    const trivial = makeCanaryCallback(() => { sink++; });
    for (let iteration = 0; iteration < 2e4; ++iteration) {
        if (canary(trivial) !== 0)
            throw new Error("canary trivial hot iteration " + iteration);
    }

    // A canary callback that throws: the exception propagates from the
    // canary's FFI call site (the canary's own return value is then not
    // observable, but the throw path must not corrupt the frame either).
    const throwing = makeCanaryCallback(() => { throw new TypeError("boom"); });
    let caught = 0;
    for (let i = 0; i < 200; ++i) {
        try {
            canary(throwing);
        } catch (e) {
            if (!(e instanceof TypeError))
                throw new Error("wrong exception type from throwing canary callback: " + e);
            caught++;
        }
    }
    check(caught, 200, "throwing canary callbacks");
    // ... and the canary is unharmed afterwards.
    check(canary(trivial), 0, "canary after exceptions");

    if (sink < 0)
        throw new Error("unreachable");
}

if ($vm.useJIT())
    main();
