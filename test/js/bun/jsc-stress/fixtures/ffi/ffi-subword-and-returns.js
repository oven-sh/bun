//@ requireOptions("--useDollarVM=1")

// Sub-word extension probes (caller side) and return-value normalization
// probes (callee side): widen fixtures, ffi_ret_neg_one_*, float edge
// returners, bool and char rules (SPEC sections 2, 4, 5, 7.2).

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (Object.is(value, -0))
        return "-0";
    return String(value);
}

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + describe(expected) + " but got " + describe(actual));
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (name, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(name), name + "->" + ret);

    // ---- Caller-side extension: the callee widens whatever low bits it got.
    const widenChar = bind("ffi_widen_char", ["char"], "i64");
    const widenI8 = bind("ffi_widen_i8", ["i8"], "i64");
    const widenU8 = bind("ffi_widen_u8", ["u8"], "i64");
    const widenI16 = bind("ffi_widen_i16", ["i16"], "i64");
    const widenU16 = bind("ffi_widen_u16", ["u16"], "i64");
    const widenCases = [
        [widenChar, "widen_char", [[0, 0n], [-1, -1n], [255, -1n], [0xff, -1n], [127, 127n], [128, -128n], [-128, -128n], [0x1ff, -1n], [0x180, -128n], [-129, 127n]]],
        [widenI8, "widen_i8", [[0, 0n], [-1, -1n], [255, -1n], [127, 127n], [128, -128n], [-128, -128n], [0x17f, 127n], [0x180, -128n], [-129, 127n], [0x7fffffff, -1n]]],
        [widenU8, "widen_u8", [[0, 0n], [-1, 255n], [255, 255n], [256, 0n], [511, 255n], [128, 128n], [-128, 128n], [0x101, 1n], [0x7fffffff, 255n]]],
        [widenI16, "widen_i16", [[0, 0n], [-1, -1n], [65535, -1n], [32767, 32767n], [32768, -32768n], [-32768, -32768n], [-32769, 32767n], [0x12345, 9029n], [65536, 0n]]],
        [widenU16, "widen_u16", [[0, 0n], [-1, 65535n], [65535, 65535n], [65536, 0n], [32768, 32768n], [-32768, 32768n], [0x18000, 32768n], [70000, 4464n]]],
    ];
    for (const [fn, name, cases] of widenCases) {
        for (const [input, expected] of cases)
            check(fn(input), expected, name + "(" + input + ")");
    }

    // ---- Callee-side return normalization: -1 through every integer width.
    const negOnes = [
        ["ffi_ret_neg_one_i8", "i8", -1],
        ["ffi_ret_neg_one_i16", "i16", -1],
        ["ffi_ret_neg_one_i32", "i32", -1],
        ["ffi_ret_neg_one_i64", "i64", -1n],
        ["ffi_ret_neg_one_u8", "u8", 255],
        ["ffi_ret_neg_one_u16", "u16", 65535],
        ["ffi_ret_neg_one_u32", "u32", 4294967295],
        ["ffi_ret_neg_one_u64", "u64", 18446744073709551615n],
        // Reinterpretations of the same all-ones bit pattern:
        ["ffi_ret_neg_one_i8", "u8", 255],
        ["ffi_ret_neg_one_u8", "i8", -1],
        ["ffi_ret_neg_one_i32", "u32", 4294967295],
        ["ffi_ret_neg_one_u32", "i32", -1],
        ["ffi_ret_neg_one_i64", "u64", 18446744073709551615n],
        ["ffi_ret_neg_one_u64", "i64", -1n],
        ["ffi_ret_neg_one_i64", "i64_fast", -1],
        ["ffi_ret_neg_one_u64", "u64_fast", 18446744073709551615n],
    ];
    for (let i = 0; i < negOnes.length; ++i) {
        const [name, type, expected] = negOnes[i];
        const fn = bind(name, [], type);
        check(fn(), expected, name + " as " + type);
        for (let iteration = 0; iteration < 5000; ++iteration) {
            const result = fn();
            if (!Object.is(result, expected))
                throw new Error(name + " as " + type + " hot iteration " + iteration + ": got " + describe(result));
        }
    }

    // ---- bool normalization: only the low byte of a native bool return is
    // defined; a callee returning 2 in an int8 register declared as bool must
    // still surface as `true`.
    const twoAsBool = bind("ffi_ret_two_as_bool", [], "bool");
    check(twoAsBool(), true, "ffi_ret_two_as_bool");
    for (let i = 0; i < 2e4; ++i) {
        if (twoAsBool() !== true)
            throw new Error("ffi_ret_two_as_bool hot iteration " + i);
    }
    const twoAsI8 = bind("ffi_ret_two_as_bool", [], "i8");
    check(twoAsI8(), 2, "ffi_ret_two_as_bool declared i8");

    const echoBool = bind("ffi_echo_bool", ["bool"], "bool");
    for (const [input, expected] of [[2, true], [-1, true], [0, false], [0.5, true], [-0, false], [NaN, false], [1e-300, true], [true, true], [false, false], [null, false], [undefined, false], [256, true], [65536, true]])
        check(echoBool(input), expected, "ffi_echo_bool(" + describe(input) + ")");
    for (let i = 0; i < 2e4; ++i) {
        // 256 has a zero low byte: `and32(0xff)` or `and32(1)` mis-conversions would return false.
        if (echoBool(256) !== true)
            throw new Error("ffi_echo_bool(256) hot iteration " + i);
        if (echoBool(2) !== true)
            throw new Error("ffi_echo_bool(2) hot iteration " + i);
        if (echoBool(0) !== false)
            throw new Error("ffi_echo_bool(0) hot iteration " + i);
    }

    // ---- char is signed on every target (SPEC section 2).
    const echoChar = bind("ffi_echo_char", ["char"], "char");
    check(echoChar(-1), -1, "ffi_echo_char(-1)");
    check(echoChar(255), -1, "ffi_echo_char(255)");
    check(echoChar(0x80), -128, "ffi_echo_char(0x80)");
    check(echoChar(0x7f), 127, "ffi_echo_char(0x7f)");
    check(widenChar(-1), -1n, "ffi_widen_char(-1)");
    for (let i = 0; i < 2e4; ++i) {
        if (echoChar(255) !== -1)
            throw new Error("ffi_echo_char(255) hot iteration " + i);
    }

    // ---- Floating-point edge returns (purifyNaN, sign of zero, denormals, infinity).
    const retNanF32 = bind("ffi_ret_nan_f32", [], "f32");
    const retImpureNanF64 = bind("ffi_ret_impure_nan_f64", [], "f64");
    const retNegZeroF64 = bind("ffi_ret_neg_zero_f64", [], "f64");
    const retDenormalF32 = bind("ffi_ret_denormal_f32", [], "f32");
    const retInfF64 = bind("ffi_ret_inf_f64", [], "f64");
    const echoF32 = bind("ffi_echo_f32", ["f32"], "f32");
    const echoF64 = bind("ffi_echo_f64", ["f64"], "f64");
    for (let i = 0; i < 1e4; ++i) {
        if (!Number.isNaN(retNanF32()))
            throw new Error("ffi_ret_nan_f32 iteration " + i);
        if (!Number.isNaN(retImpureNanF64()))
            throw new Error("ffi_ret_impure_nan_f64 iteration " + i);
        if (!Object.is(retNegZeroF64(), -0))
            throw new Error("ffi_ret_neg_zero_f64 iteration " + i);
        if (retDenormalF32() !== 2 ** -149)
            throw new Error("ffi_ret_denormal_f32 iteration " + i + ": " + retDenormalF32());
        if (retInfF64() !== Infinity)
            throw new Error("ffi_ret_inf_f64 iteration " + i);
        if (!Number.isNaN(echoF32(NaN)))
            throw new Error("ffi_echo_f32(NaN) iteration " + i);
        if (!Number.isNaN(echoF64(NaN)))
            throw new Error("ffi_echo_f64(NaN) iteration " + i);
        if (!Object.is(echoF32(-0), -0))
            throw new Error("ffi_echo_f32(-0) iteration " + i);
        if (!Object.is(echoF64(-0), -0))
            throw new Error("ffi_echo_f64(-0) iteration " + i);
    }
    check(echoF32(2 ** -149), 2 ** -149, "denormal f32 argument round trip");
    check(echoF64(5e-324), 5e-324, "denormal f64 argument round trip");
    check(echoF32(3.4028234663852886e38), 3.4028234663852886e38, "FLT_MAX round trip");
    check(echoF32(1e39), Infinity, "f32 overflow to +inf");
    check(echoF32(-1e39), -Infinity, "f32 overflow to -inf");

    // u32 returns above INT32_MAX become doubles, not negative int32s.
    const echoU32 = bind("ffi_echo_u32", ["u32"], "u32");
    const echoI32 = bind("ffi_echo_i32", ["i32"], "i32");
    for (let i = 0; i < 2e4; ++i) {
        if (echoU32(-1) !== 4294967295)
            throw new Error("u32 return of 0xffffffff iteration " + i + ": " + echoU32(-1));
        if (echoU32(2147483648) !== 2147483648)
            throw new Error("u32 return of 0x80000000 iteration " + i);
        if (echoI32(-1) !== -1)
            throw new Error("i32 return of -1 iteration " + i);
        if (echoI32(2147483648) !== -2147483648)
            throw new Error("i32 wrap of 0x80000000 iteration " + i);
    }
}

if ($vm.useJIT())
    main();
