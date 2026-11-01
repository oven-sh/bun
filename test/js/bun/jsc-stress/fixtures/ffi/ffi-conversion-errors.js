//@ requireOptions("--useDollarVM=1")

// Argument-conversion failures must be TypeErrors, identical whether they
// come from the C++ host path, the IC stub's slow path or the DFG/FTL
// operationFFIWriteSlot slow path (SPEC section 11.4). This file captures
// each error message cold, then re-triggers the same failure from a hot
// (tiered-up) call site and requires the identical constructor and message.
// ffi-conversion-errors-host.js runs the same battery with the IC stub and
// CallFFI disabled.

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (typeof value === "symbol")
        return value.toString();
    if (typeof value === "function")
        return "function";
    if (Object.is(value, -0))
        return "-0";
    try {
        return String(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
}

// Returns a NEW caller function every time (a distinct FunctionExecutable /
// CodeBlock via `new Function`), so the FFI call site inside it is
// monomorphic, exact-arity and non-spread -- the only call-site shape the DFG
// Call -> CallFFI conversion accepts (SPEC section 10.2). Each case below
// warms through its own caller so the bad value reaches the SAME optimized
// call site (typed check or operationFFIWriteSlot slow path) instead of a
// polymorphic shared site the DFG never converts.
function makeMonomorphicCaller(arity) {
    const argumentList = Array.from({ length: arity }, (_, i) => "args[" + i + "]").join(", ");
    return new Function("callable", "args", "return callable(" + argumentList + ");");
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (fixtureName, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(fixtureName), fixtureName + "(" + args.join(",") + ")");

    const detachedView = (() => {
        const buffer = new ArrayBuffer(8);
        const view = new Uint8Array(buffer);
        if (typeof transferArrayBuffer === "function")
            transferArrayBuffer(buffer);
        else
            buffer.transfer();
        return view;
    })();
    const symbol = Symbol("bad");
    const plainObject = { valueOf() { return 42; }, toString() { return "42"; } };
    const array = [1, 2, 3];
    const jsFunction = function () { return 7; };
    const proxy = new Proxy({}, {});

    // [callable, valid argument for warm-up, bad argument, label]
    const echoI32 = bind("ffi_echo_i32", ["i32"], "i32");
    const echoU8 = bind("ffi_echo_u8", ["u8"], "u8");
    const echoI16 = bind("ffi_echo_i16", ["i16"], "i16");
    const echoBool = bind("ffi_echo_bool", ["bool"], "bool");
    const echoF64 = bind("ffi_echo_f64", ["f64"], "f64");
    const echoF32 = bind("ffi_echo_f32", ["f32"], "f32");
    const echoI64 = bind("ffi_echo_i64", ["i64"], "i64");
    const echoU64 = bind("ffi_echo_u64", ["u64"], "u64");
    const echoI64Fast = bind("ffi_echo_i64", ["i64_fast"], "i64_fast");
    const echoPtr = bind("ffi_echo_ptr", ["ptr"], "ptr");
    const echoCString = bind("ffi_echo_cstring", ["cstring"], "cstring");
    const bufferArg = bind("ffi_ptr_identity", ["buffer"], "ptr");
    const functionArg = bind("ffi_ptr_identity", ["function"], "ptr");
    const validCallback = $vm.ffiCallback({ args: [], returns: "void" }, () => { });
    const validView = new Uint8Array(16);

    const cases = [
        [echoI32, 1, symbol, "Symbol -> i32"],
        [echoI32, 1, "42", "string -> i32 (strings never coerce into numeric params)"],
        [echoU8, 1, "255", "string -> u8"],
        [echoF64, 1.5, "1.5", "string -> f64"],
        [echoF32, 1.5, "1.5", "string -> f32"],
        [echoU8, 1, symbol, "Symbol -> u8"],
        [echoF64, 1.5, symbol, "Symbol -> f64"],
        [echoF32, 1.5, symbol, "Symbol -> f32"],
        [echoI64, 1, symbol, "Symbol -> i64"],
        [echoI64, 1, plainObject, "object -> i64"],
        [echoI64, 1, "5", "string -> i64"],
        [echoI64, 1, undefined, "undefined -> i64"],
        [echoI64, 1, null, "null -> i64"],
        [echoI64, 1, true, "boolean -> i64"],
        [echoU64, 1, "5", "string -> u64"],
        [echoU64, 1, undefined, "undefined -> u64"],
        [echoU64, 1, plainObject, "object -> u64"],
        [echoI64Fast, 1, symbol, "Symbol -> i64_fast"],
        [echoI64Fast, 1, "5", "string -> i64_fast"],
        [echoPtr, validView, symbol, "Symbol -> ptr"],
        [echoPtr, validView, plainObject, "object -> ptr"],
        [echoPtr, validView, "hello", "JS string -> ptr (only cstring transcodes)"],
        [echoPtr, validView, array, "array -> ptr"],
        [echoPtr, validView, jsFunction, "JS function -> ptr"],
        [echoPtr, validView, proxy, "proxy -> ptr"],
        // (BigInt -> ptr / cstring is ACCEPTED as an exact 64-bit address --
        // oven-sh/bun#22751, #28068 -- and is covered by ffi-pointers-and-buffers.js.)
        [echoPtr, validView, true, "boolean -> ptr"],
        [echoCString, validView, symbol, "Symbol -> cstring"],
        [echoCString, validView, plainObject, "object -> cstring"],
        [echoCString, validView, true, "boolean -> cstring"],
        [bufferArg, validView, 5, "number -> buffer (buffer requires a view)"],
        [bufferArg, validView, null, "null -> buffer"],
        [bufferArg, validView, undefined, "undefined -> buffer"],
        [bufferArg, validView, plainObject, "object -> buffer"],
        [bufferArg, validView, "abc", "string -> buffer"],
        [bufferArg, validView, new ArrayBuffer(8), "ArrayBuffer -> buffer (not a view)"],
        [bufferArg, validView, symbol, "Symbol -> buffer"],
        [functionArg, validCallback, "cb", "JS string -> function"],
        [functionArg, validCallback, plainObject, "object -> function"],
        [functionArg, validCallback, jsFunction, "raw JS function -> function (must be a JSFFICallback)"],
        [functionArg, validCallback, symbol, "Symbol -> function"],
        [functionArg, validCallback, true, "boolean -> function"],
    ];

    // ---- The loose-coercion contract (bun parity): [callable, input, expected, label].
    // These MUST NOT throw; they pin the exact coerced value the callee receives.
    function checkCoercion(actual, expected, label) {
        if (Number.isNaN(expected) ? !Number.isNaN(actual) : !Object.is(actual, expected))
            throw new Error("coercion " + label + ": expected " + describe(expected) + " but got " + describe(actual));
    }
    const coercions = [
        [echoI32, plainObject, 42, "object.valueOf -> i32"],
        [echoI32, array, 0, "array -> i32 (Number([1,2,3]) = NaN -> 0)"],
        [echoI32, 10n, 10, "BigInt -> i32"],
        [echoI32, true, 1, "true -> i32"],
        [echoI32, null, 0, "null -> i32"],
        [echoI32, undefined, 0, "undefined -> i32"],
        [echoI32, 4294902015, -65281, "u32 pattern into i32 wraps (bun#7007 class)"],
        [echoU8, 300, 44, "u8 wraps mod 256 (300 -> 44), never clamps"],
        [echoU8, -1, 255, "u8 wraps negative (-1 -> 255)"],
        [echoI16, jsFunction, 0, "function -> i16 (Number(fn) = NaN -> 0)"],
        [echoBool, plainObject, true, "object -> bool"],
        [echoBool, 1n, true, "BigInt 1n -> bool"],
        [echoF64, plainObject, 42, "object.valueOf -> f64"],
        [echoF64, true, 1, "true -> f64"],
        [echoF64, null, 0, "null -> f64"],
        [echoF64, undefined, NaN, "undefined -> f64 (Number(undefined) = NaN)"],
        [echoF64, 2n, 2, "BigInt -> f64 (Number(5n)-style)"],
        [echoF32, undefined, NaN, "undefined -> f32"],
        [echoF32, null, 0, "null -> f32"],
        [echoI64, 5, 5n, "number -> i64"],
        [echoI64, 5n, 5n, "BigInt -> i64"],
    ];
    for (const [callable, input, expected, label] of coercions) {
        let actual;
        try {
            actual = callable(input);
        } catch (e) {
            throw new Error("coercion " + label + ": threw " + e);
        }
        checkCoercion(actual, expected, "cold " + label);
    }
    // ...and after tier-up the SAME coercions produce the SAME values.
    for (const [callable, input, expected, label] of coercions) {
        const caller = makeMonomorphicCaller(1);
        for (let i = 0; i < 5000; ++i)
            caller(callable, [input]);
        checkCoercion(caller(callable, [input]), expected, "hot " + label);
    }

    const coldMessages = new Map();
    for (const [callable, good, bad, label] of cases) {
        // Sanity: the valid argument works.
        callable(good);
        let error = null;
        try {
            callable(bad);
        } catch (e) {
            error = e;
        }
        if (error === null)
            throw new Error("cold: " + label + ": " + describe(bad) + " did not throw");
        if (!(error instanceof TypeError))
            throw new Error("cold: " + label + ": expected a TypeError, got " + error);
        if (typeof error.message !== "string" || !error.message.length)
            throw new Error("cold: " + label + ": TypeError has no message");
        coldMessages.set(label, error.message);
        // The function must remain usable.
        callable(good);
    }

    // Warm every callable with valid arguments through its own monomorphic
    // caller so that caller tiers up with a converted CallFFI site, then
    // re-trigger the same error through the SAME (optimized) call site and
    // demand the identical message.
    for (const [callable, good, bad, label] of cases) {
        const caller = makeMonomorphicCaller(1);
        const goodArgs = [good];
        const badArgs = [bad];
        for (let i = 0; i < 3000; ++i)
            caller(callable, goodArgs);
        for (let i = 0; i < 150; ++i) {
            let error = null;
            try {
                caller(callable, badArgs);
            } catch (e) {
                error = e;
            }
            if (error === null)
                throw new Error("hot: " + label + " iteration " + i + " did not throw");
            if (!(error instanceof TypeError))
                throw new Error("hot: " + label + " iteration " + i + ": expected a TypeError, got " + error);
            if (error.message !== coldMessages.get(label))
                throw new Error("hot: " + label + " iteration " + i + ": message \"" + error.message + "\" != cold \"" + coldMessages.get(label) + "\"");
            // Interleave valid calls so the site stays optimized.
            caller(callable, goodArgs);
        }
    }

    // A single hot function that alternates good and bad values (the same
    // compiled CallFFI site takes both the fast and the throwing slow path).
    function guarded(value) {
        try {
            return { ok: true, value: echoI32(value) };
        } catch (e) {
            return { ok: false, error: e };
        }
    }
    noInline(guarded);
    for (let i = 0; i < 8000; ++i) {
        const result = guarded(i);
        if (!result.ok || result.value !== (i | 0))
            throw new Error("guarded warm iteration " + i);
    }
    for (let i = 0; i < 3000; ++i) {
        const bad = (i % 5) === 4;
        const result = guarded(bad ? symbol : i);
        if (bad) {
            if (result.ok)
                throw new Error("guarded(Symbol) did not throw at iteration " + i);
            if (!(result.error instanceof TypeError))
                throw new Error("guarded(Symbol) wrong error at iteration " + i + ": " + result.error);
            if (result.error.message !== coldMessages.get("Symbol -> i32"))
                throw new Error("guarded(Symbol) message differs from the cold message at iteration " + i);
        } else if (!result.ok || result.value !== (i | 0))
            throw new Error("guarded good iteration " + i);
    }

    // FFI-SPEC-GAP: SPEC section 11.4 lists "detached buffer as ptr" among
    // the TypeError cases, but the normative conversion table (section 5)
    // says "vector() (0 if detached)". The normative rule wins here: detached
    // views convert to a null pointer in every tier, without throwing.
    for (let i = 0; i < 3; ++i) {
        if (echoPtr(detachedView) !== null)
            throw new Error("detached view as ptr should yield null (iteration " + i + ")");
        if (bufferArg(detachedView) !== null)
            throw new Error("detached view as buffer should yield null (iteration " + i + ")");
        if (echoCString(detachedView) !== null)
            throw new Error("detached view as cstring should yield null (iteration " + i + ")");
    }
    for (let i = 0; i < 5000; ++i) {
        if (echoPtr(i & 1 ? detachedView : validView) === undefined)
            throw new Error("unreachable");
    }
    if (echoPtr(detachedView) !== null)
        throw new Error("detached view as ptr should yield null when hot");
}

if ($vm.useJIT())
    main();
