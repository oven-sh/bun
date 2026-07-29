//@ requireOptions("--useDollarVM=1")

// Signature validation (SPEC sections 2, 3, 11.2): every invalid descriptor
// is a TypeError; valid ones intern to canonical strings.

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + String(expected) + " but got " + String(actual));
}

function expectTypeError(fn, label) {
    let error = null;
    try {
        fn();
    } catch (e) {
        error = e;
    }
    if (error === null)
        throw new Error(label + ": expected a TypeError, nothing thrown");
    if (!(error instanceof TypeError))
        throw new Error(label + ": expected a TypeError, got " + error);
}

function main() {
    const target = $vm.ffiFixture("ffi_echo_i32");
    const dummy = () => 1;

    // ---- Invalid descriptors: TypeError from ffiFunction, ffiCallback and ffiSignatureString alike.
    const invalidDescriptors = [
        [{ args: ["void"], returns: "i32" }, "void as an argument"],
        [{ args: ["i32", "void", "i32"], returns: "i32" }, "void as a middle argument"],
        [{ args: ["int128"], returns: "i32" }, "unknown type string"],
        [{ args: ["i33"], returns: "i32" }, "unknown type string i33"],
        [{ args: ["I32"], returns: "i32" }, "type strings are case sensitive"],
        [{ args: [""], returns: "i32" }, "empty type string"],
        [{ args: ["i32 "], returns: "i32" }, "type string with trailing space"],
        [{ args: ["i32"], returns: "napi_env" }, "napi_env (removed type) as return type"],
        [{ args: ["napi_env", "i32"], returns: "i32" }, "napi_env (removed type) as an argument"],
        [{ args: [18], returns: "i32" }, "reserved tag 18 (was napi_env) as an argument"],
        [{ args: ["i32"], returns: 18 }, "reserved tag 18 (was napi_env) as return type"],
        [{ args: ["i32"], returns: "buffer" }, "buffer as return type"],
        [{ args: ["i32"], returns: "buffer_length" }, "buffer_length as return type"],
        [{ args: ["i32"], returns: 21 }, "buffer_length tag (21) as return type"],
        [{ args: ["i32"], returns: "unknown" }, "unknown return type string"],
        [{ args: ["i32"], returns: 22 }, "return tag out of range"],
        [{ args: [22], returns: "i32" }, "argument tag out of range"],
        [{ args: [-1], returns: "i32" }, "negative argument tag"],
        [{ args: [1.5], returns: "i32" }, "fractional argument tag"],
        [{ args: [13], returns: "i32" }, "void tag (13) as an argument"],
        [{ args: [{}], returns: "i32" }, "object as a type"],
        [{ args: [null], returns: "i32" }, "null as a type"],
        [{ args: [Symbol("i32")], returns: "i32" }, "symbol as a type"],
        [{ args: new Array(33).fill("i32"), returns: "i32" }, "33 arguments"],
        [{ args: new Array(64).fill("f64"), returns: "f64" }, "64 arguments"],
        [{ args: "i32", returns: "i32" }, "args is not an array"],
        [{ args: [true], returns: "i32" }, "boolean as a type"],
        [{ args: [[]], returns: "i32" }, "array as a type"],
        [null, "null descriptor"],
        [undefined, "undefined descriptor"],
        [42, "number descriptor"],
        ["f64(i32)", "string descriptor"],
    ];
    for (const [descriptor, label] of invalidDescriptors) {
        expectTypeError(() => $vm.ffiFunction(descriptor, target, "bad"), "ffiFunction: " + label);
        expectTypeError(() => $vm.ffiCallback(descriptor, dummy), "ffiCallback: " + label);
        expectTypeError(() => $vm.ffiSignatureString(descriptor), "ffiSignatureString: " + label);
    }

    // The 32-argument boundary is exact.
    const thirtyTwo = { args: new Array(32).fill("i32"), returns: "i64" };
    const fn32 = $vm.ffiFunction(thirtyTwo, $vm.ffiFixture("ffi_sum_i32_16"), "arity32");
    check(fn32.length, 32, "length of a 32-argument FFI function");

    // ---- Canonical signature strings: interning smoke test + aliases + numeric tags.
    check($vm.ffiSignatureString({ args: ["i32", "f64"], returns: "f64" }), "f64(i32,f64)", "canonical string");
    check($vm.ffiSignatureString({ args: ["int32_t", "double"], returns: "double" }), "f64(i32,f64)", "aliases canonicalize");
    check($vm.ffiSignatureString({ args: [5, 9], returns: 9 }), "f64(i32,f64)", "numeric tags canonicalize");
    check($vm.ffiSignatureString({ args: [], returns: "void" }), "void()", "empty signature");
    check($vm.ffiSignatureString({ args: [], returns: 13 }), "void()", "numeric void return tag");
    check($vm.ffiSignatureString({ args: ["char"], returns: "char" }), "char(char)", "char keeps its own name");
    check($vm.ffiSignatureString({ args: ["int8_t"], returns: "int8_t" }), "i8(i8)", "int8_t is i8, not char");
    check($vm.ffiSignatureString({ args: ["napi_value", "jsvalue"], returns: "napi_value" }), "jsvalue(jsvalue,jsvalue)", "napi_value is the legacy spelling of jsvalue");
    check($vm.ffiSignatureString({ args: ["buffer", "cstring", "function"], returns: "ptr" }), "ptr(buffer,cstring,function)", "pointer family names");
    check($vm.ffiSignatureString({ args: ["i64_fast", "u64_fast"], returns: "u64_fast" }), "u64_fast(i64_fast,u64_fast)", "fast 64-bit names");
    const everyAlias = [
        ["int8_t", "i8"], ["uint8_t", "u8"], ["int16_t", "i16"], ["uint16_t", "u16"], ["int32_t", "i32"], ["int", "i32"],
        ["c_int", "i32"], ["uint32_t", "u32"], ["c_uint", "u32"], ["int64_t", "i64"], ["isize", "i64"], ["uint64_t", "u64"],
        ["usize", "u64"], ["size_t", "u64"], ["double", "f64"], ["float", "f32"], ["void*", "ptr"], ["pointer", "ptr"],
        // "char*" is a POINTER alias (tag 12, Bun's FFIType parity), not cstring.
        ["char*", "ptr"], ["callback", "function"], ["fn", "function"], ["bool", "bool"], ["char", "char"],
        ["ptr", "ptr"], ["cstring", "cstring"], ["jsvalue", "jsvalue"], ["napi_value", "jsvalue"],
    ];
    for (const [alias, canonical] of everyAlias)
        check($vm.ffiSignatureString({ args: [alias], returns: "i32" }), "i32(" + canonical + ")", "alias " + alias);
    // Every numeric tag in order. Tag 13 (void) is not a valid argument and tag 18 is the
    // reserved (formerly napi_env) tag, invalid in every position; both are skipped here (18's
    // rejection is covered by the invalid-descriptor table above).
    const canonicalByTag = ["char", "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "f64", "f32", "bool", "ptr", "void", "cstring", "i64_fast", "u64_fast", "function", null, "jsvalue", "buffer", "buffer_length"];
    for (let tag = 0; tag < canonicalByTag.length; ++tag) {
        if (canonicalByTag[tag] === "void" || canonicalByTag[tag] === null)
            continue; // void is not a valid argument; 18 is reserved
        check($vm.ffiSignatureString({ args: [tag], returns: 5 }), "i32(" + canonicalByTag[tag] + ")", "numeric tag " + tag);
    }

    // Structural interning: equal shapes give the same string, order matters.
    check($vm.ffiSignatureString({ args: ["i32", "f64"], returns: "f64" }) === $vm.ffiSignatureString({ args: [5, "double"], returns: 9 }), true, "interning agrees across spellings");
    if ($vm.ffiSignatureString({ args: ["f64", "i32"], returns: "f64" }) === $vm.ffiSignatureString({ args: ["i32", "f64"], returns: "f64" }))
        throw new Error("argument order must matter");

    // ---- The `ptr` parameter of $vm.ffiFunction must be a pointer number or a JSFFICallback.
    expectTypeError(() => $vm.ffiFunction({ args: ["i32"], returns: "i32" }, "not a pointer", "bad"), "string as ptr");
    expectTypeError(() => $vm.ffiFunction({ args: ["i32"], returns: "i32" }, {}, "bad"), "object as ptr");
    expectTypeError(() => $vm.ffiFunction({ args: ["i32"], returns: "i32" }, Symbol("p"), "bad"), "symbol as ptr");
    expectTypeError(() => $vm.ffiFunction({ args: ["i32"], returns: "i32" }, dummy, "bad"), "raw JS function as ptr");
    expectTypeError(() => $vm.ffiCallback({ args: ["i32"], returns: "i32" }, 42), "non-callable callback target");
    expectTypeError(() => $vm.ffiCallback({ args: ["i32"], returns: "i32" }, {}), "object callback target");

    // ---- Unknown fixture names throw (but not TypeError necessarily).
    let threw = false;
    try {
        $vm.ffiFixture("ffi_no_such_fixture");
    } catch (e) {
        threw = true;
    }
    check(threw, true, "unknown fixture name throws");
    const names = $vm.ffiFixtures();
    check(Array.isArray(names), true, "$vm.ffiFixtures() returns an array");
    check(names.includes("ffi_echo_i32"), true, "fixture list contains ffi_echo_i32");
    check(names.includes("ffi_canary_call"), true, "fixture list contains ffi_canary_call");
    check(names.length >= 90, true, "fixture list is complete");
}

if ($vm.useJIT())
    main();
