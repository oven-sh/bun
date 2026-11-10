//@ requireOptions("--useDollarVM=1", "--useFFIICStub=0", "--useFFICallInDFG=0")

// FFI-SPEC-GAP: SPEC section 11.4 describes the host-path-vs-tiers
// differential as "a single file"; this companion file (row T also owns
// JSTests/stress/ffi-*.js) forces the host path with the option pair the
// spec names, so that path is exercised by the harness on every run.
// The C++ host-call path (SPEC section 8.2) only: no IC stub, no CallFFI.
// This is the same battery and the same HARDCODED expected table as
// ffi-tier-differential.js, so the host path is pinned to exactly the same
// answers the JIT tiers must produce (SPEC section 11.4).

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
// monomorphic, exact-arity and non-spread. Under this file's options the
// callee is always the C++ host path, but the caller shape is kept identical
// to ffi-tier-differential.js so the two differ only in the option pair.
function makeMonomorphicCaller(arity) {
    const argumentList = Array.from({ length: arity }, (_, i) => "args[" + i + "]").join(", ");
    return new Function("callable", "args", "return callable(" + argumentList + ");");
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (name, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(name), name);

    const echoChar = bind("ffi_echo_char", ["char"], "char");
    const echoI8 = bind("ffi_echo_i8", ["i8"], "i8");
    const echoU8 = bind("ffi_echo_u8", ["u8"], "u8");
    const echoI16 = bind("ffi_echo_i16", ["i16"], "i16");
    const echoU16 = bind("ffi_echo_u16", ["u16"], "u16");
    const echoI32 = bind("ffi_echo_i32", ["i32"], "i32");
    const echoU32 = bind("ffi_echo_u32", ["u32"], "u32");
    const echoI64 = bind("ffi_echo_i64", ["i64"], "i64");
    const echoU64 = bind("ffi_echo_u64", ["u64"], "u64");
    const echoI64Fast = $vm.ffiFunction({ args: ["i64_fast"], returns: "i64_fast" }, fixture("ffi_echo_i64"), "ffi_echo_i64:fast");
    const echoU64Fast = $vm.ffiFunction({ args: ["u64_fast"], returns: "u64_fast" }, fixture("ffi_echo_u64"), "ffi_echo_u64:fast");
    const echoF32 = bind("ffi_echo_f32", ["f32"], "f32");
    const echoF64 = bind("ffi_echo_f64", ["f64"], "f64");
    const echoBool = bind("ffi_echo_bool", ["bool"], "bool");
    const echoPtr = bind("ffi_echo_ptr", ["ptr"], "ptr");
    const echoNapiValue = bind("ffi_echo_jsvalue", ["napi_value"], "napi_value");
    const addI32 = bind("ffi_add_i32", ["i32", "i32"], "i32");
    const addF64 = bind("ffi_add_f64", ["f64", "f64"], "f64");
    const addI64 = bind("ffi_add_i64", ["i64", "i64"], "i64");
    const addU64 = bind("ffi_add_u64", ["u64", "u64"], "u64");
    const addF32 = bind("ffi_add_f32", ["f32", "f32"], "f32");
    const sumI32_9 = bind("ffi_sum_i32_9", ["i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32"], "i64");
    const sumF64_9 = bind("ffi_sum_f64_9", ["f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64"], "f64");
    const sumU8_12 = bind("ffi_sum_u8_12", ["u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8", "u8"], "i64");
    const sumI16_10 = bind("ffi_sum_i16_10", ["i16", "i16", "i16", "i16", "i16", "i16", "i16", "i16", "i16", "i16"], "i64");
    const mix1 = bind("ffi_mix_1", ["i32", "f64", "i64", "f32", "ptr", "u8", "f64", "i16", "f64", "i32"], "f64");
    const mix6 = bind("ffi_mix_6", ["bool", "bool", "i32", "bool", "f64", "bool", "f32", "bool", "bool", "bool", "bool", "bool", "bool"], "f64");
    const widenChar = bind("ffi_widen_char", ["char"], "i64_fast");
    const widenU16 = bind("ffi_widen_u16", ["u16"], "i64_fast");
    const twoAsBool = bind("ffi_ret_two_as_bool", [], "bool");
    const retNullPtr = bind("ffi_ret_null_ptr", [], "ptr");
    const highPtr = bind("ffi_high_ptr", [], "ptr");
    const retNegOneI8 = bind("ffi_ret_neg_one_i8", [], "i8");
    const retNegOneU32 = bind("ffi_ret_neg_one_u32", [], "u32");
    const retNegOneU64 = bind("ffi_ret_neg_one_u64", [], "u64");
    const retDenormalF32 = bind("ffi_ret_denormal_f32", [], "f32");
    const retNegZeroF64 = bind("ffi_ret_neg_zero_f64", [], "f64");
    const retInfF64 = bind("ffi_ret_inf_f64", [], "f64");

    const sharedObject = { shared: true };

    // Each row: [callable, [arguments...], expectedLiteral, label]
    // Every expected value below is a literal, not a computed reference.
    const battery = [
        [echoChar, [-1], -1, "char(-1)"],
        [echoChar, [255], -1, "char(255)"],
        [echoChar, [0x80], -128, "char(0x80)"],
        [echoI8, [127], 127, "i8(127)"],
        [echoI8, [128], -128, "i8(128)"],
        [echoI8, [0x1ff], -1, "i8(0x1ff)"],
        [echoU8, [-1], 255, "u8(-1)"],
        [echoU8, [511], 255, "u8(511)"],
        [echoU8, [256], 0, "u8(256)"],
        [echoI16, [32768], -32768, "i16(32768)"],
        [echoI16, [-32769], 32767, "i16(-32769)"],
        [echoU16, [-1], 65535, "u16(-1)"],
        [echoU16, [70000], 4464, "u16(70000)"],
        [echoI32, [2147483648], -2147483648, "i32(2^31)"],
        [echoI32, [-2147483649], 2147483647, "i32(-2^31-1)"],
        [echoI32, [4294967301], 5, "i32(2^32+5)"],
        [echoI32, [-1.9], -1, "i32(-1.9)"],
        [echoI32, [NaN], 0, "i32(NaN)"],
        [echoI32, [Infinity], 0, "i32(Infinity)"],
        [echoI32, [undefined], 0, "i32(undefined)"],
        [echoI32, [true], 1, "i32(true)"],
        [echoU32, [-1], 4294967295, "u32(-1)"],
        [echoU32, [2147483648], 2147483648, "u32(2^31)"],
        [echoU32, [4294967296], 0, "u32(2^32)"],
        [echoI64, [0], 0n, "i64(0)"],
        [echoI64, [-1], -1n, "i64(-1)"],
        [echoI64, [4294967296], 4294967296n, "i64(2^32)"],
        [echoI64, [2n ** 63n - 1n], 9223372036854775807n, "i64(2^63-1)"],
        [echoI64, [2n ** 63n], -9223372036854775808n, "i64(2^63)"],
        [echoI64, [-1.5], -1n, "i64(-1.5)"],
        [echoI64, [9007199254740992], 9007199254740992n, "i64(2^53 as number)"],
        [echoU64, [-1], 18446744073709551615n, "u64(-1)"],
        [echoU64, [-2147483648], 18446744071562067968n, "u64(-2^31)"],
        [echoU64, [2n ** 64n + 3n], 3n, "u64(2^64+3)"],
        [echoI64Fast, [9007199254740991], 9007199254740991, "i64_fast(2^53-1)"],
        [echoI64Fast, [-9007199254740991], -9007199254740991, "i64_fast(-(2^53-1))"],
        [echoI64Fast, [2n ** 53n], 9007199254740992n, "i64_fast(2^53)"],
        [echoI64Fast, [-(2n ** 53n)], -9007199254740992n, "i64_fast(-2^53)"],
        [echoI64Fast, [-1], -1, "i64_fast(-1)"],
        [echoU64Fast, [9007199254740990], 9007199254740990, "u64_fast(2^53-2)"],
        [echoU64Fast, [2n ** 53n - 1n], 9007199254740991n, "u64_fast(2^53-1)"],
        [echoU64Fast, [-1], 18446744073709551615n, "u64_fast(-1)"],
        [echoF32, [1.1], 1.100000023841858, "f32(1.1)"],
        [echoF32, [-0], -0, "f32(-0)"],
        [echoF32, [NaN], NaN, "f32(NaN)"],
        [echoF32, [1e39], Infinity, "f32(1e39)"],
        [echoF32, [16777217], 16777216, "f32(2^24+1)"],
        [echoF64, [-0], -0, "f64(-0)"],
        [echoF64, [NaN], NaN, "f64(NaN)"],
        [echoF64, [Number.MIN_VALUE], 5e-324, "f64(min denormal)"],
        [echoF64, [undefined], NaN, "f64(undefined) -> NaN"],
        [echoBool, [2], true, "bool(2)"],
        [echoBool, [-1], true, "bool(-1)"],
        [echoBool, [0], false, "bool(0)"],
        [echoBool, [0.5], true, "bool(0.5)"],
        [echoBool, [-0], false, "bool(-0)"],
        [echoBool, [NaN], false, "bool(NaN)"],
        [echoBool, [256], true, "bool(256)"],
        [echoBool, [null], false, "bool(null)"],
        [echoPtr, [0], null, "ptr(0)"],
        [echoPtr, [null], null, "ptr(null)"],
        [echoPtr, [undefined], null, "ptr(undefined)"],
        [echoPtr, [-1], 18446744073709551615n, "ptr(-1) (exact BigInt, > 2^53)"],
        [echoPtr, [1099511627776], 1099511627776, "ptr(2^40)"],
        [echoNapiValue, [sharedObject], sharedObject, "napi_value(object)"],
        [echoNapiValue, ["x"], "x", "napi_value(string)"],
        [echoNapiValue, [-0], -0, "napi_value(-0)"],
        [addI32, [2147483647, 1], -2147483648, "add_i32 overflow"],
        [addI32, [-2147483648, -1], 2147483647, "add_i32 underflow"],
        [addI32, [7], 7, "add_i32 missing argument"],
        [addI32, [7, 8, 9], 15, "add_i32 extra argument"],
        [addF64, [0.1, 0.2], 0.30000000000000004, "add_f64(0.1, 0.2)"],
        [addF64, [-0, -0], -0, "add_f64(-0, -0)"],
        [addF64, [Infinity, -Infinity], NaN, "add_f64(inf, -inf)"],
        [addI64, [2n ** 63n - 1n, 1n], -9223372036854775808n, "add_i64 wrap"],
        [addI64, [-1, -1], -2n, "add_i64(-1,-1)"],
        [addU64, [-1, 2], 1n, "add_u64 wrap"],
        [addU64, [2n ** 32n, 2n ** 32n], 8589934592n, "add_u64(2^32,2^32)"],
        [addF32, [16777216, 1], 16777216, "add_f32 precision loss"],
        [addF32, [0.5, 0.25], 0.75, "add_f32 dyadics"],
        [addF32, [3.4e38, 3.4e38], Infinity, "add_f32 overflow to +inf"],
        [sumI32_9, [1, -2, 3, -4, 5, -6, 7, -8, 100000], 99996n, "sum_i32_9"],
        [sumI32_9, [2147483647, 2147483647, 2147483647, 2147483647, 2147483647, 2147483647, 2147483647, 2147483647, 2147483647], 19327352823n, "sum_i32_9 max"],
        [sumF64_9, [1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125, 0.00390625], 1.99609375, "sum_f64_9 dyadics"],
        [sumU8_12, [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255], 3060n, "sum_u8_12 max"],
        [sumU8_12, [1, 2, 4, 8, 16, 32, 64, 128, -1, 256, 257, 511], 766n, "sum_u8_12 wrapped powers"],
        [sumI16_10, [-32768, -32768, 32767, 32767, -1, 1, 40000, -40000, 65535, 65536], -3n, "sum_i16_10 edges"],
        [mix1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 385, "mix_1 identity ramp"],
        [mix1, [-2147483648, -0.5, -1000000, -1.5, 4096, 255, 0, -32768, 2, 2147483647], 19324112699, "mix_1 edges"],
        [mix6, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 91, "mix_6 all ones"],
        [mix6, [2, 0, -3, -1, -0.25, NaN, 0.5, 256, true, false, null, undefined, true], 28.25, "mix_6 truthiness edges"],
        [widenChar, [-1], -1, "widen_char(-1)"],
        [widenChar, [200], -56, "widen_char(200)"],
        [widenU16, [-1], 65535, "widen_u16(-1)"],
        [twoAsBool, [], true, "ret_two_as_bool"],
        [retNullPtr, [], null, "ret_null_ptr"],
        [highPtr, [], 0x00007fffdeadbee0, "high_ptr"],
        [retNegOneI8, [], -1, "ret_neg_one_i8"],
        [retNegOneU32, [], 4294967295, "ret_neg_one_u32"],
        [retNegOneU64, [], 18446744073709551615n, "ret_neg_one_u64"],
        [retDenormalF32, [], 2 ** -149, "ret_denormal_f32"],
        [retNegZeroF64, [], -0, "ret_neg_zero_f64"],
        [retInfF64, [], Infinity, "ret_inf_f64"],
    ];

    function runBattery(phase) {
        for (const [callable, args, expected, label] of battery) {
            const actual = callable(...args);
            if (!Object.is(actual, expected))
                throw new Error(phase + " " + label + ": expected " + describe(expected) + " but got " + describe(actual));
        }
    }

    // Cold pass (whatever tier the harness starts in).
    runBattery("cold");
    // Warm each row through its OWN exact-arity, non-spread, single-callee
    // caller (same shape as ffi-tier-differential.js), then re-run the whole
    // battery.
    for (const [callable, args, expected, label] of battery) {
        const caller = makeMonomorphicCaller(args.length);
        for (let i = 0; i < 4000; ++i) {
            const actual = caller(callable, args);
            if (!Object.is(actual, expected))
                throw new Error("warm " + label + " iteration " + i + ": expected " + describe(expected) + " but got " + describe(actual));
        }
    }
    runBattery("hot");
    // A few thousand mixed iterations across every row (megamorphic-ish).
    for (let i = 0; i < 6000; ++i) {
        const [callable, args, expected, label] = battery[i % battery.length];
        const actual = callable(...args);
        if (!Object.is(actual, expected))
            throw new Error("mixed " + label + " iteration " + i + ": expected " + describe(expected) + " but got " + describe(actual));
    }
}

if ($vm.useJIT())
    main();
