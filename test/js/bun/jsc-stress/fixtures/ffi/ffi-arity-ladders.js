//@ requireOptions("--useDollarVM=1")

// Arity ladders that straddle every register->stack boundary of the
// supported ABIs, plus the interleaved ffi_mix_* fixtures. Each mix returns
// the position-weighted checksum sum((k + 1) * arg_k), so any argument that
// lands in the wrong register or stack slot changes the result.

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + String(expected) + " but got " + String(actual));
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (name, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(name), name);

    // Deterministic PRNG (mulberry32).
    let seed = 0x1abe11ed;
    function random() {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const randomInt32 = () => (Math.floor(random() * 4294967296) | 0);
    const randomSmall = () => Math.floor(random() * 2001) - 1000;

    // ---- ffi_sum_i32_<n>: int64 sums returned as BigInt.
    const sumI32Arities = [0, 1, 2, 4, 6, 7, 8, 9, 12, 16];
    const sumI32 = new Map();
    for (const n of sumI32Arities)
        sumI32.set(n, bind("ffi_sum_i32_" + n, new Array(n).fill("i32"), "i64"));

    function checkSumI32(n, values) {
        let expected = 0n;
        for (const v of values)
            expected += BigInt(v | 0);
        const actual = sumI32.get(n)(...values);
        check(actual, expected, "ffi_sum_i32_" + n + "(" + values.join(",") + ")");
    }
    for (const n of sumI32Arities) {
        checkSumI32(n, new Array(n).fill(0));
        checkSumI32(n, new Array(n).fill(-1));
        checkSumI32(n, new Array(n).fill(2147483647));
        checkSumI32(n, new Array(n).fill(-2147483648));
        // Distinct powers of two: catches any duplicated or swapped argument.
        checkSumI32(n, new Array(n).fill(0).map((_, i) => (i % 2 ? -1 : 1) * (1 << (i + 5))));
        for (let iteration = 0; iteration < 30; ++iteration)
            checkSumI32(n, new Array(n).fill(0).map(() => randomInt32()));
    }

    // ---- ffi_sum_f64_<n>: double sums.
    const sumF64Arities = [1, 2, 7, 8, 9, 12];
    const sumF64 = new Map();
    for (const n of sumF64Arities)
        sumF64.set(n, bind("ffi_sum_f64_" + n, new Array(n).fill("f64"), "f64"));
    function checkSumF64(n, values) {
        let expected = 0;
        for (const v of values)
            expected += v; // same left-to-right order as the fixture
        const actual = sumF64.get(n)(...values);
        check(actual, expected, "ffi_sum_f64_" + n + "(" + values.join(",") + ")");
    }
    for (const n of sumF64Arities) {
        checkSumF64(n, new Array(n).fill(0));
        checkSumF64(n, new Array(n).fill(-0.5));
        checkSumF64(n, new Array(n).fill(0).map((_, i) => 1 / (1 << i))); // exact binary fractions
        checkSumF64(n, new Array(n).fill(0).map((_, i) => (i % 2 ? -1 : 1) * 2 ** (i * 4)));
        for (let iteration = 0; iteration < 30; ++iteration)
            checkSumF64(n, new Array(n).fill(0).map(() => randomSmall() * 2 ** (Math.floor(random() * 60) - 30)));
    }

    // ---- Sub-8-byte stack ladders (Apple arm64 packing).
    const sumU8_10 = bind("ffi_sum_u8_10", new Array(10).fill("u8"), "i64");
    const sumU8_12 = bind("ffi_sum_u8_12", new Array(12).fill("u8"), "i64");
    const sumI16_10 = bind("ffi_sum_i16_10", new Array(10).fill("i16"), "i64");
    const sumI16_12 = bind("ffi_sum_i16_12", new Array(12).fill("i16"), "i64");
    function checkSubword(fn, name, values, widthMask, signed) {
        let expected = 0n;
        for (const v of values) {
            let w = (v | 0) & widthMask;
            if (signed && (w & ((widthMask + 1) >>> 1)))
                w -= widthMask + 1;
            expected += BigInt(w);
        }
        check(fn(...values), expected, name + "(" + values.join(",") + ")");
    }
    for (const [fn, name, n, mask, signed] of [
        [sumU8_10, "ffi_sum_u8_10", 10, 0xff, false],
        [sumU8_12, "ffi_sum_u8_12", 12, 0xff, false],
        [sumI16_10, "ffi_sum_i16_10", 10, 0xffff, true],
        [sumI16_12, "ffi_sum_i16_12", 12, 0xffff, true],
    ]) {
        checkSubword(fn, name, new Array(n).fill(0), mask, signed);
        checkSubword(fn, name, new Array(n).fill(-1), mask, signed); // 255 / -1
        checkSubword(fn, name, new Array(n).fill(0).map((_, i) => 1 << i), mask, signed); // distinct powers of two
        checkSubword(fn, name, new Array(n).fill(0).map((_, i) => i + 1), mask, signed);
        checkSubword(fn, name, new Array(n).fill(mask), mask, signed);
        checkSubword(fn, name, new Array(n).fill((mask + 1) >>> 1), mask, signed); // sign bit
        for (let iteration = 0; iteration < 30; ++iteration)
            checkSubword(fn, name, new Array(n).fill(0).map(() => randomInt32()), mask, signed);
    }

    // ---- Mixes. checksum = sum (k + 1) * cast(arg_k)
    const mix1 = bind("ffi_mix_1", ["i32", "f64", "i64", "f32", "ptr", "u8", "f64", "i16", "f64", "i32"], "f64");
    const mix2 = bind("ffi_mix_2", ["f32", "i32", "f32", "i32", "f32", "i32", "f32", "i32", "f32", "i32"], "f64");
    const mix3 = bind("ffi_mix_3", ["f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "i32"], "f64");
    const mix4 = bind("ffi_mix_4", ["i64", "i64", "i64", "i64", "i64", "i64", "f64", "i64", "f64"], "f64");
    const mix5 = bind("ffi_mix_5", ["u8", "i8", "u16", "i16", "u32", "i32", "u64", "i64"], "f64");
    const mix6 = bind("ffi_mix_6", ["bool", "bool", "i32", "bool", "f64", "bool", "f32", "bool", "bool", "bool", "bool", "bool", "bool"], "f64");
    const mix7 = bind("ffi_mix_7", ["ptr", "char", "ptr", "char", "ptr", "char", "ptr", "char", "ptr", "char"], "f64");
    const mix8 = bind("ffi_mix_8", ["f32", "f64", "f32", "f64", "f32", "f64", "f32", "f64", "f32", "f64", "f32", "f64"], "f64");

    // JS reference of the C casts used by the fixtures.
    const castByType = {
        "i32": v => v | 0,
        "f64": v => +v,
        "i64": v => Number(BigInt.asIntN(64, BigInt(Math.trunc(v)))),
        "f32": v => Math.fround(v),
        "ptr": v => Math.trunc(v), // small non-negative pointers only
        "u8": v => (v | 0) & 0xff,
        "i16": v => ((v | 0) << 16) >> 16,
        "i8": v => ((v | 0) << 24) >> 24,
        "char": v => ((v | 0) << 24) >> 24,
        "u16": v => (v | 0) & 0xffff,
        "u32": v => (v | 0) >>> 0,
        "u64": v => Number(BigInt.asUintN(64, BigInt(Math.trunc(v)))),
        "bool": v => (v ? 1 : 0),
    };
    function checksum(types, values) {
        let sum = 0;
        for (let k = 0; k < types.length; ++k)
            sum += (k + 1) * castByType[types[k]](values[k]);
        return sum;
    }
    const mixes = [
        [mix1, "ffi_mix_1", ["i32", "f64", "i64", "f32", "ptr", "u8", "f64", "i16", "f64", "i32"]],
        [mix2, "ffi_mix_2", ["f32", "i32", "f32", "i32", "f32", "i32", "f32", "i32", "f32", "i32"]],
        [mix3, "ffi_mix_3", ["f64", "f64", "f64", "f64", "f64", "f64", "f64", "f64", "i32"]],
        [mix4, "ffi_mix_4", ["i64", "i64", "i64", "i64", "i64", "i64", "f64", "i64", "f64"]],
        [mix5, "ffi_mix_5", ["u8", "i8", "u16", "i16", "u32", "i32", "u64", "i64"]],
        [mix6, "ffi_mix_6", ["bool", "bool", "i32", "bool", "f64", "bool", "f32", "bool", "bool", "bool", "bool", "bool", "bool"]],
        [mix7, "ffi_mix_7", ["ptr", "char", "ptr", "char", "ptr", "char", "ptr", "char", "ptr", "char"]],
        [mix8, "ffi_mix_8", ["f32", "f64", "f32", "f64", "f32", "f64", "f32", "f64", "f32", "f64", "f32", "f64"]],
    ];
    // Value generators per type. All chosen so that the checksum arithmetic
    // is exact in double (weights <= 13, magnitudes <= 2^40).
    const generatorByType = {
        "i32": () => randomSmall() * 65536 + Math.floor(random() * 65536),
        "f64": () => randomSmall() / 8,
        "i64": () => randomSmall() * 1048576,
        "f32": () => Math.fround(randomSmall() / 16),
        "ptr": () => Math.floor(random() * 65536) * 8,
        "u8": () => Math.floor(random() * 512) - 128,
        "i16": () => Math.floor(random() * 200000) - 100000,
        "i8": () => Math.floor(random() * 512) - 256,
        "char": () => Math.floor(random() * 512) - 256,
        "u16": () => Math.floor(random() * 200000) - 100000,
        "u32": () => Math.floor(random() * 4294967296) - 2147483648,
        "u64": () => Math.floor(random() * 65536),
        "bool": () => [0, 1, 2, -1, 0.5, 0, 1][Math.floor(random() * 7)],
    };
    for (const [fn, name, types] of mixes) {
        // Distinct-position probe: 1 at each position in turn.
        for (let k = 0; k < types.length; ++k) {
            const values = types.map((_, i) => (i === k ? 1 : 0));
            check(fn(...values), checksum(types, values), name + " unit vector at " + k);
        }
        // All-ones and per-type extremes.
        check(fn(...types.map(() => 1)), checksum(types, types.map(() => 1)), name + " all ones");
        for (let iteration = 0; iteration < 200; ++iteration) {
            const values = types.map(t => generatorByType[t]());
            check(fn(...values), checksum(types, values), name + " random iteration " + iteration + " (" + values.join(",") + ")");
        }
    }

    // ---- Hot loops so the ladders are also driven through the JIT tiers.
    // Every hot call site below is exact-arity, monomorphic and non-spread so
    // it can become a typed CallFFI node (SPEC section 10.2); a spread call
    // (CallVarargs) is never converted.
    const nine = sumI32.get(9);
    for (let i = 0; i < 4e4; ++i) {
        const r = nine(1, -2, 3, -4, 5, -6, 7, -8, 100000);
        if (r !== 99996n)
            throw new Error("ffi_sum_i32_9 hot iteration " + i + " got " + r);
    }
    // 2^52 keeps every weighted product exactly representable, so FMA
    // contraction inside the C fixture cannot change the result.
    const mixValues = [7, 1.5, 4503599627370496, 2.5, 4096, 250, -3.25, -1234, 8.75, -99];
    const mixTypes = mixes[0][2];
    const mixExpected = checksum(mixTypes, mixValues);
    for (let i = 0; i < 4e4; ++i) {
        const r = mix1(7, 1.5, 4503599627370496, 2.5, 4096, 250, -3.25, -1234, 8.75, -99);
        if (r !== mixExpected)
            throw new Error("ffi_mix_1 hot iteration " + i + " got " + r + " expected " + mixExpected);
    }
    const mix8Values = mixes[7][2].map((t, i) => (t === "f32" ? Math.fround(i + 0.5) : -(i + 0.25)));
    const mix8Expected = checksum(mixes[7][2], mix8Values);
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11] = mix8Values;
    for (let i = 0; i < 4e4; ++i) {
        const r = mix8(m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11);
        if (r !== mix8Expected)
            throw new Error("ffi_mix_8 hot iteration " + i + " got " + r + " expected " + mix8Expected);
    }
}

if ($vm.useJIT())
    main();
