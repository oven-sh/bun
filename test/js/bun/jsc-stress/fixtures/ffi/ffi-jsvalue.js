//@ requireOptions("--useDollarVM=1")

// The "jsvalue" type is a raw EncodedJSValue pass-through in both directions: every JS value
// kind (objects, functions, symbols, -0, BigInt) must round-trip with identity intact.

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (typeof value === "symbol")
        return value.toString();
    if (Object.is(value, -0))
        return "-0";
    if (value !== null && (typeof value === "object" || typeof value === "function")) {
        // Object.create(null), Proxy, etc. may have no toString/valueOf, so
        // String(value) would throw "No default value" while merely
        // formatting a message; describe by structure instead.
        const tag = Object.prototype.toString.call(value);
        return typeof value === "function" ? "[function " + (value.name || "anonymous") + "]" : tag;
    }
    return String(value);
}

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + describe(expected) + " but got " + describe(actual));
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const echoNapiValue = $vm.ffiFunction({ args: ["jsvalue"], returns: "jsvalue" }, fixture("ffi_echo_jsvalue"), "ffi_echo_jsvalue");

    // ---- napi_value: identity of arbitrary JSValues in both directions.
    const object = { deep: { array: [1, 2, 3] } };
    const array = [1, "two", 3n];
    const fn = function named() { return 1; };
    const symbol = Symbol("napi");
    const registrySymbol = Symbol.for("napi.registry");
    const bigint = 123456789012345678901234567890n;
    const values = [
        object, array, fn, symbol, registrySymbol, bigint, 0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity,
        2147483647, -2147483648, 2147483648, 4294967295, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE,
        true, false, null, undefined, "", "string", "\u{1F600}", 0n, -1n,
        new Uint8Array(3), new ArrayBuffer(2), Object.freeze({}), Object.create(null),
        echoNapiValue, // a JSFFIFunction itself
        $vm.ffiCallback({ args: [], returns: "void" }, () => { }), // a JSFFICallback
        new Proxy({}, {}), new Error("as a value"), Promise.resolve(1), new Map(), new WeakRef(object),
    ];
    for (const value of values) {
        const result = echoNapiValue(value);
        check(result, value, "napi_value identity for " + describe(value));
        if ((typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol") {
            if (result !== value)
                throw new Error("napi_value must preserve object identity (===), got a different object for " + describe(value));
        }
    }
    // Missing napi_value argument: undefined bits pass through.
    check(echoNapiValue(), undefined, "missing napi_value argument is undefined");
    // Hot identity through the tiers with a few classes of values.
    for (let i = 0; i < 3e4; ++i) {
        const value = values[i % values.length];
        const result = echoNapiValue(value);
        if (!Object.is(result, value))
            throw new Error("hot napi_value identity iteration " + i + " for " + describe(value) + " got " + describe(result));
    }
    // Values created inside the loop (young objects): identity, and no GC crash.
    for (let i = 0; i < 5000; ++i) {
        const young = { i, payload: new Array(8).fill(i) };
        if (echoNapiValue(young) !== young)
            throw new Error("young object identity iteration " + i);
        if ((i & 1023) === 0)
            gc();
    }
    // napi_value inside a callback: JS -> native -> JS receives the very same values.
    const seen = [];
    const cb = $vm.ffiCallback({ args: ["jsvalue"], returns: "jsvalue" }, v => { seen.push(v); return v; });
    const throughCallback = $vm.ffiFunction({ args: ["jsvalue"], returns: "jsvalue" }, cb, "napi_value round trip");
    for (const value of values) {
        seen.length = 0;
        const result = throughCallback(value);
        check(result, value, "callback napi_value round trip for " + describe(value));
        check(seen.length, 1, "callback invoked once");
        check(seen[0], value, "callback saw the identical value");
    }
}

if ($vm.useJIT())
    main();
