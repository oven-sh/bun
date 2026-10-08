//@ requireOptions("--useDollarVM=1")

// Seeded fuzz (500+ cases) over the echo/add/sum fixtures with random edge
// values, verified against a JS reference implementation of the SPEC
// section 5 conversion rules in both directions.

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (typeof value === "symbol")
        return value.toString();
    if (Object.is(value, -0))
        return "-0";
    return String(value);
}

// Returns a NEW caller function every time (a distinct FunctionExecutable /
// CodeBlock via `new Function`), so the FFI call site inside it is
// monomorphic, exact-arity and non-spread -- the only call-site shape the DFG
// Call -> CallFFI conversion accepts (SPEC section 10.2). The hot phase below
// gives each callee its own caller so the optimized typed path is what the
// random edges keep flowing through.
function makeMonomorphicCaller(arity) {
    const argumentList = Array.from({ length: arity }, (_, i) => "args[" + i + "]").join(", ");
    return new Function("callable", "args", "return callable(" + argumentList + ");");
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (fixtureName, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(fixtureName), fixtureName + "->" + ret);

    // ---- Deterministic PRNG (xorshift128+ over two 64-bit BigInt states, simplified via mulberry32).
    let state = 0x0badc0de | 0;
    function random() {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const randomIntBits = () => Math.floor(random() * 4294967296) - 2147483648; // uniform int32
    const pick = list => list[Math.floor(random() * list.length)];

    // ---- JS reference of SPEC section 5.
    const twoTo32 = 4294967296;
    const twoTo64 = 2n ** 64n;
    const twoTo63 = 2n ** 63n;
    const MAX_INT52 = 9007199254740991;
    // ECMAScript ToInt32 for the value classes we generate (number, boolean, undefined, null).
    function toInt32(v) {
        if (typeof v === "boolean")
            return v ? 1 : 0;
        if (v === undefined || v === null)
            return 0;
        const n = Number(v);
        if (!Number.isFinite(n))
            return 0;
        const t = Math.trunc(n) % twoTo32;
        const u = t < 0 ? t + twoTo32 : t;
        const r = u >= 2147483648 ? u - twoTo32 : u;
        // Math.trunc(-0.999999) is -0 and survives the arithmetic above; ECMAScript
        // ToInt32(-0.999999) is +0, and Object.is distinguishes 0 from -0, so
        // normalize (r is always an integer here, so `+ 0` only flips -0 to +0).
        return r + 0;
    }
    // Both hardware truncations agree exactly when |d| < 2^63; the fuzzer only
    // generates such doubles (the arch-specific saturation edges live in
    // testFFI's doubleToInt64 corpus).
    function doubleToInt64(d) {
        return BigInt(Math.trunc(d));
    }
    const reference = {
        "char": v => (toInt32(v) << 24) >> 24,
        "i8": v => (toInt32(v) << 24) >> 24,
        "u8": v => toInt32(v) & 0xff,
        "i16": v => (toInt32(v) << 16) >> 16,
        "u16": v => toInt32(v) & 0xffff,
        "i32": v => toInt32(v),
        "u32": v => toInt32(v) >>> 0,
        "bool": v => Boolean(v),
        "i64": v => {
            if (typeof v === "bigint")
                return BigInt.asIntN(64, v);
            if (Number.isInteger(v) && Math.abs(v) <= 2147483647)
                return BigInt(v); // int32 -> sign-extend
            return BigInt.asIntN(64, doubleToInt64(v));
        },
        "u64": v => {
            if (typeof v === "bigint")
                return BigInt.asUintN(64, v);
            if (Number.isInteger(v) && Math.abs(v) <= 2147483647)
                return BigInt.asUintN(64, BigInt(v)); // int32 -> sign-extend then reinterpret
            return BigInt.asUintN(64, doubleToInt64(v));
        },
        "i64_fast": v => {
            const r = reference["i64"](v);
            return (r >= BigInt(-MAX_INT52) && r <= BigInt(MAX_INT52)) ? Number(r) : r;
        },
        "u64_fast": v => {
            const r = reference["u64"](v);
            return r < BigInt(MAX_INT52) ? Number(r) : r;
        },
        // Bun parity: plain Number(); f32 is Math.fround of the same.
        "f64": v => Number(v),
        "f32": v => Math.fround(Number(v)),
        "ptr": v => {
            let bits;
            if (v === null || v === undefined)
                bits = 0n;
            else if (Number.isInteger(v) && Math.abs(v) <= 2147483647)
                bits = BigInt.asUintN(64, BigInt(v));
            else
                bits = BigInt.asUintN(64, doubleToInt64(v));
            if (bits === 0n)
                return null;
            // Addresses above 2^53 are surfaced as an exact BigInt (bun#28068).
            return bits <= 9007199254740991n ? Number(bits) : bits;
        },
    };
    reference["cstring"] = value => (value === null || value === undefined ? null : String(value));

    // ---- Value generators (per FFI type).
    const int32Edges = [0, 1, -1, 2147483647, -2147483648, 2147483646, -2147483647, 65535, 65536, -65536, 255, 256, 127, 128, -128, -129, 32767, 32768, -32768];
    const doubleEdges = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, 0.999999, -0.999999, 2 ** 31, -(2 ** 31), 2 ** 32 + 5, -(2 ** 32) - 5, 2 ** 52, 2 ** 53, 2 ** 53 - 1, -(2 ** 53), 2 ** 62, -(2 ** 62), 1e15 + 0.75, -1e15 - 0.75, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON];
    const bigIntEdges = [0n, 1n, -1n, twoTo63 - 1n, -twoTo63, twoTo63, twoTo64 - 1n, twoTo64, twoTo64 + 12345n, -twoTo64, 2n ** 100n + 7n, -(2n ** 90n), 9007199254740993n, 4611686018427387904n];
    const oddballs = [true, false, undefined, null];
    function genFor(type) {
        switch (type) {
        case "char": case "i8": case "u8": case "i16": case "u16": case "i32": case "u32": case "bool":
            switch (Math.floor(random() * 4)) {
            case 0: return pick(int32Edges);
            case 1: return pick(doubleEdges);
            case 2: return pick(oddballs);
            default: return randomIntBits() * (random() < 0.5 ? 1 : 2.3);
            }
        case "i64": case "u64": case "i64_fast": case "u64_fast": {
            switch (Math.floor(random() * 4)) {
            case 0: return pick(int32Edges);
            case 1: return pick(bigIntEdges);
            case 2: return BigInt.asIntN(64, BigInt(randomIntBits()) * BigInt(randomIntBits()) * 4294967311n);
            default: {
                // doubles strictly inside (-2^63, 2^63) so both hardware truncations agree
                const d = pick(doubleEdges.filter(x => Number.isFinite(x) && Math.abs(x) < 9007199254740992 * 512));
                return d;
            }
            }
        }
        case "f64":
            return random() < 0.8 ? pick(doubleEdges) : randomIntBits() / (1 + Math.floor(random() * 7));
        case "f32":
            return random() < 0.7 ? pick(doubleEdges) : randomIntBits() / 8;
        case "cstring":
            switch (Math.floor(random() * 5)) {
            case 0: return pick([null, undefined]);
            case 1: return "";
            case 2: return pick(["a", "hello", "with space", "0123456789".repeat(20)]);
            case 3: return pick(["h\u00e9!", "\u2603 snowman", "\u{1F600} astral", "mix\u00e9d\u2603up"]);
            default: return String(randomIntBits());
            }
        case "ptr":
            switch (Math.floor(random() * 4)) {
            case 0: return pick([0, null, undefined, 4096, 65535, 0x7fffffff, -1, -4096]);
            case 1: return pick([2 ** 40, 2 ** 47 - 1, 140737488355327, 0x00007fffdeadbee0]);
            case 2: return Math.floor(random() * 2 ** 46);
            default: return -Math.floor(random() * 2 ** 30);
            }
        }
        throw new Error("no generator for " + type);
    }

    // ---- Fixture bindings by declared FFI type (echo family).
    const echoBindings = {
        "char": bind("ffi_echo_char", ["char"], "char"),
        "i8": bind("ffi_echo_i8", ["i8"], "i8"),
        "u8": bind("ffi_echo_u8", ["u8"], "u8"),
        "i16": bind("ffi_echo_i16", ["i16"], "i16"),
        "u16": bind("ffi_echo_u16", ["u16"], "u16"),
        "i32": bind("ffi_echo_i32", ["i32"], "i32"),
        "u32": bind("ffi_echo_u32", ["u32"], "u32"),
        "bool": bind("ffi_echo_bool", ["bool"], "bool"),
        "i64": bind("ffi_echo_i64", ["i64"], "i64"),
        "u64": bind("ffi_echo_u64", ["u64"], "u64"),
        "i64_fast": bind("ffi_echo_i64", ["i64_fast"], "i64_fast"),
        "u64_fast": bind("ffi_echo_u64", ["u64_fast"], "u64_fast"),
        "f64": bind("ffi_echo_f64", ["f64"], "f64"),
        "f32": bind("ffi_echo_f32", ["f32"], "f32"),
        "ptr": bind("ffi_echo_ptr", ["ptr"], "ptr"),
        "cstring": bind("ffi_echo_cstring", ["cstring"], "cstring"),
    };
    // Echo semantics: the native fixture returns its argument unchanged, so the
    // result is the JS->native argument conversion followed by the native->JS
    // return boxing of the same type.
    function echoReference(type, value) {
        const asArgument = reference[type](value);
        switch (type) {
        case "bool":
            return asArgument; // already a boolean
        case "ptr":
            return asArgument; // null or number
        case "cstring":
            return asArgument === null || asArgument === undefined ? null : String(asArgument);
        default:
            return asArgument;
        }
    }
    const echoTypes = Object.keys(echoBindings);

    // ---- Two-argument adders.
    const addI32 = bind("ffi_add_i32", ["i32", "i32"], "i32");
    const addF64 = bind("ffi_add_f64", ["f64", "f64"], "f64");
    const addI64 = bind("ffi_add_i64", ["i64", "i64"], "i64");
    const addU64 = bind("ffi_add_u64", ["u64", "u64"], "u64");
    const addF32 = bind("ffi_add_f32", ["f32", "f32"], "f32");
    const adders = [
        ["i32", addI32, (a, b) => (reference["i32"](a) + reference["i32"](b)) | 0],
        ["f64", addF64, (a, b) => reference["f64"](a) + reference["f64"](b)],
        ["i64", addI64, (a, b) => BigInt.asIntN(64, reference["i64"](a) + reference["i64"](b))],
        ["u64", addU64, (a, b) => BigInt.asUintN(64, reference["u64"](a) + reference["u64"](b))],
        ["f32", addF32, (a, b) => Math.fround(Math.fround(a) + Math.fround(b))],
    ];

    // ---- Sum ladders.
    const sumI32_16 = bind("ffi_sum_i32_16", new Array(16).fill("i32"), "i64");
    const sumF64_12 = bind("ffi_sum_f64_12", new Array(12).fill("f64"), "f64");
    const sumU8_12 = bind("ffi_sum_u8_12", new Array(12).fill("u8"), "i64");
    const sumI16_12 = bind("ffi_sum_i16_12", new Array(12).fill("i16"), "i64");

    let executed = 0;
    let mismatches = 0;
    function fail(message) {
        mismatches++;
        throw new Error(message);
    }
    function verify(label, actual, expected) {
        executed++;
        if (!Object.is(actual, expected))
            fail(label + ": expected " + describe(expected) + " but got " + describe(actual));
    }

    const totalCases = 600;
    for (let caseIndex = 0; caseIndex < totalCases; ++caseIndex) {
        const kind = random();
        if (kind < 0.55) {
            // Echo case.
            const type = pick(echoTypes);
            const value = genFor(type);
            const expected = echoReference(type, value);
            const actual = echoBindings[type](value);
            verify("echo " + type + "(" + describe(value) + ")", actual, expected);
        } else if (kind < 0.8) {
            // Adder case.
            const [type, fn, ref] = pick(adders);
            const a = genFor(type === "f32" ? "f32" : type);
            const b = genFor(type === "f32" ? "f32" : type);
            verify(type + " add(" + describe(a) + ", " + describe(b) + ")", fn(a, b), ref(a, b));
        } else if (kind < 0.9) {
            // 16-way int32 ladder.
            const values = new Array(16).fill(0).map(() => genFor("i32"));
            let expected = 0n;
            for (const v of values)
                expected += BigInt(reference["i32"](v));
            verify("sum_i32_16(" + values.map(describe).join(",") + ")", sumI32_16(...values), expected);
        } else if (kind < 0.95) {
            // 12-way double ladder (finite dyadic values). Fold left-to-right
            // starting from the first operand exactly like the fixture's
            // `a0 + a1 + ... + a11`, so even the sign of a zero sum matches.
            const values = new Array(12).fill(0).map(() => Math.round(random() * 1024 - 512) / 8);
            let expected = values[0];
            for (let i = 1; i < values.length; ++i)
                expected += values[i];
            verify("sum_f64_12(" + values.join(",") + ")", sumF64_12(...values), expected);
        } else {
            // Sub-8-byte stack ladders.
            const useSigned = random() < 0.5;
            const type = useSigned ? "i16" : "u8";
            const fn = useSigned ? sumI16_12 : sumU8_12;
            const values = new Array(12).fill(0).map(() => genFor(type));
            let expected = 0n;
            for (const v of values)
                expected += BigInt(reference[type](v));
            verify("sum_" + type + "_12(" + values.map(describe).join(",") + ")", fn(...values), expected);
        }
    }
    if (executed !== totalCases || mismatches !== 0)
        throw new Error("fuzz bookkeeping: executed " + executed + ", mismatches " + mismatches);

    // A second, tighter phase: monomorphic random calls per callee, each
    // through its own dedicated exact-arity caller, so the callers tier up
    // (typed CallFFI sites) while the fuzzer keeps feeding random edges
    // through the optimized code.
    for (const [type, fn, ref] of adders) {
        const caller = makeMonomorphicCaller(2);
        const args = [0, 0];
        for (let i = 0; i < 3000; ++i) {
            const a = genFor(type === "f32" ? "f32" : type);
            const b = genFor(type === "f32" ? "f32" : type);
            args[0] = a;
            args[1] = b;
            const actual = caller(fn, args);
            const expected = ref(a, b);
            if (!Object.is(actual, expected))
                throw new Error("hot fuzz " + type + " add(" + describe(a) + ", " + describe(b) + "): expected " + describe(expected) + " but got " + describe(actual) + " at iteration " + i);
        }
    }
    for (const type of echoTypes) {
        const fn = echoBindings[type];
        const caller = makeMonomorphicCaller(1);
        const args = [0];
        for (let i = 0; i < 2000; ++i) {
            const value = genFor(type);
            args[0] = value;
            const actual = caller(fn, args);
            const expected = echoReference(type, value);
            if (!Object.is(actual, expected))
                throw new Error("hot fuzz echo " + type + "(" + describe(value) + "): expected " + describe(expected) + " but got " + describe(actual) + " at iteration " + i);
        }
    }
}

if ($vm.useJIT())
    main();
