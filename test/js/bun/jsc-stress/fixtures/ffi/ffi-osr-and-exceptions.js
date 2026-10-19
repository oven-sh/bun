//@ requireOptions("--useDollarVM=1")

// FFI calls in optimized code: OSR-exit-inducing argument type changes midway
// through a hot loop, and exceptions (from callbacks and from argument
// conversion) thrown inside DFG/FTL-compiled code with and without a
// surrounding try/catch. Results must be identical before/after any exit.

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + String(expected) + " but got " + String(actual));
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const addI32 = $vm.ffiFunction({ args: ["i32", "i32"], returns: "i32" }, fixture("ffi_add_i32"), "ffi_add_i32");
    const addF64 = $vm.ffiFunction({ args: ["f64", "f64"], returns: "f64" }, fixture("ffi_add_f64"), "ffi_add_f64");
    const echoBool = $vm.ffiFunction({ args: ["bool"], returns: "bool" }, fixture("ffi_echo_bool"), "ffi_echo_bool");
    const echoU8 = $vm.ffiFunction({ args: ["u8"], returns: "u8" }, fixture("ffi_echo_u8"), "ffi_echo_u8");
    const echoPtr = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, fixture("ffi_echo_ptr"), "ffi_echo_ptr");
    const callCbVoid = $vm.ffiFunction({ args: ["function"], returns: "void" }, fixture("ffi_call_cb_void"), "ffi_call_cb_void");
    const callCbI32 = $vm.ffiFunction({ args: ["function", "i32"], returns: "i32" }, fixture("ffi_call_cb_i32"), "ffi_call_cb_i32");

    // ---- 1. Type change after the loop is hot: int32 -> double -> boolean -> undefined.
    function hotAdd(a, b) {
        return addI32(a, b);
    }
    noInline(hotAdd);
    for (let i = 0; i < 3e4; ++i) {
        const r = hotAdd(i, 1);
        if (r !== ((i + 1) | 0))
            throw new Error("hotAdd int32 phase iteration " + i + " got " + r);
    }
    // Now feed non-int32 values through the same (compiled) call site.
    check(hotAdd(0.5, 5), 5, "hotAdd(0.5, 5) after tier-up (toInt32(0.5) == 0)");
    check(hotAdd(2.9, -3.9), -1, "hotAdd(2.9, -3.9)");
    check(hotAdd(4294967296 + 7, 1), 8, "hotAdd(2^32 + 7, 1)");
    check(hotAdd(true, false), 1, "hotAdd(true, false)");
    check(hotAdd(undefined, 41), 41, "hotAdd(undefined, 41)");
    check(hotAdd(null, -2), -2, "hotAdd(null, -2)");
    check(hotAdd(NaN, 3), 3, "hotAdd(NaN, 3)");
    check(hotAdd(Infinity, 3), 3, "hotAdd(Infinity, 3)");
    check(hotAdd(-0, 3), 3, "hotAdd(-0, 3)");
    // Alternating types every iteration (the site cannot stay speculated).
    for (let i = 0; i < 1e4; ++i) {
        const a = (i & 1) ? i + 0.5 : i;
        const r = hotAdd(a, 2);
        if (r !== ((i + 2) | 0))
            throw new Error("hotAdd alternating phase iteration " + i + " got " + r);
    }
    // And back to int32 only: still correct after re-optimization.
    for (let i = 0; i < 2e4; ++i) {
        const r = hotAdd(i, -i);
        if (r !== 0)
            throw new Error("hotAdd re-warm iteration " + i + " got " + r);
    }

    // ---- 2. Double edges: NaN / -0 / infinities through a hot double call site.
    function hotAddF64(a, b) {
        return addF64(a, b);
    }
    noInline(hotAddF64);
    for (let i = 0; i < 3e4; ++i) {
        const r = hotAddF64(i * 0.5, 0.25);
        if (r !== i * 0.5 + 0.25)
            throw new Error("hotAddF64 iteration " + i + " got " + r);
    }
    check(hotAddF64(NaN, 1), NaN, "hotAddF64(NaN, 1)");
    check(hotAddF64(-0, -0), -0, "hotAddF64(-0, -0)");
    check(hotAddF64(-0, 0), 0, "hotAddF64(-0, 0)");
    check(hotAddF64(Infinity, -Infinity), NaN, "hotAddF64(Inf, -Inf)");
    check(hotAddF64(1, undefined), NaN, "hotAddF64(1, undefined)"); // undefined -> NaN
    check(hotAddF64(2, 3), 5, "hotAddF64 int32 arguments (Int32 -> Double)");
    check(hotAddF64(1e308, 1e308), Infinity, "hotAddF64 overflow");

    // ---- 3. bool / u8 / ptr sites that see every input class after warm-up.
    function hotBool(x) {
        return echoBool(x);
    }
    noInline(hotBool);
    for (let i = 0; i < 2e4; ++i) {
        if (hotBool(true) !== true)
            throw new Error("hotBool warm iteration " + i);
    }
    check(hotBool(0), false, "hotBool(0)");
    check(hotBool(2), true, "hotBool(2)");
    check(hotBool(-0), false, "hotBool(-0)");
    check(hotBool(NaN), false, "hotBool(NaN)");
    check(hotBool(0.5), true, "hotBool(0.5)");
    check(hotBool(null), false, "hotBool(null)");
    check(hotBool(undefined), false, "hotBool(undefined)");
    check(hotBool(256), true, "hotBool(256): any non-zero int32 is true (never and32(1))");
    for (let i = 0; i < 2e4; ++i) {
        if (hotBool(i & 3) !== ((i & 3) !== 0))
            throw new Error("hotBool int32 phase iteration " + i);
    }

    function hotU8(x) {
        return echoU8(x);
    }
    noInline(hotU8);
    for (let i = 0; i < 2e4; ++i) {
        if (hotU8(i) !== (i & 0xff))
            throw new Error("hotU8 warm iteration " + i);
    }
    check(hotU8(-1), 255, "hotU8(-1)");
    check(hotU8(3.99), 3, "hotU8(3.99)");
    check(hotU8(300), 44, "hotU8(300) wraps mod 256");
    check(hotU8(true), 1, "hotU8(true)");
    check(hotU8(null), 0, "hotU8(null)");
    let symbolThrew = false;
    try {
        hotU8(Symbol("bad"));
    } catch (e) {
        symbolThrew = e instanceof TypeError;
    }
    check(symbolThrew, true, "hotU8(Symbol) throws a TypeError (Symbols do not coerce)");

    function hotPtr(x) {
        return echoPtr(x);
    }
    noInline(hotPtr);
    const view = new Uint8Array(8);
    const viewAddress = hotPtr(view);
    for (let i = 0; i < 2e4; ++i) {
        if (hotPtr(view) !== viewAddress)
            throw new Error("hotPtr view warm iteration " + i);
    }
    check(hotPtr(0), null, "hotPtr(0)");
    check(hotPtr(null), null, "hotPtr(null)");
    check(hotPtr(4096), 4096, "hotPtr(number)");
    check(hotPtr(new ArrayBuffer(4)) > 0, true, "hotPtr(ArrayBuffer)");
    check(hotPtr(view), viewAddress, "hotPtr(view) after other classes");

    // ---- 4. Exceptions thrown inside optimized code.
    // (a) Conversion errors from an FFI argument, caught inside the hot loop.
    function guarded(value) {
        try {
            return { ok: true, value: hotPtr(value) };
        } catch (e) {
            if (!(e instanceof TypeError))
                throw new Error("expected TypeError from pointer conversion, got " + e);
            return { ok: false, message: e.message };
        }
    }
    noInline(guarded);
    for (let i = 0; i < 1e4; ++i) {
        const good = guarded(view);
        if (!good.ok || good.value !== viewAddress)
            throw new Error("guarded warm iteration " + i);
    }
    const symbolResult = guarded(Symbol("nope"));
    check(symbolResult.ok, false, "guarded(Symbol) throws TypeError in optimized code");
    const stringResult = guarded("not a pointer");
    check(stringResult.ok, false, "guarded(string) throws TypeError in optimized code");
    const objectResult = guarded({ length: 4 });
    check(objectResult.ok, false, "guarded(plain object) throws TypeError in optimized code");
    check(guarded(view).value, viewAddress, "guarded still fine after exceptions");
    for (let i = 0; i < 5000; ++i) {
        const bad = (i % 100) === 99;
        const result = guarded(bad ? Symbol.iterator : view);
        if (bad !== !result.ok)
            throw new Error("guarded mixed iteration " + i);
    }

    // (b) A throwing callback inside a hot loop, try/catch inside the loop.
    const throwingCb = $vm.ffiCallback({ args: [], returns: "void" }, () => {
        throw new RangeError("callback says no");
    });
    function loopWithCatch(iterations) {
        let caught = 0;
        for (let i = 0; i < iterations; ++i) {
            try {
                callCbVoid(throwingCb);
            } catch (e) {
                if (e instanceof RangeError)
                    caught++;
                else
                    throw e;
            }
        }
        return caught;
    }
    noInline(loopWithCatch);
    check(loopWithCatch(10), 10, "loopWithCatch cold");
    check(loopWithCatch(15000), 15000, "loopWithCatch hot");

    // (c) A throwing callback with the try/catch OUTSIDE the hot function:
    //     the exception unwinds out of optimized code exactly once.
    let armed = -1;
    const armedCb = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => {
        if (x === armed)
            throw new EvalError("armed at " + x);
        return x * 2;
    });
    function unguardedLoop(count) {
        let sum = 0;
        for (let i = 0; i < count; ++i)
            sum += callCbI32(armedCb, i);
        return sum;
    }
    noInline(unguardedLoop);
    check(unguardedLoop(1000), 999000, "unguardedLoop warm 1");
    for (let i = 0; i < 30; ++i)
        check(unguardedLoop(1000), 999000, "unguardedLoop warm loop " + i);
    armed = 500;
    let seen = null;
    try {
        unguardedLoop(1000);
    } catch (e) {
        seen = e;
    }
    if (!(seen instanceof EvalError) || seen.message !== "armed at 500")
        throw new Error("expected the armed EvalError from optimized code, got " + seen);
    armed = -1;
    check(unguardedLoop(1000), 999000, "unguardedLoop after the exception");

    // (d) An exception thrown by a JS callee INSIDE a callback that itself was
    //     invoked from an FFI call inside a try: nested unwinding.
    const outerCb = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => {
        if (x < 3)
            return unguardedLoopThrow(x);
        return x;
    });
    function unguardedLoopThrow(x) {
        armed = 0;
        try {
            return unguardedLoop(10);
        } finally {
            armed = -1;
        }
    }
    let nested = null;
    try {
        callCbI32(outerCb, 1);
    } catch (e) {
        nested = e;
    }
    if (!(nested instanceof EvalError))
        throw new Error("expected the nested EvalError, got " + nested);
    check(callCbI32(outerCb, 7), 7, "outer callback usable after nested throw");
}

if ($vm.useJIT())
    main();
