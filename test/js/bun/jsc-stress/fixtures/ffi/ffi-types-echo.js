//@ requireOptions("--useDollarVM=1")

// Every FFI type through its ffi_echo_* fixture with edge values, cold and
// in a loop hot enough to reach the optimizing tiers; results must be
// identical across tiers (SPEC sections 5 and 11.4).

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (typeof value === "symbol")
        return value.toString();
    if (Object.is(value, -0))
        return "-0";
    return String(value);
}

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + describe(expected) + " but got " + describe(actual));
}

// Returns a NEW caller function every time (a distinct FunctionExecutable /
// CodeBlock via `new Function`), so the FFI call site inside it is
// monomorphic, exact-arity and non-spread -- the only call-site shape the DFG
// ByteCodeParser constant-callee feed and the strength-reduction
// Call -> CallFFI conversion accept (SPEC section 10.2). Warming the FFI
// functions through one shared `fn(x)` site in a table loop would leave that
// site polymorphic, and the typed CallFFI path would never be compiled.
function makeMonomorphicCaller(arity) {
    const argumentList = Array.from({ length: arity }, (_, i) => "args[" + i + "]").join(", ");
    return new Function("callable", "args", "return callable(" + argumentList + ");");
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const echo = (fixtureName, type, name) => $vm.ffiFunction({ args: [type], returns: type }, fixture(fixtureName), name || (fixtureName + ":" + type));

    const echoChar = echo("ffi_echo_char", "char");
    const echoI8 = echo("ffi_echo_i8", "i8");
    const echoU8 = echo("ffi_echo_u8", "u8");
    const echoI16 = echo("ffi_echo_i16", "i16");
    const echoU16 = echo("ffi_echo_u16", "u16");
    const echoI32 = echo("ffi_echo_i32", "i32");
    const echoU32 = echo("ffi_echo_u32", "u32");
    const echoI64 = echo("ffi_echo_i64", "i64");
    const echoU64 = echo("ffi_echo_u64", "u64");
    const echoI64Fast = echo("ffi_echo_i64", "i64_fast", "ffi_echo_i64:i64_fast");
    const echoU64Fast = echo("ffi_echo_u64", "u64_fast", "ffi_echo_u64:u64_fast");
    const echoF32 = echo("ffi_echo_f32", "f32");
    const echoF64 = echo("ffi_echo_f64", "f64");
    const echoBool = echo("ffi_echo_bool", "bool");
    const echoPtr = echo("ffi_echo_ptr", "ptr");
    const echoCString = echo("ffi_echo_cstring", "cstring");
    const echoNapiValue = echo("ffi_echo_jsvalue", "napi_value");

    const object = { tag: "object" };
    const symbol = Symbol("napi");

    const batteries = [
        [echoChar, "char", [
            [0, 0], [1, 1], [-1, -1], [127, 127], [-128, -128], [128, -128], [255, -1], [0x1ff, -1],
            [-129, 127], [200, -56], [true, 1], [false, 0], [undefined, 0], [null, 0], [1.9, 1], [-1.9, -1],
        ]],
        [echoI8, "i8", [
            [0, 0], [127, 127], [-128, -128], [128, -128], [255, -1], [256, 0], [-129, 127], [0.9, 0],
            [true, 1], [undefined, 0], [null, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
        ]],
        [echoU8, "u8", [
            [0, 0], [255, 255], [256, 0], [-1, 255], [511, 255], [-129, 127], [300.7, 44], [128, 128],
            [true, 1], [false, 0], [undefined, 0], [null, 0], [NaN, 0], [-0, 0],
        ]],
        [echoI16, "i16", [
            [0, 0], [32767, 32767], [32768, -32768], [-32769, 32767], [-1, -1], [65535, -1], [0x12345, 0x2345],
            [-32768, -32768], [65536, 0], [1.5, 1], [undefined, 0], [true, 1],
        ]],
        [echoU16, "u16", [
            [0, 0], [65535, 65535], [65536, 0], [-1, 65535], [70000, 4464], [32768, 32768], [-32768, 32768],
            [undefined, 0], [null, 0], [NaN, 0], [true, 1],
        ]],
        [echoI32, "i32", [
            [0, 0], [1, 1], [-1, -1], [2147483647, 2147483647], [-2147483648, -2147483648],
            [2147483648, -2147483648], [-2147483649, 2147483647], [4294967301, 5], [4294967296, 0],
            [-1.5, -1], [1.9, 1], [-0.9, 0], [0.5, 0], [-0, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
            [1e10, 1410065408], [undefined, 0], [null, 0], [true, 1], [false, 0],
        ]],
        [echoU32, "u32", [
            [0, 0], [-1, 4294967295], [4294967295, 4294967295], [4294967296, 0], [2147483648, 2147483648],
            [2147483647, 2147483647], [-0.5, 0], [1e10, 1410065408], [-2147483648, 2147483648], [undefined, 0],
            [null, 0], [true, 1], [NaN, 0],
        ]],
        [echoI64, "i64", [
            [0, 0n], [1, 1n], [-1, -1n], [2 ** 53, 9007199254740992n], [-(2 ** 53), -9007199254740992n],
            [123n, 123n], [-123n, -123n], [2n ** 63n - 1n, 9223372036854775807n], [-(2n ** 63n), -9223372036854775808n],
            [2n ** 64n + 7n, 7n], [2n ** 63n, -9223372036854775808n], [-1.5, -1n], [2.9, 2n], [-0, 0n],
            [2147483647, 2147483647n], [-2147483648, -2147483648n], [4294967296, 4294967296n],
        ]],
        [echoU64, "u64", [
            [0, 0n], [1, 1n], [-1, 18446744073709551615n], [4294967295, 4294967295n], [2n ** 64n - 1n, 18446744073709551615n],
            [2n ** 64n + 7n, 7n], [-2n, 18446744073709551614n], [2.5, 2n], [2 ** 53, 9007199254740992n],
            [-2147483648, 18446744071562067968n], [9007199254740991, 9007199254740991n],
        ]],
        [echoI64Fast, "i64_fast", [
            [0, 0], [-1, -1], [42, 42], [2 ** 53 - 1, 9007199254740991], [-(2 ** 53 - 1), -9007199254740991],
            [2n ** 53n, 9007199254740992n], [-(2n ** 53n), -9007199254740992n], [1n << 62n, 4611686018427387904n],
            [2n ** 63n - 1n, 9223372036854775807n], [-2, -2], [3.7, 3], [-3.7, -3],
        ]],
        [echoU64Fast, "u64_fast", [
            [0, 0], [123, 123], [2 ** 53 - 2, 9007199254740990], [2n ** 53n - 1n, 9007199254740991n],
            [2n ** 53n, 9007199254740992n], [-1, 18446744073709551615n], [2n ** 64n - 1n, 18446744073709551615n],
            [4.9, 4],
        ]],
        [echoF32, "f32", [
            [0, 0], [-0, -0], [1.5, 1.5], [1.1, Math.fround(1.1)], [-1.1, Math.fround(-1.1)], [NaN, NaN],
            [Infinity, Infinity], [-Infinity, -Infinity], [3.4e38, Math.fround(3.4e38)], [3.5e38, Infinity],
            [1e-45, Math.fround(1e-45)], [16777217, 16777216], [-16777217, -16777216], [2 ** -149, 2 ** -149],
        ]],
        [echoF64, "f64", [
            [0, 0], [-0, -0], [1.5, 1.5], [NaN, NaN], [Infinity, Infinity], [-Infinity, -Infinity],
            [Number.MAX_VALUE, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE], [Number.EPSILON, Number.EPSILON],
            [Math.PI, Math.PI], [-1e308, -1e308], [undefined, NaN], [123456789.123456789, 123456789.123456789],
        ]],
        [echoBool, "bool", [
            [0, false], [1, true], [2, true], [-1, true], [0.5, true], [-0, false], [NaN, false], [Infinity, true],
            [true, true], [false, false], [undefined, false], [null, false], [255, true], [256, true],
        ]],
        [echoPtr, "ptr", [
            [0, null], [null, null], [undefined, null], [4096, 4096], [1, 1], [-1, 18446744073709551615n],
            [2 ** 40, 2 ** 40], [0.9, null], [-0, null], [65536.7, 65536],
        ]],
        [echoCString, "cstring", [
            [0, null], [null, null], [undefined, null],
            ["hello", "hello"], ["", ""], ["\u00e9\u2603 utf8", "\u00e9\u2603 utf8"],
        ]],
        [echoNapiValue, "napi_value", [
            [0, 0], [42, 42], [-0, -0], [NaN, NaN], [1.5, 1.5], [undefined, undefined], [null, null], [true, true],
            [false, false], ["string", "string"], [object, object], [symbol, symbol], [9007199254740993n, 9007199254740993n],
        ]],
    ];

    // Cold: every case exactly once, warm-up free.
    for (const [fn, label, cases] of batteries) {
        for (const [input, expected] of cases)
            check(fn(input), expected, label + " cold echo(" + describe(input) + ")");
    }

    // Hot: enough iterations to tier the per-battery caller through baseline
    // into DFG/FTL, where the exact-arity monomorphic call site becomes a
    // typed CallFFI node (ffi-callffi-was-compiled.js machine-checks that
    // conversion via $vm.ffiCompileCounts()).
    for (const [fn, label, cases] of batteries) {
        // (a) Monomorphic input through a dedicated single-callee caller: the
        //     typed CallFFI fast path is what the loop settles on.
        const monoCaller = makeMonomorphicCaller(1);
        const [monoInput, monoExpected] = cases[1];
        const monoArgs = [monoInput];
        for (let i = 0; i < 4e4; ++i) {
            const result = monoCaller(fn, monoArgs);
            if (!Object.is(result, monoExpected))
                throw new Error(label + " hot mono iteration " + i + ": expected " + describe(monoExpected) + " but got " + describe(result));
        }
        // (b) Mixed inputs cycling through every edge case at another dedicated
        //     single-callee site (forces exits, slow paths and re-optimization).
        const mixedCaller = makeMonomorphicCaller(1);
        const inputs = cases.map(c => [c[0]]);
        for (let i = 0; i < 1.5e4; ++i) {
            const k = i % cases.length;
            const result = mixedCaller(fn, inputs[k]);
            if (!Object.is(result, cases[k][1]))
                throw new Error(label + " hot mixed iteration " + i + " echo(" + describe(cases[k][0]) + "): expected " + describe(cases[k][1]) + " but got " + describe(result));
        }
    }

    // char signedness lock across a dedicated widening fixture.
    const widenChar = $vm.ffiFunction({ args: ["char"], returns: "i64_fast" }, fixture("ffi_widen_char"), "ffi_widen_char");
    check(widenChar(-1), -1, "ffi_widen_char(-1)");
    check(widenChar(255), -1, "ffi_widen_char(255)");
    check(widenChar(128), -128, "ffi_widen_char(128)");
    check(widenChar(127), 127, "ffi_widen_char(127)");
    for (let i = 0; i < 2e4; ++i) {
        if (widenChar(-1) !== -1)
            throw new Error("ffi_widen_char(-1) !== -1 in hot loop");
    }

    // typeof edges of the fast 64-bit variants.
    check(typeof echoI64Fast(2 ** 53 - 2), "number", "i64_fast typeof at 2^53-2");
    check(typeof echoI64Fast(2 ** 53 - 1), "number", "i64_fast typeof at 2^53-1");
    check(typeof echoI64Fast(2n ** 53n), "bigint", "i64_fast typeof at 2^53");
    check(typeof echoI64Fast(-(2 ** 53 - 1)), "number", "i64_fast typeof at -(2^53-1)");
    check(typeof echoI64Fast(-(2n ** 53n)), "bigint", "i64_fast typeof at -2^53");
    check(typeof echoU64Fast(2 ** 53 - 2), "number", "u64_fast typeof at 2^53-2");
    check(typeof echoU64Fast(2n ** 53n - 1n), "bigint", "u64_fast typeof at 2^53-1 (strict < quirk)");
    check(typeof echoU64Fast(2n ** 53n), "bigint", "u64_fast typeof at 2^53");
    check(typeof echoI64(0), "bigint", "i64 is always a BigInt");
    check(typeof echoU64(0), "bigint", "u64 is always a BigInt");

    // Debug builds must not assert on NaN through f32/f64 (purifyNaN).
    for (let i = 0; i < 1e4; ++i) {
        if (!Number.isNaN(echoF32(NaN)))
            throw new Error("echo f32 NaN not NaN");
        if (!Number.isNaN(echoF64(NaN)))
            throw new Error("echo f64 NaN not NaN");
    }
}

// FFI-SPEC-GAP: the stress harness also runs every file under --useJIT=false
// (lockdown/no-jit configs), where bun:ffi creation throws by design (SPEC
// section 0.1). Every ffi-*.js file therefore gates its body on $vm.useJIT();
// ffi-no-jit.js covers the no-JIT behavior explicitly.
if ($vm.useJIT())
    main();
