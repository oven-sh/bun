//@ requireOptions("--useDollarVM=1")

// JSFFICallback: native -> JS calls through every ffi_call_cb_* fixture.
// Covers argument marshaling into JS (register and stack ladders, sub-8-byte
// arguments, mixed classes), return-value coercion, exceptions surfacing at
// the FFI call site, GC inside a callback while a pointer argument is
// outstanding, re-entrancy (loop and nested to depth 100), and the
// JS -> native -> JS round trip of a callback wrapped back into an FFI
// function.

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (Object.is(value, -0))
        return "-0";
    if (typeof value === "symbol")
        return value.toString();
    return String(value);
}

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + describe(expected) + " but got " + describe(actual));
}

// Returns a NEW caller function every time (a distinct FunctionExecutable /
// CodeBlock via `new Function`), so the FFI call site inside it is
// monomorphic, exact-arity and non-spread -- the only call-site shape the DFG
// Call -> CallFFI conversion accepts (SPEC section 10.2). The hot round-trip
// loop uses it so the JS -> native -> JS sandwich runs under a compiled
// CallFFI rather than a shared spread call site.
function makeMonomorphicCaller(arity) {
    const argumentList = Array.from({ length: arity }, (_, i) => "args[" + i + "]").join(", ");
    return new Function("callable", "args", "return callable(" + argumentList + ");");
}

function checkThrows(fn, validate, message) {
    let thrown = false;
    try {
        fn();
    } catch (e) {
        thrown = true;
        if (validate)
            validate(e);
    }
    if (!thrown)
        throw new Error(message + ": expected an exception");
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (name, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(name), name);
    const callback = (args, ret, fn) => $vm.ffiCallback({ args, returns: ret }, fn);

    const callCbI32 = bind("ffi_call_cb_i32", ["function", "i32"], "i32");
    const callCbF64x8 = bind("ffi_call_cb_f64_x8", ["function", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64"], "f64");
    const callCbF64x9 = bind("ffi_call_cb_f64_x9", ["function", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64"], "f64");
    const callCbI32x9 = bind("ffi_call_cb_i32_x9", ["function", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32"], "i64");
    const callCbU8x10 = bind("ffi_call_cb_u8_x10", ["function", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8"], "i64");
    const callCbMix = bind("ffi_call_cb_mix", ["function", "i32", "f64", "i64", "f32", "ptr"], "f64");
    const callCbVoid = bind("ffi_call_cb_void", ["function"], "void");
    const callCbReentrant = bind("ffi_call_cb_reentrant", ["function", "i32"], "i32");
    const callCbRetI8 = bind("ffi_call_cb_ret_i8", ["function"], "i64_fast");
    const callCbRetU8 = bind("ffi_call_cb_ret_u8", ["function"], "i64_fast");
    const callCbRetI64 = bind("ffi_call_cb_ret_i64", ["function"], "i64");
    const callCbRetU64 = bind("ffi_call_cb_ret_u64", ["function"], "u64");
    const callCbRetBool = bind("ffi_call_cb_ret_bool", ["function"], "i32");
    const callCbRetF32 = bind("ffi_call_cb_ret_f32", ["function"], "f32");
    const callCbRetF64 = bind("ffi_call_cb_ret_f64", ["function"], "f64");
    const callCbRetPtr = bind("ffi_call_cb_ret_ptr", ["function"], "ptr");
    const callCbThenReadU32 = bind("ffi_call_cb_then_read_u32", ["function", "ptr"], "u32");
    const addI32 = bind("ffi_add_i32", ["i32", "i32"], "i32");

    // ---- Basics: arguments in, results out, .ptr and object forms.
    {
        const cb = callback(["i32"], "i32", x => x * 2 + 1);
        check(typeof cb.ptr, "number", "callback .ptr typeof");
        if (!(cb.ptr > 0))
            throw new Error("callback .ptr should be a positive address");
        check(cb.threadsafe, false, "callback .threadsafe");
        for (const x of [0, 1, -1, 21, 1073741823, -1073741824, 2147483647, -2147483648]) {
            const expected = (x * 2 + 1) | 0;
            check(callCbI32(cb, x), expected, "ffi_call_cb_i32(cb, " + x + ")");
            check(callCbI32(cb.ptr, x), expected, "ffi_call_cb_i32(cb.ptr, " + x + ")");
        }
        for (let i = 0; i < 3e4; ++i) {
            const r = callCbI32(cb, i & 1023);
            if (r !== ((i & 1023) * 2 + 1))
                throw new Error("hot ffi_call_cb_i32 iteration " + i + " got " + r);
        }
    }

    // ---- Argument ladders into JS: 8 and 9 doubles, 9 int32s (stack args), 10 uint8s (packed stack args).
    {
        const received = [];
        const recorder = (...args) => {
            received.length = 0;
            for (const a of args)
                received.push(a);
            let sum = 0;
            for (let i = 0; i < args.length; ++i)
                sum += (i + 1) * args[i];
            return sum;
        };
        const cbF64x8 = callback(["f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64"], "f64", recorder);
        const values8 = [0.5, -1.25, 3.75, -4.5, 5.0625, -6.5, 7.75, -8.875];
        check(callCbF64x8(cbF64x8, ...values8), values8.reduce((s, v, i) => s + (i + 1) * v, 0), "ffi_call_cb_f64_x8 result");
        for (let i = 0; i < 8; ++i)
            check(received[i], values8[i], "ffi_call_cb_f64_x8 argument " + i);

        const cbF64x9 = callback(["f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64"], "f64", recorder);
        const values9 = [1e10, -0.03125, 2 ** 40, -(2 ** 39), 0.5, 1.5, 2.5, 3.5, -0];
        check(callCbF64x9(cbF64x9, ...values9), values9.reduce((s, v, i) => s + (i + 1) * v, 0), "ffi_call_cb_f64_x9 result");
        for (let i = 0; i < 9; ++i)
            check(received[i], values9[i], "ffi_call_cb_f64_x9 argument " + i);

        const recorderInt = (...args) => {
            received.length = 0;
            for (const a of args)
                received.push(a);
            let sum = 0;
            for (let i = 0; i < args.length; ++i)
                sum += (i + 1) * args[i];
            return sum;
        };
        const cbI32x9 = callback(["i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32"], "i64", recorderInt);
        const ints = [1, -2, 3, -4, 5, -6, 7, -8, 2147483647];
        check(callCbI32x9(cbI32x9, ...ints), 1n - 4n + 9n - 16n + 25n - 36n + 49n - 64n + 9n * 2147483647n, "ffi_call_cb_i32_x9 result");
        for (let i = 0; i < 9; ++i)
            check(received[i], ints[i], "ffi_call_cb_i32_x9 argument " + i);
        const negatives = [-2147483648, -1, -2147483648, -1, -2147483648, -1, -2147483648, -1, -2147483648];
        callCbI32x9(cbI32x9, ...negatives);
        for (let i = 0; i < 9; ++i)
            check(received[i], negatives[i], "ffi_call_cb_i32_x9 negative argument " + i);

        const cbU8x10 = callback(["u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8"], "i64", recorderInt);
        const bytes = [255, 0, 128, 1, 200, 17, 254, 3, 99, 250];
        check(callCbU8x10(cbU8x10, ...bytes), BigInt(bytes.reduce((s, v, i) => s + (i + 1) * v, 0)), "ffi_call_cb_u8_x10 result");
        for (let i = 0; i < 10; ++i)
            check(received[i], bytes[i], "ffi_call_cb_u8_x10 argument " + i);
        // Distinct powers of two catch any swapped or dropped stack byte.
        const powers = [1, 2, 4, 8, 16, 32, 64, 128, 3, 5];
        check(callCbU8x10(cbU8x10, ...powers), BigInt(powers.reduce((s, v, i) => s + (i + 1) * v, 0)), "ffi_call_cb_u8_x10 powers");
        for (let i = 0; i < 10; ++i)
            check(received[i], powers[i], "ffi_call_cb_u8_x10 powers argument " + i);
    }

    // ---- Mixed argument classes; pointer arguments arrive as numbers, null pointers as null.
    {
        let last = null;
        const cbMixFast = callback(["i32", "f64", "i64_fast", "f32", "ptr"], "f64", (a, b, c, d, e) => {
            last = [a, b, c, d, e];
            return a + 2 * b + 3 * Number(c) + 4 * d + 5 * (e === null ? -1 : e);
        });
        check(callCbMix(cbMixFast, -5, 2.5, 4503599627370496, 1.25, 8192), -5 + 5 + 3 * 4503599627370496 + 5 + 40960, "ffi_call_cb_mix result");
        check(last[0], -5, "mix arg i32");
        check(last[1], 2.5, "mix arg f64");
        check(last[2], 4503599627370496, "mix arg i64_fast (Number range)");
        check(last[3], 1.25, "mix arg f32");
        check(last[4], 8192, "mix arg ptr");
        callCbMix(cbMixFast, 0, -0, 0, Math.fround(1.1), 0);
        check(last[1], -0, "mix arg f64 keeps the sign of zero");
        check(last[3], Math.fround(1.1), "mix arg f32 is the exact float value");
        check(last[4], null, "mix arg ptr null becomes JS null");
        const cbMixBig = callback(["i32", "f64", "i64", "f32", "ptr"], "f64", (a, b, c, d, e) => {
            last = [a, b, c, d, e];
            return 0;
        });
        callCbMix(cbMixBig, 1, 2, 2n ** 62n, 3, 4);
        check(last[2], 2n ** 62n, "mix arg i64 as BigInt");
        check(typeof last[2], "bigint", "mix arg i64 typeof");
    }

    // ---- Void callback and side effects.
    {
        let count = 0;
        const cbVoid = callback([], "void", () => { count++; });
        check(callCbVoid(cbVoid), undefined, "ffi_call_cb_void returns undefined");
        check(count, 1, "void callback invoked once");
        for (let i = 0; i < 2e4; ++i)
            callCbVoid(cbVoid);
        check(count, 2e4 + 1, "void callback hot count");
    }

    // ---- Return-value coercion (what native code sees after conversion).
    {
        check(callCbRetU8(callback([], "u8", () => 511)), 255, "u8 callback return wraps mod 256");
        check(callCbRetU8(callback([], "u8", () => -1)), 255, "u8 callback return of -1");
        check(callCbRetI8(callback([], "i8", () => 128)), -128, "i8 callback return wraps");
        check(callCbRetI8(callback([], "i8", () => undefined)), 0, "i8 callback returning undefined -> 0");
        check(callCbRetI8(callback([], "i8", () => null)), 0, "i8 callback returning null -> 0");
        check(callCbRetI8(callback([], "i8", () => true)), 1, "i8 callback returning true -> 1");
        check(callCbRetI64(callback([], "i64", () => 2n ** 63n - 1n)), 9223372036854775807n, "i64 callback returning INT64_MAX BigInt");
        check(callCbRetI64(callback([], "i64", () => -1)), -1n, "i64 callback returning -1 number");
        check(callCbRetI64(callback([], "i64", () => 2 ** 53)), 9007199254740992n, "i64 callback returning 2^53 number");
        check(callCbRetI64(callback([], "i64", () => -1.75)), -1n, "i64 callback returning -1.75 truncates");
        check(callCbRetU64(callback([], "u64", () => -1)), 18446744073709551615n, "u64 callback returning -1");
        check(callCbRetU64(callback([], "u64", () => 2n ** 64n + 5n)), 5n, "u64 callback BigInt mod 2^64");
        check(callCbRetBool(callback([], "bool", () => 2)), 10, "bool callback returning 2 -> true");
        check(callCbRetBool(callback([], "bool", () => 0)), 20, "bool callback returning 0 -> false");
        check(callCbRetBool(callback([], "bool", () => null)), 20, "bool callback returning null -> false");
        check(callCbRetBool(callback([], "bool", () => -0.5)), 10, "bool callback returning -0.5 -> true");
        check(callCbRetBool(callback([], "bool", () => NaN)), 20, "bool callback returning NaN -> false");
        check(Number.isNaN(callCbRetF32(callback([], "f32", () => NaN))), true, "f32 callback NaN return");
        check(callCbRetF32(callback([], "f32", () => 1.1)), Math.fround(1.1), "f32 callback return is rounded to float");
        check(callCbRetF64(callback([], "f64", () => -0)), -0, "f64 callback -0 return");
        check(callCbRetF64(callback([], "f64", () => undefined)), NaN, "f64 callback returning undefined -> NaN");
        check(callCbRetPtr(callback([], "ptr", () => 0)), null, "ptr callback returning 0 -> null");
        check(callCbRetPtr(callback([], "ptr", () => 65536)), 65536, "ptr callback returning 65536");
        check(callCbRetPtr(callback([], "ptr", () => null)), null, "ptr callback returning null");
        const array = new Uint8Array(8);
        const address = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, fixture("ffi_ptr_identity"), "identity")(array);
        check(callCbRetPtr(callback([], "ptr", () => array)), address, "ptr callback returning a TypedArray");
    }

    // ---- Callback returning a value that cannot convert: TypeError at the call site.
    {
        const badReturns = [
            [callback([], "i8", () => "not a number"), callCbRetI8, "string for i8"],
            [callback([], "i8", () => Symbol("s")), callCbRetI8, "symbol for i8"],
            [callback([], "ptr", () => "string"), callCbRetPtr, "string for ptr"],
            [callback([], "ptr", () => ({})), callCbRetPtr, "plain object for ptr"],
            [callback([], "u64", () => "abc"), callCbRetU64, "string for u64"],
        ];
        for (const [cb, caller, label] of badReturns) {
            checkThrows(() => caller(cb), e => {
                if (!(e instanceof TypeError))
                    throw new Error(label + ": expected a TypeError, got " + e);
            }, label);
        }
    }

    // ---- A throwing callback: the exception (with its JS stack) surfaces at the FFI call site.
    {
        function throwingCallback(x) {
            if (x === 13)
                throw new RangeError("thirteen from callback");
            return x + 1;
        }
        const cbThrow = callback(["i32"], "i32", throwingCallback);
        check(callCbI32(cbThrow, 12), 13, "throwing callback fine path");
        let caught = null;
        try {
            callCbI32(cbThrow, 13);
        } catch (e) {
            caught = e;
        }
        if (!(caught instanceof RangeError))
            throw new Error("expected the callback's RangeError to propagate, got " + caught);
        check(caught.message, "thirteen from callback", "callback exception message");
        if (typeof caught.stack !== "string")
            throw new Error("expected the callback exception to carry a JS stack, got: " + caught.stack);
        // The VM must be fully usable afterwards.
        check(callCbI32(cbThrow, 41), 42, "callback usable after an exception");
        // Exceptions from within the last iteration of a native loop over the callback.
        const cbThrowOnLast = callback(["i32"], "i32", i => {
            if (i === 2)
                throw new EvalError("last iteration");
            return i;
        });
        checkThrows(() => callCbReentrant(cbThrowOnLast, 3), e => check(e instanceof EvalError, true, "EvalError from loop callback"), "loop callback throw");
        // In a hot loop with try/catch: every throw is caught, none escapes.
        let count = 0;
        for (let i = 0; i < 5000; ++i) {
            try {
                callCbI32(cbThrow, 13);
                throw new Error("should not reach");
            } catch (e) {
                if (e instanceof RangeError)
                    count++;
                else
                    throw e;
            }
        }
        check(count, 5000, "throwing callback in a hot try/catch loop");
    }

    // ---- gc() / fullGC() inside a callback while a TypedArray pointer argument is outstanding.
    {
        let churn = null;
        const cbGC = callback([], "u32", () => {
            for (let i = 0; i < 100; ++i)
                churn = { i, payload: new Array(16).fill(i) };
            gc();
            fullGC();
            return 42;
        });
        for (let i = 0; i < 20; ++i) {
            // The Uint32Array is a temporary: only the outstanding native call
            // references its storage while the callback collects.
            const result = callCbThenReadU32(cbGC, new Uint32Array([123456789 + i]));
            check(result, 123456789 + i, "read after GC-ing callback iteration " + i);
        }
        // Same, but the view is also written before the call and read after.
        const persistent = new Uint32Array(4);
        persistent[0] = 0xfeedface;
        check(callCbThenReadU32(cbGC, persistent), 0xfeedface >>> 0, "persistent view read after GC-ing callback");
        check(persistent[0], 0xfeedface >>> 0, "persistent view intact after GC-ing callback");
    }

    // ---- Re-entrancy.
    {
        // (a) Loop of 100 callback invocations, each of which re-enters the engine
        //     through another FFI call.
        let seen = 0;
        const cbLoop = callback(["i32"], "i32", i => {
            seen++;
            return addI32(i, 1);
        });
        check(callCbReentrant(cbLoop, 100), 5050, "ffi_call_cb_reentrant(cb, 100)");
        check(seen, 100, "loop callback invocation count");
        check(callCbReentrant(cbLoop, 0), 0, "ffi_call_cb_reentrant depth 0");

        // (b) True nesting to depth 100: JS -> native -> JS -> native -> ... .
        const nestCb = callback(["i32"], "i32", d => 1 + nest(d - 1));
        function nest(depth) {
            if (depth <= 0)
                return 0;
            return callCbI32(nestCb, depth);
        }
        check(nest(100), 100, "nested FFI/callback depth 100");
        check(nest(1), 1, "nested depth 1");

        // (c) A callback that calls the very FFI function that invoked it (with a base case).
        const selfCb = callback(["i32"], "i32", x => x <= 0 ? 0 : callCbI32(selfCb, x - 1) + 2);
        check(callCbI32(selfCb, 40), 80, "self-recursive callback");

        // (d) An exception thrown at depth 50 unwinds through 50 native frames.
        const deepThrowCb = callback(["i32"], "i32", d => {
            if (d === 50)
                throw new URIError("depth 50");
            return 1 + nestThrow(d - 1);
        });
        function nestThrow(depth) {
            if (depth <= 0)
                return 0;
            return callCbI32(deepThrowCb, depth);
        }
        checkThrows(() => nestThrow(80), e => check(e instanceof URIError, true, "deep unwind error type"), "exception from depth 50");
        // Everything still works afterwards.
        check(nest(10), 10, "nested depth 10 after deep unwind");
    }

    // ---- A callback wrapped back into an FFI function: JS -> invoke thunk -> callback thunk -> JS.
    {
        const roundTrips = [
            [{ args: ["i32", "i32"], returns: "i32" }, (a, b) => (a - b) | 0, [[5, 3, 2], [0x7fffffff, -1, -2147483648], [-2147483648, 1, 2147483647]]],
            [{ args: ["f64", "f64"], returns: "f64" }, (a, b) => a / b, [[1, 4, 0.25], [1, 0, Infinity], [-1, 0, -Infinity], [0, 0, NaN]]],
            [{ args: ["f32"], returns: "f32" }, x => x * 2, [[1.5, 3], [Math.fround(1.1), Math.fround(1.1) * 2], [NaN, NaN], [1e39, Infinity]]],
            [{ args: ["u8", "i16"], returns: "i64" }, (a, b) => BigInt(a * 1000 + b), [[255, -1, 254999n], [0, -32768, -32768n], [-1, 32767, 287767n]]],
            [{ args: ["bool", "bool"], returns: "bool" }, (a, b) => a && !b, [[true, false, true], [2, 0, true], [0, 1, false]]],
            [{ args: ["i64", "u64"], returns: "i64" }, (a, b) => a - b, [[10n, 3n, 7n], [-1n, 1n, -2n], [0, 0, 0n]]],
            [{ args: ["char"], returns: "char" }, c => c, [[-1, -1], [255, -1], [0x80, -128], [127, 127]]],
        ];
        for (const [signature, fn, cases] of roundTrips) {
            const cb = $vm.ffiCallback(signature, fn);
            const wrapped = $vm.ffiFunction(signature, cb, "roundtrip " + $vm.ffiSignatureString(signature));
            for (const c of cases) {
                const inputs = c.slice(0, c.length - 1);
                const expected = c[c.length - 1];
                check(wrapped(...inputs), expected, "round trip " + $vm.ffiSignatureString(signature) + "(" + inputs.map(describe).join(",") + ")");
            }
            // Hot: the JS->native->JS sandwich under the JIT tiers, through a
            // dedicated exact-arity monomorphic caller (a spread call site
            // could never become a CallFFI).
            const c = cases[0];
            const inputs = c.slice(0, c.length - 1);
            const expected = c[c.length - 1];
            const caller = makeMonomorphicCaller(inputs.length);
            for (let i = 0; i < 1e4; ++i) {
                const r = caller(wrapped, inputs);
                if (!Object.is(r, expected))
                    throw new Error("hot round trip " + $vm.ffiSignatureString(signature) + " iteration " + i + " got " + describe(r));
            }
        }
    }

    // ---- Property surface; un-close()d callbacks are engine-rooted, so they SURVIVE gc()/fullGC()
    // (the destructor runs only after close()); the collection here checks a rooted callback
    // stays fully functional across a full GC.
    {
        const cb = callback(["i32"], "i32", x => x);
        check(typeof cb.ptr, "number", "callback .ptr is a number");
        const descriptor = Object.getOwnPropertyDescriptor(cb, "ptr");
        check(descriptor !== undefined, true, "ptr is an own property");
        check(descriptor.writable === true, false, "ptr is read-only");
        check(descriptor.enumerable, false, "ptr is don't-enum");
        check(descriptor.configurable, false, "ptr is don't-delete");
        const threadsafeDescriptor = Object.getOwnPropertyDescriptor(cb, "threadsafe");
        check(threadsafeDescriptor !== undefined, true, "threadsafe is an own property");
        check(cb.threadsafe, false, "threadsafe is false");
        check(Object.keys(cb).length, 0, "own properties are non-enumerable");
        for (let i = 0; i < 200; ++i)
            callback(["i32"], "i32", x => x + i);
        gc();
        fullGC();
        // The surviving callback still works after a full collection.
        check(callCbI32(cb, 41), 41, "callback survives GC");
    }

    // ---- The single close() rule (SPEC section 9.1) as seen from JS: `ptr`
    // becomes null, close() is idempotent, the entry code stays alive with
    // the cell (a pointer captured before close() keeps working), and the
    // $vm glue rejects the closed object wherever it takes a pointer.
    {
        const closed = callback(["i32"], "i32", x => x + 100);
        const entryBefore = closed.ptr;
        check(typeof entryBefore, "number", "ptr before close");
        check(callCbI32(entryBefore, 5), 105, "call through the raw entry pointer before close");
        check(typeof closed.close, "function", "close is callable from JS");
        check(closed.close(), undefined, "close() returns undefined");
        check(closed.ptr, null, "ptr is null after close");
        check(closed.close(), undefined, "close() is idempotent");
        check(closed.ptr, null, "ptr stays null after a second close");
        const descriptor = Object.getOwnPropertyDescriptor(closed, "ptr");
        check(descriptor.value, null, "closed ptr descriptor value");
        check(descriptor.enumerable, false, "closed ptr stays don't-enum");
        // Nothing native-side was dropped: the code lives with the cell, so
        // the entry pointer obtained earlier is still a valid callback.
        check(callCbI32(entryBefore, 6), 106, "entry code alive after close");
        gc();
        check(callCbI32(entryBefore, 7), 107, "entry code alive after close and GC");
        // The $vm glue rejects a closed callback wherever it converts it to
        // a pointer (target of ffiFunction, ffiCString, ffiRead).
        for (const [label, use] of [
            ["ffiFunction target", () => $vm.ffiFunction({ args: ["i32"], returns: "i32" }, closed, "closed target")],
            ["ffiCString", () => $vm.ffiCString(closed)],
            ["ffiRead", () => $vm.ffiRead(closed, "u8")],
        ]) {
            checkThrows(use, e => {
                if (!(e instanceof TypeError))
                    throw new Error(label + " with a closed callback: expected a TypeError, got " + e);
                if (String(e.message).indexOf("closed") === -1)
                    throw new Error(label + " with a closed callback: unexpected message: " + e.message);
            }, label + " must reject a closed callback");
        }
    }
}

if ($vm.useJIT())
    main();
